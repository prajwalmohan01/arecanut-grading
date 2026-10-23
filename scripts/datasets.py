"""Shared helpers for the explicit dataset + training workflow.

Nothing in this module runs at application startup. It is imported only by the
manually invoked scripts in ``scripts/`` (inspect / prepare / train / evaluate).

Raw datasets stay in the KaggleHub cache. This module never copies raw images
into the application directory; only :mod:`scripts.prepare_dataset` writes small
prepared manifests/hardlinks into a configurable training cache.
"""

from __future__ import annotations

import csv
import io
import json
import os
import time
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
# Project-local, git-ignored location for a genuinely annotated YOLO dataset.
# Keeping it inside the repo folder makes the workflow portable across PCs; the
# raw images/labels themselves are never committed.
DEFAULT_DATASET_DIR = PROJECT_ROOT / "datasets" / "arecanut_grades"
REPORTS_DIR = PROJECT_ROOT / "training_reports"
TRAINING_CACHE = Path(
    os.environ.get("ARECANUT_TRAINING_CACHE", str(PROJECT_ROOT / "training_cache"))
).expanduser()


def display_path(value) -> str:
    """Return a portable path for reports: project-relative or home-relative."""
    try:
        path = Path(value).expanduser().resolve()
    except OSError:
        return str(value)
    try:
        return path.relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        pass
    try:
        return "~/" + path.relative_to(Path.home()).as_posix()
    except ValueError:
        return path.as_posix()


def portable_text(value) -> str:
    """Replace machine-specific absolute paths with portable placeholders."""
    text = str(value)
    replacements = (
        (str(PROJECT_ROOT) + os.sep, ""),
        (PROJECT_ROOT.as_posix() + "/", ""),
        (str(Path.home()) + os.sep, "~/"),
        (Path.home().as_posix() + "/", "~/"),
    )
    for source, target in replacements:
        text = text.replace(source, target)
    return text

# Registered datasets. KaggleHub resolves and caches these; we never hardcode
# the cache location.
DATASETS = {
    "duvacs_new_arecanut": {
        "id": "duvacs/new-arecanut",
        "expected": "Arecanut ripeness images (Ripenes / Unripen folders).",
    },
    "subrahmanya090_arecanut": {
        "id": "subrahmanya090/arecanut",
        "expected": "Arecanut image folders; annotation format unknown until inspected.",
    },
    "tejpaviraj_arecanut": {
        "id": "tejpaviraj/arecanut",
        "expected": "Arecanut plant/leaf disease image folders (classification).",
    },
    "alwyndsouza21092_arecanut": {
        "id": "alwyndsouza21092/arecanut",
        "expected": (
            "Detection CSV/JSON with individual-nut boxes and seven opaque "
            "classification folders (class_0 ... class_6)."
        ),
    },
    "alwyndsouza21092_arecanut_detection_1": {
        "id": "alwyndsouza21092/arecanut-detection-dataset-1",
        "expected": (
            "10,650 tray images with one VIA CSV annotation file; individual-nut "
            "boxes, single class only."
        ),
        # The full dataset is 18.3 GB. Inspecting only the annotation file is
        # enough to establish what can and cannot be trained, without filling
        # the disk with raw images.
        "annotation_path": "detection_data_1_csv (1).csv",
    },
}

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
ANNOTATION_EXTENSIONS = {".txt", ".xml", ".json", ".csv", ".yaml", ".yml"}
ARCHIVE_EXTENSIONS = {".zip", ".7z", ".rar", ".tar", ".gz", ".bz2", ".xz", ".archive"}

GRADE_PATTERNS = {
    "A": ["grade a", "gradea", "grade_a", "grade-a", "class a", "classa"],
    "B": ["grade b", "gradeb", "grade_b", "grade-b", "class b", "classb"],
    "C": ["grade c", "gradec", "grade_c", "grade-c", "class c", "classc"],
    "D": ["grade d", "graded", "grade_d", "grade-d", "class d", "classd"],
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def kagglehub_version() -> str | None:
    try:
        import kagglehub

        return getattr(kagglehub, "__version__", "unknown")
    except Exception:
        return None


def download_dataset(dataset_id: str, path: str | None = None) -> Path:
    """Resolve a dataset through KaggleHub (reusing its cache automatically).

    ``path`` downloads a single file from the dataset instead of all files.
    """
    import kagglehub

    if path:
        return Path(kagglehub.dataset_download(dataset_id, path=path))
    return Path(kagglehub.dataset_download(dataset_id))


def resolve_dataset(name: str, explicit_path: str | None = None, download: bool = True) -> dict:
    """Return ``{name, id, path, error}`` for one dataset.

    ``explicit_path`` lets an operator point at an already-downloaded copy
    without editing the script (useful offline). ``download=False`` with no
    explicit path records an error instead of touching the network.

    Datasets with an ``annotation_path`` only download that annotation file;
    inspecting the annotation is enough to decide whether training is possible
    and avoids downloading multi-gigabyte image archives.
    """
    entry = DATASETS[name]
    result = {"name": name, "id": entry["id"], "path": None, "error": None}
    if explicit_path:
        path = Path(explicit_path).expanduser().resolve()
    elif download:
        try:
            path = download_dataset(entry["id"], entry.get("annotation_path"))
        except Exception as exc:  # authentication / network / licence errors
            result["error"] = f"{type(exc).__name__}: {exc}"
            return result
    else:
        result["error"] = "Skipped (download disabled and no --dataset-path supplied)."
        return result

    if not path.exists():
        result["error"] = f"Resolved path does not exist: {path}"
        return result
    if path.is_file():
        path = path.parent
    result["path"] = str(path)
    return result


def probe_image(path: Path) -> tuple[bool, str | None, tuple[int, int] | None]:
    """Verify an image is actually decodable. Returns (ok, error, (w, h))."""
    try:
        from PIL import Image

        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            return True, None, image.size
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}", None


def read_yolo_names(path: Path) -> list[str]:
    """Best-effort extraction of a ``names`` mapping from a YOLO data.yaml."""
    names: list[str] = []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return names
    try:
        import yaml

        data = yaml.safe_load(text) or {}
        raw = data.get("names")
        if isinstance(raw, dict):
            names = [str(raw[key]) for key in sorted(raw, key=lambda value: int(value))]
        elif isinstance(raw, list):
            names = [str(value) for value in raw]
        if names:
            return names
    except Exception:
        pass
    # Fallback: parse "names: ['a', 'b']" or a block list.
    in_names = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("names:"):
            in_names = True
            remainder = stripped.split(":", 1)[1].strip()
            if remainder.startswith("["):
                names = [
                    item.strip().strip("'\"")
                    for item in remainder.strip("[]").split(",")
                    if item.strip()
                ]
                return names
            continue
        if in_names:
            if stripped.startswith("- "):
                names.append(stripped[2:].strip().strip("'\""))
            elif stripped and not stripped.startswith("#"):
                break
    return names


def _annotation_text(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _annotation_payload(path: Path) -> str | None:
    """Read a VIA CSV/JSON file, including Kaggle's ZIP-wrapped CSV files."""
    try:
        if path.stat().st_size > 128 * 1024 * 1024:
            return None
        raw = path.read_bytes()
    except OSError:
        return None
    if raw[:2] == b"PK":
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                members = [
                    name
                    for name in archive.namelist()
                    if name.lower().endswith((".csv", ".json")) and not name.endswith("/")
                ]
                if not members:
                    return None
                raw = archive.read(members[0])
        except (zipfile.BadZipFile, KeyError):
            return None
    return _annotation_text(raw)


def _via_coord(value) -> str:
    try:
        return f"{float(value):.6f}"
    except (TypeError, ValueError):
        return str(value)


def _via_class_values(attributes) -> list[str]:
    if not isinstance(attributes, dict):
        return []
    for key in ("class", "label", "grade", "type"):
        value = attributes.get(key)
        if isinstance(value, str) and value.strip():
            return [value.strip()]
        if value is not None and not isinstance(value, (dict, list)):
            return [str(value)]
    return []


def read_via_annotations(path: Path) -> dict | None:
    """Read VIA JSON or CSV annotations without assuming their class meanings.

    Returns image names, annotated image names, box counts, shape names and the
    literal class values found in the file. Returns ``None`` when the file is
    not a recognised VIA annotation file.
    """
    text = _annotation_payload(path)
    if not text:
        return None

    images: set[str] = set()
    annotated_images: set[str] = set()
    box_keys: set[tuple] = set()
    box_classes: dict[tuple, str] = {}
    classes: Counter = Counter()
    shapes: Counter = Counter()
    boxes = 0
    errors: list[str] = []
    annotation_format = None

    suffix = path.suffix.lower()
    if suffix == ".csv":
        try:
            reader = csv.DictReader(io.StringIO(text))
            fieldnames = reader.fieldnames or []
            if "filename" not in fieldnames or not (
                "region_shape_attributes" in fieldnames
                or "region_attributes" in fieldnames
            ):
                return None
            annotation_format = "VIA CSV"
            for row in reader:
                filename = (row.get("filename") or "").strip()
                if not filename:
                    continue
                images.add(filename)
                raw_shape = row.get("region_shape_attributes") or "{}"
                raw_attributes = row.get("region_attributes") or "{}"
                try:
                    shape = json.loads(raw_shape) if raw_shape else {}
                except (TypeError, ValueError):
                    shape = {}
                try:
                    attributes = json.loads(raw_attributes) if raw_attributes else {}
                except (TypeError, ValueError):
                    attributes = {}
                shape_name = str((shape or {}).get("name") or "").strip()
                if shape_name:
                    shapes[shape_name] += 1
                has_rect = shape_name.lower() == "rect" or (
                    shape and {"x", "y", "width", "height"} <= set(shape)
                )
                if has_rect:
                    boxes += 1
                    annotated_images.add(filename)
                    key = (
                        filename,
                        _via_coord(shape.get("x")),
                        _via_coord(shape.get("y")),
                        _via_coord(shape.get("width")),
                        _via_coord(shape.get("height")),
                    )
                    box_keys.add(key)
                    values = _via_class_values(attributes)
                    for value in values:
                        classes[value] += 1
                    box_classes[key] = values[0] if values else "unlabelled"
        except (csv.Error, UnicodeError) as exc:
            errors.append(f"{type(exc).__name__}: {exc}")
    elif suffix == ".json":
        try:
            data = json.loads(text)
        except (TypeError, ValueError) as exc:
            return {
                "format": "JSON (unreadable)",
                "images": set(),
                "annotated_images": set(),
                "box_keys": set(),
                "box_classes": {},
                "boxes": 0,
                "classes": Counter(),
                "shapes": Counter(),
                "errors": [f"{type(exc).__name__}: {exc}"],
            }
        if not isinstance(data, dict):
            return None
        metadata = data.get("_via_img_metadata")
        if not isinstance(metadata, dict):
            candidate = {
                key: value
                for key, value in data.items()
                if isinstance(value, dict)
                and "regions" in value
                and ("filename" in value or key.lower().endswith((".jpg", ".jpeg", ".png")))
            }
            if not candidate:
                return None
            metadata = candidate
        annotation_format = "VIA JSON"
        for key, entry in metadata.items():
            if not isinstance(entry, dict):
                continue
            filename = str(entry.get("filename") or key)
            images.add(filename)
            regions = entry.get("regions") or []
            if not isinstance(regions, list):
                continue
            for region in regions:
                if not isinstance(region, dict):
                    continue
                shape = region.get("shape_attributes") or {}
                attributes = region.get("region_attributes") or {}
                shape_name = str((shape or {}).get("name") or "").strip()
                if shape_name:
                    shapes[shape_name] += 1
                has_rect = shape_name.lower() == "rect" or (
                    shape and {"x", "y", "width", "height"} <= set(shape)
                )
                if has_rect:
                    boxes += 1
                    annotated_images.add(filename)
                    key = (
                        filename,
                        _via_coord(shape.get("x")),
                        _via_coord(shape.get("y")),
                        _via_coord(shape.get("width")),
                        _via_coord(shape.get("height")),
                    )
                    box_keys.add(key)
                    values = _via_class_values(attributes)
                    for value in values:
                        classes[value] += 1
                    box_classes[key] = values[0] if values else "unlabelled"
    else:
        return None

    if annotation_format is None:
        return None
    return {
        "format": annotation_format,
        "images": images,
        "annotated_images": annotated_images,
        "box_keys": box_keys,
        "box_classes": box_classes,
        "boxes": boxes,
        "classes": classes,
        "shapes": shapes,
        "errors": errors,
    }


def _folder_label_counts(root: Path, image_paths: list[Path]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for path in image_paths:
        try:
            relative = path.relative_to(root)
        except ValueError:
            relative = path
        label = relative.parent.name or "."
        counts[label] = counts.get(label, 0) + 1
    return dict(sorted(counts.items(), key=lambda item: -item[1]))


def stream_archive_entries(path: Path, time_budget: float = 600.0, max_entries: int = 200000) -> dict:
    """Read streamed (central-directory-less) ZIP archives entry by entry.

    KaggleHub delivered two ``.archive`` files without an end-of-central-directory
    record. ``zipfile`` cannot open those, but entry local headers are still
    readable. This reports exactly what is reachable and never pretends the
    archive is complete.
    """
    result = {
        "entries": 0,
        "extensions": {},
        "top_folders": {},
        "samples": [],
        "truncated": False,
        "error": None,
        "time_budget_exceeded": False,
    }
    try:
        from stream_unzip import stream_unzip
    except ImportError:
        result["error"] = "stream-unzip is not installed (pip install stream-unzip)."
        return result

    def chunks():
        with path.open("rb") as handle:
            while True:
                data = handle.read(1024 * 1024)
                if not data:
                    break
                yield data

    started = time.monotonic()
    try:
        for name, _size, entry_chunks in stream_unzip(chunks()):
            text = name.decode("utf-8", "replace")
            result["entries"] += 1
            if len(result["samples"]) < 10:
                result["samples"].append(text)
            parts = text.split("/")
            if len(parts) >= 2 and "." in parts[-1]:
                folder = parts[-2]
                result["top_folders"][folder] = result["top_folders"].get(folder, 0) + 1
            extension = os.path.splitext(text)[1].lower()
            result["extensions"][extension] = result["extensions"].get(extension, 0) + 1
            for _ in entry_chunks:
                pass
            if result["entries"] >= max_entries:
                break
            if time.monotonic() - started > time_budget:
                result["time_budget_exceeded"] = True
                break
    except Exception as exc:
        name = type(exc).__name__
        result["error"] = f"{name}: {exc}"
        if "Truncated" in name:
            result["truncated"] = True

    result["top_folders"] = dict(
        sorted(result["top_folders"].items(), key=lambda item: -item[1])
    )
    result["elapsed_seconds"] = round(time.monotonic() - started, 1)
    return result


def inspect_dataset(name: str, path: Path, scan_archives: bool = False) -> dict:
    """Inspect the real contents of one dataset directory. No assumptions."""
    report: dict = {
        "name": name,
        "id": DATASETS[name]["id"],
        "path": display_path(path),
        "inspected_at": utc_now(),
        "exists": path.exists(),
        "errors": [],
    }
    if not path.exists():
        report["errors"].append("Dataset path does not exist.")
        return report

    all_files: list[Path] = []
    for current, _dirs, files in os.walk(path):
        for filename in files:
            all_files.append(Path(current) / filename)

    image_paths = [p for p in all_files if p.suffix.lower() in IMAGE_EXTENSIONS]
    archive_paths = [p for p in all_files if p.suffix.lower() in ARCHIVE_EXTENSIONS]
    annotation_paths = [
        p for p in all_files if p.suffix.lower() in ANNOTATION_EXTENSIONS
    ]

    readable = 0
    corrupted: list[dict] = []
    dimensions: dict[str, int] = {}
    for image_path in image_paths:
        ok, error, size = probe_image(image_path)
        if ok:
            readable += 1
            if size:
                dimensions[f"{size[0]}x{size[1]}"] = (
                    dimensions.get(f"{size[0]}x{size[1]}", 0) + 1
                )
        elif len(corrupted) < 25:
            corrupted.append(
                {
                    "path": str(image_path.relative_to(path)),
                    "error": error,
                }
            )

    # YOLO-style detection annotations: a labels/ directory with .txt files.
    label_dirs: list[Path] = []
    detection_labels = 0
    for directory in {p.parent for p in annotation_paths if p.suffix.lower() == ".txt"}:
        if directory.name.lower() == "labels" or (directory.parent / "images").is_dir():
            label_dirs.append(directory)
            detection_labels += len(list(directory.glob("*.txt")))

    yaml_files = [p for p in annotation_paths if p.suffix.lower() in {".yaml", ".yml"}]
    yolo_names: list[str] = []
    for yaml_file in yaml_files:
        names = read_yolo_names(yaml_file)
        if names:
            yolo_names = names
            break

    # VIA JSON/CSV annotations (LabelMe-style rectangles). The alwyndsouza21092
    # datasets ship annotations this way, and the larger one wraps its CSV in a
    # ZIP even though the filename ends in .csv.
    via_files: list[str] = []
    via_images: set[str] = set()
    via_annotated_images: set[str] = set()
    via_box_keys: set[tuple] = set()
    via_box_classes: dict[tuple, str] = {}
    via_shapes: Counter = Counter()
    via_errors: list[str] = []
    for annotation_path in annotation_paths:
        if annotation_path.suffix.lower() not in {".csv", ".json"}:
            continue
        parsed = read_via_annotations(annotation_path)
        if parsed is None:
            continue
        via_files.append(str(annotation_path.relative_to(path)))
        via_images.update(parsed["images"])
        via_box_keys.update(parsed["box_keys"])
        via_box_classes.update(parsed["box_classes"])
        via_shapes.update(parsed["shapes"])
        for error in parsed["errors"]:
            via_errors.append(f"{annotation_path.name}: {error}")

    # The same boxes can appear in both a CSV and a VIA JSON export. De-duplicate
    # by image + rectangle so counts stay real rather than double-counted.
    via_annotated_images = {key[0] for key in via_box_keys}
    via_classes: Counter = Counter(via_box_classes.values())
    via_boxes = len(via_box_keys)
    annotation_class_names = list(
        dict.fromkeys(list(yolo_names) + sorted(via_classes))
    )
    folder_counts = _folder_label_counts(path, image_paths)
    lower_folders = " ".join(folder_counts).lower()

    grade_labels = {}
    for letter, patterns in GRADE_PATTERNS.items():
        grade_labels[letter] = any(pattern in lower_folders for pattern in patterns)
    if annotation_class_names:
        joined = " ".join(annotation_class_names).lower()
        for letter, patterns in GRADE_PATTERNS.items():
            grade_labels[letter] = grade_labels[letter] or any(
                pattern in joined for pattern in patterns
            )

    archive_details = []
    for archive_path in archive_paths:
        detail = {
            "path": str(archive_path.relative_to(path)),
            "size_bytes": archive_path.stat().st_size,
            "valid_zip": _zip_has_central_directory(archive_path),
        }
        if scan_archives:
            detail["streamed_contents"] = stream_archive_entries(archive_path)
        archive_details.append(detail)

    streamed_folder_counts = {}
    for detail in archive_details:
        streamed = detail.get("streamed_contents") or {}
        for folder, count in (streamed.get("top_folders") or {}).items():
            streamed_folder_counts[folder] = streamed_folder_counts.get(folder, 0) + count
    streamed_folder_counts = dict(
        sorted(streamed_folder_counts.items(), key=lambda item: -item[1])
    )

    if streamed_folder_counts:
        joined = " ".join(streamed_folder_counts).lower()
        for letter, patterns in GRADE_PATTERNS.items():
            grade_labels[letter] = grade_labels[letter] or any(
                pattern in joined for pattern in patterns
            )

    annotations_detected = bool(detection_labels) or bool(yolo_names) or via_boxes > 0
    if via_boxes:
        class_text = ", ".join(sorted(via_classes)) or "unlabelled"
        label_level = f"individual-nut (VIA boxes; classes: {class_text})"
    elif annotations_detected:
        label_level = "individual-nut (detection bounding boxes)"
    elif folder_counts or streamed_folder_counts:
        label_level = "image-level (folder/class labels)"
    else:
        label_level = "unknown"

    report.update(
        {
            "total_files": len(all_files),
            "image_files": len(image_paths),
            "readable_images": readable,
            "unreadable_images": len(image_paths) - readable,
            "corrupted_image_samples": corrupted,
            "common_dimensions": dict(
                sorted(dimensions.items(), key=lambda item: -item[1])[:10]
            ),
            "archive_files": archive_details,
            "annotation_files": len(annotation_paths),
            "annotation_extensions": sorted(
                {p.suffix.lower() for p in annotation_paths}
            ),
            "annotation_samples": [
                str(p.relative_to(path)) for p in annotation_paths[:20]
            ],
            "yolo_label_dirs": [str(p.relative_to(path)) for p in label_dirs],
            "yolo_label_count": detection_labels,
            "yolo_class_names": yolo_names,
            "via_annotation_files": via_files,
            "via_annotation_images": len(via_images),
            "via_annotated_images": len(via_annotated_images),
            "via_unannotated_images": len(via_images - via_annotated_images),
            "via_boxes": via_boxes,
            "via_class_counts": dict(
                sorted(via_classes.items(), key=lambda item: (-item[1], item[0]))
            ),
            "via_shapes": dict(via_shapes),
            "via_errors": via_errors[:25],
            "annotation_class_names": annotation_class_names,
            "folder_label_counts": folder_counts,
            "streamed_folder_counts": streamed_folder_counts,
            "label_level": label_level,
            "bounding_boxes_available": annotations_detected,
            "explicit_grade_labels": grade_labels,
            "explicit_grade_support": [
                letter for letter, present in grade_labels.items() if present
            ],
            "limitations": [],
        }
    )

    if archive_paths and not image_paths:
        scanned = any(
            (detail.get("streamed_contents") or {}).get("entries")
            for detail in archive_details
        )
        report["limitations"].append(
            "Only archive files were found; KaggleHub did not extract them. "
            + (
                "Archive entries were streamed from the local headers, but the file "
                "has no end-of-central-directory record, so it is incomplete/truncated "
                "and the reported counts are a lower bound, not the full dataset."
                if scanned
                else "Archive validity was checked but contents were not treated as images."
            )
        )
    if via_boxes and not report["explicit_grade_support"]:
        class_text = ", ".join(sorted(via_classes)) or "unlabelled"
        report["limitations"].append(
            f"VIA annotations contain {via_boxes} individual-nut box(es) with class "
            f"name(s) {class_text}, not GradeA/GradeB/GradeC/GradeD. They can train "
            "a single-class nut localizer, not the application's grade head."
        )
    opaque_folders = sorted(
        name
        for name in set(folder_counts) | set(streamed_folder_counts)
        if name.lower().startswith("class_") and name[6:].isdigit()
    )
    if opaque_folders:
        report["limitations"].append(
            "Folder labels are opaque ("
            + ", ".join(opaque_folders)
            + "). Their meanings are not documented, so they are not mapped to "
            "GradeA/GradeB/GradeC/GradeD."
        )
    if not annotations_detected:
        report["limitations"].append(
            "No YOLO/VIA/COCO/VOC bounding-box annotations were found. Object-detection "
            "training is not supported by this dataset as delivered; labels are "
            "image-level folder names only."
        )
    if corrupted:
        report["limitations"].append(
            f"{len(image_paths) - readable} image file(s) could not be decoded."
        )
    return report


def _zip_has_central_directory(path: Path) -> bool | None:
    """True/False for zip-like files, None when the format is not zip."""
    if path.suffix.lower() not in {".zip", ".archive"}:
        return None
    try:
        with path.open("rb") as handle:
            head = handle.read(4)
        if head[:2] != b"PK":
            return None
        with zipfile.ZipFile(path) as archive:
            archive.infolist()
        return True
    except zipfile.BadZipFile:
        return False
    except OSError:
        return None


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def find_yolo_dataset(roots: list[Path]) -> list[dict]:
    """Find directories that look like a usable YOLO detection dataset."""
    found = []
    for root in roots:
        if not root.exists():
            continue
        for yaml_file in root.rglob("*.yaml"):
            names = read_yolo_names(yaml_file)
            if not names:
                continue
            base = yaml_file.parent
            image_dirs = [d for d in base.rglob("images") if d.is_dir()]
            label_dirs = [d for d in base.rglob("labels") if d.is_dir()]
            txt_count = sum(len(list(d.glob("*.txt"))) for d in label_dirs)
            if image_dirs and label_dirs and txt_count:
                found.append(
                    {
                        "data_yaml": str(yaml_file),
                        "base": str(base),
                        "class_names": names,
                        "label_count": txt_count,
                    }
                )
    return found
