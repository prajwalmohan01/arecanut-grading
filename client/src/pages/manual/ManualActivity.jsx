import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import API, { apiErrorMessage } from '../../api/axios';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import Pagination from '../../components/ui/Pagination';
import { TextField, SelectField } from '../../components/ui/Field';
import {
  AlertIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CalculatorIcon,
  CheckIcon,
  ClipboardIcon,
  ClockIcon,
  DownloadIcon,
  EditIcon,
  FilterIcon,
  FolderIcon,
  HistoryIcon,
  LayersIcon,
  ShieldCheckIcon,
  TagIcon,
  TrashIcon,
} from '../../components/Icons';
import { activityLabel, activityTone } from '../../utils/manual';
import { formatDateTime, formatNumber } from '../../utils/format';

const PAGE_SIZE = 30;

function emptyFilters() {
  return { type: '', from: '', to: '' };
}

function activityIcon(type) {
  if (type.includes('batch')) return <LayersIcon width={16} height={16} />;
  if (type.includes('assessment')) return <ShieldCheckIcon width={16} height={16} />;
  if (type.includes('price')) return <CalculatorIcon width={16} height={16} />;
  if (type.includes('export') || type.includes('report')) return <DownloadIcon width={16} height={16} />;
  if (type.includes('delete')) return <TrashIcon width={16} height={16} />;
  if (type.includes('review')) return <CheckIcon width={16} height={16} />;
  if (type.includes('flag')) return <AlertIcon width={16} height={16} />;
  if (type.includes('updated') || type.includes('corrected')) return <EditIcon width={16} height={16} />;
  return <ClipboardIcon width={16} height={16} />;
}

function activityLink(activity) {
  if (!activity.entityId) return null;
  if (activity.entityType === 'grading_record' || activity.entityType === 'assessment') {
    if (activity.type === 'record_deleted' || activity.type === 'assessment_generated') return null;
    return `/manual/records/${activity.entityId}`;
  }
  if (activity.entityType === 'batch' && activity.type !== 'batch_deleted') {
    return `/manual/batches/${activity.entityId}`;
  }
  return null;
}

export default function ManualActivity() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    API.get('/manual/activity', {
      params: {
        ...Object.fromEntries(Object.entries(applied).filter(([, value]) => value !== '')),
        page,
        limit: PAGE_SIZE,
      },
    })
      .then((response) => {
        if (alive) setData(response.data);
      })
      .catch((err) => {
        if (alive) setError(apiErrorMessage(err, 'Could not load the activity log.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [applied, page, reloadKey]);

  const items = data?.items || [];
  const summary = data?.summary || {};
  const availableTypes = data?.availableTypes || [];
  const typeSummary = Object.entries(summary.types || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const hasFilters = Boolean(applied.type || applied.from || applied.to);

  function applyFilters(event) {
    event.preventDefault();
    setPage(1);
    setApplied(filters);
  }

  function resetFilters() {
    setFilters(emptyFilters());
    setApplied(emptyFilters());
    setPage(1);
  }

  return (
    <div className="space-y-5">
      <Card className="p-5 animate-in">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <p className="section-label">Manual grading · audit trail</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-main">Activity log</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
              A read-only, account-scoped record of saved manual grading, batch, review, export,
              assessment, and user-entered price actions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate('/manual/records')}>
              <FolderIcon width={15} height={15} /> Records
            </Button>
            <Button variant="secondary" onClick={() => navigate('/manual')}>
              <ArrowLeftIcon width={15} height={15} /> Overview
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Matching events</p>
          <p className="mt-1 font-display text-2xl font-semibold text-main">
            {formatNumber(summary.total || 0)}
          </p>
          <p className="mt-1 text-[11px] text-muted">Read-only audit entries.</p>
        </Card>
        {typeSummary.slice(0, 3).map(([type, count]) => (
          <Card key={type} className="p-4">
            <p className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
              {activityLabel(type)}
            </p>
            <p className="mt-1 font-display text-2xl font-semibold text-main">{formatNumber(count)}</p>
            <p className="mt-1 text-[11px] text-muted">Matching entries of this type.</p>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <form onSubmit={applyFilters}>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
            <SelectField
              id="activity-type"
              label="Activity type"
              value={filters.type}
              onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}
            >
              <option value="">All activity types</option>
              {availableTypes.map((type) => (
                <option key={type} value={type}>{activityLabel(type)}</option>
              ))}
            </SelectField>
            <TextField
              id="activity-from"
              label="From"
              type="date"
              value={filters.from}
              onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
            />
            <TextField
              id="activity-to"
              label="To"
              type="date"
              value={filters.to}
              onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
            />
            <div className="flex items-end gap-2 xl:justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                Reset
              </Button>
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? <Spinner size={13} /> : <FilterIcon width={14} height={14} />}
                Apply
              </Button>
            </div>
          </div>
        </form>
      </Card>

      {error && (
        <div className="alert alert-danger">
          <AlertIcon width={18} height={18} />
          <p className="flex-1">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            Retry
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-4 p-5">
            {[0, 1, 2, 3, 4].map((key) => (
              <div key={key} className="flex items-start gap-3">
                <div className="skeleton h-9 w-9 rounded-xl" />
                <div className="flex-1">
                  <div className="skeleton h-3 w-80 max-w-full" />
                  <div className="skeleton mt-2 h-3 w-44" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="◷"
            title={hasFilters ? 'No activity matches these filters' : 'No activity yet'}
            description={
              hasFilters
                ? 'Clear the activity type or date filters to see more entries.'
                : 'Actions such as saving a record, reviewing it, generating an assessment, or exporting data will appear here.'
            }
            action={hasFilters ? <Button variant="secondary" onClick={resetFilters}>Clear filters</Button> : null}
          />
        ) : (
          <>
            <div className="border-b border-[color:var(--border)] px-4 py-3">
              <p className="flex items-center gap-2 text-xs text-muted">
                <ClockIcon width={14} height={14} />
                Entries are append-only through the application and cannot be edited or deleted.
              </p>
            </div>
            <div className="divide-y divide-[color:var(--border)]">
              {items.map((activity) => {
                const link = activityLink(activity);
                return (
                  <div key={activity.id} className="flex items-start gap-3 px-4 py-4">
                    <span
                      className={`badge badge-${activityTone(activity.type)} mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl p-0`}
                    >
                      {activityIcon(activity.type)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-sm leading-snug text-main">{activity.message}</p>
                        <span className="shrink-0 text-[10px] text-muted">
                          {formatDateTime(activity.createdAt)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge tone={activityTone(activity.type)}>{activityLabel(activity.type)}</Badge>
                        {activity.entityLabel && (
                          <span className="text-[10px] text-muted">{activity.entityLabel}</span>
                        )}
                        {activity.batchCode && (
                          <span className="flex items-center gap-1 text-[10px] text-muted">
                            <TagIcon width={10} height={10} /> {activity.batchCode}
                          </span>
                        )}
                        {link && (
                          <Link to={link} className="link inline-flex items-center gap-1 text-[10px]">
                            Open related item <ArrowRightIcon width={10} height={10} />
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <Pagination
              page={data?.pagination?.page || 1}
              pages={data?.pagination?.pages || 1}
              total={data?.pagination?.total || 0}
              onPage={(nextPage) => {
                setPage(nextPage);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              label="activity entries"
            />
          </>
        )}
      </Card>

      <div className="alert">
        <HistoryIcon width={18} height={18} className="text-accent" />
        <p className="flex-1 text-xs leading-relaxed text-muted">
          Activity entries describe actions taken in this application. They do not validate the
          commercial accuracy of a manual grade, user-entered price, or estimate.
        </p>
      </div>
    </div>
  );
}
