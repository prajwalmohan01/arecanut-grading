"""
Local CLI inference used by the Node backend when ML transport is ``local``.

Usage:
    python standalone_predict.py "path/to/image.jpg"

Exactly one JSON object is written to stdout. Diagnostics go to stderr.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback

from inference import ImageDecodeError, ModelArtifactError, analyse_image_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Run preserved YOLO model on one image")
    parser.add_argument("image", help="Path to a JPEG, PNG, or WebP image")
    parser.add_argument(
        "--pretty", action="store_true", help="Pretty-print JSON (larger output)"
    )
    args = parser.parse_args()

    image_path = os.path.normpath(args.image)
    if not os.path.isfile(image_path):
        print(json.dumps({"error": f"Image not found: {image_path}"}), flush=True)
        return 1

    try:
        result = analyse_image_path(image_path)
        if args.pretty:
            print(json.dumps(result, indent=2), flush=True)
        else:
            print(json.dumps(result, separators=(",", ":")), flush=True)
        return 0
    except (ImageDecodeError, ModelArtifactError) as exc:
        print(json.dumps({"error": str(exc)}), flush=True)
        return 1
    except Exception as exc:  # pragma: no cover - defensive
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"error": str(exc)}), flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
