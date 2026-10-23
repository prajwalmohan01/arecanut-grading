import { useEffect, useState } from 'react';
import API from '../api/axios';

export function useAuthImage(url) {
  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!url) {
      setSrc(null);
      setLoading(false);
      setError(null);
      return undefined;
    }

    let objectUrl = null;
    let alive = true;
    setLoading(true);
    setError(null);

    // Accept both '/scans/...' and legacy '/api/scans/...' URLs, because the
    // axios instance already includes the '/api' base path.
    const path = url.replace(/^\/api(?=\/)/, '');

    API.get(path, { responseType: 'blob' })
      .then((response) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(response.data);
        setSrc(objectUrl);
      })
      .catch((err) => {
        if (alive) setError(err);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return { src, loading, error };
}

export default function ProtectedImage({ url, alt, className = '', label = 'Image' }) {
  const { src, loading, error } = useAuthImage(url);

  if (loading) {
    return (
      <div className={`skeleton flex min-h-48 items-center justify-center ${className}`}>
        <span className="text-xs text-muted">Loading {label.toLowerCase()}…</span>
      </div>
    );
  }
  if (error || !src) {
    return (
      <div
        className={`surface-soft flex min-h-48 flex-col items-center justify-center gap-1 p-6 text-center ${className}`}
      >
        <span className="text-2xl opacity-40">▧</span>
        <p className="text-xs text-muted">{label} not available</p>
      </div>
    );
  }
  return <img src={src} alt={alt || label} className={className} loading="lazy" />;
}
