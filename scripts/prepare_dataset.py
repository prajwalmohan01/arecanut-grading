"""Prepare a YOLO-format detection dataset for explicit training.

This script does NOT invent annotations. It only accepts datasets that already
contain individual-nut bounding boxes in YOLO format:

    <root>/images/{train,val,test}/*.jpg
    <root>/labels/{train,val,test}/*.txt      (class x_center y_center w h, 0-1)
    <root>/data.yaml                          (names: [GradeA, GradeB, ...])

If no such dataset exists, it writes a blocker report and exits with code 2.
Raw images are never modified; prepared splits are hardlinked (or copied) into a
configurable training cache outside the app's upload/static directories.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.datasets import (  # noqa: E402
    DEFAULT_DATASET_DIR,
    IMAGE_EXTENSIONS,
    PROJECT_ROOT,
    REPORTS_DIR,
    TRAINING_CACHE,
    display_path,
    portable_text,
    read_yolo_names,
    utc_now,
    write_json,
)

DEFAULT_OUTPUT = TRAINING_CACHE / "dataset"
VALID_GRADE_NAMES = {"gradea", "gradeb", "gradec", "graded", "grade a", "grade b", "grade c", "grade d"}


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def average_hash(path: Path) -> str | None:
    """64-bit average hash; catches resized/re-encoded near-duplicates."""
    try:
        from PIL import Image

        with Image.open(path) as image:
            small = image.convert("L").resize((8, 8), Image.BILINEAR)
            pixels = list(small.tobytes())
    except Exception:
        return None
    average = sum(pixels) / len(pixels)
    bits = "".join("1" if value >= average else "0" for value in pixels)
    return f"{int(bits, 2):016x}"


def find_pairs(root: Path) -> tuple[list[dict], list[str]]:
    """Find image/label pairs in a YOLO tree. Returns (pairs, problems)."""
    pairs: list[dict] = []
    problems: list[str] = []
    for label_path in sorted(root.rglob("*.txt")):
        parts = label_path.parts
        if "labels" not in [part.lower() for part in parts]:
            continue
        # Build the matching image path by replacing the nearest labels segment.
        lower_parts = [part.lower() for part in parts]
        label_index = max(i for i, part in enumerate(lower_parts) if part == "labels")
        image_parts = list(parts)
        image_parts[label_index] = "images"
        image_stem = label_path.stem
        candidates = []
        for ext in IMAGE_EXTENSIONS:
            candidate = Path(*image_parts).with_name(image_stem + ext)
            candidates.append(candidate)
            candidates.append(candidate.with_suffix(candidate.suffix.upper()))
        image_path = next((c for c in candidates if c.is_file()), None)
        if image_path is None:
            problems.append(f"Missing image for label: {label_path}")
            continue
        pairs.append({"image": image_path, "label": label_path})
    return pairs, problems


def validate_label(label_path: Path, class_count: int) -> tuple[list[str], int]:
    errors: list[str] = []
    lines = 0
    try:
        content = label_path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return [f"Cannot read {label_path}: {exc}"], 0
    for number, line in enumerate(content.splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            continue
        lines += 1
        fields = stripped.split()
        if len(fields) < 5:
            errors.append(f"{label_path}:{number} expected 5 fields, got {len(fields)}")
            continue
        try:
            class_id = int(float(fields[0]))
            coords = [float(value) for value in fields[1:5]]
        except ValueError:
            errors.append(f"{label_path}:{number} non-numeric YOLO fields")
            continue
        if class_id < 0 or class_id >= class_count:
            errors.append(
                f"{label_path}:{number} class id {class_id} outside 0..{class_count - 1}"
            )
        if any(value < 0.0 or value > 1.0 for value in coords):
            payload = " ".join(f"{value:.4f}" for value in coords)
            errors.append(f"{label_path}:{number} bbox not normalised: {payload}")
        if coords[2] <= 0 or coords[3] <= 0:
            errors.append(f"{label_path}:{number} zero-area bbox")
    return errors, lines


def split_for(key: str, train: float, val: float) -> str:
    """Deterministic split based on a content hash (stable across reruns)."""
    bucket = int(key[:8], 16) / 0xFFFFFFFF
    if bucket < train:
        return "train"
    if bucket < train + val:
        return "val"
    return "test"


def materialise(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        return
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)


def has_label_files(root: Path) -> bool:
    """True when a YOLO ``labels`` tree with at least one .txt file exists."""
    if not root.is_dir():
        return False
    for path in root.rglob("*.txt"):
        if "labels" in [part.lower() for part in path.parts]:
            return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data",
        required=False,
        help=(
            "Root directory (or data.yaml) of an existing YOLO detection dataset. "
            f"Defaults to {display_path(DEFAULT_DATASET_DIR)} when it contains labels."
        ),
    )
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Prepared dataset directory.")
    parser.add_argument("--train", type=float, default=0.7)
    parser.add_argument("--val", type=float, default=0.2)
    parser.add_argument("--test", type=float, default=0.1)
    parser.add_argument("--min-boxes", type=int, default=50)
    parser.add_argument(
        "--near-duplicates",
        action="store_true",
        help="Also drop near-identical images via a 64-bit average hash (may over-merge similar nuts).",
    )
    args = parser.parse_args()

    report: dict = {
        "generated_at": utc_now(),
        "output_dir": display_path(args.output),
        "ready": False,
        "errors": [],
        "warnings": [],
    }

    if not args.data:
        if has_label_files(DEFAULT_DATASET_DIR):
            args.data = str(DEFAULT_DATASET_DIR)
            print(f"Using project-local dataset: {display_path(DEFAULT_DATASET_DIR)}")
        else:
            report["errors"].append(
                "No annotated dataset found. Put a YOLO detection dataset in "
                f"{display_path(DEFAULT_DATASET_DIR)} (see datasets/README.md) or pass "
                "--data <folder>. Unlabelled images cannot be used for detector training."
            )
            write_json(REPORTS_DIR / "prepare_dataset.json", report)
            print("\n".join(report["errors"]))
            print("Wrote", display_path(REPORTS_DIR / "prepare_dataset.json"))
            return 2

    source = Path(args.data).expanduser().resolve()
    if source.is_file() and source.suffix.lower() in {".yaml", ".yml"}:
        source_root = source.parent
    else:
        source_root = source
    if not source_root.is_dir():
        report["errors"].append(f"Dataset directory not found: {display_path(source_root)}")
        write_json(REPORTS_DIR / "prepare_dataset.json", report)
        print(report["errors"][0])
        return 2

    yaml_files = sorted(source_root.rglob("*.yaml")) + sorted(source_root.rglob("*.yml"))
    class_names: list[str] = []
    data_yaml = None
    for candidate in yaml_files:
        names = read_yolo_names(candidate)
        if names:
            class_names = names
            data_yaml = candidate
            break
    if not class_names:
        report["errors"].append(
            f"No data.yaml with a 'names' list was found under {display_path(source_root)}. "
            "YOLO detection training needs explicit class names."
        )
        write_json(REPORTS_DIR / "prepare_dataset.json", report)
        print(report["errors"][0])
        return 2

    report["source"] = display_path(source_root)
    report["data_yaml"] = display_path(data_yaml)
    report["class_names"] = class_names
    report["class_index_mapping"] = {index: name for index, name in enumerate(class_names)}

    normalised = {name.strip().lower() for name in class_names}
    if not normalised & VALID_GRADE_NAMES:
        report["warnings"].append(
            "Class names do not contain GradeA/GradeB/GradeC/GradeD. The trained model "
            "will not produce application grades until class names are mapped."
        )

    pairs, problems = find_pairs(source_root)
    report["pairs_found"] = len(pairs)
    report["problems"] = [portable_text(problem) for problem in problems[:50]]
    if not pairs:
        report["errors"].append(
            "No image/label pairs found. Expected labels/**/*.txt next to images/**/*.jpg."
        )
        write_json(REPORTS_DIR / "prepare_dataset.json", report)
        print(report["errors"][0])
        return 2

    label_errors: list[str] = []
    total_boxes = 0
    for pair in pairs:
        errors, lines = validate_label(pair["label"], len(class_names))
        total_boxes += lines
        if errors:
            label_errors.extend(errors[:5])
        pair["boxes"] = lines
    report["total_boxes"] = total_boxes
    report["label_errors"] = [portable_text(error) for error in label_errors[:50]]
    if label_errors:
        report["errors"].append(
            f"{len(label_errors)} annotation problem(s) found; fix them before training."
        )
    if total_boxes < args.min_boxes:
        report["errors"].append(
            f"Only {total_boxes} boxes found (< --min-boxes {args.min_boxes}). "
            "Training would be unreliable."
        )
    if report["errors"]:
        write_json(REPORTS_DIR / "prepare_dataset.json", report)
        print("\n".join(report["errors"]))
        return 2

    # Remove exact duplicate files before splitting so the same physical image
    # cannot leak across train/val/test. Near-duplicate removal is opt-in because
    # a coarse perceptual hash can merge genuinely different nuts.
    seen_hash: dict[str, str] = {}
    seen_ahash: dict[str, str] = {}
    unique: list[dict] = []
    duplicates = 0
    for pair in pairs:
        file_hash = sha256_of(pair["image"])
        if file_hash in seen_hash:
            duplicates += 1
            continue
        a_hash = average_hash(pair["image"]) if args.near_duplicates else None
        if a_hash and a_hash in seen_ahash:
            duplicates += 1
            continue
        seen_hash[file_hash] = str(pair["image"])
        if a_hash:
            seen_ahash[a_hash] = str(pair["image"])
        pair["hash"] = file_hash
        unique.append(pair)
    report["duplicates_removed"] = duplicates
    report["near_duplicate_detection"] = bool(args.near_duplicates)

    # Deterministic split assignment, then guarantee a non-empty val split when
    # the dataset is large enough to support one.
    assignments = [split_for(pair["hash"], args.train, args.val) for pair in unique]
    if len(unique) >= 3 and "val" not in assignments:
        assignments[-1] = "val"
    if len(unique) >= 4 and "train" not in assignments:
        assignments[0] = "train"

    output = Path(args.output).expanduser().resolve()
    if output.exists():
        shutil.rmtree(output)
    (output / "images").mkdir(parents=True)
    (output / "labels").mkdir(parents=True)

    counts = {"train": 0, "val": 0, "test": 0}
    class_counts = {split: {name: 0 for name in class_names} for split in counts}
    for pair, split in zip(unique, assignments):
        image_target = output / "images" / split / pair["image"].name
        label_target = output / "labels" / split / pair["label"].name
        materialise(pair["image"], image_target)
        materialise(pair["label"], label_target)
        counts[split] += 1
        try:
            for line in pair["label"].read_text(encoding="utf-8").splitlines():
                fields = line.split()
                if fields:
                    class_counts[split][class_names[int(float(fields[0]))]] += 1
        except Exception:
            pass

    (output / "data.yaml").write_text(
        "\n".join(
            [
                "# Relative to this file so the prepared dataset stays portable.",
                "train: images/train",
                "val: images/val",
                "test: images/test",
                f"nc: {len(class_names)}",
                "names:",
                *[f"  {index}: {name}" for index, name in enumerate(class_names)],
                "",
            ]
        ),
        encoding="utf-8",
    )

    report.update(
        {
            "ready": True,
            "output_dir": display_path(output),
            "data_yaml": display_path(output / "data.yaml"),
            "splits": counts,
            "class_boxes_per_split": class_counts,
            "dedupe_method": (
                "sha256 exact + 64-bit average-hash near-duplicate"
                if args.near_duplicates
                else "sha256 exact only"
            ),
        }
    )
    write_json(REPORTS_DIR / "prepare_dataset.json", report)
    print(json.dumps({k: report[k] for k in ("ready", "output_dir", "splits", "total_boxes")}, indent=2))
    print("Wrote", REPORTS_DIR / "prepare_dataset.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
