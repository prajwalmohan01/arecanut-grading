"""Prepare the downloaded X-ray dataset as a separate YOLO detection dataset.

    python scripts\\prepare_xray_dataset.py
    python scripts\\prepare_xray_dataset.py --include-manual
    python scripts\\prepare_xray_dataset.py --output training_cache\\xray_dataset

This command is deliberately separate from download and training.  It converts
the absolute pixel boxes in ``datasets/arecanut_xray/raw/annotations.jsonl`` to
normalised YOLO boxes, preserves the source Training/Validation split, excludes
conflicting exact duplicates, and writes:

    training_cache/xray_dataset/images/{train,val}/...
    training_cache/xray_dataset/labels/{train,val}/...
    training_cache/xray_dataset/data.yaml
    training_cache/xray_dataset/manifest.json

The classes are ``XrayGrade1``, ``XrayGrade2`` and ``XrayGrade3`` — never
GradeA..GradeD.  No labels are invented or remapped to application grades.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.datasets import display_path  # noqa: E402
from scripts.xray_dataset import (  # noqa: E402
    DEFAULT_PREPARED_DIR,
    MANUAL_DIR,
    RAW_DIR,
    REPORT_PATH,
    prepare_xray,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", default=str(RAW_DIR), help="Raw X-ray directory.")
    parser.add_argument("--output", default=str(DEFAULT_PREPARED_DIR), help="Prepared YOLO output.")
    parser.add_argument(
        "--manual",
        default=str(MANUAL_DIR),
        help="Optional manually annotated YOLO folder to merge (default: datasets\\arecanut_xray\\manual).",
    )
    parser.add_argument(
        "--no-manual",
        action="store_true",
        help="Ignore manually annotated images.",
    )
    parser.add_argument("--min-images", type=int, default=10)
    args = parser.parse_args()

    report = prepare_xray(
        raw_dir=Path(args.raw),
        output_dir=Path(args.output),
        manual_dir=Path(args.manual),
        include_manual=not args.no_manual,
        min_images=args.min_images,
        report_path=REPORT_PATH,
    )

    if not report.get("prepared"):
        print(report.get("error") or "Preparation failed.")
        for item in (report.get("invalid_annotations") or [])[:10]:
            print(
                f"  row {item.get('row_index')} {item.get('source_image')}: "
                f"{item.get('error')}"
            )
        for item in (report.get("manual_errors") or [])[:10]:
            print(f"  {item}")
        print(f"Report: {display_path(REPORT_PATH)}")
        return 2

    summary = report.get("summary") or {}
    print(json.dumps(
        {
            "ready": True,
            "classes": report.get("classes"),
            "splits": report.get("splits"),
            "prepared_images": summary.get("prepared_images"),
            "prepared_boxes": summary.get("prepared_boxes"),
            "excluded_duplicates": len(report.get("excluded") or []),
            "test_available": summary.get("test_available"),
            "data_yaml": (report.get("paths") or {}).get("data_yaml"),
        },
        indent=2,
    ))
    print(f"Report: {display_path(REPORT_PATH)}")
    print("No application-grade mapping was performed; the active model is unchanged.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
