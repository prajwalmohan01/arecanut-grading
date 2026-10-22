import { useEffect, useMemo, useState } from 'react';
import API, { apiErrorMessage, downloadApiFile } from '../api/axios';
import { useToast } from '../context/ToastContext';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  PerformanceIcon,
  SparkIcon,
} from '../components/Icons';
import { formatDateTime } from '../utils/format';

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

function Row({ label, value, mono = false }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[color:var(--border)] py-2.5 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className={`max-w-[68%] break-all text-right text-xs font-semibold text-main ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}

const CAPABILITY_LABELS = [
  ['object_detection', 'Object detection'],
  ['image_classification', 'Image classification'],
  ['instance_segmentation', 'Instance segmentation'],
  ['defect_detection', 'Defect detection'],
  ['size_shape_physical_measurement', 'Physical size / shape measurement'],
];

export default function Performance() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    API.get('/scans/performance')
      .then((response) => {
        if (alive) setData(response.data);
      })
      .catch((err) => {
        if (alive) setError(apiErrorMessage(err, 'Unable to read model status.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const artifact = data?.artifact || {};
  const model = data?.model || {};
  const evaluation = data?.evaluation || {};
  const capabilities = data?.capabilities || {};
  const runtime = data?.runtime;

  const verified = useMemo(() => {
    if (!artifact.exists) return { tone: 'invalid', label: 'Artifact missing' };
    if (artifact.checksumMatchesMetadata === false) {
      return { tone: 'invalid', label: 'Checksum mismatch' };
    }
    if (artifact.checksumMatchesMetadata === true) {
      return { tone: 'a', label: 'Verified checksum' };
    }
    return { tone: 'neutral', label: 'Checksum unverified' };
  }, [artifact]);

  async function copyChecksum() {
    if (!artifact.checksum) return;
    try {
      await navigator.clipboard.writeText(artifact.checksum);
      toast.success('Checksum copied to clipboard.');
    } catch {
      toast.error('Clipboard access was blocked by the browser.');
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadApiFile('/scans/performance/export.csv', 'arecanut-model-metrics.csv');
      toast.success('Metrics CSV downloaded.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'No verified metrics are available to export.'));
    } finally {
      setExporting(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <div className="card p-6">
          <div className="skeleton h-3 w-32" />
          <div className="skeleton mt-3 h-9 w-72" />
          <div className="skeleton mt-3 h-3 w-96 max-w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="card p-5">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton mt-3 h-7 w-32" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <Card className="p-6">
        <div className="alert alert-danger">
          <AlertIcon width={18} height={18} />
          <div className="flex-1">
            <p className="font-semibold">Model status unavailable</p>
            <p className="mt-0.5">{error}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="relative overflow-hidden p-5 sm:p-6 animate-in">
        <div
          className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full opacity-50 blur-3xl"
          style={{ background: 'var(--accent-soft)' }}
        />
        <div className="relative flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={verified.tone}>{verified.label}</Badge>
              <span className="pill">{data?.transport || 'local'} transport</span>
              <span className="pill">{model.task || 'detect'}</span>
            </div>
            <h2 className="mt-3 font-display text-2xl font-semibold text-main sm:text-3xl">
              Model performance &amp; verification
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
              The preserved trained artifact is checked against its recorded SHA-256 on every
              status request. Evaluation metrics are shown only when a verified held-out report
              exists — unavailable metrics are never invented.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}>
              {loading ? <Spinner size={15} /> : <PerformanceIcon width={16} height={16} />}
              Re-verify
            </Button>
            <Button
              variant="secondary"
              onClick={exportCsv}
              disabled={!evaluation.available || exporting}
              title={
                evaluation.available
                  ? 'Download verified evaluation metrics'
                  : 'No verified evaluation metrics are available'
              }
            >
              {exporting ? <Spinner size={15} /> : <DownloadIcon width={16} height={16} />}
              Export metrics
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">Model</p>
          <p className="mt-2 truncate font-display text-xl font-semibold text-main" title={model.id}>
            {model.id || '—'}
          </p>
          <p className="mt-1 text-xs text-muted">Version {model.version || '—'}</p>
        </Card>
        <Card className="p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">Artifact</p>
          <p className="mt-2 font-display text-xl font-semibold text-main">
            {artifact.exists ? formatBytes(artifact.sizeBytes) : 'Missing'}
          </p>
          <p className="mt-1 text-xs text-muted">
            {artifact.modifiedAt ? `Modified ${formatDateTime(artifact.modifiedAt)}` : 'No artifact timestamp'}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">SHA-256</p>
          <p
            className={`mt-2 text-lg font-semibold ${
              artifact.checksumMatchesMetadata === false ? 'text-danger' : 'text-accent'
            }`}
          >
            {artifact.checksumMatchesMetadata === true
              ? 'Matches metadata'
              : artifact.checksumMatchesMetadata === false
              ? 'Mismatch'
              : 'Unverified'}
          </p>
          <button type="button" onClick={copyChecksum} className="link mt-1 block max-w-full truncate text-left text-[11px]" title="Copy checksum">
            {artifact.checksum ? `${artifact.checksum.slice(0, 20)}…` : 'No checksum available'}
          </button>
        </Card>
        <Card className="p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">Runtime</p>
          <p className="mt-2 font-display text-xl font-semibold text-main">
            {data?.transport === 'http'
              ? runtime?.reachable === true
                ? 'Reachable'
                : runtime?.reachable === false
                ? 'Unreachable'
                : 'Unknown'
              : 'In-process CLI'}
          </p>
          <p className="mt-1 text-xs text-muted">
            {data?.transport === 'http'
              ? runtime?.detail || 'ML service health ping'
              : 'Local Python inference transport'}
          </p>
        </Card>
      </div>

      {artifact.checksumMatchesMetadata === false && (
        <div className="alert alert-danger">
          <AlertIcon width={18} height={18} />
          <div>
            <p className="font-semibold">The model file does not match its recorded checksum</p>
            <p className="mt-0.5">
              Do not rely on predictions until the original artifact is restored. Run
              <code className="mx-1 rounded bg-black/10 px-1 py-0.5 text-[11px]">python scripts/verify_model.py</code>
              from the project root.
            </p>
          </div>
        </div>
      )}

      {!artifact.exists && (
        <div className="alert alert-danger">
          <AlertIcon width={18} height={18} />
          <span>
            The trained model artifact is missing. Restore <code>ml_service/weights/best.pt</code>;
            the application will not substitute an untrained model.
          </span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5 animate-in">
          <h3 className="font-display text-lg font-semibold text-main">Artifact verification</h3>
          <div className="mt-3">
            <Row label="Artifact exists" value={artifact.exists ? 'Yes' : 'No'} />
            <Row label="Size" value={formatBytes(artifact.sizeBytes)} />
            <Row label="Checksum matches metadata" value={
              artifact.checksumMatchesMetadata === null
                ? 'Not recorded'
                : artifact.checksumMatchesMetadata
                ? 'Yes'
                : 'No'
            } />
            <Row label="Last modified" value={artifact.modifiedAt ? formatDateTime(artifact.modifiedAt) : '—'} />
            <Row label="Transport" value={data?.transport || '—'} />
          </div>
          <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted break-all">
            {artifact.checksum || 'No SHA-256 available'}
          </p>
        </Card>

        <Card className="p-5 animate-in">
          <h3 className="font-display text-lg font-semibold text-main">Model classes &amp; input</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {(model.classes || []).map((entry) =>
              typeof entry === 'string' ? (
                <span key={entry} className="badge badge-a">{entry}</span>
              ) : (
                <span key={entry.index} className="badge badge-a">
                  {entry.name} → Grade {entry.grade}
                </span>
              )
            )}
            {(!model.classes || model.classes.length === 0) && (
              <span className="text-sm text-muted">No class list recorded.</span>
            )}
          </div>
          <div className="mt-3">
            <Row label="Task" value={model.task || '—'} />
            <Row label="Input size" value={model.input?.imgsz ? `${model.input.imgsz} px` : '—'} />
            <Row label="Confidence threshold" value={model.input?.confidence_threshold ?? '—'} />
            <Row label="IoU threshold" value={model.input?.iou_threshold ?? '—'} />
            <Row label="Colour space" value={model.input?.color_space || '—'} />
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5 animate-in">
          <h3 className="font-display text-lg font-semibold text-main">Capability matrix</h3>
          <p className="mt-1 text-xs text-muted">
            Only capabilities supported by the preserved model are presented as available.
          </p>
          <ul className="mt-4 space-y-2">
            {CAPABILITY_LABELS.map(([key, label]) => {
              const supported = capabilities[key] === true;
              return (
                <li
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2.5"
                >
                  <span className="text-sm text-main">{label}</span>
                  <span className={`badge ${supported ? 'badge-a' : 'badge-neutral'}`}>
                    {supported ? <CheckIcon width={12} height={12} /> : <CloseIcon width={11} height={11} />}
                    {supported ? 'Supported' : 'Not supported'}
                  </span>
                </li>
              );
            })}
          </ul>
          {capabilities.notes && (
            <p className="mt-3 text-[11px] leading-relaxed text-muted">{capabilities.notes}</p>
          )}
        </Card>

        <Card className="p-5 animate-in">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-lg font-semibold text-main">Evaluation metrics</h3>
            <Badge tone={evaluation.available ? 'a' : 'neutral'}>
              {evaluation.available ? 'Verified report' : 'Unavailable'}
            </Badge>
          </div>

          {evaluation.available ? (
            <div className="mt-3">
              <Row label="Dataset size" value={evaluation.metrics?.datasetSize ?? '—'} />
              <Row label="Accuracy" value={evaluation.metrics?.accuracy ?? '—'} />
              <Row label="Precision" value={evaluation.metrics?.precision ?? '—'} />
              <Row label="Recall" value={evaluation.metrics?.recall ?? '—'} />
              <Row label="F1" value={evaluation.metrics?.f1 ?? '—'} />
              <Row label="Evaluated at" value={evaluation.metrics?.evaluatedAt ? formatDateTime(evaluation.metrics.evaluatedAt) : '—'} />
            </div>
          ) : (
            <div className="mt-3 alert alert-warn items-start text-xs leading-relaxed">
              <AlertIcon width={16} height={16} />
              <div>
                <p className="font-semibold">No verified metrics are bundled</p>
                <p className="mt-1">{evaluation.reason || 'Evaluation metrics are not available.'}</p>
                <p className="mt-2 text-muted">
                  Accuracy, precision, recall, and F1 are intentionally blank rather than
                  estimated. Generate a report with a labelled dataset using
                  <code className="mx-1 rounded bg-black/10 px-1 py-0.5 text-[11px]">scripts/evaluate_model.py</code>.
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5 animate-in">
        <div className="flex items-start gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
            style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}
          >
            <SparkIcon width={18} height={18} />
          </span>
          <div>
            <h3 className="font-display text-lg font-semibold text-main">What the numbers mean</h3>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
              <li>
                <strong className="text-main">Confidence</strong> is the mean detection confidence of the
                winning grade class. It is not a calibrated probability.
              </li>
              <li>
                <strong className="text-main">Quality score</strong> is a documented heuristic:{' '}
                <code>100 × (1.0·A + 0.5·B) / total</code>. It is not a model output or lab result.
              </li>
              <li>
                <strong className="text-main">Measurements</strong> are axis-aligned bounding boxes in
                uncalibrated pixel space. No physical dimensions are inferred.
              </li>
              <li>
                <strong className="text-main">Defects</strong> such as black spots, cracks, mold, and
                discoloration are outside the trained model&apos;s classes.
              </li>
            </ul>
          </div>
        </div>
      </Card>

      <p className="pb-1 text-[11px] leading-relaxed text-muted">
        Model health checks are read-only. This page never retrains, overwrites, or reinitialises the
        preserved weights.
      </p>
    </div>
  );
}
