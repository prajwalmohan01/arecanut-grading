export default function Spinner({ size = 18, className = '', label = 'Loading' }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
