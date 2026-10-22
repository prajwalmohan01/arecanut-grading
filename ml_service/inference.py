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
MODEL_PATH = os.environ.get("ARECANUT_MODEL_PATH") or os.environ.get(
    "MODEL_PATH", DEFAULT_MODEL_PATH
)
MODEL_CONF = float(os.environ.get("MODEL_CONF", "0.05"))
MODEL_IMGSZ = int(os.environ.get("MODEL_IMGSZ", "1280"))
MODEL_IOU = float(os.environ.get("MODEL_IOU", "0.35"))
MODEL_MAX_DET = int(os.environ.get("MODEL_MAX_DET", "2000"))
MODEL_AUGMENT = os.environ.get("MODEL_AUGMENT", "true").lower() == "true"
USE_TILED = os.environ.get("USE_TILED", "true").lower() == "true"
TILE_SIZE = int(os.environ.get("TILE_SIZE", "640"))
TILE_OVERLAP = float(os.environ.get("TILE_OVERLAP", "0.25"))

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


def _run_predict(model, image):
    return model.predict(
        source=image,
        conf=MODEL_CONF,
        iou=MODEL_IOU,
        imgsz=MODEL_IMGSZ,
        max_det=MODEL_MAX_DET,
        agnostic_nms=False,
        augment=MODEL_AUGMENT,
        save=False,
        verbose=False,
    )


def _nms_boxes(detections, iou_thresh=0.45):
    if not detections:
        return []
    import numpy as np
    boxes = np.array([d["bbox"] for d in detections])
    scores = np.array([d["confidence"] for d in detections])
    x1 = boxes[:, 0]; y1 = boxes[:, 1]; x2 = boxes[:, 2]; y2 = boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0.0, xx2 - xx1)
        h = np.maximum(0.0, yy2 - yy1)
        inter = w * h
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
        inds = np.where(iou <= iou_thresh)[0]
        order = order[inds + 1]
    return [detections[i] for i in keep]


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

    all_detections = []
    used_tiled = False

    if USE_TILED and max(height, width) > TILE_SIZE * 1.5:
        try:
            import numpy as np
            step = int(TILE_SIZE * (1 - TILE_OVERLAP))
            if step < 1:
                step = TILE_SIZE // 2
            for y in range(0, height, step):
                for x in range(0, width, step):
                    y2 = min(y + TILE_SIZE, height)
                    x2 = min(x + TILE_SIZE, width)
                    if y2 - y < TILE_SIZE // 2 and y != 0:
                        continue
                    if x2 - x < TILE_SIZE // 2 and x != 0:
                        continue
                    tile = image[y:y2, x:x2]
                    results = _run_predict(model, tile)
                    res = results[0]
                    boxes = res.boxes
                    if boxes is not None and len(boxes):
                        xyxy = boxes.xyxy.cpu().numpy()
                        confidences = boxes.conf.cpu().numpy()
                        classes = boxes.cls.cpu().numpy()
                        for box, confidence, class_id in zip(xyxy, confidences, classes):
                            class_id = int(class_id)
                            label = names.get(class_id, f"class_{class_id}")
                            x1, y1, x2b, y2b = (float(v) for v in box)
                            all_detections.append({
                                "label": label,
                                "class_id": class_id,
                                "confidence": float(confidence),
                                "bbox": [x1 + x, y1 + y, x2b + x, y2b + y],
                            })
            used_tiled = True
        except Exception:
            all_detections = []
            used_tiled = False

    if not all_detections or not used_tiled:
        results = _run_predict(model, image)
        result = results[0]
        boxes = result.boxes
        if boxes is not None and len(boxes):
            xyxy = boxes.xyxy.cpu().numpy()
            confidences = boxes.conf.cpu().numpy()
            classes = boxes.cls.cpu().numpy()
            for box, confidence, class_id in zip(xyxy, confidences, classes):
                class_id = int(class_id)
                label = names.get(class_id, f"class_{class_id}")
                x1, y1, x2b, y2b = (float(v) for v in box)
                all_detections.append({
                    "label": label,
                    "class_id": class_id,
                    "confidence": float(confidence),
                    "bbox": [x1, y1, x2b, y2b],
                })

    if all_detections:
        all_detections = _nms_boxes(all_detections, iou_thresh=MODEL_IOU)

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
        try:
            results = _run_predict(model, image)
            annotated = results[0].plot()
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
