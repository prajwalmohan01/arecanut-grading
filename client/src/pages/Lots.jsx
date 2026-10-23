import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import API, { apiErrorMessage } from '../api/axios';
import { useToast } from '../context/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import StatCard from '../components/ui/StatCard';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import Modal from '../components/ui/Modal';
import { TextField, SelectField } from '../components/ui/Field';
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
} from '../utils/format';

const EMPTY_FORM = {
  name: '',
  reference: '',
  supplier: '',
  currency: 'INR',
  avgNutWeightG: '',
  priceA: '',
  priceB: '',
  priceC: '',
  priceD: '',
  notes: '',
};

function LotCard({ lot }) {
  const totals = lot.totals || {};
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
          <p className="mt-0.5 text-sm font-bold text-main">{formatNumber(totals.totalNuts || 0)}</p>
        </div>
        <div className="rounded-2xl bg-[color:var(--panel-soft)] p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted">Weight</p>
          <p className="mt-0.5 text-sm font-bold text-main">
            {formatWeightKg(lot.valuation?.totalWeightKg)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <GradeBadge grade="Grade A" />
        <span className="text-xs text-muted">{formatNumber(totals.gradeCounts?.A || 0)}</span>
        <GradeBadge grade="Grade B" />
        <span className="text-xs text-muted">{formatNumber(totals.gradeCounts?.B || 0)}</span>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3 border-t border-[color:var(--border)] pt-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted">Estimated value</p>
          <p className="mt-0.5 font-display text-xl font-bold text-main">
            {formatCurrency(lot.valuation?.totalValue, lot.currency)}
          </p>
        </div>
        <Link
          to={`/lots/${lot.id}`}
          className="btn-secondary btn-sm"
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
        currency: form.currency,
        avgNutWeightG: Number(form.avgNutWeightG) || 0,
        prices: {
          A: Number(form.priceA) || 0,
          B: Number(form.priceB) || 0,
          C: Number(form.priceC) || 0,
          D: Number(form.priceD) || 0,
        },
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
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-2xl font-semibold text-main">Lots &amp; batches</h2>
          <p className="mt-1 text-sm text-muted">
            Group tray predictions into a lot, then estimate its weight and value from your own
            price assumptions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigate('/upload')}>
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
          value={formatNumber(summary.nuts)}
          hint="Across every lot"
          tone="b"
        />
        <StatCard
          label="Estimated value"
          value={formatCurrency(summary.value)}
          hint="Only where prices and weight are set"
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
                <Button variant="secondary" onClick={() => navigate('/upload')}>
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
          Lot values are indicative estimates: detected nut counts × your average nut weight × your
          price per kg. The model measures image-space boxes only, so weight is not measured by the
          app.
        </span>
      </div>

      <Modal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        title="Create a lot"
        description="Prices and average weight are optional now; you can edit them later on the lot page."
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
            <SelectField
              id="lot-currency"
              label="Currency"
              value={form.currency}
              onChange={(event) => updateForm('currency', event.target.value)}
            >
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
              <option value="LKR">LKR (Rs)</option>
              <option value="NPR">NPR (Rs)</option>
            </SelectField>
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
              hint="An assumption used for the weight and value estimate."
              value={form.avgNutWeightG}
              onChange={(event) => updateForm('avgNutWeightG', event.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              {['A', 'B', 'C', 'D'].map((letter) => (
                <TextField
                  key={letter}
                  id={`lot-price-${letter}`}
                  label={`Grade ${letter} price / kg`}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0"
                  value={form[`price${letter}`]}
                  onChange={(event) => updateForm(`price${letter}`, event.target.value)}
                />
              ))}
            </div>
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
