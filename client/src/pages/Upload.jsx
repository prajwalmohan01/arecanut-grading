import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import API, { apiErrorMessage } from '../api/axios';
import { useToast } from '../context/ToastContext';
import { usePolicy } from '../context/PolicyContext';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import Spinner from '../components/ui/Spinner';
import CameraCapture from '../components/CameraCapture';
import PolicyNotice from '../components/PolicyNotice';
import {
  AlertIcon,
  CameraIcon,
  CheckIcon,
  CloseIcon,
  LayersIcon,
  SparkIcon,
  TrashIcon,
  UploadIcon,
} from '../components/Icons';
import { formatCurrency, formatNumber } from '../utils/format';

const ACCEPTED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 30;

function validateFile(file) {
  if (!file) return 'Choose an image first.';
  if (!ACCEPTED.includes(String(file.type).toLowerCase())) {
    return 'Only JPEG, PNG, or WebP images are accepted.';
  }
  if (file.size > MAX_BYTES) {
    return 'The image is larger than 10 MB. Compress or resize it and try again.';
  }
  if (file.size === 0) return 'The selected file is empty.';
  return '';
}

function defaultLotName() {
  return `Batch ${new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function fileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function StatusPill({ item }) {
  if (item.status === 'done') {
    return (
      <span className="badge badge-a inline-flex items-center gap-1">
        <CheckIcon width={11} height={11} /> Done
      </span>
    );
  }
  if (item.status === 'error') {
    return <span className="badge badge-invalid">Failed</span>;
  }
  if (item.status === 'cancelled') {
    return <span className="badge badge-neutral">Cancelled</span>;
  }
  if (item.status === 'uploading') {
    return (
      <span className="badge badge-b inline-flex items-center gap-1">
        <Spinner size={10} /> {item.pct < 100 ? 'Uploading' : 'Analysing'}
      </span>
    );
  }
  return <span className="badge badge-neutral">Queued</span>;
}

export default function Upload() {
  const navigate = useNavigate();
  const toast = useToast();
  const { policy } = usePolicy();
  const gradingOn = policy?.masterEnabled !== false;
  const [searchParams] = useSearchParams();
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const previewUrlsRef = useRef(new Set());
  const cancelRef = useRef(false);

  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [lots, setLots] = useState([]);
  const [lotsLoading, setLotsLoading] = useState(true);
  const [lotChoice, setLotChoice] = useState('');
  const [newLotName, setNewLotName] = useState(defaultLotName);

  const requestedLot = searchParams.get('lot') || '';

  useEffect(
    () => () => {
      if (abortRef.current) abortRef.current.abort();
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
    },
    []
  );

  useEffect(() => {
    let alive = true;
    setLotsLoading(true);
    API.get('/lots')
      .then((response) => {
        if (!alive) return;
        const items = response.data.items || [];
        setLots(items);
        if (requestedLot && items.some((lot) => lot.id === requestedLot)) {
          setLotChoice(requestedLot);
        }
      })
      .catch(() => {
        if (alive) setLots([]);
      })
      .finally(() => {
        if (alive) setLotsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [requestedLot]);

  useEffect(() => {
    if (files.length > 1 && !lotChoice) setLotChoice('new');
  }, [files.length, lotChoice]);

  const selectedLot = lots.find((lot) => lot.id === lotChoice) || null;
  const batchMode = files.length > 1;
  const finishedCount = files.filter((item) =>
    ['done', 'error', 'cancelled'].includes(item.status)
  ).length;
  const successCount = files.filter((item) => item.status === 'done').length;
  const failedCount = files.filter((item) => item.status === 'error').length;
  const overallPct = files.length ? Math.round((finishedCount / files.length) * 100) : 0;

  function updateItem(id, patch) {
    setFiles((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  function addFiles(list) {
    if (processing) return;
    const incoming = Array.from(list || []);
    if (incoming.length === 0) return;

    setError('');
    const existing = new Set(files.map((item) => fileKey(item.file)));
    const accepted = [];
    const rejected = [];
    const duplicates = [];

    incoming.forEach((file) => {
      const validation = validateFile(file);
      if (validation) {
        rejected.push(`${file.name}: ${validation}`);
        return;
      }
      const key = fileKey(file);
      if (existing.has(key)) {
        duplicates.push(file.name);
        return;
      }
      existing.add(key);
      const preview = URL.createObjectURL(file);
      previewUrlsRef.current.add(preview);
      accepted.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        preview,
        status: 'queued',
        pct: 0,
        error: '',
        scan: null,
      });
    });

    const room = Math.max(0, MAX_FILES - files.length);
    if (accepted.length > room) {
      accepted.slice(room).forEach((item) => URL.revokeObjectURL(item.preview));
      toast.info(`A batch is limited to ${MAX_FILES} images.`);
      accepted.length = room;
    }

    if (accepted.length > 0) {
      setFiles((current) => [...current, ...accepted]);
    }
    if (duplicates.length > 0) {
      toast.info(
        duplicates.length === 1
          ? `"${duplicates[0]}" is already in the queue.`
          : `${duplicates.length} duplicate images were skipped.`
      );
    }
    if (rejected.length > 0) {
      setError(rejected[0]);
    }
  }

  function removeItem(id) {
    if (processing) return;
    setFiles((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.preview) {
        URL.revokeObjectURL(target.preview);
        previewUrlsRef.current.delete(target.preview);
      }
      return current.filter((item) => item.id !== id);
    });
    if (inputRef.current) inputRef.current.value = '';
  }

  function clearAll() {
    if (processing) return;
    files.forEach((item) => {
      if (item.preview) {
        URL.revokeObjectURL(item.preview);
        previewUrlsRef.current.delete(item.preview);
      }
    });
    setFiles([]);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  function onDrop(event) {
    event.preventDefault();
    setDragging(false);
    if (processing) return;
    addFiles(event.dataTransfer.files);
  }

  async function createLotForBatch() {
    const name = newLotName.trim() || defaultLotName();
    const response = await API.post('/lots', { name });
    return response.data.lot;
  }

  async function submit(event) {
    event?.preventDefault();
    if (!gradingOn) {
      setError('AI grading is disabled by the administrator. Predictions are not run while master prediction is off.');
      return;
    }
    if (files.length === 0) {
      setError('Add at least one image.');
      return;
    }
    if (batchMode && lotsLoading) {
      setError('Still loading your lots. Try again in a moment.');
      return;
    }
    if (batchMode && !lotChoice) {
      setError('Choose an existing lot or create a new lot for this batch.');
      return;
    }

    setError('');
    setProcessing(true);
    cancelRef.current = false;
    setFiles((current) =>
      current.map((item) => ({ ...item, status: 'queued', pct: 0, error: '', scan: null }))
    );

    const queue = files;
    let targetLotId = null;
    let createdLotId = null;

    try {
      if (lotChoice === 'new') {
        const lot = await createLotForBatch();
        targetLotId = lot.id;
        createdLotId = lot.id;
        setLots((current) => [lot, ...current]);
      } else if (lotChoice) {
        targetLotId = lotChoice;
      }
    } catch (err) {
      const message = apiErrorMessage(err, 'Could not create the lot.');
      setError(message);
      toast.error(message);
      setProcessing(false);
      return;
    }

    const failures = [];
    const successes = [];

    for (let index = 0; index < queue.length; index += 1) {
      if (cancelRef.current) break;
      const item = queue[index];
      updateItem(item.id, { status: 'uploading', pct: 0 });

      try {
        const formData = new FormData();
        formData.append('file', item.file);
        if (targetLotId) formData.append('lotId', targetLotId);

        const controller = new AbortController();
        abortRef.current = controller;

        const response = await API.post('/scans/predict', formData, {
          signal: controller.signal,
          onUploadProgress: (progressEvent) => {
            if (!progressEvent.total) return;
            const pct = Math.min(
              100,
              Math.round((progressEvent.loaded / progressEvent.total) * 100)
            );
            updateItem(item.id, { pct });
          },
        });

        const scan = response.data.scan;
        successes.push(scan);
        updateItem(item.id, { status: 'done', pct: 100, scan });
      } catch (err) {
        if (err?.code === 'ERR_CANCELED' || cancelRef.current) {
          updateItem(item.id, { status: 'cancelled', pct: 0 });
        } else {
          const message = apiErrorMessage(err, 'Prediction failed. Please try again.');
          failures.push(`${item.file.name}: ${message}`);
          updateItem(item.id, { status: 'error', error: message });
        }
      } finally {
        abortRef.current = null;
      }
    }

    const wasCancelled = cancelRef.current;
    if (wasCancelled) {
      setFiles((current) =>
        current.map((item) =>
          item.status === 'queued' ? { ...item, status: 'cancelled' } : item
        )
      );
    }

    setProcessing(false);

    if (successes.length === 0) {
      if (createdLotId) {
        // Do not leave an empty lot behind when the whole batch failed.
        API.delete(`/lots/${createdLotId}`).catch(() => {});
        setLots((current) => current.filter((lot) => lot.id !== createdLotId));
      }
      if (!wasCancelled) {
        const message =
          failures[0] || 'No images could be graded. Check the queue messages and try again.';
        setError(message);
        toast.error(message);
      } else {
        toast.info('Batch cancelled.');
      }
      return;
    }

    if (wasCancelled) {
      toast.info(`Stopped. ${successes.length} image(s) were graded.`);
    } else if (failures.length > 0) {
      toast.info(`${successes.length} graded, ${failures.length} failed.`);
    } else {
      toast.success(
        batchMode
          ? `${successes.length} images graded${targetLotId ? ' into the lot' : ''}.`
          : 'Prediction complete. Report saved to your history.'
      );
    }

    if (batchMode && targetLotId) {
      navigate(`/lots/${targetLotId}`, { replace: true });
      return;
    }

    if (successes.length === 1) {
      navigate(`/result/${successes[0].id}`, {
        replace: true,
        state: { scan: successes[0] },
      });
    }
  }

  function cancelProcessing() {
    cancelRef.current = true;
    abortRef.current?.abort();
  }

  return (
    <div className="space-y-5">
      <PolicyNotice policy={policy} showPricing />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="p-5 sm:p-6 animate-in">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                Step 1 of 2
              </p>
              <h2 className="mt-1 font-display text-2xl font-semibold text-main">
                {batchMode ? `Add tray images (${files.length})` : 'Add a tray image'}
              </h2>
              <p className="mt-1 text-sm text-muted">
                JPEG, PNG, or WebP up to 10 MB each. Select multiple images to grade a batch.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCameraOpen(true)}
                disabled={processing || files.length >= MAX_FILES || !gradingOn}
              >
                <CameraIcon width={15} height={15} /> Use camera
              </Button>
              {files.length > 0 && (
                <Button variant="secondary" size="sm" onClick={clearAll} disabled={processing}>
                  Clear all
                </Button>
              )}
            </div>
          </div>

          {error && (
            <div className="alert alert-danger mt-4" role="alert">
              <AlertIcon width={18} height={18} />
              <p className="flex-1">{error}</p>
              <button
                type="button"
                onClick={() => setError('')}
                className="opacity-70 transition hover:opacity-100"
                aria-label="Dismiss error"
              >
                <CloseIcon width={15} height={15} />
              </button>
            </div>
          )}

          <form onSubmit={submit} className="mt-4">
            <div
              role="button"
              tabIndex={0}
              aria-label="Choose images to analyse"
              onClick={() => !processing && gradingOn && inputRef.current?.click()}
              onKeyDown={(event) => {
                if (!processing && gradingOn && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (!processing && gradingOn) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={processing || !gradingOn ? undefined : onDrop}
              className={`relative flex flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed p-5 text-center transition-all ${
                files.length > 0 ? 'min-h-[9rem]' : 'min-h-[19rem]'
              } ${
                dragging
                  ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)]'
                  : 'border-[color:var(--border-strong)] bg-[color:var(--panel-soft)] hover:border-[color:var(--accent)]'
              } ${processing || !gradingOn ? 'pointer-events-none opacity-60' : ''}`}
            >
              {files.length === 0 ? (
                <>
                  <span
                    className="flex h-16 w-16 items-center justify-center rounded-3xl"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    <UploadIcon width={28} height={28} />
                  </span>
                  <p className="mt-4 font-display text-lg font-semibold text-main">
                    Drop images here, or click to browse
                  </p>
                  <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">
                    Place arecanuts on a flat tray with even lighting and keep the whole tray in
                    frame. Add up to {MAX_FILES} images per batch.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <span className="pill">JPEG</span>
                    <span className="pill">PNG</span>
                    <span className="pill">WebP</span>
                    <span className="pill">≤ 10 MB each</span>
                    <span className="pill">Up to {MAX_FILES}</span>
                  </div>
                </>
              ) : (
                <div className="w-full text-left">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-main">
                      {files.length} image{files.length === 1 ? '' : 's'} in the queue
                    </p>
                    <span className="pill">
                      {processing
                        ? `${finishedCount} of ${files.length} finished`
                        : batchMode
                        ? 'Batch mode'
                        : 'Single image'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {processing
                      ? 'Images are processed one at a time so the CPU model is not overloaded.'
                      : 'Drop more images here or click to add.'}
                  </p>

                  <div className="mt-3 space-y-2">
                    {files.map((item, index) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-strong)] p-2"
                      >
                        <img
                          src={item.preview}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-xl object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-xs font-semibold text-main">
                              {String(index + 1).padStart(2, '0')} · {item.file.name}
                            </p>
                            <StatusPill item={item} />
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-muted">
                            {(item.file.size / (1024 * 1024)).toFixed(2)} MB
                            {item.status === 'uploading' && item.pct < 100
                              ? ` · ${item.pct}% uploaded`
                              : ''}
                            {item.status === 'done' && item.scan
                              ? gradingOn && item.scan.finalGrade
                                ? item.scan.finalGradeSource === 'gemini_advisory'
                                  ? ` · ${item.scan.finalGrade} Gemini advisory (no nut count)`
                                  : ` · ${item.scan.finalGrade}, ${formatNumber(
                                      item.scan.totalCount
                                    )} nuts`
                                : ' · Grading output hidden by policy'
                              : ''}
                            {item.status === 'error' && item.error ? ` · ${item.error}` : ''}
                          </p>
                          {item.status === 'uploading' && (
                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-[color:var(--border)]">
                              <div
                                className="h-full rounded-full transition-all duration-300"
                                style={{
                                  width:
                                    item.pct < 100 ? `${Math.max(4, item.pct)}%` : '100%',
                                  background:
                                    item.pct < 100
                                      ? 'var(--border-strong)'
                                      : 'linear-gradient(90deg, var(--accent), var(--accent-strong))',
                                }}
                              />
                            </div>
                          )}
                        </div>
                        {!processing && item.status !== 'uploading' && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              removeItem(item.id);
                            }}
                            className="btn-ghost !p-2 hover:!text-[color:var(--danger)]"
                            aria-label={`Remove ${item.file.name}`}
                            title="Remove from queue"
                          >
                            <TrashIcon width={14} height={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = '';
              }}
            />

            {processing && (
              <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-4">
                <div className="flex items-center justify-between gap-3 text-xs text-muted">
                  <span className="flex items-center gap-2">
                    <Spinner size={14} />
                    {successCount + failedCount < files.length
                      ? 'Grading images one at a time…'
                      : 'Finishing up…'}
                  </span>
                  <span>{overallPct}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[color:var(--border)]">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.max(4, overallPct)}%`,
                      background: 'linear-gradient(90deg, var(--accent), var(--accent-strong))',
                    }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  A local CPU prediction can take several seconds per image. Keep this tab open.
                </p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] leading-relaxed text-muted">
                Images are stored with your account so you can revisit each report.
              </p>
              <div className="flex gap-2">
                {processing && (
                  <Button variant="secondary" onClick={cancelProcessing}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" disabled={files.length === 0 || processing || !gradingOn} size="lg">
                  {processing ? (
                    <>
                      <Spinner size={15} /> Grading {Math.min(files.length, finishedCount + 1)} of{' '}
                      {files.length}…
                    </>
                  ) : !gradingOn ? (
                    <>
                      <AlertIcon width={17} height={17} /> Grading disabled
                    </>
                  ) : (
                    <>
                      <SparkIcon width={17} height={17} />
                      {batchMode ? `Grade ${files.length} images` : 'Detect & grade'}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="p-5 animate-in">
            <div className="flex items-center gap-2">
              <LayersIcon width={17} height={17} />
              <h3 className="font-display text-base font-semibold text-main">Lot / batch</h3>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Group these predictions into a lot to track combined counts, estimated weight, and
              estimated value.
            </p>

            <div className="mt-3">
              <label className="field-label" htmlFor="upload-lot">
                Assign to lot
              </label>
              <select
                id="upload-lot"
                className="select"
                value={lotChoice}
                disabled={processing || lotsLoading || files.length === 0}
                onChange={(event) => setLotChoice(event.target.value)}
              >
                {!batchMode && <option value="">No lot (single prediction)</option>}
                {batchMode && lotChoice === '' && <option value="">Choose a lot…</option>}
                {lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.name}
                    {lot.reference ? ` · ${lot.reference}` : ''}
                  </option>
                ))}
                <option value="new">＋ Create a new lot</option>
              </select>
            </div>

            {lotChoice === 'new' && (
              <div className="mt-3">
                <label className="field-label" htmlFor="upload-new-lot">
                  New lot name
                </label>
                <input
                  id="upload-new-lot"
                  className="input"
                  maxLength={80}
                  value={newLotName}
                  disabled={processing}
                  onChange={(event) => setNewLotName(event.target.value)}
                  placeholder={defaultLotName()}
                />
                <p className="mt-1.5 text-[11px] text-muted">
                  Average nut weight can be set on the lot page after grading. Prices follow the
                  administrator's active pricing policy.
                </p>
              </div>
            )}

            {selectedLot && (
              <div className="mt-3 rounded-2xl bg-[color:var(--panel-soft)] p-3 text-[11px] text-muted">
                <p className="font-semibold text-main">{selectedLot.name}</p>
                <p className="mt-1">
                  {formatNumber(selectedLot.totals?.scanCount || 0)} scan(s) ·{' '}
                  {formatNumber(selectedLot.totals?.totalNuts || 0)} nuts
                  {policy?.pricingMode !== 'none' && selectedLot.valuation?.totalValue !== null
                    ? ` · ${formatCurrency(selectedLot.valuation?.totalValue || 0, selectedLot.currency)}`
                    : ''}
                </p>
              </div>
            )}

            {batchMode && (
              <p className="mt-3 text-[11px] leading-relaxed text-muted">
                {lotChoice
                  ? 'All images in this batch will be attached to the selected lot.'
                  : 'Choose or create a lot so the batch appears together.'}
              </p>
            )}
          </Card>

          <Card className="p-5 animate-in">
            <h3 className="font-display text-base font-semibold text-main">What this model supports</h3>
            <ul className="mt-3 space-y-2.5 text-sm">
              {[
                ['Grade A vs Grade B', true],
                ['Image-level majority grade', true],
                ['Bounding boxes + confidence', true],
                ['C / D grades (Gemini advisory only, never counted)', false],
                ['Defect categories', false],
                ['Physical size in mm', false],
              ].map(([label, supported]) => (
                <li key={label} className="flex items-start gap-2.5">
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                      supported ? 'badge-a' : 'badge-neutral'
                    }`}
                  >
                    {supported ? <CheckIcon width={12} height={12} /> : <CloseIcon width={11} height={11} />}
                  </span>
                  <span className={supported ? 'text-main' : 'text-muted'}>{label}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              Unsupported items are shown so the report never implies capabilities the preserved
              two-class model does not have.
            </p>
          </Card>

          <Card className="p-5 animate-in">
            <h3 className="font-display text-base font-semibold text-main">Capture checklist</h3>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted">
              <li>• Use natural or bright, diffuse light.</li>
              <li>• Avoid overlapping nuts and heavy shadows.</li>
              <li>• Keep the camera roughly perpendicular to the tray.</li>
              <li>• Avoid motion blur and digital zoom.</li>
            </ul>
          </Card>
        </div>
      </div>

      <Modal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        title="Capture a tray photo"
        description="The photo is added to the queue. Nothing is uploaded until you choose Detect & grade."
        size="lg"
      >
        <CameraCapture
          onCapture={(captured) => {
            addFiles([captured]);
            setCameraOpen(false);
          }}
          onClose={() => setCameraOpen(false)}
        />
      </Modal>
    </div>
  );
}
