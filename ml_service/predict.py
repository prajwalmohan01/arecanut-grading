"""
Flask microservice for arecanut inference.

The trained model is loaded lazily and reused for every request. The service
never trains or modifies the model. Errors are returned as JSON with a clear
status code instead of silently falling back to an untrained model.
"""

from __future__ import annotations

import logging
import os
import sys

from flask import Flask, jsonify, request

from inference import (
    ImageDecodeError,
    ModelArtifactError,
    analyse_image,
    decode_image_bytes,
    health_payload,
    load_model,
    model_info,
)

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
logger = logging.getLogger("arecanut-ml")

MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "15")) * 1024 * 1024


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
    app.config["JSON_SORT_KEYS"] = False

    @app.get("/health")
    def health():
        payload = health_payload()
        return jsonify(payload), (200 if payload["model"]["artifact"]["exists"] else 503)

    @app.get("/model-info")
    def model_information():
        return jsonify(model_info()), 200

    @app.post("/predict")
    def predict():
        if "file" not in request.files:
            return jsonify({"error": "No file uploaded"}), 400

        upload = request.files["file"]
        if not upload or not upload.filename:
            return jsonify({"error": "Empty filename"}), 400

        try:
            data = upload.read()
            image = decode_image_bytes(data)
            result = analyse_image(image)
            logger.info(
                "Prediction complete: grade=%s detections=%s duration=%.2fms",
                result["final_grade"],
                result["total"],
                result["processing_ms"],
            )
            return jsonify(result), 200
        except ImageDecodeError as exc:
            return jsonify({"error": str(exc)}), 400
        except ModelArtifactError as exc:
            logger.error("Model artifact error: %s", exc)
            return jsonify({"error": str(exc)}), 503
        except Exception as exc:  # pragma: no cover - unexpected runtime failure
            logger.exception("Prediction failed")
            return jsonify({"error": f"Inference failed: {exc}"}), 500

    @app.errorhandler(413)
    def too_large(_error):
        return (
            jsonify(
                {
                    "error": f"Uploaded file exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)}MB limit"
                }
            ),
            413,
        )

    return app


app = create_app()

if __name__ == "__main__":
    try:
        load_model()
        logger.info("Trained model loaded successfully: %s", model_info()["id"])
    except ModelArtifactError as exc:
        logger.error("Model not ready: %s", exc)
        sys.exit(1)

    port = int(os.environ.get("PORT", "5001"))
    logger.info("ML service listening on port %s", port)
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)
