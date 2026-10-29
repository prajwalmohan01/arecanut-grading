"""
Localisation benchmark for the preserved arecanut detector.

This measures *detection* quality against a YOLO-format dataset: it checks
whether a nut is found near a ground-truth box, regardless of the ground-truth
class name. It does NOT measure Grade A/B/C/D classification accuracy, because
the supplied datasets do not contain individual-nut grade labels.

Usage (Windows PowerShell):
    python scripts/benchmark_inference.py `
        --images "$env:TEMP\opencode\csvtu_arecanut\test\images" `
        --labels "$env:TEMP\opencode\csvtu_arecanut\test\labels" `
        --output training_reports/benchmark_upgraded.json

    # Reproduce the pre-upgrade configuration:
    python scripts/benchmark_inference.py ... --no-tiling --imgsz 1280 --augment --legacy-nms

Flags are applied as environment variables *before* importing ml_service.inference,
so the script exercises the same code path as the server and worker.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import statistics
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ML_DIR = os.path.join(ROOT, "ml_service")
if ML_DIR not in sys.path:
    sys.path.insert(0, ML_DIR)

IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


def _str2bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def apply_env(args) -> None:
    if args.conf is not None:
        os.environ["MODEL_CONF"] = str(args.conf)
    if args.imgsz is not None:
        os.environ["MODEL_IMGSZ"] = str(args.imgsz)
    if args.iou is not None:
        os.environ["MODEL_IOU"] = str(args.iou)
    os.environ["MODEL_AUGMENT"] = "true" if args.augment else "false"
    os.environ["USE_TILED"] = "false" if args.no_tiling else "true"
    if args.tile_size is not None:
        os.environ["TILE_SIZE"] = str(args.tile_size)
    if args.tile_imgsz is not None:
        os.environ["TILE_IMGSZ"] = str(args.tile_imgsz)
    if args.tile_overlap is not None:
        os.environ["TILE_OVERLAP"] = str(args.tile_overlap)
    if args.tile_merge_iou is not None:
        os.environ["TILE_MERGE_IOU"] = str(args.tile_merge_iou)
    if args.tile_center_ratio is not None:
        os.environ["TILE_DUPLICATE_CENTER_RATIO"] = str(args.tile_center_ratio)
    if args.core_ownership:
        os.environ["TILE_CORE_OWNERSHIP"] = "true"
    if args.include_full_image:
        os.environ["TILE_INCLUDE_FULL_IMAGE"] = "true"
    os.environ["MODEL_DEBUG"] = "false"


def parse_yolo_label(path: str):
    boxes = []
    if not os.path.isfile(path):
        return boxes
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            parts = line.strip().split()
            if len(parts) < 5:
                continue
            try:
                cx, cy, width, height = (float(value) for value in parts[1:5])
            except ValueError:
                continue
            boxes.append((cx, cy, width, height))
    return boxes


def xywhn_to_xyxy(box, image_width: int, image_height: int):
    cx, cy, width, height = box
    return [
        (cx - width / 2.0) * image_width,
        (cy - height / 2.0) * image_height,
        (cx + width / 2.0) * image_width,
        (cy + height / 2.0) * image_height,
    ]


def box_iou(a, b) -> float:
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def match_detections(predictions, ground_truth, iou_threshold=0.5):
    """Greedy confidence-ordered matching; each GT box may be matched once."""
    ordered = sorted(predictions, key=lambda item: item["confidence"], reverse=True)
    used = [False] * len(ground_truth)
    true_positives = 0
    matches = []
    for prediction in ordered:
        best_index = -1
        best_iou = 0.0
        for index, gt in enumerate(ground_truth):
            if used[index]:
                continue
            iou = box_iou(prediction["bbox"], gt)
            if iou > best_iou:
                best_iou = iou
                best_index = index
        if best_index >= 0 and best_iou >= iou_threshold:
            used[best_index] = True
            true_positives += 1
            matches.append(
                {
                    "prediction": prediction["bbox"],
                    "ground_truth": ground_truth[best_index],
                    "iou": round(best_iou, 4),
                }
            )
    false_positives = len(predictions) - true_positives
    false_negatives = len(ground_truth) - true_positives
    return true_positives, false_positives, false_negatives, matches


def safe_div(numerator, denominator):
    return numerator / denominator if denominator else 0.0


def plain_nms(detections, iou_threshold):
    """IoU-only greedy suppression, matching the pre-upgrade pipeline."""
    kept = []
    for detection in sorted(detections, key=lambda item: item["confidence"], reverse=True):
        if any(box_iou(detection["bbox"], other["bbox"]) >= iou_threshold for other in kept):
            continue
        kept.append(detection)
    return kept


def find_label(labels_dir: str, image_path: str):
    stem = os.path.splitext(os.path.basename(image_path))[0]
    return os.path.join(labels_dir, f"{stem}.txt")


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark localisation speed/quality")
    parser.add_argument("--images", required=True, help="Directory of test images")
    parser.add_argument("--labels", required=True, help="Directory of YOLO .txt labels")
    parser.add_argument("--output", help="Write the JSON report to this path")
    parser.add_argument("--limit", type=int, default=0, help="Benchmark only N images")
    parser.add_argument("--conf", type=float, default=None)
    parser.add_argument("--imgsz", type=int, default=None)
    parser.add_argument("--iou", type=float, default=None, help="Model NMS IoU")
    parser.add_argument("--match-iou", type=float, default=0.5)
    parser.add_argument("--augment", action="store_true", help="Enable test-time augmentation")
    parser.add_argument("--no-tiling", action="store_true", help="Disable tiling")
    parser.add_argument("--tile-size", type=int, default=None)
    parser.add_argument("--tile-imgsz", type=int, default=None)
    parser.add_argument("--tile-overlap", type=float, default=None)
    parser.add_argument("--tile-merge-iou", type=float, default=None)
    parser.add_argument(
        "--tile-center-ratio",
        type=float,
        default=None,
        help="Centre-distance duplicate threshold (fraction of the smaller box)",
    )
    parser.add_argument("--core-ownership", action="store_true")
    parser.add_argument("--include-full-image", action="store_true")
    parser.add_argument(
        "--no-dedupe",
        action="store_true",
        help="Disable cross-tile de-duplication (raw predictions)",
    )
    parser.add_argument(
        "--legacy-nms",
        action="store_true",
        help="Reproduce the old single IoU-only NMS pass at MODEL_IOU",
    )
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    if args.no_dedupe:
        os.environ["TILE_MERGE_IOU"] = "1.0"
        os.environ["TILE_DUPLICATE_CENTER_RATIO"] = "0.0"
    apply_env(args)

    import cv2  # noqa: E402  (import after env setup)
    import inference  # noqa: E402

    if args.no_dedupe:
        # Mirror the old pipeline, which only ran the model's own NMS plus one
        # final NMS pass (the latter is unnecessary for full-image runs).
        inference.dedupe_detections = lambda detections, **kwargs: list(detections)
    elif args.legacy_nms:
        inference.dedupe_detections = lambda detections, **kwargs: plain_nms(
            detections, inference.MODEL_IOU
        )

    image_paths = sorted(
        path
        for path in glob.glob(os.path.join(args.images, "*"))
        if path.lower().endswith(IMAGE_SUFFIXES)
    )
    if args.limit:
        image_paths = image_paths[: args.limit]
    if not image_paths:
        print(f"No images found in {args.images}", file=sys.stderr)
        return 1

    per_image = []
    totals = {"tp": 0, "fp": 0, "fn": 0, "predictions": 0, "ground_truth": 0}
    times = []
    last_model = {}

    for index, image_path in enumerate(image_paths, start=1):
        image = cv2.imread(image_path, cv2.IMREAD_COLOR)
        if image is None:
            print(f"[skip] cannot read {image_path}", file=sys.stderr)
            continue
        height, width = image.shape[:2]
        gt_boxes = [
            xywhn_to_xyxy(box, width, height)
            for box in parse_yolo_label(find_label(args.labels, image_path))
        ]
        started = time.perf_counter()
        result = inference.analyse_image(image)
        elapsed = time.perf_counter() - started
        times.append(elapsed)
        last_model = result.get("model", {})

        predictions = [
            {"bbox": detection["bbox"], "confidence": detection["confidence"]}
            for detection in result["report"]["detections"]
        ]
        tp, fp, fn, _ = match_detections(predictions, gt_boxes, args.match_iou)
        totals["tp"] += tp
        totals["fp"] += fp
        totals["fn"] += fn
        totals["predictions"] += len(predictions)
        totals["ground_truth"] += len(gt_boxes)

        per_image.append(
            {
                "image": os.path.basename(image_path),
                "width": width,
                "height": height,
                "predictions": len(predictions),
                "ground_truth": len(gt_boxes),
                "tp": tp,
                "fp": fp,
                "fn": fn,
                "precision": round(safe_div(tp, tp + fp), 4),
                "recall": round(safe_div(tp, tp + fn), 4),
                "processing_ms": result["processing_ms"],
                "wall_ms": round(elapsed * 1000, 2),
                "inference": result["report"].get("inference"),
            }
        )
        if index % 10 == 0 or index == len(image_paths):
            print(f"[{index}/{len(image_paths)}] {os.path.basename(image_path)}", flush=True)

    precision = safe_div(totals["tp"], totals["tp"] + totals["fp"])
    recall = safe_div(totals["tp"], totals["tp"] + totals["fn"])
    f1 = safe_div(2 * precision * recall, precision + recall)

    report = {
        "benchmark": "localisation_only",
        "disclaimer": (
            "Ground-truth class labels were ignored because the benchmark dataset "
            "does not contain individual-nut Grade A/B/C/D annotations. These "
            "numbers measure whether nuts were found, not whether grades are correct."
        ),
        "images_dir": os.path.abspath(args.images),
        "labels_dir": os.path.abspath(args.labels),
        "image_count": len(per_image),
        "match_iou": args.match_iou,
        "settings": {
            "model_imgsz": inference.MODEL_IMGSZ,
            "tile_imgsz": inference.TILE_IMGSZ,
            "conf": inference.MODEL_CONF,
            "model_iou": inference.MODEL_IOU,
            "augment": inference.MODEL_AUGMENT,
            "tiled": inference.USE_TILED,
            "tile_size": inference.TILE_SIZE,
            "tile_overlap": inference.TILE_OVERLAP,
            "tile_merge_iou": inference.TILE_MERGE_IOU,
            "tile_duplicate_center_ratio": inference.TILE_DUPLICATE_CENTER_RATIO,
            "core_ownership": inference.TILE_CORE_OWNERSHIP,
            "include_full_image": inference.TILE_INCLUDE_FULL_IMAGE,
            "dedupe_enabled": not args.no_dedupe,
            "legacy_nms": args.legacy_nms,
            "dedupe_mode": (
                "none"
                if args.no_dedupe
                else "legacy_iou_nms"
                if args.legacy_nms
                else "tile_dedupe"
            ),
        },
        "totals": {
            **totals,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "mean_predictions": round(safe_div(totals["predictions"], len(per_image)), 2),
            "mean_ground_truth": round(safe_div(totals["ground_truth"], len(per_image)), 2),
        },
        "timing": {
            "total_seconds": round(sum(times), 3),
            "mean_seconds": round(statistics.mean(times), 4) if times else None,
            "median_seconds": round(statistics.median(times), 4) if times else None,
            "min_seconds": round(min(times), 4) if times else None,
            "max_seconds": round(max(times), 4) if times else None,
            "note": "Includes inference, de-duplication, annotation drawing, and JPEG preview encoding (image decoding happens before the timer).",
        },
        "model": last_model,
        "per_image": per_image,
    }

    if args.output:
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2 if args.pretty else None)
        print(f"Wrote {args.output}")

    summary = {
        "images": report["image_count"],
        "precision": report["totals"]["precision"],
        "recall": report["totals"]["recall"],
        "f1": report["totals"]["f1"],
        "mean_predictions": report["totals"]["mean_predictions"],
        "mean_ground_truth": report["totals"]["mean_ground_truth"],
        "mean_seconds": report["timing"]["mean_seconds"],
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
