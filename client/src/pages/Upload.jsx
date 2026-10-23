import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API, { apiErrorMessage } from '../api/axios';
import { useToast } from '../context/ToastContext';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import Spinner from '../components/ui/Spinner';
import CameraCapture from '../components/CameraCapture';
import {
  AlertIcon,
  CameraIcon,
  CheckIcon,
  CloseIcon,
  SparkIcon,
  UploadIcon,
} from '../components/Icons';

const ACCEPTED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;

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

export default function Upload() {
  const navigate = useNavigate();
  const toast = useToast();
  const inputRef = useRef(null);
  const previewUrlRef = useRef(null);
  const abortRef = useRef(null);

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [uploadPct, setUploadPct] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (abortRef.current) abortRef.current.abort();
    },
    []
  );

  function selectFile(nextFile) {
    const validation = validateFile(nextFile);
    if (validation) {
      setError(validation);
      return;
    }
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(nextFile);
    previewUrlRef.current = url;
    setFile(nextFile);
    setPreview(url);
    setError('');
    setUploadPct(0);
  }

  function clearFile() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setFile(null);
    setPreview('');
    setError('');
    setUploadPct(0);
    if (inputRef.current) inputRef.current.value = '';
  }

  function onDrop(event) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) selectFile(dropped);
  }

  async function submit(event) {
    event?.preventDefault();
    const validation = validateFile(file);
    if (validation) {
      setError(validation);
      return;
    }

    setError('');
    setProcessing(true);
    setUploadPct(0);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await API.post('/scans/predict', formData, {
        signal: controller.signal,
        onUploadProgress: (event) => {
          if (!event.total) return;
          setUploadPct(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        },
      });
      const scan = response.data.scan;
      toast.success('Prediction complete. Report saved to your history.');
      navigate(`/result/${response.data.scanId}`, {
        replace: true,
        state: { scan },
      });
    } catch (err) {
      if (err?.code === 'ERR_CANCELED') {
        toast.info('Upload cancelled.');
      } else {
        const message = apiErrorMessage(err, 'Prediction failed. Please try again.');
        setError(message);
        toast.error(message);
      }
      setProcessing(false);
      setUploadPct(0);
    } finally {
      abortRef.current = null;
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="p-5 sm:p-6 animate-in">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                Step 1 of 2
              </p>
              <h2 className="mt-1 font-display text-2xl font-semibold text-main">
                Add a tray image
              </h2>
              <p className="mt-1 text-sm text-muted">
                JPEG, PNG, or WebP up to 10 MB. One image per prediction.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCameraOpen(true)}
              disabled={processing}
            >
              <CameraIcon width={15} height={15} /> Use camera
            </Button>
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
              aria-label="Choose an image to analyse"
              onClick={() => !processing && inputRef.current?.click()}
              onKeyDown={(event) => {
                if (!processing && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (!processing) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={processing ? undefined : onDrop}
              className={`relative flex min-h-[19rem] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed p-4 text-center transition-all ${
                dragging
                  ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)]'
                  : 'border-[color:var(--border-strong)] bg-[color:var(--panel-soft)] hover:border-[color:var(--accent)]'
              } ${processing ? 'pointer-events-none opacity-80' : ''}`}
            >
              {preview ? (
                <>
                  <img
                    src={preview}
                    alt="Selected arecanut tray preview"
                    className="max-h-[22rem] w-full rounded-2xl object-contain"
                  />
                  <div className="mt-3 flex w-full flex-wrap items-center justify-between gap-2 rounded-2xl bg-[color:var(--panel-strong)] px-3 py-2 text-left">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-main">{file?.name}</p>
                      <p className="text-[11px] text-muted">
                        {(file?.size / (1024 * 1024)).toFixed(2)} MB · {file?.type}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          inputRef.current?.click();
                        }}
                        disabled={processing}
                      >
                        Replace
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          clearFile();
                        }}
                        disabled={processing}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <span
                    className="flex h-16 w-16 items-center justify-center rounded-3xl"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    <UploadIcon width={28} height={28} />
                  </span>
                  <p className="mt-4 font-display text-lg font-semibold text-main">
                    Drop an image here, or click to browse
                  </p>
                  <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
                    Place arecanuts on a flat tray with even lighting and keep the whole tray in
                    frame for the most useful prediction.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <span className="pill">JPEG</span>
                    <span className="pill">PNG</span>
                    <span className="pill">WebP</span>
                    <span className="pill">≤ 10 MB</span>
                  </div>
                </>
              )}
            </div>

            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) selectFile(chosen);
              }}
            />

            {processing && (
              <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-4">
                <div className="flex items-center justify-between gap-3 text-xs text-muted">
                  <span className="flex items-center gap-2">
                    <Spinner size={14} />
                    {uploadPct < 100 ? 'Uploading image…' : 'Running the preserved YOLOv8 model…'}
                  </span>
                  <span>{uploadPct < 100 ? `${uploadPct}%` : 'Analysing'}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[color:var(--border)]">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: uploadPct < 100 ? `${Math.max(4, uploadPct)}%` : '100%',
                      background:
                        uploadPct < 100
                          ? 'var(--border-strong)'
                          : 'linear-gradient(90deg, var(--accent), var(--accent-strong))',
                    }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  A local CPU prediction can take several seconds. Keep this tab open.
                </p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] leading-relaxed text-muted">
                The image is stored with your account so you can revisit the report.
              </p>
              <div className="flex gap-2">
                {processing && (
                  <Button
                    variant="secondary"
                    onClick={() => abortRef.current?.abort()}
                  >
                    Cancel
                  </Button>
                )}
                <Button type="submit" disabled={!file || processing} size="lg">
                  {processing ? (
                    <>
                      <Spinner size={15} /> Analysing…
                    </>
                  ) : (
                    <>
                      <SparkIcon width={17} height={17} /> Detect &amp; grade
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="p-5 animate-in">
            <h3 className="font-display text-base font-semibold text-main">What this model supports</h3>
            <ul className="mt-3 space-y-2.5 text-sm">
              {[
                ['Grade A vs Grade B', true],
                ['Image-level majority grade', true],
                ['Bounding boxes + confidence', true],
                ['C / D grades (shown but not evaluated)', false],
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
        description="Your browser may ask for camera permission. Nothing is uploaded until you choose Detect & grade."
        size="lg"
      >
        <CameraCapture
          onCapture={(captured) => {
            selectFile(captured);
            setCameraOpen(false);
          }}
          onClose={() => setCameraOpen(false)}
        />
      </Modal>
    </div>
  );
}
