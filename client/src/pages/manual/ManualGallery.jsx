import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import API, { apiErrorMessage } from '../../api/axios';
import { useAuthImage } from '../../components/ProtectedImage';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import Pagination from '../../components/ui/Pagination';
import { SelectField } from '../../components/ui/Field';
import {
  ManualGradeBadge,
  QualityBadge,
  RecordStatusBadge,
} from '../../components/manual/ManualBadges';
import {
  AlertIcon,
  ArrowRightIcon,
  CopyIcon,
  FilterIcon,
  FolderIcon,
  ImageIcon,
  SearchIcon,
} from '../../components/Icons';
import {
  formatDateTime,
  formatNumber,
  formatWeightKg,
} from '../../utils/format';

const PAGE_SIZE = 24;

function GalleryTile({ record }) {
  const { src, loading, error } = useAuthImage(record.image?.url);
  return (
    <Link
      to={`/manual/records/${record.id}`}
      className="group overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-strong)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[color:var(--panel-soft)]">
        {loading ? (
          <div className="skeleton absolute inset-0 rounded-none" />
        ) : error || !src ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-muted">
            <ImageIcon width={22} height={22} className="opacity-40" />
            <span className="text-[10px]">Image unavailable</span>
          </div>
        ) : (
          <img
            src={src}
            alt={`Stored grading image for ${record.reportId}`}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            loading="lazy"
          />
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          <ManualGradeBadge grade={record.grade} />
          <RecordStatusBadge status={record.status} />
        </div>
        <div className="absolute bottom-2 right-2">
          <QualityBadge quality={record.imageQuality} />
        </div>
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-main">
              {record.sampleCode || record.reportId}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted">
              {record.batch?.name || 'No batch'}
            </p>
          </div>
          <ArrowRightIcon width={14} height={14} className="mt-0.5 shrink-0 text-muted" />
        </div>
        <p className="mt-2 text-[10px] text-muted">
          {formatDateTime(record.gradedAt)} · {formatWeightKg(record.weightKg)}
        </p>
      </div>
    </Link>
  );
}

export default function ManualGallery() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ q: '', grade: '', batch: '', sort: 'newest' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [batches, setBatches] = useState([]);
  const [duplicates, setDuplicates] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    API.get('/manual/batches', { params: { limit: 100, sort: 'newest' } })
      .then((response) => {
        if (alive) setBatches(response.data.items || []);
      })
      .catch(() => {
        if (alive) setBatches([]);
      });
    API.get('/manual/records/duplicates')
      .then((response) => {
        if (alive) setDuplicates(response.data);
      })
      .catch(() => {
        if (alive) setDuplicates({ groups: [], note: '' });
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    API.get('/manual/records', {
      params: {
        ...Object.fromEntries(
          Object.entries(applied).filter(([, value]) => value !== '')
        ),
        page,
        limit: PAGE_SIZE,
      },
    })
      .then((response) => {
        if (alive) setData(response.data);
      })
      .catch((err) => {
        if (alive) setError(apiErrorMessage(err, 'Could not load the sample image library.'));
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
  const duplicateGroups = duplicates?.groups || [];
  const missingBatch = filters.batch && !batches.some((batch) => batch.id === filters.batch);
  const hasFilters = applied.q || applied.grade || applied.batch;

  function applyFilters(event) {
    event.preventDefault();
    setPage(1);
    setApplied({ ...filters });
  }

  function resetFilters() {
    const empty = { q: '', grade: '', batch: '', sort: 'newest' };
    setFilters(empty);
    setApplied(empty);
    setPage(1);
  }

  return (
    <div className="space-y-5">
      <Card className="p-5 animate-in">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <p className="section-label">Manual grading · image library</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-main">
              Sample gallery
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              Browse stored grading images with the manual grade and upload-check result. Images
              are protected and visible only to your account.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate('/manual/records')}>
              <FolderIcon width={15} height={15} /> Record history
            </Button>
            <Button onClick={() => navigate('/manual/new')}>
              <ImageIcon width={15} height={15} /> Add sample
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Matching records</p>
          <p className="mt-1 font-display text-2xl font-semibold text-main">
            {formatNumber(summary.totalRecords || 0)}
          </p>
          <p className="mt-1 text-[11px] text-muted">Images returned by the current filters.</p>
        </Card>
        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Visible uploads</p>
          <p className="mt-1 font-display text-2xl font-semibold text-main">
            {formatNumber(items.length)}
          </p>
          <p className="mt-1 text-[11px] text-muted">On this page, each loaded through an authenticated request.</p>
        </Card>
        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Exact duplicate groups</p>
          <p className="mt-1 font-display text-2xl font-semibold text-main">
            {formatNumber(duplicateGroups.length)}
          </p>
          <p className="mt-1 text-[11px] text-muted">Files matched byte-for-byte by SHA-256.</p>
        </Card>
      </div>

      <Card className="p-4">
        <form onSubmit={applyFilters} className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <label className="field-label" htmlFor="gallery-search">Search</label>
            <div className="relative">
              <SearchIcon
                width={16}
                height={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                id="gallery-search"
                className="input pl-9"
                value={filters.q}
                onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
                placeholder="Sample, batch, reviewer…"
              />
            </div>
          </div>
          <SelectField
            id="gallery-grade"
            label="Manual grade"
            value={filters.grade}
            onChange={(event) => setFilters((current) => ({ ...current, grade: event.target.value }))}
          >
            <option value="">All grades</option>
            <option value="A">Grade A</option>
            <option value="B">Grade B</option>
          </SelectField>
          <SelectField
            id="gallery-batch"
            label="Batch"
            value={filters.batch}
            onChange={(event) => setFilters((current) => ({ ...current, batch: event.target.value }))}
          >
            <option value="">All batches</option>
            {missingBatch && <option value={filters.batch}>Selected batch</option>}
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>{batch.name}</option>
            ))}
          </SelectField>
          <SelectField
            id="gallery-sort"
            label="Sort"
            value={filters.sort}
            onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))}
          >
            <option value="newest">Newest saved</option>
            <option value="oldest">Oldest saved</option>
            <option value="graded_newest">Newest graded</option>
            <option value="grade">Grade A → B</option>
          </SelectField>
          <div className="flex items-end gap-2 xl:justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
              Reset
            </Button>
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? <Spinner size={13} /> : <FilterIcon width={14} height={14} />}
              Apply
            </Button>
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
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((key) => (
              <div key={key}>
                <div className="skeleton aspect-[4/3] w-full" />
                <div className="skeleton mt-2 h-3 w-32" />
                <div className="skeleton mt-2 h-3 w-20" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="▧"
            title={hasFilters ? 'No images match these filters' : 'No sample images yet'}
            description={
              hasFilters
                ? 'Clear a filter or try a different search term.'
                : 'Add a manual grading record with a photo to build your protected sample library.'
            }
            action={
              hasFilters ? (
                <Button variant="secondary" onClick={resetFilters}>Clear filters</Button>
              ) : (
                <Button onClick={() => navigate('/manual/new')}>Add first sample</Button>
              )
            }
          />
        ) : (
          <>
            <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((record) => (
                <GalleryTile key={record.id} record={record} />
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
              label="images"
            />
          </>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 font-display text-xl font-semibold text-main">
              <CopyIcon width={18} height={18} /> Exact duplicate images
            </h3>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
              {duplicates?.note ||
                'Only files with identical SHA-256 content are grouped. Different photos of similar samples are not treated as duplicates.'}
            </p>
          </div>
          <Badge tone={duplicateGroups.length ? 'b' : 'a'}>
            {duplicateGroups.length ? `${duplicateGroups.length} group(s)` : 'No duplicates'}
          </Badge>
        </div>

        {duplicateGroups.length > 0 && (
          <div className="mt-4 space-y-3">
            {duplicateGroups.slice(0, 5).map((group) => (
              <div key={group.hash} className="rounded-2xl border border-[color:var(--border)] p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                  {group.count} records · SHA-256 {group.hash.slice(0, 16)}…
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {group.items.map((item) => (
                    <Link
                      key={item.id}
                      to={`/manual/records/${item.id}`}
                      className="rounded-xl border border-[color:var(--border)] px-2.5 py-1.5 text-xs text-main transition hover:bg-[color:var(--accent-soft)]"
                    >
                      {item.sampleCode || item.reportId}
                      {item.grade ? ` · ${item.grade}` : ''}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
