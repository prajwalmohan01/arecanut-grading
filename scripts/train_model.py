"""Train a candidate YOLOv8 detector explicitly (never on app startup).

Workflow:
    1. python scripts/inspect_datasets.py
    2. python scripts/prepare_dataset.py --data <yolo-dataset>
    3. python scripts/train_model.py --data training_cache/dataset/data.yaml --epochs 60
    4. python scripts/evaluate_model.py --model <candidate> --data training_cache/dataset/data.yaml
    5. Review training_reports/, then promote deliberately:
       python scripts/train_model.py --promote <candidate.pt> --evaluation <report.json>

The active model at ml_service/weights/best.pt is backed up before any
promotion and is never overwritten by the training step itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.datasets import (  # noqa: E402
    PROJECT_ROOT,
    REPORTS_DIR,
    display_path,
    portable_text,
    write_json,
)

ACTIVE_MODEL = PROJECT_ROOT / "ml_service" / "weights" / "best.pt"
METADATA_PATH = PROJECT_ROOT / "ml_service" / "model_metadata.json"
BACKUP_DIR = PROJECT_ROOT / "ml_service" / "weights" / "backups"
CANDIDATE_DIR = PROJECT_ROOT / "ml_service" / "weights" / "candidates"
EVALUATION_PATH = PROJECT_ROOT / "ml_service" / "evaluation" / "metrics.json"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def backup_active_model() -> Path | None:
    if not ACTIVE_MODEL.is_file():
        return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    digest = sha256_of(ACTIVE_MODEL)
    backup = BACKUP_DIR / f"best_{digest[:12]}.pt"
    if not backup.exists():
        shutil.copy2(ACTIVE_MODEL, backup)
    return backup


def metrics_from_results(results) -> dict:
    """Extract real validation metrics from an Ultralytics results object."""
    metrics = {}
    for key in ("metrics/mAP50(B)", "metrics/mAP50-95(B)", "metrics/precision(B)", "metrics/recall(B)"):
        value = getattr(results, "results_dict", {}).get(key)
        if value is not None:
            metrics[key] = round(float(value), 6)
    box = getattr(results, "box", None)
    if box is not None:
        for name in ("map", "map50", "mp", "mr"):
            value = getattr(box, name, None)
            if value is not None:
                metrics[name] = round(float(value), 6)
    return metrics


def parse_batch(value):
    """Convert the CLI batch value to the type Ultralytics expects.

    Ultralytics rejects numeric strings ("batch=4" is of invalid type str) and
    accepts ``-1`` to enable AutoBatch.
    """
    if value is None:
        return -1
    if isinstance(value, (int, float)):
        return value
    text = str(value).strip().lower()
    if text in {"auto", "-1", ""}:
        return -1
    try:
        number = float(text)
    except ValueError:
        raise SystemExit(
            f"Invalid --batch value {value!r}. Use an integer, a float (0-1 for "
            "fractional batch), or 'auto'."
        )
    return int(number) if number.is_integer() else number


def train(args) -> int:
    try:
        from ultralytics import YOLO
    except ImportError:
        print("ultralytics is not installed. Run: pip install -r ml_service/requirements.txt")
        return 1

    data_yaml = Path(args.data).expanduser().resolve()
    if not data_yaml.is_file():
        prepared = REPORTS_DIR / "prepare_dataset.json"
        hint = ""
        if prepared.is_file():
            hint = f" See {prepared}."
        print(f"data.yaml not found: {data_yaml}.{hint}")
        return 1

    backup = backup_active_model()
    if backup:
        print(f"Active model backed up to {backup}")

    weights = Path(args.weights).expanduser().resolve() if args.weights else ACTIVE_MODEL
    if not weights.is_file():
        print(f"Base weights not found: {weights}")
        return 1

    batch = parse_batch(args.batch)
    run_name = f"run_{timestamp()}"
    run_dir = CANDIDATE_DIR / run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    report_path = REPORTS_DIR / f"training_{run_name}.json"

    config = {
        "base_weights": display_path(weights),
        "data": display_path(data_yaml),
        "epochs": args.epochs,
        "imgsz": args.imgsz,
        "batch": batch,
        "device": args.device,
        "workers": args.workers,
        "seed": args.seed,
        "patience": args.patience,
        "project": display_path(CANDIDATE_DIR),
        "name": run_name,
        "task": "detect",
    }
    report = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "config": config,
        "status": "running",
        "backup": display_path(backup) if backup else None,
        "errors": [],
    }
    write_json(report_path, report)
    print(json.dumps(config, indent=2))
    print(f"Training output: {run_dir}")

    try:
        model = YOLO(str(weights))
        results = model.train(
            data=str(data_yaml),
            epochs=args.epochs,
            imgsz=args.imgsz,
            batch=batch,
            device=args.device,
            workers=args.workers,
            seed=args.seed,
            patience=args.patience,
            project=str(CANDIDATE_DIR),
            name=run_name,
            exist_ok=True,
            plots=True,
            verbose=True,
        )
    except Exception as exc:
        report["status"] = "failed"
        report["errors"].append(portable_text(f"{type(exc).__name__}: {exc}"))
        write_json(report_path, report)
        print(f"Training failed: {exc}")
        return 1

    best = Path(results.save_dir) / "weights" / "best.pt"
    if not best.is_file():
        # Ultralytics may place the run under project/name directly.
        candidate = list(CANDIDATE_DIR.rglob(f"{run_name}/weights/best.pt"))
        best = candidate[0] if candidate else best

    report.update(
        {
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "status": "trained" if best.is_file() else "failed",
            "candidate_path": display_path(best) if best.is_file() else None,
            "candidate_sha256": sha256_of(best) if best.is_file() else None,
            "candidate_size_bytes": best.stat().st_size if best.is_file() else None,
            "ultralytics_version": _ultralytics_version(),
        }
    )

    if best.is_file():
        try:
            candidate = YOLO(str(best))
            names = {int(key): str(value) for key, value in candidate.names.items()}
            report["candidate_classes"] = names
            val = candidate.val(data=str(data_yaml), split="val", verbose=False)
            report["validation_metrics"] = metrics_from_results(val)
        except Exception as exc:
            report["errors"].append(portable_text(f"Post-training validation failed: {exc}"))

    write_json(report_path, report)
    print(f"Wrote {report_path}")
    if not best.is_file():
        print("No candidate best.pt was produced. The active model was not changed.")
        return 1

    print(f"Candidate: {best}")
    print(
        "The active model was NOT changed. Evaluate the candidate, then run:\n"
        f"  python scripts/train_model.py --promote \"{best}\" "
        f"--evaluation training_reports/evaluation_<candidate>.json"
    )
    return 0


def grade_letter_from_name(name: str) -> str | None:
    """Extract a grade letter from class names such as GradeA / grade_c / Class D."""
    match = re.search(r"(?:grade|class)[\s_-]*([abcd])\b", str(name), re.IGNORECASE)
    if match:
        return match.group(1).upper()
    stripped = str(name).strip().upper()
    if stripped in {"A", "B", "C", "D"}:
        return stripped
    return None


def _ultralytics_version() -> str | None:
    try:
        import ultralytics

        return getattr(ultralytics, "__version__", None)
    except Exception:
        return None


def promote(args) -> int:
    candidate = Path(args.promote).expanduser().resolve()
    if not candidate.is_file():
        print(f"Candidate not found: {candidate}")
        return 1
    try:
        from ultralytics import YOLO

        model = YOLO(str(candidate))
        names = {int(key): str(value) for key, value in model.names.items()}
    except Exception as exc:
        print(f"Candidate cannot be loaded by Ultralytics: {exc}")
        return 1

    if not args.evaluation:
        print(
            "Refusing to promote without --evaluation <report.json>. Run "
            "scripts/evaluate_model.py first so metrics are real and recorded."
        )
        return 1
    evaluation_path = Path(args.evaluation).expanduser().resolve()
    if not evaluation_path.is_file():
        print(f"Evaluation report not found: {evaluation_path}")
        return 1
    evaluation = json.loads(evaluation_path.read_text(encoding="utf-8"))
    candidate_metric = evaluation.get("metrics", {}).get("metrics/mAP50-95(B)")
    if candidate_metric is None:
        print("Evaluation report has no metrics/mAP50-95(B) value; refusing to promote.")
        return 1

    baseline_metric = None
    if EVALUATION_PATH.is_file():
        try:
            baseline = json.loads(EVALUATION_PATH.read_text(encoding="utf-8"))
            baseline_metric = baseline.get("metrics", {}).get("metrics/mAP50-95(B)")
        except Exception:
            baseline_metric = None

    if baseline_metric is not None and candidate_metric < baseline_metric:
        print(
            f"Candidate mAP50-95 {candidate_metric:.4f} is below the recorded active "
            f"baseline {baseline_metric:.4f}. Refusing to promote."
        )
        return 1
    if baseline_metric is None and not args.accept_baseline:
        print(
            "No recorded active-model baseline metrics exist, so a fair comparison "
            "cannot be made. Re-run with --accept-baseline to promote anyway (the "
            "current model is still backed up first)."
        )
        return 1

    backup = backup_active_model()
    ACTIVE_MODEL.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(candidate, ACTIVE_MODEL)
    EVALUATION_PATH.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(evaluation_path, EVALUATION_PATH)

    metadata = {}
    if METADATA_PATH.is_file():
        metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    classes = []
    supported = []
    for index, name in sorted(names.items()):
        letter = grade_letter_from_name(name)
        entry = {"index": index, "name": name}
        if letter:
            entry["grade"] = letter
            if letter not in supported:
                supported.append(letter)
        classes.append(entry)
    supported = sorted(supported, key=lambda value: "ABCD".index(value))
    unsupported = [letter for letter in "ABCD" if letter not in supported]
    metadata.update(
        {
            "id": args.model_id or metadata.get("id", "arecanut-yolov8"),
            "version": args.version or _bump_version(metadata.get("version")),
            "description": (
                "Candidate trained by scripts/train_model.py and promoted only after "
                "an evaluation report was supplied."
            ),
            "artifact": "weights/best.pt",
            "sha256": sha256_of(ACTIVE_MODEL),
            "size_bytes": ACTIVE_MODEL.stat().st_size,
            "task": "detect",
            "classes": classes,
            "supported_grades": supported,
            "unsupported_grades": unsupported,
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "training_report": display_path(evaluation_path),
            "evaluation": {
                "available": True,
                "source": display_path(EVALUATION_PATH),
                "metrics": evaluation.get("metrics", {}),
            },
            "backup": display_path(backup) if backup else None,
        }
    )
    METADATA_PATH.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"Promoted {candidate} -> {ACTIVE_MODEL}")
    print(f"Backup: {backup}")
    print(f"Updated metadata: {METADATA_PATH}")
    print("Restart the server so the new weights are loaded.")
    return 0


def _bump_version(version: str | None) -> str:
    try:
        major, minor, patch = (version or "1.0.0").split(".")
        return f"{major}.{minor}.{int(patch) + 1}"
    except Exception:
        return "1.0.1"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", help="Prepared YOLO data.yaml.")
    parser.add_argument("--weights", help="Base weights (default: active model).")
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", default="auto", help="Batch size or 'auto'.")
    parser.add_argument("--device", default="auto", help="'auto', 'cpu', '0', '0,1' ...")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--patience", type=int, default=15)
    parser.add_argument("--promote", metavar="CANDIDATE_PT", help="Promote a validated candidate.")
    parser.add_argument("--evaluation", help="Evaluation JSON for the candidate (required with --promote).")
    parser.add_argument("--accept-baseline", action="store_true", help="Allow promotion without a prior baseline.")
    parser.add_argument("--model-id", help="Metadata id to record when promoting.")
    parser.add_argument("--version", help="Metadata version to record when promoting.")
    args = parser.parse_args()

    if args.promote:
        return promote(args)
    if not args.data:
        parser.error("--data is required for training (or use --promote).")
    return train(args)


if __name__ == "__main__":
    raise SystemExit(main())
