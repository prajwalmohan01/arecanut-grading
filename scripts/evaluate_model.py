"""Evaluate a saved YOLO checkpoint on a held-out split (explicit command only).

    python scripts/evaluate_model.py --model ml_service/weights/best.pt \
        --data training_cache/dataset/data.yaml --split test

Writes an honest metrics report under training_reports/ and prints the values.
Use --install-metrics only when you intend the active model's report to become
the app's recorded evaluation (ml_service/evaluation/metrics.json).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.datasets import PROJECT_ROOT, REPORTS_DIR, write_json  # noqa: E402

ACTIVE_MODEL = PROJECT_ROOT / "ml_service" / "weights" / "best.pt"
EVALUATION_PATH = PROJECT_ROOT / "ml_service" / "evaluation" / "metrics.json"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=str(ACTIVE_MODEL))
    parser.add_argument("--data", required=True, help="Prepared YOLO data.yaml.")
    parser.add_argument("--split", default="val", choices=["train", "val", "test"])
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--conf", type=float, default=0.001, help="Evaluation confidence threshold.")
    parser.add_argument("--iou", type=float, default=0.6)
    parser.add_argument("--output", help="JSON output path.")
    parser.add_argument("--install-metrics", action="store_true")
    args = parser.parse_args()

    model_path = Path(args.model).expanduser().resolve()
    data_yaml = Path(args.data).expanduser().resolve()
    if not model_path.is_file():
        print(f"Model not found: {model_path}")
        return 1
    if not data_yaml.is_file():
        print(
            f"data.yaml not found: {data_yaml}. Evaluation requires a labelled split; "
            "no metrics are invented."
        )
        return 1

    try:
        from ultralytics import YOLO
    except ImportError:
        print("ultralytics is not installed. Run: pip install -r ml_service/requirements.txt")
        return 1

    model = YOLO(str(model_path))
    names = {int(key): str(value) for key, value in model.names.items()}
    results = model.val(
        data=str(data_yaml),
        split=args.split,
        imgsz=args.imgsz,
        conf=args.conf,
        iou=args.iou,
        verbose=False,
    )

    metrics = {}
    for key, value in getattr(results, "results_dict", {}).items():
        try:
            metrics[key] = round(float(value), 6)
        except (TypeError, ValueError):
            continue

    per_class = {}
    box = getattr(results, "box", None)
    if box is not None:
        maps = getattr(box, "maps", None)
        if maps is not None:
            for index, value in enumerate(list(maps)):
                label = names.get(index, f"class_{index}")
                per_class[label] = {"mAP50-95": round(float(value), 6)}

    report = {
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "model_path": str(model_path),
        "model_sha256": sha256_of(model_path),
        "model_size_bytes": model_path.stat().st_size,
        "model_classes": names,
        "dataset": str(data_yaml),
        "split": args.split,
        "settings": {"imgsz": args.imgsz, "conf": args.conf, "iou": args.iou},
        "metrics": metrics,
        "per_class": per_class,
        "ultralytics_version": _version(),
        "notes": [
            "Metrics come from Ultralytics validation on the specified split.",
            "Only compare models evaluated on the same split and settings.",
        ],
    }

    output = (
        Path(args.output)
        if args.output
        else REPORTS_DIR / f"evaluation_{model_path.stem}_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    )
    write_json(output, report)
    print(json.dumps({"metrics": metrics, "per_class": per_class}, indent=2))
    print(f"Wrote {output}")

    if args.install_metrics:
        if Path(str(model_path)) != ACTIVE_MODEL.resolve():
            print(
                "Refusing --install-metrics: the evaluated model is not the active "
                f"{ACTIVE_MODEL}. Promote it first."
            )
            return 2
        EVALUATION_PATH.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(output, EVALUATION_PATH)
        print(f"Installed metrics at {EVALUATION_PATH}")
    return 0


def _version() -> str | None:
    try:
        import ultralytics

        return getattr(ultralytics, "__version__", None)
    except Exception:
        return None


if __name__ == "__main__":
    raise SystemExit(main())
