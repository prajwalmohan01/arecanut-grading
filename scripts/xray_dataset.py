"""Shared helpers for the optional arecanut X-ray dataset workflow.

The dataset is deliberately kept separate from ``datasets/arecanut_grades`` and from
the application's active production checkpoint.  Nothing in this module runs at
server startup; it is imported only by the explicit download/prepare/import scripts.

Verified source facts (see ``datasets/README.md`` for the evidence and commands):

* Hugging Face ``Project-AgML/arecanut_xray_grade_detection`` has 916 images.
* Its categories are numeric strings ``"0"``, ``"1"`` and ``"2"``.
* The original Mendeley archive labels those categories ``G1``, ``G2`` and ``G3``.
* The X-ArecaNet paper describes three grades (Grade1, Grade2, Grade3) in decreasing
  quality order.  They are *not* the application's Grade A/B/C/D grades.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
from collections import Counter, defaultdict
from pathlib import Path

from scripts.datasets import (
    IMAGE_EXTENSIONS,
    PROJECT_ROOT,
    REPORTS_DIR,
    TRAINING_CACHE,
    display_path,
    probe_image,
    read_yolo_names,
    utc_now,
    write_json,
)

HF_DATASET_ID = "Project-AgML/arecanut_xray_grade_detection"
HF_DATASET_URL = (
    "https://huggingface.co/datasets/Project-AgML/arecanut_xray_grade_detection"
)
SOURCE_DATASET_URL = "https://data.mendeley.com/datasets/sk5n6xdcmm/1"
SOURCE_PAPER_URL = "https://doi.org/10.1016/j.dib.2025.111721"

XRAY_ROOT = PROJECT_ROOT / "datasets" / "arecanut_xray"
RAW_DIR = XRAY_ROOT / "raw"
RAW_IMAGES_DIR = RAW_DIR / "images"
RAW_ANNOTATIONS = RAW_DIR / "annotations.jsonl"
RAW_INFO = RAW_DIR / "dataset_info.json"
MANUAL_DIR = XRAY_ROOT / "manual"
DEFAULT_PREPARED_DIR = TRAINING_CACHE / "xray_dataset"
REPORT_PATH = REPORTS_DIR / "xray_dataset.json"
MANUAL_REPORT_PATH = REPORTS_DIR / "xray_manual_import.json"

# These names are intentionally different from GradeA..GradeD.  Existing
# train_model.py promotion checks only recognise the application's A-D names;
# an X-ray model therefore cannot silently become an application-grade model.
CLASS_NAMES = ["XrayGrade1", "XrayGrade2", "XrayGrade3"]
SOURCE_CATEGORY_TO_GRADE = {0: "Grade1", 1: "Grade2", 2: "Grade3"}
SOURCE_CATEGORY_TO_CLASS = {0: "XrayGrade1", 1: "XrayGrade2", 2: "XrayGrade3"}
APP_GRADES = ["A", "B", "C", "D"]
SOURCE_SPLITS = {
    "train": "train",
    "training": "train",
    "val": "val",
    "valid": "val",
    "validation": "val",
    "test": "test",
    "testing": "test",
}

EVIDENCE = [
    "The Hugging Face dataset card exposes categories as numeric strings 0, 1 and 2.",
    "The original Mendeley X-ArecaNet archive stores the same images in G1/G2/G3 groups.",
    "The original YOLO labels use class 0 for G1, class 1 for G2 and class 2 for G3.",
    "The X-ArecaNet paper describes three grades (Grade1, Grade2, Grade3) in decreasing quality order.",
    "Exact image SHA-256 comparison matched Hugging Face rows to the original Mendeley images.",
]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def read_jsonl(path: Path) -> list[dict]:
    records: list[dict] = []
    try:
        with path.open("r", encoding="utf-8") as handle:
            for number, line in enumerate(handle, start=1):
                line = line.strip()
                if not line:
                    continue
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError(f"line {number} is not a JSON object")
                records.append(value)
    except (OSError, ValueError) as exc:
        raise ValueError(f"Cannot read {display_path(path)}: {exc}") from exc
    return records


def write_report(report: dict, path: Path = REPORT_PATH) -> None:
    report.setdefault("generated_at", utc_now())
    write_json(path, report)


def empty_report(status: str = "not_downloaded") -> dict:
    return {
        "generated_at": utc_now(),
        "dataset_id": HF_DATASET_ID,
        "dataset_url": HF_DATASET_URL,
        "source_url": SOURCE_DATASET_URL,
        "status": status,
        "available": False,
        "downloaded": False,
        "prepared": False,
        "error": None,
        "classes": CLASS_NAMES,
        "source_grades": [
            SOURCE_CATEGORY_TO_GRADE[index] for index in sorted(SOURCE_CATEGORY_TO_GRADE)
        ],
        "semantics": {
            "mapping": {
                str(index): {
                    "source_category": str(index),
                    "source_grade": SOURCE_CATEGORY_TO_GRADE[index],
                    "yolo_class": SOURCE_CATEGORY_TO_CLASS[index],
                }
                for index in sorted(SOURCE_CATEGORY_TO_GRADE)
            },
            "application_grades": "GradeA/GradeB/GradeC/GradeD are not present in this dataset.",
            "evidence": EVIDENCE,
        },
        "grade_coverage": {grade: False for grade in APP_GRADES},
        "summary": {},
        "splits": {"train": 0, "val": 0, "test": 0},
        "class_boxes_per_split": {},
        "source_grade_counts": {},
        "duplicate_groups": [],
        "prefix_mismatches": [],
        "excluded": [],
        "invalid_annotations": [],
        "manual": {"included": False, "images": 0, "boxes": 0},
        "limitations": [],
        "paths": {},
    }


def normalise_bbox(
    box,
    width: int,
    height: int,
    tolerance: float = 0.51,
) -> tuple[list[float], list[str]]:
    """Convert absolute ``[x1, y1, x2, y2]`` pixels to YOLO centre/size.

    Returns ``(coords, warnings)`` where coords are ``cx cy w h`` in 0..1.
    Raises ``ValueError`` for malformed, reversed, zero-area or out-of-bounds
    boxes.  Tiny rounding overshoots are clamped and reported as warnings rather
    than silently rewritten.
    """
    if width <= 0 or height <= 0:
        raise ValueError("image dimensions must be positive")
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        raise ValueError("bbox must contain exactly four numbers")
    try:
        x1, y1, x2, y2 = (float(value) for value in box)
    except (TypeError, ValueError) as exc:
        raise ValueError("bbox contains a non-numeric value") from exc
    if not all(math.isfinite(value) for value in (x1, y1, x2, y2)):
        raise ValueError("bbox contains a non-finite value")
    if x2 <= x1 or y2 <= y1:
        raise ValueError("bbox has zero or negative area")

    warnings: list[str] = []
    for label, value, limit in (
        ("x_min", x1, width),
        ("x_max", x2, width),
        ("y_min", y1, height),
        ("y_max", y2, height),
    ):
        if value < -tolerance or value > limit + tolerance:
            raise ValueError(f"{label} {value:g} is outside image bounds 0..{limit}")
        if value < 0 or value > limit:
            warnings.append(f"{label} {value:g} was clamped to 0..{limit}")

    x1 = min(max(x1, 0.0), float(width))
    x2 = min(max(x2, 0.0), float(width))
    y1 = min(max(y1, 0.0), float(height))
    y2 = min(max(y2, 0.0), float(height))
    box_width = x2 - x1
    box_height = y2 - y1
    if box_width <= 0 or box_height <= 0:
        raise ValueError("bbox has zero area after clamping")

    coords = [
        ((x1 + x2) / 2.0) / width,
        ((y1 + y2) / 2.0) / height,
        box_width / width,
        box_height / height,
    ]
    if any(value < 0.0 or value > 1.0 or not math.isfinite(value) for value in coords):
        raise ValueError("normalised bbox is outside 0..1")
    if coords[2] <= 0.0 or coords[3] <= 0.0:
        raise ValueError("normalised bbox has zero area")
    return [round(value, 6) for value in coords], warnings


def validate_yolo_line(line: str, class_count: int = len(CLASS_NAMES)) -> tuple[int, list[float]]:
    """Validate one YOLO label line and return ``(class_id, coords)``."""
    fields = line.split()
    if len(fields) != 5:
        raise ValueError(f"expected 5 fields, got {len(fields)}")
    try:
        raw_class = float(fields[0])
        coords = [float(value) for value in fields[1:]]
    except ValueError as exc:
        raise ValueError("non-numeric YOLO field") from exc
    if not raw_class.is_integer():
        raise ValueError("class id is not an integer")
    class_id = int(raw_class)
    if class_id < 0 or class_id >= class_count:
        raise ValueError(f"class id {class_id} is outside 0..{class_count - 1}")
    if not all(math.isfinite(value) for value in coords):
        raise ValueError("non-finite bbox coordinate")
    if any(value < 0.0 or value > 1.0 for value in coords):
        raise ValueError("bbox is not normalised to 0..1")
    if coords[2] <= 0.0 or coords[3] <= 0.0:
        raise ValueError("zero-area bbox")
    return class_id, [round(value, 6) for value in coords]


def source_split(value) -> str | None:
    if value is None:
        return None
    return SOURCE_SPLITS.get(str(value).strip().lower())


def prefix_expected_category(filename: str | None) -> int | None:
    if not filename:
        return None
    match = re.match(r"^G([123])_", Path(filename).stem, re.IGNORECASE)
    if not match:
        return None
    return int(match.group(1)) - 1


def check_prefix_consistency(record: dict) -> list[dict]:
    expected = prefix_expected_category(record.get("source_image"))
    if expected is None:
        return []
    found = []
    for box in record.get("boxes") or []:
        try:
            category = int(box.get("category_id"))
        except (TypeError, ValueError):
            continue
        if category != expected:
            found.append(
                {
                    "row_index": record.get("row_index"),
                    "source_image": record.get("source_image"),
                    "category_id": category,
                    "prefix_expected_category": expected,
                    "source_grade": SOURCE_CATEGORY_TO_GRADE.get(category),
                    "prefix_grade": SOURCE_CATEGORY_TO_GRADE.get(expected),
                }
            )
    return found


def duplicate_groups(records: list[dict]) -> list[dict]:
    """Find exact image duplicates and classify whether their labels conflict."""
    by_hash: dict[str, list[dict]] = defaultdict(list)
    for record in records:
        digest = record.get("sha256")
        if not digest:
            continue
        by_hash[digest].append(record)

    groups: list[dict] = []
    for digest, members in by_hash.items():
        if len(members) < 2:
            continue
        signatures = {
            tuple(
                (
                    int(box.get("category_id")),
                    tuple(round(float(value), 6) for value in (box.get("bbox") or [])),
                )
                for box in (member.get("boxes") or [])
            )
            for member in members
        }
        conflict = len(signatures) > 1
        groups.append(
            {
                "sha256": digest,
                "conflict": conflict,
                "uids": [member.get("uid") for member in members],
                "rows": [member.get("row_index") for member in members],
                "source_images": [member.get("source_image") for member in members],
                "splits": [member.get("split") for member in members],
                "categories": [
                    [int(box.get("category_id")) for box in (member.get("boxes") or [])]
                    for member in members
                ],
                "action": "exclude all (conflicting annotations)" if conflict else "keep first, drop duplicate",
            }
        )
    return groups


def find_image_label_pairs(root: Path) -> tuple[list[dict], list[str]]:
    """Find YOLO image/label pairs under a manual/imported dataset tree."""
    pairs: list[dict] = []
    problems: list[str] = []
    for label_path in sorted(root.rglob("*.txt")):
        if "labels" not in [part.lower() for part in label_path.parts]:
            continue
        parts = list(label_path.parts)
        lower_parts = [part.lower() for part in parts]
        label_index = max(i for i, part in enumerate(lower_parts) if part == "labels")
        image_parts = list(parts)
        image_parts[label_index] = "images"
        candidates = []
        for extension in IMAGE_EXTENSIONS:
            candidate = Path(*image_parts).with_name(label_path.stem + extension)
            candidates.append(candidate)
            candidates.append(candidate.with_suffix(candidate.suffix.upper()))
        image_path = next((candidate for candidate in candidates if candidate.is_file()), None)
        if image_path is None:
            problems.append(f"Missing image for label: {display_path(label_path)}")
            continue
        try:
            relative = image_path.relative_to(root)
        except ValueError:
            relative = image_path
        split = next(
            (part.lower() for part in relative.parts[:-1] if part.lower() in SOURCE_SPLITS),
            "train",
        )
        pairs.append(
            {
                "image": image_path,
                "label": label_path,
                "split": SOURCE_SPLITS.get(split, "train"),
            }
        )
    return pairs, problems


def load_manual_items(manual_dir: Path, class_names: list[str]) -> tuple[list[dict], list[str], list[str]]:
    """Load already-annotated manual X-ray images; never create annotations."""
    items: list[dict] = []
    errors: list[str] = []
    warnings: list[str] = []
    if not manual_dir.exists():
        return items, errors, warnings

    yaml_path = manual_dir / "data.yaml"
    if yaml_path.is_file():
        names = read_yolo_names(yaml_path)
        if names and names != class_names:
            errors.append(
                f"{display_path(yaml_path)} names {names} do not match {class_names}. "
                "Manual X-ray labels must use the same XrayGrade1/2/3 class names."
            )
            return items, errors, warnings
    else:
        warnings.append(
            f"No data.yaml in {display_path(manual_dir)}; assuming {class_names} "
            "and validating class ids 0..2."
        )

    pairs, problems = find_image_label_pairs(manual_dir)
    warnings.extend(problems)
    for index, pair in enumerate(sorted(pairs, key=lambda value: value["label"])):
        image_path = pair["image"]
        label_path = pair["label"]
        ok, image_error, size = probe_image(image_path)
        if not ok:
            errors.append(f"{display_path(image_path)}: {image_error}")
            continue
        classes: list[int] = []
        boxes: list[list[float]] = []
        label_errors: list[str] = []
        try:
            lines = label_path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError as exc:
            errors.append(f"{display_path(label_path)}: {exc}")
            continue
        for number, line in enumerate(lines, start=1):
            if not line.strip():
                continue
            try:
                class_id, coords = validate_yolo_line(line, len(class_names))
            except ValueError as exc:
                label_errors.append(f"{display_path(label_path)}:{number} {exc}")
                continue
            classes.append(class_id)
            boxes.append(coords)
        if label_errors:
            errors.extend(label_errors)
            continue
        if not boxes:
            errors.append(f"{display_path(label_path)} contains no bounding boxes")
            continue
        items.append(
            {
                "uid": f"manual:{index}",
                "order": 1_000_000 + index,
                "source": "manual",
                "row_index": None,
                "source_image": image_path.name,
                "raw_image": display_path(image_path),
                "image_path": image_path,
                "label_path": label_path,
                "split": pair["split"],
                "width": size[0] if size else None,
                "height": size[1] if size else None,
                "sha256": sha256_file(image_path),
                "classes": classes,
                "boxes": [
                    {"category_id": class_id, "yolo": coords}
                    for class_id, coords in zip(classes, boxes)
                ],
                "source_grade": None,
            }
        )
    return items, errors, warnings


def _item_label_signature(item: dict) -> tuple:
    return tuple(
        (int(box["category_id"]), tuple(round(float(value), 6) for value in box["yolo"]))
        for box in item.get("boxes") or []
    )


def _manual_duplicate_groups(items: list[dict]) -> list[dict]:
    """Duplicate groups over prepared items (raw + manual)."""
    by_hash: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        by_hash[item["sha256"]].append(item)
    groups: list[dict] = []
    for digest, members in by_hash.items():
        if len(members) < 2:
            continue
        signatures = {_item_label_signature(member) for member in members}
        groups.append(
            {
                "sha256": digest,
                "conflict": len(signatures) > 1,
                "uids": [member["uid"] for member in members],
                "source_images": [member["source_image"] for member in members],
                "splits": [member["split"] for member in members],
                "action": (
                    "exclude all (conflicting annotations)"
                    if len(signatures) > 1
                    else "keep first, drop duplicate"
                ),
            }
        )
    return groups


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


def _materialise(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        return
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)


def prepare_xray(
    raw_dir: Path = RAW_DIR,
    output_dir: Path = DEFAULT_PREPARED_DIR,
    manual_dir: Path = MANUAL_DIR,
    include_manual: bool = True,
    min_images: int = 10,
    report_path: Path = REPORT_PATH,
) -> dict:
    """Validate raw/manual annotations and write a separate YOLO X-ray dataset."""
    raw_dir = Path(raw_dir).expanduser().resolve()
    output_dir = Path(output_dir).expanduser().resolve()
    manual_dir = Path(manual_dir).expanduser().resolve()
    info_path = raw_dir / "dataset_info.json"
    annotations_path = raw_dir / "annotations.jsonl"

    report = empty_report("preparing")
    report["paths"] = {
        "raw": display_path(raw_dir),
        "prepared": display_path(output_dir),
        "manual": display_path(manual_dir),
    }

    if not info_path.is_file() or not annotations_path.is_file():
        report.update(
            status="failed",
            available=False,
            downloaded=False,
            error=(
                f"Raw X-ray data not found under {display_path(raw_dir)}. "
                "Run: python scripts\\download_xray_dataset.py"
            ),
        )
        write_report(report, report_path)
        return report

    info = read_json(info_path) or {}
    try:
        records = read_jsonl(annotations_path)
    except ValueError as exc:
        report.update(status="failed", available=False, downloaded=True, error=str(exc))
        write_report(report, report_path)
        return report

    report["downloaded"] = True
    report["source_category_names"] = info.get("download", {}).get("category_names", {})
    report["source_downloaded_at"] = info.get("download", {}).get("downloaded_at")

    errors: list[str] = []
    invalid_annotations: list[dict] = []
    prefix_mismatches: list[dict] = []
    raw_items: list[dict] = []
    source_grade_counts: Counter = Counter()
    raw_split_counts: Counter = Counter()
    raw_boxes_total = 0

    for row_index, record in enumerate(records):
        source_image = record.get("source_image") or f"row_{row_index}"
        raw_image = record.get("raw_image")
        if not raw_image:
            errors.append(f"row {row_index} ({source_image}) has no raw_image path")
            continue
        image_path = (raw_dir / raw_image).resolve()
        if not image_path.is_file():
            errors.append(f"row {row_index} ({source_image}) image missing: {display_path(image_path)}")
            continue
        ok, image_error, size = probe_image(image_path)
        if not ok:
            errors.append(f"row {row_index} ({source_image}) is not decodable: {image_error}")
            continue
        width = int(record.get("width") or (size[0] if size else 0))
        height = int(record.get("height") or (size[1] if size else 0))
        if size and (width != size[0] or height != size[1]):
            invalid_annotations.append(
                {
                    "row_index": row_index,
                    "source_image": source_image,
                    "error": f"recorded {width}x{height} does not match decoded {size[0]}x{size[1]}",
                }
            )
            continue

        split = source_split(record.get("split"))
        if split is None:
            invalid_annotations.append(
                {
                    "row_index": row_index,
                    "source_image": source_image,
                    "error": f"unknown source split {record.get('split')!r}",
                }
            )
            continue

        raw_boxes = record.get("boxes") or []
        if not raw_boxes:
            invalid_annotations.append(
                {"row_index": row_index, "source_image": source_image, "error": "no bounding boxes"}
            )
            continue

        boxes: list[dict] = []
        row_invalid = False
        for box_index, box in enumerate(raw_boxes):
            try:
                category = int(box.get("category_id"))
            except (TypeError, ValueError):
                invalid_annotations.append(
                    {
                        "row_index": row_index,
                        "source_image": source_image,
                        "box_index": box_index,
                        "error": "category_id is not an integer",
                    }
                )
                row_invalid = True
                continue
            if category not in SOURCE_CATEGORY_TO_GRADE:
                invalid_annotations.append(
                    {
                        "row_index": row_index,
                        "source_image": source_image,
                        "box_index": box_index,
                        "error": f"category {category} is not in the verified mapping 0..2",
                    }
                )
                row_invalid = True
                continue
            try:
                coords, warnings = normalise_bbox(box.get("bbox"), width, height)
            except ValueError as exc:
                invalid_annotations.append(
                    {
                        "row_index": row_index,
                        "source_image": source_image,
                        "box_index": box_index,
                        "error": str(exc),
                    }
                )
                row_invalid = True
                continue
            for warning in warnings:
                report.setdefault("annotation_warnings", []).append(
                    f"row {row_index} box {box_index}: {warning}"
                )
            boxes.append({"category_id": category, "yolo": coords})
            source_grade_counts[SOURCE_CATEGORY_TO_GRADE[category]] += 1
        if row_invalid:
            continue

        item = {
            "uid": f"raw:{row_index}",
            "order": row_index,
            "source": "raw",
            "row_index": row_index,
            "source_image": source_image,
            "raw_image": raw_image,
            "image_path": image_path,
            "label_path": None,
            "split": split,
            "width": width,
            "height": height,
            "sha256": record.get("sha256") or sha256_file(image_path),
            "classes": [box["category_id"] for box in boxes],
            "boxes": boxes,
            "source_grade": [SOURCE_CATEGORY_TO_GRADE[box["category_id"]] for box in boxes],
        }
        raw_items.append(item)
        raw_split_counts[record.get("split")] += 1
        raw_boxes_total += len(boxes)
        prefix_mismatches.extend(check_prefix_consistency(record))

    if invalid_annotations:
        errors.append(
            f"{len(invalid_annotations)} invalid annotation problem(s) found; "
            "fix them before preparing a training dataset."
        )
    if errors:
        report.update(
            status="failed",
            available=False,
            error="Raw image validation failed; no prepared dataset was written.",
            invalid_annotations=invalid_annotations[:100],
            prefix_mismatches=prefix_mismatches,
        )
        write_report(report, report_path)
        return report

    manual_items: list[dict] = []
    manual_errors: list[str] = []
    manual_warnings: list[str] = []
    if include_manual:
        manual_items, manual_errors, manual_warnings = load_manual_items(manual_dir, CLASS_NAMES)
    if manual_errors:
        report.update(
            status="failed",
            available=False,
            error="Manual annotation validation failed; no prepared dataset was written.",
            invalid_annotations=invalid_annotations[:100],
            manual_errors=manual_errors[:100],
            prefix_mismatches=prefix_mismatches,
        )
        write_report(report, report_path)
        return report

    all_items = raw_items + manual_items
    groups = _manual_duplicate_groups(all_items)
    excluded: list[dict] = []
    excluded_uids: set[str] = set()
    for group in groups:
        members = [item for item in all_items if item["uid"] in set(group["uids"])]
        members.sort(key=lambda item: item["order"])
        if group["conflict"]:
            chosen = members
        else:
            chosen = members[1:]
        for item in chosen:
            if item["uid"] in excluded_uids:
                continue
            excluded_uids.add(item["uid"])
            excluded.append(
                {
                    "uid": item["uid"],
                    "source": item["source"],
                    "row_index": item["row_index"],
                    "source_image": item["source_image"],
                    "reason": (
                        "conflicting duplicate image (different annotations)"
                        if group["conflict"]
                        else "exact duplicate image (identical annotations)"
                    ),
                    "duplicate_sha256": group["sha256"],
                }
            )

    used = [item for item in all_items if item["uid"] not in excluded_uids]
    if len(used) < min_images:
        report.update(
            status="failed",
            available=False,
            error=f"Only {len(used)} usable images remain (< --min-images {min_images}).",
            duplicate_groups=groups,
            excluded=excluded,
            prefix_mismatches=prefix_mismatches,
            invalid_annotations=invalid_annotations[:100],
        )
        write_report(report, report_path)
        return report

    split_counts = {"train": 0, "val": 0, "test": 0}
    class_boxes_per_split = {
        split: {name: 0 for name in CLASS_NAMES} for split in split_counts
    }
    for item in used:
        split_counts[item["split"]] += 1
        for box in item["boxes"]:
            class_boxes_per_split[item["split"]][CLASS_NAMES[box["category_id"]]] += 1

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    used_names: dict[str, set[str]] = defaultdict(set)
    for item in used:
        split = item["split"]
        image_name = _unique_name(Path(item["source_image"]).name, used_names[split])
        image_target = output_dir / "images" / split / image_name
        label_target = output_dir / "labels" / split / (Path(image_name).stem + ".txt")
        _materialise(item["image_path"], image_target)
        label_text = "\n".join(
            f"{box['category_id']} {box['yolo'][0]:.6f} {box['yolo'][1]:.6f} "
            f"{box['yolo'][2]:.6f} {box['yolo'][3]:.6f}"
            for box in item["boxes"]
        )
        label_target.parent.mkdir(parents=True, exist_ok=True)
        label_target.write_text(label_text + "\n", encoding="utf-8")

    yaml_lines = [
        "# Separate X-ray quality-grade dataset. NOT application GradeA..GradeD.",
        "# Source categories 0/1/2 map to XrayGrade1/2/3 (verified; see datasets/README.md).",
        "train: images/train",
        "val: images/val",
    ]
    if split_counts["test"] > 0:
        yaml_lines.append("test: images/test")
    yaml_lines.extend(
        [
            f"nc: {len(CLASS_NAMES)}",
            "names:",
            *[f"  {index}: {name}" for index, name in enumerate(CLASS_NAMES)],
            "",
        ]
    )
    (output_dir / "data.yaml").write_text("\n".join(yaml_lines), encoding="utf-8")

    report.update(
        {
            "status": "prepared",
            "available": True,
            "downloaded": True,
            "prepared": True,
            "error": None,
            "splits": split_counts,
            "class_boxes_per_split": class_boxes_per_split,
            "source_grade_counts": dict(sorted(source_grade_counts.items())),
            "source_split_counts": dict(sorted(raw_split_counts.items())),
            "summary": {
                "raw_images": len(records),
                "raw_boxes": raw_boxes_total,
                "manual_images": len(manual_items),
                "prepared_images": len(used),
                "prepared_boxes": sum(len(item["boxes"]) for item in used),
                "test_available": split_counts["test"] > 0,
            },
            "duplicate_groups": groups,
            "prefix_mismatches": prefix_mismatches,
            "excluded": excluded,
            "invalid_annotations": invalid_annotations[:100],
            "manual": {
                "included": bool(manual_items),
                "images": len(manual_items),
                "boxes": sum(len(item["boxes"]) for item in manual_items),
                "warnings": manual_warnings[:50],
            },
            "paths": {
                "raw": display_path(raw_dir),
                "raw_annotations": display_path(annotations_path),
                "prepared": display_path(output_dir),
                "data_yaml": display_path(output_dir / "data.yaml"),
                "manual": display_path(manual_dir),
            },
            "limitations": [
                "This dataset contains XrayGrade1/XrayGrade2/XrayGrade3, not GradeA/GradeB/GradeC/GradeD.",
                "It contains individual X-ray images, not ordinary tray photographs; do not mix it with the app photo dataset.",
                "The source provides Training and Validation only. Test is 0 unless separately annotated manual test images are imported.",
                "The active ml_service/weights/best.pt is unchanged and cannot be evaluated on these classes.",
            ],
        }
    )
    if prefix_mismatches:
        report["limitations"].append(
            f"{len(prefix_mismatches)} source filename/category mismatch(es) were preserved and reported, not silently corrected."
        )
    if groups:
        report["limitations"].append(
            f"{len(groups)} exact duplicate image group(s) were found; conflicting groups were excluded from training."
        )
    write_report(report, report_path)
    return report
