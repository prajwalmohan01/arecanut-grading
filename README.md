# Arecanut Quality Grading System

MERN application for detecting and grading individual arecanuts in a tray image, with a
preserved YOLOv8 detector, a processed/annotated image preview, prediction history, and a
PDF report.

The repository is self-contained: the trained weights (`ml_service/weights/best.pt`,
6.25 MB) are committed, so a second PC can run inference by cloning and installing. No
retraining and no Kaggle download are required for normal use.

## What the bundled model actually supports

| Capability | Status with the bundled checkpoint |
| --- | --- |
| Individual-nut detection (dense trays) | Yes, YOLOv8 detect, tiled inference |
| Grade A / Grade B | Yes |
| Grade C / Grade D | **No.** The checkpoint has only `GradeA` and `GradeB` classes |
| Defect detection (black spots, cracks, mold, discoloration) | **No.** No defect model is bundled |
| Physical size in millimetres | **No.** Requires camera calibration; values are image-space only |
| PDF report with original, annotated and processed images | Yes |

Grade support is derived at runtime from the loaded checkpoint's own class names. The
application is four-grade capable, but it will report C/D only when a promoted checkpoint
actually contains `GradeC`/`GradeD` classes. It never relabels A/B predictions as C/D and
never invents defects, measurements or confidence scores.

The bundled model metadata is in `ml_service/model_metadata.json`, including the SHA-256
checksum and documented limitations.

## Architecture

- **Frontend**: React 18 + Vite + Tailwind CSS (`http://localhost:5173`)
- **Backend**: Node.js + Express + Mongoose (`http://localhost:5000`)
- **Database**: MongoDB
- **ML inference**: Ultralytics YOLOv8, run locally as a Python child process
  (`ML_TRANSPORT=local`, the default) or over HTTP via `ml_service/predict.py`
  (Flask on `:5001`)
- **Auth**: JWT + bcryptjs, user/admin roles

```text
.
├── README.md
├── .gitignore
├── start.ps1                     # Optional root startup helper (PowerShell)
├── client/                       # React frontend
├── server/                       # Express API, MongoDB models, PDF generation
│   ├── .env.example
│   ├── routes/
│   ├── services/
│   ├── utils/pdf.js
│   └── scripts/                  # admin bootstrap helpers
├── ml_service/
│   ├── weights/best.pt           # Committed production model
│   ├── model_metadata.json
│   ├── inference.py              # Single inference implementation
│   ├── standalone_predict.py     # Local CLI used by the API
│   ├── predict.py                # Optional Flask service
│   └── requirements.txt
├── scripts/                      # Manual training/evaluation workflow
│   ├── datasets.py
│   ├── inspect_datasets.py
│   ├── prepare_dataset.py
│   ├── train_model.py
│   ├── evaluate_model.py
│   └── verify_model.py
├── datasets/
│   └── README.md                 # Where to put a real annotated dataset (data is ignored)
└── training_reports/             # Real inspection/blocker reports
```

Raw datasets, Kaggle caches, training runs, candidate weights, backups and uploads are
git-ignored and are never committed.

All scripts resolve paths relative to the project root (or use `~` for the Kaggle cache),
so no `C:\Users\...` path is required and the project can be moved to another PC.

## Requirements

- **Node.js** >= 20 and npm
- **Python** 3.10–3.12 (tested with 3.11)
- **MongoDB** local instance or an Atlas connection string
- Windows (PowerShell) is the primary target; Linux/macOS work with equivalent commands
- Optional for training only: a CUDA GPU (CPU training is possible but slow) and
  `kagglehub` for dataset inspection

## Workflow B — Run on another PC (no retraining, no Kaggle)

This is the normal workflow. The committed weights are used as-is.

### 1. Clone and enter the project

```powershell
git clone https://github.com/Spandana-MJ/arecanut-grading.git
cd arecanut-grading
```

### 2. Create the server environment file

```powershell
Copy-Item server\.env.example server\.env
```

Edit `server\.env`:

```dotenv
MONGO_URI=mongodb://localhost:27017/arecanut_grading
JWT_SECRET=replace_with_a_long_random_secret
```

`JWT_SECRET` must be at least 16 characters. Never commit `server/.env`.

### 3. Install dependencies

```powershell
# Backend
cd server
npm install
cd ..

# Frontend
cd client
npm install
cd ..

# Python inference/training dependencies
python -m pip install -r ml_service\requirements.txt
```

Using a virtual environment is recommended:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r ml_service\requirements.txt
```

If PowerShell blocks activation, run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

### 4. Verify the model artifact

```powershell
python scripts\verify_model.py
```

Expected output includes `Match: True` and exit code `0`. The expected SHA-256 is
`5E141ABD6BD334E61AA733AA00994B8E5AF4D2104A677BE4A7B7215092883268`.

### 5. Create an admin user (optional)

```powershell
cd server
$env:ADMIN_USERNAME="admin"
$env:ADMIN_PASSWORD="choose_a_strong_password"
node scripts\setAdmin.js
cd ..
```

You can also sign up normally from the web UI and use that account.

### 6. Start MongoDB

Use an existing local `mongod`, a MongoDB service, or Atlas. Confirm the URI in
`server\.env` points to it.

### 7. Start the application

Option A, root helper:

```powershell
.\start.ps1
```

`start.ps1` checks Node/Python/model presence, copies `.env.example` to `.env` only when
`.env` is missing, installs dependencies unless `-NoInstall` is passed, then starts the
server on `:5000` and the Vite dev server on `:5173`.

Option B, separate terminals:

```powershell
# Terminal 1
cd server
npm run dev

# Terminal 2
cd client
npm run dev
```

Open `http://localhost:5173`.

The frontend proxies `/api` and `/uploads` to `http://localhost:5000` in development.

### 8. Use it

1. Sign up or log in.
2. Upload a tray image (JPEG, PNG or WebP, up to 10 MB by default).
3. The result page shows:
   - **Original** upload,
   - **Annotated Detection** image with bounding boxes,
   - **Processed Model-Input Preview**,
   - grade composition, image-level grade, confidence, quality heuristic,
   - an explicit notice when C/D or defects are not supported.
4. Download the PDF report from the result or history page.

No training runs at startup or during prediction.

## Inference settings for dense images

Defaults are tuned for dense tray images and live in `ml_service/inference.py`. Override
them in `server\.env` (they are inherited by the Python child process) or in the
environment that starts the Flask service.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MODEL_CONF` | `0.05` | Confidence threshold |
| `MODEL_IMGSZ` | `1280` | Inference image size |
| `MODEL_IOU` | `0.35` | NMS IoU threshold |
| `MODEL_MAX_DET` | `2000` | Maximum detections per image |
| `MODEL_AUGMENT` | `true` | Test-time augmentation |
| `USE_TILED` | `true` | Tiled inference for small/dense nuts |
| `TILE_SIZE` | `640` | Tile size in pixels |
| `TILE_OVERLAP` | `0.25` | Tile overlap fraction |

Lower `MODEL_IMGSZ`, disable `MODEL_AUGMENT`, or disable `USE_TILED` on a slow CPU. Higher
settings improve recall on dense trays but increase processing time.

## Workflow A — One-time training (only when real labelled data exists)

Training is a manual, explicit workflow. The application never trains on startup, never
downloads datasets at runtime, and never promotes a model automatically.

### Reality check: what the public datasets contain

`training_reports/dataset_inspection.md` and `.json` record the real inspection of the
five Kaggle datasets registered in `scripts/datasets.py`:

| Dataset | Images found | Annotations | Label level | A/B/C/D nut labels |
| --- | ---: | --- | --- | --- |
| `duvacs/new-arecanut` | 1,167 | 0 | image-level (`Ripenes` / `Unripen`) | none |
| `subrahmanya090/arecanut` | 424 (truncated archive, lower bound) | 0 | image-level folders | none |
| `tejpaviraj/arecanut` | 2,107 (truncated archive, lower bound) | 0 | image-level plant/leaf disease folders | none |
| `alwyndsouza21092/arecanut` | 4,501 | VIA CSV + JSON: 2,435 unique boxes / 1,531 images | single class `areca_fruit`; 7 opaque `class_*` folders | none |
| `alwyndsouza21092/arecanut-detection-dataset-1` | 10,650 | VIA CSV: 8,374 boxes / 5,986 images | single class `areca_fruit` | none |

The first three datasets are image-level classifications (ripeness or plant/leaf disease),
not nut-grade detection datasets. The two `alwyndsouza21092` datasets contain real
individual-nut bounding boxes, which is enough to train a **single-class nut localizer**.
Every box is labelled `areca_fruit`, so they cannot train the application's GradeA/GradeB/
GradeC/GradeD head. Their `class_0` … `class_6` folders are opaque; this project does not
guess their meanings or map them to grades. The two older archives are truncated and have
no end-of-central-directory record, so their counts are lower bounds.

Grade C/D becomes possible only after you supply a YOLO-format detection dataset that
genuinely labels individual nuts as `GradeA`, `GradeB`, `GradeC`, `GradeD`. The
`alwyndsouza21092` annotations can be converted to YOLO with the single class
`areca_fruit` for localizer work, but they must not be relabelled as grades.

Inspection downloads only the annotation file for the 18.3 GB
`alwyndsouza21092/arecanut-detection-dataset-1` dataset. The full image archive is never
downloaded just to inspect labels.

### 1. Get and inspect data (optional, for inspection only)

```powershell
python -m pip install kagglehub
python scripts\inspect_datasets.py
```

Inspect an already-downloaded copy without network access:

```powershell
python scripts\inspect_datasets.py --no-download `
  --dataset-path duvacs_new_arecanut=".\\datasets\\inspection\\duvacs"
```

or point it at KaggleHub's cache using a portable environment variable:

```powershell
python scripts\inspect_datasets.py --no-download `
  --dataset-path duvacs_new_arecanut="$env:USERPROFILE\\.cache\\kagglehub\\datasets\\duvacs\\new-arecanut\\versions\\1"
```

Reports are written to `training_reports/dataset_inspection.json` and `.md`.

KaggleHub caches raw data outside the repository. If Kaggle asks for credentials, use the
standard Kaggle mechanism (`%USERPROFILE%\.kaggle\kaggle.json` or the
`KAGGLE_USERNAME`/`KAGGLE_KEY` environment variables). Never put credentials in the repo.

### 2. Put a genuine YOLO detection dataset in the project

Place it here (this exact folder is detected automatically):

```text
datasets/
└── arecanut_grades/
    ├── data.yaml              # names: [GradeA, GradeB, GradeC, GradeD]
    ├── images/
    │   ├── train/
    │   ├── val/
    │   └── test/
    └── labels/
        ├── train/
        ├── val/
        └── test/
```

See `datasets/README.md` for the label format and annotation guidance. The folder is
git-ignored, so the images/labels stay on your PC while the workflow remains portable.

Each label file contains one line per nut:
`class_id x_center y_center width height` with normalised coordinates (0–1).

If your data has no splits, place all image/label pairs anywhere under `images/` and
`labels/` and let `prepare_dataset.py` create a deterministic 70/20/10 split.

### 3. Prepare the dataset

```powershell
python scripts\prepare_dataset.py
```

`prepare_dataset.py` uses `datasets/arecanut_grades` automatically. To use a different
folder, pass `--data .\datasets\other-dataset`.

- Validates every label and rejects malformed boxes/classes.
- Removes exact duplicate images by SHA-256 by default.
- Creates a deterministic split and guarantees a non-empty validation set.
- Writes prepared data to `training_cache/dataset` (git-ignored, project-relative).
- If no real annotated dataset is supplied, it writes a blocker report and exits with
  code `2` instead of inventing data.

Optional near-duplicate removal:

```powershell
python scripts\prepare_dataset.py --near-duplicates
```

Use this deliberately: the coarse average hash can merge genuinely different nuts.

### 4. Train a candidate

```powershell
python scripts\train_model.py --data training_cache\dataset\data.yaml --epochs 60 --imgsz 640
```

What happens:

- The active model is backed up to `ml_service/weights/backups/` with its checksum.
- The base weights default to the active model (`--weights` overrides).
- The run is written under `ml_service/weights/candidates/run_<UTC timestamp>/`.
- `ml_service/weights/best.pt` is **not** touched.
- Real validation metrics are read from the Ultralytics run and written to
  `training_reports/training_run_<timestamp>.json`.
- `--batch auto` enables Ultralytics AutoBatch; numeric values are also accepted.
- Use `--device cpu` if no GPU is available.

### 5. Evaluate the candidate

```powershell
python scripts\evaluate_model.py `
  --model ml_service\weights\candidates\run_<timestamp>\weights\best.pt `
  --data training_cache\dataset\data.yaml `
  --split val
```

This runs a real Ultralytics validation and writes
`training_reports/evaluation_<timestamp>.json` with actual precision, recall, mAP50 and
mAP50-95. It does not fabricate metrics. `--install-metrics` is accepted only when the
evaluated model is the active model.

### 6. Promote only after review

Promotion is gated and explicit:

```powershell
python scripts\train_model.py `
  --promote ml_service\weights\candidates\run_<timestamp>\weights\best.pt `
  --evaluation training_reports\evaluation_<timestamp>.json `
  --model-id arecanut-yolov8-gradeabcd `
  --version 2.0.0
```

The script refuses to promote without an evaluation report. It compares candidate metrics
with the recorded baseline and also refuses if the candidate is worse unless
`--accept-baseline` is passed. The active model is backed up before replacement, and
`ml_service/model_metadata.json` is updated.

After promotion, restart the API so the new checkpoint is loaded:

```powershell
# Stop the old server process, then:
cd server
npm start
```

Confirm the new class support:

```powershell
python scripts\verify_model.py
```

The result page and `/api/health` should now report C/D as supported only if the new
checkpoint genuinely contains `GradeC`/`GradeD`.

## API summary

All scan endpoints require `Authorization: Bearer <token>`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Create account |
| `POST` | `/api/auth/login` | Obtain JWT |
| `POST` | `/api/scans/predict` | Upload image (multipart field `file`) and run inference |
| `GET` | `/api/scans/:id` | Scan details |
| `GET` | `/api/scans/:id/image/:kind` | `original`, `annotated` or `processed` JPEG |
| `GET` | `/api/scans/:id/report.pdf` | PDF report |
| `GET` | `/api/scans/history` | Paginated history, filters, summary |
| `GET` | `/api/scans/stats` | Aggregate statistics |
| `GET` | `/api/health` | Server, database and model readiness |

A prediction response contains `gradeA`, `gradeB`, `gradeC`, `gradeD`, `totalCount`,
`finalGrade`, and a `scan` object with `gradeCounts`, `supportedGrades`, `detections`,
`warnings`, and model metadata.

## PDF report

`server/utils/pdf.js` produces an A4 report with:

- original image,
- processed model-input preview and annotated detection image,
- grade composition and model-support notice,
- defect and measurement sections that say "not supported"/"calibration required" when
  applicable,
- every detection in a bounded table,
- warnings and result summary,
- page numbers and footer exactly once per page.

The footer is drawn inside the bottom margin with the margin temporarily disabled so
PDFKit does not append blank pages.

## Testing and verification

```powershell
# Model checksum
python scripts\verify_model.py

# Server syntax
cd server
node --check index.js
node --check app.js
cd ..

# Frontend production build
cd client
npm run build
cd ..
```

## Troubleshooting

- **`Match: False` from `verify_model.py`**: the weights file is missing or modified.
  Restore `ml_service/weights/best.pt` from the repository; do not retrain to fix a
  checksum mismatch.
- **Mongo connection error**: confirm MongoDB is running and `MONGO_URI` is correct.
- **`python` not found**: install Python 3.10–3.12 and ensure it is on `PATH`, or set
  `PYTHON_PATH` in `server\.env` to the full interpreter path.
- **Local inference timeout**: lower `MODEL_IMGSZ`, set `MODEL_AUGMENT=false`, or set
  `USE_TILED=false`; raise `ML_TIMEOUT_MS` if needed.
- **`JWT_SECRET` error**: set a value of at least 16 characters in `server\.env`.
- **Port conflict**: change `PORT` in `server\.env`; update the Vite proxy in
  `client/vite.config.js` if the API port changes.
- **PowerShell script blocked**: run
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- **Kaggle download fails or times out**: downloads are large; use a long-running
  terminal, or point `--dataset-path` at an existing local copy.
- **No C/D results**: expected with the bundled model. C/D requires a validated,
  promoted four-class checkpoint.

## Honest limitations

- The bundled checkpoint detects only Grade A and Grade B. C/D are reported as
  unsupported, not guessed.
- No defect model is bundled; defect sections state that detection was not evaluated.
- Physical millimetre measurements are unavailable without camera calibration; only
  image-space box sizes are shown.
- No verified held-out evaluation report is bundled for the preserved weights, so no
  accuracy metrics are claimed.
- The older public Kaggle datasets inspected are image-level classification datasets. The
  two `alwyndsouza21092` datasets add real nut-level boxes, but only the single class
  `areca_fruit`; they cannot support A/B/C/D grade training without new annotation work.
- Confidence and quality scores are documented heuristics/aggregates, not calibrated
  probabilities or laboratory grades.
- Reports are automated estimates, not certified commercial grading.

## Security notes

- Never commit `server/.env`, Kaggle credentials, datasets, uploads, candidates or backups.
- Change the example `JWT_SECRET` and admin password before sharing a deployment.
- Passwords are hashed with bcrypt and never logged.
- The API validates uploaded files by type and size and isolates scans per user.
