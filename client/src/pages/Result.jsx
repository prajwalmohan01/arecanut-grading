import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import API, { apiErrorMessage, downloadApiFile } from '../api/axios';
import { useToast } from '../context/ToastContext';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import ProtectedImage from '../components/ProtectedImage';
import { GradeBadge } from '../components/ui/Badge';
import {
  AlertIcon,
  ArrowRightIcon,
  CompareIcon,
  DownloadIcon,
  HistoryIcon,
  SparkIcon,
  TrashIcon,
  UploadIcon,
} from '../components/Icons';
import {
  downloadName,
  formatDateTime,
  formatPercent,
  gradeBreakdown,
  gradeColor,
  gradeDescription,
  supportedGradeLetters,
} from '../utils/format';

const IMAGE_TABS = [
  { key: 'original', label: 'Original Image' },
  { key: 'annotated', label: 'Annotated Image' },
  { key: 'processed', label: 'Processed Image' },
];

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

  const [scan, setScan] = useState(stateScan);
  const [loading, setLoading] = useState(Boolean(scanId));
  const [error, setError] = useState('');
  const [tab, setTab] = useState('annotated');
  const [downloading, setDownloading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  const total = scan?.totalCount || 0;
  const breakdown = useMemo(() => gradeBreakdown(scan), [scan]);
  const supportedLetters = useMemo(() => supportedGradeLetters(scan), [scan]);
  const unsupportedLetters = useMemo(
    () => ['A', 'B', 'C', 'D'].filter((letter) => !supportedLetters.includes(letter)),
    [supportedLetters]
  );

  const availableTabs = useMemo(
    () => IMAGE_TABS.filter((item) => scan?.images?.[item.key]),
    [scan]
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
      await downloadApiFile(`/scans/${scan.id}/report.pdf`, downloadName(scan.reportId, 'report'));
      toast.success('PDF report downloaded.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not generate the PDF report.'));
    } finally {
      setDownloading(false);
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
            </div>
            <h2 className="mt-3 truncate font-display text-2xl font-semibold text-main sm:text-3xl">
              {scan.filename}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {scan.imageWidth && scan.imageHeight
                ? `${scan.imageWidth} × ${scan.imageHeight} px · `
                : ''}
              {gradeDescription(scan.finalGrade)}
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-5">
          <Card className="overflow-hidden animate-in">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--border)] px-4 py-3">
              <div className="flex flex-wrap gap-1.5">
                {IMAGE_TABS.map((item) => {
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
                {tab === 'annotated'
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
                  alt={`${scan.finalGrade} prediction for ${scan.filename}`}
                  className="max-h-[30rem] w-full rounded-2xl object-contain"
                />
              ) : (
                <div className="py-12 text-center text-sm text-muted">
                  This image is not available for this record.
                </div>
              )}
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3">
            <div
              className="rounded-3xl border p-5"
              style={{ background: tone.bg, borderColor: tone.border }}
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: tone.color }}>
                Majority grade
              </p>
              <p className="mt-2 font-display text-3xl font-bold" style={{ color: tone.color }}>
                {scan.finalGrade}
              </p>
              <p className="mt-1 text-xs" style={{ color: tone.color }}>
                {total} nut{total === 1 ? '' : 's'} detected
              </p>
            </div>
            {breakdown.map((item) => {
              const supported = supportedLetters.includes(item.letter);
              const pct = total ? Math.round((item.count / total) * 1000) / 10 : 0;
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
                    {supported ? `${item.count} of ${total} detections` : 'Not evaluated by this model'}
                  </p>
                </div>
              );
            })}
          </div>

          {unsupportedLetters.length > 0 && (
            <Card className="p-5 animate-in">
              <h3 className="font-display text-base font-semibold text-main">
                Grade {unsupportedLetters.join(' / Grade ')} not supported by this model
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                All four grade cards are shown for completeness. This prediction was
                produced by a checkpoint that exposes{' '}
                {supportedLetters.map((letter) => `Grade ${letter}`).join(', ')} classes, so
                Grade {unsupportedLetters.join(' / ')} are marked as not evaluated. No C/D
                detections are inferred from A/B results. They become live automatically if a
                checkpoint containing GradeC/GradeD classes is installed.
              </p>
            </Card>
          )}

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

          {warnings.length > 0 && (
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
          <Card className="p-5 animate-in">
            <h3 className="font-display text-base font-semibold text-main">Result summary</h3>
            <div className="mt-3">
              <DetailRow label="Final grade" value={<GradeBadge grade={scan.finalGrade} />} />
              <DetailRow label="Total detected" value={total} />
              {breakdown.map((item) => (
                <DetailRow
                  key={item.grade}
                  label={item.grade}
                  value={
                    supportedLetters.includes(item.letter)
                      ? item.count
                      : 'Not supported by this model'
                  }
                />
              ))}
              <DetailRow
                label="Evaluated grades"
                value={supportedLetters.map((letter) => `Grade ${letter}`).join(', ')}
              />
              <DetailRow
                label="Confidence"
                value={formatPercent(scan.confidence, 2)}
              />
              <DetailRow
                label="Quality score"
                value={scan.qualityScore === null ? '—' : `${Number(scan.qualityScore).toFixed(2)} / 100`}
              />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              {scan.confidenceMethod ||
                'Confidence is the mean winning-class detection confidence, not a calibrated probability.'}
            </p>
          </Card>

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

          <Card className="p-5 animate-in">
            <h3 className="font-display text-base font-semibold text-main">Defect analysis</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {defects?.reason ||
                'Defect detection is not supported by the preserved two-class model.'}
            </p>
            {Array.isArray(defects?.categories) && defects.categories.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {defects.categories.map((category) => (
                  <li key={category.name} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted">{category.name}</span>
                    <span className="badge badge-neutral">Not supported</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

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
