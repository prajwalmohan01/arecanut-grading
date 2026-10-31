# Arecanut Quality Grading System

MERN application for detecting and grading individual arecanuts in a tray image, with a
preserved YOLOv8 detector, a processed/annotated image preview, prediction history, and a
policy-aware PDF report. Admin-controlled switches gate master prediction, individual
grades, Gemini-assisted Grade C/D advisory review, image-level defect findings (black spots,
cracks, suspected mold, and discoloration), Gemini-assisted analysis, live AGMARKNET pricing,
and manual pricing. It also includes a separate manual grading workspace for user-assigned Grade A and
Grade B records, batches, review and correction history, PDF/CSV reports, QR verification,
and user-entered value calculations.

The repository is self-contained: the trained weights (`ml_service/weights/best.pt`,
6.25 MB) are committed, so a second PC can run inference by cloning and installing. No
retraining, no dataset download, and no Kaggle account are required for normal use.

## What the bundled model actually supports

| Capability | Status with the bundled checkpoint |
| --- | --- |
| Individual-nut detection (dense trays) | Yes, YOLOv8 detect, tiled inference |
| Grade A / Grade B | Yes |
| Grade C / Grade D detector | **No.** The checkpoint has only `GradeA` and `GradeB` classes |
| Grade C / Grade D advisory | Optional Gemini image-level advisory only; never a detector or nut count |
| Defect findings (black spots, cracks, suspected mold, discoloration) | Optional Gemini image-level findings; **no localized defect detector or verified affected-nut counts are bundled** |
| Physical size in millimetres | **No.** Requires camera calibration; values are image-space only |
| PDF report with original, annotated and processed images | Yes, subject to the active admin policy |

Grade support is derived at runtime from the loaded checkpoint's own class names. The
application is four-grade capable, but it will report C/D only when an installed checkpoint
actually contains `GradeC`/`GradeD` classes, or as a clearly labelled Gemini visual advisory
when an administrator enables that path. It never relabels A/B predictions as C/D and never
invents defect boxes, affected-nut counts, measurements, confidence scores, or market prices.
Gemini defect findings are image-level statuses, not localized detector output.

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
checkpoint is active. An administrator can optionally turn on Gemini-assisted advisory
review for C/D; that is a non-counting visual opinion, not a validated C/D prediction.
Defect review is separately switched, runs only when master prediction is on, and defaults
off. It reports image-level `detected`, `not_detected`, `uncertain`, or `error` statuses
without defect locations or affected-nut counts.

After signing in, an admin can open **Admin → Admin settings** (`/admin/settings`) to
control master prediction, grade visibility, Gemini-assisted analysis, defect categories,
and pricing. Non-admin users see only the policy-filtered result, history, lots, charts, CSV,
and PDF output.

## Admin policy, Gemini advisory, and pricing

### Admin settings and display policy

Admins use **Admin → Admin settings** (`/admin/settings`). The controls are persisted in a
single MongoDB `SystemSettings` document with optimistic versioning and an admin audit
entry, so they are not hard-coded in React or in `.env`. The defaults are: master prediction
on, Grade A/B on, Grade C/D off, Gemini-assisted analysis off, master defect detection off
(the four defect categories are on beneath it), and **no active pricing mode**.

| Control | What it changes |
| --- | --- |
| Master prediction | Global on/off gate for model grading, defect review, and pricing |
| Grade A, B, C, D | Which grades may appear in results, counts, charts, CSV, lots, and PDF |
| Gemini-assisted analysis | Enables the optional non-counting Gemini review path for C/D and enabled defects |
| Master defect detection | Gate for defect findings, explanations, history/analytics summaries, CSV columns, and PDF sections |
| Black spots, cracks, suspected mold, discoloration | Individual defect categories beneath the master defect switch |
| Live Market Price | Uses an AGMARKNET quote per kg; mutually exclusive with manual pricing |
| Manual Price Mode | Uses admin-entered per-grade prices; mutually exclusive with live pricing |

The API applies policy server-side; it is not a visual-only hide. When a grade is disabled,
its counts, detections, final grade, confidence/quality derived from it, annotations, CSV
columns/values, lot aggregation, and PDF sections are removed from the response. Historical
scans remain stored and are filtered non-destructively, so re-enabling a grade makes the old
record visible again.

When **Master prediction** is off, the API does **not** run inference and suppresses all
grading output: grades, counts, percentages, confidence, quality, charts, measurements,
defect analysis, warnings, processed/annotated images, pricing, and grade/price PDF sections.
The original upload may remain viewable. History and lot totals remain stored but are
filtered; changing the master switch is not a data-deletion operation.

Defect filtering is also server-side and non-destructive. When the master defect switch or
every category is off, the defect object is omitted from prediction details, history, CSV,
analytics, comparisons, and PDFs. Disabled category names, explanations, and counts are not
included in warnings or limitations. Stored records keep their original values and become
visible again when the category is re-enabled.

Because annotation boxes reveal the class of every detection, the annotated image and
annotated PDF evidence are exposed only when **every grade supported by the installed
checkpoint** is enabled. For the bundled checkpoint that means both A and B must be on.
The processed preview is also hidden while master prediction is off.

The authenticated `GET /api/settings` response exposes the effective policy (without
secrets), so the client can hide controls immediately. `GET /api/admin/settings` additionally
returns the editable settings, Gemini key counts/state, market status, and current version.

### Gemini-assisted Grade C/D advisory

The bundled checkpoint cannot detect C/D. If an admin enables Grade C and/or D, the settings
API requires the Gemini-assisted switch to be enabled as well. Gemini is used only for an
image-level advisory: it must return strict JSON containing an advisory grade hint, evidence
text, and limitations. It is **never** used as an object detector, never creates or edits
bounding boxes, and never invents C/D nut counts, confidence percentages, or prices.

- A C/D advisory can become the displayed final grade only when no model-supported A/B grade
  is enabled, the active policy permits the hinted C/D grade, and the advisory names that
  grade; it is labelled `Gemini visual advisory (not a validated detector)`.
- When A/B are also enabled, the model result remains the final grade; the Gemini note is
  supplementary and policy-filtered.
- If the advisory names a grade hidden by policy, its text/evidence is suppressed.
- If no key is configured or every key fails, the app reports Gemini as unavailable and
  keeps C/D unsupported. It does not fail over to a fabricated result.

Gemini keys are **server-only**. `GEMINI_API_KEY` plus `GEMINI_API_KEY_1` through
`GEMINI_API_KEY_10` are deduplicated, used in order, and fail over on key/permission/quota
errors. Five keys (`GEMINI_API_KEY_1` through `GEMINI_API_KEY_5`) are the recommended
minimum for free-tier deployments; adding more, up to ten, gives the failover more headroom.
Requests have bounded timeouts (default 30 s), bounded retries for transient 5xx
errors (default 2), key cooldowns (default 60 s), and a configurable input image maximum
(default 1280 px). 429 quota/rate-limit responses cool the key and immediately try the next
key. Key values are redacted from API responses, errors, audit entries, and logs; use
`GET /api/admin/gemini/status` to see only counts and cooldown state.

The Gemini model, timeout, retry count, and image maximum can be changed in Admin settings
or supplied as defaults with `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS`, `GEMINI_MAX_RETRIES`, and
`GEMINI_IMAGE_MAX_DIMENSION`. The default model is `gemini-3.5-flash`. `GEMINI_COOLDOWN_MS`
and `GEMINI_MAX_OUTPUT_TOKENS` are environment defaults. No key is committed to the
repository.

### Gemini-assisted image-level defect review

Defect review is a separate Gemini request path from grade advisory. It is disabled by
default and requires **Master prediction**, **Master defect detection**, **Gemini-assisted
analysis**, and at least one defect category. The prompt receives the original uploaded image
and asks for a strict structured result for every category:

- `detected` — the defect appearance is visibly present;
- `not_detected` — the image is usable and there is no visible evidence;
- `uncertain` — lighting, blur, overlap, resolution, or angle makes the finding ambiguous;
- `error` — that category could not be assessed from this image.

The response also includes a short explanation per category and a limitations list.
Gemini is instructed to say “Suspected Mold” or “mold-like growth”, never to claim a fungal
infection or identify a fungus. A defect finding does **not** automatically downgrade the
Grade A/B result; grading and defects are separate outputs.

The application never trusts Gemini for affected-nut counts, defect locations, bounding
boxes, or confidence percentages. Any self-reported count is discarded and the stored result
sets `affectedNutCount` to `null`, `localizationAvailable` to `false`, and
`affectedNutCountsAvailable` to `false`. PDFs and screenshots state that affected-nut counts
and localized defects require a validated detector or segmentation model. `Suspected Mold`
is an appearance description, not a laboratory or fungal confirmation.

If Gemini is disabled, has no configured key, times out, or returns an invalid response, every
enabled category is reported as `error` with the message “Analysis unavailable”. The UI keeps
the scan, shows a useful **Retry analysis** action, and never relabels the result as
“Not detected”. `POST /api/scans/:id/reanalyze` reruns only Gemini against the stored original
image; it does not rerun the Grade A/B checkpoint or create a new scan. A missing original
image returns HTTP `409` rather than a fabricated result.

### Live market and manual pricing

**No active pricing mode means no price estimate at all.** `totalValue` is `null`, not zero.
Manual and live modes are mutually exclusive; the settings service rejects an update that
attempts to enable both.

- **Manual Price Mode** uses administrator-entered prices per grade. Each grade can use
  `per_nut`, `per_kg`, or `per_quintal`. Per-nut totals use enabled nut counts. Per-kg and
  per-quintal totals require a measured/calibrated weight because the model does not measure
  physical weight from a photo.
- **Live Market Price** uses the public AGMARKNET 2.0 daily price dashboard by default. It
  needs no API key. The admin can filter by state, district, market, commodity, variety, and
  market grade. The public dashboard publishes a weighted average, so that is the quote
  shown; the optional data.gov.in fallback can provide modal/min/max fields when its key is
  configured. Quotes are stored in INR per quintal and converted to INR per kg by dividing
  by 100. No matching record, network failure, or a stale cache produces an explicit
  unavailable/stale status with no invented number.
- **Measured lot weight** (`measuredWeightKg`) is the only weight allowed to drive a lot
  total. `avgNutWeightG` is an optional display/estimate-only assumption; it is never used
  to claim a priced lot total. For mixed manual units, the measured lot weight is allocated
  across all counted enabled grades, and only the weight-priced grades receive a
  weight-based value. That allocation assumes an equal average nut weight across grades;
  per-nut pricing is the alternative when that assumption is unacceptable.
- Pricing status values include `needs_weight`, `no_detections`, `no_configured_prices`,
  `live_unavailable`, `pricing_disabled`, `no_total`, and `ready`. The UI labels the result
  as an estimate and never describes it as a certified valuation.

Live market setup is keyless by default (`MARKET_PRICE_SOURCE=agmarknet_public`). The public
AGMARKNET 2.0 dashboard is an undocumented front-end service, not a contractual REST API, so
treat it as daily administrative data rather than real-time transaction pricing. Set
`MARKET_PRICE_SOURCE=data_gov_in` to use the optional data.gov.in resource
`9ef84268-d588-465a-a308-a864a43d0070` as the primary source; that path requires a free key
in `DATA_GOV_IN_API_KEY` (or `AGMARKNET_API_KEY`). When the public source fails, the same key
is used automatically as a fallback, if present. `MARKET_PUBLIC_BASE_URL`,
`MARKET_FILTERS_CACHE_MINUTES`, `MARKET_LOOKBACK_DAYS`, `MARKET_PRICE_RESOURCE_ID`,
`MARKET_PRICE_TIMEOUT_MS`, and `MARKET_PRICE_CACHE_MINUTES` override the defaults. If no state
or market is selected, a refresh uses a median of matching nationwide records; choose a state
and market for a local quote. The admin can force a refresh from the Admin page; regular users
can read the active quote only while live mode and master prediction are on.

## Architecture

- **Frontend**: React 18 + Vite + Tailwind CSS (`http://localhost:5173`)
- **Backend**: Node.js + Express + Mongoose (`http://localhost:5000`)
- **Database**: MongoDB
- **ML inference**: Ultralytics YOLOv8, run locally through a persistent Python
  worker (`ML_TRANSPORT=local`, `USE_INFERENCE_WORKER=true`, the default) or
  over HTTP via `ml_service/predict.py` (Flask on `:5001`). If the worker cannot
  start, local requests fall back to the one-shot `standalone_predict.py` CLI.
- **Auth**: JWT + bcryptjs, user/admin roles

```text
.
├── README.md
├── .gitignore
├── setup.ps1                     # Portable one-time setup (PowerShell)
├── setup.sh                      # Portable one-time setup (Linux/macOS)
├── start.ps1                     # Root startup helper (PowerShell)
├── client/                       # React frontend
│   ├── src/pages/manual/         # Authenticated manual grading workspace
│   └── src/pages/AdminSettings.jsx # Admin policy, Gemini, defect, and pricing controls
├── server/                       # Express API, MongoDB models, PDF generation
│   ├── .env.example
│   ├── routes/                   # AI, auth, manual grading, admin, settings, market
│   ├── services/                 # Inference, policy, pricing, Gemini, defects, AGMARKNET
│   ├── utils/pdf.js              # AI report PDF
│   ├── utils/manualPdf.js        # Manual record, batch, and assessment PDFs
│   ├── tests/                    # node:test unit and in-memory MongoDB integration tests
│   └── scripts/                  # admin bootstrap helpers
├── ml_service/
│   ├── weights/best.pt           # Committed production model
│   ├── model_metadata.json
│   ├── inference.py              # Single inference implementation
│   ├── inference_worker.py       # Persistent local worker (JSON lines)
│   ├── standalone_predict.py     # One-shot CLI fallback
│   ├── predict.py                # Optional Flask service
│   └── requirements.txt
├── scripts/                      # Manual training/evaluation workflow
│   ├── datasets.py
│   ├── inspect_datasets.py
│   ├── prepare_dataset.py
│   ├── train_model.py
│   ├── evaluate_model.py
│   ├── verify_model.py
│   ├── benchmark_inference.py    # Localisation speed/quality benchmark
│   └── inspect_roboflow.py       # Read-only Roboflow dataset/workflow check
├── datasets/
│   └── README.md                 # Where to put a real annotated dataset (data is ignored)
└── training_reports/             # Real inspection, benchmark and blocker reports
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
   - enabled Gemini image-level defect findings with explicit limitations,
   - an explicit “Analysis unavailable” notice with a retry action when Gemini cannot run,
     and an explicit notice when C/D has no validated detector.
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
- A **lot** groups scans and stores an optional **measured net lot weight**
  (`measuredWeightKg`), an optional estimated average nut weight (`avgNutWeightG`), manual
  prices, and a currency. Deleting a lot keeps its predictions in history and only clears
  their lot assignment.
- A lot total is calculated only from `measuredWeightKg` and the active admin pricing
  policy. `avgNutWeightG` can display an estimated weight (`enabled count × avgNutWeightG ÷
  1000`) for context, but it **never** drives a priced total. The bundled model measures
  boxes in image space only; it does not measure physical weight.
- Manual per-kg/per-quintal values allocate the measured lot weight across all counted
  enabled grades. This is an explicit estimate that assumes equal average nut weight across
  those grades. If that assumption is not acceptable, configure per-nut pricing instead.
- The history CSV contains a summary block followed by a blank line and the per-prediction
  table. When master prediction is off or a grade is disabled, the corresponding
  grade/count/confidence/pricing columns and values are omitted or blank; historical data is
  not deleted.

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
  user-entered INR price per kilogram. This manual calculator does not use the AI pricing
  policy or live market prices and does not invent a price when none is entered.
- **Digital assessments** can be created for graded records. The assessment PDF contains a
  QR code and verification link for `/verify/:token`. The public response intentionally
  omits images, notes, supplier details, reviewer/account details, and correction history.
  It is a record-verification aid, not an accredited certificate.
- **Activity** (`/manual/activity`) is a read-only, user-scoped audit trail of manual
  creates, updates, reviews, corrections, exports, assessments, batch changes, and price
  records.

The AI policy switches live in the separate **Admin settings** page and do not weaken the
manual workspace's rule that every manual grade is human-selected. The manual module does
not use AI inference, live market pricing, or automatic grading controls.

## Inference settings for dense images

Defaults are tuned for dense tray images. The shipped operational values live in
`server\.env`/`server\.env.example` and are inherited by the Python worker/CLI. The
`MODEL_IOU` and `MODEL_AUGMENT` code defaults in `ml_service/inference.py` remain the
original `0.35`/`true` so a direct Flask invocation does not silently adopt the tuned
thresholds; the tiling and de-duplication improvements apply to every path. Values are
parsed defensively: a typo falls back to the default instead of crashing the service.

| Variable | Shipped value | Meaning |
| --- | --- | --- |
| `MODEL_CONF` | `0.05` | Confidence threshold |
| `MODEL_IMGSZ` | `1280` | Full-image inference size (also the processed preview size) |
| `MODEL_IOU` | `0.50` | Model NMS IoU threshold (code default: `0.35`) |
| `MODEL_MAX_DET` | `2000` | Maximum detections per image |
| `MODEL_AUGMENT` | `false` | Test-time augmentation (code default: `true`; slower and measurably less precise here) |
| `USE_TILED` | `true` | Tiled inference for small/dense nuts |
| `TILE_SIZE` | `640` | Tile size in pixels |
| `TILE_OVERLAP` | `0.25` | Tile overlap fraction |
| `TILE_IMGSZ` | `min(MODEL_IMGSZ, TILE_SIZE)` | Inference size per tile |
| `TILE_MERGE_IOU` | `0.45` | Cross-tile duplicate-removal IoU |
| `TILE_DUPLICATE_CENTER_RATIO` | `0.30` | Merge overlapping boxes with very close centres |
| `TILE_CORE_OWNERSHIP` | `false` | Keep only boxes whose centre is in a tile's core region |
| `TILE_MIN_IMAGE_FACTOR` | `1.5` | Tile only when the long edge exceeds `TILE_SIZE` × this |
| `TILE_INCLUDE_FULL_IMAGE` | `false` | Add an optional full-image pass to tiled runs |
| `USE_INFERENCE_WORKER` | `true` | Keep one Python process alive between uploads |
| `ML_WORKER_STARTUP_TIMEOUT_MS` | `90000` | Worker model-load timeout |
| `MODEL_DEBUG` | `false` | Lower the confidence floor for near-miss diagnostics |
| `DEBUG_CONF_FLOOR` | `0.01` | Confidence floor used only when `MODEL_DEBUG=true` |

Tiling uses an edge-aligned plan: the final row and column are placed against the image
border instead of leaving a thin skipped strip. Overlapping tile detections are merged by
IoU, containment, and centre distance so touching neighbouring nuts are not merged. The
JSON result exposes an `inference` block (`mode`, `tile_count`, `raw_detections`,
`deduped_detections`, thresholds) so a run can be audited instead of guessed.

The persistent worker is the main cold-start fix. Previously every local request spawned a
new Python process and reloaded the 6.25 MB checkpoint (measured at roughly 3-20 s on CPU,
depending on disk/page cache and antivirus). The worker loads the model once, answers
JSON-line requests, times out and restarts safely, and falls back to the one-shot CLI if it
cannot start. `ML_TRANSPORT=http` is unchanged and ignores the worker.

To disable tiling or the worker on a very slow machine:

```powershell
# server\.env
USE_TILED=false
USE_INFERENCE_WORKER=false
MODEL_AUGMENT=false
```

Higher settings can improve recall on dense trays but increase processing time. Do not
raise `MODEL_CONF` or lower `MODEL_IMGSZ` without rechecking a real tray photo.

### Measured effect of this upgrade

Full methodology and raw JSON are in `training_reports/benchmark_summary.md`. The short
version, measured on the same machine and images:

| Check | Before | After |
| --- | ---: | ---: |
| CSVTU v2 test split, localisation precision | 0.5906 | 0.7337 |
| CSVTU v2 test split, localisation recall | 0.1928 | 0.1825 |
| CSVTU v2 test split, mean time/image | 1.24 s | 0.59 s |
| User's 1500×2000 tray, detections | 104 | 110 |
| Same tray, single-image benchmark (cold) | 13.29 s | 4.0–6.2 s (5.97 s committed) |
| Same tray, warm persistent-worker request | not measured | 1.5–2.0 s |

Precision and speed improved; recall on that dense dataset is essentially unchanged and
remains the checkpoint's main weakness. These are **localisation** numbers, not Grade A/B
accuracy. No supplied dataset contains per-nut grade labels, so grade accuracy is not
claimed.

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

### Roboflow datasets and configured workflows

The six Roboflow dataset links supplied with the project were inspected through the
read-only Roboflow metadata API. Evidence is committed in
`training_reports/roboflow_compatibility.json` and `.md`, and can be reproduced with:

```powershell
python scripts\inspect_roboflow.py
```

| Dataset | Images | Classes | Grade A/B/C/D? |
| --- | ---: | --- | --- |
| `csvtu/arecanut-sg2x7` v2 | 741 | `ripe`, `unripe` | no |
| `haris-sdpsb/arecanut-uyhqw` v3 | 1,931 | `ripe`, `unripe` | no |
| `arecadetectmodel/areca-detection_model` v4 | 319 | `areca` | no |
| `lakshan-krithik-5wkvh/arecanut-zu2zf` v1 | 2,385 | `good`, `damaged` | no |
| `project-xqygb/areca-nut-djx7a` v3 | 5,475 | `good`, `damaged`, `.` | no |
| `rakshas-workspace-54tkl/koleroga_detector` v1 | 312 | `Healthy_nut`, `Koleroga_detector` | no |

Some versions have trained YOLOv8/YOLOv11 weights (for example the Djx7a version reports
mAP50 80.39% for `good`/`damaged`), but those classes are binary quality or ripeness
labels. None identifies individual nuts as Grade A, B, C, or D. They therefore cannot
train or validate the application's grade head, and this project does not silently map
`good`/`damaged` onto A/B/C/D.

The Roboflow workflows configured in `server\.env`
(`general-segmentation-api-2`, `-3`, `-5`) were also inspected. All three run
`sam3/sam3_final`, a promptable segmentation model with a free-text `classes` input. They
are segmentation utilities, not trained grade classifiers, and are deliberately not used
for grading results.

**Consequence:** Grade C/D support remains blocked on data, not on code. The application
already reads four-grade checkpoints when present, but no verified four-grade checkpoint
or dataset exists here. See `training_reports/roboflow_compatibility.md` for the verdict.

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
| `POST` | `/api/scans/:id/reanalyze` | Rerun Gemini on the stored original image without rerunning Grade A/B |
| `GET` | `/api/scans/history` | Paginated history, filters (`grade`, `from`, `to`, `q`, `lot`, `sort`), summary, gated defect counts |
| `GET` | `/api/scans/export.csv` | Filtered history with a summary block (`grade`, `from`, `to`, `q`, `lot`, `sort`) |
| `GET` | `/api/scans/stats` | Aggregate statistics |
| `POST` | `/api/lots` | Create a lot with optional manual prices, measured lot weight, and estimated average nut weight |
| `GET` | `/api/lots` | List lots with policy-filtered counts and valuation |
| `GET` | `/api/lots/:id` | Lot summary plus its scans |
| `PATCH` | `/api/lots/:id` | Update lot details, manual prices, measured weight, or estimated average nut weight |
| `GET` | `/api/lots/:id/export.csv` | Policy-filtered lot summary and per-scan CSV |
| `DELETE` | `/api/lots/:id` | Delete a lot; its scans are unassigned, not deleted |
| `GET` | `/api/health` | Server, database and model readiness |

A prediction response contains policy-filtered `gradeA`, `gradeB`, `gradeC`, `gradeD`,
`totalCount`, `finalGrade`, and a `scan` object with `gradeCounts`, `supportedGrades`, `lot`,
`detections`, `warnings`, model metadata, and (when enabled) `defects`. Disabled grades,
disabled defect categories, and master-off output are removed before serialization. The
`defects` object contains `analysisStatus`, `analysisMethod`, `model`, `analyzedAt`,
`imageLevelOnly`, `localizationAvailable`, `affectedNutCountsAvailable`, `note`,
`limitations`, `errorCode`, `error`, and enabled `categories`; each category has a status,
explanation, `affectedNutCount` (normally `null`), and `countBasis`. The `pricing` object always
carries an explicit status and `totalValue: null` when no estimate is available.

Lot valuation uses the active pricing mode. A weight-based total is:

```text
estimated value = user-entered measured lot weight (kg) × applicable price per kg
```

For mixed manual per-nut and per-kg/per-quintal grades, the measured lot weight is allocated
across all counted enabled grades before the weight-based portion is priced. The older
`detected nuts × avgNutWeightG` formula is **estimate-only** and is not used as a lot total.

### Settings, admin, and market endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/settings` | Authenticated effective policy (master, visible grades, Gemini and defect switches, pricing mode, currency) |
| `GET` | `/api/admin/settings` | Admin-only editable settings, policy, Gemini key status, and market status |
| `PUT` | `/api/admin/settings/predictions` | Update master, grade, and Gemini-assisted analysis switches |
| `PUT` | `/api/admin/settings/defects` | Update master defect detection and individual defect categories |
| `PUT` | `/api/admin/settings/gemini` | Update Gemini model, timeout, retries, and input image maximum |
| `PUT` | `/api/admin/settings/pricing` | Update mutual-exclusive pricing mode, currency, manual prices, and live market filters |
| `GET` | `/api/admin/gemini/status` | Admin-only key counts, cooldown state, and non-secret configuration |
| `GET` | `/api/admin/market/status` | Admin-only market configuration, cache, and stale/error state |
| `POST` | `/api/admin/market/refresh` | Admin-only forced AGMARKNET refresh |
| `GET` | `/api/admin/audit` | Admin-only recent settings audit entries |
| `GET` | `/api/market-prices` | Authenticated active live quote; requires master prediction on and live mode |

Settings updates use optimistic versioning; a concurrent change returns HTTP `409` with a
reload-and-retry message. All admin routes require the `admin` role. API responses expose
key counts and state only, never key values.

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

`server/utils/pdf.js` produces an A4 AI scan report whose sections follow the active admin
policy:

- the original image is retained as evidence even when grading output is hidden;
- the processed model-input preview and annotated detection image are included only when
  master prediction is on, and the annotated image is included only when every
  model-supported grade is enabled (otherwise the boxes would reveal a hidden grade);
- grade composition, confidence, quality, measurements, detection tables, Gemini advisory,
  enabled defect findings, and price sections are included only when their policy permits
  them;
- defect sections show Gemini image-level statuses, explanations, analysis method/time,
  limitations, and the “not established” count message; disabled categories are not included,
  and no bounding boxes or fabricated counts are added;
- master off embeds only the original image plus a clear policy notice, with no grade,
  count, percentage, confidence, chart, defect, or price section;
- prediction and comparison PDFs return HTTP `409` with a useful message when the required
  original image is missing, instead of generating a report without its evidence image;
- images are normalized to upright JPEG before embedding: EXIF orientation is applied,
  WebP/animated inputs are decoded, transparency is flattened onto white, oversized files
  are bounded, and the original aspect ratio is preserved instead of stretching;
- missing or unreadable evidence is shown as an explicit "not available" line, not silently
  replaced with a different image;
- every supported detection appears in a bounded table, followed by warnings and a result
  summary;
- page numbers and the footer appear exactly once per page.

The footer is drawn inside the bottom margin with the margin temporarily disabled so
PDFKit does not append blank pages. The comparison PDF uses the same policy gating and
image normalization rules. PDF tests parse the generated file to assert which image and
text sections are present.

`server/utils/manualPdf.js` produces the separate manual reports:

- a record report with the stored details, manual grade, review state, image, and a
  manual-assignment notice;
- a batch report with progress and assigned-record data;
- an assessment report with the record summary, QR code, verification URL, and explicit
  "not an accredited certificate" notice.

## Rollback the admin/Gemini/pricing upgrade

There are two rollback levels. Choose the least destructive one that solves the problem.

**1. Behaviour-only rollback (recommended, keeps all history):** in Admin settings, turn
**Master prediction off**, turn **Master defect detection** off, and set pricing to **none**.
This immediately removes grading, defect, and pricing output without deleting stored scans,
lots, or manual records. A different admin can turn the features back on later.

**2. Code rollback:** stop the API and client first. This feature was added on top of the
preserved model and earlier uncommitted tuning work, so do not run a blanket
`git restore .` unless you also want to discard that work. Commit or save a patch of the
current tree first:

```powershell
git diff > admin-gemini-pricing-rollback.patch
git status --short
```

Then restore only the files you intend to roll back, or use `git revert <commit>` if this
feature was committed. New feature files are:

```text
client/src/components/PolicyNotice.jsx
client/src/context/PolicyContext.jsx
client/src/pages/AdminSettings.jsx
server/models/AdminAudit.js
server/models/MarketPriceCache.js
server/models/SystemSettings.js
server/routes/admin.js
server/routes/marketPrices.js
server/routes/settings.js
server/services/geminiService.js
server/services/marketPriceService.js
server/services/presentationService.js
server/services/pricingService.js
server/services/settingsService.js
server/tests/unit/policyPricing.test.js
server/tests/unit/geminiService.test.js
server/tests/unit/marketPriceService.test.js
server/tests/unit/pdfPolicy.test.js
server/tests/integration/policyRoutes.test.js
```

Also restore the tracked files changed for this feature (`client/src/App.jsx`,
`client/src/components/Navbar.jsx`, the policy-aware pages, `server/app.js`,
`server/config.js`, `server/routes/scans.js`, `server/routes/lots.js`,
`server/services/lotService.js`, `server/services/scanService.js`, `server/utils/pdf.js`,
models, and `.env.example`) from the pre-feature commit. Do not delete or modify
`ml_service/weights/best.pt`; verify it afterwards with
`python scripts\verify_model.py`. The expected checksum remains
`5E141ABD6BD334E61AA733AA00994B8E5AF4D2104A677BE4A7B7215092883268`.

The feature stores settings in MongoDB. Deleting the singleton document resets policy to the
defaults (master on, A/B on, C/D off, Gemini off, pricing none); it does **not** delete scans,
lots, or manual records:

```powershell
mongosh "mongodb://localhost:27017/arecanut_grading" --eval "db.systemsettings.deleteOne({singleton:'global'})"
```

Optionally remove the feature's audit/cache collections
(`db.adminaudits.deleteMany({})`, `db.marketpricecaches.deleteMany({})`). Remove the Gemini
and data.gov.in key variables from `server\.env` if they are no longer used, then restart the
API. The React client has no keys to remove. No dataset download, retraining, Docker, or model
change is involved.

## Rollback the earlier inference tuning upgrade

The model, datasets, authentication, manual grading, and PDF code were not replaced. If you
need the previous behaviour:

```powershell
# Stop the API and the Python worker first, then from the repository root:
# 1. Roll back the tracked files.
git restore README.md ml_service/inference.py server/.env.example `
  server/config.js server/index.js server/services/inferenceService.js

# 2. Remove only the files added by this upgrade.
Remove-Item -ErrorAction SilentlyContinue @(
  'ml_service/inference_worker.py',
  'scripts/benchmark_inference.py',
  'scripts/inspect_roboflow.py',
  'scripts/tests/test_inference_tiling.py',
  'server/tests/unit/inferenceService.test.js',
  'training_reports/benchmark_summary.md',
  'training_reports/roboflow_compatibility.json',
  'training_reports/roboflow_compatibility.md'
)
Remove-Item -ErrorAction SilentlyContinue training_reports\benchmark_*.json

# 3. Switch back to your previous branch if the upgrade was committed.
git switch main
```

Then restore these `server\.env` values (the pre-upgrade tuning):

```dotenv
MODEL_AUGMENT=true
MODEL_IOU=0.50
TILE_SIZE=640
TILE_OVERLAP=0.25
USE_TILED=true
```

Remove the new keys (`TILE_IMGSZ`, `TILE_MERGE_IOU`, `TILE_DUPLICATE_CENTER_RATIO`,
`TILE_CORE_OWNERSHIP`, `TILE_MIN_IMAGE_FACTOR`, `TILE_INCLUDE_FULL_IMAGE`,
`USE_INFERENCE_WORKER`, `ML_WORKER_STARTUP_TIMEOUT_MS`, `DEBUG_CONF_FLOOR`) if the old code
is restored. Finally run `python scripts\verify_model.py` and start the app again. The
model checksum must stay
`5E141ABD6BD334E61AA733AA00994B8E5AF4D2104A677BE4A7B7215092883268`.

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
node --check services/inferenceService.js
cd ..

# Python tiling, de-duplication, worker, and dataset tests
python -m unittest discover -s scripts\tests -p "test_*.py" -v

# Optional benchmark (needs a local YOLO-format dataset)
python scripts\benchmark_inference.py --help

# Optional read-only Roboflow metadata check (needs ROBOFLOW_API_KEY)
python scripts\inspect_roboflow.py

# Frontend production build
cd client
npm run build
cd ..
```

The server suite currently reports **85/85 passing checks** (`node --test`): **58/58 unit
tests** and **27/27 integration entries**. The integration entries cover the 17-step manual
grading workflow plus eight admin-policy scenarios (policy access, C/D/Gemini validation,
key-status secrecy, grade filtering across result/history/stats/CSV/annotated access,
measured-weight lot pricing, defect gating across detail/history/stats/CSV/PDF and admin
settings, master-off suppression across API/images/CSV/lots/PDF, and audit secrecy). Unit
coverage includes inference normalisation, validation, CSV safety, search escaping, PDF and
defect policy gating, strict Gemini defect schema parsing and count discarding, Gemini
failover/cooldown/redaction, public AGMARKNET name resolution and weighted-average parsing,
data.gov.in fallback, cache/stale/error redaction, C/D-only lot suppression, and
measured-weight pricing.

The integration workflows use `mongodb-memory-server` and a temporary upload directory, so
they do not read or modify the application's configured MongoDB database. The MongoDB test
binary is cached under `server/node_modules/.cache/mongodb-memory-server/` after the first
download. The frontend production build also passes; Vite reports the existing >500 kB
chunk-size warning.

The Python suite (23/23 tests) covers tile coverage and edge alignment, duplicate
suppression, the worker JSON protocol, and the separate X-ray dataset validation. Neither
suite loads the trained network, so both run quickly and do not require GPU access. Automated
tests mock Gemini and AGMARKNET network calls. A manual smoke test was also run against the
live Gemini advisory and AGMARKNET public dashboard; those calls are not part of the automated
suite and may fail when an upstream service is unavailable.

## Troubleshooting

- **`Match: False` from `verify_model.py`**: the weights file is missing or modified.
  Restore `ml_service/weights/best.pt` from the repository; do not retrain to fix a
  checksum mismatch.
- **Mongo connection error**: confirm MongoDB is running and `MONGO_URI` is correct.
- **`python` not found**: install Python 3.10–3.12 and ensure it is on `PATH`, or set
  `PYTHON_PATH` in `server\.env` to the full interpreter path.
- **Local inference timeout**: lower `MODEL_IMGSZ`, set `MODEL_AUGMENT=false`, or set
  `USE_TILED=false`; raise `ML_TIMEOUT_MS` if needed.
- **Persistent worker warning at startup**: read the message. If the worker cannot load,
  the server still works through the slower one-shot CLI. Check `PYTHON_PATH`, run
  `python ml_service\inference_worker.py` manually, and look for an
  `ultralytics`/`torch` import error. Set `USE_INFERENCE_WORKER=false` to silence it.
- **Very slow first upload after a restart**: the worker is loading the checkpoint once
  (~20 s on CPU). Later uploads use the warm process. Wait for
  `[model] Inference worker ready` in the server log.
- **Out of memory with very large photos**: reduce `TILE_SIZE`/`TILE_IMGSZ` or
  `MAX_UPLOAD_MB`; the model and preview both hold full-size images in memory.
- **`JWT_SECRET` error**: set a value of at least 16 characters in `server\.env`.
- **Port conflict**: change `PORT` in `server\.env`; update the Vite proxy in
  `client/vite.config.js` if the API port changes.
- **PowerShell script blocked**: run
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- **Kaggle download fails or times out**: downloads are large; use a long-running
  terminal, or point `--dataset-path` at an existing local copy.
- **No C/D results**: expected with the bundled model. C/D requires an installed validated
  four-class checkpoint or a successful Gemini advisory (enabled in Admin settings, with at
  least one server key). Gemini never creates nut counts.
- **All grades/counts/prices disappeared**: check **Admin → Admin settings**. Master
  prediction off intentionally suppresses all output; a disabled grade is removed
  server-side even though its history remains stored.
- **Cannot save C/D or master settings**: enabling C/D while master is on requires the
  Gemini-assisted analysis switch. The loader refuses a policy that would imply an unsupported
  C/D detector.
- **No defect findings**: verify master prediction, master defect detection, at least one
  category, and Gemini-assisted analysis are all on. A blank or unavailable defect result is
  not “not detected”; use **Retry analysis** when it is offered.
- **Defect analysis says “Analysis unavailable”**: this is intentional when Gemini is
  disabled, no server key is configured, the request times out, or the response fails schema
  validation. Check Admin settings and `/api/admin/gemini/status`; the app will not invent a
  “not detected” result.
- **Gemini unavailable / keys cooling down**: configure `GEMINI_API_KEY` or
  `GEMINI_API_KEY_1..10` in `server\.env`, then restart the API. Check
  `/api/admin/gemini/status` for key counts and cooldown state; key values are intentionally
  hidden. A quota/rate-limit response cools the key and tries the next one.
- **Live price is unavailable**: check the state/district/market spelling in Admin settings.
  The default public AGMARKNET dashboard needs no key. If public access is blocked, set
  `DATA_GOV_IN_API_KEY` (or `AGMARKNET_API_KEY`) and restart the API to use the optional
  data.gov.in fallback. A valid source can still return no matching market record; the app
  reports that rather than inventing a quote. Cached quotes may be shown as stale when a
  refresh fails.
- **A lot total is blank even though an average nut weight is set**: weight-based pricing
  requires `measuredWeightKg` (a measured/calibrated net lot weight). `avgNutWeightG` is
  estimate-only. Per-nut pricing does not require weight.
- **Settings save returns `409`**: another admin changed the version first. Reload the Admin
  page and reapply the change.
- **PDF is missing annotated/processed images**: this is expected when master prediction is
  off or a model-supported grade is disabled. The original image remains the evidence.

## Honest limitations

- The bundled checkpoint detects only Grade A and Grade B. C/D are reported as
  unsupported, not guessed.
- Gemini-assisted Grade C/D is an image-level advisory, not a validated detector. It cannot
  produce nut boxes, counts, confidence percentages, or a physically verified grade, and its
  output can vary between runs. Without a configured key it is unavailable. A local Gemini key
  is configured only in `server/.env`; the automated tests mock both Gemini and AGMARKNET, while
  manual smoke tests exercised the live advisory and the keyless public AGMARKNET dashboard.
- Grade C/D training remains blocked: no inspected dataset has individual-nut A/B/C/D
  labels. Enabling the C/D switches does not install a C/D model.
- The bundled model does not measure physical weight. Lot totals use a user-entered measured
  net weight; mixed per-kg/per-quintal pricing additionally assumes equal average nut weight
  across counted enabled grades.
- Live AGMARKNET prices are daily mandi aggregates, not a guaranteed transaction price.
  Market/variety/grade quoting can be unavailable or stale and may not match a specific
  seller's lot. Manual prices are administrator inputs, not market observations.
- Master off and disabled grades are non-destructive display policies; historical values
  remain in MongoDB and become visible again if the policy is re-enabled.
- PDF evidence follows the same policy. Disabling a model-supported grade hides the
  annotated image because its boxes would reveal that grade.
- Defect analysis is Gemini image-level review, not a validated defect detector or
  segmentation model. It cannot provide defect locations, bounding boxes, verified
  affected-nut counts, or fungal confirmation. A finding of suspected mold describes visible
  mold-like appearance only. Localized defects and affected-nut counts remain unavailable
  until a validated detector and labelled data are installed.
- Missing Gemini analysis is reported as unavailable with a retry path; it is never
  converted to “not detected”. Defect findings do not automatically downgrade Grade A/B.
- Physical millimetre measurements are unavailable without camera calibration; only
  image-space box sizes are shown.
- No verified held-out Grade A/B evaluation report is bundled for the preserved weights,
  so no grade accuracy metrics are claimed. The benchmark in
  `training_reports/benchmark_summary.md` measures nut localisation only.
- On the CSVTU dense-tray test split the preserved checkpoint finds roughly one in five
  nuts at the default threshold. Tiling and de-duplication change precision/speed, not
  the model's fundamental recall limit.
- The persistent worker keeps one Python process and model in memory; it is restarted on
  crash/timeout and falls back to the one-shot CLI. Both paths use the same inference code.
- The six inspected Roboflow datasets use ripeness, binary quality, disease, or generic nut
  labels. None contains individual-nut Grade A/B/C/D annotations, so C/D training remains
  blocked on new labelled data.
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
- Gemini and data.gov.in/AGMARKNET keys are server-only environment variables. Do not put
  them in `client/.env`, Vite variables, screenshots, issues, or logs. The API returns only
  configured-key counts and cooldown state. The Gemini and market services redact key values
  from errors, audit summaries, and cached failure messages.
- Rotate any API key that has been pasted into a terminal, screenshot, issue, or log.
  `scripts/inspect_roboflow.py` reads `ROBOFLOW_API_KEY` from the environment or
  `server/.env` and never writes it to its reports.
- The admin settings, audit, Gemini status, and market refresh routes require the `admin`
  role. Settings changes are versioned and audited; audit entries must not contain secrets.
- Change the example `JWT_SECRET` and admin password before sharing a deployment.
- Master prediction off is a display safeguard, not encryption or deletion. Anyone with
  database access can read historical stored values.
- Passwords are hashed with bcrypt and never logged.
- The API validates uploaded files by type and size and isolates scans per user.
- Manual records, images, corrections, price records, and activity are scoped to the
  authenticated owner. Public assessment verification deliberately excludes images, notes,
  supplier details, and account information.
