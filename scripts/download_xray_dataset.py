"""Explicitly download the optional X-ray grade dataset from Hugging Face.

    python scripts\\download_xray_dataset.py
    python scripts\\download_xray_dataset.py --check
    python scripts\\download_xray_dataset.py --force

The script stores a reusable project-local raw copy under
``datasets/arecanut_xray/raw``.  It never downloads at server startup, never
modifies ``ml_service/weights/best.pt``, and does not convert or train anything.

Hugging Face is used through the ``datasets`` library.  ``HF_HOME`` is pointed at
the project-local cache before importing ``datasets`` so a second run does not
depend on the machine's global Hugging Face cache.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.datasets import (  # noqa: E402
    IMAGE_EXTENSIONS,
    display_path,
    utc_now,
)
from scripts.xray_dataset import (  # noqa: E402
    HF_DATASET_ID,
    HF_DATASET_URL,
    RAW_ANNOTATIONS,
    RAW_DIR,
    RAW_IMAGES_DIR,
    RAW_INFO,
    REPORT_PATH,
    SOURCE_CATEGORY_TO_CLASS,
    SOURCE_CATEGORY_TO_GRADE,
    SOURCE_DATASET_URL,
    check_prefix_consistency,
    duplicate_groups,
    empty_report,
    read_json,
    read_jsonl,
    sha256_bytes,
    source_split,
    write_report,
)


def _category_names(dataset) -> dict[str, str]:
    try:
        feature = dataset.features["objects"]["categories"]
        feature = getattr(feature, "feature", feature)
        names = getattr(feature, "names", None)
        if names:
            if isinstance(names, dict):
                return {str(key): str(value) for key, value in names.items()}
            return {str(index): str(value) for index, value in enumerate(names)}
    except (AttributeError, KeyError, TypeError):
        pass
    return {"0": "0", "1": "1", "2": "2"}


def _safe_name(source_path: str | None, row_index: int, image_format: str | None) -> str:
    suffix = Path(str(source_path or "")).suffix.lower()
    if suffix not in IMAGE_EXTENSIONS:
        suffix = "." + (image_format or "jpg").lower().replace("jpeg", "jpg")
    stem = Path(str(source_path or f"row_{row_index}")).stem
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._-") or f"row_{row_index}"
    return f"{stem}{suffix}"


def raw_is_complete() -> tuple[bool, str]:
    if not RAW_INFO.is_file():
        return False, f"missing {display_path(RAW_INFO)}"
    if not RAW_ANNOTATIONS.is_file():
        return False, f"missing {display_path(RAW_ANNOTATIONS)}"
    if not RAW_IMAGES_DIR.is_dir():
        return False, f"missing {display_path(RAW_IMAGES_DIR)}"
    info = read_json(RAW_INFO)
    if not isinstance(info, dict):
        return False, "dataset_info.json is not valid JSON"
    rows = info.get("download", {}).get("rows")
    if not isinstance(rows, int) or rows <= 0:
        return False, "dataset_info.json has no positive row count"
    try:
        records = read_jsonl(RAW_ANNOTATIONS)
    except ValueError as exc:
        return False, str(exc)
    if len(records) != rows:
        return False, f"annotations contain {len(records)} rows, expected {rows}"
    missing = []
    for record in records:
        raw_image = record.get("raw_image")
        if not raw_image or not (RAW_DIR / raw_image).is_file():
            missing.append(raw_image or "<missing path>")
    if missing:
        return False, f"{len(missing)} image(s) missing (first: {missing[0]})"
    image_count = sum(
        1
        for path in RAW_IMAGES_DIR.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )
    if image_count != rows:
        return False, f"images directory has {image_count} image(s), expected {rows}"
    return True, f"{rows} rows, {image_count} images"


def _report_from_info(info: dict, reason: str | None = None) -> dict:
    download = info.get("download", {}) if isinstance(info, dict) else {}
    report = empty_report("downloaded")
    report.update(
        {
            "available": True,
            "downloaded": True,
            "prepared": False,
            "error": reason,
            "source_category_names": download.get("category_names", {}),
            "source_downloaded_at": download.get("downloaded_at"),
            "summary": {
                "raw_images": download.get("rows", 0),
                "raw_boxes": download.get("boxes", 0),
                "unique_images": download.get("unique_images", 0),
                "duplicate_rows": download.get("duplicate_rows", 0),
                "category_counts": download.get("category_counts", {}),
            },
            "splits": download.get(
                "normalised_splits", {"train": 0, "val": 0, "test": 0}
            ),
            "source_grade_counts": download.get("grade_counts", {}),
            "source_split_counts": download.get("splits", {}),
            "duplicate_groups": download.get("duplicate_groups", []),
            "prefix_mismatches": download.get("prefix_mismatches", []),
            "paths": {
                "raw": display_path(RAW_DIR),
                "raw_images": display_path(RAW_IMAGES_DIR),
                "annotations": display_path(RAW_ANNOTATIONS),
                "dataset_info": display_path(RAW_INFO),
                "hf_home": display_path(RAW_DIR / "hf_home"),
            },
            "limitations": [
                "The raw copy has not been converted to YOLO format yet. Run prepare_xray_dataset.py.",
                "The dataset contains XrayGrade1/XrayGrade2/XrayGrade3, not application GradeA/GradeB/GradeC/GradeD.",
                "It is an X-ray image dataset, not ordinary tray photographs; keep it separate from app training data.",
            ],
        }
    )
    return report


def _peak_memory_note() -> str:
    return "Images are written byte-for-byte; no resizing or re-encoding is performed."


def download(force: bool = False) -> int:
    if not force:
        ok, detail = raw_is_complete()
        if ok:
            info = read_json(RAW_INFO) or {}
            report = _report_from_info(info)
            write_report(report, REPORT_PATH)
            print(f"Raw X-ray dataset already present: {detail}")
            print(f"Location: {display_path(RAW_DIR)}")
            print("Use --force to download a fresh copy.")
            print("Next: python scripts\\prepare_xray_dataset.py")
            return 0
        print(f"Existing raw copy is incomplete ({detail}); downloading.")

    # Configure the Hugging Face cache before importing datasets.  This keeps
    # both the hub snapshot and the Arrow cache inside the project.
    os.environ["HF_HOME"] = str(RAW_DIR / "hf_home")
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

    try:
        from datasets import Image as HFImage
        from datasets import load_dataset
    except ImportError:
        print(
            "The optional 'datasets' package is not installed.\n"
            "Install the explicit X-ray workflow dependencies with:\n"
            "  python -m pip install -r scripts\\requirements-xray.txt"
        )
        return 2

    try:
        from PIL import Image
    except ImportError:
        print("Pillow is required to validate the downloaded images.")
        return 2

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    staging_images = RAW_DIR / "images.staging"
    staging_annotations = RAW_DIR / "annotations.staging.jsonl"
    if staging_images.exists():
        shutil.rmtree(staging_images)
    if staging_annotations.exists():
        staging_annotations.unlink()
    staging_images.mkdir(parents=True)

    print(f"Downloading {HF_DATASET_ID} through Hugging Face datasets...")
    try:
        dataset = load_dataset(
            HF_DATASET_ID,
            split="train",
            cache_dir=str(RAW_DIR / "hf_cache"),
        )
        raw_dataset = dataset.cast_column("image", HFImage(decode=False))
    except Exception as exc:
        report = empty_report("failed")
        report.update(
            status="failed",
            error=f"{type(exc).__name__}: {exc}",
            available=False,
            downloaded=False,
        )
        write_report(report, REPORT_PATH)
        print(f"Download failed: {type(exc).__name__}: {exc}")
        print("No raw data was replaced. Check the network/disk and try again.")
        return 2

    category_names = _category_names(dataset)
    total = len(raw_dataset)
    records: list[dict] = []
    used_names: Counter = Counter()
    image_hashes: list[str] = []
    categories: Counter = Counter()
    grade_counts: Counter = Counter()
    split_counts: Counter = Counter()
    normalised_splits: Counter = Counter()
    formats: Counter = Counter()
    dimensions: Counter = Counter()
    prefix_mismatches: list[dict] = []
    errors: list[str] = []
    total_bytes = 0

    print(f"Exporting {total} images to {display_path(RAW_DIR)}")
    for row_index in range(total):
        row = raw_dataset[row_index]
        image_payload = row.get("image")
        source_path = None
        payload = None
        if isinstance(image_payload, dict):
            source_path = image_payload.get("path")
            payload = image_payload.get("bytes")
        else:
            source_path = getattr(image_payload, "filename", None)
            payload = getattr(image_payload, "bytes", None)
        if not payload and source_path:
            candidate = Path(str(source_path))
            if candidate.is_file():
                payload = candidate.read_bytes()
        if not payload:
            errors.append(f"row {row_index}: Hugging Face returned no image bytes")
            continue

        try:
            with Image.open(io.BytesIO(payload)) as image:
                image.load()
                width, height = image.size
                image_format = image.format
                mode = image.mode
        except Exception as exc:
            errors.append(f"row {row_index}: undecodable image ({type(exc).__name__}: {exc})")
            continue

        base_name = _safe_name(source_path, row_index, image_format)
        used_names[base_name] += 1
        if used_names[base_name] > 1:
            path = Path(base_name)
            base_name = f"{path.stem}_{row_index}{path.suffix}"
        target = staging_images / base_name
        target.write_bytes(payload)
        digest = sha256_bytes(payload)
        image_hashes.append(digest)
        total_bytes += len(payload)

        objects = row.get("objects") or {}
        boxes = objects.get("bbox") or []
        box_categories = objects.get("categories") or []
        if len(boxes) != len(box_categories):
            errors.append(
                f"row {row_index}: {len(boxes)} boxes but {len(box_categories)} categories"
            )
            continue

        record_boxes = []
        for box, category in zip(boxes, box_categories):
            try:
                category_id = int(category)
            except (TypeError, ValueError):
                errors.append(f"row {row_index}: non-integer category {category!r}")
                continue
            if category_id not in SOURCE_CATEGORY_TO_GRADE:
                errors.append(f"row {row_index}: category {category_id} is outside 0..2")
                continue
            record_boxes.append(
                {
                    "bbox": [round(float(value), 6) for value in box],
                    "category_id": category_id,
                    "source_category_name": category_names.get(str(category_id), str(category_id)),
                    "source_grade": SOURCE_CATEGORY_TO_GRADE[category_id],
                    "yolo_class": SOURCE_CATEGORY_TO_CLASS[category_id],
                }
            )
            categories[str(category_id)] += 1
            grade_counts[SOURCE_CATEGORY_TO_GRADE[category_id]] += 1

        raw_split = row.get("split")
        normalised = source_split(raw_split)
        if normalised is None:
            errors.append(f"row {row_index}: unknown source split {raw_split!r}")
            continue

        record = {
            "row_index": row_index,
            "source_image": Path(str(source_path or base_name)).name,
            "raw_image": f"images/{base_name}",
            "hf_image_path": source_path,
            "sha256": digest,
            "size_bytes": len(payload),
            "width": width,
            "height": height,
            "mode": mode,
            "format": image_format,
            "split": raw_split,
            "normalised_split": normalised,
            "boxes": record_boxes,
        }
        records.append(record)
        split_counts[str(raw_split)] += 1
        normalised_splits[normalised] += 1
        formats[str(image_format)] += 1
        dimensions[f"{width}x{height}"] += 1
        prefix_mismatches.extend(check_prefix_consistency(record))

        if (row_index + 1) % 25 == 0 or row_index + 1 == total:
            print(f"  exported {row_index + 1}/{total}")

    if errors:
        report = empty_report("failed")
        report.update(
            status="failed",
            error="Download validation failed; no raw copy was replaced.",
            available=False,
            downloaded=False,
            invalid_annotations=errors[:100],
        )
        write_report(report, REPORT_PATH)
        print("\n".join(errors[:10]))
        print("No raw data was replaced.")
        return 2

    duplicate_groups_list = duplicate_groups(records)
    unique_hashes = len(set(image_hashes))
    duplicate_rows = len(image_hashes) - unique_hashes
    downloaded_at = utc_now()
    info = {
        "dataset": {
            "id": HF_DATASET_ID,
            "url": HF_DATASET_URL,
            "source_url": SOURCE_DATASET_URL,
            "downloaded_at": downloaded_at,
            "library": "datasets",
            "note": "Raw copy is local and git-ignored; no training was run.",
        },
        "verified_semantics": {
            "source_category_names": category_names,
            "mapping": {
                str(index): {
                    "source_category": str(index),
                    "source_grade": SOURCE_CATEGORY_TO_GRADE[index],
                    "yolo_class": SOURCE_CATEGORY_TO_CLASS[index],
                }
                for index in sorted(SOURCE_CATEGORY_TO_GRADE)
            },
            "application_grades": "No GradeA/GradeB/GradeC/GradeD labels are present.",
            "evidence": [
                "Original Mendeley archive groups the same images as G1/G2/G3.",
                "Original YOLO labels encode G1/G2/G3 as 0/1/2.",
                "The X-ArecaNet paper describes three grades in decreasing quality order.",
                "Image SHA-256 values match the original Mendeley images.",
            ],
        },
        "download": {
            "rows": len(records),
            "boxes": sum(len(record["boxes"]) for record in records),
            "image_bytes": total_bytes,
            "unique_images": unique_hashes,
            "duplicate_rows": duplicate_rows,
            "category_names": category_names,
            "category_counts": dict(sorted(categories.items())),
            "grade_counts": dict(sorted(grade_counts.items())),
            "splits": dict(sorted(split_counts.items())),
            "normalised_splits": {
                "train": normalised_splits.get("train", 0),
                "val": normalised_splits.get("val", 0),
                "test": normalised_splits.get("test", 0),
            },
            "formats": dict(sorted(formats.items())),
            "dimensions": dict(sorted(dimensions.items(), key=lambda item: -item[1])[:20]),
            "duplicate_groups": duplicate_groups_list,
            "prefix_mismatches": prefix_mismatches,
            "downloaded_at": downloaded_at,
        },
        "files": {
            "images": "images/",
            "annotations": "annotations.jsonl",
            "hf_home": "hf_home/",
            "hf_cache": "hf_cache/",
        },
    }

    # Replace only after the complete new copy has been validated.
    if RAW_IMAGES_DIR.exists():
        shutil.rmtree(RAW_IMAGES_DIR)
    staging_images.rename(RAW_IMAGES_DIR)
    if staging_annotations.exists():
        staging_annotations.unlink()
    with staging_annotations.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    if RAW_ANNOTATIONS.exists():
        RAW_ANNOTATIONS.unlink()
    staging_annotations.rename(RAW_ANNOTATIONS)
    RAW_INFO.write_text(json.dumps(info, indent=2), encoding="utf-8")

    report = _report_from_info(info)
    report["summary"]["download_bytes"] = total_bytes
    report["summary"]["formats"] = info["download"]["formats"]
    report["summary"]["dimensions"] = info["download"]["dimensions"]
    write_report(report, REPORT_PATH)

    print(f"Wrote raw images: {display_path(RAW_IMAGES_DIR)}")
    print(f"Wrote annotations: {display_path(RAW_ANNOTATIONS)}")
    print(f"Wrote dataset info: {display_path(RAW_INFO)}")
    print(
        f"Rows: {len(records)} | boxes: {info['download']['boxes']} | "
        f"unique images: {unique_hashes} | duplicate rows: {duplicate_rows}"
    )
    print(
        "Source splits: "
        + ", ".join(f"{key}={value}" for key, value in sorted(split_counts.items()))
    )
    print(_peak_memory_note())
    print("Next: python scripts\\prepare_xray_dataset.py")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate the existing raw copy without downloading.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Download and replace the raw copy even when it already exists.",
    )
    args = parser.parse_args()

    if args.check:
        ok, detail = raw_is_complete()
        if ok:
            info = read_json(RAW_INFO) or {}
            report = _report_from_info(info)
            write_report(report, REPORT_PATH)
            print(f"Raw X-ray dataset is complete: {detail}")
            print(f"Location: {display_path(RAW_DIR)}")
            return 0
        print(f"Raw X-ray dataset is incomplete: {detail}")
        print("Run: python scripts\\download_xray_dataset.py")
        return 2

    return download(force=args.force)


if __name__ == "__main__":
    raise SystemExit(main())
