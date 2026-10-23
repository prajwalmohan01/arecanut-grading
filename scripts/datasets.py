"""Shared helpers for the explicit dataset + training workflow.

Nothing in this module runs at application startup. It is imported only by the
manually invoked scripts in ``scripts/`` (inspect / prepare / train / evaluate).

Raw datasets stay in the KaggleHub cache. This module never copies raw images
into the application directory; only :mod:`scripts.prepare_dataset` writes small
prepared manifests/hardlinks into a configurable training cache.
"""

from __future__ import annotations

import json
import os
import time
import zipfile
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

# The three datasets required by the project brief. KaggleHub resolves and
# caches these; we never hardcode the cache location.
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


def download_dataset(dataset_id: str) -> Path:
    """Resolve a dataset through KaggleHub (reusing its cache automatically)."""
    import kagglehub

    return Path(kagglehub.dataset_download(dataset_id))


def resolve_dataset(name: str, explicit_path: str | None = None, download: bool = True) -> dict:
    """Return ``{name, id, path, error}`` for one dataset.

    ``explicit_path`` lets an operator point at an already-downloaded copy
    without editing the script (useful offline). ``download=False`` with no
    explicit path records an error instead of touching the network.
    """
    entry = DATASETS[name]
    result = {"name": name, "id": entry["id"], "path": None, "error": None}
    if explicit_path:
        path = Path(explicit_path).expanduser().resolve()
    elif download:
        try:
            path = download_dataset(entry["id"])
        except Exception as exc:  # authentication / network / licence errors
            result["error"] = f"{type(exc).__name__}: {exc}"
            return result
    else:
        result["error"] = "Skipped (download disabled and no --dataset-path supplied)."
        return result

    if not path.exists():
        result["error"] = f"Resolved path does not exist: {path}"
        return result
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

    folder_counts = _folder_label_counts(path, image_paths)
    lower_folders = " ".join(folder_counts).lower()

    grade_labels = {}
    for letter, patterns in GRADE_PATTERNS.items():
        grade_labels[letter] = any(pattern in lower_folders for pattern in patterns)
    if yolo_names:
        joined = " ".join(yolo_names).lower()
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

    annotations_detected = bool(detection_labels) or bool(yolo_names)
    if annotations_detected:
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
    if not annotations_detected:
        report["limitations"].append(
            "No YOLO/COCO/VOC bounding-box annotations were found. Object-detection "
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
