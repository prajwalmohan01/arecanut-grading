import { gradeTone } from '../../utils/format';

export function Badge({ tone = 'neutral', className = '', children }) {
  return <span className={`badge badge-${tone} ${className}`}>{children}</span>;
}

export function GradeBadge({ grade, className = '' }) {
  if (!grade) {
    return <span className={`badge badge-neutral ${className}`}>Hidden / unavailable</span>;
  }
  return (
    <span className={`badge badge-${gradeTone(grade)} ${className}`}>{grade}</span>
  );
}
