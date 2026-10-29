import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import API, { apiErrorMessage } from '../api/axios';
import { useToast } from '../context/ToastContext';
import { usePolicy } from '../context/PolicyContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import StatCard from '../components/ui/StatCard';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import Modal from '../components/ui/Modal';
import PolicyNotice from '../components/PolicyNotice';
import { TextField } from '../components/ui/Field';
import { GradeBadge } from '../components/ui/Badge';
import {
  ArrowRightIcon,
  LayersIcon,
  PlusIcon,
  UploadIcon,
  CalculatorIcon,
} from '../components/Icons';
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatWeightKg,
  pricingStatusText,
} from '../utils/format';

const EMPTY_FORM = {
  name: '',
  reference: '',
  supplier: '',
  currency: 'INR',
  avgNutWeightG: '',
  measuredWeightKg: '',
  notes: '',
};

function LotCard({ lot }) {
  const totals = lot.totals || {};
  const policy = lot.policy || {};
  const gradingOn = policy.masterEnabled !== false;
  const enabledLetters = gradingOn
    ? Array.isArray(policy.enabledLetters)
      ? policy.enabledLetters
      : ['A', 'B']
    : [];
  const valuation = lot.valuation || {};
  const measured = Number(valuation.measuredWeightKg) > 0;
  const suggested = Number(valuation.estimatedWeightKg) > 0;
  return (
    <Card className="flex flex-col p-5 animate-in">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
            {lot.reference || 'Lot'}
          </p>
          <h3 className="mt-1 truncate font-display text-lg font-semibold text-main">
            {lot.name}
          </h3>
          <p className="mt-1 truncate text-xs text-muted">
            {lot.supplier ? `${lot.supplier} · ` : ''}
            {formatDateTime(lot.createdAt)}
          </p>
        </div>
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          <LayersIcon width={19} height={19} />
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-[color:var(--panel-soft)] p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted">Scans</p>
          <p className="mt-0.5 text-sm font-bold text-main">{formatNumber(totals.scanCount || 0)}</p>
        </div>
        <div className="rounded-2xl bg-[color:var(--panel-soft)] p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted">Nuts</p>
          <p className="mt-0.5 text-sm font-bold text-main">
            {gradingOn && totals.totalNuts !== null ? formatNumber(totals.totalNuts || 0) : '—'}
          </p>
        </div>
        <div className="rounded-2xl bg-[color:var(--panel-soft)] p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted">Measured kg</p>
          <p className="mt-0.5 text-sm font-bold text-main">
            {measured ? formatWeightKg(valuation.measuredWeightKg) : '—'}
          </p>
        </div>
      </div>

      {gradingOn && enabledLetters.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {enabledLetters.map((letter) => {
            const unavailable = (totals.unavailableGrades || []).includes(letter);
            return (
              <span key={letter} className="inline-flex items-center gap-1">
                <GradeBadge grade={`Grade ${letter}`} />
                <span className="text-xs text-muted">
                  {unavailable ? 'not counted' : formatNumber(totals.gradeCounts?.[letter] || 0)}
                </span>
              </span>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex items-end justify-between gap-3 border-t border-[color:var(--border)] pt-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-muted">
            {valuation.totalValue == null ? 'Measured-weight total' : 'Measured-weight value'}
          </p>
          <p className="mt-0.5 font-display text-xl font-bold text-main">
            {valuation.totalValue == null
              ? 'Not claimed'
              : formatCurrency(valuation.totalValue, lot.currency)}
          </p>
          <p className="mt-0.5 text-[10px] text-muted">
            {!gradingOn
              ? 'Hidden by grading policy'
              : valuation.totalValue == null
              ? suggested
                ? `Estimated nut-count weight ${formatWeightKg(valuation.estimatedWeightKg)} — enter measured lot weight to price`
                : pricingStatusText(valuation)
              : 'Based on measured lot weight'}
          </p>
        </div>
        <Link
          to={`/lots/${lot.id}`}
          className="btn-secondary btn-sm shrink-0"
          aria-label={`Open lot ${lot.name}`}
        >
          Open <ArrowRightIcon width={14} height={14} />
        </Link>
      </div>
    </Card>
  );
}

export default function Lots() {
  const navigate = useNavigate();
  const toast = useToast();
  const { policy } = usePolicy();
  const gradingOn = policy?.masterEnabled !== false;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    API.get('/lots')
      .then((response) => setItems(response.data.items || []))
      .catch((err) => setError(apiErrorMessage(err, 'Unable to load lots.')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    return items.reduce(
      (acc, lot) => {
        acc.lots += 1;
        acc.scans += lot.totals?.scanCount || 0;
        acc.nuts += lot.totals?.totalNuts || 0;
        acc.value += lot.valuation?.totalValue || 0;
        return acc;
      },
      { lots: 0, scans: 0, nuts: 0, value: 0 }
    );
  }, [items]);

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function createLot(event) {
    event?.preventDefault();
    if (!form.name.trim()) {
      toast.error('Give the lot a name.');
      return;
    }
    setCreating(true);
    try {
      const response = await API.post('/lots', {
        name: form.name,
        reference: form.reference,
        supplier: form.supplier,
        notes: form.notes,
        currency: policy?.currency || form.currency || 'INR',
        avgNutWeightG: Number(form.avgNutWeightG) || 0,
        measuredWeightKg: Number(form.measuredWeightKg) || 0,
      });
      const lot = response.data.lot;
      toast.success('Lot created. Add tray images to it from the upload page.');
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      setItems((current) => [lot, ...current]);
      navigate(`/lots/${lot.id}`);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not create the lot.'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5">
      <PolicyNotice policy={policy} showPricing />
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-2xl font-semibold text-main">Lots &amp; batches</h2>
          <p className="mt-1 text-sm text-muted">
            Group tray predictions into a lot, record a measured net weight, and apply the active
            administrator pricing policy.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => navigate('/upload')}
            disabled={!gradingOn}
          >
            <UploadIcon width={16} height={16} /> Batch upload
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon width={16} height={16} /> New lot
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Lots"
          value={formatNumber(summary.lots)}
          hint="Batches stored with your account"
          icon={<LayersIcon width={17} height={17} />}
        />
        <StatCard
          label="Predictions in lots"
          value={formatNumber(summary.scans)}
          hint="Grouped prediction records"
          tone="a"
        />
        <StatCard
          label="Detected nuts"
          value={gradingOn ? formatNumber(summary.nuts) : '—'}
          hint={gradingOn ? 'Across enabled grades' : 'Hidden by grading policy'}
          tone="b"
        />
        <StatCard
          label="Measured-weight value"
          value={
            gradingOn && policy?.pricingMode !== 'none'
              ? formatCurrency(summary.value)
              : '—'
          }
          hint="Only lots with measured weight and active pricing"
          icon={<CalculatorIcon width={17} height={17} />}
        />
      </div>

      {error && (
        <div className="alert alert-danger">
          <span className="flex-1">{error}</span>
          <Button variant="secondary" size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <Card className="flex items-center justify-center gap-3 p-16 text-sm text-muted">
          <Spinner size={16} /> Loading lots…
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon="📦"
            title="No lots yet"
            description="Create a lot to group predictions from one harvest, supplier, or grading session. You can add tray images to it in a batch."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setCreateOpen(true)}>
                  <PlusIcon width={16} height={16} /> Create a lot
                </Button>
                <Button variant="secondary" onClick={() => navigate('/upload')} disabled={!gradingOn}>
                  Batch upload
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((lot) => (
            <LotCard key={lot.id} lot={lot} />
          ))}
        </div>
      )}

      <div className="alert items-start text-[11px] leading-relaxed text-muted">
        <CalculatorIcon width={16} height={16} />
        <span>
          Lot totals require a measured/calibrated net lot weight and an active pricing mode.
          Average nut weight × detected count is shown only as a suggested weight estimate and is
          never used to claim a lot value.
        </span>
      </div>

      <Modal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        title="Create a lot"
        description="Measured net weight is optional now; you can record it later. Prices follow the administrator's active pricing policy."
        size="lg"
      >
        <form onSubmit={createLot} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              id="lot-name"
              label="Lot name *"
              placeholder="e.g. Sirsi estate — October harvest"
              value={form.name}
              maxLength={80}
              onChange={(event) => updateForm('name', event.target.value)}
              autoFocus
            />
            <TextField
              id="lot-reference"
              label="Reference"
              placeholder="e.g. LOT-2026-014"
              value={form.reference}
              maxLength={80}
              onChange={(event) => updateForm('reference', event.target.value)}
            />
            <TextField
              id="lot-supplier"
              label="Supplier / estate"
              placeholder="Optional"
              value={form.supplier}
              maxLength={80}
              onChange={(event) => updateForm('supplier', event.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              id="lot-weight"
              label="Average nut weight (g)"
              type="number"
              min="0"
              max="1000"
              step="0.01"
              placeholder="e.g. 8.5"
              hint="A suggested estimate for reference only. It does not create a priced lot total."
              value={form.avgNutWeightG}
              onChange={(event) => updateForm('avgNutWeightG', event.target.value)}
            />
            <TextField
              id="lot-measured-weight"
              label="Measured net lot weight (kg)"
              type="number"
              min="0"
              max="1000000"
              step="0.001"
              placeholder="e.g. 12.5"
              hint="Required before per-kg or per-quintal pricing can produce a lot total."
              value={form.measuredWeightKg}
              onChange={(event) => updateForm('measuredWeightKg', event.target.value)}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="lot-notes">
              Notes
            </label>
            <textarea
              id="lot-notes"
              className="input min-h-20"
              maxLength={500}
              placeholder="Optional grading notes, moisture, location, buyer…"
              value={form.notes}
              onChange={(event) => updateForm('notes', event.target.value)}
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? <Spinner size={15} /> : <PlusIcon width={16} height={16} />}
              {creating ? 'Creating…' : 'Create lot'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
