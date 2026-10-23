import { Badge, GradeBadge } from '../ui/Badge';

export function ManualGradeBadge({ grade, className = '' }) {
  if (!grade) return <Badge tone="neutral" className={className}>Not graded</Badge>;
  return <GradeBadge grade={`Grade ${grade}`} className={className} />;
}

export function ReviewBadge({ review, className = '' }) {
  if (review?.imageFlagged) {
    return <Badge tone="invalid" className={className}>Image flagged</Badge>;
  }
  if (review?.reviewed) {
    return <Badge tone="a" className={className}>Reviewed</Badge>;
  }
  return <Badge tone="neutral" className={className}>Review pending</Badge>;
}

export function RecordStatusBadge({ status, className = '' }) {
  if (status === 'draft') {
    return <Badge tone="b" className={className}>Draft</Badge>;
  }
  return <Badge tone="a" className={className}>Completed</Badge>;
}

export function BatchStatusBadge({ status, className = '' }) {
  if (status === 'completed') {
    return <Badge tone="a" className={className}>Batch complete</Badge>;
  }
  return <Badge tone="b" className={className}>Batch open</Badge>;
}

export function QualityBadge({ quality, className = '' }) {
  if (!quality?.checked) {
    return <Badge tone="neutral" className={className}>Upload not checked</Badge>;
  }
  if (quality.warnings?.length) {
    return (
      <Badge tone="b" className={className}>
        {quality.warnings.length} upload warning{quality.warnings.length === 1 ? '' : 's'}
      </Badge>
    );
  }
  return <Badge tone="a" className={className}>Upload check passed</Badge>;
}
