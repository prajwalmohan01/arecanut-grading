import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import API, { apiErrorMessage, downloadApiFile } from '../../api/axios';
import { useToast } from '../../context/ToastContext';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import StatCard from '../../components/ui/StatCard';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import Pagination from '../../components/ui/Pagination';
import ConfirmDialog from '../../components/ConfirmDialog';
import { TextField, SelectField } from '../../components/ui/Field';
import {
  ManualGradeBadge,
  QualityBadge,
  RecordStatusBadge,
  ReviewBadge,
} from '../../components/manual/ManualBadges';
import {
  AlertIcon,
  ArrowRightIcon,
  ClipboardIcon,
  CompareIcon,
  DownloadIcon,
  FilterIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from '../../components/Icons';
import {
  formatDateTime,
  formatNumber,
  formatWeightKg,
} from '../../utils/format';

const PAGE_SIZE = 20;

function emptyFilters() {
  return {
    q: '',
    grade: '',
    status: '',
    review: '',
    batch: '',
    from: '',
    to: '',
    sort: 'newest',
  };
}

function compactFilters(filters) {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== '' && value !== null && value !== undefined)
  );
}

export default function ManualRecords() {
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialFilters = useMemo(
    () => ({
      ...emptyFilters(),
      batch: searchParams.get('batch') || '',
      review: searchParams.get('review') || '',
      grade: searchParams.get('grade') || '',
      status: searchParams.get('status') || '',
    }),
    // Read the URL when this page first opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [filters, setFilters] = useState(initialFilters);
  const [applied, setApplied] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    API.get('/manual/batches', { params: { limit: 100, sort: 'newest' } })
      .then((response) => {
        if (alive) setBatches(response.data.items || []);
      })
      .catch(() => {
        if (alive) setBatches([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    API.get('/manual/records', {
      params: { ...compactFilters(applied), page, limit: PAGE_SIZE },
    })
      .then((response) => {
        if (!alive) return;
        setData(response.data);
        setSelectedIds((current) =>
          current.filter((id) => (response.data.items || []).some((item) => item.id === id))
        );
      })
      .catch((err) => {
        if (alive) setError(apiErrorMessage(err, 'Could not load manual grading records.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [applied, page, reloadKey]);

  const summary = data?.summary || {};
  const items = data?.items || [];
  const missingBatch = filters.batch && !batches.some((batch) => batch.id === filters.batch);

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function applyFilters(event) {
    event?.preventDefault();
    setPage(1);
    setApplied(filters);
  }

  function resetFilters() {
    const empty = emptyFilters();
    setFilters(empty);
    setApplied(empty);
    setPage(1);
  }

  function toggleSelected(id) {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= 2) return [current[1], id];
      return [...current, id];
    });
  }

  function openCompare() {
    if (selectedIds.length !== 2) return;
    navigate(`/manual/compare?ids=${selectedIds.join(',')}`);
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const params = new URLSearchParams(compactFilters(applied));
      await downloadApiFile(
        `/manual/records/export.csv${params.toString() ? `?${params.toString()}` : ''}`,
        `manual-grading-records-${new Date().toISOString().slice(0, 10)}.csv`
      );
      toast.success('Manual grading CSV downloaded.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not export records.'));
    } finally {
      setExporting(false);
    }
  }

  async function downloadRecordPdf(record) {
    try {
      await downloadApiFile(
        `/manual/records/${record.id}/report.pdf`,
        `manual-grading-record-${record.reportId}.pdf`
      );
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not download this record report.'));
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await API.delete(`/manual/records/${deleteTarget.id}`);
      toast.success(`Deleted ${deleteTarget.reportId}.`);
      setDeleteTarget(null);
      setSelectedIds((current) => current.filter((id) => id !== deleteTarget.id));
      if (items.length === 1 && page > 1) setPage((current) => current - 1);
      else setReloadKey((key) => key + 1);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not delete this record.'));
    } finally {
      setDeleting(false);
    }
  }

  const hasFilters = Object.values(applied).some(
    (value) => value !== '' && value !== 'newest'
  );

  return (
    <div className={`space-y-5 ${selectedIds.length === 2 ? 'pb-28' : ''}`}>
      <Card className="p-5 animate-in">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <p className="section-label">Manual grading · history</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-main">
              Grading records
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              Search and filter your user-assigned grades, resume drafts, review saved records,
              compare two samples, and export only the values that were entered.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={exportCsv} disabled={exporting || loading}>
              {exporting ? <Spinner size={14} /> : <DownloadIcon width={15} height={15} />}
              {exporting ? 'Exporting…' : 'Export CSV'}
            </Button>
            <Button onClick={() => navigate('/manual/new')}>
              <PlusIcon width={15} height={15} /> New record
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Matching records"
          value={formatNumber(summary.totalRecords || 0)}
          hint={`${formatNumber(summary.completed || 0)} completed · ${formatNumber(summary.drafts || 0)} draft`}
          icon={<ClipboardIcon width={17} height={17} />}
        />
        <StatCard
          label="Manual Grade A"
          value={formatNumber(summary.gradeA || 0)}
          hint="Selected by the grader"
          tone="a"
        />
        <StatCard
          label="Manual Grade B"
          value={formatNumber(summary.gradeB || 0)}
          hint="Selected by the grader"
          tone="b"
        />
        <StatCard
          label="Weight recorded"
          value={formatWeightKg(summary.totalWeightKg || 0)}
          hint={`${formatNumber(summary.pendingReview || 0)} awaiting review`}
        />
      </div>

      <Card className="p-4">
        <form onSubmit={applyFilters}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-main">
              <FilterIcon width={16} height={16} /> Filters
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {selectedIds.length > 0 && (
                <span className="text-[11px] text-muted">{selectedIds.length}/2 selected</span>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={openCompare}
                disabled={selectedIds.length !== 2}
              >
                <CompareIcon width={14} height={14} /> Compare selected
              </Button>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="field-label" htmlFor="record-search">Search</label>
              <div className="relative">
                <SearchIcon
                  width={16}
                  height={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  id="record-search"
                  className="input pl-9"
                  value={filters.q}
                  onChange={(event) => updateFilter('q', event.target.value)}
                  placeholder="Record, sample, batch, reviewer…"
                />
              </div>
            </div>
            <SelectField
              id="record-grade"
              label="Manual grade"
              value={filters.grade}
              onChange={(event) => updateFilter('grade', event.target.value)}
            >
              <option value="">All grades</option>
              <option value="A">Grade A</option>
              <option value="B">Grade B</option>
            </SelectField>
            <SelectField
              id="record-status"
              label="Record status"
              value={filters.status}
              onChange={(event) => updateFilter('status', event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="completed">Completed</option>
              <option value="draft">Draft</option>
            </SelectField>
            <SelectField
              id="record-review"
              label="Review"
              value={filters.review}
              onChange={(event) => updateFilter('review', event.target.value)}
            >
              <option value="">All review states</option>
              <option value="pending">Needs review</option>
              <option value="reviewed">Reviewed</option>
              <option value="flagged">Image flagged</option>
            </SelectField>
            <SelectField
              id="record-batch"
              label="Batch"
              value={filters.batch}
              onChange={(event) => updateFilter('batch', event.target.value)}
            >
              <option value="">All batches</option>
              {missingBatch && <option value={filters.batch}>Selected batch</option>}
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.name} · {batch.batchId}
                </option>
              ))}
            </SelectField>
            <TextField
              id="record-from"
              label="Graded from"
              type="date"
              value={filters.from}
              onChange={(event) => updateFilter('from', event.target.value)}
            />
            <TextField
              id="record-to"
              label="Graded to"
              type="date"
              value={filters.to}
              onChange={(event) => updateFilter('to', event.target.value)}
            />
            <SelectField
              id="record-sort"
              label="Sort"
              value={filters.sort}
              onChange={(event) => updateFilter('sort', event.target.value)}
            >
              <option value="newest">Newest saved</option>
              <option value="oldest">Oldest saved</option>
              <option value="graded_newest">Newest grading date</option>
              <option value="graded_oldest">Oldest grading date</option>
              <option value="grade">Grade A → B</option>
              <option value="weight">Highest weight</option>
              <option value="quantity">Highest quantity</option>
            </SelectField>
          </div>

          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
              Reset
            </Button>
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? <Spinner size={13} /> : <FilterIcon width={14} height={14} />}
              Apply filters
            </Button>
          </div>
        </form>
      </Card>

      {error && (
        <div className="alert alert-danger">
          <AlertIcon width={18} height={18} />
          <div className="flex-1">
            <p className="font-semibold">Records unavailable</p>
            <p className="mt-0.5">{error}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            Retry
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((key) => (
              <div key={key} className="flex items-center gap-4">
                <div className="skeleton h-10 w-10 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="skeleton h-3 w-52 max-w-full" />
                  <div className="skeleton mt-2 h-3 w-32" />
                </div>
                <div className="skeleton h-6 w-20" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="◫"
            title={hasFilters ? 'No records match these filters' : 'No manual records yet'}
            description={
              hasFilters
                ? 'Try removing a filter or widening the date range.'
                : 'Add your first manual grading record to start building a searchable sample history.'
            }
            action={
              hasFilters ? (
                <Button variant="secondary" onClick={resetFilters}>Clear filters</Button>
              ) : (
                <Button onClick={() => navigate('/manual/new')}>
                  <PlusIcon width={15} height={15} /> Add first record
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className="table-shell hidden xl:block">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10">Compare</th>
                    <th>Record</th>
                    <th>Batch</th>
                    <th>Grade</th>
                    <th>Quantity / weight</th>
                    <th>Review</th>
                    <th>Graded</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[color:var(--accent)]"
                          checked={selectedIds.includes(record.id)}
                          onChange={() => toggleSelected(record.id)}
                          aria-label={`Select ${record.reportId} for comparison`}
                        />
                      </td>
                      <td>
                        <div className="max-w-[16rem]">
                          <Link to={`/manual/records/${record.id}`} className="font-semibold text-main hover:text-accent">
                            {record.sampleCode || record.reportId}
                          </Link>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] text-muted">{record.reportId}</span>
                            <RecordStatusBadge status={record.status} />
                          </div>
                          {record.imageQuality?.checked && (
                            <div className="mt-1"><QualityBadge quality={record.imageQuality} /></div>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="max-w-[12rem]">
                          {record.batch?.id ? (
                            <Link to={`/manual/batches/${record.batch.id}`} className="text-sm text-main hover:text-accent">
                              {record.batch.name}
                            </Link>
                          ) : (
                            <span className="text-sm text-muted">{record.batch?.name || 'No batch'}</span>
                          )}
                          <p className="mt-0.5 text-[11px] text-muted">{record.batch?.batchId || '—'}</p>
                        </div>
                      </td>
                      <td><ManualGradeBadge grade={record.grade} /></td>
                      <td>
                        <p className="text-sm text-main">
                          {record.quantity === null ? 'No count' : `${formatNumber(record.quantity)} count`}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted">{formatWeightKg(record.weightKg)}</p>
                      </td>
                      <td><ReviewBadge review={record.review} /></td>
                      <td>
                        <p className="text-xs text-main">{formatDateTime(record.gradedAt)}</p>
                        <p className="mt-0.5 text-[11px] text-muted">{record.reviewerName || 'No reviewer'}</p>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/manual/records/${record.id}`)}>
                            Open <ArrowRightIcon width={13} height={13} />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => downloadRecordPdf(record)} aria-label="Download PDF">
                            <DownloadIcon width={14} height={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(record)}
                            aria-label="Delete record"
                            className="!text-danger"
                          >
                            <TrashIcon width={14} height={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-[color:var(--border)] xl:hidden">
              {items.map((record) => (
                <div key={record.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--accent)]"
                      checked={selectedIds.includes(record.id)}
                      onChange={() => toggleSelected(record.id)}
                      aria-label={`Select ${record.reportId} for comparison`}
                    />
                    <div className="min-w-0 flex-1">
                      <Link to={`/manual/records/${record.id}`} className="block truncate text-sm font-semibold text-main">
                        {record.sampleCode || record.reportId}
                      </Link>
                      <p className="mt-0.5 truncate text-[11px] text-muted">
                        {record.reportId} · {formatDateTime(record.gradedAt)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <ManualGradeBadge grade={record.grade} />
                        <RecordStatusBadge status={record.status} />
                        <ReviewBadge review={record.review} />
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {record.batch?.name || 'No batch'} ·{' '}
                        {record.quantity === null ? 'No count' : `${formatNumber(record.quantity)} count`} ·{' '}
                        {formatWeightKg(record.weightKg)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Button variant="secondary" size="sm" onClick={() => navigate(`/manual/records/${record.id}`)}>
                          Open
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => downloadRecordPdf(record)}>
                          <DownloadIcon width={13} height={13} /> PDF
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="!text-danger"
                          onClick={() => setDeleteTarget(record)}
                        >
                          <TrashIcon width={13} height={13} /> Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Pagination
              page={data?.pagination?.page || 1}
              pages={data?.pagination?.pages || 1}
              total={data?.pagination?.total || 0}
              onPage={(nextPage) => {
                setPage(nextPage);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              label="records"
            />
          </>
        )}
      </Card>

      {selectedIds.length === 2 && (
        <div className="fixed bottom-4 left-1/2 z-30 w-[min(92vw,34rem)] -translate-x-1/2">
          <div className="surface-strong flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3">
            <p className="text-sm text-main">Two records selected for comparison.</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>Clear</Button>
              <Button size="sm" onClick={openCompare}>
                <CompareIcon width={14} height={14} /> Compare
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this grading record?"
        description={
          deleteTarget
            ? `${deleteTarget.reportId} and its stored image will be permanently deleted. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete record"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => !deleting && setDeleteTarget(null)}
      />
    </div>
  );
}
