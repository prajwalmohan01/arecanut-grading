import { useEffect, useRef, useState } from 'react';
import Button from './ui/Button';
import Spinner from './ui/Spinner';

export default function CameraCapture({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  const [shot, setShot] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera access is not supported by this browser. Use image upload instead.');
        setStarting(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        setError(
          err?.name === 'NotAllowedError'
            ? 'Camera permission was denied. You can still upload an image file.'
            : 'No camera was found or it could not be started. Use image upload instead.'
        );
      } finally {
        if (!cancelled) setStarting(false);
      }
    }

    start();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `camera-${Date.now()}.jpg`, {
          type: 'image/jpeg',
        });
        setShot({ file, preview: URL.createObjectURL(blob) });
      },
      'image/jpeg',
      0.92
    );
  }

  function useShot() {
    if (shot?.file) {
      onCapture(shot.file);
      onClose();
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="alert alert-warn">{error}</div>
      ) : (
        <div className="relative overflow-hidden rounded-2xl border border-[color:var(--border)] bg-black/70">
          {shot ? (
            <img src={shot.preview} alt="Captured preview" className="max-h-80 w-full object-contain" />
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              className="max-h-80 w-full object-contain"
            />
          )}
          {starting && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
              <Spinner label="Starting camera" />
              <span className="ml-2 text-sm">Starting camera…</span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {!error && !shot && (
          <Button onClick={capture} disabled={starting}>
            Capture photo
          </Button>
        )}
        {shot && (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                URL.revokeObjectURL(shot.preview);
                setShot(null);
              }}
            >
              Retake
            </Button>
            <Button onClick={useShot}>Use photo</Button>
          </>
        )}
      </div>
    </div>
  );
}
