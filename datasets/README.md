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

## Optional X-ray dataset (separate from application grades)

The X-ArecaNet dataset is supported as an optional, explicitly downloaded reference
dataset. It is **not** the same as ordinary tray photographs and it is deliberately
stored under a separate folder:

```text
datasets/
├── arecanut_grades/       # application GradeA..GradeD photos/manual data
└── arecanut_xray/
    ├── raw/               # reusable HF copy: images + annotations.jsonl + caches
    ├── manual/            # optional manually annotated YOLO images
    └── ...
```

Prepared output goes to `training_cache/xray_dataset` (git-ignored). Raw data and the
prepared cache are never committed.

### Verified labels and what they mean

The Hugging Face dataset
`Project-AgML/arecanut_xray_grade_detection` contains 916 images and 923 bounding
boxes. Its category IDs are verified against the original Mendeley archive and the
X-ArecaNet paper:

| Source category | Source meaning | Prepared YOLO class | Application grade? |
| ---: | --- | --- | --- |
| 0 | Grade1 (highest of the three source grades) | `XrayGrade1` | **No** |
| 1 | Grade2 | `XrayGrade2` | **No** |
| 2 | Grade3 (lowest of the three source grades) | `XrayGrade3` | **No** |

The source does **not** contain Grade A, Grade B, Grade C or Grade D labels. Do not
rename `XrayGrade1/2/3` to A/B/C/D or map them to the application's four-grade scale
without independently verified labels. This project keeps the X-ray classes separate so
that an X-ray model cannot be mistaken for an A-D application model.

The source split column contains `Training` (734 rows) and `Validation` (182 rows).
There is no source test split, so prepared test count is 0 unless you import manually
annotated test images. Exact duplicate images are detected; conflicting duplicate
groups are excluded during preparation and reported instead of being silently relabelled.

### Download and prepare (Windows PowerShell)

Install the optional workflow dependencies once:

```powershell
python -m pip install -r scripts\requirements-xray.txt
```

Then run each step explicitly:

```powershell
# 1. Download/reuse the raw HF copy (about 21 MB)
python scripts\download_xray_dataset.py

# Validate the existing copy without downloading
python scripts\download_xray_dataset.py --check

# Replace the raw copy only when you deliberately want a fresh download
python scripts\download_xray_dataset.py --force

# 2. Convert to YOLO, validate every box, and write the separate prepared dataset
python scripts\prepare_xray_dataset.py

# 3. Optional: merge manually annotated X-ray images
python scripts\import_xray_annotations.py --data .\path\to\annotated_yolo
python scripts\prepare_xray_dataset.py --include-manual
```

The download writes `datasets/arecanut_xray/raw/images/`,
`datasets/arecanut_xray/raw/annotations.jsonl` and
`datasets/arecanut_xray/raw/dataset_info.json`. The Hugging Face cache is kept under
`datasets/arecanut_xray/raw/hf_home` and `raw/hf_cache`, so reruns are local and do not
need a second download. `--force` replaces the raw images only after the new copy has
been validated.

### Manual X-ray annotations

Use LabelImg, CVAT, Label Studio or another YOLO-compatible tool. Export an ordinary
YOLO detection dataset with `data.yaml`, `images/` and `labels/`, and use exactly these
class names:

```yaml
nc: 3
names:
  0: XrayGrade1
  1: XrayGrade2
  2: XrayGrade3
```

Then run the importer shown above. The importer validates every image and label, checks
for exact duplicates, copies files into `datasets/arecanut_xray/manual`, and writes a
manifest. It does not draw boxes, invent grades, or change labels. Ambiguous images must
be left out or annotated by a human.

### Training and evaluation are separate commands

Training is not run automatically, and the active `ml_service/weights/best.pt` is never
modified by download or preparation. An X-ray candidate can be trained explicitly with
the existing scripts:

```powershell
python scripts\train_model.py `
  --data training_cache\xray_dataset\data.yaml `
  --epochs 60 `
  --device cpu
```

Evaluate the candidate on the source Validation split and report the real metrics:

```powershell
python scripts\evaluate_model.py `
  --model ml_service\weights\candidates\run_<timestamp>\weights\best.pt `
  --data training_cache\xray_dataset\data.yaml `
  --split val
```

Do not promote an X-ray candidate as the application's A-D model. It has different class
names and domain (X-ray versus ordinary photos). The existing promotion gate recognises
only GradeA..GradeD and will not automatically turn XrayGrade1/2/3 into application
grades.

### Known limitations

- 916 source images, 923 boxes; not the 900-image count mentioned in some paper text.
- 3 exact duplicate groups exist with conflicting source labels/splits; preparation
  excludes conflicting groups and reports them.
- A few source filenames and category IDs disagree; these are reported, never silently
  corrected.
- Bounding boxes are individual-nut boxes in absolute pixel coordinates in the HF copy;
  preparation converts them to normalized YOLO coordinates.
- No Grade A/B/C/D coverage exists in this dataset. The app's C/D limitation remains
  unchanged.

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
