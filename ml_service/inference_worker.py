"""
Persistent local inference worker.

The Node backend spawns this process once and keeps it alive so the YOLO
checkpoint is loaded a single time instead of once per uploaded image. Model
loading dominates cold-start latency (~20 s on CPU), while a warm analysis takes
well under 2 s for typical tray photos.

Protocol (one JSON object per line, UTF-8):

    -> {"id": "1", "action": "predict", "image": "C:/path/to/photo.jpg"}
    <- {"id": "1", "ok": true, "result": {...}}
    <- {"id": "1", "ok": false, "error": "..."}

    -> {"id": "2", "action": "health"}
    <- {"id": "2", "ok": true, "result": {...}}
    <- {"id": "2", "ok": false, "error": "..."}

    -> {"action": "shutdown"}
    <- {"ok": true, "result": {"shutdown": true}}
    (process exits 0)

The worker never trains, mutates, or replaces the model. It uses exactly the
same ``inference.analyse_image_path`` implementation as the one-shot CLI, so
results are identical; only the process lifetime differs.
"""

from __future__ import annotations

import json
import os
import sys
import traceback

# Make ``import inference`` work regardless of the caller's working directory.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from inference import (  # noqa: E402  (path setup must run first)
    ImageDecodeError,
    ModelArtifactError,
    analyse_image_path,
    health_payload,
    load_model,
    model_info,
)


def _write(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _error_message(exc: Exception) -> str:
    return str(exc) or type(exc).__name__


def _handle(request: dict) -> tuple[dict, bool]:
    """Return ``(response, should_exit)`` for one decoded request."""
    request_id = request.get("id")
    action = request.get("action") or "predict"

    def response(ok: bool, payload_key: str, payload) -> dict:
        base = {"id": request_id, "ok": ok}
        base[payload_key] = payload
        return base

    if action == "shutdown":
        return response(True, "result", {"shutdown": True}), True

    if action == "health":
        return response(True, "result", health_payload()), False

    if action == "info":
        return response(True, "result", model_info()), False

    if action != "predict":
        return response(False, "error", f"Unknown action: {action}"), False

    image_path = request.get("image")
    if not image_path or not isinstance(image_path, str):
        return response(False, "error", "Request is missing an image path."), False

    image_path = os.path.normpath(image_path)
    if not os.path.isfile(image_path):
        return response(False, "error", f"Image not found: {image_path}"), False

    try:
        return response(True, "result", analyse_image_path(image_path)), False
    except (ImageDecodeError, ModelArtifactError) as exc:
        return response(False, "error", _error_message(exc)), False
    except Exception as exc:  # pragma: no cover - depends on runtime/model
        traceback.print_exc(file=sys.stderr)
        return response(False, "error", _error_message(exc)), False


def main() -> int:
    # Load the checkpoint before announcing readiness so the first request is
    # already warm. If loading fails, report it and exit non-zero; the backend
    # treats that as an unavailable worker and can fall back to the CLI.
    try:
        load_model()
        info = model_info()
    except Exception as exc:  # pragma: no cover - depends on environment
        traceback.print_exc(file=sys.stderr)
        _write({"type": "ready", "ok": False, "error": _error_message(exc)})
        return 1

    _write(
        {
            "type": "ready",
            "ok": True,
            "pid": os.getpid(),
            "model": {
                "id": info.get("id"),
                "version": info.get("version"),
                "classes": info.get("classes"),
                "supported_grades": info.get("supported_grades"),
                "loaded_at": info.get("loaded_at"),
            },
        }
    )
    print("[worker] ready", file=sys.stderr, flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            _write({"id": None, "ok": False, "error": f"Invalid JSON: {exc}"})
            continue
        if not isinstance(request, dict):
            _write({"id": None, "ok": False, "error": "Request must be a JSON object."})
            continue

        response, should_exit = _handle(request)
        _write(response)
        if should_exit:
            print("[worker] shutdown requested", file=sys.stderr, flush=True)
            return 0

    print("[worker] stdin closed, exiting", file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
