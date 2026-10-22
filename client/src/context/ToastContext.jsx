import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);

const ICONS = {
  success: '✓',
  error: '!',
  info: 'i',
};

const TONES = {
  success: 'badge-a',
  error: 'badge-invalid',
  info: 'badge-neutral',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const remove = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (type, message, duration = 4200) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setToasts((current) => [...current.slice(-3), { id, type, message }]);
      const timer = setTimeout(() => remove(id), duration);
      timers.current.set(id, timer);
      return id;
    },
    [remove]
  );

  const api = useMemo(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('error', message),
      info: (message) => push('info', message),
      remove,
    }),
    [push, remove]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(92vw,22rem)] flex-col gap-2"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto animate-in"
            role="status"
          >
            <div className="surface-strong flex items-start gap-3 rounded-2xl p-3.5">
              <span
                className={`badge ${TONES[toast.type] || TONES.info} mt-0.5 h-6 w-6 justify-center rounded-full p-0 text-xs`}
              >
                {ICONS[toast.type] || ICONS.info}
              </span>
              <p className="flex-1 text-sm leading-snug text-main">{toast.message}</p>
              <button
                type="button"
                onClick={() => remove(toast.id)}
                className="text-muted transition hover:text-main"
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
