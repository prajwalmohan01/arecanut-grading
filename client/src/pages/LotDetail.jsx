import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import API, { apiErrorMessage, downloadApiFile } from '../api/axios';
import { useToast } from '../context/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import StatCard from '../components/ui/StatCard';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { TextField, SelectField } from '../components/ui/Field';
import { GradeBadge } from '../components/ui/Badge';
import {
  ArrowRightIcon,
  CalculatorIcon,
  DownloadIcon,
  LayersIcon,
  SparkIcon,
  TrashIcon,
  UploadIcon,
} from '../components/Icons';
import {
  csvDownloadName,
  downloadName,
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatWeightKg,
} from '../utils/format';

const GRADE_LETTERS = ['A', 'B', 'C', 'D'];

function EditDetailsModal({ open, lot, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: '',
    reference: '',
    supplier: '',
    notes: '',
    currency: 'INR',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (lot) {
      setForm({
        name: lot.name || '',
        reference: lot.reference || '',
        supplier: lot.supplier || '',
        notes: lot.notes || '',
        currency: lot.currency || 'INR',
      });
    }
  }, [lot, open]);

  async function save(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error('Give the lot a name.');
      return;
    }
    setSaving(true);
    try {
      const response = await API.patch(`/lots/${lot.id}`, {
        name: form.name,
        reference: form.reference,
        supplier: form.supplier,
        notes: form.notes,
        currency: form.currency,
      });
      onSaved(response.data.lot);
      toast.success('Lot details updated.');
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not update the lot.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Edit lot details"
      description="Rename the lot or update its reference, supplier, and notes."
    >
      <form onSubmit={save} className="space-y-3">
        <TextField
          id="edit-lot-name"
          label="Lot name *"
          value={form.name}
          maxLength={80}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          autoFocus
        />
        <TextField
          id="edit-lot-reference"
          label="Reference"
          value={form.reference}
          maxLength={80}
          onChange={(event) => setForm({ ...form, reference: event.target.value })}
        />
        <TextField
          id="edit-lot-supplier"
          label="Supplier / estate"
          value={form.supplier}
          maxLength={80}
          onChange={(event) => setForm({ ...form, supplier: event.target.value })}
        />
        <SelectField
          id="edit-lot-currency"
          label="Currency"
          value={form.currency}
          onChange={(event) => setForm({ ...form, currency: event.target.value })}
        >
          <option value="INR">INR (₹)</option>
          <option value="USD">USD ($)</option>
          <option value="EUR">EUR (€)</option>
          <option value="GBP">GBP (£)</option>
          <option value="LKR">LKR (Rs)</option>
          <option value="NPR">NPR (Rs)</option>
        </SelectField>
        <div>
          <label className="field-label" htmlFor="edit-lot-notes">
            Notes
          </label>
          <textarea
            id="edit-lot-notes"
            className="input min-h-20"
            maxLength={500}
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner size={15} /> : null}
            {saving ? 'Saving…' : 'Save details'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function LotDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [lot, setLot] = useState(null);
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  const [assumptions, setAssumptions] = useState({
    avgNutWeightG: '',
    priceA: '',
    priceB: '',
    priceC: '',
    priceD: '',
    currency: 'INR',
  });
  const [savingPrices, setSavingPrices] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingScan, setPendingScan] = useState(null);
  const [deletingScan, setDeletingScan] = useState(false);
  const [downloadingScanId, setDownloadingScanId] = useState(null);

  const applyLot = useCallback((nextLot) => {
    setLot(nextLot);
    setAssumptions({
      avgNutWeightG: nextLot?.avgNutWeightG ?? '',
      priceA: nextLot?.prices?.A ?? '',
      priceB: nextLot?.prices?.B ?? '',
      priceC: nextLot?.prices?.C ?? '',
      priceD: nextLot?.prices?.D ?? '',
      currency: nextLot?.currency || 'INR',
    });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    API.get(`/lots/${id}`)
      .then((response) => {
        applyLot(response.data.lot);
        setScans(response.data.scans || []);
      })
      .catch((err) => setError(apiErrorMessage(err, 'Unable to load this lot.')))
      .finally(() => setLoading(false));
  }, [applyLot, id]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = lot?.totals || { scanCount: 0, totalNuts: 0, gradeCounts: {} };
  const valuation = lot?.valuation;
  const totalNuts = totals.totalNuts || 0;

  const dirty = useMemo(() => {
    if (!lot) return false;
    const number = (value) => Number(value) || 0;
    return (
      number(assumptions.avgNutWeightG) !== number(lot.avgNutWeightG) ||
      number(assumptions.priceA) !== number(lot.prices?.A) ||
      number(assumptions.priceB) !== number(lot.prices?.B) ||
      number(assumptions.priceC) !== number(lot.prices?.C) ||
      number(assumptions.priceD) !== number(lot.prices?.D)
    );
  }, [assumptions, lot]);

  async function savePrices(event) {
    event?.preventDefault();
    if (!lot) return;
    setSavingPrices(true);
    try {
      const response = await API.patch(`/lots/${lot.id}`, {
        avgNutWeightG: Number(assumptions.avgNutWeightG) || 0,
        prices: {
          A: Number(assumptions.priceA) || 0,
          B: Number(assumptions.priceB) || 0,
          C: Number(assumptions.priceC) || 0,
          D: Number(assumptions.priceD) || 0,
        },
      });
      applyLot(response.data.lot);
      toast.success('Valuation assumptions updated.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not update the valuation.'));
    } finally {
      setSavingPrices(false);
    }
  }

  async function downloadCsv() {
    if (!lot) return;
    setDownloading(true);
    try {
      await downloadApiFile(
        `/lots/${lot.id}/export.csv`,
        csvDownloadName('lot', lot.reference || lot.name)
      );
      toast.success('Lot CSV downloaded.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not export the lot.'));
    } finally {
      setDownloading(false);
    }
  }

  async function downloadScanPdf(scan) {
    setDownloadingScanId(scan.id);
    try {
      await downloadApiFile(`/scans/${scan.id}/report.pdf`, downloadName(scan.reportId, 'report'));
      toast.success('PDF report downloaded.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not generate the PDF report.'));
    } finally {
      setDownloadingScanId(null);
    }
  }

  async function deleteLot() {
    if (!lot) return;
    setDeleting(true);
    try {
      await API.delete(`/lots/${lot.id}`);
      toast.success('Lot deleted. Its predictions remain in your history.');
      navigate('/lots', { replace: true });
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not delete this lot.'));
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  async function deleteScan() {
    if (!pendingScan) return;
    setDeletingScan(true);
    try {
      await API.delete(`/scans/${pendingScan.id}`);
      setScans((current) => current.filter((scan) => scan.id !== pendingScan.id));
      setPendingScan(null);
      toast.success('Prediction removed from this lot.');
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not delete this prediction.'));
    } finally {
      setDeletingScan(false);
    }
  }

  if (loading && !lot) {
    return (
      <div className="space-y-5">
        <div className="card p-6">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton mt-3 h-9 w-72 max-w-full" />
          <div className="skeleton mt-3 h-3 w-96 max-w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="card p-5">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton mt-3 h-7 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !lot) {
    return (
      <Card>
        <EmptyState
          icon="📦"
          title="Lot unavailable"
          description={error || 'This lot could not be found, or it belongs to another account.'}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => navigate('/lots')}>Back to lots</Button>
              <Button variant="secondary" onClick={() => navigate('/upload')}>
                Batch upload
              </Button>
            </div>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6 animate-in">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="pill">{lot.reference || 'Lot'}</span>
              <span className="pill">{formatDateTime(lot.createdAt)}</span>
              {lot.supplier && <span className="pill">{lot.supplier}</span>}
            </div>
            <h2 className="mt-3 truncate font-display text-2xl font-semibold text-main sm:text-3xl">
              {lot.name}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {formatNumber(totals.scanCount)} prediction{totals.scanCount === 1 ? '' : 's'} ·{' '}
              {formatNumber(totalNuts)} detected nut{totalNuts === 1 ? '' : 's'}
              {lot.notes ? ` · ${lot.notes}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDetailsOpen(true)}>
              Edit details
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate(`/upload?lot=${lot.id}`)}
            >
              <UploadIcon width={16} height={16} /> Add images
            </Button>
            <Button variant="secondary" onClick={downloadCsv} disabled={downloading}>
              {downloading ? <Spinner size={15} /> : <DownloadIcon width={16} height={16} />}
              {downloading ? 'Preparing…' : 'Export CSV'}
            </Button>
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              <TrashIcon width={16} height={16} /> Delete lot
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Predictions"
          value={formatNumber(totals.scanCount || 0)}
          hint="Tray images in this lot"
          icon={<LayersIcon width={17} height={17} />}
        />
        <StatCard
          label="Detected nuts"
          value={formatNumber(totalNuts)}
          hint={`A ${formatNumber(totals.gradeCounts?.A || 0)} · B ${formatNumber(
            totals.gradeCounts?.B || 0
          )} · C ${formatNumber(totals.gradeCounts?.C || 0)} · D ${formatNumber(
            totals.gradeCounts?.D || 0
          )}`}
          tone="a"
        />
        <StatCard
          label="Estimated weight"
          value={formatWeightKg(valuation?.totalWeightKg)}
          hint={
            lot.avgNutWeightG > 0
              ? `${formatNumber(lot.avgNutWeightG)} g average per nut`
              : 'Set an average nut weight below'
          }
          tone="b"
        />
        <StatCard
          label="Estimated value"
          value={formatCurrency(valuation?.totalValue, lot.currency)}
          hint="Counts × average weight × price"
          icon={<CalculatorIcon width={17} height={17} />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card className="p-5 animate-in">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-semibold text-main">Price calculator</h3>
              <p className="mt-1 text-xs text-muted">
                Values update from the current detected counts. Save to keep the assumptions with
                this lot.
              </p>
            </div>
            <CalculatorIcon width={20} height={20} />
          </div>

          <form onSubmit={savePrices} className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                id="lot-avg-weight"
                label="Average nut weight (g)"
                type="number"
                min="0"
                max="1000"
                step="0.01"
                value={assumptions.avgNutWeightG}
                onChange={(event) =>
                  setAssumptions({ ...assumptions, avgNutWeightG: event.target.value })
                }
                hint="User-provided assumption, not measured by the model."
              />
              <div className="grid grid-cols-2 gap-2">
                {GRADE_LETTERS.map((letter) => (
                  <TextField
                    key={letter}
                    id={`lot-price-${letter}`}
                    label={`Grade ${letter} / kg`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={assumptions[`price${letter}`]}
                    onChange={(event) =>
                      setAssumptions({
                        ...assumptions,
                        [`price${letter}`]: event.target.value,
                      })
                    }
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-muted">
                Currency: {lot.currency}. Change it from Edit details if needed.
              </p>
              <Button type="submit" disabled={!dirty || savingPrices}>
                {savingPrices ? <Spinner size={15} /> : null}
                {savingPrices ? 'Saving…' : 'Save assumptions'}
              </Button>
            </div>
          </form>

          <div className="mt-4 overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Grade</th>
                  <th>Nuts</th>
                  <th>Est. weight</th>
                  <th>Est. value</th>
                </tr>
              </thead>
              <tbody>
                {GRADE_LETTERS.map((letter) => {
                  const row = valuation?.perGrade?.[letter] || {};
                  return (
                    <tr key={letter}>
                      <td>
                        <GradeBadge grade={`Grade ${letter}`} />
                      </td>
                      <td className="text-sm text-main">{formatNumber(row.count || 0)}</td>
                      <td className="text-sm text-main">{formatWeightKg(row.weightKg || 0)}</td>
                      <td className="text-sm font-semibold text-main">
                        {formatCurrency(row.value || 0, lot.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 rounded-2xl bg-[color:var(--panel-soft)] p-3 text-[11px] leading-relaxed text-muted">
            <SparkIcon width={14} height={14} className="mr-1 inline" />
            Estimate only: value = detected nuts × average nut weight (g) ÷ 1000 × price per kg.
            Physical weight is not measured from the image.
          </div>
        </Card>

        <Card className="p-5 animate-in">
          <h3 className="font-display text-lg font-semibold text-main">Composition</h3>
          <p className="mt-1 text-xs text-muted">Share of detected nuts by model grade.</p>
          <div className="mt-4 space-y-3">
            {GRADE_LETTERS.map((letter) => {
              const count = totals.gradeCounts?.[letter] || 0;
              const pct = totalNuts ? (count / totalNuts) * 100 : 0;
              const colors = {
                A: 'var(--accent)',
                B: 'var(--gold)',
                C: '#c77a2e',
                D: '#b44242',
              };
              return (
                <div key={letter}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-main">Grade {letter}</span>
                    <span className="text-muted">
                      {formatNumber(count)} · {pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[color:var(--border)]">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: colors[letter] }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-muted">
            The bundled checkpoint evaluates Grade A and Grade B. Grade C/D counts remain zero
            until a four-class model is installed; they are not inferred from A/B results.
          </p>
          {totals.scanCount === 0 && (
            <div className="mt-4">
              <Button onClick={() => navigate(`/upload?lot=${lot.id}`)}>
                <UploadIcon width={16} height={16} /> Add the first images
              </Button>
            </div>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border)] px-4 py-3">
          <div>
            <h3 className="font-display text-base font-semibold text-main">Predictions in this lot</h3>
            <p className="text-xs text-muted">
              {formatNumber(totals.scanCount || 0)} record{totals.scanCount === 1 ? '' : 's'}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => navigate(`/upload?lot=${lot.id}`)}>
            <UploadIcon width={15} height={15} /> Add images
          </Button>
        </div>

        {scans.length === 0 ? (
          <EmptyState
            icon="🖼️"
            title="No predictions in this lot yet"
            description="Upload one or more tray images and choose this lot to attach them here."
            action={
              <Button onClick={() => navigate(`/upload?lot=${lot.id}`)}>
                <UploadIcon width={16} height={16} /> Batch upload
              </Button>
            }
          />
        ) : (
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Report</th>
                  <th>Grade</th>
                  <th>A / B / C / D</th>
                  <th>Nuts</th>
                  <th>Est. value</th>
                  <th>Date</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => {
                  const weightG = Number(lot.avgNutWeightG) || 0;
                  const estimatedValue =
                    weightG > 0
                      ? (GRADE_LETTERS.reduce(
                          (sum, letter) =>
                            sum +
                            (Number(scan[`grade${letter}`]) || 0) *
                              (Number(lot.prices?.[letter]) || 0),
                          0
                        ) *
                          weightG) /
                        1000
                      : 0;
                  return (
                    <tr key={scan.id}>
                      <td>
                        <Link to={`/result/${scan.id}`} className="block text-left">
                          <span className="block font-semibold text-main hover:text-accent">
                            {scan.reportId || scan.id.slice(-6).toUpperCase()}
                          </span>
                          <span className="block max-w-[14rem] truncate text-xs text-muted">
                            {scan.filename}
                          </span>
                        </Link>
                      </td>
                      <td>
                        <GradeBadge grade={scan.finalGrade} />
                      </td>
                      <td className="whitespace-nowrap text-xs">
                        {scan.gradeA} / {scan.gradeB} / {scan.gradeC} / {scan.gradeD}
                      </td>
                      <td className="text-sm text-main">{formatNumber(scan.totalCount)}</td>
                      <td className="text-sm text-main">
                        {formatCurrency(estimatedValue, lot.currency)}
                      </td>
                      <td className="whitespace-nowrap text-xs text-muted">
                        {formatDateTime(scan.createdAt)}
                      </td>
                      <td>
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            className="btn-ghost !p-2"
                            onClick={() => downloadScanPdf(scan)}
                            disabled={downloadingScanId === scan.id}
                            title="Download PDF report"
                            aria-label="Download PDF report"
                          >
                            {downloadingScanId === scan.id ? (
                              <Spinner size={14} />
                            ) : (
                              <DownloadIcon width={15} height={15} />
                            )}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost !p-2"
                            onClick={() => navigate(`/result/${scan.id}`)}
                            title="Open prediction"
                            aria-label="Open prediction"
                          >
                            <ArrowRightIcon width={15} height={15} />
                          </button>
                          <button
                            type="button"
                            className="btn-ghost !p-2 hover:!text-[color:var(--danger)]"
                            onClick={() => setPendingScan(scan)}
                            title="Remove from lot and delete prediction"
                            aria-label="Delete prediction"
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
        )}
      </Card>

      <EditDetailsModal
        open={detailsOpen}
        lot={lot}
        onClose={() => setDetailsOpen(false)}
        onSaved={(updated) => {
          setLot((current) => ({ ...current, ...updated }));
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={deleteLot}
        loading={deleting}
        destructive
        title="Delete this lot?"
        description="The lot and its pricing assumptions will be deleted. Predictions stay in your history and are unassigned from the lot."
        confirmLabel="Delete lot"
      />

      <ConfirmDialog
        open={Boolean(pendingScan)}
        onClose={() => setPendingScan(null)}
        onConfirm={deleteScan}
        loading={deletingScan}
        destructive
        title="Delete this prediction?"
        description={`${
          pendingScan?.reportId || pendingScan?.filename || 'This prediction'
        } and its stored images will be permanently deleted from your history and this lot.`}
        confirmLabel="Delete prediction"
      />
    </div>
  );
}
