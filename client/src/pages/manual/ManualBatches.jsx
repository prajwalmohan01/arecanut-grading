import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import API, { apiErrorMessage } from '../../api/axios';
import { useToast } from '../../context/ToastContext';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import StatCard from '../../components/ui/StatCard';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import Pagination from '../../components/ui/Pagination';
import Modal from '../../components/ui/Modal';
import { TextField, SelectField } from '../../components/ui/Field';
import { BatchStatusBadge } from '../../components/manual/ManualBadges';
import {
  AlertIcon,
  ArrowRightIcon,
  CalendarIcon,
  CheckIcon,
  FolderIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
  TagIcon,
  UploadIcon,
  UsersIcon,
} from '../../components/Icons';
import { todayInputValue } from '../../utils/manual';
import {
  formatDate,
  formatNumber,
  formatWeightKg,
} from '../../utils/format';

const PAGE_SIZE = 12;

function emptyFilters() {
  return { q: '', status: '', from: '', to: '', sort: 'newest' };
}

function newBatchForm() {
  return {
    name: '',
    supplier: '',
    collectionDate: todayInputValue(),
    targetSamples: '',
    targetWeightKg: '',
    notes: '',
  };
}

function progressFor(batch) {
  const stats = batch.stats || {};
  if (stats.progressPct !== null && stats.progressPct !== undefined) {
    return stats.progressPct;
  }
  if (stats.totalRecords) {
    return Math.round(((stats.completed || 0) / stats.totalRecords) * 100);
  }
  return 0;
}

export default function ManualBatches() {
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [batchForm, setBatchForm] = useState(newBatchForm);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (searchParams.get('new') === '1') setCreateOpen(true);
  }, [searchParams]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    API.get('/manual/batches', {
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
        if (alive) setError(apiErrorMessage(err, 'Could not load manual batches.'));
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
  const hasFilters = Object.entries(applied).some(
    ([key, value]) => value !== '' && !(key === 'sort' && value === 'newest')
  );

  function closeCreate() {
    if (creating) return;
    setCreateOpen(false);
    if (searchParams.get('new')) setSearchParams({}, { replace: true });
  }

  function openCreate() {
    setBatchForm(newBatchForm());
    setCreateOpen(true);
  }

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

  async function createBatch(event) {
    event.preventDefault();
    if (!batchForm.name.trim()) {
      toast.error('Enter a batch name.');
      return;
    }
    setCreating(true);
    try {
      const response = await API.post('/manual/batches', {
        ...batchForm,
        targetSamples: batchForm.targetSamples || null,
        targetWeightKg: batchForm.targetWeightKg || null,
      });
      const batch = response.data.batch;
      toast.success(`Batch ${batch.batchId} created.`);
      setCreateOpen(false);
      if (searchParams.get('new')) setSearchParams({}, { replace: true });
      navigate(`/manual/batches/${batch.id}`);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not create the batch.'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="space-y-5">
        <Card className="p-5 animate-in">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div>
              <p className="section-label">Manual grading · batches</p>
              <h2 className="mt-1 font-display text-2xl font-semibold text-main">
                Batch workspace
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
                Organise samples from one collection, track genuine saved-record progress, and
                open a batch to review or add samples.
              </p>
            </div>
            <Button onClick={openCreate}>
              <PlusIcon width={15} height={15} /> New batch
            </Button>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Matching batches"
            value={formatNumber(summary.totalBatches || 0)}
            hint={`${formatNumber(summary.open || 0)} open · ${formatNumber(summary.completedBatches || 0)} completed`}
            icon={<LayersIcon width={17} height={17} />}
          />
          <StatCard
            label="Saved records"
            value={formatNumber(summary.totalRecords || 0)}
            hint={`${formatNumber(summary.completed || 0)} completed · ${formatNumber(summary.drafts || 0)} draft`}
            tone="a"
            icon={<FolderIcon width={17} height={17} />}
          />
          <StatCard
            label="Grade mix"
            value={`A ${formatNumber(summary.gradeA || 0)} · B ${formatNumber(summary.gradeB || 0)}`}
            hint="Manual grades in matching batches"
            tone="b"
            icon={<TagIcon width={17} height={17} />}
          />
          <StatCard
            label="Weight recorded"
            value={formatWeightKg(summary.totalWeightKg || 0)}
            hint={`${formatNumber(summary.totalQuantity || 0)} samples counted`}
            icon={<CheckIcon width={17} height={17} />}
          />
        </div>

        <Card className="p-4">
          <form onSubmit={applyFilters}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div>
                <label className="field-label" htmlFor="batch-search">Search</label>
                <div className="relative">
                  <SearchIcon
                    width={16}
                    height={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                  />
                  <input
                    id="batch-search"
                    className="input pl-9"
                    value={filters.q}
                    onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
                    placeholder="Batch, supplier, notes…"
                  />
                </div>
              </div>
              <SelectField
                id="batch-status"
                label="Status"
                value={filters.status}
                onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
              >
                <option value="">All statuses</option>
                <option value="open">Open</option>
                <option value="completed">Completed</option>
              </SelectField>
              <TextField
                id="batch-from"
                label="Collection from"
                type="date"
                value={filters.from}
                onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
              />
              <TextField
                id="batch-to"
                label="Collection to"
                type="date"
                value={filters.to}
                onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
              />
              <SelectField
                id="batch-sort"
                label="Sort"
                value={filters.sort}
                onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))}
              >
                <option value="newest">Newest created</option>
                <option value="oldest">Oldest created</option>
                <option value="name">Batch name</option>
              </SelectField>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                Reset
              </Button>
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? <Spinner size={13} /> : <SearchIcon width={14} height={14} />}
                Apply filters
              </Button>
            </div>
          </form>
        </Card>

        {error && (
          <div className="alert alert-danger">
            <AlertIcon width={18} height={18} />
            <div className="flex-1">
              <p className="font-semibold">Batches unavailable</p>
              <p className="mt-0.5">{error}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
              Retry
            </Button>
          </div>
        )}

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((key) => (
              <div key={key} className="card p-5">
                <div className="skeleton h-3 w-28" />
                <div className="skeleton mt-3 h-6 w-48 max-w-full" />
                <div className="skeleton mt-4 h-3 w-full" />
                <div className="skeleton mt-3 h-16 w-full" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              icon="▤"
              title={hasFilters ? 'No batches match these filters' : 'No manual batches yet'}
              description={
                hasFilters
                  ? 'Try clearing a filter or widening the collection date range.'
                  : 'Create a batch to group samples from one collection and track progress against an optional target.'
              }
              action={
                hasFilters ? (
                  <Button variant="secondary" onClick={resetFilters}>Clear filters</Button>
                ) : (
                  <Button onClick={openCreate}>
                    <PlusIcon width={15} height={15} /> Create first batch
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((batch) => {
                const progress = progressFor(batch);
                const stats = batch.stats || {};
                return (
                  <Card key={batch.id} className="flex flex-col p-5 transition hover:shadow-[var(--shadow)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
                          {batch.batchId}
                        </p>
                        <h3 className="mt-1 truncate font-display text-xl font-semibold text-main">
                          {batch.name}
                        </h3>
                      </div>
                      <BatchStatusBadge status={batch.status} />
                    </div>

                    <div className="mt-3 space-y-1.5 text-xs text-muted">
                      <p className="flex items-center gap-1.5">
                        <UsersIcon width={13} height={13} />
                        {batch.supplier || 'No supplier entered'}
                      </p>
                      <p className="flex items-center gap-1.5">
                        <CalendarIcon width={13} height={13} />
                        {batch.collectionDate ? formatDate(batch.collectionDate) : 'No collection date'}
                      </p>
                    </div>

                    <div className="mt-4">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-muted">
                          {batch.targetSamples
                            ? `${formatNumber(stats.completed || 0)} of ${formatNumber(batch.targetSamples)} completed`
                            : `${formatNumber(stats.totalRecords || 0)} saved records`}
                        </span>
                        <span className="font-semibold text-main">{progress}%</span>
                      </div>
                      <div className="progress-track mt-1.5">
                        <div className="progress-bar" style={{ width: `${progress}%` }} />
                      </div>
                      {stats.pendingSamples !== null && stats.pendingSamples !== undefined && (
                        <p className="mt-1.5 text-[10px] text-muted">
                          {formatNumber(stats.pendingSamples)} sample(s) remain to the optional target.
                        </p>
                      )}
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-[color:var(--panel-soft)] p-2.5 text-center">
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted">Grade A</p>
                        <p className="mt-0.5 font-display text-lg font-semibold text-accent">
                          {formatNumber(stats.gradeA || 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted">Grade B</p>
                        <p className="mt-0.5 font-display text-lg font-semibold text-gold">
                          {formatNumber(stats.gradeB || 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted">Weight</p>
                        <p className="mt-0.5 text-xs font-semibold text-main">
                          {formatWeightKg(stats.totalWeightKg || 0)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-1 items-end gap-2 pt-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        onClick={() => navigate(`/manual/batches/${batch.id}`)}
                      >
                        Open batch <ArrowRightIcon width={13} height={13} />
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => navigate(`/manual/new?batch=${batch.id}`)}
                      >
                        <UploadIcon width={13} height={13} /> Add sample
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>

            <Card className="overflow-hidden">
              <Pagination
                page={data?.pagination?.page || 1}
                pages={data?.pagination?.pages || 1}
                total={data?.pagination?.total || 0}
                onPage={(nextPage) => {
                  setPage(nextPage);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                label="batches"
              />
            </Card>
          </>
        )}
      </div>

      <Modal
        open={createOpen}
        onClose={closeCreate}
        title="Create a manual batch"
        description="Targets are optional. Progress is calculated only from records you actually save."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={closeCreate} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={createBatch} disabled={creating}>
              {creating ? <Spinner size={14} /> : <LayersIcon width={15} height={15} />}
              {creating ? 'Creating…' : 'Create batch'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="batch-name"
            label="Batch name"
            value={batchForm.name}
            onChange={(event) => setBatchForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="e.g. October farm collection"
            maxLength={80}
            className="sm:col-span-2"
            required
          />
          <TextField
            id="batch-supplier"
            label="Supplier / collection (optional)"
            value={batchForm.supplier}
            onChange={(event) => setBatchForm((current) => ({ ...current, supplier: event.target.value }))}
            maxLength={120}
            placeholder="e.g. North plot"
          />
          <TextField
            id="batch-date"
            label="Collection date"
            type="date"
            value={batchForm.collectionDate}
            onChange={(event) => setBatchForm((current) => ({ ...current, collectionDate: event.target.value }))}
          />
          <TextField
            id="batch-target-samples"
            label="Target samples (optional)"
            type="number"
            min="1"
            step="1"
            value={batchForm.targetSamples}
            onChange={(event) => setBatchForm((current) => ({ ...current, targetSamples: event.target.value }))}
            placeholder="e.g. 100"
          />
          <TextField
            id="batch-target-weight"
            label="Target weight kg (optional)"
            type="number"
            min="0.000001"
            step="0.001"
            value={batchForm.targetWeightKg}
            onChange={(event) => setBatchForm((current) => ({ ...current, targetWeightKg: event.target.value }))}
            placeholder="e.g. 25"
          />
          <div className="sm:col-span-2">
            <label className="field-label" htmlFor="batch-notes">Notes (optional)</label>
            <textarea
              id="batch-notes"
              className="input min-h-20 resize-y"
              value={batchForm.notes}
              onChange={(event) => setBatchForm((current) => ({ ...current, notes: event.target.value }))}
              maxLength={1000}
              placeholder="Collection context, storage details, or anything useful."
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
