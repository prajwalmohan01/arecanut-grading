# Inference benchmark: baseline vs upgraded

All numbers below come from runs on this machine (Windows, CPU-only PyTorch
2.1.2, Ultralytics 8.4.33, Python 3.11.9). They are local measurements, not
published model metrics.

## What is measured

The benchmark script (`scripts/benchmark_inference.py`) reports **localisation**
quality: a prediction counts as a true positive when its box overlaps a
ground-truth nut box at IoU >= 0.50. Ground-truth class names are ignored.

This is **not** Grade A/B accuracy. The benchmark dataset (`CSVTU Arecanut`
v2 test split) labels nuts as `ripe`/`unripe`, not as Grade A/B/C/D. No supplied
dataset contains individual-nut grade labels, so grade accuracy remains
unmeasured (see `roboflow_compatibility.md`).

Raw reports:

- `benchmark_baseline_csvtu.json` — pre-upgrade-equivalent settings
- `benchmark_upgraded_csvtu.json` — current settings
- `benchmark_large_tray_legacy.json` — unlabelled 1500x2000 tray, legacy NMS/augment replay
- `benchmark_large_tray_upgraded.json` — unlabelled 1500x2000 tray, upgraded path
- `benchmark_dedupe_legacy.json`, `benchmark_dedupe_new.json`,
  `benchmark_dedupe_tight.json` — 20-image de-duplication sweep

## CSVTU v2 test split

- 69 images, 4,377 ground-truth nuts (63.43 per image)
- Match IoU 0.50, confidence 0.05

| Setting | Precision | Recall | F1 | Mean predictions | Mean time/image |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline: full image, imgsz 1280, augment on, legacy NMS | 0.5906 | 0.1928 | 0.2907 | 20.71 | 1.244 s |
| Upgraded: full image, imgsz 1280, augment off, tile de-dupe | 0.7337 | 0.1825 | 0.2924 | 15.78 | 0.591 s |

Changes: precision **+0.1431 absolute (+24.2% relative)**, recall **-0.0103
absolute**, F1 **+0.0017**, mean inference wall time **-52.5%** (1.24 s -> 0.59 s).
Timings vary with CPU load; a second pair of runs earlier measured 2.31 s vs
1.02 s, so treat the direction and rough magnitude as the result, not the
millisecond digits.

Honest reading: turning test-time augmentation off removes many false positives
and roughly halves runtime, but it does not improve recall on this dense,
small-nut dataset. The preserved checkpoint still finds only about one in five
ground-truth nuts at this threshold. Tiling does not engage on these 640x640
images; that is expected.

The baseline numbers reproduce the earlier pre-upgrade measurement
(precision 0.5906, recall 0.1928, F1 0.2907, 20.71 predictions/image), which
confirms the benchmark harness is consistent.

## Large tray image (1500x2000, no ground-truth labels)

The original upload was also measured end-to-end through the inference
pipeline. Times include decoding, inference, de-duplication, drawing, and JPEG
preview encoding; the first image in a process also pays the one-time model
load.

| Path | Tiles | Detections | Wall time |
| --- | ---: | ---: | ---: |
| Original code, recorded before this upgrade (old 9-tile loop) | 9 | 104 | 13.29 s |
| Legacy replay on current code: edge-aligned plan, 1280 px tiles, augment on, IoU NMS | 12 | 116 | 18.56 s |
| Upgraded: edge-aligned plan, 640 px tiles, augment off, de-dupe | 12 | 110 | 5.97 s |
| Upgraded via persistent worker, steady-state warm (model already loaded) | 12 | 110 | 1.5-2.0 s |

The original row was recorded interactively before any code changed; its image
and machine were the same, but the old process/loop is gone, so it cannot be
replayed exactly. The replay uses the new edge-aligned plan, which covers the
right and bottom borders the old loop skipped (12 tiles instead of 9). That is
why it is slower than the original row despite otherwise "legacy" settings, and
why it finds more boxes. The replay is useful as an upper bound on the cost of
augmentation plus 1280 px tiles, not as a byte-for-byte reproduction.

The upgraded de-duplicator removes 70 overlapping duplicates, leaving 110. On
this unlabelled tray we cannot prove that 110 is more correct than 116, only that
coverage is more uniform and runtime is much lower. The user-visible result moved
from 104 detections (Grade B, 30.1% confidence) to 110 detections (13 Grade A,
97 Grade B, Grade B, 41.8% confidence). Single-image cold timings varied between
4.0 s and 6.2 s on this machine; the committed JSON records 5.97 s.

## De-duplication check on dense tiles

To check that aggressive duplicate removal does not destroy real nuts, 20 dense
CSVTU images were forced through 320 px tiles at 320 px inference size, with
model NMS IoU 0.50 in all three runs:

| Suppression | Precision | Recall | F1 | Mean predictions |
| --- | ---: | ---: | ---: | ---: |
| Legacy IoU-only NMS at 0.50 | 0.2567 | 0.1557 | 0.1938 | 33.50 |
| New de-dupe (merge IoU 0.45, centre 0.30) | 0.3289 | 0.1348 | 0.1913 | 22.65 |
| New de-dupe (merge IoU 0.50, centre 0.20) | 0.3130 | 0.1348 | 0.1885 | 23.80 |

The de-duplicator trades about 2 recall points for about 7 precision points and
fewer duplicate boxes. F1 is effectively unchanged. This is a deliberate
precision/coverage trade-off, not a free improvement. Wall times are omitted
because these short runs varied with CPU load; quality counts are deterministic.
`TILE_MERGE_IOU` and `TILE_DUPLICATE_CENTER_RATIO` remain configurable for future
labelled tuning.

## Reproduce

```powershell
python scripts/benchmark_inference.py `
  --images "$env:TEMP\opencode\csvtu_arecanut\test\images" `
  --labels "$env:TEMP\opencode\csvtu_arecanut\test\labels" `
  --output "$env:TEMP\opencode\benchmark_upgraded.json" `
  --imgsz 1280 --iou 0.5

python scripts/benchmark_inference.py `
  --images "$env:TEMP\opencode\csvtu_arecanut\test\images" `
  --labels "$env:TEMP\opencode\csvtu_arecanut\test\labels" `
  --output "$env:TEMP\opencode\benchmark_baseline.json" `
  --no-tiling --imgsz 1280 --augment --legacy-nms --iou 0.5

# De-duplication sweep (three runs; change the merge flags for each row)
python scripts/benchmark_inference.py `
  --images "$env:TEMP\opencode\csvtu_arecanut\test\images" `
  --labels "$env:TEMP\opencode\csvtu_arecanut\test\labels" `
  --limit 20 --tile-size 320 --tile-imgsz 320 --iou 0.5 `
  --legacy-nms --output training_reports\benchmark_dedupe_legacy.json
python scripts/benchmark_inference.py `
  --images "$env:TEMP\opencode\csvtu_arecanut\test\images" `
  --labels "$env:TEMP\opencode\csvtu_arecanut\test\labels" `
  --limit 20 --tile-size 320 --tile-imgsz 320 --iou 0.5 `
  --tile-merge-iou 0.45 --tile-center-ratio 0.30 `
  --output training_reports\benchmark_dedupe_new.json
python scripts/benchmark_inference.py `
  --images "$env:TEMP\opencode\csvtu_arecanut\test\images" `
  --labels "$env:TEMP\opencode\csvtu_arecanut\test\labels" `
  --limit 20 --tile-size 320 --tile-imgsz 320 --iou 0.5 `
  --tile-merge-iou 0.50 --tile-center-ratio 0.20 `
  --output training_reports\benchmark_dedupe_tight.json
```

The CSVTU export used for benchmarking was downloaded to a temporary directory
and is not part of this repository.

## Limitations

- No verified Grade A/B/C/D holdout exists, so grade accuracy is unknown.
- CSVTU labels are ripeness classes; they are treated only as nut locations.
- The large tray has no ground-truth boxes; detection counts are descriptive.
- CPU timings vary with load; compare relative numbers, not absolute ones.
- Twenty images are enough to catch a gross de-duplication regression, not to
  tune production thresholds.
