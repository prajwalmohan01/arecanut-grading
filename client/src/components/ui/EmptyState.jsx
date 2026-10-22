export default function EmptyState({ icon = '◌', title, description, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-16 text-center ${className}`}>
      <div className="surface-soft mb-5 flex h-16 w-16 items-center justify-center rounded-3xl text-2xl">
        {icon}
      </div>
      <h3 className="font-display text-xl font-semibold text-main">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
