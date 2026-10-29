"""Unit tests for tiling, de-duplication, and the worker protocol.

Run from the repository root:
    python -m unittest discover -s scripts/tests -p "test_*.py" -v
"""

from __future__ import annotations

import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ML_DIR = os.path.join(ROOT, "ml_service")
for path in (ROOT, ML_DIR):
    if path not in sys.path:
        sys.path.insert(0, path)

import inference  # noqa: E402
import inference_worker  # noqa: E402


class TilePlanTests(unittest.TestCase):
    def setUp(self):
        self._original = (inference.TILE_SIZE, inference.TILE_OVERLAP)
        inference.TILE_SIZE = 640
        inference.TILE_OVERLAP = 0.25

    def tearDown(self):
        inference.TILE_SIZE, inference.TILE_OVERLAP = self._original

    def test_small_image_is_single_full_tile(self):
        plan, shape = inference.tile_plan(425, 283)
        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0][:4], (0, 0, 425, 283))
        self.assertEqual(shape, (425, 283))

    def test_large_image_is_fully_covered(self):
        width, height = 1500, 2000
        plan, shape = inference.tile_plan(width, height)
        self.assertEqual(shape, (640, 640))
        self.assertGreater(len(plan), 1)

        # Sample the pixel grid: every point must fall inside at least one tile.
        for y in range(0, height, 37):
            for x in range(0, width, 41):
                covered = any(
                    x1 <= x < x2 and y1 <= y < y2
                    for x1, y1, x2, y2, _ in plan
                )
                self.assertTrue(covered, f"pixel ({x},{y}) is not covered")

    def test_edge_tiles_are_full_size(self):
        plan, _ = inference.tile_plan(1500, 2000)
        for x1, y1, x2, y2, _ in plan:
            self.assertLessEqual(x2 - x1, 640)
            self.assertLessEqual(y2 - y1, 640)
            self.assertGreater(x2 - x1, 0)
            self.assertGreater(y2 - y1, 0)
        right_edges = {x2 for _, _, x2, _, _ in plan}
        bottom_edges = {y2 for _, _, _, y2, _ in plan}
        self.assertIn(1500, right_edges)
        self.assertIn(2000, bottom_edges)

    def test_core_boxes_stay_inside_tiles(self):
        plan, _ = inference.tile_plan(1500, 2000)
        for x1, y1, x2, y2, core in plan:
            self.assertGreaterEqual(core[0], x1)
            self.assertGreaterEqual(core[1], y1)
            self.assertLessEqual(core[2], x2)
            self.assertLessEqual(core[3], y2)
            self.assertLess(core[0], core[2])
            self.assertLess(core[1], core[3])


class DedupeTests(unittest.TestCase):
    @staticmethod
    def detection(box, confidence=0.9, label="GradeA"):
        return {"bbox": list(box), "confidence": confidence, "label": label}

    def test_identical_boxes_are_merged(self):
        detections = [
            self.detection([10, 10, 50, 50], 0.9),
            self.detection([10, 10, 50, 50], 0.8),
        ]
        kept = inference.dedupe_detections(detections, iou_thresh=0.5)
        self.assertEqual(len(kept), 1)
        self.assertAlmostEqual(kept[0]["confidence"], 0.9)

    def test_adjacent_nuts_are_kept(self):
        detections = [
            self.detection([0, 0, 40, 40]),
            self.detection([40, 0, 80, 40]),
            self.detection([0, 40, 40, 80]),
        ]
        kept = inference.dedupe_detections(detections, iou_thresh=0.5)
        self.assertEqual(len(kept), 3)

    def test_nested_box_is_merged(self):
        detections = [
            self.detection([0, 0, 100, 100], 0.9),
            self.detection([10, 10, 90, 90], 0.7),
        ]
        kept = inference.dedupe_detections(detections, iou_thresh=0.99)
        self.assertEqual(len(kept), 1)

    def test_shifted_overlapping_box_is_merged(self):
        detections = [
            self.detection([0, 0, 100, 100], 0.9),
            self.detection([20, 20, 120, 120], 0.6),
        ]
        kept = inference.dedupe_detections(
            detections, iou_thresh=0.99, center_ratio=0.4
        )
        self.assertEqual(len(kept), 1)

    def test_confidence_order_is_preserved(self):
        detections = [
            self.detection([0, 0, 100, 100], 0.2),
            self.detection([200, 200, 300, 300], 0.95),
        ]
        kept = inference.dedupe_detections(detections, iou_thresh=0.5)
        self.assertEqual([item["confidence"] for item in kept], [0.95, 0.2])


class WorkerProtocolTests(unittest.TestCase):
    def test_unknown_action_returns_error(self):
        response, should_exit = inference_worker._handle({"id": "1", "action": "train"})
        self.assertFalse(should_exit)
        self.assertFalse(response["ok"])
        self.assertIn("Unknown action", response["error"])

    def test_missing_image_returns_error(self):
        response, should_exit = inference_worker._handle(
            {"id": "2", "action": "predict"}
        )
        self.assertFalse(should_exit)
        self.assertFalse(response["ok"])
        self.assertIn("image", response["error"].lower())

    def test_missing_file_returns_error(self):
        response, should_exit = inference_worker._handle(
            {"id": "3", "action": "predict", "image": "does-not-exist.jpg"}
        )
        self.assertFalse(should_exit)
        self.assertFalse(response["ok"])
        self.assertIn("not found", response["error"].lower())

    def test_shutdown_is_acknowledged(self):
        response, should_exit = inference_worker._handle({"action": "shutdown"})
        self.assertTrue(should_exit)
        self.assertTrue(response["ok"])
        self.assertTrue(response["result"]["shutdown"])


if __name__ == "__main__":
    unittest.main()
