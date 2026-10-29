"""
Shared inference pipeline for the Arecanut Quality Grading System.

The trained YOLOv8 detector in ``weights/best.pt`` is the single source of truth.
This module never trains, mutates, or re-initialises the model. It is imported by
both the Flask microservice (``predict.py``) and the local CLI
(``standalone_predict.py``) so there is exactly one inference implementation.

Verified model facts (see model_metadata.json):
    task          : detect
    classes       : GradeA (index 0), GradeB (index 1) for the bundled model
    default imgsz : 640 (runtime override via MODEL_IMGSZ)
    input colour  : BGR (OpenCV), converted internally by Ultralytics

Grade support is derived from the loaded model's own class names. If a future
checkpoint contains GradeC/GradeD classes, they are counted and reported
automatically; if it does not, those grades are reported as unsupported rather
than fabricated.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import threading
import time
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL_PATH = os.path.join(BASE_DIR, "weights", "best.pt")
METADATA_PATH = os.path.join(BASE_DIR, "model_metadata.json")
EVALUATION_PATH = os.path.join(BASE_DIR, "evaluation", "metrics.json")

# Project-relative by default; override with ARECANUT_MODEL_PATH or MODEL_PATH.
# No absolute machine-specific path is hardcoded.
def _env_number(name: str, default, cast=float, minimum=None, maximum=None):
    """Read a numeric environment override without crashing on a typo."""
    raw = os.environ.get(name)
    try:
        value = cast(default if raw is None else raw)
    except (TypeError, ValueError):
        value = cast(default)
    if minimum is not None:
        value = max(cast(minimum), value)
    if maximum is not None:
        value = min(cast(maximum), value)
    return value


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


MODEL_PATH = os.environ.get("ARECANUT_MODEL_PATH") or os.environ.get(
    "MODEL_PATH", DEFAULT_MODEL_PATH
)
MODEL_CONF = _env_number("MODEL_CONF", "0.05", float, 0.0, 1.0)
MODEL_IMGSZ = _env_number("MODEL_IMGSZ", "1280", int, 64, 4096)
MODEL_IOU = _env_number("MODEL_IOU", "0.35", float, 0.01, 0.99)
MODEL_MAX_DET = _env_number("MODEL_MAX_DET", "2000", int, 1, 10000)
MODEL_AUGMENT = _env_bool("MODEL_AUGMENT", True)
USE_TILED = _env_bool("USE_TILED", True)
TILE_SIZE = _env_number("TILE_SIZE", "640", int, 128, 4096)
TILE_OVERLAP = _env_number("TILE_OVERLAP", "0.25", float, 0.0, 0.9)
# Tiles are inferred at the detector's native resolution by default. Keeping the
# full-image size (often 1280) would upscale every 640 px tile and double the
# cost for no extra detail.
TILE_IMGSZ = _env_number(
    "TILE_IMGSZ", str(min(MODEL_IMGSZ, TILE_SIZE)), int, 64, 4096
)
TILE_MERGE_IOU = _env_number("TILE_MERGE_IOU", "0.45", float, 0.01, 0.99)
TILE_DUPLICATE_CENTER_RATIO = _env_number(
    "TILE_DUPLICATE_CENTER_RATIO", "0.30", float, 0.0, 1.0
)
TILE_CORE_OWNERSHIP = _env_bool("TILE_CORE_OWNERSHIP", False)
TILE_MIN_IMAGE_FACTOR = _env_number("TILE_MIN_IMAGE_FACTOR", "1.5", float, 1.0, 10.0)
TILE_INCLUDE_FULL_IMAGE = _env_bool("TILE_INCLUDE_FULL_IMAGE", False)
MODEL_DEBUG = _env_bool("MODEL_DEBUG", False)
DEBUG_CONF_FLOOR = _env_number("DEBUG_CONF_FLOOR", "0.01", float, 0.0, 1.0)

_model = None
_model_lock = threading.Lock()
_loaded_at = None
_checksum_cache = None

# Quality score is an explicitly labelled heuristic, NOT a model probability.
# Weights only apply to grades the loaded model actually predicts.
QUALITY_WEIGHTS = {"A": 1.0, "B": 0.5, "C": 0.25, "D": 0.0}
QUALITY_LABELS = {"A": "GradeA", "B": "GradeB", "C": "GradeC", "D": "GradeD"}
GRADE_ORDER = ("A", "B", "C", "D")


class ModelArtifactError(RuntimeError):
    """Raised when the trained model artifact is missing or unreadable."""


class ImageDecodeError(ValueError):
    """Raised when uploaded bytes cannot be decoded as an image."""


def sha256_of(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def load_metadata() -> dict:
    if not os.path.exists(METADATA_PATH):
        return {}
    try:
        with open(METADATA_PATH, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}


def verify_model_artifact() -> dict:
    """Return artifact facts without loading the network or changing the file."""
    global _checksum_cache
    exists = os.path.isfile(MODEL_PATH)
    info = {
        "path": MODEL_PATH,
        "exists": exists,
        "size_bytes": os.path.getsize(MODEL_PATH) if exists else None,
        "sha256": None,
        "metadata": load_metadata(),
        "checksum_matches_metadata": None,
    }
    if not exists:
        return info
    if _checksum_cache is None:
        _checksum_cache = sha256_of(MODEL_PATH)
    info["sha256"] = _checksum_cache
    expected = (info["metadata"] or {}).get("sha256")
    if expected:
        info["checksum_matches_metadata"] = expected.upper() == _checksum_cache
    return info


def load_model():
    """Load the trained model once per process. Never trains or reinitialises."""
    global _model, _loaded_at

    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:
            return _model

        if not os.path.isfile(MODEL_PATH):
            raise ModelArtifactError(
                f"Trained model not found at {MODEL_PATH}. "
                "Restore weights/best.pt or set MODEL_PATH. The application will not "
                "fall back to an untrained model."
            )

        verification = verify_model_artifact()
        if verification["checksum_matches_metadata"] is False:
            raise ModelArtifactError(
                "Model checksum does not match model_metadata.json. "
                "The artifact may be corrupted or replaced. Run scripts/verify_model.py."
            )

        try:
            from ultralytics import YOLO
        except ImportError as exc:  # pragma: no cover - environment dependent
            raise ModelArtifactError(
                "ultralytics is not installed. Run: pip install -r requirements.txt"
            ) from exc

        _model = YOLO(MODEL_PATH)
        _loaded_at = datetime.now(timezone.utc).isoformat()
        return _model


def model_info() -> dict:
    metadata = load_metadata()
    artifact = verify_model_artifact()
    names = {}
    task = metadata.get("task")
    if _model is not None:
        names = {int(k): str(v) for k, v in _model.names.items()}
        task = _model.task
    elif metadata.get("classes"):
        names = {int(c["index"]): c["name"] for c in metadata["classes"]}

    return {
        "id": metadata.get("id", "arecanut-yolov8"),
        "version": metadata.get("version", "unknown"),
        "task": task,
        "classes": names,
        "supported_grades": [
            letter
            for letter in GRADE_ORDER
            if any(grade_letter(name) == letter for name in names.values())
        ],
        "loaded": _model is not None,
        "loaded_at": _loaded_at,
        "artifact": artifact,
        "input": metadata.get("input", {}),
        "confidence_threshold": MODEL_CONF,
        "iou_threshold": MODEL_IOU,
        "inference": {
            "imgsz": MODEL_IMGSZ,
            "augment": MODEL_AUGMENT,
            "max_det": MODEL_MAX_DET,
            "tiled": USE_TILED,
            "tile_size": TILE_SIZE,
            "tile_overlap": TILE_OVERLAP,
            "tile_imgsz": TILE_IMGSZ,
            "tile_merge_iou": TILE_MERGE_IOU,
            "tile_core_ownership": TILE_CORE_OWNERSHIP,
            "debug": MODEL_DEBUG,
        },
    }


def grade_letter(label: str):
    """Map a verified class label to a grade letter when unambiguous.

    Only labels that explicitly contain a grade letter are mapped. Unknown labels
    are returned as ``None`` instead of being guessed.
    """
    if not label:
        return None
    match = re.search(r"grade[\s_-]*([abcd])\b", label, re.IGNORECASE)
    if match:
        return match.group(1).upper()
    match = re.fullmatch(r"\s*([abcd])\s*", label, re.IGNORECASE)
    if match:
        return match.group(1).upper()
    return None


def _letterbox_preview(image, size: int):
    """Return a letterboxed copy of the image, matching model input geometry."""
    import cv2
    import numpy as np

    height, width = image.shape[:2]
    scale = min(size / width, size / height)
    new_w, new_h = int(round(width * scale)), int(round(height * scale))
    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    top = (size - new_h) // 2
    left = (size - new_w) // 2
    canvas[top : top + new_h, left : left + new_w] = resized
    return canvas


def _encode_jpeg_base64(image, quality: int = 85) -> str:
    import cv2

    ok, buffer = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("Failed to encode image as JPEG")
    return base64.b64encode(buffer.tobytes()).decode("ascii")


def decode_image_bytes(data: bytes):
    """Safely decode uploaded bytes. Raises ImageDecodeError on invalid input."""
    import cv2
    import numpy as np

    if not data:
        raise ImageDecodeError("Empty image file")
    array = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None or image.size == 0:
        raise ImageDecodeError(
            "The uploaded file could not be decoded as a JPEG, PNG, or WebP image."
        )
    height, width = image.shape[:2]
    if width < 16 or height < 16:
        raise ImageDecodeError("Image is too small to analyse")
    return image


def _empty_defect_report(supported_labels=None) -> dict:
    labels = ", ".join(supported_labels or []) or "the loaded model's classes"
    return {
        "supported": False,
        "reason": (
            f"The loaded model exposes only these classes: {labels}. It was not "
            "trained for black spots, cracks, mold, or discoloration, so no defect "
            "predictions are produced."
        ),
        "categories": [
            {
                "name": "Black spots",
                "supported": False,
                "reason": "No black-spot class exists in the trained model.",
            },
            {
                "name": "Cracks",
                "supported": False,
                "reason": "No crack class exists in the trained model.",
            },
            {
                "name": "Mold",
                "supported": False,
                "reason": "No mold class exists in the trained model.",
            },
            {
                "name": "Discoloration",
                "supported": False,
                "reason": "No discoloration class exists in the trained model.",
            },
        ],
        "items": [],
    }


def _effective_conf() -> float:
    """Debug mode may lower the threshold to inspect near-miss detections."""
    if MODEL_DEBUG and DEBUG_CONF_FLOOR < MODEL_CONF:
        return DEBUG_CONF_FLOOR
    return MODEL_CONF


def _run_predict(model, image, imgsz=None):
    return model.predict(
        source=image,
        conf=_effective_conf(),
        iou=MODEL_IOU,
        imgsz=MODEL_IMGSZ if imgsz is None else imgsz,
        max_det=MODEL_MAX_DET,
        agnostic_nms=False,
        augment=MODEL_AUGMENT,
        save=False,
        verbose=False,
    )


def _detections_from_result(result, names, offset_x=0.0, offset_y=0.0):
    """Convert one Ultralytics result into the application's detection dicts."""
    boxes = getattr(result, "boxes", None)
    if boxes is None or len(boxes) == 0:
        return []
    xyxy = boxes.xyxy.cpu().numpy()
    confidences = boxes.conf.cpu().numpy()
    classes = boxes.cls.cpu().numpy()
    detections = []
    for box, confidence, class_id in zip(xyxy, confidences, classes):
        class_id = int(class_id)
        label = names.get(class_id, f"class_{class_id}")
        x1, y1, x2, y2 = (float(value) for value in box)
        detections.append(
            {
                "label": label,
                "class_id": class_id,
                "confidence": float(confidence),
                "bbox": [
                    x1 + offset_x,
                    y1 + offset_y,
                    x2 + offset_x,
                    y2 + offset_y,
                ],
            }
        )
    return detections


def _axis_origins(length: int, tile: int, step: int):
    """Tile origins that always include a full tile at the far edge."""
    if length <= tile:
        return [0]
    origins = list(range(0, length - tile + 1, step))
    if origins[-1] != length - tile:
        origins.append(length - tile)
    return origins


def tile_plan(width: int, height: int):
    """Return ``(x1, y1, x2, y2, core_box)`` tuples covering the whole image.

    The final row/column is aligned with the image edge instead of being a thin
    strip, so nuts at the right/bottom border are never cut off or skipped.
    """
    tile_w = min(TILE_SIZE, width)
    tile_h = min(TILE_SIZE, height)
    step_x = max(1, int(round(tile_w * (1.0 - TILE_OVERLAP))))
    step_y = max(1, int(round(tile_h * (1.0 - TILE_OVERLAP))))
    overlap_x = max(0, tile_w - step_x)
    overlap_y = max(0, tile_h - step_y)

    xs = _axis_origins(width, tile_w, step_x)
    ys = _axis_origins(height, tile_h, step_y)
    plan = []
    for y1 in ys:
        y2 = min(y1 + tile_h, height)
        for x1 in xs:
            x2 = min(x1 + tile_w, width)
            # Core ownership assigns each nut to exactly one tile, avoiding
            # duplicate boxes in overlapping regions.
            core_x1 = x1 + (overlap_x // 2 if x1 > 0 else 0)
            core_x2 = x2 - (overlap_x // 2 if x2 < width else 0)
            core_y1 = y1 + (overlap_y // 2 if y1 > 0 else 0)
            core_y2 = y2 - (overlap_y // 2 if y2 < height else 0)
            if core_x2 <= core_x1:
                core_x1, core_x2 = x1, x2
            if core_y2 <= core_y1:
                core_y1, core_y2 = y1, y2
            plan.append((x1, y1, x2, y2, (core_x1, core_y1, core_x2, core_y2)))
    return plan, (tile_w, tile_h)


def _box_iou(a, b) -> float:
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _box_containment(a, b) -> float:
    """Intersection over the smaller box (catches nested duplicate boxes)."""
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    smaller = min(area_a, area_b)
    return inter / smaller if smaller > 0 else 0.0


def dedupe_detections(detections, iou_thresh=None, center_ratio=None):
    """Remove duplicate boxes while keeping touching neighbouring nuts.

    A pair is a duplicate when any of these is true:
      * IoU is at or above ``iou_thresh``;
      * one box is almost completely inside the other (containment >= 0.90);
      * the centres are very close *and* the boxes overlap, which catches
        shifted duplicates produced by overlapping tiles.

    The highest-confidence detection in each duplicate cluster is kept.
    """
    if not detections:
        return []
    iou_thresh = TILE_MERGE_IOU if iou_thresh is None else iou_thresh
    center_ratio = (
        TILE_DUPLICATE_CENTER_RATIO if center_ratio is None else center_ratio
    )
    ordered = sorted(detections, key=lambda item: item["confidence"], reverse=True)
    kept = []
    for det in ordered:
        box = det["bbox"]
        width = max(0.0, box[2] - box[0])
        height = max(0.0, box[3] - box[1])
        center_x = (box[0] + box[2]) / 2.0
        center_y = (box[1] + box[3]) / 2.0
        duplicate = False
        for other in kept:
            other_box = other["bbox"]
            iou = _box_iou(box, other_box)
            if iou >= iou_thresh:
                duplicate = True
                break
            if _box_containment(box, other_box) >= 0.90:
                duplicate = True
                break
            other_w = max(0.0, other_box[2] - other_box[0])
            other_h = max(0.0, other_box[3] - other_box[1])
            other_cx = (other_box[0] + other_box[2]) / 2.0
            other_cy = (other_box[1] + other_box[3]) / 2.0
            min_dim = min(width, height, other_w, other_h)
            distance = ((center_x - other_cx) ** 2 + (center_y - other_cy) ** 2) ** 0.5
            if iou > 0.05 and min_dim > 0 and distance < center_ratio * min_dim:
                duplicate = True
                break
        if not duplicate:
            kept.append(det)
    return kept


def _nms_boxes(detections, iou_thresh=0.45):
    """Backwards-compatible wrapper around the duplicate-suppression helper."""
    return dedupe_detections(detections, iou_thresh=iou_thresh)


def _centre_inside(box, core_box) -> bool:
    centre_x = (box[0] + box[2]) / 2.0
    centre_y = (box[1] + box[3]) / 2.0
    return core_box[0] <= centre_x < core_box[2] and core_box[1] <= centre_y < core_box[3]


def analyse_image(image) -> dict:
    """Run the preserved model and return a structured, honest result."""
    started = time.perf_counter()
    model = load_model()

    height, width = image.shape[:2]
    names = {int(k): str(v) for k, v in model.names.items()}
    # Grades genuinely supported by *this* checkpoint, derived from its labels.
    supported_letters = [
        letter for letter in GRADE_ORDER if any(grade_letter(n) == letter for n in names.values())
    ]
    unsupported_letters = [letter for letter in GRADE_ORDER if letter not in supported_letters]
    supported_labels = [names[i] for i in sorted(names)]

    raw_detections = []
    mode = "full"
    tile_count = 0
    tile_w = tile_h = None
    full_image_pass = False
    inference_error = None

    should_tile = USE_TILED and max(height, width) > TILE_SIZE * TILE_MIN_IMAGE_FACTOR
    if should_tile:
        plan, (tile_w, tile_h) = tile_plan(width, height)
        tile_count = len(plan)
        mode = "tiled"
        try:
            for x1, y1, x2, y2, core_box in plan:
                tile = image[y1:y2, x1:x2]
                if tile.size == 0:
                    continue
                results = _run_predict(model, tile, imgsz=TILE_IMGSZ)
                tile_detections = _detections_from_result(
                    results[0], names, offset_x=float(x1), offset_y=float(y1)
                )
                if TILE_CORE_OWNERSHIP:
                    tile_detections = [
                        det for det in tile_detections if _centre_inside(det["bbox"], core_box)
                    ]
                raw_detections.extend(tile_detections)
        except Exception as exc:  # pragma: no cover - depends on runtime/model
            raw_detections = []
            inference_error = f"{type(exc).__name__}: {exc}"
            mode = "full"
            tile_count = 0

    if mode == "full" or TILE_INCLUDE_FULL_IMAGE:
        # A full-image pass is optional for tiled runs (useful for very large
        # nuts that span tiles) but never a silent second attempt when tiling
        # simply found nothing.
        results = _run_predict(model, image)
        raw_detections.extend(_detections_from_result(results[0], names))
        full_image_pass = mode == "tiled"

    all_detections = dedupe_detections(raw_detections)

    grades = {"A": 0, "B": 0, "C": 0, "D": 0}
    class_counts: dict[str, int] = {}
    unknown_labels: set[str] = set()
    detections = []

    for det in all_detections:
        label = det["label"]
        confidence = det["confidence"]
        class_counts[label] = class_counts.get(label, 0) + 1
        letter = grade_letter(label)
        if letter in grades:
            grades[letter] += 1
        else:
            unknown_labels.add(label)

        x1, y1, x2, y2 = det["bbox"]
        box_w = max(0.0, x2 - x1)
        box_h = max(0.0, y2 - y1)
        major = max(box_w, box_h)
        minor = min(box_w, box_h)
        detections.append(
            {
                "label": label,
                "grade": letter,
                "confidence": round(float(confidence), 4),
                "confidence_pct": round(float(confidence) * 100, 2),
                "bbox": [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)],
                "box_width_px": round(box_w, 2),
                "box_height_px": round(box_h, 2),
                "area_px2": round(box_w * box_h, 2),
                "area_ratio": round((box_w * box_h) / float(width * height), 6),
                "aspect_ratio": round(major / minor, 3) if minor > 0 else None,
            }
        )

    total = sum(grades[letter] for letter in supported_letters)
    winning_letter = None
    if total > 0:
        # Majority grade; ties favour the better grade (A > B > C > D).
        winning_letter = max(
            supported_letters,
            key=lambda letter: (grades[letter], -GRADE_ORDER.index(letter)),
        )
        final_grade = f"Grade {winning_letter}"
    else:
        final_grade = "Invalid"

    winning_confidences = [
        d["confidence"] for d in detections if d["grade"] == winning_letter
    ]
    prediction_confidence = (
        round(100.0 * sum(winning_confidences) / len(winning_confidences), 2)
        if winning_confidences
        else None
    )

    quality_score = None
    if total > 0:
        weighted = sum(
            QUALITY_WEIGHTS[letter] * grades[letter] for letter in supported_letters
        )
        quality_score = round(100.0 * weighted / total, 2)

    measured = [d for d in detections if d["aspect_ratio"] is not None]
    measurements = {
        "available": bool(measured),
        "method": (
            "Axis-aligned bounding-box estimates in image space. Values are not "
            "physical dimensions and are not calibrated."
        ),
        "units": "pixels (uncalibrated)",
        "physical_dimensions": "unavailable (no camera calibration or reference scale)",
        "shape_irregularity": "unavailable (requires an instance-segmentation model)",
        "sample_count": len(measured),
        "avg_major_axis_px": round(
            sum(max(d["box_width_px"], d["box_height_px"]) for d in measured)
            / len(measured),
            2,
        )
        if measured
        else None,
        "avg_minor_axis_px": round(
            sum(min(d["box_width_px"], d["box_height_px"]) for d in measured)
            / len(measured),
            2,
        )
        if measured
        else None,
        "avg_aspect_ratio": round(
            sum(d["aspect_ratio"] for d in measured) / len(measured), 3
        )
        if measured
        else None,
        "avg_area_px2": round(
            sum(d["area_px2"] for d in measured) / len(measured), 2
        )
        if measured
        else None,
        "total_area_ratio": round(sum(d["area_ratio"] for d in measured), 6)
        if measured
        else None,
    }

    warnings = []
    if total == 0:
        warnings.append(
            "No arecanut detections matched a supported grade above the confidence "
            f"threshold ({MODEL_CONF:.2f}). Supported grade classes: "
            + (", ".join(supported_labels) if supported_labels else "none")
            + ". Use a clearer, well-lit tray photo or adjust MODEL_CONF deliberately."
        )
    if unknown_labels:
        warnings.append(
            "The model returned class labels that could not be mapped to a grade "
            "letter: " + ", ".join(sorted(unknown_labels))
        )
    if unsupported_letters:
        warnings.append(
            "Grades "
            + ", ".join(unsupported_letters)
            + " are not supported by the currently loaded model ("
            + (", ".join(supported_labels) if supported_labels else "no classes")
            + "). No C/D predictions are fabricated. Install a checkpoint whose "
            "class list includes GradeC/GradeD to enable them."
        )
    weights_text = ", ".join(
        f"{letter}={QUALITY_WEIGHTS[letter]:.2f}" for letter in supported_letters
    )
    warnings.append(
        "Quality score is a documented heuristic based on grade composition"
        + (f" ({weights_text})" if weights_text else "")
        + ". It is not a calibrated probability or laboratory result."
    )
    warnings.append(
        "Size and shape values are image-space bounding-box estimates; physical "
        "dimensions require calibration."
    )
    defects = _empty_defect_report(supported_labels)
    if not defects["supported"]:
        warnings.append(
            "Defect detection (black spots, cracks, mold, discoloration) is not "
            "supported by the current trained model."
        )

    try:
        import cv2
        grade_colors = {
            "A": (0, 180, 90),
            "B": (40, 160, 255),
            "C": (0, 110, 235),
            "D": (40, 40, 200),
        }
        annotated = image.copy()
        for idx, det in enumerate(detections):
            x1, y1, x2, y2 = map(int, det["bbox"])
            label = det["label"]
            conf = det["confidence_pct"]
            color = grade_colors.get(det.get("grade"), (80, 80, 80))
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
            text = f"Nut {idx+1} {label} {conf:.1f}%"
            (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(annotated, (x1, max(0, y1 - th - 6)), (x1 + tw + 4, y1), color, -1)
            cv2.putText(annotated, text, (x1 + 2, max(0, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    except Exception:
        annotated = image.copy()
    processed_preview = _letterbox_preview(image, MODEL_IMGSZ)
    processing_ms = round((time.perf_counter() - started) * 1000, 2)

    for i, d in enumerate(detections):
        d["nut_id"] = f"Nut {i+1}"
        d["id"] = f"Nut {i+1}"

    grade_support = {
        letter: letter in supported_letters for letter in GRADE_ORDER
    }

    inference_info = {
        "mode": mode,
        "imgsz": MODEL_IMGSZ if mode == "full" else TILE_IMGSZ,
        "tile_size": TILE_SIZE if mode == "tiled" else None,
        "tile_imgsz": TILE_IMGSZ if mode == "tiled" else None,
        "tile_overlap": TILE_OVERLAP if mode == "tiled" else None,
        "tile_count": tile_count,
        "tile_shape": [tile_w, tile_h] if tile_w and mode == "tiled" else None,
        "core_ownership": bool(mode == "tiled" and TILE_CORE_OWNERSHIP),
        "full_image_pass": full_image_pass,
        "augment": MODEL_AUGMENT,
        "conf": _effective_conf(),
        "iou": MODEL_IOU,
        "raw_detections": len(raw_detections),
        "deduped_detections": len(all_detections),
        "dropped_duplicates": max(0, len(raw_detections) - len(all_detections)),
        "error": inference_error,
    }
    if MODEL_DEBUG:
        inference_info["debug_conf_floor"] = DEBUG_CONF_FLOOR
        inference_info["debug_note"] = (
            "MODEL_DEBUG lowered the confidence threshold; counts are not "
            "production results."
        )

    return {
        # Backwards-compatible fields used by the original UI/API
        "grade_a": grades["A"],
        "grade_b": grades["B"],
        "grade_c": grades["C"],
        "grade_d": grades["D"],
        "total": len(detections),
        "final_grade": final_grade,
        # Structured result
        "report": {
            "final_grade": final_grade,
            "grade_letter": winning_letter,
            "grade_counts": {letter: grades[letter] for letter in GRADE_ORDER},
            "grade_support": grade_support,
            "supported_grades": supported_letters,
            "unsupported_grades": unsupported_letters,
            "class_counts": class_counts,
            "total": len(detections),
            "confidence_pct": prediction_confidence,
            "confidence_method": (
                "Mean model confidence of detections in the winning grade class. "
                "Not a calibrated probability."
            ),
            "quality_score": quality_score,
            "quality_method": (
                "Heuristic grade-composition score using documented weights "
                f"({weights_text or 'none'}); only model-supported grades are "
                "counted. Not a model output and not lab-certified."
            ),
            "detections": detections,
            "measurements": measurements,
            "defects": defects,
            "inference": inference_info,
            "warnings": warnings,
        },
        "model": {
            "id": (load_metadata() or {}).get("id", "arecanut-yolov8"),
            "version": (load_metadata() or {}).get("version", "unknown"),
            "sha256": verify_model_artifact()["sha256"],
            "task": model.task,
            "classes": names,
            "supported_grades": supported_letters,
            "imgsz": MODEL_IMGSZ,
            "conf": MODEL_CONF,
            "iou": MODEL_IOU,
        },
        "image": {"width": width, "height": height},
        "processing_ms": processing_ms,
        "annotated_image_base64": _encode_jpeg_base64(annotated),
        "processed_image_base64": _encode_jpeg_base64(processed_preview),
        "image_type": "base64",
    }


def analyse_image_path(image_path: str) -> dict:
    import cv2

    image = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if image is None:
        raise ImageDecodeError(f"Could not read image at {image_path}")
    return analyse_image(image)


def health_payload() -> dict:
    artifact = verify_model_artifact()
    return {
        "status": "ok" if artifact["exists"] else "degraded",
        "service": "arecanut-ml-service",
        "model": model_info(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
