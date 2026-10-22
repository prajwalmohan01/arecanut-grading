import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { LeafIcon, SparkIcon, UploadIcon, PerformanceIcon, HistoryIcon, CompareIcon, DownloadIcon, ArrowRightIcon } from '../components/Icons';

const capabilities = [
  {
    icon: UploadIcon,
    title: 'Detect & grade',
    text: 'The YOLOv8 detector finds arecanut regions and classifies each nut into the grades exposed by the active model. The bundled checkpoint supports Grade A and Grade B.',
  },
  {
    icon: PerformanceIcon,
    title: 'Honest confidence',
    text: 'Prediction confidence comes from the winning class detections. Quality score is a separate, labelled heuristic.',
  },
  {
    icon: HistoryIcon,
    title: 'Private history',
    text: 'Every prediction is stored against your account with filters, search, pagination, and ownership checks.',
  },
  {
    icon: CompareIcon,
    title: 'Side-by-side',
    text: 'Compare two saved predictions, review differences, and export a comparison PDF.',
  },
  {
    icon: DownloadIcon,
    title: 'Before & after PDFs',
    text: 'Download reports containing original, processed, and annotated images with warnings and methodology.',
  },
  {
    icon: SparkIcon,
    title: 'Model transparency',
    text: 'Artifact checksum verification, model metadata, and an explicit performance page — no fabricated metrics.',
  },
];

const limitations = [
  'Two class labels only: GradeA / GradeB. Grade C and D are not produced by this model.',
  'No black-spot, crack, mold, or discoloration classifier is bundled.',
  'Bounding-box size values are image-space estimates, not calibrated millimetres.',
  'No detector means no bounding boxes: Invalid is returned instead of a guessed grade.',
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <Navbar />

      <section className="relative overflow-hidden px-4 pb-20 pt-16 sm:px-6 lg:pb-28 lg:pt-24">
        <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-16 top-40 h-80 w-80 rounded-full bg-gold-400/15 blur-3xl" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="animate-in">
            <span className="pill">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Deep-learning quality grading · preserved model
            </span>
            <h1 className="mt-6 max-w-2xl font-display text-5xl font-semibold leading-[1.03] text-main sm:text-6xl lg:text-7xl">
              Clearer arecanut
              <span className="block bg-gradient-to-r from-forest-600 via-emerald-500 to-gold-500 bg-clip-text text-transparent">
                quality signals.
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              Upload a tray photo and get an annotated detection image, grades exposed by the active model
              counts, confidence, an explicitly heuristic quality score, and downloadable
              before-and-after reports — powered by the project&apos;s existing trained
              YOLOv8 weights.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/upload" className="btn-primary btn-lg">
                <UploadIcon width={18} height={18} />
                Grade a tray image
              </Link>
              <Link to="/dashboard" className="btn-secondary btn-lg">
                Open dashboard
                <ArrowRightIcon width={16} height={16} />
              </Link>
            </div>

            <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
              {[
                ['2', 'Verified classes'],
                ['CPU', 'Inference ready'],
                ['SHA-256', 'Weights verified'],
              ].map(([value, label]) => (
                <div key={label} className="surface-soft rounded-2xl p-3.5">
                  <p className="font-display text-xl font-semibold text-main">{value}</p>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative animate-in delay-200">
            <div className="surface-strong relative rounded-[2rem] p-4 sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                    Sample result layout
                  </p>
                  <p className="font-display text-xl font-semibold text-main">Detection summary</p>
                </div>
                <span className="badge badge-a">Grade A</span>
              </div>

              <div className="relative mt-5 aspect-[4/3] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-gradient-to-br from-forest-900 via-forest-800 to-emerald-900">
                <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 30% 35%, rgba(155,215,186,0.6), transparent 32%), radial-gradient(circle at 70% 65%, rgba(216,180,106,0.45), transparent 30%)' }} />
                <div className="absolute left-[14%] top-[18%] h-[26%] w-[28%] rounded-full border-2 border-emerald-300/80 bg-emerald-400/10" />
                <div className="absolute right-[16%] top-[30%] h-[30%] w-[30%] rounded-full border-2 border-emerald-300/80 bg-emerald-400/10" />
                <div className="absolute bottom-[12%] left-[32%] h-[24%] w-[25%] rounded-full border-2 border-gold-300/80 bg-gold-400/10" />
                <div className="absolute bottom-3 left-3 rounded-lg bg-black/40 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur">
                  Annotated detection preview
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  ['Confidence', 'actual model'],
                  ['Quality', 'heuristic'],
                  ['Defects', 'not supported'],
                ].map(([label, note]) => (
                  <div key={label} className="surface-soft rounded-xl p-2.5 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
                    <p className="mt-0.5 text-[11px] font-semibold text-main">{note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="surface absolute -bottom-6 -left-4 hidden w-52 rounded-2xl p-3.5 sm:block">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--accent-soft)] text-accent">
                  <LeafIcon width={16} height={16} />
                </span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Protected artifact</p>
                  <p className="text-xs font-semibold text-main">best.pt unchanged</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Workflow</p>
              <h2 className="mt-2 font-display text-3xl font-semibold text-main sm:text-4xl">
                From photo to a reviewable record
              </h2>
            </div>
            <p className="max-w-md text-sm text-muted">
              Upload or capture an image, review detection overlays and measurements, then
              export a report that clearly separates original, processed, and annotated views.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              ['01', 'Capture', 'Upload JPEG/PNG/WebP or use the camera when the browser allows it.'],
              ['02', 'Analyse', 'Validate the file, load the preserved model once, and run detection on CPU.'],
              ['03', 'Review & export', 'Inspect grades, confidence, heuristic score, warnings, and download a PDF.'],
            ].map(([number, title, text], index) => (
              <div key={number} className={`card p-6 ${index === 1 ? 'md:translate-y-4' : ''}`}>
                <span className="font-display text-3xl font-semibold text-accent/40">{number}</span>
                <h3 className="mt-3 font-display text-xl font-semibold text-main">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">Capabilities</p>
          <h2 className="mt-2 font-display text-3xl font-semibold text-main sm:text-4xl">
            Built around the model you already trained
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map(({ icon: Icon, title, text }) => (
              <div key={title} className="card p-5 transition hover:-translate-y-1">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:var(--accent-soft)] text-accent">
                  <Icon width={19} height={19} />
                </span>
                <h3 className="mt-4 font-display text-lg font-semibold text-main">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="card p-7">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Transparency</p>
            <h2 className="mt-2 font-display text-3xl font-semibold text-main">
              What this model can and cannot do
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              The bundled artifact is a YOLOv8 <strong className="text-main">detection</strong>{' '}
              model with exactly two class names: <code>GradeA</code> and <code>GradeB</code>.
              New Grade C/D labels, defect classes, and segmentation masks cannot be invented
              without retraining or adding compatible weights — neither is done automatically.
            </p>
            <Link to="/performance" className="btn-secondary mt-6">
              View model verification
              <ArrowRightIcon width={15} height={15} />
            </Link>
          </div>
          <div className="card p-7">
            <h3 className="font-display text-xl font-semibold text-main">Known limitations</h3>
            <ul className="mt-4 space-y-3">
              {limitations.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-muted">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="px-4 pb-20 pt-6 sm:px-6">
        <div className="surface-strong relative mx-auto max-w-7xl overflow-hidden rounded-[2rem] p-8 sm:p-12">
          <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="relative flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
            <div>
              <h2 className="font-display text-3xl font-semibold text-main sm:text-4xl">
                Ready to grade smarter?
              </h2>
              <p className="mt-2 max-w-xl text-sm text-muted">
                Your account is ready. Upload your first tray image and review an honest,
                reproducible result with a downloadable report.
              </p>
            </div>
            <Link to="/upload" className="btn-primary btn-lg shrink-0">
              Start a prediction
              <ArrowRightIcon width={17} height={17} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
