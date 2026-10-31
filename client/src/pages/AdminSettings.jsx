import { useCallback, useEffect, useMemo, useState } from 'react';
import API, { apiErrorMessage } from '../api/axios';
import { usePolicy } from '../context/PolicyContext';
import { useToast } from '../context/ToastContext';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import { SelectField, TextField } from '../components/ui/Field';
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  ShieldCheckIcon,
  SparkIcon,
} from '../components/Icons';
import { formatDateTime, formatNumber } from '../utils/format';

const GRADE_LETTERS = ['A', 'B', 'C', 'D'];
const DEFECT_CATEGORIES = [
  ['blackSpots', 'Black spots', 'Dark spots or patches that may indicate surface defects or handling damage.'],
  ['cracks', 'Cracks', 'Visible splits, fissures, or broken areas on the nut surface.'],
  ['mold', 'Suspected mold', 'Mold-like growth or fuzz. This is never a confirmed fungal infection or fungus identification.'],
  ['discoloration', 'Discoloration', 'Abnormal colour change after accounting for natural variation, shadows, and highlights.'],
];
const UNITS = [
  ['per_kg', 'per kg'],
  ['per_quintal', 'per quintal'],
  ['per_nut', 'per nut'],
];

function ToggleRow({ id, label, description, checked, onChange, disabled = false, tone = 'default' }) {
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-start justify-between gap-4 rounded-2xl border p-3 transition ${
        checked ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)]' : 'border-[color:var(--border)] bg-[color:var(--panel-soft)]'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <span className="min-w-0">
        <span className={`block text-sm font-semibold ${tone === 'danger' ? 'text-danger' : 'text-main'}`}>
          {label}
        </span>
        {description && <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{description}</span>}
      </span>
      <input
        id={id}
        type="checkbox"
        className="mt-1 h-5 w-5 shrink-0 accent-[color:var(--accent)]"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
    </label>
  );
}

function StatusPill({ ok, children }) {
  return (
    <span className={`badge ${ok ? 'badge-a' : 'badge-invalid'} inline-flex items-center gap-1`}>
      {ok ? <CheckIcon width={11} height={11} /> : <AlertIcon width={11} height={11} />}
      {children}
    </span>
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export default function AdminSettings() {
  const toast = useToast();
  const { refresh: refreshPolicy } = usePolicy();
  const [settings, setSettings] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [geminiStatus, setGeminiStatus] = useState(null);
  const [marketStatus, setMarketStatus] = useState(null);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [refreshingMarket, setRefreshingMarket] = useState(false);

  const [predictions, setPredictions] = useState(null);
  const [defectsForm, setDefectsForm] = useState(null);
  const [geminiForm, setGeminiForm] = useState(null);
  const [pricingForm, setPricingForm] = useState(null);

  const adopt = useCallback((data, { keepDraft = false } = {}) => {
    if (data?.settings) {
      setSettings(data.settings);
      if (!keepDraft) {
        setPredictions(clone(data.settings.predictions));
        setDefectsForm(clone(data.settings.defects || { masterEnabled: false, categories: {} }));
        setGeminiForm(clone(data.settings.gemini));
        setPricingForm(clone(data.settings.pricing));
      }
    }
    if (data?.policy) setPolicy(data.policy);
    if (data?.gemini) setGeminiStatus(data.gemini);
    if (data?.market) setMarketStatus(data.market);
  }, []);

  const loadAudit = useCallback(async () => {
    try {
      const response = await API.get('/admin/audit', { params: { limit: 20 } });
      setAudit(response.data.items || []);
    } catch {
      setAudit([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await API.get('/admin/settings');
      adopt(response.data);
      await loadAudit();
      await refreshPolicy();
    } catch (err) {
      setError(apiErrorMessage(err, 'Unable to load administrator settings.'));
    } finally {
      setLoading(false);
    }
  }, [adopt, loadAudit, refreshPolicy]);

  useEffect(() => {
    load();
  }, [load]);

  const modelIssue = useMemo(() => {
    if (!predictions) return null;
    if (predictions.masterEnabled && (predictions.grades.C || predictions.grades.D) && !predictions.geminiEnabled) {
      return 'Grade C/D requires Extended Grading Analysis. Enable the Extended Analysis switch or turn C/D off.';
    }
    if (predictions.masterEnabled && !GRADE_LETTERS.some((letter) => predictions.grades[letter])) {
      return 'Enable at least one grade while master prediction is on.';
    }
    return null;
  }, [predictions]);

  const defectIssue = useMemo(() => {
    if (!defectsForm) return null;
    if (predictions?.masterEnabled && defectsForm.masterEnabled && !predictions?.geminiEnabled) {
      return 'Defect review is powered by the grading service. With Extended Grading Analysis off, enabled defect categories will show "Analysis unavailable" rather than "Not detected".';
    }
    if (predictions?.masterEnabled && defectsForm.masterEnabled) {
      const enabled = Object.values(defectsForm.categories || {}).filter(Boolean).length;
      if (enabled === 0) {
        return 'Enable at least one defect category, or turn master defect detection off.';
      }
    }
    return null;
  }, [defectsForm, predictions]);

  function patchPrediction(key, value) {
    setPredictions((current) => ({ ...current, [key]: value }));
  }

  function patchDefectMaster(value) {
    setDefectsForm((current) => ({ ...current, masterEnabled: value }));
  }

  function patchDefectCategory(key, value) {
    setDefectsForm((current) => ({
      ...current,
      categories: { ...(current?.categories || {}), [key]: value },
    }));
  }

  function patchGrade(letter, value) {
    setPredictions((current) => ({
      ...current,
      grades: { ...(current?.grades || {}), [letter]: value },
    }));
  }

  async function savePredictions() {
    if (!predictions) return;
    setSaving('predictions');
    try {
      const response = await API.put('/admin/settings/predictions', {
        masterEnabled: predictions.masterEnabled,
        grades: predictions.grades,
        geminiEnabled: predictions.geminiEnabled,
      });
      adopt(response.data);
      toast.success(response.data.message || 'Prediction switches saved.');
      await loadAudit();
      await refreshPolicy();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save prediction switches.'));
    } finally {
      setSaving('');
    }
  }

  async function saveDefects() {
    if (!defectsForm) return;
    setSaving('defects');
    try {
      const response = await API.put('/admin/settings/defects', {
        masterEnabled: defectsForm.masterEnabled,
        categories: defectsForm.categories,
      });
      adopt(response.data, { keepDraft: true });
      setDefectsForm(
        clone(
          response.data.settings.defects || {
            masterEnabled: false,
            categories: {},
          }
        )
      );
      toast.success(response.data.message || 'Defect detection switches saved.');
      await loadAudit();
      await refreshPolicy();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save defect detection switches.'));
    } finally {
      setSaving('');
    }
  }

  async function saveGemini() {
    if (!geminiForm) return;
    setSaving('gemini');
    try {
      const response = await API.put('/admin/settings/gemini', geminiForm);
      adopt(response.data, { keepDraft: true });
      setGeminiForm(clone(response.data.settings.gemini));
      toast.success(response.data.message || 'Extended Analysis settings saved.');
      await loadAudit();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save Extended Analysis settings.'));
    } finally {
      setSaving('');
    }
  }

  function patchManual(letter, key, value) {
    setPricingForm((current) => ({
      ...current,
      manual: {
        ...(current?.manual || {}),
        [letter]: {
          ...(current?.manual?.[letter] || { price: 0, unit: 'per_kg' }),
          [key]: value,
        },
      },
    }));
  }

  function patchLive(key, value) {
    setPricingForm((current) => ({
      ...current,
      live: { ...(current?.live || {}), [key]: value },
    }));
  }

  async function savePricing() {
    if (!pricingForm) return;
    setSaving('pricing');
    try {
      const manual = {};
      GRADE_LETTERS.forEach((letter) => {
        const item = pricingForm.manual?.[letter] || {};
        manual[letter] = {
          price: Number(item.price) || 0,
          unit: item.unit || 'per_kg',
        };
      });
      const response = await API.put('/admin/settings/pricing', {
        mode: pricingForm.mode,
        currency: pricingForm.currency,
        manual,
        live: pricingForm.live,
      });
      adopt(response.data, { keepDraft: true });
      setPricingForm(clone(response.data.settings.pricing));
      toast.success(response.data.message || 'Pricing settings saved.');
      await loadAudit();
      await refreshPolicy();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save pricing settings.'));
    } finally {
      setSaving('');
    }
  }

  async function refreshMarket() {
    setRefreshingMarket(true);
    try {
      const response = await API.post('/admin/market/refresh');
      setMarketStatus(response.data.market || null);
      if (response.data.market?.status === 'live') {
        toast.success(response.data.message || 'Live market quote refreshed.');
      } else {
        toast.info(response.data.market?.error || response.data.message || 'Live quote unavailable.');
      }
      const statusResponse = await API.get('/admin/settings');
      adopt(statusResponse.data, { keepDraft: true });
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not refresh the live market quote.'));
    } finally {
      setRefreshingMarket(false);
    }
  }

  if (loading) {
    return (
      <Card className="flex items-center justify-center gap-3 p-16 text-sm text-muted">
        <Spinner size={16} /> Loading administrator settings…
      </Card>
    );
  }

  if (error || !settings) {
    return (
      <Card className="p-6">
        <div className="alert alert-danger">
          <AlertIcon width={18} height={18} />
          <span className="flex-1">{error || 'Administrator settings are unavailable.'}</span>
          <Button variant="secondary" size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6 animate-in">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
              <ShieldCheckIcon width={14} height={14} /> Administrator controls
            </p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-main">
              Grading, Extended Analysis &amp; market policy
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
              Switches apply server-side to prediction responses, history, statistics, exports,
              lots, and PDF reports. Historical records remain stored unchanged.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span className="pill">Policy v{policy?.version || settings.version}</span>
            <span className="pill">{formatDateTime(settings.updatedAt)}</span>
          </div>
        </div>
        {policy && (
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusPill ok={policy.masterEnabled}>Master {policy.masterEnabled ? 'on' : 'off'}</StatusPill>
            <StatusPill ok={policy.enabledLetters?.length > 0}>
              Grades {policy.enabledLetters?.length ? policy.enabledLetters.join(' / ') : 'hidden'}
            </StatusPill>
            <StatusPill ok={policy.defectDetectionEnabled}>
              Defects {policy.defectDetectionEnabled ? 'on' : 'off'}
            </StatusPill>
            <StatusPill ok={policy.geminiEnabled}>Extended Analysis {policy.geminiEnabled ? 'on' : 'off'}</StatusPill>
            <StatusPill ok={policy.pricingMode !== 'none'}>
              Pricing {policy.pricingMode === 'none' ? 'off' : policy.pricingMode}
            </StatusPill>
          </div>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-5 animate-in">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-semibold text-main">Prediction switches</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Master off suppresses all grades, counts, percentages, confidence, defect sections,
                charts, pricing, and PDF grade sections.
              </p>
            </div>
            <SparkIcon width={20} height={20} />
          </div>

          <div className="mt-4 space-y-2">
            <ToggleRow
              id="master-prediction"
              label="Master prediction"
              description="Global switch for every automated grading output and price estimate."
              checked={predictions?.masterEnabled}
              onChange={(value) => patchPrediction('masterEnabled', value)}
              tone={predictions?.masterEnabled ? 'default' : 'danger'}
            />
            {GRADE_LETTERS.map((letter) => (
              <ToggleRow
                key={letter}
                id={`grade-${letter}`}
                label={`Grade ${letter}`}
                description={
                  letter === 'C' || letter === 'D'
                    ? 'No validated C/D detector is installed. This requires Extended Grading Analysis and still does not create per-nut counts.'
                    : 'Enabled grades are returned by the model and included in counts, pages, CSV, and PDFs.'
                }
                checked={predictions?.grades?.[letter]}
                onChange={(value) => patchGrade(letter, value)}
                disabled={!predictions?.masterEnabled}
              />
            ))}
            <ToggleRow
              id="gemini-assisted"
              label="Extended Grading Analysis"
              description="Advisory image-level review for C/D hints and enabled defect categories. This analysis is never used as an object detector and never creates counts or bounding boxes."
              checked={predictions?.geminiEnabled}
              onChange={(value) => patchPrediction('geminiEnabled', value)}
              disabled={!predictions?.masterEnabled}
            />
          </div>

          {modelIssue && (
            <div className="alert alert-warn mt-3 items-start text-xs">
              <AlertIcon width={15} height={15} />
              <span>{modelIssue}</span>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted">Settings are versioned and audited.</p>
            <Button onClick={savePredictions} disabled={saving === 'predictions' || Boolean(modelIssue)}>
              {saving === 'predictions' ? <Spinner size={14} /> : <CheckIcon width={15} height={15} />}
              {saving === 'predictions' ? 'Saving…' : 'Save switches'}
            </Button>
          </div>
        </Card>

        <Card className="p-5 animate-in">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-semibold text-main">Defect detection</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Extended analysis reviews the original uploaded image for visible defect appearance. Findings
                are image-level only and never downgrade a grade automatically.
              </p>
            </div>
            <span className={`badge ${policy?.defectDetectionEnabled ? 'badge-a' : 'badge-neutral'}`}>
              {policy?.defectDetectionEnabled ? 'Active' : 'Off'}
            </span>
          </div>

          <div className="mt-4 space-y-2">
            <ToggleRow
              id="master-defects"
              label="Master defect detection"
              description="Global switch for defect findings, explanations, history summaries, CSV columns, statistics, and PDF sections."
              checked={defectsForm?.masterEnabled}
              onChange={patchDefectMaster}
              disabled={!predictions?.masterEnabled}
              tone={defectsForm?.masterEnabled ? 'default' : 'danger'}
            />
            {DEFECT_CATEGORIES.map(([key, label, description]) => (
              <ToggleRow
                key={key}
                id={`defect-${key}`}
                label={label}
                description={description}
                checked={defectsForm?.categories?.[key]}
                onChange={(value) => patchDefectCategory(key, value)}
                disabled={!predictions?.masterEnabled || !defectsForm?.masterEnabled}
              />
            ))}
          </div>

          {defectIssue && (
            <div className="alert alert-warn mt-3 items-start text-xs">
              <AlertIcon width={15} height={15} />
              <span>{defectIssue}</span>
            </div>
          )}

          <div className="mt-3 rounded-2xl bg-[color:var(--panel-soft)] p-3 text-[11px] leading-relaxed text-muted">
            Extended analysis cannot establish verified affected-nut counts, defect locations, bounding boxes,
            or fungal confirmation. Those fields stay unavailable until a validated defect detector
            or segmentation model is installed. A failed analysis request is shown as “Analysis
            unavailable” with a retry action — never as “Not detected”.
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted">Changes apply server-side immediately.</p>
            <Button onClick={saveDefects} disabled={saving === 'defects'}>
              {saving === 'defects' ? <Spinner size={14} /> : <CheckIcon width={15} height={15} />}
              {saving === 'defects' ? 'Saving…' : 'Save defects'}
            </Button>
          </div>
        </Card>

        <Card className="p-5 animate-in">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-semibold text-main">Extended Grading Analysis</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Keys are read only from server environment variables and are never shown or
                written to the audit log. Used for C/D advisories and enabled defect categories.
              </p>
            </div>
            <span className={`badge ${geminiStatus?.configuredKeys > 0 ? 'badge-a' : 'badge-invalid'}`}>
              {geminiStatus?.configuredKeys || 0} key(s)
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <TextField
              id="gemini-model"
              label="Model"
              value={geminiForm?.model || ''}
              onChange={(event) => setGeminiForm({ ...geminiForm, model: event.target.value })}
              placeholder="gemini-3.5-flash"
              hint="Configured model identifier."
            />
            <TextField
              id="gemini-image-size"
              label="Input image max dimension (px)"
              type="number"
              min="256"
              max="4096"
              step="1"
              value={geminiForm?.imageMaxDimension ?? ''}
              onChange={(event) => setGeminiForm({ ...geminiForm, imageMaxDimension: event.target.value })}
            />
            <TextField
              id="gemini-timeout"
              label="Timeout (ms)"
              type="number"
              min="3000"
              max="120000"
              step="1000"
              value={geminiForm?.timeoutMs ?? ''}
              onChange={(event) => setGeminiForm({ ...geminiForm, timeoutMs: event.target.value })}
            />
            <TextField
              id="gemini-retries"
              label="Retries per key"
              type="number"
              min="0"
              max="5"
              step="1"
              value={geminiForm?.maxRetries ?? ''}
              onChange={(event) => setGeminiForm({ ...geminiForm, maxRetries: event.target.value })}
            />
          </div>

          <div className="mt-3 rounded-2xl bg-[color:var(--panel-soft)] p-3">
            <p className="text-[11px] font-semibold text-main">
              Supported env names: GEMINI_API_KEY, GEMINI_API_KEY_1 … GEMINI_API_KEY_10
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Keys are deduplicated and used with bounded failover. Cooldown:
              {' '}{geminiStatus?.coolingDownKeys || 0} key(s) cooling down ·{' '}
              {geminiStatus?.availableKeys || 0} available.
            </p>
            {Array.isArray(geminiStatus?.keys) && geminiStatus.keys.length > 0 && (
              <ul className="mt-2 space-y-1">
                {geminiStatus.keys.map((key) => (
                  <li key={key.label} className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted">
                    <span className="font-mono">{key.label} · {key.fingerprint}</span>
                    <span className={key.state === 'cooling_down' ? 'text-danger' : 'text-accent'}>
                      {key.state}
                      {key.lastError ? ` · ${key.lastError}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!geminiStatus?.configuredKeys && (
            <div className="alert alert-warn mt-3 items-start text-xs">
              <AlertIcon width={15} height={15} />
              <span>
                No grading service key is configured. Grade C/D review and defect analysis cannot run until
                a server-side service key is added and the backend is restarted.
              </span>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <Button onClick={saveGemini} disabled={saving === 'gemini'}>
              {saving === 'gemini' ? <Spinner size={14} /> : <CheckIcon width={15} height={15} />}
              {saving === 'gemini' ? 'Saving…' : 'Save Extended Analysis'}
            </Button>
          </div>
        </Card>
      </div>

      <Card className="p-5 animate-in">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h3 className="font-display text-lg font-semibold text-main">Pricing mode</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Live market and manual pricing are mutually exclusive. With neither active, the
              app returns no price estimates. Weight-based totals require measured net weight.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              ['none', 'Off'],
              ['manual', 'Manual'],
              ['live', 'Live market'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPricingForm((current) => ({ ...current, mode: value }))}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                  pricingForm?.mode === value
                    ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-accent'
                    : 'border-[color:var(--border)] text-muted hover:text-main'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.6fr)_minmax(0,1.4fr)]">
          <div className="space-y-3">
            <TextField
              id="pricing-currency"
              label="Currency"
              value={pricingForm?.currency || 'INR'}
              maxLength={8}
              onChange={(event) => setPricingForm({ ...pricingForm, currency: event.target.value.toUpperCase() })}
              hint="ISO-style code, e.g. INR."
            />
            <div className={`rounded-2xl p-3 text-[11px] leading-relaxed ${pricingForm?.mode === 'none' ? 'alert alert-warn' : 'bg-[color:var(--panel-soft)] text-muted'}`}>
              {pricingForm?.mode === 'none' &&
                'No pricing mode is active. All pricing cards and totals are hidden, including in PDFs.'}
              {pricingForm?.mode === 'manual' &&
                'Manual prices are administrator-entered estimates. They are not live mandi quotes.'}
              {pricingForm?.mode === 'live' &&
                'Live prices come from the AGMARKNET 2.0 public dashboard. Daily weighted-average quotes may lag the physical market; a data.gov.in key is only an optional fallback.'}
            </div>
            <div className="rounded-2xl bg-[color:var(--panel-soft)] p-3 text-[11px] leading-relaxed text-muted">
              Per-kg and per-quintal totals use measured net weight only. Per-nut totals may use
              enabled nut counts, and are labelled as estimates.
            </div>
          </div>

          {pricingForm?.mode === 'manual' && (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Grade</th>
                    <th>Price</th>
                    <th>Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {GRADE_LETTERS.map((letter) => (
                    <tr key={letter}>
                      <td className="font-semibold text-main">Grade {letter}</td>
                      <td>
                        <input
                          className="input !py-1.5"
                          type="number"
                          min="0"
                          max="10000000"
                          step="0.01"
                          value={pricingForm.manual?.[letter]?.price ?? 0}
                          onChange={(event) => patchManual(letter, 'price', event.target.value)}
                          aria-label={`Grade ${letter} price`}
                        />
                      </td>
                      <td>
                        <select
                          className="select !py-1.5"
                          value={pricingForm.manual?.[letter]?.unit || 'per_kg'}
                          onChange={(event) => patchManual(letter, 'unit', event.target.value)}
                          aria-label={`Grade ${letter} price unit`}
                        >
                          {UNITS.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pricingForm?.mode === 'live' && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  id="market-state"
                  label="State"
                  value={pricingForm.live?.state || ''}
                  onChange={(event) => patchLive('state', event.target.value)}
                  placeholder="e.g. Karnataka"
                />
                <TextField
                  id="market-district"
                  label="District"
                  value={pricingForm.live?.district || ''}
                  onChange={(event) => patchLive('district', event.target.value)}
                  placeholder="Optional"
                />
                <TextField
                  id="market-name"
                  label="Market"
                  value={pricingForm.live?.market || ''}
                  onChange={(event) => patchLive('market', event.target.value)}
                  placeholder="Optional"
                />
                <TextField
                  id="market-commodity"
                  label="Commodity"
                  value={pricingForm.live?.commodity || ''}
                  onChange={(event) => patchLive('commodity', event.target.value)}
                  placeholder="Arecanut(Betelnut/Supari)"
                />
                <TextField
                  id="market-variety"
                  label="Variety"
                  value={pricingForm.live?.variety || ''}
                  onChange={(event) => patchLive('variety', event.target.value)}
                  placeholder="Optional"
                />
                <TextField
                  id="market-grade"
                  label="Market grade filter"
                  value={pricingForm.live?.marketGrade || ''}
                  onChange={(event) => patchLive('marketGrade', event.target.value)}
                  placeholder="Optional"
                />
                <SelectField
                  id="market-price-field"
                  label="Quote field"
                  value={pricingForm.live?.priceField || 'modal'}
                  onChange={(event) => patchLive('priceField', event.target.value)}
                  hint="The public dashboard publishes weighted averages. Min/max need the optional data.gov.in fallback."
                >
                  <option value="modal">Modal / weighted average</option>
                  <option value="min">Minimum (fallback only)</option>
                  <option value="max">Maximum (fallback only)</option>
                </SelectField>
                <TextField
                  id="market-refresh"
                  label="Cache refresh (minutes)"
                  type="number"
                  min="15"
                  max="1440"
                  step="1"
                  value={pricingForm.live?.refreshMinutes ?? ''}
                  onChange={(event) => patchLive('refreshMinutes', event.target.value)}
                />
              </div>

              <div className="rounded-2xl bg-[color:var(--panel-soft)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-main">
                      {marketStatus?.source || 'AGMARKNET 2.0 public dashboard'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {marketStatus?.publicSource
                        ? 'Public dashboard · no API key required'
                        : marketStatus?.apiKeyConfigured
                          ? 'data.gov.in key configured'
                          : 'data.gov.in key not configured'}{' '}
                      · {marketStatus?.cache?.fresh ? 'fresh cache' : 'no fresh cache'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={refreshMarket}
                    disabled={refreshingMarket || marketStatus?.canRefresh === false}
                  >
                    {refreshingMarket ? <Spinner size={13} /> : <ClockIcon width={14} height={14} />}
                    {refreshingMarket ? 'Refreshing…' : 'Refresh live quote'}
                  </Button>
                </div>
                {marketStatus?.cache?.lastError && (
                  <p className="mt-2 text-[10px] text-danger">{marketStatus.cache.lastError}</p>
                )}
                {marketStatus?.canRefresh === false && (
                  <p className="mt-2 text-[10px] text-muted">
                    Set DATA_GOV_IN_API_KEY or AGMARKNET_API_KEY on the server for the selected
                    data.gov.in source. No price is invented without a quote.
                  </p>
                )}
                {marketStatus && !marketStatus.query?.state && !marketStatus.query?.market && (
                  <p className="mt-2 text-[10px] text-muted">
                    No state or market filter is selected. A refresh uses a nationwide median;
                    choose a state and market for a local quote.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={savePricing} disabled={saving === 'pricing'}>
            {saving === 'pricing' ? <Spinner size={14} /> : <CheckIcon width={15} height={15} />}
            {saving === 'pricing' ? 'Saving…' : 'Save pricing'}
          </Button>
        </div>
      </Card>

      {marketStatus?.cache && (
        <Card className="p-5 animate-in">
          <h3 className="font-display text-lg font-semibold text-main">Last market cache</h3>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl bg-[color:var(--panel-soft)] p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted">Fetched</p>
              <p className="mt-1 font-semibold text-main">{formatDateTime(marketStatus.cache.fetchedAt)}</p>
            </div>
            <div className="rounded-2xl bg-[color:var(--panel-soft)] p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted">Expires</p>
              <p className="mt-1 font-semibold text-main">{formatDateTime(marketStatus.cache.expiresAt)}</p>
            </div>
            <div className="rounded-2xl bg-[color:var(--panel-soft)] p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted">Records</p>
              <p className="mt-1 font-semibold text-main">{formatNumber(marketStatus.cache.recordCount)}</p>
            </div>
            <div className="rounded-2xl bg-[color:var(--panel-soft)] p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted">Source</p>
              <p className="mt-1 font-semibold text-main">AGMARKNET</p>
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden animate-in">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border)] px-5 py-4">
          <div>
            <h3 className="font-display text-lg font-semibold text-main">Administrator audit</h3>
            <p className="text-xs text-muted">The 20 most recent settings changes. Secrets are never stored.</p>
          </div>
          <span className="pill">{audit.length} entries</span>
        </div>
        {audit.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">No settings changes recorded yet.</p>
        ) : (
          <div className="divide-y divide-[color:var(--border)]">
            {audit.map((entry) => (
              <div key={entry._id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-main">{entry.summary}</p>
                  <p className="mt-0.5 text-[10px] text-muted">
                    {entry.action} · {entry.admin?.displayName || entry.admin?.username || 'admin'}
                    {entry.ip ? ` · ${entry.ip}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] text-muted">{formatDateTime(entry.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="alert items-start text-[11px] leading-relaxed text-muted">
        <AlertIcon width={16} height={16} />
        <span>
          C/D grades are not supported by the bundled two-class model and cannot be counted.
          Extended analysis output is advisory image-level review only. Defect locations, verified
          affected-nut counts, and fungal confirmation require a validated detector and are never
          invented. Market quotes are daily AGMARKNET values and not a guaranteed transaction
          price. Prices and estimates are never shown while pricing is off.
        </span>
      </div>
    </div>
  );
}
