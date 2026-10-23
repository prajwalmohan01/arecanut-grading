export default function StatCard({ label, value, hint, icon, tone = 'default', className = '' }) {
  const toneStyles =
    tone === 'a'
      ? { color: 'var(--accent)', background: 'var(--accent-soft)' }
      : tone === 'b'
      ? { color: 'var(--gold)', background: 'var(--gold-soft)' }
      : tone === 'danger'
      ? { color: 'var(--danger)', background: 'var(--danger-soft)' }
      : { color: 'var(--text)', background: 'var(--panel-soft)' };

  return (
    <div className={`card p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
            {label}
          </p>
          <p className="stat-value mt-2 break-words" style={{ color: toneStyles.color }}>
            {value}
          </p>
          {hint && <p className="mt-1.5 break-words text-xs text-muted">{hint}</p>}
        </div>
        {icon && (
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
            style={toneStyles}
          >
            {icon}
          </span>
        )}
      </div>
    </div>
  );
}
