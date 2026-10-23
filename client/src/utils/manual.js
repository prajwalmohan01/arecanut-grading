export const MANUAL_GRADE_OPTIONS = [
  {
    value: 'A',
    label: 'Grade A',
    tone: 'a',
    description: 'Excellent quality, as judged by the person grading the sample.',
    detail: 'The grader intentionally selected Grade A for this sample.',
  },
  {
    value: 'B',
    label: 'Grade B',
    tone: 'b',
    description: 'Good quality, as judged by the person grading the sample.',
    detail: 'The grader intentionally selected Grade B for this sample.',
  },
];

export function manualGradeLabel(grade) {
  return grade ? `Grade ${grade}` : 'Not graded';
}

export function manualGradeHint(grade) {
  return MANUAL_GRADE_OPTIONS.find((option) => option.value === grade)?.description || '';
}

export function formatManualDateTimeInput(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function todayInputValue() {
  const date = new Date();
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function verificationUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`;
}

export const ACTIVITY_TYPE_LABELS = {
  record_created: 'Grading record created',
  record_updated: 'Grading record updated',
  record_corrected: 'Grade corrected',
  record_deleted: 'Grading record deleted',
  record_reviewed: 'Record reviewed',
  record_flagged: 'Image flagged',
  record_exported: 'Records exported',
  record_report_generated: 'Record report generated',
  batch_created: 'Batch created',
  batch_updated: 'Batch updated',
  batch_deleted: 'Batch deleted',
  batch_exported: 'Batch exported',
  batch_report_generated: 'Batch report generated',
  assessment_generated: 'Assessment generated',
  price_created: 'Price record saved',
  price_deleted: 'Price record deleted',
  price_exported: 'Price records exported',
};

export function activityLabel(type) {
  return ACTIVITY_TYPE_LABELS[type] || String(type || 'Activity').replace(/_/g, ' ');
}

export function activityTone(type) {
  if (type.includes('deleted')) return 'danger';
  if (type.includes('corrected') || type.includes('flagged')) return 'b';
  if (type.includes('created') || type.includes('reviewed') || type.includes('generated')) {
    return 'a';
  }
  return 'neutral';
}

export const PAGE_SIZE_OPTIONS = [10, 20, 50];

export function recordDifferenceValue(field, record) {
  switch (field) {
    case 'grade':
      return record.grade || 'Not graded';
    case 'status':
      return record.status;
    case 'sampleCode':
      return record.sampleCode || '—';
    case 'batch':
      return record.batch?.name || record.batch?.batchId || 'No batch';
    case 'quantity':
      return record.quantity ?? '—';
    case 'weightKg':
      return record.weightKg ?? '—';
    case 'sizeMm':
      return record.sizeMm ?? '—';
    case 'appearance':
      return record.appearance || '—';
    case 'gradedAt':
      return record.gradedAt ? new Date(record.gradedAt).toISOString() : '—';
    case 'reviewerName':
      return record.reviewerName || '—';
    case 'observations':
      return record.observations || '—';
    case 'notes':
      return record.notes || '—';
    case 'reviewed':
      return record.review?.reviewed ? 'Reviewed' : 'Pending';
    case 'imageFlagged':
      return record.review?.imageFlagged ? 'Flagged' : 'Not flagged';
    default:
      return record[field] ?? '—';
  }
}

export function qualityIsAdvisory(quality) {
  return Boolean(quality?.checked);
}

export function qualityWarningCount(quality) {
  return Array.isArray(quality?.warnings) ? quality.warnings.length : 0;
}
