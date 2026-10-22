export default function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  children,
  ...props
}) {
  const variantClass =
    variant === 'secondary'
      ? 'btn-secondary'
      : variant === 'ghost'
      ? 'btn-ghost'
      : variant === 'danger'
      ? 'btn-danger'
      : 'btn-primary';
  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';
  return (
    <button
      type={type}
      className={`${variantClass} ${sizeClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
