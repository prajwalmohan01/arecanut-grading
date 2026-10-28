# Arecanut Quality Grading System

MERN application for detecting and grading individual arecanuts in a tray image, with a
preserved YOLOv8 detector, a processed/annotated image preview, prediction history, and a
PDF report. It also includes a separate manual grading workspace for user-assigned Grade A
and Grade B records, batches, review and correction history, PDF/CSV reports, QR
verification, and user-entered value calculations.

The repository is self-contained: the trained weights (`ml_service/weights/best.pt`,
6.25 MB) are committed, so a second PC can run inference by cloning and installing. No
retraining, no dataset download, and no Kaggle account are required for normal use.

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
application is four-grade capable, but it will report C/D only when an installed checkpoint
actually contains `GradeC`/`GradeD` classes. It never relabels A/B predictions as C/D and
never invents defects, measurements or confidence scores.

The bundled model metadata is in `ml_service/model_metadata.json`, including the SHA-256
checksum and documented limitations.

## Quick start

Prerequisites: Node.js 20+, Python 3.10–3.12, and MongoDB running locally (or an Atlas
connection string).

```powershell
git clone https://github.com/prajwalmohan01/arecanut-grading.git
cd arecanut-grading
.\setup.ps1
# Edit server\.env if you need a different MONGO_URI or JWT_SECRET.
.\start.ps1
```

Open `http://localhost:5173`. On Linux/macOS use `bash setup.sh` instead of `setup.ps1`,
then start the server and client in separate terminals as shown below.

Both setup scripts resolve paths from the project folder. Nothing is tied to a particular
user profile, drive letter, or installation directory. Normal startup never downloads a
dataset, creates a Kaggle cache, or trains a model.

The model support table above is authoritative: Grade C and Grade D are displayed in the
UI for completeness, but are marked **not evaluated** while the bundled two-class
checkpoint is active.

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
├── setup.ps1                     # Portable one-time setup (PowerShell)
├── setup.sh                      # Portable one-time setup (Linux/macOS)
├── start.ps1                     # Root startup helper (PowerShell)
├── client/                       # React frontend
│   └── src/pages/manual/         # Authenticated manual grading workspace
├── server/                       # Express API, MongoDB models, PDF generation
│   ├── .env.example
│   ├── routes/                   # AI, auth, manual grading, and public verification
│   ├── services/
│   ├── utils/pdf.js              # AI report PDF
│   ├── utils/manualPdf.js        # Manual record, batch, and assessment PDFs
│   ├── tests/                    # node:test unit and in-memory MongoDB integration tests
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

All scripts resolve paths relative to the project root (or use `~` for the optional Kaggle
cache), so no machine-specific absolute path is required and the project can be cloned to
any folder on another PC.

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
git clone https://github.com/prajwalmohan01/arecanut-grading.git
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

Add the following to `server\.env` and restart the API:

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=choose_a_strong_password
ADMIN_DISPLAY_NAME=Administrator
```

On startup the API verifies that account: it creates it when missing or promotes it to the
`admin` role, but never overwrites an existing password. Placeholder passwords such as
`replace_with_a_strong_password` are ignored. The account is stored in MongoDB with a
bcrypt hash; `.env` is only the bootstrap source, not a plaintext login check.

To set or reset the password manually:

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
5. Select multiple images in one go for a **batch**; it is grouped into a **lot** (created
   automatically when you do not pick an existing one). A single image can optionally join a lot.
6. Open **Lots** to review combined counts, enter an average nut weight and per-grade price,
   and export the lot as CSV.
7. Use **Export CSV** on the history page to download the currently filtered records plus a
   summary block (opens in Excel; UTF-8 with BOM).

### Batch grading, lots, and valuation

- **Batch upload** is client-driven: the browser posts images one at a time to
  `POST /api/scans/predict`, so the CPU model is never asked to run two predictions at once.
  A failed image does not stop the rest of the queue.
- A **lot** groups scans and stores optional pricing assumptions (`prices.A`…`prices.D`,
  `avgNutWeightG`, `currency`). Deleting a lot keeps its predictions in history and only
  clears their lot assignment.
- The estimated value is
  `nuts × avgNutWeightG ÷ 1000 × pricePerKg`, summed per grade. `avgNutWeightG` is a
  user-provided assumption; the bundled model measures boxes in image space only, so weight
  is **not** measured from the photo. The UI and CSV label the result as an estimate.
- The history CSV contains a summary block (filters, counts, majority grades, detected nuts)
  followed by a blank line and the per-prediction table.

No training runs at startup or during prediction.

### Manual grading workspace

Open **Manual** in the sidebar, or go to `/manual`. This workspace is independent of the AI
model: it never predicts, infers, or fabricates a grade, measurement, price, or quality
result.

- **Records** (`/manual/new`, `/manual/records`) store an uploaded image, optional sample
  code, quantity, weight, size, appearance/condition, grading date, reviewer, observations,
  and notes. A completed record requires the person to choose **Grade A** or **Grade B**.
  Drafts can be resumed later.
- **Image checks** use browser canvas heuristics for dimensions, brightness, and blur. They
  are advisory only, recorded as metadata, and never assign a grade. Images are served only
  through the authenticated owner's record endpoint.
- **Duplicate handling** compares the SHA-256 content of the uploaded file. An exact
  duplicate returns HTTP `409` with a link to the existing record. The uploader can
  deliberately override the warning; visually similar but different photos are not treated
  as duplicates.
- **Batches** (`/manual/batches`) group samples from one collection and show target/progress
  values based only on stored records. Deleting a batch keeps its records, removes their
  live batch link, and preserves the batch ID/name snapshot on each record. Explicitly
  unassigning a record clears its live snapshot.
- **Review and corrections** store who reviewed the record, review notes, image flags, and a
  field-by-field correction history. Correcting a grade records the reason and marks the
  record for review again.
- **Search, filters, sorting, and pagination** are available on records, batches, prices, and
  the sample gallery. The gallery shows only authenticated images; the comparison view
  accepts exactly two records.
- **Reports** include record PDF/CSV, batch PDF/CSV, and filtered record/price CSV exports.
  Empty values remain empty and every report states that grades were manually assigned.
- **Value calculator** (`/manual/calculator`) multiplies a user-entered weight by a
  user-entered INR price per kilogram. The app does not fetch live market prices and does
  not invent a price when none is entered.
- **Digital assessments** can be created for graded records. The assessment PDF contains a
  QR code and verification link for `/verify/:token`. The public response intentionally
  omits images, notes, supplier details, reviewer/account details, and correction history.
  It is a record-verification aid, not an accredited certificate.
- **Activity** (`/manual/activity`) is a read-only, user-scoped audit trail of manual
  creates, updates, reviews, corrections, exports, assessments, batch changes, and price
  records.

The manual module adds no admin dashboard, language switcher, AI inference, or automated
grading controls.

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

## Workflow A — Optional training reference (not needed to run)

Normal installation and inference never train anything. This section documents the
existing manual tooling for maintainers who later obtain a genuine four-grade labelled
dataset. The application never trains on startup, never downloads datasets at runtime,
and never promotes a model automatically.

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

Grade C/D becomes possible only when the active checkpoint genuinely contains
`GradeC`/`GradeD` classes. Creating such a checkpoint elsewhere requires a YOLO-format
detection dataset that labels individual nuts as `GradeA`, `GradeB`, `GradeC`, `GradeD`.
The `alwyndsouza21092` annotations can be converted to YOLO with the single class
`areca_fruit` for localizer work, but they must not be relabelled as grades. This project
does not train models during setup or startup.

Inspection downloads only the annotation file for the 18.3 GB
`alwyndsouza21092/arecanut-detection-dataset-1` dataset. The full image archive is never
downloaded just to inspect labels.

### Optional X-ray dataset (separate from the active A-D model)

The X-ArecaNet data can be downloaded and prepared explicitly for experiments, but it is
not an application Grade A/B/C/D dataset. It contains 916 individual X-ray images with
923 boxes and three verified source grades:

| Source category | Source grade | Prepared class | A-D coverage |
| ---: | --- | --- | --- |
| 0 | Grade1 | `XrayGrade1` | none |
| 1 | Grade2 | `XrayGrade2` | none |
| 2 | Grade3 | `XrayGrade3` | none |

The mapping is verified from the original Mendeley archive (`G1/G2/G3` folders and
`0/1/2` labels) and the X-ArecaNet paper. The Hugging Face category names remain numeric
strings `"0"`, `"1"`, `"2"`. Do not rename them to Grade A/B/C/D without independently
verified labels. X-ray images are also a different domain from ordinary tray photos and
must not be mixed into the active photo dataset.

Windows PowerShell commands (each step is explicit; nothing runs at startup):

```powershell
# Install optional dataset dependencies without replacing the NumPy/Torch stack
python -m pip install -r scripts\requirements-xray.txt

# 1. Download and preserve a local raw copy under datasets/arecanut_xray/raw
python scripts\download_xray_dataset.py

# Check the existing copy without downloading
python scripts\download_xray_dataset.py --check

# 2. Validate every annotation and create the separate YOLO dataset
python scripts\prepare_xray_dataset.py

# 3. Optional: import manually annotated X-ray images (YOLO format)
python scripts\import_xray_annotations.py --data .\path\to\annotated_yolo
python scripts\prepare_xray_dataset.py --include-manual
```

Prepared data is written to `training_cache/xray_dataset` with class names
`XrayGrade1/2/3`. The source `Training`/`Validation` split is preserved; the source has
no test split, so test is 0. The preparer excludes conflicting exact duplicates and
reports filename/category mismatches instead of silently correcting them. The app's
Performance page shows the generated report only when it exists.

An X-ray candidate can be trained/evaluated explicitly, but it is not an A-D app model:

```powershell
python scripts\train_model.py `
  --data training_cache\xray_dataset\data.yaml `
  --epochs 60 `
  --device cpu

python scripts\evaluate_model.py `
  --model ml_service\weights\candidates\run_<timestamp>\weights\best.pt `
  --data training_cache\xray_dataset\data.yaml `
  --split val
```

Do not promote it as the application model. The existing promotion gate only recognises
`GradeA`–`GradeD`; `XrayGrade1/2/3` stay separate and cannot turn into A-D support.
`ml_service/weights/best.pt` is not changed by download, preparation, or training.

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

or point it at an existing extracted copy using a project-relative path:

```powershell
python scripts\inspect_datasets.py --no-download `
  --dataset-path duvacs_new_arecanut=".\\datasets\\inspection\\duvacs"
```

Reports are written to `training_reports/dataset_inspection.json` and `.md`.

KaggleHub caches raw data outside the repository. If Kaggle asks for credentials, use
Kaggle's standard local configuration (`kaggle.json` in the location expected by the
Kaggle CLI) or the `KAGGLE_USERNAME`/`KAGGLE_KEY` environment variables. Never put
credentials in the repo.

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

All endpoints require `Authorization: Bearer <token>` except signup, login, health, and the
deliberately limited public assessment verification endpoint.

### AI scan and lot endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Create account |
| `POST` | `/api/auth/login` | Obtain JWT |
| `POST` | `/api/scans/predict` | Upload image (multipart field `file`, optional `lotId`) and run inference |
| `GET` | `/api/scans/:id` | Scan details |
| `GET` | `/api/scans/:id/image/:kind` | `original`, `annotated` or `processed` JPEG |
| `GET` | `/api/scans/:id/report.pdf` | PDF report |
| `GET` | `/api/scans/history` | Paginated history, filters (`grade`, `from`, `to`, `q`, `lot`, `sort`), summary |
| `GET` | `/api/scans/export.csv` | Filtered history with a summary block (`grade`, `from`, `to`, `q`, `lot`, `sort`) |
| `GET` | `/api/scans/stats` | Aggregate statistics |
| `POST` | `/api/lots` | Create a lot with optional prices and average nut weight |
| `GET` | `/api/lots` | List lots with combined counts and valuation |
| `GET` | `/api/lots/:id` | Lot summary plus its scans |
| `PATCH` | `/api/lots/:id` | Update lot details, prices, or average nut weight |
| `GET` | `/api/lots/:id/export.csv` | Lot summary and per-scan CSV |
| `DELETE` | `/api/lots/:id` | Delete a lot; its scans are unassigned, not deleted |
| `GET` | `/api/health` | Server, database and model readiness |

A prediction response contains `gradeA`, `gradeB`, `gradeC`, `gradeD`, `totalCount`,
`finalGrade`, and a `scan` object with `gradeCounts`, `supportedGrades`, `lot`, `detections`,
`warnings`, and model metadata.

Lot valuation uses this formula per grade, then sums the result:

```text
estimated value = detected nuts × avgNutWeightG ÷ 1000 × pricePerKg
```

### Manual grading endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/manual/records` | Create a record (multipart field `image`; optional `allowDuplicate=true`) |
| `GET` | `/api/manual/records` | List/filter records with pagination and stored-value summary |
| `GET` | `/api/manual/records/:id` | Record detail, image URL, review, and correction history |
| `PATCH` | `/api/manual/records/:id` | Edit fields, grade, batch assignment, or add a correction reason |
| `DELETE` | `/api/manual/records/:id` | Delete the record and its upload |
| `GET` | `/api/manual/records/:id/image` | Authenticated record image |
| `POST` | `/api/manual/records/:id/review` | Save human review state and notes |
| `POST` | `/api/manual/records/:id/assessment` | Create/reissue a digital assessment and verification URL |
| `GET` | `/api/manual/records/:id/report.pdf` | Manual record PDF |
| `GET` | `/api/manual/records/:id/assessment.pdf` | Assessment PDF with QR code |
| `GET` | `/api/manual/records/export.csv` | Filtered manual record CSV |
| `GET` | `/api/manual/records/compare` | Compare exactly two record IDs (`ids=id1,id2`) |
| `GET` | `/api/manual/records/duplicates` | Exact SHA-256 duplicate groups |
| `POST` | `/api/manual/batches` | Create a manual batch |
| `GET` | `/api/manual/batches` | List/filter batches with progress |
| `GET` | `/api/manual/batches/:id` | Batch summary plus assigned records |
| `PATCH` | `/api/manual/batches/:id` | Update batch fields/status |
| `DELETE` | `/api/manual/batches/:id` | Delete batch, keep and unassign records, preserve snapshots |
| `GET` | `/api/manual/batches/:id/report.pdf` | Manual batch PDF |
| `GET` | `/api/manual/batches/:id/export.csv` | Manual batch CSV |
| `POST` | `/api/manual/prices` | Save a user-entered weight/price calculation |
| `GET` | `/api/manual/prices` | List/filter price records and INR summary |
| `DELETE` | `/api/manual/prices/:id` | Delete a price record |
| `GET` | `/api/manual/prices/export.csv` | Price record CSV |
| `GET` | `/api/manual/activity` | Read-only, user-scoped manual activity log |
| `GET` | `/api/verify/:token` | Public, limited assessment verification; no auth required |

Manual list responses use `{ items, pagination, summary }`; record detail returns
`{ record }`; batch detail returns `{ batch, records, pagination }`; duplicate groups use
`{ groups }`. The public verification response contains assessment identifiers, the manual
grade, status, batch code, grading date, review flag, and issue date only.

## PDF report

`server/utils/pdf.js` produces an A4 AI scan report with:

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

`server/utils/manualPdf.js` produces the separate manual reports:

- a record report with the stored details, manual grade, review state, image, and a
  manual-assignment notice;
- a batch report with progress and assigned-record data;
- an assessment report with the record summary, QR code, verification URL, and explicit
  "not an accredited certificate" notice.

## Testing and verification

```powershell
# Model checksum
python scripts\verify_model.py

# Server unit + integration suite (uses an isolated in-memory MongoDB)
cd server
npm test
npm run test:unit
npm run test:integration

# Server syntax
node --check index.js
node --check app.js
cd ..

# Frontend production build
cd client
npm run build
cd ..
```

The server suite contains 10 unit tests for validation/summary/CSV safety and a 17-step
HTTP integration workflow covering authentication, uploads, duplicate rejection and
override, filters, comparison, review, corrections, batch unassignment/deletion snapshots,
PDF/CSV reports, QR/public verification, prices, and activity. The integration workflow uses
`mongodb-memory-server` and a temporary upload directory, so it does not read or modify the
application's configured MongoDB database. The MongoDB test binary is cached under
`server/node_modules/.cache/mongodb-memory-server/` after the first download.

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
- **No C/D results**: expected with the bundled model. C/D requires an installed
  validated four-class checkpoint.

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
- Manual grades are intentionally limited to Grade A or Grade B and are selected by the
  user; the application does not validate the physical quality of a sample.
- Manual image-quality checks are browser heuristics. They can miss blur, glare, or poor
  lighting and are never used to assign or change a grade.
- Manual duplicate detection compares exact SHA-256 file content only. Re-encoded,
  resized, or visually similar images are not detected as duplicates.
- The value calculator uses only the weight and INR price entered by the user. No live
  market price, grading standard, or guaranteed valuation is provided.
- Public assessment verification proves that an application-generated assessment exists
  and matches the stored manual grade. It is not an official certificate, and the
  verification token must be treated as sensitive.
- The automated server suite does not include a headless-browser visual regression test;
  responsive layouts are covered by the production build and manual UI review.

## Security notes

- Never commit `server/.env`, Kaggle credentials, datasets, uploads, candidates or backups.
- Change the example `JWT_SECRET` and admin password before sharing a deployment.
- Passwords are hashed with bcrypt and never logged.
- The API validates uploaded files by type and size and isolates scans per user.
- Manual records, images, corrections, price records, and activity are scoped to the
  authenticated owner. Public assessment verification deliberately excludes images, notes,
  supplier details, and account information.
