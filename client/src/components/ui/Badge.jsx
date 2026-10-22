import { gradeTone } from '../../utils/format';

export function Badge({ tone = 'neutral', className = '', children }) {
  return <span className={`badge badge-${tone} ${className}`}>{children}</span>;
}

export function GradeBadge({ grade, className = '' }) {
  return (
    <span className={`badge badge-${gradeTone(grade)} ${className}`}>{grade}</span>
  );
}
