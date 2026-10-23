'use strict';

const crypto = require('crypto');

const MANUAL_GRADES = ['A', 'B'];
const RECORD_STATUSES = ['draft', 'completed'];
const REVIEW_FILTERS = ['reviewed', 'pending', 'flagged'];
const BATCH_STATUSES = ['open', 'completed'];

const LIMITS = {
  sampleCode: 80,
  reviewerName: 80,
  appearance: 200,
  observations: 500,
  notes: 1000,
  supplier: 120,
  batchName: 80,
  batchNotes: 1000,
  marketName: 80,
  priceNotes: 500,
  correctionReason: 500,
  reviewNotes: 500,
  quantity: 1_000_000,
  weightKg: 1_000_000,
  sizeMm: 10_000,
  targetSamples: 1_000_000,
  targetWeightKg: 100_000_000,
  pricePerKg: 10_000_000,
};

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeGrade(value) {
  if (value === undefined || value === null || value === '') return null;
  const match = String(value).trim().match(/^(?:grade\s*)?([ab])$/i);
  return match ? match[1].toUpperCase() : null;
}

function normalizeStatus(value, fallback = 'completed') {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return RECORD_STATUSES.includes(normalized) ? normalized : null;
}

function normalizeBatchStatus(value, fallback = 'open') {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return BATCH_STATUSES.includes(normalized) ? normalized : null;
}

function cleanText(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function validateText(value, { field, max, required = false }) {
  if (value === undefined || value === null || value === '') {
    return required ? `${field} is required` : null;
  }
  if (typeof value !== 'string') return `${field} must be text`;
  const trimmed = value.trim();
  if (required && !trimmed) return `${field} is required`;
  if (trimmed.length > max) return `${field} must be ${max} characters or fewer`;
  return null;
}

function parseNumberField(
  value,
  { field, min = 0, max, integer = false, required = false }
) {
  if (value === undefined || value === null || value === '') {
    return { value: null, error: required ? `${field} is required` : null };
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return { value: null, error: `${field} must be a valid number` };
  }
  if (integer && !Number.isInteger(number)) {
    return { value: null, error: `${field} must be a whole number` };
  }
  if (number < min) {
    return { value: null, error: `${field} must be at least ${min}` };
  }
  if (max !== undefined && number > max) {
    return { value: null, error: `${field} must be at most ${max.toLocaleString()}` };
  }
  return { value: number, error: null };
}

function parseDateTimeField(value, { field, required = false, allowFuture = false }) {
  if (value === undefined || value === null || value === '') {
    return {
      value: null,
      error: required ? `${field} is required` : null,
    };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { value: null, error: `${field} must be a valid date and time` };
  }
  if (!allowFuture && date.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    return { value: null, error: `${field} cannot be in the future` };
  }
  return { value: date, error: null };
}

function parseFilterDate(value, endOfDay = false) {
  if (!value) return { value: null, error: null };
  const text = String(value).trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const date = dateOnly ? new Date(`${text}T00:00:00.000Z`) : new Date(text);
  if (Number.isNaN(date.getTime())) {
    return { value: null, error: 'Date filters must be valid dates' };
  }
  if (dateOnly && endOfDay) date.setUTCHours(23, 59, 59, 999);
  return { value: date, error: null };
}

/**
 * Image-quality values are produced by the browser as an advisory check.
 * They are bounded and sanitized here but never used to assign a grade.
 */
function buildImageQuality(input) {
  if (input === undefined || input === null || input === '') return null;
  let source = input;
  if (typeof input === 'string') {
    try {
      source = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;

  const bound = (value, min, max) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.min(max, Math.max(min, Math.round(number * 100) / 100));
  };

  const warnings = Array.isArray(source.warnings)
    ? source.warnings
        .filter((warning) => typeof warning === 'string' && warning.trim())
        .slice(0, 8)
        .map((warning) => warning.trim().slice(0, 200))
    : [];

  return {
    checked: source.checked !== false,
    width: bound(source.width, 0, 50_000),
    height: bound(source.height, 0, 50_000),
    brightness: bound(source.brightness, 0, 255),
    blurScore: bound(source.blurScore, 0, 1_000_000),
    warnings,
    source: 'browser-canvas',
    checkedAt: new Date(),
  };
}

function calculateEstimatedValue(weightKg, pricePerKg) {
  const weight = Number(weightKg);
  const price = Number(pricePerKg);
  if (!Number.isFinite(weight) || !Number.isFinite(price) || weight < 0 || price < 0) {
    return { value: null, formula: 'Weight in kilograms × price per kilogram' };
  }
  return {
    value: round2(weight * price),
    formula: 'Weight in kilograms × price per kilogram',
  };
}

function summarizeRecords(records) {
  const stats = {
    totalRecords: 0,
    completed: 0,
    drafts: 0,
    reviewed: 0,
    pendingReview: 0,
    flagged: 0,
    gradeA: 0,
    gradeB: 0,
    totalQuantity: 0,
    totalWeightKg: 0,
    lastGradedAt: null,
    imageQualityWarnings: 0,
  };

  if (!Array.isArray(records)) return stats;

  records.forEach((record) => {
    stats.totalRecords += 1;
    if (record.status === 'draft') stats.drafts += 1;
    else stats.completed += 1;

    if (record.review?.reviewed) stats.reviewed += 1;
    else stats.pendingReview += 1;
    if (record.review?.imageFlagged) stats.flagged += 1;

    if (record.grade === 'A') stats.gradeA += 1;
    if (record.grade === 'B') stats.gradeB += 1;

    const quantity = Number(record.quantity);
    if (Number.isFinite(quantity) && quantity >= 0) stats.totalQuantity += quantity;
    const weight = Number(record.weightKg);
    if (Number.isFinite(weight) && weight >= 0) stats.totalWeightKg += weight;

    if (Array.isArray(record.imageQuality?.warnings) && record.imageQuality.warnings.length) {
      stats.imageQualityWarnings += 1;
    }

    const gradedAt = record.gradedAt ? new Date(record.gradedAt) : null;
    if (gradedAt && !Number.isNaN(gradedAt.getTime())) {
      if (!stats.lastGradedAt || gradedAt > stats.lastGradedAt) stats.lastGradedAt = gradedAt;
    }
  });

  stats.totalQuantity = Math.round(stats.totalQuantity * 1000) / 1000;
  stats.totalWeightKg = Math.round(stats.totalWeightKg * 1000) / 1000;
  return stats;
}

function summarizeBatch(batch, recordStats) {
  const base = summarizeRecords([]);
  const stats = { ...base, ...(recordStats || {}) };
  const targetSamples =
    batch?.targetSamples === null || batch?.targetSamples === undefined
      ? null
      : Number(batch.targetSamples);
  const targetWeightKg =
    batch?.targetWeightKg === null || batch?.targetWeightKg === undefined
      ? null
      : Number(batch.targetWeightKg);

  stats.pendingSamples =
    Number.isFinite(targetSamples) && targetSamples >= 0
      ? Math.max(targetSamples - stats.totalRecords, 0)
      : null;
  stats.progressPct =
    Number.isFinite(targetSamples) && targetSamples > 0
      ? Math.min(100, Math.round((stats.completed / targetSamples) * 100))
      : null;
  stats.remainingWeightKg =
    Number.isFinite(targetWeightKg) && targetWeightKg >= 0
      ? Math.max(round2(targetWeightKg - stats.totalWeightKg), 0)
      : null;
  stats.weightProgressPct =
    Number.isFinite(targetWeightKg) && targetWeightKg > 0
      ? Math.min(100, Math.round((stats.totalWeightKg / targetWeightKg) * 100))
      : null;

  return stats;
}

/** CSV escape that also blocks spreadsheet formula injection for text cells. */
function csvEscape(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateId(prefix, bytes = 3) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${date}-${crypto.randomBytes(bytes).toString('hex').toUpperCase()}`;
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  MANUAL_GRADES,
  RECORD_STATUSES,
  REVIEW_FILTERS,
  BATCH_STATUSES,
  LIMITS,
  round2,
  normalizeGrade,
  normalizeStatus,
  normalizeBatchStatus,
  cleanText,
  validateText,
  parseNumberField,
  parseDateTimeField,
  parseFilterDate,
  buildImageQuality,
  calculateEstimatedValue,
  summarizeRecords,
  summarizeBatch,
  csvEscape,
  escapeRegex,
  generateId,
  randomToken,
};
