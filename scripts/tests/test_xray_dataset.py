"""Unit tests for the explicit X-ray dataset helpers.

Run from the project root:

    python -m unittest discover -s scripts\\tests -v
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from PIL import Image  # noqa: E402

from scripts.xray_dataset import (  # noqa: E402
    CLASS_NAMES,
    duplicate_groups,
    normalise_bbox,
    prefix_expected_category,
    prepare_xray,
    validate_yolo_line,
)


class BboxTests(unittest.TestCase):
    def test_absolute_pixels_become_normalised_yolo(self):
        coords, warnings = normalise_bbox([10, 20, 110, 220], 200, 400)
        self.assertEqual(coords, [0.3, 0.3, 0.5, 0.5])
        self.assertEqual(warnings, [])

    def test_tiny_rounding_overshoot_is_clamped_and_reported(self):
        coords, warnings = normalise_bbox([0, 0, 100.2, 100.2], 100, 100)
        self.assertEqual(coords, [0.5, 0.5, 1.0, 1.0])
        self.assertTrue(warnings)

    def test_reversed_and_zero_area_boxes_are_rejected(self):
        with self.assertRaises(ValueError):
            normalise_bbox([90, 10, 10, 50], 100, 100)
        with self.assertRaises(ValueError):
            normalise_bbox([10, 10, 10, 50], 100, 100)

    def test_clearly_outside_box_is_rejected(self):
        with self.assertRaises(ValueError):
            normalise_bbox([10, 10, 500, 50], 100, 100)


class LabelTests(unittest.TestCase):
    def test_valid_yolo_line(self):
        class_id, coords = validate_yolo_line("2 0.5 0.5 0.25 0.25")
        self.assertEqual(class_id, 2)
        self.assertEqual(coords, [0.5, 0.5, 0.25, 0.25])

    def test_invalid_class_and_coordinates_are_rejected(self):
        with self.assertRaises(ValueError):
            validate_yolo_line("3 0.5 0.5 0.25 0.25")
        with self.assertRaises(ValueError):
            validate_yolo_line("0 1.5 0.5 0.25 0.25")
        with self.assertRaises(ValueError):
            validate_yolo_line("0 0.5 0.5 0 0.25")
        with self.assertRaises(ValueError):
            validate_yolo_line("0 0.5 0.5 0.25")

    def test_prefix_mapping_is_verified_not_guessed(self):
        self.assertEqual(prefix_expected_category("G1_10.jpg"), 0)
        self.assertEqual(prefix_expected_category("G2_10.jpg"), 1)
        self.assertEqual(prefix_expected_category("G3_10.jpg"), 2)
        self.assertIsNone(prefix_expected_category("unknown.jpg"))


class DuplicateTests(unittest.TestCase):
    def test_conflicting_duplicate_is_flagged(self):
        records = [
            {
                "uid": "raw:0",
                "row_index": 0,
                "source_image": "G3_94.jpg",
                "split": "train",
                "sha256": "abc",
                "boxes": [{"category_id": 2, "bbox": [1, 2, 3, 4]}],
            },
            {
                "uid": "raw:1",
                "row_index": 1,
                "source_image": "G2_300.jpg",
                "split": "val",
                "sha256": "abc",
                "boxes": [{"category_id": 1, "bbox": [1, 2, 3, 4]}],
            },
        ]
        groups = duplicate_groups(records)
        self.assertEqual(len(groups), 1)
        self.assertTrue(groups[0]["conflict"])
        self.assertEqual(groups[0]["rows"], [0, 1])


class PrepareTests(unittest.TestCase):
    def _write_raw(self, root: Path) -> None:
        raw = root / "raw"
        images = raw / "images"
        images.mkdir(parents=True)
        Image.new("RGB", (100, 120), color=(30, 30, 30)).save(images / "G1_1.jpg", "JPEG")
        Image.new("RGB", (100, 120), color=(90, 90, 90)).save(images / "G2_1.jpg", "JPEG")
        records = [
            {
                "row_index": 0,
                "source_image": "G1_1.jpg",
                "raw_image": "images/G1_1.jpg",
                "sha256": "hash-1",
                "width": 100,
                "height": 120,
                "split": "Training",
                "boxes": [
                    {"bbox": [10, 10, 90, 110], "category_id": 0},
                ],
            },
            {
                "row_index": 1,
                "source_image": "G2_1.jpg",
                "raw_image": "images/G2_1.jpg",
                "sha256": "hash-2",
                "width": 100,
                "height": 120,
                "split": "Validation",
                "boxes": [
                    {"bbox": [20, 20, 80, 100], "category_id": 1},
                ],
            },
        ]
        with (raw / "annotations.jsonl").open("w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record) + "\n")
        (raw / "dataset_info.json").write_text(
            json.dumps({"download": {"rows": 2}}),
            encoding="utf-8",
        )

    def test_prepare_writes_separate_yolo_dataset(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._write_raw(root)
            output = root / "prepared"
            report = prepare_xray(
                raw_dir=root / "raw",
                output_dir=output,
                manual_dir=root / "manual",
                include_manual=False,
                min_images=1,
                report_path=root / "report.json",
            )
            self.assertTrue(report["prepared"], report.get("error"))
            self.assertEqual(report["splits"], {"train": 1, "val": 1, "test": 0})
            self.assertEqual(report["classes"], CLASS_NAMES)
            self.assertTrue((output / "data.yaml").is_file())
            label = (output / "labels" / "train" / "G1_1.txt").read_text(encoding="utf-8")
            self.assertTrue(label.startswith("0 0.500000 0.500000 0.800000 0.833333"))
            yaml_text = (output / "data.yaml").read_text(encoding="utf-8")
            self.assertIn("XrayGrade1", yaml_text)
            self.assertNotIn("0: GradeA", yaml_text)

    def test_prepare_blocks_invalid_box(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._write_raw(root)
            annotation_path = root / "raw" / "annotations.jsonl"
            lines = annotation_path.read_text(encoding="utf-8").splitlines()
            first = json.loads(lines[0])
            first["boxes"][0]["bbox"] = [90, 10, 10, 110]
            lines[0] = json.dumps(first)
            annotation_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            report = prepare_xray(
                raw_dir=root / "raw",
                output_dir=root / "prepared",
                manual_dir=root / "manual",
                include_manual=False,
                min_images=1,
                report_path=root / "report.json",
            )
            self.assertFalse(report["prepared"])
            self.assertFalse((root / "prepared").exists())


if __name__ == "__main__":
    unittest.main()
