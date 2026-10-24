"""Validate and import manually annotated X-ray images into the separate dataset.

Annotate images with any YOLO-compatible tool (LabelImg, CVAT, Label Studio) and
export the normal YOLO layout:

    <source>/data.yaml
    <source>/images/train/*.jpg
    <source>/labels/train/*.txt
    <source>/images/val/*.jpg
    <source>/labels/val/*.txt

Then import them with:

    python scripts\\import_xray_annotations.py --data .\\path\\to\\annotated_yolo

The importer copies files into ``datasets/arecanut_xray/manual`` and validates every
image and label.  It does not draw boxes, invent grades, or change source labels.
``prepare_xray_dataset.py`` merges the manual folder automatically.

Class names must be exactly XrayGrade1, XrayGrade2, XrayGrade3.  For application
Grade A/B/C/D images, use ``datasets/arecanut_grades`` instead; this importer
deliberately refuses to mix the two label systems.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.datasets import (
    display_path,
    probe_image,
    read_yolo_names,
    write_json,
)
from scripts.xray_dataset import (
    CLASS_NAMES,
    MANUAL_DIR,
    MANUAL_REPORT_PATH,
    RAW_ANNOTATIONS,
    find_image_label_pairs,
    read_jsonl,
    sha256_file,
    utc_now,
    validate_yolo_line,
)


def _unique_name(name: str, used: set[str]) -> str:
    if name not in used:
        used.add(name)
        return name
    path = Path(name)
    for index in range(1, 10000):
        candidate = f"{path.stem}_{index}{path.suffix}"
        if candidate not in used:
            used.add(candidate)
            return candidate
    raise ValueError(f"cannot make a unique filename for {name}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, help="Annotated YOLO dataset to import.")
    parser.add_argument("--manual", default=str(MANUAL_DIR), help="Manual destination folder.")
    args = parser.parse_args()

    source = Path(args.data).expanduser().resolve()
    source_root = source.parent if source.is_file() else source
    manual = Path(args.manual).expanduser().resolve()
    report = {
        "generated_at": utc_now(),
        "source": display_path(source_root),
        "manual": display_path(manual),
        "classes": CLASS_NAMES,
        "imported": {"images": 0, "boxes": 0, "splits": {}},
        "skipped": [],
        "errors": [],
        "warnings": [
            "Manual X-ray labels use XrayGrade1/2/3, not application GradeA..GradeD.",
            "No bounding boxes or grades were created or changed by this import.",
        ],
    }

    if not source_root.is_dir():
        print(f"Source dataset not found: {display_path(source_root)}")
        return 2
    yaml_path = source_root / "data.yaml"
    if not yaml_path.is_file():
        print(f"Missing data.yaml in {display_path(source_root)}")
        print("YOLO label class names are required; nothing was imported.")
        return 2
    names = read_yolo_names(yaml_path)
    if names != CLASS_NAMES:
        print(
            f"{display_path(yaml_path)} names are {names}; expected {CLASS_NAMES}.\n"
            "This importer only accepts X-ray grade labels. For ordinary photos, use "
            "datasets\\arecanut_grades and the application-grade workflow."
        )
        return 2

    pairs, problems = find_image_label_pairs(source_root)
    report["warnings"].extend(problems)
    if not pairs:
        print("No image/label pairs found under images/ and labels/.")
        return 2

    known_hashes: dict[str, str] = {}
    if RAW_ANNOTATIONS.is_file():
        try:
            for record in read_jsonl(RAW_ANNOTATIONS):
                if record.get("sha256"):
                    known_hashes[record["sha256"]] = f"raw:{record.get('source_image')}"
        except ValueError as exc:
            report["warnings"].append(f"Could not read raw annotations: {exc}")
    for existing in manual.rglob("*"):
        if existing.is_file() and existing.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}:
            known_hashes.setdefault(sha256_file(existing), f"manual:{existing.name}")

    validated: list[dict] = []
    for pair in sorted(pairs, key=lambda value: value["label"]):
        image_path = pair["image"]
        label_path = pair["label"]
        ok, image_error, size = probe_image(image_path)
        if not ok:
            report["errors"].append(f"{display_path(image_path)}: {image_error}")
            continue
        try:
            lines = label_path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError as exc:
            report["errors"].append(f"{display_path(label_path)}: {exc}")
            continue
        labels: list[tuple[int, list[float]]] = []
        label_errors = []
        for number, line in enumerate(lines, start=1):
            if not line.strip():
                continue
            try:
                labels.append(validate_yolo_line(line, len(CLASS_NAMES)))
            except ValueError as exc:
                label_errors.append(f"{display_path(label_path)}:{number} {exc}")
        if label_errors:
            report["errors"].extend(label_errors)
            continue
        if not labels:
            report["errors"].append(f"{display_path(label_path)} contains no boxes")
            continue
        digest = sha256_file(image_path)
        if digest in known_hashes:
            report["skipped"].append(
                {
                    "image": display_path(image_path),
                    "reason": f"exact duplicate of {known_hashes[digest]}",
                }
            )
            continue
        known_hashes[digest] = display_path(image_path)
        validated.append(
            {
                "image": image_path,
                "label": label_path,
                "split": pair["split"],
                "size": size,
                "sha256": digest,
                "labels": labels,
            }
        )

    if report["errors"]:
        write_json(MANUAL_REPORT_PATH, report)
        print(f"{len(report['errors'])} validation error(s); nothing was imported.")
        for error in report["errors"][:10]:
            print(f"  {error}")
        print(f"Report: {display_path(MANUAL_REPORT_PATH)}")
        return 2

    used_names = {
        split: set()
        for split in {item["split"] for item in validated}
    }
    staged: list[dict] = []
    for item in validated:
        split = item["split"]
        image_name = _unique_name(item["image"].name, used_names[split])
        image_target = manual / "images" / split / image_name
        label_target = manual / "labels" / split / (Path(image_name).stem + ".txt")
        if image_target.exists() or label_target.exists():
            report["errors"].append(f"Refusing to overwrite {display_path(image_target)}")
            continue
        staged.append(
            {
                "item": item,
                "image_target": image_target,
                "label_target": label_target,
            }
        )

    if report["errors"]:
        write_json(MANUAL_REPORT_PATH, report)
        print("Import stopped before overwriting existing files.")
        for error in report["errors"][:10]:
            print(f"  {error}")
        return 2

    split_counts: Counter = Counter()
    box_counts: Counter = Counter()
    for entry in staged:
        item = entry["item"]
        image_target = entry["image_target"]
        label_target = entry["label_target"]
        split = item["split"]
        image_target.parent.mkdir(parents=True, exist_ok=True)
        label_target.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(item["image"], image_target)
        except OSError as exc:
            report["errors"].append(f"Cannot copy {display_path(item['image'])}: {exc}")
            continue
        label_text = "\n".join(
            f"{class_id} {coords[0]:.6f} {coords[1]:.6f} {coords[2]:.6f} {coords[3]:.6f}"
            for class_id, coords in item["labels"]
        )
        label_target.write_text(label_text + "\n", encoding="utf-8")
        split_counts[split] += 1
        box_counts[split] += len(item["labels"])

    if report["errors"]:
        write_json(MANUAL_REPORT_PATH, report)
        print("Import stopped before overwriting existing files.")
        for error in report["errors"][:10]:
            print(f"  {error}")
        return 2

    manual.mkdir(parents=True, exist_ok=True)
    (manual / "data.yaml").write_text(
        "\n".join(
            [
                "# Manually annotated X-ray images. Not application GradeA..GradeD.",
                "train: images/train",
                "val: images/val",
                "test: images/test",
                f"nc: {len(CLASS_NAMES)}",
                "names:",
                *[f"  {index}: {name}" for index, name in enumerate(CLASS_NAMES)],
                "",
            ]
        ),
        encoding="utf-8",
    )
    report["imported"] = {
        "images": sum(split_counts.values()),
        "boxes": sum(box_counts.values()),
        "splits": dict(sorted(split_counts.items())),
        "boxes_per_split": dict(sorted(box_counts.items())),
    }
    report["files"] = [
        display_path(item["image"]) for item in validated
    ]
    write_json(MANUAL_REPORT_PATH, report)
    write_json(manual / "manifest.json", report)

    print(
        json.dumps(
            {
                "imported_images": report["imported"]["images"],
                "imported_boxes": report["imported"]["boxes"],
                "splits": report["imported"]["splits"],
                "skipped_duplicates": len(report["skipped"]),
                "manual_dir": display_path(manual),
            },
            indent=2,
        )
    )
    print(f"Report: {display_path(MANUAL_REPORT_PATH)}")
    print("Next: python scripts\\prepare_xray_dataset.py --include-manual")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
