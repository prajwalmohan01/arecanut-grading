'use strict';

const express = require('express');
const mongoose = require('mongoose');

const ManualBatch = require('../models/ManualBatch');
const ManualGrade = require('../models/ManualGrade');
const { protect } = require('../middleware/authMiddleware');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination } = require('../utils/validation');
const {
  LIMITS,
  BATCH_STATUSES,
  normalizeBatchStatus,
  cleanText,
  validateText,
  parseNumberField,
  parseDateTimeField,
  parseFilterDate,
  escapeRegex,
  summarizeRecords,
  summarizeBatch,
  csvEscape,
} = require('../utils/manualValidation');
const {
  serializeBatch,
  serializeRecord,
  logActivity,
  getBatchStatsMap,
} = require('../services/manualService');
const { buildManualBatchPdf } = require('../utils/manualPdf');

const router = express.Router();

router.use(protect);

function displayName(user) {
  return user?.displayName || user?.username || 'User';
}

function validateBatchFields(body, { partial = false } = {}) {
  const out = {};
  const errors = [];

  if (!partial || body.name !== undefined) {
    const error = validateText(body.name, {
      field: 'Batch name',
      max: LIMITS.batchName,
      required: true,
    });
    if (error) errors.push(error);
    else {
      const name = cleanText(body.name, LIMITS.batchName);
      if (name.length < 2) errors.push('Batch name must be at least 2 characters');
      else out.name = name;
    }
  }

  if (!partial || body.supplier !== undefined) {
    const error = validateText(body.supplier, {
      field: 'Supplier',
      max: LIMITS.supplier,
    });
    if (error) errors.push(error);
    else out.supplier = cleanText(body.supplier, LIMITS.supplier);
  }

  if (!partial || body.notes !== undefined) {
    const error = validateText(body.notes, {
      field: 'Batch notes',
      max: LIMITS.batchNotes,
    });
    if (error) errors.push(error);
    else out.notes = cleanText(body.notes, LIMITS.batchNotes);
  }

  if (body.collectionDate !== undefined) {
    const parsed = parseDateTimeField(body.collectionDate, {
      field: 'Collection date',
      allowFuture: true,
    });
    if (parsed.error) errors.push(parsed.error);
    else out.collectionDate = parsed.value;
  }

  if (!partial || body.targetSamples !== undefined) {
    const parsed = parseNumberField(body.targetSamples, {
      field: 'Target samples',
      min: 1,
      max: LIMITS.targetSamples,
      integer: true,
    });
    if (parsed.error) errors.push(parsed.error);
    else out.targetSamples = parsed.value;
  }

  if (!partial || body.targetWeightKg !== undefined) {
    const parsed = parseNumberField(body.targetWeightKg, {
      field: 'Target weight',
      min: 0.000001,
      max: LIMITS.targetWeightKg,
    });
    if (parsed.error) errors.push(parsed.error);
    else out.targetWeightKg = parsed.value;
  }

  if (body.status !== undefined) {
    const status = normalizeBatchStatus(body.status);
    if (!status) errors.push(`Batch status must be one of: ${BATCH_STATUSES.join(', ')}`);
    else out.status = status;
  }

  return { out, errors };
}

function buildBatchFilter(userId, query = {}) {
  const filter = { user: userId };
  const term = String(query.q || '').trim().slice(0, 80);
  if (term) {
    const regex = new RegExp(escapeRegex(term), 'i');
    filter.$or = [
      { name: regex },
      { batchId: regex },
      { supplier: regex },
      { notes: regex },
    ];
  }
  if (query.status) {
    const status = normalizeBatchStatus(query.status, null);
    if (!status) return { error: 'Status filter must be open or completed' };
    filter.status = status;
  }

  const from = parseFilterDate(query.from, false);
  if (from.error) return { error: from.error };
  const to = parseFilterDate(query.to, true);
  if (to.error) return { error: to.error };
  if (from.value || to.value) {
    filter.collectionDate = {};
    if (from.value) filter.collectionDate.$gte = from.value;
    if (to.value) filter.collectionDate.$lte = to.value;
  }
  if (from.value && to.value && from.value > to.value) {
    return { error: 'The start date must be before the end date' };
  }

  return {
    filter,
    sort:
      query.sort === 'oldest'
        ? { createdAt: 1 }
        : query.sort === 'name'
        ? { name: 1 }
        : { createdAt: -1 },
  };
}

function summaryFromStats(statsMap) {
  const summary = {
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
  };
  statsMap.forEach((stats) => {
    summary.totalRecords += stats.totalRecords || 0;
    summary.completed += stats.completed || 0;
    summary.drafts += stats.drafts || 0;
    summary.reviewed += stats.reviewed || 0;
    summary.pendingReview += stats.pendingReview || 0;
    summary.flagged += stats.flagged || 0;
    summary.gradeA += stats.gradeA || 0;
    summary.gradeB += stats.gradeB || 0;
    summary.totalQuantity += stats.totalQuantity || 0;
    summary.totalWeightKg += stats.totalWeightKg || 0;
  });
  summary.totalQuantity = Math.round(summary.totalQuantity * 1000) / 1000;
  summary.totalWeightKg = Math.round(summary.totalWeightKg * 1000) / 1000;
  return summary;
}

// POST /api/manual/batches
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const fields = validateBatchFields(req.body);
    if (fields.errors.length) {
      return res.status(400).json({ error: fields.errors[0] });
    }
    const data = fields.out;
    const batch = await ManualBatch.create({
      name: data.name,
      supplier: data.supplier || '',
      notes: data.notes || '',
      collectionDate: data.collectionDate || null,
      targetSamples: data.targetSamples ?? null,
      targetWeightKg: data.targetWeightKg ?? null,
      status: data.status || 'open',
      user: req.user._id,
    });

    await logActivity({
      user: req.user,
      type: 'batch_created',
      message: `Manual batch ${batch.name} (${batch.batchId}) created.`,
      entityType: 'batch',
      entityId: String(batch._id),
      entityLabel: batch.batchId,
      batchCode: batch.batchId,
      metadata: {
        targetSamples: batch.targetSamples,
        targetWeightKg: batch.targetWeightKg,
        supplierEntered: Boolean(batch.supplier),
      },
    });

    return res.status(201).json({ success: true, batch: serializeBatch(batch, {}) });
  })
);

// GET /api/manual/batches
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const built = buildBatchFilter(req.user._id, req.query);
    if (built.error) return res.status(400).json({ error: built.error });
    const pageInfo = parsePagination(req.query, { page: 1, limit: 12 });

    const [batches, total, allBatches] = await Promise.all([
      ManualBatch.find(built.filter)
        .sort(built.sort)
        .skip(pageInfo.skip)
        .limit(pageInfo.limit),
      ManualBatch.countDocuments(built.filter),
      ManualBatch.find(built.filter).select('_id status'),
    ]);

    const statsMap = await getBatchStatsMap(
      req.user._id,
      allBatches.map((batch) => batch._id)
    );
    const summary = summaryFromStats(statsMap);
    summary.totalBatches = total;
    summary.open = allBatches.filter((batch) => batch.status === 'open').length;
    summary.completedBatches = allBatches.filter((batch) => batch.status === 'completed').length;

    return res.json({
      items: batches.map((batch) =>
        serializeBatch(batch, statsMap.get(String(batch._id)) || {})
      ),
      pagination: {
        page: pageInfo.page,
        limit: pageInfo.limit,
        total,
        pages: Math.max(1, Math.ceil(total / pageInfo.limit)),
      },
      summary,
    });
  })
);

// GET /api/manual/batches/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid batch ID' });
    }
    const batch = await ManualBatch.findOne({ _id: req.params.id, user: req.user._id });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const pageInfo = parsePagination(req.query, { page: 1, limit: 20 });
    const [records, total, statsMap] = await Promise.all([
      ManualGrade.find({ user: req.user._id, batch: batch._id })
        .sort({ gradedAt: -1, createdAt: -1 })
        .skip(pageInfo.skip)
        .limit(pageInfo.limit)
        .select('-corrections -assessmentToken'),
      ManualGrade.countDocuments({ user: req.user._id, batch: batch._id }),
      getBatchStatsMap(req.user._id, [batch._id]),
    ]);

    return res.json({
      batch: serializeBatch(batch, statsMap.get(String(batch._id)) || {}),
      records: records.map((record) => serializeRecord(record, { includeCorrections: false })),
      pagination: {
        page: pageInfo.page,
        limit: pageInfo.limit,
        total,
        pages: Math.max(1, Math.ceil(total / pageInfo.limit)),
      },
    });
  })
);

// PATCH /api/manual/batches/:id
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid batch ID' });
    }
    const batch = await ManualBatch.findOne({ _id: req.params.id, user: req.user._id });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const fields = validateBatchFields(req.body, { partial: true });
    if (fields.errors.length) return res.status(400).json({ error: fields.errors[0] });
    const data = fields.out;
    const changed = [];

    const addChange = (field, label, from, to) => {
      if (String(from ?? '') === String(to ?? '')) return;
      changed.push({ field, label, from: from ?? null, to: to ?? null });
    };

    if (data.name !== undefined) {
      addChange('name', 'Batch name', batch.name, data.name);
      batch.name = data.name;
    }
    if (data.supplier !== undefined) {
      addChange('supplier', 'Supplier', batch.supplier || '', data.supplier);
      batch.supplier = data.supplier;
    }
    if (data.notes !== undefined) {
      addChange('notes', 'Notes', batch.notes || '', data.notes);
      batch.notes = data.notes;
    }
    if (data.collectionDate !== undefined) {
      addChange(
        'collectionDate',
        'Collection date',
        batch.collectionDate ? batch.collectionDate.toISOString().slice(0, 10) : '',
        data.collectionDate ? data.collectionDate.toISOString().slice(0, 10) : ''
      );
      batch.collectionDate = data.collectionDate;
    }
    if (data.targetSamples !== undefined) {
      addChange('targetSamples', 'Target samples', batch.targetSamples, data.targetSamples);
      batch.targetSamples = data.targetSamples;
    }
    if (data.targetWeightKg !== undefined) {
      addChange('targetWeightKg', 'Target weight (kg)', batch.targetWeightKg, data.targetWeightKg);
      batch.targetWeightKg = data.targetWeightKg;
    }
    if (data.status !== undefined) {
      addChange('status', 'Status', batch.status, data.status);
      batch.status = data.status;
    }

    if (!changed.length) {
      return res.json({
        success: true,
        batch: serializeBatch(batch, (await getBatchStatsMap(req.user._id, [batch._id])).get(String(batch._id)) || {}),
        message: 'No changes were detected.',
      });
    }

    await batch.save();
    await logActivity({
      user: req.user,
      type: 'batch_updated',
      message: `Manual batch ${batch.name} (${batch.batchId}) updated.`,
      entityType: 'batch',
      entityId: String(batch._id),
      entityLabel: batch.batchId,
      batchCode: batch.batchId,
      metadata: { changedFields: changed.map((change) => change.field) },
    });

    const statsMap = await getBatchStatsMap(req.user._id, [batch._id]);
    return res.json({
      success: true,
      batch: serializeBatch(batch, statsMap.get(String(batch._id)) || {}),
    });
  })
);

// GET /api/manual/batches/:id/export.csv
router.get(
  '/:id/export.csv',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid batch ID' });
    }
    const batch = await ManualBatch.findOne({ _id: req.params.id, user: req.user._id });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const records = await ManualGrade.find({ user: req.user._id, batch: batch._id })
      .sort({ gradedAt: 1, createdAt: 1 })
      .select('-corrections -assessmentToken');
    const summary = summarizeRecords(records);

    const lines = [];
    lines.push('\ufeffManual arecanut batch export');
    lines.push(`Batch name,${csvEscape(batch.name)}`);
    lines.push(`Batch ID,${csvEscape(batch.batchId)}`);
    lines.push(`Supplier,${csvEscape(batch.supplier || '')}`);
    lines.push(
      `Collection date,${csvEscape(
        batch.collectionDate ? batch.collectionDate.toISOString().slice(0, 10) : ''
      )}`
    );
    lines.push(`Status,${csvEscape(batch.status)}`);
    lines.push(`Target samples,${csvEscape(batch.targetSamples ?? '')}`);
    lines.push(`Target weight (kg),${csvEscape(batch.targetWeightKg ?? '')}`);
    lines.push(`Saved records,${summary.totalRecords}`);
    lines.push(`Completed,${summary.completed}`);
    lines.push(`Drafts,${summary.drafts}`);
    lines.push(`Grade A,${summary.gradeA}`);
    lines.push(`Grade B,${summary.gradeB}`);
    lines.push(`Weight entered (kg),${summary.totalWeightKg}`);
    lines.push(`Generated,${csvEscape(new Date().toISOString())}`);
    lines.push(
      'Note,"All grades are manually assigned. Pending means a target was set and fewer records have been saved."'
    );
    lines.push('');
    lines.push(
      [
        'Grading record ID',
        'Sample code',
        'Status',
        'Manual grade',
        'Quantity',
        'Weight (kg)',
        'Size (mm)',
        'Visual condition',
        'Graded at',
        'Reviewer',
        'Review status',
        'Image flagged',
        'Observations',
        'Notes',
      ]
        .map(csvEscape)
        .join(',')
    );
    records.forEach((record) => {
      lines.push(
        [
          record.reportId,
          record.sampleCode || '',
          record.status,
          record.grade ? `Grade ${record.grade}` : '',
          record.quantity ?? '',
          record.weightKg ?? '',
          record.sizeMm ?? '',
          record.appearance || '',
          record.gradedAt ? record.gradedAt.toISOString() : '',
          record.reviewerName || '',
          record.review?.reviewed ? 'Reviewed' : 'Pending',
          record.review?.imageFlagged ? 'Yes' : 'No',
          record.observations || '',
          record.notes || '',
        ]
          .map(csvEscape)
          .join(',')
      );
    });

    await logActivity({
      user: req.user,
      type: 'batch_exported',
      message: `Batch ${batch.batchId} exported as CSV (${summary.totalRecords} records).`,
      entityType: 'batch',
      entityId: String(batch._id),
      entityLabel: batch.batchId,
      batchCode: batch.batchId,
      metadata: { format: 'csv', count: summary.totalRecords },
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="manual-batch-${String(batch.batchId).replace(
        /[^a-zA-Z0-9._-]/g,
        '_'
      )}.csv"`
    );
    return res.send(lines.join('\n'));
  })
);

// GET /api/manual/batches/:id/report.pdf
router.get(
  '/:id/report.pdf',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid batch ID' });
    }
    const batch = await ManualBatch.findOne({ _id: req.params.id, user: req.user._id });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const records = await ManualGrade.find({ user: req.user._id, batch: batch._id })
      .sort({ gradedAt: 1, createdAt: 1 })
      .select('-corrections -assessmentToken');
    const summary = summarizeBatch(batch, summarizeRecords(records));

    const pdf = await buildManualBatchPdf({
      batch: batch.toObject(),
      stats: summary,
      records: records.map((record) => record.toObject()),
      imageNote:
        'Images remain protected in the application and are not embedded in this batch PDF. Open an individual grading record to view or download its image report.',
    });

    await logActivity({
      user: req.user,
      type: 'batch_report_generated',
      message: `PDF report generated for manual batch ${batch.batchId}.`,
      entityType: 'batch',
      entityId: String(batch._id),
      entityLabel: batch.batchId,
      batchCode: batch.batchId,
      metadata: { format: 'pdf', count: summary.totalRecords },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="manual-batch-${String(batch.batchId).replace(
        /[^a-zA-Z0-9._-]/g,
        '_'
      )}.pdf"`
    );
    return res.send(pdf);
  })
);

// DELETE /api/manual/batches/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid batch ID' });
    }
    const batch = await ManualBatch.findOne({ _id: req.params.id, user: req.user._id });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    await ManualGrade.updateMany(
      { user: req.user._id, batch: batch._id },
      { $set: { batch: null } }
    );
    await batch.deleteOne();

    await logActivity({
      user: req.user,
      type: 'batch_deleted',
      message: `Manual batch ${batch.name} (${batch.batchId}) deleted. Its grading records were kept and unassigned.`,
      entityType: 'batch',
      entityId: String(batch._id),
      entityLabel: batch.batchId,
      batchCode: batch.batchId,
      metadata: { recordsPreserved: true },
    });

    return res.json({
      message: 'Batch deleted. Its grading records were kept and remain available without a batch.',
    });
  })
);

module.exports = router;
