import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API, { apiErrorMessage, downloadApiFile } from '../api/axios';
import { useToast } from '../context/ToastContext';
import { usePolicy } from '../context/PolicyContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import StatCard from '../components/ui/StatCard';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import ConfirmDialog from '../components/ConfirmDialog';
import PolicyNotice from '../components/PolicyNotice';
import { GradeBadge } from '../components/ui/Badge';
import { TextField, SelectField } from '../components/ui/Field';
import {
  ArrowRightIcon,
  CompareIcon,
  DownloadIcon,
  HistoryIcon,
  SearchIcon,
  TrashIcon,
  UploadIcon,
} from '../components/Icons';
import {
  csvDownloadName,
  downloadName,
  enabledGradeLetters,
  formatDateTime,
  formatNumber,
  formatPercent,
  gradeAvailability,
  gradeColor,
  supportedGradeLetters,
} from '../utils/format';

const EMPTY_FILTERS = { q: '', grade: '', from: '', to: '', sort: 'newest' };

function FilterBar({ draft, setDraft, onApply, onReset, loading, grades }) {
  return (
    <Card className="p-4 sm:p-5 animate-in">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply();
        }}
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_auto]"
      >
        <div className="relative">
          <label className="field-label" htmlFor="history-search">
            Search
          </label>
          <SearchIcon
            width={15}
            height={15}
            className="pointer-events-none absolute bottom-3 left-3 text-muted"
          />
          <input
            id="history-search"
            className="input !pl-9"
            placeholder="Report ID or filename"
            value={draft.q}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
          />
        </div>
        {grades.length > 0 ? (
          <SelectField
            id="history-grade"
            label="Grade"
            value={draft.grade}
            onChange={(event) => setDraft({ ...draft, grade: event.target.value })}
          >
            <option value="">All enabled grades</option>
            {grades.map((letter) => (
              <option key={letter} value={`Grade ${letter}`}>
                Grade {letter}
              </option>
            ))}
            <option value="Invalid">Invalid (no detection)</option>
          </SelectField>
        ) : (
          <div>
            <label className="field-label" htmlFor="history-grade-disabled">
              Grade
            </label>
            <input
              id="history-grade-disabled"
              className="input"
              value="Grading hidden by policy"
              disabled
              readOnly
            />
          </div>
        )}
        <TextField
          id="history-from"
          label="From"
          type="date"
          value={draft.from}
          max={draft.to || undefined}
          onChange={(event) => setDraft({ ...draft, from: event.target.value })}
        />
        <TextField
          id="history-to"
          label="To"
          type="date"
          value={draft.to}
          min={draft.from || undefined}
          onChange={(event) => setDraft({ ...draft, to: event.target.value })}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end md:col-span-2 xl:col-span-1">
          <SelectField
            id="history-sort"
            label="Sort"
            className="min-w-0 flex-1"
            value={draft.sort}
            onChange={(event) => setDraft({ ...draft, sort: event.target.value })}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="confidence">Highest confidence</option>
            <option value="grade">Grade A → D</option>
          </SelectField>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button type="submit" disabled={loading} className="sm:mb-0.5">
              {loading ? <Spinner size={15} /> : 'Apply'}
            </Button>
            <Button
              variant="secondary"
              onClick={onReset}
              disabled={loading}
              className="sm:mb-0.5"
              title="Reset filters"
            >
              Reset
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

export default function History() {
  const navigate = useNavigate();
  const toast = useToast();
  const { policy } = usePolicy();
  const gradingOn = policy?.masterEnabled !== false;
  const enabledLetters = gradingOn
    ? Array.isArray(policy?.enabledLetters)
      ? policy.enabledLetters
      : ['A', 'B']
    : [];

  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [query, setQuery] = useState({ ...EMPTY_FILTERS, page: 1, limit: 10 });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const params = { page: query.page, limit: query.limit, sort: query.sort };
    if (query.q) params.q = query.q;
    if (query.grade) params.grade = query.grade;
    if (query.from) params.from = query.from;
    if (query.to) params.to = query.to;

    API.get('/scans/history', { params })
      .then((response) => {
        if (alive) setData(response.data);
      })
      .catch((err) => {
        if (alive) setError(apiErrorMessage(err, 'Unable to load prediction history.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [query, reloadKey]);

  useEffect(() => {
    if (!query.grade) return;
    if (query.grade === 'Invalid') {
      if (!gradingOn) setQuery((current) => ({ ...current, grade: '', page: 1 }));
      return;
    }
    const letter = query.grade.replace('Grade ', '');
    if (!enabledLetters.includes(letter)) {
      setQuery((current) => ({ ...current, grade: '', page: 1 }));
    }
  }, [enabledLetters, gradingOn, query.grade]);

  const items = data?.items || [];
  const summary = data?.summary || {};
  const pagination = data?.pagination || { page: 1, pages: 1, total: 0 };
  const selectedIds = useMemo(() => Object.keys(selected), [selected]);
  const activeFilterCount = ['q', 'grade', 'from', 'to'].filter((key) => query[key]).length;
  const empty = !loading && !error && items.length === 0;
  const evaluatedLetters = useMemo(() => {
    const first = items[0];
    if (!first) return enabledLetters;
    return enabledLetters.filter((letter) =>
      supportedGradeLetters(first).includes(letter)
    );
  }, [enabledLetters, items]);
  const countAvailable = evaluatedLetters.length > 0;
  const gradeSummary = enabledLetters.map((letter) => ({
    letter,
    count: summary[`grade${letter}`] || 0,
  }));

  function applyFilters() {
    if (draft.from && draft.to && draft.from > draft.to) {
      toast.error('The start date must be before the end date.');
      return;
    }
    setQuery({ ...draft, page: 1, limit: query.limit });
  }

  function resetFilters() {
    setDraft(EMPTY_FILTERS);
    setQuery({ ...EMPTY_FILTERS, page: 1, limit: query.limit });
  }

  function toggleSelected(scan) {
    setSelected((current) => {
      if (current[scan.id]) {
        const next = { ...current };
        delete next[scan.id];
        return next;
      }
      if (Object.keys(current).length >= 2) {
        toast.info('Select exactly two predictions to compare. Deselect one first.');
        return current;
      }
      return { ...current, [scan.id]: scan };
    });
  }

  function goCompare() {
    if (selectedIds.length !== 2) {
      toast.info('Select two predictions to compare.');
      return;
    }
    navigate(`/compare?ids=${selectedIds.join(',')}`);
  }

  async function exportCsv() {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.grade) params.set('grade', query.grade);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.sort) params.set('sort', query.sort);
    const search = params.toString();

    setExporting(true);
    try {
      await downloadApiFile(
        `/scans/export.csv${search ? `?${search}` : ''}`,
        csvDownloadName('history', new Date().toISOString().slice(0, 10))
      );
      toast.success('History CSV downloaded.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not export the history.'));
    } finally {
      setExporting(false);
    }
  }

  async function downloadPdf(scan) {
    setDownloadingId(scan.id);
    try {
      await downloadApiFile(
        `/scans/${scan.id}/report.pdf`,
        downloadName(scan.reportId, 'report')
      );
      toast.success('PDF report downloaded.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not generate the PDF report.'));
    } finally {
      setDownloadingId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await API.delete(`/scans/${pendingDelete.id}`);
      toast.success('Prediction deleted.');
      setSelected((current) => {
        const next = { ...current };
        delete next[pendingDelete.id];
        return next;
      });
      setPendingDelete(null);
      const shouldStepBack = items.length === 1 && pagination.page > 1;
      if (shouldStepBack) {
        setQuery((current) => ({ ...current, page: current.page - 1 }));
      } else {
        setReloadKey((key) => key + 1);
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not delete this prediction.'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PolicyNotice policy={policy} showPricing />
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-2xl font-semibold text-main">Prediction history</h2>
          <p className="mt-1 text-sm text-muted">
            Search, filter, download, and compare the reports stored with your account.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportCsv} disabled={exporting || loading}>
            {exporting ? <Spinner size={15} /> : <DownloadIcon width={16} height={16} />}
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
          <Button
            variant="secondary"
            onClick={goCompare}
            disabled={selectedIds.length !== 2}
          >
            <CompareIcon width={16} height={16} />
            Compare ({selectedIds.length}/2)
          </Button>
          <Button onClick={() => navigate('/upload')}>
            <UploadIcon width={16} height={16} /> New prediction
          </Button>
        </div>
      </div>

      {gradingOn ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Matching predictions"
            value={formatNumber(summary.total || 0)}
            hint={activeFilterCount ? `${activeFilterCount} active filter(s)` : 'All records'}
            icon={<HistoryIcon width={17} height={17} />}
          />
          <StatCard
            label={`Grade ${enabledLetters.join(' / ')}`}
            value={
              gradeSummary.length
                ? gradeSummary
                    .map((item) =>
                      countAvailable && evaluatedLetters.includes(item.letter)
                        ? formatNumber(item.count)
                        : '—'
                    )
                    .join(' / ')
                : '—'
            }
            hint={
              countAvailable
                ? `${formatNumber(summary.invalid || 0)} invalid · enabled grades only`
                : 'No enabled validated per-nut count'
            }
            tone="a"
          />
          <StatCard
            label="Detected nuts"
            value={countAvailable ? formatNumber(summary.totalNuts || 0) : '—'}
            hint={
              countAvailable
                ? 'Across matching predictions'
                : 'C/D advisory grades do not create nut counts'
            }
            tone="b"
          />
          <StatCard
            label="Avg quality score"
            value={
              summary.avgQualityScore === null || summary.avgQualityScore === undefined
                ? '—'
                : Number(summary.avgQualityScore).toFixed(1)
            }
            hint="Heuristic composition score"
          />
        </div>
      ) : (
        <div className="alert alert-warn items-start text-xs">
          <span>
            Summary charts and grade statistics are hidden while master prediction is off.
            Stored reports remain available below without grading fields.
          </span>
        </div>
      )}

      <FilterBar
        draft={draft}
        setDraft={setDraft}
        onApply={applyFilters}
        onReset={resetFilters}
        loading={loading}
        grades={enabledLetters}
      />

      {error && (
        <div className="alert alert-danger">
          <span className="flex-1">{error}</span>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            Retry
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border)] px-4 py-3">
          <p className="text-xs text-muted">
            {loading
              ? 'Loading predictions…'
              : `${formatNumber(pagination.total)} prediction${pagination.total === 1 ? '' : 's'} found`}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted">
            {loading && <Spinner size={12} />}
            <span>
              Page {pagination.page} of {pagination.pages}
            </span>
          </div>
        </div>

        {empty ? (
          <EmptyState
            icon={activeFilterCount ? '🔍' : '📄'}
            title={activeFilterCount ? 'No matching predictions' : 'No predictions yet'}
            description={
              activeFilterCount
                ? 'Try broadening your search or clearing one of the filters.'
                : 'Upload your first arecanut tray image to create a stored report.'
            }
            action={
              activeFilterCount ? (
                <Button variant="secondary" onClick={resetFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button onClick={() => navigate('/upload')}>
                  <UploadIcon width={16} height={16} /> New prediction
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
                    <th aria-label="Select" />
                    <th>Report</th>
                    {gradingOn && <th>Grade</th>}
                    {gradingOn && <th>{enabledLetters.join(' / ')}</th>}
                    {gradingOn && <th>Total</th>}
                    {gradingOn && <th>Quality</th>}
                    {gradingOn && <th>Confidence</th>}
                    <th>Date</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((scan) => {
                    const isSelected = Boolean(selected[scan.id]);
                    return (
                      <tr key={scan.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelected(scan)}
                            aria-label={`Select ${scan.reportId || scan.filename} for comparison`}
                            className="h-4 w-4 rounded border-[color:var(--border-strong)] accent-[color:var(--accent)]"
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => navigate(`/result/${scan.id}`)}
                            className="text-left"
                          >
                            <span className="block font-semibold text-main hover:text-accent">
                              {scan.reportId || scan.id.slice(-6).toUpperCase()}
                            </span>
                            <span className="block max-w-[15rem] truncate text-xs text-muted">
                              {scan.filename}
                            </span>
                          </button>
                        </td>
                        {gradingOn && (
                          <td>
                            <GradeBadge grade={scan.finalGrade} />
                            {scan.finalGradeSource === 'gemini_advisory' && (
                              <span className="ml-1 text-[10px] text-muted">advisory</span>
                            )}
                          </td>
                        )}
                        {gradingOn && (
                          <td className="whitespace-nowrap text-xs">
                            {enabledLetters.map((letter, index) => {
                              const availability = gradeAvailability(scan, letter);
                              return (
                                <span key={letter}>
                                  {index > 0 && ' / '}
                                  <span
                                    className="font-bold"
                                    style={{
                                      color: availability.supported
                                        ? gradeColor(`Grade ${letter}`)
                                        : 'var(--text-muted)',
                                    }}
                                    title={
                                      availability.supported
                                        ? undefined
                                        : availability.reason || 'No validated detector'
                                    }
                                  >
                                    {availability.supported
                                      ? formatNumber(availability.count ?? scan[`grade${letter}`] ?? 0)
                                      : '—'}
                                  </span>
                                </span>
                              );
                            })}
                          </td>
                        )}
                        {gradingOn && (
                          <td className="text-sm text-main">
                            {countAvailable ? formatNumber(scan.totalCount) : '—'}
                          </td>
                        )}
                        {gradingOn && (
                          <td className="text-sm text-main">
                            {scan.qualityScore === null
                              ? '—'
                              : Number(scan.qualityScore).toFixed(1)}
                          </td>
                        )}
                        {gradingOn && (
                          <td className="text-sm text-main">{formatPercent(scan.confidence)}</td>
                        )}
                        <td className="whitespace-nowrap text-xs text-muted">
                          {formatDateTime(scan.createdAt)}
                        </td>
                        <td>
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              className="btn-ghost !p-2"
                              onClick={() => downloadPdf(scan)}
                              disabled={downloadingId === scan.id}
                              aria-label="Download PDF report"
                              title="Download PDF report"
                            >
                              {downloadingId === scan.id ? (
                                <Spinner size={14} />
                              ) : (
                                <DownloadIcon width={15} height={15} />
                              )}
                            </button>
                            <button
                              type="button"
                              className="btn-ghost !p-2"
                              onClick={() => navigate(`/result/${scan.id}`)}
                              aria-label="Open prediction"
                              title="Open prediction"
                            >
                              <ArrowRightIcon width={15} height={15} />
                            </button>
                            <button
                              type="button"
                              className="btn-ghost !p-2 hover:!text-[color:var(--danger)]"
                              onClick={() => setPendingDelete(scan)}
                              aria-label="Delete prediction"
                              title="Delete prediction"
                            >
                              <TrashIcon width={15} height={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-[color:var(--border)] xl:hidden">
              {items.map((scan) => {
                const isSelected = Boolean(selected[scan.id]);
                return (
                  <div key={scan.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelected(scan)}
                        aria-label={`Select ${scan.reportId || scan.filename} for comparison`}
                        className="mt-1 h-4 w-4 accent-[color:var(--accent)]"
                      />
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => navigate(`/result/${scan.id}`)}
                          className="block w-full text-left"
                        >
                          <span className="block truncate text-sm font-semibold text-main">
                            {scan.reportId || scan.id.slice(-6).toUpperCase()}
                          </span>
                          <span className="block truncate text-xs text-muted">{scan.filename}</span>
                        </button>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <GradeBadge grade={scan.finalGrade} />
                          {gradingOn && countAvailable && (
                            <>
                              <span className="pill">{formatPercent(scan.confidence)} conf.</span>
                              <span className="pill">{formatNumber(scan.totalCount)} nuts</span>
                            </>
                          )}
                          {gradingOn && !countAvailable && (
                            <span className="pill">No enabled per-nut count</span>
                          )}
                        </div>
                        {gradingOn && (
                          <p className="mt-2 text-[11px] text-muted">
                            {formatDateTime(scan.createdAt)} ·{' '}
                            {enabledLetters.map((letter, index) => {
                              const availability = gradeAvailability(scan, letter);
                              return (
                                <span key={letter}>
                                  {index > 0 ? ' / ' : ''}
                                  {letter} {availability.supported ? availability.count : '—'}
                                </span>
                              );
                            })}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => navigate(`/result/${scan.id}`)}
                          >
                            Open
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => downloadPdf(scan)}
                            disabled={downloadingId === scan.id}
                          >
                            {downloadingId === scan.id ? <Spinner size={13} /> : 'PDF'}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setPendingDelete(scan)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!empty && !error && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--border)] px-4 py-3">
            <p className="text-xs text-muted">
              Showing {(pagination.page - 1) * pagination.limit + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
              {formatNumber(pagination.total)}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!pagination.hasPrev || loading}
                onClick={() =>
                  setQuery((current) => ({ ...current, page: Math.max(1, current.page - 1) }))
                }
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!pagination.hasNext || loading}
                onClick={() => setQuery((current) => ({ ...current, page: current.page + 1 }))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        destructive
        title="Delete this prediction?"
        description={`${
          pendingDelete?.reportId || pendingDelete?.filename || 'This prediction'
        } and its stored images will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete prediction"
      />
    </div>
  );
}
