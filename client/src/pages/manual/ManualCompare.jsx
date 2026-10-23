import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import API, { apiErrorMessage, downloadApiFile } from '../../api/axios';
import { useToast } from '../../context/ToastContext';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import ProtectedImage from '../../components/ProtectedImage';
import {
  ManualGradeBadge,
  RecordStatusBadge,
  ReviewBadge,
} from '../../components/manual/ManualBadges';
import {
  AlertIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CompareIcon,
  DownloadIcon,
  ImageIcon,
} from '../../components/Icons';
import {
  formatDateTime,
  formatNumber,
  formatWeightKg,
} from '../../utils/format';

function rawValue(field, record) {
  switch (field) {
    case 'grade':
      return record.grade || '';
    case 'batch':
      return record.batch?.id || record.batch?.batchId || '';
    case 'quantity':
      return record.quantity ?? '';
    case 'weightKg':
      return record.weightKg ?? '';
    case 'sizeMm':
      return record.sizeMm ?? '';
    case 'gradedAt':
      return record.gradedAt || '';
    case 'review':
      return `${record.review?.reviewed ? 'reviewed' : 'pending'}|${record.review?.imageFlagged ? 'flagged' : ''}`;
    case 'imageQuality':
      return `${record.imageQuality?.checked ? 'checked' : 'unchecked'}|${(record.imageQuality?.warnings || []).join('|')}`;
    case 'imageSize':
      return `${record.image?.width || ''}x${record.image?.height || ''}`;
    case 'sampleCode':
      return record.sampleCode || '';
    case 'status':
      return record.status || '';
    case 'appearance':
      return record.appearance || '';
    case 'reviewerName':
      return record.reviewerName || '';
    case 'observations':
      return record.observations || '';
    case 'notes':
      return record.notes || '';
    case 'createdAt':
      return record.createdAt || '';
    default:
      return record[field] ?? '';
  }
}

const FIELDS = [
  { key: 'grade', label: 'Manual grade' },
  { key: 'status', label: 'Record status' },
  { key: 'sampleCode', label: 'Sample code' },
  { key: 'batch', label: 'Batch' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'weightKg', label: 'Weight' },
  { key: 'sizeMm', label: 'Average size' },
  { key: 'gradedAt', label: 'Grading date' },
  { key: 'reviewerName', label: 'Reviewer' },
  { key: 'review', label: 'Review state' },
  { key: 'imageSize', label: 'Image dimensions' },
  { key: 'imageQuality', label: 'Upload check' },
  { key: 'appearance', label: 'Visual condition' },
  { key: 'observations', label: 'Observations' },
  { key: 'notes', label: 'Additional notes' },
  { key: 'createdAt', label: 'Created' },
];

function displayValue(field, record) {
  switch (field) {
    case 'status':
      return record.status === 'draft' ? 'Draft' : 'Completed';
    case 'batch':
      return record.batch ? `${record.batch.name} (${record.batch.batchId})` : 'No batch';
    case 'quantity':
      return record.quantity === null ? 'Not entered' : formatNumber(record.quantity);
    case 'weightKg':
      return formatWeightKg(record.weightKg);
    case 'sizeMm':
      return record.sizeMm === null ? 'Not entered' : `${formatNumber(record.sizeMm)} mm`;
    case 'gradedAt':
    case 'createdAt':
      return formatDateTime(record[field]);
    case 'review':
      if (record.review?.imageFlagged) return 'Image flagged';
      return record.review?.reviewed ? 'Reviewed' : 'Review pending';
    case 'imageSize':
      return record.image?.width && record.image?.height
        ? `${formatNumber(record.image.width)} × ${formatNumber(record.image.height)} px`
        : 'Not recorded';
    case 'imageQuality':
      if (!record.imageQuality?.checked) return 'Not checked';
      return `${(record.imageQuality.warnings || []).length} warning(s)`;
    case 'sampleCode':
      return record.sampleCode || 'Not named';
    case 'reviewerName':
      return record.reviewerName || 'Not entered';
    case 'appearance':
      return record.appearance || 'Not entered';
    case 'observations':
      return record.observations || 'Not entered';
    case 'notes':
      return record.notes || 'Not entered';
    default:
      return record[field] ?? '—';
  }
}

function CompareValue({ field, record }) {
  if (field === 'grade') return <ManualGradeBadge grade={record.grade} />;
  if (field === 'status') return <RecordStatusBadge status={record.status} />;
  if (field === 'review') return <ReviewBadge review={record.review} />;
  return <span className="whitespace-pre-wrap break-words">{displayValue(field, record)}</span>;
}

export default function ManualCompare() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const ids = useMemo(() => {
    const raw = String(searchParams.get('ids') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return [...new Set(raw)];
  }, [searchParams]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [differencesOnly, setDifferencesOnly] = useState(true);
  const [downloading, setDownloading] = useState('');

  useEffect(() => {
    let alive = true;
    if (ids.length !== 2) {
      setLoading(false);
      setError('Choose exactly two records from the history page to compare.');
      return undefined;
    }
    setLoading(true);
    setError('');
    API.get('/manual/records/compare', { params: { ids: ids.join(',') } })
      .then((response) => {
        if (alive) setRecords(response.data.items || []);
      })
      .catch((err) => {
        if (alive) setError(apiErrorMessage(err, 'Could not compare these records.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [ids]);

  const differingFields = useMemo(() => {
    if (records.length !== 2) return [];
    return FIELDS.filter((field) => rawValue(field.key, records[0]) !== rawValue(field.key, records[1]));
  }, [records]);

  const visibleFields = differencesOnly ? differingFields : FIELDS;

  async function downloadRecord(record) {
    setDownloading(record.id);
    try {
      await downloadApiFile(
        `/manual/records/${record.id}/report.pdf`,
        `manual-grading-record-${record.reportId}.pdf`
      );
      toast.success(`Report downloaded for ${record.reportId}.`);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not download this record report.'));
    } finally {
      setDownloading('');
    }
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="card p-5">
          <div className="skeleton h-3 w-28" />
          <div className="skeleton mt-3 h-8 w-80 max-w-full" />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          {[0, 1].map((key) => (
            <div key={key} className="card p-5">
              <div className="skeleton h-72 w-full" />
              <div className="skeleton mt-4 h-5 w-40" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || records.length !== 2) {
    return (
      <Card className="p-6">
        <div className="flex flex-col items-center py-10 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--danger-soft)] text-danger">
            <CompareIcon width={24} height={24} />
          </span>
          <h2 className="mt-4 font-display text-xl font-semibold text-main">
            Comparison not available
          </h2>
          <p className="mt-2 max-w-md text-sm text-muted">
            {error || 'Select two manual grading records to compare.'}
          </p>
          <Button className="mt-5" onClick={() => navigate('/manual/records')}>
            Choose records
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-5 animate-in">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <Link to="/manual/records" className="link inline-flex items-center gap-1.5 text-xs">
              <ArrowLeftIcon width={14} height={14} /> Manual records
            </Link>
            <h2 className="mt-2 font-display text-2xl font-semibold text-main">
              Compare manual records
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              Side-by-side saved values for two samples. Differences are highlighted; equal values
              remain visible if you turn off the differences-only filter.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{differingFields.length} differing field(s)</Badge>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-[color:var(--border)] px-3 py-2 text-xs font-semibold text-main">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[color:var(--accent)]"
                checked={differencesOnly}
                onChange={(event) => setDifferencesOnly(event.target.checked)}
              />
              Differences only
            </label>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {records.map((record, index) => (
          <Card key={record.id} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <Badge tone={index === 0 ? 'a' : 'b'}>Record {index + 1}</Badge>
                <span className="text-sm font-semibold text-main">
                  {record.sampleCode || record.reportId}
                </span>
              </div>
              <ManualGradeBadge grade={record.grade} />
            </div>
            <div className="surface-soft flex min-h-[15rem] items-center justify-center">
              <ProtectedImage
                url={record.image?.url}
                alt={`Grading image for ${record.reportId}`}
                className="max-h-[24rem] w-full object-contain"
                label="Grading image"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <RecordStatusBadge status={record.status} />
                <ReviewBadge review={record.review} />
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => navigate(`/manual/records/${record.id}`)}>
                  Open <ArrowRightIcon width={13} height={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => downloadRecord(record)}
                  disabled={downloading === record.id}
                >
                  {downloading === record.id ? <Spinner size={13} /> : <DownloadIcon width={13} height={13} />} PDF
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-[color:var(--border)] px-4 py-3">
          <h3 className="font-display text-xl font-semibold text-main">Saved values</h3>
          <p className="mt-1 text-xs text-muted">
            Image thumbnails are shown for visual reference only — no automated comparison or grade
            is calculated.
          </p>
        </div>

        {visibleFields.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <ImageIcon width={26} height={26} className="text-muted opacity-50" />
            <p className="mt-2 text-sm font-semibold text-main">The visible values are identical</p>
            <p className="mt-1 text-xs text-muted">
              Turn off “Differences only” to see every saved value side by side.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[color:var(--border)]">
            <div className="grid grid-cols-[minmax(7rem,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 bg-[color:var(--panel-soft)] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
              <span>Field</span>
              <span className="truncate">{records[0].sampleCode || records[0].reportId}</span>
              <span className="truncate">{records[1].sampleCode || records[1].reportId}</span>
            </div>
            {visibleFields.map((field) => {
              const different = differingFields.some((item) => item.key === field.key);
              return (
                <div
                  key={field.key}
                  className={`grid grid-cols-[minmax(7rem,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 px-4 py-3 text-xs ${
                    different ? 'bg-[color:var(--warn-soft)]' : ''
                  }`}
                >
                  <span className="font-semibold text-muted">
                    {field.label}
                    {different && <span className="ml-1 text-[color:var(--warn)]">•</span>}
                  </span>
                  <span className="text-main">
                    <CompareValue field={field.key} record={records[0]} />
                  </span>
                  <span className="text-main">
                    <CompareValue field={field.key} record={records[1]} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="alert alert-warn">
        <AlertIcon width={18} height={18} />
        <p className="flex-1 text-xs leading-relaxed">
          Comparison shows only values saved with each record. Empty fields are not estimated, and
          the application does not decide which manual grade is better.
        </p>
      </div>
    </div>
  );
}
