import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import API, { apiErrorMessage, downloadApiFile } from '../../api/axios';
import { useToast } from '../../context/ToastContext';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import StatCard from '../../components/ui/StatCard';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import Pagination from '../../components/ui/Pagination';
import ConfirmDialog from '../../components/ConfirmDialog';
import { TextField, SelectField } from '../../components/ui/Field';
import { ManualGradeBadge } from '../../components/manual/ManualBadges';
import {
  AlertIcon,
  CalculatorIcon,
  CheckIcon,
  DownloadIcon,
  FilterIcon,
  TagIcon,
  TrashIcon,
} from '../../components/Icons';
import { MANUAL_GRADE_OPTIONS, todayInputValue } from '../../utils/manual';
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatWeightKg,
} from '../../utils/format';

const PAGE_SIZE = 20;

function emptyFilters() {
  return { market: '', grade: '', from: '', to: '', sort: 'newest' };
}

function newPriceForm() {
  return {
    marketName: '',
    grade: '',
    weightKg: '',
    pricePerKg: '',
    priceDate: todayInputValue(),
    notes: '',
  };
}

function formatMoney(value, currency = 'INR') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 2,
    }).format(Number(value));
  } catch {
    return `${currency || ''} ${Number(value).toLocaleString()}`;
  }
}

export default function ManualCalculator() {
  const toast = useToast();
  const [form, setForm] = useState(newPriceForm);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    API.get('/manual/prices', {
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
        if (alive) setError(apiErrorMessage(err, 'Could not load user-provided price records.'));
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
  const estimate = useMemo(() => {
    const weight = Number(form.weightKg);
    const price = Number(form.pricePerKg);
    if (!Number.isFinite(weight) || !Number.isFinite(price) || weight < 0 || price < 0) return 0;
    return Math.round((weight * price + Number.EPSILON) * 100) / 100;
  }, [form.weightKg, form.pricePerKg]);
  const hasFilters = Object.entries(applied).some(
    ([key, value]) => value !== '' && !(key === 'sort' && value === 'newest')
  );

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function savePrice(event) {
    event.preventDefault();
    if (!form.grade) {
      toast.error('Select Grade A or Grade B.');
      return;
    }
    if (!form.weightKg || !form.pricePerKg) {
      toast.error('Enter both a weight and a price per kilogram.');
      return;
    }
    setSaving(true);
    try {
      const response = await API.post('/manual/prices', {
        ...form,
        currency: 'INR',
      });
      toast.success(`Price record saved: ${formatMoney(response.data.price.value)}.`);
      setForm((current) => ({
        ...newPriceForm(),
        grade: current.grade,
        marketName: current.marketName,
        priceDate: current.priceDate,
      }));
      setPage(1);
      setReloadKey((key) => key + 1);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save this price record.'));
    } finally {
      setSaving(false);
    }
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

  async function exportCsv() {
    setExporting(true);
    try {
      const params = new URLSearchParams(
        Object.fromEntries(Object.entries(applied).filter(([, value]) => value !== ''))
      );
      await downloadApiFile(
        `/manual/prices/export.csv${params.toString() ? `?${params.toString()}` : ''}`,
        `manual-price-records-${new Date().toISOString().slice(0, 10)}.csv`
      );
      toast.success('Price records CSV downloaded.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not export price records.'));
    } finally {
      setExporting(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await API.delete(`/manual/prices/${deleteTarget.id}`);
      toast.success('Price record deleted.');
      setDeleteTarget(null);
      if (items.length === 1 && page > 1) setPage((current) => current - 1);
      else setReloadKey((key) => key + 1);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not delete the price record.'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-5 animate-in">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <p className="section-label">Manual grading · value calculator</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-main">
              User-entered value calculator
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
              Multiply a weight you measured by a price you entered. The app does not fetch, infer,
              or display live market prices. Values are shown in INR.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">User-provided data</Badge>
            <Badge tone="a">No live prices</Badge>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-display text-xl font-semibold text-main">Calculate and save</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                The calculated value is weight in kilograms × your price per kilogram.
              </p>
            </div>
            <CalculatorIcon width={20} height={20} className="text-accent" />
          </div>

          <form onSubmit={savePrice} className="mt-4 space-y-4">
            <div>
              <p className="field-label">Manual grade</p>
              <div className="grid grid-cols-2 gap-2">
                {MANUAL_GRADE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => update('grade', option.value)}
                    className={`btn ${form.grade === option.value ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    Grade {option.value}
                  </button>
                ))}
              </div>
            </div>

            <TextField
              id="price-market"
              label="Market name (optional)"
              value={form.marketName}
              onChange={(event) => update('marketName', event.target.value)}
              placeholder="e.g. Local market"
              maxLength={80}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                id="price-weight"
                label="Weight (kg)"
                type="number"
                min="0.000001"
                step="0.001"
                value={form.weightKg}
                onChange={(event) => update('weightKg', event.target.value)}
                placeholder="e.g. 12.5"
                required
              />
              <TextField
                id="price-per-kg"
                label="Price per kg (INR)"
                type="number"
                min="0.000001"
                step="0.01"
                value={form.pricePerKg}
                onChange={(event) => update('pricePerKg', event.target.value)}
                placeholder="e.g. 350"
                required
              />
            </div>
            <TextField
              id="price-date"
              label="Price date"
              type="date"
              value={form.priceDate}
              onChange={(event) => update('priceDate', event.target.value)}
              max={todayInputValue()}
            />
            <div>
              <label className="field-label" htmlFor="price-notes">Notes (optional)</label>
              <textarea
                id="price-notes"
                className="input min-h-20 resize-y"
                value={form.notes}
                onChange={(event) => update('notes', event.target.value)}
                maxLength={500}
                placeholder="Source of the price, negotiation context, or other notes."
              />
            </div>

            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                Calculated value
              </p>
              <p className="mt-1 font-display text-3xl font-semibold text-main">
                {formatMoney(estimate)}
              </p>
              <p className="mt-1 text-[11px] text-muted">
                {form.weightKg || '0'} kg × ₹{form.pricePerKg || '0'}/kg
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? <Spinner size={14} /> : <CheckIcon width={15} height={15} />}
              {saving ? 'Saving…' : 'Save price record'}
            </Button>
          </form>

          <div className="mt-4 flex items-start gap-2 rounded-xl bg-[color:var(--warn-soft)] p-2.5 text-[11px] leading-relaxed text-[color:var(--warn)]">
            <AlertIcon width={14} height={14} className="mt-0.5 shrink-0" />
            This is a user-entered calculation, not a valuation quote, live market price, or
            financial advice.
          </div>
        </Card>

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Saved calculations"
              value={formatNumber(summary.count || 0)}
              hint="Matching the current filters"
              icon={<CalculatorIcon width={17} height={17} />}
            />
            <StatCard
              label="Weight entered"
              value={formatWeightKg(summary.totalWeightKg || 0)}
              hint="Only saved user entries"
              tone="a"
              icon={<CheckIcon width={17} height={17} />}
            />
            <StatCard
              label="Recorded value"
              value={formatMoney(summary.totalValue || 0)}
              hint="Sum of saved calculations"
              tone="b"
              icon={<TagIcon width={17} height={17} />}
            />
            <StatCard
              label="Average price/kg"
              value={summary.avgPricePerKg ? formatMoney(summary.avgPricePerKg) : '—'}
              hint="Average of saved price entries"
            />
          </div>

          <Card className="p-4">
            <form onSubmit={applyFilters}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <TextField
                  id="price-filter-market"
                  label="Market"
                  value={filters.market}
                  onChange={(event) => setFilters((current) => ({ ...current, market: event.target.value }))}
                  placeholder="Search market"
                />
                <SelectField
                  id="price-filter-grade"
                  label="Grade"
                  value={filters.grade}
                  onChange={(event) => setFilters((current) => ({ ...current, grade: event.target.value }))}
                >
                  <option value="">All grades</option>
                  <option value="A">Grade A</option>
                  <option value="B">Grade B</option>
                </SelectField>
                <TextField
                  id="price-filter-from"
                  label="From"
                  type="date"
                  value={filters.from}
                  onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
                />
                <TextField
                  id="price-filter-to"
                  label="To"
                  type="date"
                  value={filters.to}
                  onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
                />
                <SelectField
                  id="price-filter-sort"
                  label="Sort"
                  value={filters.sort}
                  onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))}
                >
                  <option value="newest">Newest price date</option>
                  <option value="oldest">Oldest price date</option>
                  <option value="price_high">Highest price/kg</option>
                  <option value="price_low">Lowest price/kg</option>
                </SelectField>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                  Reset
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={exportCsv} disabled={exporting}>
                  {exporting ? <Spinner size={13} /> : <DownloadIcon width={14} height={14} />}
                  Export CSV
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
              <div className="space-y-3 p-5">
                {[0, 1, 2, 3].map((key) => (
                  <div key={key} className="skeleton h-10 w-full" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <EmptyState
                icon="∑"
                title={hasFilters ? 'No price records match these filters' : 'No price calculations yet'}
                description={
                  hasFilters
                    ? 'Try clearing a filter or widening the date range.'
                    : 'Enter a weight and a price you know, then save the calculation to keep a record.'
                }
                action={
                  hasFilters ? (
                    <Button variant="secondary" onClick={resetFilters}>Clear filters</Button>
                  ) : null
                }
              />
            ) : (
              <>
                <div className="table-shell hidden lg:block">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Market</th>
                        <th>Grade</th>
                        <th>Weight</th>
                        <th>Price / kg</th>
                        <th>Value</th>
                        <th className="text-right">Delete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((record) => (
                        <tr key={record.id}>
                          <td>
                            <p className="text-xs text-main">{formatDate(record.priceDate)}</p>
                            <p className="mt-0.5 text-[10px] text-muted">
                              saved {formatDateTime(record.createdAt)}
                            </p>
                          </td>
                          <td>
                            <p className="text-sm text-main">{record.marketName || 'Not named'}</p>
                            {record.notes && (
                              <p className="mt-0.5 max-w-[14rem] truncate text-[11px] text-muted">
                                {record.notes}
                              </p>
                            )}
                          </td>
                          <td><ManualGradeBadge grade={record.grade} /></td>
                          <td className="text-sm text-main">{formatWeightKg(record.weightKg)}</td>
                          <td className="text-sm text-main">{formatMoney(record.pricePerKg, record.currency)}</td>
                          <td className="text-sm font-semibold text-main">
                            {formatMoney(record.value, record.currency)}
                          </td>
                          <td>
                            <div className="flex justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="!text-danger"
                                onClick={() => setDeleteTarget(record)}
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

                <div className="divide-y divide-[color:var(--border)] lg:hidden">
                  {items.map((record) => (
                    <div key={record.id} className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-main">
                            {record.marketName || 'Unnamed market'}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted">
                            {formatDate(record.priceDate)}
                          </p>
                        </div>
                        <ManualGradeBadge grade={record.grade} />
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-[color:var(--panel-soft)] p-2 text-center text-[11px]">
                        <div>
                          <p className="text-[9px] uppercase tracking-[0.1em] text-muted">Weight</p>
                          <p className="mt-0.5 font-semibold text-main">{formatWeightKg(record.weightKg)}</p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-[0.1em] text-muted">Price/kg</p>
                          <p className="mt-0.5 font-semibold text-main">
                            {formatMoney(record.pricePerKg, record.currency)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-[0.1em] text-muted">Value</p>
                          <p className="mt-0.5 font-semibold text-main">
                            {formatMoney(record.value, record.currency)}
                          </p>
                        </div>
                      </div>
                      {record.notes && <p className="mt-2 text-xs text-muted">{record.notes}</p>}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2 !text-danger"
                        onClick={() => setDeleteTarget(record)}
                      >
                        <TrashIcon width={13} height={13} /> Delete record
                      </Button>
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
                  label="calculations"
                />
              </>
            )}
          </Card>

          <Card className="p-4">
            <p className="text-[11px] leading-relaxed text-muted">
              Price records are stored only for your account. The application does not guarantee
              prices, values, or returns. Use the record history and CSV as an audit of the numbers
              you entered.
            </p>
            <Link to="/manual" className="link mt-2 inline-flex text-xs">
              Back to manual overview
            </Link>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this price record?"
        description="The saved calculation will be permanently removed. Your grading records are not affected."
        confirmLabel="Delete calculation"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => !deleting && setDeleteTarget(null)}
      />
    </div>
  );
}
