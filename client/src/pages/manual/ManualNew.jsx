import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import API, { apiErrorMessage } from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import { TextField, SelectField } from '../../components/ui/Field';
import { ManualGradeBadge } from '../../components/manual/ManualBadges';
import QualityPanel from '../../components/manual/QualityPanel';
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckIcon,
  ImageIcon,
  LayersIcon,
  PlusIcon,
  TrashIcon,
  UploadIcon,
} from '../../components/Icons';
import { inspectImageFile } from '../../utils/imageQuality';
import {
  MANUAL_GRADE_OPTIONS,
  formatManualDateTimeInput,
  todayInputValue,
} from '../../utils/manual';
import {
  formatDateTime,
  formatNumber,
  formatWeightKg,
} from '../../utils/format';

function newRecordForm(user) {
  return {
    batch: '',
    sampleCode: '',
    grade: '',
    status: 'completed',
    quantity: '',
    weightKg: '',
    sizeMm: '',
    appearance: '',
    gradedAt: formatManualDateTimeInput(),
    reviewerName: user?.displayName || user?.username || '',
    observations: '',
    notes: '',
  };
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

export default function ManualNew() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef(null);
  const [form, setForm] = useState(() => newRecordForm(user));
  const [batches, setBatches] = useState([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [quality, setQuality] = useState(null);
  const [checkingImage, setCheckingImage] = useState(false);
  const [imageError, setImageError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState(null);
  const [batchModal, setBatchModal] = useState(false);
  const [batchForm, setBatchForm] = useState(newBatchForm);
  const [batchSaving, setBatchSaving] = useState(false);

  const selectedBatch = useMemo(
    () => batches.find((batch) => batch.id === form.batch) || null,
    [batches, form.batch]
  );
  const preselectedBatch = searchParams.get('batch');

  useEffect(() => {
    let alive = true;
    setBatchesLoading(true);
    API.get('/manual/batches', { params: { limit: 100, sort: 'newest' } })
      .then((response) => {
        if (!alive) return;
        const items = response.data.items || [];
        setBatches(items);
        if (preselectedBatch && items.some((batch) => batch.id === preselectedBatch)) {
          setForm((current) => ({ ...current, batch: preselectedBatch }));
        }
      })
      .catch((err) => {
        if (alive) toast.error(apiErrorMessage(err, 'Could not load batches.'));
      })
      .finally(() => {
        if (alive) setBatchesLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedBatch]);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview]
  );

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleFile(selected) {
    if (!selected) return;
    setImageError('');
    setCheckingImage(true);
    try {
      const result = await inspectImageFile(selected);
      setFile(selected);
      setQuality(result);
      setPreview(URL.createObjectURL(selected));
    } catch (error) {
      setFile(null);
      setQuality(null);
      setPreview('');
      setImageError(error.message || 'The image could not be checked.');
    } finally {
      setCheckingImage(false);
    }
  }

  function clearImage() {
    setFile(null);
    setQuality(null);
    setPreview('');
    setImageError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function saveRecord({ allowDuplicate = false, addAnother = false } = {}) {
    if (!file) {
      setImageError('Choose a grading image before saving.');
      return;
    }
    if (form.status === 'completed' && !form.grade) {
      toast.error('Select Grade A or Grade B before saving a completed record.');
      return;
    }
    if (checkingImage) {
      toast.info('Wait for the image check to finish.');
      return;
    }

    setSaving(true);
    try {
      const payload = new FormData();
      payload.append('image', file);
      payload.append('batch', form.batch || '');
      payload.append('sampleCode', form.sampleCode);
      payload.append('grade', form.grade);
      payload.append('status', form.status);
      payload.append('quantity', form.quantity);
      payload.append('weightKg', form.weightKg);
      payload.append('sizeMm', form.sizeMm);
      payload.append('appearance', form.appearance);
      payload.append('gradedAt', form.gradedAt);
      payload.append('reviewerName', form.reviewerName);
      payload.append('observations', form.observations);
      payload.append('notes', form.notes);
      if (quality) payload.append('imageQuality', JSON.stringify(quality));
      if (allowDuplicate) payload.append('allowDuplicate', 'true');

      const response = await API.post('/manual/records', payload);
      const record = response.data.record;
      setDuplicate(null);

      if (addAnother) {
        toast.success(`Saved ${record.reportId}. Ready for the next sample.`);
        setForm((current) => ({
          ...newRecordForm(user),
          batch: current.batch,
          reviewerName: current.reviewerName,
          gradedAt: formatManualDateTimeInput(),
          status: current.status,
        }));
        clearImage();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        toast.success(`Manual grading record ${record.reportId} saved.`);
        navigate(`/manual/records/${record.id}`);
      }
    } catch (error) {
      if (error.response?.status === 409 && error.response.data?.duplicate) {
        setDuplicate(error.response.data.duplicate);
      } else {
        toast.error(apiErrorMessage(error, 'Could not save this manual grading record.'));
      }
    } finally {
      setSaving(false);
    }
  }

  async function createBatch(event) {
    event.preventDefault();
    if (!batchForm.name.trim()) {
      toast.error('Enter a batch name.');
      return;
    }
    setBatchSaving(true);
    try {
      const response = await API.post('/manual/batches', {
        ...batchForm,
        targetSamples: batchForm.targetSamples || null,
        targetWeightKg: batchForm.targetWeightKg || null,
      });
      const batch = response.data.batch;
      setBatches((current) => [batch, ...current]);
      setForm((current) => ({ ...current, batch: batch.id }));
      setBatchModal(false);
      setBatchForm(newBatchForm());
      toast.success(`Batch ${batch.batchId} created and selected.`);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Could not create the batch.'));
    } finally {
      setBatchSaving(false);
    }
  }

  const steps = [
    { label: 'Photo', done: Boolean(file), required: true },
    { label: 'Batch', done: Boolean(form.batch), optional: true },
    { label: 'Grade', done: Boolean(form.grade), required: true },
    { label: 'Details', done: Boolean(form.reviewerName) && Boolean(form.quantity || form.weightKg) },
  ];
  const stepProgress = Math.round(
    (steps.filter((step) => step.done).length / steps.length) * 100
  );

  return (
    <>
      <form onSubmit={(event) => { event.preventDefault(); saveRecord(); }} className="space-y-5">
        <Card className="p-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div>
              <Link to="/manual" className="link inline-flex items-center gap-1.5 text-xs">
                <ArrowLeftIcon width={14} height={14} /> Manual overview
              </Link>
              <h2 className="mt-2 font-display text-2xl font-semibold text-main">
                Add a manual grading record
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
                Choose Grade A or Grade B yourself, add a clear photo, and save only the details
                you actually know. The application never predicts a grade.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="a">Manual grade</Badge>
              <Badge tone="neutral">A / B only</Badge>
              <Badge tone="neutral">No automated inference</Badge>
            </div>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-4">
            {steps.map((step, index) => (
              <div
                key={step.label}
                className={`stepper-step ${step.done ? 'complete' : ''}`}
              >
                <span className="stepper-dot">
                  {step.done ? <CheckIcon width={12} height={12} /> : index + 1}
                </span>
                <div>
                  <p className="text-xs font-semibold text-main">{step.label}</p>
                  <p className="text-[10px] text-muted">
                    {step.done ? 'Ready' : step.optional ? 'Optional' : 'Needed'}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="progress-track mt-3">
            <div className="progress-bar" style={{ width: `${stepProgress}%` }} />
          </div>
        </Card>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-5">
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="section-label">Step 1 · optional</p>
                  <h3 className="mt-1 font-display text-xl font-semibold text-main">
                    Select a batch
                  </h3>
                  <p className="mt-1 text-xs text-muted">
                    A batch keeps samples from one collection together. You can save without one.
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setBatchModal(true)}>
                  <PlusIcon width={14} height={14} /> New batch
                </Button>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <SelectField
                  id="manual-batch"
                  label="Batch"
                  value={form.batch}
                  onChange={(event) => update('batch', event.target.value)}
                  disabled={batchesLoading}
                >
                  <option value="">No batch</option>
                  {batches.map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      {batch.name} · {batch.batchId}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  id="manual-sample-code"
                  label="Sample code (optional)"
                  value={form.sampleCode}
                  onChange={(event) => update('sampleCode', event.target.value)}
                  placeholder="e.g. SAMPLE-01"
                  maxLength={80}
                  hint="Use a short reference that helps you find this sample later."
                />
              </div>

              {batchesLoading && (
                <p className="mt-3 flex items-center gap-2 text-xs text-muted">
                  <Spinner size={13} /> Loading batches…
                </p>
              )}

              {selectedBatch && (
                <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-main">{selectedBatch.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted">{selectedBatch.batchId}</p>
                    </div>
                    <Badge tone={selectedBatch.status === 'completed' ? 'a' : 'b'}>
                      {selectedBatch.status === 'completed' ? 'Batch complete' : 'Batch open'}
                    </Badge>
                  </div>
                  <p className="mt-2 text-[11px] text-muted">
                    {formatNumber(selectedBatch.stats?.totalRecords || 0)} saved records ·{' '}
                    {formatWeightKg(selectedBatch.stats?.totalWeightKg || 0)} recorded
                    {selectedBatch.targetSamples
                      ? ` · target ${formatNumber(selectedBatch.targetSamples)} samples`
                      : ''}
                  </p>
                </div>
              )}
            </Card>

            <Card className="p-5">
              <div>
                <p className="section-label">Step 2 · required</p>
                <h3 className="mt-1 font-display text-xl font-semibold text-main">
                  Add a grading photo
                </h3>
                <p className="mt-1 text-xs text-muted">
                  Use an original JPEG, PNG, or WebP image up to 10 MB. The upload check is
                  advisory and never affects the grade.
                </p>
              </div>

              <input
                ref={fileInputRef}
                id="manual-image-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => handleFile(event.target.files?.[0])}
              />

              {preview ? (
                <div className="mt-4 overflow-hidden rounded-2xl border border-[color:var(--border)]">
                  <div className="relative bg-[color:var(--panel-soft)]">
                    <img
                      src={preview}
                      alt="Selected arecanut grading preview"
                      className="max-h-[30rem] w-full object-contain"
                    />
                    <div className="absolute right-2 top-2 flex max-w-[calc(100%-1rem)] flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Replace
                      </Button>
                      <Button type="button" variant="danger" size="sm" onClick={clearImage}>
                        <TrashIcon width={14} height={14} /> Remove
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-main">{file?.name}</p>
                      <p className="text-[11px] text-muted">
                        {file ? `${(file.size / (1024 * 1024)).toFixed(2)} MB` : ''}
                        {quality?.width ? ` · ${formatNumber(quality.width)} × ${formatNumber(quality.height)} px` : ''}
                      </p>
                    </div>
                    {checkingImage ? (
                      <span className="flex items-center gap-2 text-xs text-muted">
                        <Spinner size={13} /> Checking image…
                      </span>
                    ) : (
                      <Badge tone={quality?.warnings?.length ? 'b' : 'a'}>
                        {quality?.warnings?.length
                          ? `${quality.warnings.length} advisory warning${quality.warnings.length === 1 ? '' : 's'}`
                          : 'Upload checked'}
                      </Badge>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    handleFile(event.dataTransfer.files?.[0]);
                  }}
                  className={`mt-4 flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
                    dragging
                      ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)]'
                      : 'border-[color:var(--border-strong)] bg-[color:var(--panel-soft)] hover:border-[color:var(--accent)]'
                  }`}
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--panel-strong)] text-accent">
                    {checkingImage ? <Spinner size={22} /> : <ImageIcon width={24} height={24} />}
                  </span>
                  <span className="mt-3 text-sm font-semibold text-main">
                    {checkingImage ? 'Checking image…' : 'Drop a photo here or choose a file'}
                  </span>
                  <span className="mt-1 text-xs text-muted">JPEG, PNG, or WebP · up to 10 MB</span>
                </button>
              )}

              {imageError && (
                <div className="alert alert-danger mt-3">
                  <AlertIcon width={16} height={16} />
                  <p className="flex-1">{imageError}</p>
                </div>
              )}

              {quality && <QualityPanel quality={quality} className="mt-3" />}
            </Card>

            <Card className="p-5">
              <div>
                <p className="section-label">Step 3 · required for completed records</p>
                <h3 className="mt-1 font-display text-xl font-semibold text-main">
                  Choose the manual grade
                </h3>
                <p className="mt-1 text-xs text-muted">
                  Make the judgement yourself. Grade C and Grade D are intentionally not offered
                  in the manual workflow because only A and B are supported here.
                </p>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {MANUAL_GRADE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`grade-option ${form.grade === option.value ? 'selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="manual-grade"
                      value={option.value}
                      checked={form.grade === option.value}
                      onChange={() => update('grade', option.value)}
                      className="sr-only"
                    />
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <ManualGradeBadge grade={option.value} />
                        <p className="mt-2 text-sm font-semibold text-main">{option.label}</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted">{option.description}</p>
                      </div>
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          form.grade === option.value
                            ? 'border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--accent-contrast)]'
                            : 'border-[color:var(--border-strong)]'
                        }`}
                      >
                        {form.grade === option.value && <CheckIcon width={12} height={12} />}
                      </span>
                    </div>
                  </label>
                ))}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => update('status', 'completed')}
                  className={`grade-option text-left ${form.status === 'completed' ? 'selected' : ''}`}
                >
                  <p className="text-sm font-semibold text-main">Save as completed</p>
                  <p className="mt-1 text-xs text-muted">Ready for review and reporting.</p>
                </button>
                <button
                  type="button"
                  onClick={() => update('status', 'draft')}
                  className={`grade-option text-left ${form.status === 'draft' ? 'selected' : ''}`}
                >
                  <p className="text-sm font-semibold text-main">Save as draft</p>
                  <p className="mt-1 text-xs text-muted">Keep it in progress and resume later.</p>
                </button>
              </div>
            </Card>

            <Card className="p-5">
              <div>
                <p className="section-label">Step 4 · add what you know</p>
                <h3 className="mt-1 font-display text-xl font-semibold text-main">
                  Record details
                </h3>
                <p className="mt-1 text-xs text-muted">
                  Leave a field blank if it was not measured. Blank values stay blank — the
                  application does not estimate them.
                </p>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <TextField
                  id="manual-quantity"
                  label="Quantity / nut count"
                  type="number"
                  min="1"
                  step="1"
                  value={form.quantity}
                  onChange={(event) => update('quantity', event.target.value)}
                  placeholder="e.g. 120"
                  hint="Whole number of nuts or samples assessed."
                />
                <TextField
                  id="manual-weight"
                  label="Weight (kg)"
                  type="number"
                  min="0.000001"
                  step="0.001"
                  value={form.weightKg}
                  onChange={(event) => update('weightKg', event.target.value)}
                  placeholder="e.g. 2.450"
                  hint="Only enter a weight you actually measured."
                />
                <TextField
                  id="manual-size"
                  label="Average size (mm, optional)"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={form.sizeMm}
                  onChange={(event) => update('sizeMm', event.target.value)}
                  placeholder="e.g. 28.5"
                />
                <TextField
                  id="manual-appearance"
                  label="Visual condition (optional)"
                  value={form.appearance}
                  onChange={(event) => update('appearance', event.target.value)}
                  placeholder="e.g. Clean, dry, uniform colour"
                  maxLength={200}
                />
                <TextField
                  id="manual-graded-at"
                  label="Grading date & time"
                  type="datetime-local"
                  value={form.gradedAt}
                  onChange={(event) => update('gradedAt', event.target.value)}
                />
                <TextField
                  id="manual-reviewer"
                  label="Reviewer / grader"
                  value={form.reviewerName}
                  onChange={(event) => update('reviewerName', event.target.value)}
                  placeholder="Name of the person who graded"
                  maxLength={80}
                />
              </div>

              <div className="mt-4 grid gap-4">
                <div>
                  <label className="field-label" htmlFor="manual-observations">
                    Observations
                  </label>
                  <textarea
                    id="manual-observations"
                    className="input min-h-24 resize-y"
                    value={form.observations}
                    onChange={(event) => update('observations', event.target.value)}
                    maxLength={500}
                    placeholder="Visible condition, colour, defects, or other observations."
                  />
                  <p className="mt-1 text-right text-[11px] text-muted">
                    {form.observations.length}/500
                  </p>
                </div>
                <div>
                  <label className="field-label" htmlFor="manual-notes">
                    Additional notes
                  </label>
                  <textarea
                    id="manual-notes"
                    className="input min-h-24 resize-y"
                    value={form.notes}
                    onChange={(event) => update('notes', event.target.value)}
                    maxLength={1000}
                    placeholder="Any context that should stay with this record."
                  />
                  <p className="mt-1 text-right text-[11px] text-muted">{form.notes.length}/1000</p>
                </div>
              </div>
            </Card>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <Card className="p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-lg font-semibold text-main">Record summary</h3>
                <Badge tone={form.status === 'draft' ? 'b' : 'a'}>
                  {form.status === 'draft' ? 'Draft' : 'Completed'}
                </Badge>
              </div>

              <dl className="mt-4 space-y-2.5 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted">Grade</dt>
                  <dd><ManualGradeBadge grade={form.grade} /></dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted">Batch</dt>
                  <dd className="max-w-[14rem] text-right text-main">
                    {selectedBatch?.name || 'No batch'}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted">Sample</dt>
                  <dd className="max-w-[14rem] truncate text-right text-main">
                    {form.sampleCode || 'Not named'}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted">Quantity</dt>
                  <dd className="text-right text-main">
                    {form.quantity ? formatNumber(form.quantity) : 'Not entered'}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted">Weight</dt>
                  <dd className="text-right text-main">
                    {form.weightKg ? formatWeightKg(form.weightKg) : 'Not entered'}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted">Grading date</dt>
                  <dd className="max-w-[14rem] text-right text-main">
                    {form.gradedAt ? formatDateTime(form.gradedAt) : 'Now'}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-3">
                <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted">
                  <CheckIcon width={15} height={15} className="mt-0.5 shrink-0 text-accent" />
                  The grade is stored exactly as you selected it. This is not an automated prediction,
                  laboratory test, or officially accredited certificate.
                </p>
              </div>

              <Button
                type="submit"
                className="mt-4 w-full"
                disabled={saving || checkingImage}
              >
                {saving ? <Spinner size={15} /> : <CheckIcon width={16} height={16} />}
                {saving ? 'Saving record…' : 'Save manual record'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="mt-2 w-full"
                onClick={() => saveRecord({ addAnother: true })}
                disabled={saving || checkingImage}
              >
                <PlusIcon width={15} height={15} /> Save & add another
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="mt-2 w-full"
                onClick={() => navigate('/manual/records')}
                disabled={saving}
              >
                Cancel
              </Button>
            </Card>

            <Card className="p-4">
              <p className="section-label">Grading notes</p>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                Upload warnings are useful for improving photos, but they never decide the grade.
                Duplicate detection checks whether the exact same file has already been saved.
              </p>
              <Link to="/manual/records" className="link mt-3 inline-flex text-xs">
                Browse saved records
              </Link>
            </Card>
          </aside>
        </div>
      </form>

      <Modal
        open={Boolean(duplicate)}
        onClose={() => setDuplicate(null)}
        title="This exact image is already saved"
        description="The file matches an existing record byte-for-byte. Open the existing record, or intentionally save this as a separate record."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDuplicate(null)} disabled={saving}>
              Keep editing
            </Button>
            <Button
              onClick={() => {
                setDuplicate(null);
                saveRecord({ allowDuplicate: true });
              }}
              disabled={saving}
            >
              {saving ? <Spinner size={14} /> : 'Save as a new record'}
            </Button>
          </>
        }
      >
        {duplicate && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-3">
              <p className="text-sm font-semibold text-main">{duplicate.reportId}</p>
              <p className="mt-1 text-xs text-muted">
                {duplicate.sampleCode || 'No sample code'} ·{' '}
                {duplicate.batch?.name || 'No batch'} · {formatDateTime(duplicate.createdAt)}
              </p>
            </div>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => navigate(`/manual/records/${duplicate.id}`)}
            >
              Open existing record
            </Button>
            <p className="text-[11px] leading-relaxed text-muted">
              Duplicate detection compares the exact file content using SHA-256. Different photos
              of the same sample are not automatically considered duplicates.
            </p>
          </div>
        )}
      </Modal>

      <Modal
        open={batchModal}
        onClose={() => !batchSaving && setBatchModal(false)}
        title="Create a batch"
        description="Batches group samples from one collection and track genuine saved-record progress."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBatchModal(false)} disabled={batchSaving}>
              Cancel
            </Button>
            <Button onClick={createBatch} disabled={batchSaving}>
              {batchSaving ? <Spinner size={14} /> : <LayersIcon width={15} height={15} />}
              {batchSaving ? 'Creating…' : 'Create and select'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="quick-batch-name"
            label="Batch name"
            value={batchForm.name}
            onChange={(event) => setBatchForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="e.g. October farm collection"
            maxLength={80}
            className="sm:col-span-2"
            required
          />
          <TextField
            id="quick-batch-supplier"
            label="Supplier / collection (optional)"
            value={batchForm.supplier}
            onChange={(event) => setBatchForm((current) => ({ ...current, supplier: event.target.value }))}
            placeholder="e.g. North plot"
            maxLength={120}
          />
          <TextField
            id="quick-batch-date"
            label="Collection date"
            type="date"
            value={batchForm.collectionDate}
            onChange={(event) => setBatchForm((current) => ({ ...current, collectionDate: event.target.value }))}
          />
          <TextField
            id="quick-batch-target-samples"
            label="Target samples (optional)"
            type="number"
            min="1"
            step="1"
            value={batchForm.targetSamples}
            onChange={(event) => setBatchForm((current) => ({ ...current, targetSamples: event.target.value }))}
            placeholder="e.g. 100"
          />
          <TextField
            id="quick-batch-target-weight"
            label="Target weight kg (optional)"
            type="number"
            min="0.000001"
            step="0.001"
            value={batchForm.targetWeightKg}
            onChange={(event) => setBatchForm((current) => ({ ...current, targetWeightKg: event.target.value }))}
            placeholder="e.g. 25"
          />
          <div className="sm:col-span-2">
            <label className="field-label" htmlFor="quick-batch-notes">
              Notes (optional)
            </label>
            <textarea
              id="quick-batch-notes"
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
