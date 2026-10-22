import { useEffect } from 'react';
import { CloseIcon } from '../Icons';

export default function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  const width = size === 'lg' ? 'max-w-3xl' : size === 'sm' ? 'max-w-sm' : 'max-w-lg';

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
      role="presentation"
    >
      <div
        className={`surface-strong w-full ${width} max-h-[92vh] overflow-y-auto rounded-3xl p-5 sm:p-6 animate-in`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="modal-title" className="font-display text-xl font-semibold text-main">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost !p-2"
            aria-label="Close dialog"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="mt-5">{children}</div>
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
