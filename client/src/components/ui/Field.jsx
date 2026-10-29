export function TextField({
  label,
  id,
  hint,
  error,
  className = '',
  inputClassName = '',
  ...props
}) {
  return (
    <div className={className}>
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
      )}
      <input
        id={id}
        className={`input ${error ? '!border-[color:var(--danger)]' : ''} ${inputClassName}`}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {error ? (
        <p className="mt-1.5 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function SelectField({
  label,
  id,
  hint,
  error,
  className = '',
  children,
  ...props
}) {
  return (
    <div className={className}>
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
      )}
      <select
        id={id}
        className={`select ${error ? '!border-[color:var(--danger)]' : ''}`}
        aria-invalid={Boolean(error)}
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p className="mt-1.5 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
