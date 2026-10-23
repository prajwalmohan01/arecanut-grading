'use strict';

const mongoose = require('mongoose');
const ManualBatch = require('../models/ManualBatch');
const ManualGrade = require('../models/ManualGrade');
const ActivityLog = require('../models/ActivityLog');
const {
  summarizeBatch,
  summarizeRecords,
  normalizeGrade,
  REVIEW_FILTERS,
  escapeRegex,
  parseFilterDate,
  round2,
} = require('../utils/manualValidation');
const { parsePagination } = require('../utils/validation');

function idString(value) {
  if (!value) return null;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function serializeBatch(batch, rawStats) {
  const stats = summarizeBatch(batch, rawStats);
  return {
    id: String(batch._id),
    batchId: batch.batchId,
    name: batch.name,
    supplier: batch.supplier || '',
    collectionDate: batch.collectionDate || null,
    targetSamples: batch.targetSamples ?? null,
    targetWeightKg: batch.targetWeightKg ?? null,
    notes: batch.notes || '',
    status: batch.status || 'open',
    stats,
    recordCount: stats.totalRecords,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

function serializeRecord(record, options = {}) {
  const source = record.toObject ? record.toObject() : record;
  const id = String(source._id || source.id);
  const populatedBatch =
    source.batch && typeof source.batch === 'object' && source.batch._id
      ? source.batch
      : null;
  const batchRef = idString(source.batch);
  const batchCode = populatedBatch?.batchId || source.batchCode || '';
  const batchName = populatedBatch?.name || source.batchName || '';

  const quality = source.imageQuality || {};

  return {
    id,
    reportId: source.reportId,
    sampleCode: source.sampleCode || '',
    status: source.status || 'completed',
    grade: source.grade || null,
    gradeLabel: source.grade ? `Grade ${source.grade}` : null,
    quantity: source.quantity ?? null,
    weightKg: source.weightKg ?? null,
    sizeMm: source.sizeMm ?? null,
    appearance: source.appearance || '',
    gradedAt: source.gradedAt || source.createdAt,
    reviewerName: source.reviewerName || '',
    observations: source.observations || '',
    notes: source.notes || '',
    batch: batchRef
      ? {
          id: populatedBatch ? String(populatedBatch._id) : batchRef,
          batchId: batchCode,
          name: batchName,
        }
      : batchCode || batchName
      ? { id: null, batchId: batchCode, name: batchName }
      : null,
    image: {
      url: `/manual/records/${id}/image`,
      originalName: source.image?.originalName || '',
      mime: source.image?.mime || '',
      size: source.image?.size || 0,
      width: source.image?.width ?? quality.width ?? null,
      height: source.image?.height ?? quality.height ?? null,
      hash: source.image?.hash || '',
    },
    imageQuality: {
      checked: Boolean(quality.checked),
      width: quality.width ?? null,
      height: quality.height ?? null,
      brightness: quality.brightness ?? null,
      blurScore: quality.blurScore ?? null,
      warnings: Array.isArray(quality.warnings) ? quality.warnings : [],
      source: quality.source || 'browser-canvas',
      checkedAt: quality.checkedAt || null,
    },
    review: {
      reviewed: Boolean(source.review?.reviewed),
      reviewedAt: source.review?.reviewedAt || null,
      reviewedByName: source.review?.reviewedByName || '',
      notes: source.review?.notes || '',
      imageFlagged: Boolean(source.review?.imageFlagged),
    },
    assessment: source.assessment?.id
      ? {
          id: source.assessment.id,
          issuedAt: source.assessment.issuedAt || null,
          verifyPath:
            options.includeAssessmentToken && source.assessmentToken
              ? `/verify/${source.assessmentToken}`
              : null,
        }
      : null,
    corrections: options.includeCorrections === false
      ? undefined
      : (source.corrections || []).map((correction) => ({
          action: correction.action || 'update',
          at: correction.at,
          byName: correction.byName || '',
          reason: correction.reason || '',
          changes: (correction.changes || []).map((change) => ({
            field: change.field,
            label: change.label || change.field,
            from: change.from ?? null,
            to: change.to ?? null,
          })),
        })),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

function serializePrice(record) {
  return {
    id: String(record._id),
    marketName: record.marketName || '',
    grade: record.grade,
    gradeLabel: `Grade ${record.grade}`,
    weightKg: record.weightKg,
    pricePerKg: record.pricePerKg,
    value: record.value,
    currency: record.currency || 'INR',
    priceDate: record.priceDate,
    notes: record.notes || '',
    formula: 'Weight in kilograms × price per kilogram',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function serializeActivity(log) {
  return {
    id: String(log._id),
    type: log.type,
    message: log.message,
    entityType: log.entityType,
    entityId: log.entityId || '',
    entityLabel: log.entityLabel || '',
    batchCode: log.batchCode || '',
    metadata: log.metadata || {},
    createdAt: log.createdAt,
  };
}

function sanitizeMetadata(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (depth > 2) return '[truncated]';
  if (typeof value === 'string') return value.slice(0, 300);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeMetadata(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    Object.entries(value)
      .slice(0, 20)
      .forEach(([key, item]) => {
        if (/password|token|secret/i.test(key)) return;
        out[key] = sanitizeMetadata(item, depth + 1);
      });
    return out;
  }
  return null;
}

async function logActivity({
  user,
  type,
  message,
  entityType = 'grading_record',
  entityId = '',
  entityLabel = '',
  batchCode = '',
  metadata = {},
}) {
  try {
    if (!user?._id) return null;
    return await ActivityLog.create({
      user: user._id,
      type,
      message: String(message || '').slice(0, 300),
      entityType,
      entityId: String(entityId || ''),
      entityLabel: String(entityLabel || '').slice(0, 120),
      batchCode: String(batchCode || '').slice(0, 80),
      metadata: sanitizeMetadata(metadata) || {},
    });
  } catch (error) {
    // The primary operation must not fail because an audit entry could not be written.
    console.warn(`[activity] Could not record ${type}: ${error.message}`);
    return null;
  }
}

async function getBatchStatsMap(userId, batchIds) {
  const map = new Map();
  if (!Array.isArray(batchIds) || batchIds.length === 0) return map;

  const rows = await ManualGrade.aggregate([
    {
      $match: {
        user: new mongoose.Types.ObjectId(userId),
        batch: { $in: batchIds },
      },
    },
    {
      $group: {
        _id: '$batch',
        totalRecords: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        drafts: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
        reviewed: { $sum: { $cond: ['$review.reviewed', 1, 0] } },
        pendingReview: { $sum: { $cond: ['$review.reviewed', 0, 1] } },
        flagged: { $sum: { $cond: ['$review.imageFlagged', 1, 0] } },
        gradeA: { $sum: { $cond: [{ $eq: ['$grade', 'A'] }, 1, 0] } },
        gradeB: { $sum: { $cond: [{ $eq: ['$grade', 'B'] }, 1, 0] } },
        totalQuantity: { $sum: { $ifNull: ['$quantity', 0] } },
        totalWeightKg: { $sum: { $ifNull: ['$weightKg', 0] } },
        imageQualityWarnings: {
          $sum: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ['$imageQuality.warnings', []] } }, 0] },
              1,
              0,
            ],
          },
        },
        lastGradedAt: { $max: '$gradedAt' },
      },
    },
  ]);

  rows.forEach((row) => {
    const { _id, ...rest } = row;
    map.set(String(_id), {
      ...rest,
      totalQuantity: round2(row.totalQuantity),
      totalWeightKg: round2(row.totalWeightKg),
    });
  });
  return map;
}

const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  graded_newest: { gradedAt: -1 },
  graded_oldest: { gradedAt: 1 },
  grade: { grade: 1, createdAt: -1 },
  weight: { weightKg: -1, createdAt: -1 },
  quantity: { quantity: -1, createdAt: -1 },
};

async function buildRecordFilter(userId, query = {}) {
  const filter = { user: userId };
  const pageInfo = parsePagination(query, { page: 1, limit: 10 });
  const sort = SORTS[String(query.sort || 'newest')] || SORTS.newest;

  const rawTerm = String(query.q || '').trim().slice(0, 80);
  if (rawTerm) {
    const regex = new RegExp(escapeRegex(rawTerm), 'i');
    const batchIds = await ManualBatch.find({
      user: userId,
      $or: [
        { name: regex },
        { batchId: regex },
        { supplier: regex },
      ],
    })
      .select('_id')
      .limit(200);
    const or = [
      { reportId: regex },
      { sampleCode: regex },
      { reviewerName: regex },
      { batchCode: regex },
      { batchName: regex },
      { notes: regex },
      { observations: regex },
    ];
    if (batchIds.length) or.push({ batch: { $in: batchIds.map((batch) => batch._id) } });
    filter.$or = or;
  }

  if (query.grade) {
    const grade = normalizeGrade(query.grade);
    if (!grade) return { error: 'Grade filter must be A or B' };
    filter.grade = grade;
  }

  if (query.status) {
    const status = String(query.status).toLowerCase();
    if (!['draft', 'completed'].includes(status)) {
      return { error: 'Status filter must be draft or completed' };
    }
    filter.status = status;
  }

  if (query.review) {
    const review = String(query.review).toLowerCase();
    if (!REVIEW_FILTERS.includes(review)) {
      return { error: 'Review filter must be reviewed, pending, or flagged' };
    }
    if (review === 'reviewed') filter['review.reviewed'] = true;
    if (review === 'pending') filter['review.reviewed'] = false;
    if (review === 'flagged') filter['review.imageFlagged'] = true;
  }

  if (query.batch) {
    if (!mongoose.Types.ObjectId.isValid(query.batch)) {
      return { error: 'Invalid batch filter' };
    }
    filter.batch = new mongoose.Types.ObjectId(query.batch);
  }

  const from = parseFilterDate(query.from, false);
  if (from.error) return { error: from.error };
  const to = parseFilterDate(query.to, true);
  if (to.error) return { error: to.error };
  if (from.value || to.value) {
    filter.gradedAt = {};
    if (from.value) filter.gradedAt.$gte = from.value;
    if (to.value) filter.gradedAt.$lte = to.value;
  }
  if (from.value && to.value && from.value > to.value) {
    return { error: 'The start date must be before the end date' };
  }

  return { filter, sort, page: pageInfo.page, limit: pageInfo.limit, skip: pageInfo.skip };
}

async function recordSummaryForFilter(filter) {
  const rows = await ManualGrade.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        drafts: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
        reviewed: { $sum: { $cond: ['$review.reviewed', 1, 0] } },
        pendingReview: { $sum: { $cond: ['$review.reviewed', 0, 1] } },
        flagged: { $sum: { $cond: ['$review.imageFlagged', 1, 0] } },
        gradeA: { $sum: { $cond: [{ $eq: ['$grade', 'A'] }, 1, 0] } },
        gradeB: { $sum: { $cond: [{ $eq: ['$grade', 'B'] }, 1, 0] } },
        totalQuantity: { $sum: { $ifNull: ['$quantity', 0] } },
        totalWeightKg: { $sum: { $ifNull: ['$weightKg', 0] } },
        lastGradedAt: { $max: '$gradedAt' },
      },
    },
  ]);

  if (!rows.length) return { ...summarizeRecords([]), total: 0 };
  const row = rows[0];
  return {
    ...row,
    _id: undefined,
    totalRecords: row.total,
    totalQuantity: round2(row.totalQuantity),
    totalWeightKg: round2(row.totalWeightKg),
  };
}

module.exports = {
  serializeBatch,
  serializeRecord,
  serializePrice,
  serializeActivity,
  logActivity,
  getBatchStatsMap,
  buildRecordFilter,
  recordSummaryForFilter,
  sanitizeMetadata,
};
