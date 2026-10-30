import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import API, { apiErrorMessage, downloadApiFile } from '../api/axios';
import { usePolicy } from '../context/PolicyContext';
import { useToast } from '../context/ToastContext';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import ProtectedImage from '../components/ProtectedImage';
import PolicyNotice from '../components/PolicyNotice';
import { GradeBadge } from '../components/ui/Badge';
import {
  AlertIcon,
  ArrowRightIcon,
  CompareIcon,
  DownloadIcon,
  HistoryIcon,
  LayersIcon,
  SparkIcon,
  TrashIcon,
  UploadIcon,
} from '../components/Icons';
import {
  downloadName,
  enabledGradeLetters,
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatWeightKg,
  gradeAvailability,
  gradeBreakdown,
  gradeColor,
  gradeDescription,
  pricingStatusText,
  supportedGradeLetters,
} from '../utils/format';

const IMAGE_TABS = [
  { key: 'original', label: 'Original Image' },
  { key: 'annotated', label: 'Annotated Image' },
  { key: 'processed', label: 'Processed Image' },
];

const DEFECT_STATUS = {
  detected: { label: 'Detected', badge: 'badge-danger' },
  not_detected: { label: 'Not detected', badge: 'badge-a' },
  uncertain: { label: 'Uncertain', badge: 'badge-b' },
  error: { label: 'Analysis unavailable', badge: 'badge-invalid' },
};

function defectStatusMeta(status) {
  return DEFECT_STATUS[status] || { label: 'Analysis unavailable', badge: 'badge-invalid' };
}

function toneVars(grade) {
  if (grade === 'Grade A') {
    return { bg: 'var(--accent-soft)', border: 'rgba(47,125,91,0.3)', color: 'var(--accent)' };
  }
  if (grade === 'Grade B') {
    return { bg: 'var(--gold-soft)', border: 'rgba(168,132,60,0.32)', color: 'var(--gold)' };
  }
  if (grade === 'Grade C') {
    return { bg: 'rgba(199,122,46,0.14)', border: 'rgba(199,122,46,0.32)', color: '#b06a1f' };
  }
  if (grade === 'Grade D') {
    return { bg: 'rgba(180,66,66,0.16)', border: 'rgba(180,66,66,0.34)', color: '#8f2f2f' };
  }
  return { bg: 'var(--danger-soft)', border: 'rgba(180,66,66,0.3)', color: 'var(--danger)' };
}

function DetailRow({ label, value, mono = false }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[color:var(--border)] py-2 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className={`max-w-[65%] break-words text-right text-xs font-semibold text-main ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}

export default function Result() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const stateScan = location.state?.scan || null;
  const scanId = id || location.state?.scanId || stateScan?.id || null;
  const { policy: contextPolicy } = usePolicy();

  const [scan, setScan] = useState(stateScan);
  const [loading, setLoading] = useState(Boolean(scanId));
  const [error, setError] = useState('');
  const [tab, setTab] = useState('annotated');
  const [downloading, setDownloading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [weightInput, setWeightInput] = useState('');
  const [appliedWeightKg, setAppliedWeightKg] = useState('');
  const [applyingWeight, setApplyingWeight] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);

  function loadScan(weightKg) {
    if (!scanId) return Promise.resolve();
    setLoading(true);
    setError('');
    const params = weightKg ? { weightKg } : undefined;
    return API.get(`/scans/${scanId}`, { params })
      .then((response) => setScan(response.data.scan))
      .catch((err) => setError(apiErrorMessage(err, 'Unable to load this prediction.')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!scanId) {
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    setError('');
    API.get(`/scans/${scanId}`)
      .then((response) => {
        if (alive) setScan(response.data.scan);
      })
      .catch((err) => {
        if (alive) setError(apiErrorMessage(err, 'Unable to load this prediction.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [scanId]);

  const policy = scan?.predictionPolicy || contextPolicy;
  const gradingOn = policy?.masterEnabled !== false && scan?.gradingEnabled !== false;
  const enabledLetters = useMemo(
    () => (gradingOn ? enabledGradeLetters(policy, scan) : []),
    [gradingOn, policy, scan]
  );
  const supportedLetters = useMemo(
    () => (gradingOn ? supportedGradeLetters(scan) : []),
    [gradingOn, scan]
  );
  const evaluatedLetters = useMemo(
    () => enabledLetters.filter((letter) => supportedLetters.includes(letter)),
    [enabledLetters, supportedLetters]
  );
  const unsupportedLetters = useMemo(
    () => enabledLetters.filter((letter) => !supportedLetters.includes(letter)),
    [enabledLetters, supportedLetters]
  );
  const breakdown = useMemo(() => gradeBreakdown(scan, enabledLetters), [scan, enabledLetters]);
  const total = gradingOn ? Number(scan?.totalCount) || 0 : 0;
  const countAvailable = evaluatedLetters.length > 0;
  const pricing = scan?.pricing;

  const availableTabs = useMemo(
    () =>
      IMAGE_TABS.filter(
        (item) => scan?.images?.[item.key] && (gradingOn || item.key === 'original')
      ),
    [scan, gradingOn]
  );

  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.some((item) => item.key === tab)) {
      setTab(availableTabs[0].key);
    }
  }, [availableTabs, tab]);

  async function downloadReport() {
    if (!scan) return;
    setDownloading(true);
    try {
      const query = appliedWeightKg ? `?weightKg=${encodeURIComponent(appliedWeightKg)}` : '';
      await downloadApiFile(
        `/scans/${scan.id}/report.pdf${query}`,
        downloadName(scan.reportId, 'report')
      );
      toast.success('PDF report downloaded.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not generate the PDF report.'));
    } finally {
      setDownloading(false);
    }
  }

  async function applyWeight(event) {
    event?.preventDefault();
    const weight = Number(weightInput);
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error('Enter the measured net weight in kilograms.');
      return;
    }
    setApplyingWeight(true);
    try {
      const normalized = String(weight);
      setAppliedWeightKg(normalized);
      await loadScan(normalized);
      toast.success('Weight-based price estimate updated.');
    } finally {
      setApplyingWeight(false);
    }
  }

  async function reanalyzeDefects() {
    if (!scan) return;
    setReanalyzing(true);
    try {
      const response = await API.post(`/scans/${scan.id}/reanalyze`, {
        weightKg: appliedWeightKg || undefined,
      });
      if (response.data?.scan) setScan(response.data.scan);
      if (response.data?.analysisUnavailable) {
        toast.info(response.data.message || 'Defect analysis is unavailable.');
      } else if (response.data?.success === false) {
        toast.info(response.data.message || 'Defect analysis completed with limitations.');
      } else {
        toast.success(response.data?.message || 'Defect analysis refreshed.');
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not retry defect analysis.'));
    } finally {
      setReanalyzing(false);
    }
  }

  async function removeScan() {
    if (!scan) return;
    setDeleting(true);
    try {
      await API.delete(`/scans/${scan.id}`);
      toast.success('Prediction deleted.');
      navigate('/history', { replace: true });
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not delete this prediction.'));
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  if (!scanId) {
    return (
      <Card>
        <EmptyState
          icon="🔎"
          title="No prediction selected"
          description="Open a saved prediction from your history, or analyse a new tray image."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => navigate('/upload')}>
                <UploadIcon width={16} height={16} /> New prediction
              </Button>
              <Button variant="secondary" onClick={() => navigate('/history')}>
                <HistoryIcon width={16} height={16} /> Go to history
              </Button>
            </div>
          }
        />
      </Card>
    );
  }

  if (loading && !scan) {
    return (
      <div className="space-y-5">
        <div className="card p-6">
          <div className="skeleton h-3 w-32" />
          <div className="skeleton mt-3 h-10 w-64" />
          <div className="skeleton mt-3 h-3 w-80 max-w-full" />
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="card p-4 lg:col-span-2">
            <div className="skeleton h-80 w-full" />
          </div>
          <div className="card space-y-3 p-5">
            <div className="skeleton h-4 w-32" />
            <div className="skeleton h-16 w-full" />
            <div className="skeleton h-16 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !scan) {
    return (
      <Card>
        <EmptyState
          icon="⚠"
          title="Prediction unavailable"
          description={error || 'This prediction could not be found, or it belongs to another account.'}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => navigate('/history')}>Back to history</Button>
              <Button variant="secondary" onClick={() => navigate('/upload')}>
                New prediction
              </Button>
            </div>
          }
        />
      </Card>
    );
  }

  const tone = toneVars(scan.finalGrade);
  const detections = scan.detections || [];
  const measurements = scan.measurements;
  const defects = scan.defects;
  const defectDetectionOn = Boolean(
    scan.defectDetectionEnabled ?? policy?.defectDetectionEnabled
  );
  const defectEntries =
    defects && defects.categories && typeof defects.categories === 'object'
      ? Object.values(defects.categories).filter((item) => item && item.status)
      : [];
  const defectRetryAvailable =
    defectDetectionOn &&
    policy?.geminiEnabled !== false &&
    (defects?.analysisStatus === 'unavailable' ||
      defectEntries.some((item) => item.status === 'error'));
  const warnings = scan.warnings || [];

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6 animate-in">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="pill">Report {scan.reportId || scan.id.slice(-6).toUpperCase()}</span>
              <span className="pill">{formatDateTime(scan.createdAt)}</span>
              {scan.processingMs !== null && (
                <span className="pill">{(scan.processingMs / 1000).toFixed(2)}s inference</span>
              )}
              {scan.lot && (
                <Link
                  to={`/lots/${scan.lot}`}
                  className="pill inline-flex items-center gap-1 hover:opacity-80"
                  title="Open the lot this prediction belongs to"
                >
                  <LayersIcon width={12} height={12} /> View lot
                </Link>
              )}
            </div>
            <h2 className="mt-3 truncate font-display text-2xl font-semibold text-main sm:text-3xl">
              {scan.filename}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {scan.imageWidth && scan.imageHeight
                ? `${scan.imageWidth} × ${scan.imageHeight} px · `
                : ''}
              {!gradingOn
                ? 'AI grading outputs are disabled by the active administrator policy.'
                : scan.finalGradeSource === 'gemini_advisory'
                ? 'Gemini visual advisory — image-level review only; no per-nut count or confidence.'
                : gradeDescription(scan.finalGrade)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={downloadReport} disabled={downloading}>
              {downloading ? <Spinner size={15} /> : <DownloadIcon width={16} height={16} />}
              {downloading ? 'Preparing…' : 'Download PDF'}
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/compare?ids=${scan.id}`)}>
              <CompareIcon width={16} height={16} /> Compare
            </Button>
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              <TrashIcon width={16} height={16} /> Delete
            </Button>
          </div>
        </div>
      </Card>

      <PolicyNotice policy={policy} showPricing />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-5">
          <Card className="overflow-hidden animate-in">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--border)] px-4 py-3">
              <div className="flex flex-wrap gap-1.5">
                {availableTabs.map((item) => {
                  const available = Boolean(scan.images?.[item.key]);
                  return (
                    <button
                      key={item.key}
                      type="button"
                      disabled={!available}
                      onClick={() => setTab(item.key)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        tab === item.key
                          ? 'bg-[color:var(--accent-soft)] text-accent'
                          : available
                          ? 'text-muted hover:text-main'
                          : 'cursor-not-allowed text-muted opacity-40'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted">
                {!gradingOn
                  ? 'AI grading overlays are suppressed by the active policy'
                  : tab === 'annotated'
                  ? 'Bounding boxes with Nut IDs and grades from model detections'
                  : tab === 'processed'
                  ? 'Actual model-input preprocessing preview (letterboxed)'
                  : 'Original uploaded image'}
              </p>
            </div>
            <div
              className="flex min-h-[18rem] items-center justify-center p-3 sm:p-4"
              style={{ background: 'var(--panel-soft)' }}
            >
              {scan.images?.[tab] ? (
                <ProtectedImage
                  url={scan.images[tab]}
                  label={IMAGE_TABS.find((item) => item.key === tab)?.label || 'Image'}
                  alt={gradingOn ? `${scan.finalGrade || 'Automated'} prediction for ${scan.filename}` : scan.filename}
                  className="max-h-[30rem] w-full rounded-2xl object-contain"
                />
              ) : (
                <div className="py-12 text-center text-sm text-muted">
                  This image is not available for this record.
                </div>
              )}
            </div>
          </Card>

          {gradingOn && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div
                className="rounded-3xl border p-5"
                style={{ background: tone.bg, borderColor: tone.border }}
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: tone.color }}>
                  Majority grade
                </p>
                <p className="mt-2 font-display text-3xl font-bold" style={{ color: tone.color }}>
                  {scan.finalGrade || 'Unavailable'}
                </p>
                <p className="mt-1 text-xs" style={{ color: tone.color }}>
                  {countAvailable
                    ? `${formatNumber(total)} enabled nut${total === 1 ? '' : 's'} detected`
                    : 'No per-nut count is available for the enabled grades.'}
                </p>
                {scan.finalGradeSource === 'gemini_advisory' && (
                  <p className="mt-1 text-[10px] font-semibold" style={{ color: tone.color }}>
                    Gemini advisory only — not a validated detector.
                  </p>
                )}
              </div>
              {breakdown.map((item) => {
                const availability = gradeAvailability(scan, item.letter);
                const supported = availability.supported;
                const count = supported ? Number(availability.count ?? item.count) : null;
                const pct =
                  supported && total ? Math.round((count / total) * 1000) / 10 : null;
                return (
                  <div className={`card p-5 ${supported ? '' : 'opacity-80'}`} key={item.grade}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                      {item.grade} composition
                    </p>
                    <p
                      className="stat-value mt-2"
                      style={{ color: supported ? gradeColor(item.grade) : 'var(--text-muted)' }}
                    >
                      {supported ? `${pct}%` : '—'}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {supported
                        ? `${formatNumber(count)} of ${formatNumber(total)} detections`
                        : 'Enabled, but no validated detector count is available'}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {gradingOn && unsupportedLetters.length > 0 && (
            <Card className="p-5 animate-in">
              <h3 className="font-display text-base font-semibold text-main">
                Grade {unsupportedLetters.join(' / Grade ')} is enabled but not counted
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                The bundled checkpoint exposes{' '}
                {supportedLetters.length
                  ? supportedLetters.map((letter) => `Grade ${letter}`).join(', ')
                  : 'no grade'}{' '}
                classes. Grade {unsupportedLetters.join(' / ')} is shown only when Gemini
                provides a validated visual advisory. Gemini is never used as an object detector,
                so no C/D detections or counts are inferred from A/B results. Install a validated
                four-class detector to obtain C/D counts.
              </p>
            </Card>
          )}

          {gradingOn && scan.geminiAdvisory && (
            <Card className="p-5 animate-in">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-base font-semibold text-main">
                    Gemini visual advisory
                  </h3>
                  <p className="mt-1 text-xs text-muted">
                    Image-level review only. This is not an object detector and does not create
                    counts, boxes, or confidence values.
                  </p>
                </div>
                <span className={`badge ${scan.geminiAdvisory.status === 'ok' ? 'badge-a' : 'badge-neutral'}`}>
                  {scan.geminiAdvisory.status || 'advisory'}
                </span>
              </div>
              <div className="mt-3 space-y-2 text-xs leading-relaxed text-muted">
                <p>
                  <span className="font-semibold text-main">Grade hint:</span>{' '}
                  {scan.geminiAdvisory.gradeHint || 'No grade hint returned.'}
                </p>
                {scan.geminiAdvisory.note && <p>{scan.geminiAdvisory.note}</p>}
                {Array.isArray(scan.geminiAdvisory.evidence) && scan.geminiAdvisory.evidence.length > 0 && (
                  <div>
                    <p className="font-semibold text-main">Visual evidence</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {scan.geminiAdvisory.evidence.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(scan.geminiAdvisory.limitations) && scan.geminiAdvisory.limitations.length > 0 && (
                  <div>
                    <p className="font-semibold text-main">Limitations</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {scan.geminiAdvisory.limitations.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          )}

          {gradingOn && pricing?.active && (
            <Card className="p-5 animate-in">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-base font-semibold text-main">
                    Price estimate
                  </h3>
                  <p className="mt-1 text-xs text-muted">{pricingStatusText(pricing)}</p>
                </div>
                <span className="pill">{pricing.mode === 'live' ? 'Live AGMARKNET' : 'Manual pricing'}</span>
              </div>

              {Array.isArray(pricing.lineItems) && pricing.lineItems.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Grade</th>
                        <th>Count</th>
                        <th>Price</th>
                        <th>Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pricing.lineItems.map((line) => (
                        <tr key={line.grade}>
                          <td className="font-semibold text-main">{line.label}</td>
                          <td>{formatNumber(line.count)}</td>
                          <td>
                            {line.price === null
                              ? '—'
                              : `${formatCurrency(line.price, pricing.currency)} ${
                                  line.unit === 'per_nut'
                                    ? 'per nut'
                                    : line.unit === 'per_quintal'
                                    ? 'per quintal'
                                    : 'per kg'
                                }`}
                          </td>
                          <td>{line.subtotal === null ? '—' : formatCurrency(line.subtotal, pricing.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {pricing.requiresWeight && (
                <form onSubmit={applyWeight} className="mt-3 flex flex-col gap-2 rounded-2xl bg-[color:var(--panel-soft)] p-3 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <label className="field-label" htmlFor="result-weight">Measured net weight (kg)</label>
                    <input
                      id="result-weight"
                      className="input"
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={weightInput}
                      onChange={(event) => setWeightInput(event.target.value)}
                      placeholder="e.g. 12.5"
                    />
                  </div>
                  <Button type="submit" disabled={applyingWeight}>
                    {applyingWeight ? <Spinner size={14} /> : null}
                    {applyingWeight ? 'Applying…' : 'Apply weight'}
                  </Button>
                </form>
              )}

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-2xl bg-[color:var(--panel-soft)] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted">Measured / estimated weight</p>
                  <p className="mt-1 font-semibold text-main">{formatWeightKg(pricing.totalWeightKg)}</p>
                </div>
                <div className="rounded-2xl bg-[color:var(--panel-soft)] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted">Count-weighted price</p>
                  <p className="mt-1 font-semibold text-main">
                    {pricing.weightedPricePerKg === null
                      ? '—'
                      : `${formatCurrency(pricing.weightedPricePerKg, pricing.currency)} / kg`}
                  </p>
                </div>
                <div className="rounded-2xl bg-[color:var(--panel-soft)] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted">Estimated total</p>
                  <p className="mt-1 font-display text-lg font-bold text-main">
                    {pricing.totalValue === null
                      ? 'Not claimed'
                      : formatCurrency(pricing.totalValue, pricing.currency)}
                  </p>
                </div>
              </div>

              {pricing.livePrice && (
                <p className="mt-3 text-[11px] leading-relaxed text-muted">
                  {pricing.livePrice.market || 'AGMARKNET'}{' '}
                  {pricing.livePrice.variety ? `· ${pricing.livePrice.variety}` : ''} ·{' '}
                  {pricing.livePrice.arrivalDate || 'date unavailable'} ·{' '}
                  {formatCurrency(pricing.livePrice.pricePerQuintal, pricing.currency)} / quintal.
                </p>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                {pricing.note || pricing.formula}
              </p>
            </Card>
          )}

          {gradingOn && (
            <Card className="overflow-hidden animate-in">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border)] px-5 py-4">
                <div>
                  <h3 className="font-display text-lg font-semibold text-main">Detections</h3>
                  <p className="text-xs text-muted">Every box above the model confidence threshold</p>
                </div>
                <span className="pill">{detections.length} boxes</span>
              </div>
              {detections.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-muted">
                  No arecanut regions were detected in this image. See the warnings below.
                </p>
              ) : (
                <div className="table-shell">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Class</th>
                        <th>Confidence</th>
                        <th>Box (x1, y1, x2, y2)</th>
                        <th>Size (px)</th>
                        <th>Aspect</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detections.map((detection, index) => (
                        <tr key={`${detection.label}-${index}`}>
                          <td className="text-xs text-muted">{String(index + 1).padStart(2, '0')}</td>
                          <td>
                            <span className={`badge badge-${['A', 'B', 'C', 'D'].includes(detection.grade) ? detection.grade.toLowerCase() : 'neutral'}`}>
                              {detection.label}
                            </span>
                          </td>
                          <td className="text-sm text-main">
                            {formatPercent(detection.confidence_pct ?? (detection.confidence || 0) * 100, 2)}
                          </td>
                          <td className="whitespace-nowrap font-mono text-[11px] text-muted">
                            {(detection.bbox || []).map((value) => Number(value).toFixed(0)).join(', ')}
                          </td>
                          <td className="whitespace-nowrap text-xs text-muted">
                            {Number(detection.box_width_px || 0).toFixed(0)} ×{' '}
                            {Number(detection.box_height_px || 0).toFixed(0)}
                          </td>
                          <td className="text-xs text-main">
                            {detection.aspect_ratio ? Number(detection.aspect_ratio).toFixed(2) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {gradingOn && warnings.length > 0 && (
            <Card className="p-5 animate-in">
              <h3 className="font-display text-lg font-semibold text-main">Warnings &amp; limitations</h3>
              <ul className="mt-3 space-y-2">
                {warnings.map((warning) => (
                  <li key={warning} className="alert alert-warn items-start text-xs leading-relaxed">
                    <AlertIcon width={15} height={15} />
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {gradingOn && (
            <Card className="p-5 animate-in">
              <h3 className="font-display text-base font-semibold text-main">Result summary</h3>
              <div className="mt-3">
                <DetailRow label="Final grade" value={<GradeBadge grade={scan.finalGrade} />} />
                <DetailRow
                  label="Total detected"
                  value={countAvailable ? formatNumber(total) : 'No enabled per-nut count'}
                />
                {breakdown.map((item) => {
                  const availability = gradeAvailability(scan, item.letter);
                  return (
                    <DetailRow
                      key={item.grade}
                      label={item.grade}
                      value={
                        availability.supported
                          ? formatNumber(availability.count ?? item.count)
                          : 'Enabled; no validated detector count'
                      }
                    />
                  );
                })}
                <DetailRow
                  label="Evaluated grades"
                  value={
                    supportedLetters.length
                      ? supportedLetters.map((letter) => `Grade ${letter}`).join(', ')
                      : 'No validated grade detector'
                  }
                />
                <DetailRow
                  label="Confidence"
                  value={scan.confidence === null ? '—' : formatPercent(scan.confidence, 2)}
                />
                <DetailRow
                  label="Quality score"
                  value={scan.qualityScore === null ? '—' : `${Number(scan.qualityScore).toFixed(2)} / 100`}
                />
                {scan.finalGradeSource && (
                  <DetailRow label="Grade source" value={scan.finalGradeSource.replace(/_/g, ' ')} />
                )}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted">
                {scan.confidenceMethod ||
                  'Confidence is the mean winning-class detection confidence, not a calibrated probability.'}
              </p>
            </Card>
          )}

          {gradingOn && (
            <Card className="p-5 animate-in">
              <h3 className="font-display text-base font-semibold text-main">Image measurements</h3>
              {measurements?.available ? (
                <div className="mt-3">
                  <DetailRow label="Method" value="Bounding-box, image space" />
                  <DetailRow label="Units" value="pixels (uncalibrated)" />
                  <DetailRow label="Samples" value={measurements.sample_count} />
                  <DetailRow
                    label="Avg major axis"
                    value={`${Number(measurements.avg_major_axis_px).toFixed(1)} px`}
                  />
                  <DetailRow
                    label="Avg minor axis"
                    value={`${Number(measurements.avg_minor_axis_px).toFixed(1)} px`}
                  />
                  <DetailRow
                    label="Avg aspect ratio"
                    value={Number(measurements.avg_aspect_ratio).toFixed(2)}
                  />
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">No measurement sample is available.</p>
              )}
              <p className="mt-3 text-[11px] leading-relaxed text-muted">
                Physical dimensions and shape irregularity are unavailable: no camera calibration or
                segmentation model is bundled.
              </p>
            </Card>
          )}

          {defectDetectionOn && (
            <Card className="p-5 animate-in">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-semibold text-main">
                    Defect analysis
                  </h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    Gemini image-level review. Findings are separate from grading and never
                    downgrade a grade automatically.
                  </p>
                </div>
                {defectRetryAvailable && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={reanalyzeDefects}
                    disabled={reanalyzing}
                  >
                    {reanalyzing ? <Spinner size={13} /> : <SparkIcon width={14} height={14} />}
                    {reanalyzing ? 'Retrying…' : 'Retry analysis'}
                  </Button>
                )}
              </div>

              {defectEntries.length === 0 ? (
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  No defect analysis is stored for this prediction. Use retry to run Gemini against
                  the stored original image.
                </p>
              ) : (
                <>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-muted">
                    <span className="pill">
                      {defects.analysisStatus === 'success'
                        ? 'Analysis complete'
                        : defects.analysisStatus === 'partial'
                        ? 'Partially complete'
                        : 'Analysis unavailable'}
                    </span>
                    {defects.analyzedAt && (
                      <span className="pill">{formatDateTime(defects.analyzedAt)}</span>
                    )}
                    {defects.model && <span className="pill">{defects.model}</span>}
                  </div>

                  {defects.error && (
                    <div className="alert alert-danger mt-3 items-start text-xs leading-relaxed">
                      <AlertIcon width={15} height={15} />
                      <span>{defects.error}</span>
                    </div>
                  )}

                  <ul className="mt-3 space-y-3">
                    {defectEntries.map((category) => {
                      const meta = defectStatusMeta(category.status);
                      return (
                        <li
                          key={category.key || category.name}
                          className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-main">
                              {category.name}
                            </span>
                            <span className={`badge ${meta.badge}`}>{meta.label}</span>
                          </div>
                          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                            {category.explanation}
                          </p>
                          {Number.isInteger(category.affectedNutCount) &&
                            category.countBasis === 'validated_detector' && (
                              <p className="mt-1 text-[10px] font-semibold text-main">
                                Affected nuts: {formatNumber(category.affectedNutCount)}
                              </p>
                            )}
                        </li>
                      );
                    })}
                  </ul>

                  {defects.limitations?.length > 0 && (
                    <div className="mt-3 rounded-2xl bg-[color:var(--panel-soft)] p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
                        Limitations
                      </p>
                      <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-muted">
                        {defects.limitations.map((item) => (
                          <li key={item}>• {item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="mt-3 text-[10px] leading-relaxed text-muted">
                    {defects.note ||
                      'Image-level findings only. No defect location, bounding box, verified affected-nut count, or fungal confirmation is claimed.'}
                  </p>
                  {!policy?.geminiEnabled && (
                    <p className="mt-2 text-[10px] font-semibold text-danger">
                      Gemini-assisted analysis is disabled by the administrator. Ask an administrator
                      to enable it before retrying.
                    </p>
                  )}
                </>
              )}
            </Card>
          )}

          <Card className="p-5 animate-in">
            <h3 className="font-display text-base font-semibold text-main">Model provenance</h3>
            <div className="mt-3">
              <DetailRow label="Model" value={scan.modelId || '—'} />
              <DetailRow label="Version" value={scan.modelVersion || '—'} />
              <DetailRow label="Task" value="Object detection (YOLOv8)" />
              <DetailRow
                label="Checksum"
                value={scan.modelChecksum ? `${scan.modelChecksum.slice(0, 16)}…` : '—'}
                mono
              />
            </div>
            <Link to="/performance" className="link mt-3 inline-flex items-center gap-1 text-xs">
              Verify model artifact <ArrowRightIcon width={13} height={13} />
            </Link>
          </Card>

          <Card className="p-5 animate-in">
            <h3 className="font-display text-base font-semibold text-main">Next actions</h3>
            <div className="mt-3 flex flex-col gap-2">
              <Button onClick={() => navigate('/upload')}>
                <UploadIcon width={16} height={16} /> Grade another image
              </Button>
              <Button variant="secondary" onClick={() => navigate('/history')}>
                <HistoryIcon width={16} height={16} /> Back to history
              </Button>
              <Button variant="secondary" onClick={() => navigate('/compare')}>
                <CompareIcon width={16} height={16} /> Compare predictions
              </Button>
            </div>
          </Card>

          <div className="alert items-start text-[11px] leading-relaxed text-muted">
            <SparkIcon width={16} height={16} />
            <span>
              Automated estimate only. Not a certified commercial grade, laboratory test, or
              guarantee of quality.
            </span>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={removeScan}
        loading={deleting}
        destructive
        title="Delete this prediction?"
        description="The report and its stored images will be permanently removed from your account. This cannot be undone."
        confirmLabel="Delete prediction"
      />
    </div>
  );
}
