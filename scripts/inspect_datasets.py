"""Inspect the three required Kaggle datasets and write a real report.

Manual use only:

    python scripts/inspect_datasets.py
    python scripts/inspect_datasets.py --no-download --dataset-path duvacs_new_arecanut="C:\\cache\\duvacs"
    python scripts/inspect_datasets.py --no-download --dataset-path tejpaviraj_arecanut="C:\\cache\\tejpaviraj"

Raw datasets stay in the KaggleHub cache. Only the JSON/Markdown report is
written into the project (``training_reports/``).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.datasets import (  # noqa: E402
    DATASETS,
    REPORTS_DIR,
    download_dataset,
    inspect_dataset,
    kagglehub_version,
    utc_now,
    write_json,
)


def parse_dataset_paths(values):
    mapping = {}
    for value in values or []:
        if "=" not in value:
            raise SystemExit(
                f"--dataset-path expects name=path, got: {value!r}. "
                f"Names: {', '.join(DATASETS)}"
            )
        name, raw_path = value.split("=", 1)
        if name not in DATASETS:
            raise SystemExit(f"Unknown dataset name {name!r}. Names: {', '.join(DATASETS)}")
        mapping[name] = raw_path
    return mapping


def markdown_summary(report) -> str:
    lines = [
        "# Dataset inspection report",
        "",
        f"Generated: {report['generated_at']}",
        f"KaggleHub: {report.get('kagglehub_version') or 'unavailable'}",
        "",
        "## Summary",
        "",
        "| Dataset | Images | Readable | Annotations | Label level | A/B/C/D labels | Bounding boxes |",
        "| --- | ---: | ---: | --- | --- | --- | --- |",
    ]
    for item in report["datasets"]:
        if item.get("error") and not item.get("image_files"):
            lines.append(
                f"| {item['id']} | — | — | — | — | — | — |"
            )
            continue
        grade_labels = ", ".join(item.get("explicit_grade_support") or []) or "none"
        images = item.get("image_files", 0)
        if not images:
            streamed = sum(
                (archive.get("streamed_contents") or {}).get("entries", 0)
                for archive in item.get("archive_files") or []
            )
            images = f"{streamed} (archive, lower bound)" if streamed else 0
        lines.append(
            "| {id} | {images} | {readable} | {annotations} | {level} | {grades} | {boxes} |".format(
                id=item["id"],
                images=images,
                readable=item.get("readable_images", 0),
                annotations=item.get("annotation_files", 0),
                level=item.get("label_level", "unknown"),
                grades=grade_labels,
                boxes="yes" if item.get("bounding_boxes_available") else "no",
            )
        )

    lines += ["", "## Per-dataset details", ""]
    for item in report["datasets"]:
        lines.append(f"### {item['id']}")
        lines.append("")
        if item.get("error"):
            lines.append(f"- Access problem: `{item['error']}`")
        if item.get("path"):
            lines.append(f"- Resolved path: `{item['path']}`")
        lines.append(f"- Total files: {item.get('total_files', 0)}")
        lines.append(f"- Image files: {item.get('image_files', 0)}")
        lines.append(f"- Readable images: {item.get('readable_images', 0)}")
        lines.append(f"- Unreadable images: {item.get('unreadable_images', 0)}")
        lines.append(f"- Annotation files: {item.get('annotation_files', 0)}")
        lines.append(f"- Annotation formats: {', '.join(item.get('annotation_extensions') or []) or 'none'}")
        lines.append(f"- Label level: {item.get('label_level', 'unknown')}")
        lines.append(f"- Explicit grade labels found: {', '.join(item.get('explicit_grade_support') or []) or 'none'}")
        folders = item.get("folder_label_counts") or item.get("streamed_folder_counts") or {}
        if folders:
            top = ", ".join(f"{name} ({count})" for name, count in list(folders.items())[:12])
            lines.append(f"- Top folders: {top}")
        for archive in item.get("archive_files") or []:
            streamed = archive.get("streamed_contents") or {}
            if streamed.get("entries"):
                lines.append(
                    f"- Archive `{archive['path']}`: {streamed['entries']} entries streamed "
                    f"(truncated={streamed.get('truncated')}); lower-bound counts only."
                )
        for note in item.get("limitations") or []:
            lines.append(f"- Limitation: {note}")
        lines.append("")

    lines += [
        "## Grade C/D conclusion",
        "",
        report["grade_cd_conclusion"],
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dataset-path",
        action="append",
        default=[],
        metavar="NAME=PATH",
        help="Use an already-downloaded copy instead of KaggleHub for one dataset.",
    )
    parser.add_argument(
        "--no-download",
        action="store_true",
        help="Never contact KaggleHub; requires --dataset-path for each dataset.",
    )
    parser.add_argument(
        "--scan-archives",
        action="store_true",
        help="Stream entry names out of truncated .archive files (slow, lower-bound counts).",
    )
    parser.add_argument(
        "--output",
        default=str(REPORTS_DIR / "dataset_inspection.json"),
        help="JSON report path.",
    )
    args = parser.parse_args()

    explicit = parse_dataset_paths(args.dataset_path)
    report = {
        "generated_at": utc_now(),
        "kagglehub_version": kagglehub_version(),
        "datasets_requested": {name: entry["id"] for name, entry in DATASETS.items()},
        "datasets": [],
    }

    for name, entry in DATASETS.items():
        print(f"Inspecting {entry['id']} ...", flush=True)
        resolved = {"path": None, "error": None}
        if name in explicit:
            resolved["path"] = str(Path(explicit[name]).expanduser().resolve())
        elif args.no_download:
            resolved["error"] = "Skipped (--no-download and no --dataset-path)."
        else:
            try:
                resolved["path"] = str(download_dataset(entry["id"]))
            except Exception as exc:
                resolved["error"] = f"{type(exc).__name__}: {exc}"

        if resolved.get("error"):
            report["datasets"].append(
                {
                    "name": name,
                    "id": entry["id"],
                    "path": resolved.get("path"),
                    "error": resolved["error"],
                }
            )
            print(f"  ERROR: {resolved['error']}", flush=True)
            continue

        try:
            item = inspect_dataset(name, Path(resolved["path"]), scan_archives=args.scan_archives)
        except Exception as exc:
            item = {
                "name": name,
                "id": entry["id"],
                "path": resolved["path"],
                "error": f"{type(exc).__name__}: {exc}",
            }
        item["expected_content"] = entry["expected"]
        report["datasets"].append(item)
        if item.get("error"):
            print(f"  ERROR: {item['error']}", flush=True)
        else:
            print(
                f"  {item.get('image_files', 0)} image files, "
                f"{item.get('readable_images', 0)} readable, "
                f"{item.get('annotation_files', 0)} annotation files, "
                f"labels={item.get('label_level')}",
                flush=True,
            )

    c_or_d = []
    boxes = []
    for item in report["datasets"]:
        if item.get("error") and not item.get("image_files"):
            continue
        if set(item.get("explicit_grade_support") or []) & {"C", "D"}:
            c_or_d.append(item["id"])
        if item.get("bounding_boxes_available"):
            boxes.append(item["id"])

    if c_or_d and boxes:
        report["grade_cd_conclusion"] = (
            "Grade C/D labels and bounding boxes were found in: "
            + ", ".join(sorted(set(c_or_d) & set(boxes)))
            + ". Run scripts/prepare_dataset.py and scripts/train_model.py."
        )
    else:
        report["grade_cd_conclusion"] = (
            "No inspected dataset provides both explicit Grade C/D labels and "
            "individual-nut bounding boxes. The delivered datasets are image-level "
            "classifications (ripeness and plant-disease folders) with no nut-level "
            "grade annotations. Grade C/D cannot be trained from these files without "
            "fabricating labels. The current GradeA/GradeB detector is preserved. "
            "To enable C/D, annotate individual nuts with YOLO boxes labelled "
            "GradeA/GradeB/GradeC/GradeD, point scripts/prepare_dataset.py at that "
            "dataset, then run scripts/train_model.py and scripts/evaluate_model.py."
        )

    output = Path(args.output)
    write_json(output, report)
    markdown_path = output.with_suffix(".md")
    markdown_path.write_text(markdown_summary(report), encoding="utf-8")
    print("")
    print(f"Wrote {output}")
    print(f"Wrote {markdown_path}")
    print("")
    print(report["grade_cd_conclusion"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
