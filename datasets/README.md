# Project-local training dataset

Put a **genuinely annotated** YOLO detection dataset here:

```text
datasets/
└── arecanut_grades/
    ├── data.yaml
    ├── images/
    │   ├── train/
    │   ├── val/
    │   └── test/
    └── labels/
        ├── train/
        ├── val/
        └── test/
```

`scripts/prepare_dataset.py` looks in `datasets/arecanut_grades` automatically when
`--data` is omitted. No absolute system path is needed, so the same folder works on any
PC.

## Required label format

Each image must have a matching `.txt` file with the same name:

```text
images/train/nut_0001.jpg
labels/train/nut_0001.txt
```

Each line is one nut:

```text
class_id x_center y_center width height
```

Coordinates must be normalised to `0–1`, and the box must tightly enclose one nut.

`data.yaml`:

```yaml
train: images/train
val: images/val
test: images/test
nc: 4
names:
  0: GradeA
  1: GradeB
  2: GradeC
  3: GradeD
```

Use only the grades that are actually present in your annotations. If the dataset only
contains A/B, remove C/D from `names`; the app will keep reporting C/D as unsupported.
Never add C/D boxes unless a human has verified those nuts as C/D.

## What cannot be used

Unlabelled images cannot train a detector. The older public Kaggle datasets inspected for
this project contain image-level folders (ripeness and plant disease), not per-nut
bounding boxes.

The `alwyndsouza21092/arecanut` and `alwyndsouza21092/arecanut-detection-dataset-1`
datasets do contain per-nut boxes, but only one class: `areca_fruit`. They can train a
single-class **nut localizer**, not the `GradeA`/`GradeB`/`GradeC`/`GradeD` grade head.
Do not relabel those boxes as grades. The `class_0` … `class_6` folders in the smaller
dataset have no documented meaning and must not be assumed to be A/B/C/D.

Do not put random images in this folder and expect training to start. `prepare_dataset.py`
requires image/label pairs and at least `--min-boxes` boxes (default 50).

## Workflow

```powershell
# 1. Validate and split the dataset in this folder
python scripts\prepare_dataset.py

# 2. Train a candidate (active model is only backed up, never overwritten)
python scripts\train_model.py --data training_cache\dataset\data.yaml --epochs 60

# 3. Evaluate the candidate on real labels
python scripts\evaluate_model.py `
  --model ml_service\weights\candidates\run_<timestamp>\weights\best.pt `
  --data training_cache\dataset\data.yaml --split val

# 4. Promote only after reviewing the metrics
python scripts\train_model.py `
  --promote ml_service\weights\candidates\run_<timestamp>\weights\best.pt `
  --evaluation training_reports\evaluation_<timestamp>.json
```

Raw images and labels in this folder are git-ignored. Only this README is committed.

## Annotation tools

Any tool that exports YOLO detection labels works, for example Label Studio, CVAT, or
LabelImg. Annotate every visible nut, use tight boxes, and assign a grade only when it is
clear. Ambiguous nuts should be left out rather than guessed.
