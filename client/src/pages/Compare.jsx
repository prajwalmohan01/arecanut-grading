import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import API, { apiErrorMessage, downloadApiFile } from '../api/axios';
import { useToast } from '../context/ToastContext';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import ProtectedImage from '../components/ProtectedImage';
import { GradeBadge } from '../components/ui/Badge';
import { SelectField } from '../components/ui/Field';
import {
  AlertIcon,
  ArrowRightIcon,
  CompareIcon,
  DownloadIcon,
  HistoryIcon,
  UploadIcon,
} from '../components/Icons';
import { compareArrow, formatDateTime, formatNumber, formatPercent } from '../utils/format';

function ScanPanel({ scan, slot }) {
  const annotations = scan.images?.annotated || scan.images?.original;
  return (
    <Card className="overflow-hidden animate-in">
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="badge badge-neutral">Image {slot}</span>
          <GradeBadge grade={scan.finalGrade} />
        </div>
        <Link to={`/result/${scan.id}`} className="link inline-flex items-center gap-1 text-xs">
          Open report <ArrowRightIcon width={13} height={13} />
        </Link>
      </div>
      <div
        className="flex min-h-[15rem] items-center justify-center p-3"
        style={{ background: 'var(--panel-soft)' }}
      >
        {annotations ? (
          <ProtectedImage
            url={annotations}
            label="Annotated image"
            alt={`${scan.reportId || scan.filename} annotated prediction`}
            className="max-h-72 w-full rounded-2xl object-contain"
          />
        ) : (
          <p className="py-16 text-sm text-muted">No annotated image is available.</p>
        )}
      </div>
      <div className="p-4">
        <p className="truncate text-sm font-semibold text-main">
          {scan.reportId || scan.id.slice(-6).toUpperCase()}
        </p>
        <p className="truncate text-xs text-muted">{scan.filename}</p>
        <p className="mt-1 text-[11px] text-muted">{formatDateTime(scan.createdAt)}</p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {[
            ['Grade A', scan.gradeA, 'var(--accent)'],
            ['Grade B', scan.gradeB, 'var(--gold)'],
            ['Grade C', scan.gradeC || 0, '#c77a2e'],
            ['Grade D', scan.gradeD || 0, '#8f2f2f'],
            ['Total', scan.totalCount, 'var(--text)'],
            ['Quality', scan.qualityScore === null ? '—' : Number(scan.qualityScore).toFixed(1), 'var(--text)'],
            ['Confidence', formatPercent(scan.confidence), 'var(--text)'],
            [
              'Processing',
              scan.processingMs === null ? '—' : `${(scan.processingMs / 1000).toFixed(2)}s`,
              'var(--text)',
            ],
          ].map(([label, value, color]) => (
            <div
              key={label}
              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2"
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">{label}</p>
              <p className="mt-0.5 text-lg font-semibold" style={{ color }}>
                {typeof value === 'number' ? formatNumber(value) : value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export default function Compare() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialIds = (searchParams.get('ids') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const [slots, setSlots] = useState([initialIds[0] || '', initialIds[1] || '']);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let alive = true;
    setHistoryLoading(true);
    API.get('/scans/history', { params: { limit: 100, page: 1, sort: 'newest' } })
      .then((response) => {
        if (alive) setHistory(response.data.items || []);
      })
      .catch((err) => {
        if (alive) setHistoryError(apiErrorMessage(err, 'Unable to load your predictions.'));
      })
      .finally(() => {
        if (alive) setHistoryLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const bothSelected = slots[0] && slots[1] && slots[0] !== slots[1];

  useEffect(() => {
    if (!bothSelected) {
      setComparison(null);
      setError('');
      return undefined;
    }
    let alive = true;
    setLoading(true);
    setError('');
    API.get('/scans/compare', { params: { ids: slots.join(',') } })
      .then((response) => {
        if (alive) setComparison(response.data);
      })
      .catch((err) => {
        if (alive) {
          setComparison(null);
          setError(apiErrorMessage(err, 'Could not compare those predictions.'));
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [bothSelected, slots]);

  const options = useMemo(() => {
    const map = new Map();
    history.forEach((scan) => map.set(scan.id, scan));
    (comparison?.scans || []).forEach((scan) => {
      if (!map.has(scan.id)) map.set(scan.id, scan);
    });
    return [...map.values()];
  }, [history, comparison]);

  function updateSlot(index, value) {
    if (value && slots[index === 0 ? 1 : 0] === value) {
      toast.info('Choose two different predictions to compare.');
      return;
    }
    const next = [...slots];
    next[index] = value;
    setSlots(next);
    const ids = next.filter(Boolean);
    if (ids.length === 2) {
      setSearchParams({ ids: ids.join(',') }, { replace: true });
    } else if (ids.length === 1) {
      setSearchParams({ ids: ids[0] }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }

  function swap() {
    const next = [slots[1], slots[0]];
    setSlots(next);
    if (next[0] && next[1]) setSearchParams({ ids: next.join(',') }, { replace: true });
  }

  async function downloadPdf() {
    if (!bothSelected) return;
    setDownloading(true);
    try {
      await downloadApiFile(
        `/scans/compare/report.pdf?ids=${slots.join(',')}`,
        `arecanut-comparison-${Date.now()}.pdf`
      );
      toast.success('Comparison PDF downloaded.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not generate the comparison PDF.'));
    } finally {
      setDownloading(false);
    }
  }

  const scans = comparison?.scans || [];
  const [first, second] = scans;
  const deltas =
    first && second
      ? [
          ['Grade A', first.gradeA, second.gradeA, 'higher better'],
          ['Grade B', first.gradeB, second.gradeB, 'composition dependent'],
          ['Grade C', first.gradeC || 0, second.gradeC || 0, 'composition dependent'],
          ['Grade D', first.gradeD || 0, second.gradeD || 0, 'composition dependent'],
          ['Total detected', first.totalCount, second.totalCount, 'context only'],
          ['Quality score', first.qualityScore, second.qualityScore, 'heuristic'],
          ['Confidence', first.confidence, second.confidence, 'mean winning class'],
        ]
      : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-2xl font-semibold text-main">Compare predictions</h2>
          <p className="mt-1 text-sm text-muted">
            Place two stored reports side by side. Comparison never implies the same physical nuts
            were tracked across images.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigate('/history')}>
            <HistoryIcon width={16} height={16} /> History
          </Button>
          <Button
            variant="secondary"
            onClick={downloadPdf}
            disabled={!comparison || downloading}
          >
            {downloading ? <Spinner size={15} /> : <DownloadIcon width={16} height={16} />}
            {downloading ? 'Preparing…' : 'Comparison PDF'}
          </Button>
        </div>
      </div>

      <Card className="p-4 sm:p-5 animate-in">
        <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <SelectField
            id="compare-first"
            label="First prediction"
            value={slots[0]}
            onChange={(event) => updateSlot(0, event.target.value)}
            disabled={historyLoading}
          >
            <option value="">Choose a prediction…</option>
            {options.map((scan) => (
              <option key={scan.id} value={scan.id}>
                {scan.reportId || scan.id.slice(-6)} — {scan.finalGrade} — {scan.filename}
              </option>
            ))}
          </SelectField>
          <Button
            variant="secondary"
            onClick={swap}
            disabled={!slots[0] && !slots[1]}
            className="mb-0.5"
            aria-label="Swap predictions"
            title="Swap predictions"
          >
            <CompareIcon width={16} height={16} /> Swap
          </Button>
          <SelectField
            id="compare-second"
            label="Second prediction"
            value={slots[1]}
            onChange={(event) => updateSlot(1, event.target.value)}
            disabled={historyLoading}
          >
            <option value="">Choose a prediction…</option>
            {options.map((scan) => (
              <option key={scan.id} value={scan.id}>
                {scan.reportId || scan.id.slice(-6)} — {scan.finalGrade} — {scan.filename}
              </option>
            ))}
          </SelectField>
        </div>
        {historyLoading && (
          <p className="mt-3 flex items-center gap-2 text-xs text-muted">
            <Spinner size={13} /> Loading your predictions…
          </p>
        )}
        {historyError && <p className="mt-3 text-xs text-danger">{historyError}</p>}
        {!historyLoading && !historyError && history.length < 2 && (
          <p className="mt-3 text-xs text-muted">
            You need at least two saved predictions to compare. Create another prediction first.
          </p>
        )}
      </Card>

      {!bothSelected && (
        <Card>
          <EmptyState
            icon={history.length < 2 ? '📄' : '⇄'}
            title={history.length < 2 ? 'Not enough predictions yet' : 'Choose two predictions'}
            description={
              history.length < 2
                ? 'Comparison needs two stored reports. Analyse another tray image, then return here.'
                : 'Pick a prediction in each field above. You can also preselect pairs from your history page.'
            }
            action={
              history.length < 2 ? (
                <Button onClick={() => navigate('/upload')}>
                  <UploadIcon width={16} height={16} /> New prediction
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => navigate('/history')}>
                  Open history
                </Button>
              )
            }
          />
        </Card>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
          <Spinner /> Comparing stored reports…
        </div>
      )}

      {error && !loading && (
        <div className="alert alert-danger">
          <AlertIcon width={18} height={18} />
          <div className="flex-1">
            <p className="font-semibold">Comparison failed</p>
            <p className="mt-0.5">{error}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate('/history')}>
            Choose another pair
          </Button>
        </div>
      )}

      {comparison && !loading && !error && first && second && (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <ScanPanel scan={first} slot="1" />
            <ScanPanel scan={second} slot="2" />
          </div>

          <Card className="overflow-hidden animate-in">
            <div className="border-b border-[color:var(--border)] px-5 py-4">
              <h3 className="font-display text-lg font-semibold text-main">Metric differences</h3>
              <p className="text-xs text-muted">
                Image 2 minus image 1. Differences are descriptive, not a quality verdict.
              </p>
            </div>
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Image 1</th>
                    <th>Image 2</th>
                    <th>Difference</th>
                    <th>Interpretation</th>
                  </tr>
                </thead>
                <tbody>
                  {deltas.map(([label, leftValue, rightValue, note]) => {
                    const numeric =
                      typeof leftValue === 'number' && typeof rightValue === 'number';
                    const delta = numeric ? rightValue - leftValue : null;
                    return (
                      <tr key={label}>
                        <td className="text-sm font-semibold text-main">{label}</td>
                        <td className="text-sm text-main">
                          {typeof leftValue === 'number' ? formatNumber(leftValue) : leftValue ?? '—'}
                        </td>
                        <td className="text-sm text-main">
                          {typeof rightValue === 'number' ? formatNumber(rightValue) : rightValue ?? '—'}
                        </td>
                        <td className="text-sm font-semibold text-main">
                          {numeric ? compareArrow(delta) : '—'}
                        </td>
                        <td className="text-xs text-muted">{note}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="alert alert-warn items-start text-xs leading-relaxed">
            <AlertIcon width={17} height={17} />
            <span>
              {comparison.caveat ||
                'Comparison does not imply that the same physical nut was tracked across images.'}{' '}
              Different lighting, tray layout, and camera distance can change detection counts.
            </span>
          </div>
        </>
      )}

      {!comparison && bothSelected && !loading && !error && (
        <div className="alert alert-warn">
          <AlertIcon width={18} height={18} />
          <span>No comparison data was returned for those predictions.</span>
        </div>
      )}
    </div>
  );
}
