'use strict';

const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const QRCode = require('qrcode');

const ManualGrade = require('../models/ManualGrade');
const ManualBatch = require('../models/ManualBatch');
const { protect } = require('../middleware/authMiddleware');
const asyncHandler = require('../utils/asyncHandler');
const { config } = require('../config');
const {
  ensureUploadDir,
  storedImageName,
  validateImageFile,
  resolveUploadFile,
  removeTempFile,
} = require('../utils/files');
const {
  LIMITS,
  normalizeGrade,
  normalizeStatus,
  cleanText,
  validateText,
  parseNumberField,
  parseDateTimeField,
  buildImageQuality,
  summarizeRecords,
  csvEscape,
  generateId,
  randomToken,
} = require('../utils/manualValidation');
const {
  serializeRecord,
  logActivity,
  buildRecordFilter,
  recordSummaryForFilter,
} = require('../services/manualService');
const {
  buildManualRecordPdf,
  buildManualAssessmentPdf,
} = require('../utils/manualPdf');

const router = express.Router();

ensureUploadDir();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ensureUploadDir()),
  filename: (_req, file, cb) => cb(null, storedImageName(file.mimetype, 'manual')),
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(String(file.mimetype).toLowerCase())) {
      const error = new Error('Only JPEG, PNG, or WebP images are allowed');
      error.statusCode = 400;
      return cb(error);
    }
    return cb(null, true);
  },
});

router.use(protect);

function rejectUpload(req, res, status, payload) {
  if (req.file) removeTempFile(req.file.path);
  return res.status(status).json(payload);
}

function displayName(user) {
  return user?.displayName || user?.username || 'User';
}

function userError(status, message) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

async function resolveBatch(userId, value) {
  if (value === undefined) return { provided: false, batch: null };
  if (value === null || value === '') return { provided: true, batch: null };
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return { provided: true, error: 'Select a valid batch' };
  }
  const batch = await ManualBatch.findOne({ _id: value, user: userId }).select(
    'batchId name status'
  );
  if (!batch) return { provided: true, error: 'Batch not found' };
  return { provided: true, batch };
}

function validateRecordFields(body, { partial = false } = {}) {
  const out = {};
  const errors = [];

  const textFields = [
    ['sampleCode', 'Sample code', LIMITS.sampleCode],
    ['reviewerName', 'Reviewer name', LIMITS.reviewerName],
    ['appearance', 'Visual condition', LIMITS.appearance],
    ['observations', 'Observations', LIMITS.observations],
    ['notes', 'Notes', LIMITS.notes],
  ];

  textFields.forEach(([field, label, max]) => {
    if (!partial || body[field] !== undefined) {
      const error = validateText(body[field], { field: label, max });
      if (error) errors.push(error);
      else out[field] = cleanText(body[field], max);
    }
  });

  if (!partial || body.quantity !== undefined) {
    const parsed = parseNumberField(body.quantity, {
      field: 'Quantity',
      min: 1,
      max: LIMITS.quantity,
      integer: true,
    });
    if (parsed.error) errors.push(parsed.error);
    else out.quantity = parsed.value;
  }

  if (!partial || body.weightKg !== undefined) {
    const parsed = parseNumberField(body.weightKg, {
      field: 'Weight',
      min: 0.000001,
      max: LIMITS.weightKg,
    });
    if (parsed.error) errors.push(parsed.error);
    else out.weightKg = parsed.value;
  }

  if (!partial || body.sizeMm !== undefined) {
    const parsed = parseNumberField(body.sizeMm, {
      field: 'Size',
      min: 0.1,
      max: LIMITS.sizeMm,
    });
    if (parsed.error) errors.push(parsed.error);
    else out.sizeMm = parsed.value;
  }

  if (!partial || body.gradedAt !== undefined) {
    const parsed = parseDateTimeField(body.gradedAt, {
      field: 'Grading date',
      required: false,
    });
    if (parsed.error) errors.push(parsed.error);
    else if (parsed.value) out.gradedAt = parsed.value;
  }

  if (body.grade !== undefined) {
    if (body.grade === '' || body.grade === null) out.grade = null;
    else {
      const grade = normalizeGrade(body.grade);
      if (!grade) errors.push('Grade must be A or B');
      else out.grade = grade;
    }
  }

  if (body.status !== undefined) {
    const status = normalizeStatus(body.status, 'completed');
    if (!status) errors.push('Status must be draft or completed');
    else out.status = status;
  }

  return { out, errors };
}

// POST /api/manual/records
router.post(
  '/',
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Upload an image using the "image" field.' });
    }

    try {
      const fileCheck = validateImageFile(req.file.path, req.file.mimetype);
      if (!fileCheck.valid) {
        return rejectUpload(req, res, 400, { error: fileCheck.error });
      }

      const fields = validateRecordFields(req.body);
      if (fields.errors.length) {
        return rejectUpload(req, res, 400, { error: fields.errors[0] });
      }
      const data = fields.out;
      const status = data.status || 'completed';
      const grade = data.grade ?? null;
      if (status === 'completed' && !grade) {
        return rejectUpload(req, res, 400, {
          error: 'Select Grade A or Grade B before completing this record.',
        });
      }

      const batchResult = await resolveBatch(req.user._id, req.body.batch);
      if (batchResult.error) {
        return rejectUpload(req, res, 400, { error: batchResult.error });
      }

      const fileBuffer = fs.readFileSync(req.file.path);
      const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const allowDuplicate =
        req.body.allowDuplicate === true || req.body.allowDuplicate === 'true';

      if (!allowDuplicate) {
        const existing = await ManualGrade.findOne({
          user: req.user._id,
          'image.hash': hash,
        })
          .select('reportId sampleCode batchCode batchName batch createdAt')
          .populate('batch', 'batchId name');
        if (existing) {
          return rejectUpload(req, res, 409, {
            error:
              'This exact image is already saved. Open the existing record or upload it intentionally as a new record.',
            duplicate: {
              id: String(existing._id),
              reportId: existing.reportId,
              sampleCode: existing.sampleCode || '',
              batch: existing.batch
                ? {
                    id: String(existing.batch._id),
                    batchId: existing.batch.batchId,
                    name: existing.batch.name,
                  }
                : existing.batchCode
                ? { id: null, batchId: existing.batchCode, name: existing.batchName || '' }
                : null,
              createdAt: existing.createdAt,
            },
          });
        }
      }

      const quality = buildImageQuality(req.body.imageQuality);
      const record = await ManualGrade.create({
        user: req.user._id,
        batch: batchResult.batch?._id || null,
        batchCode: batchResult.batch?.batchId || '',
        batchName: batchResult.batch?.name || '',
        sampleCode: data.sampleCode || '',
        image: {
          filename: req.file.filename,
          originalName: String(req.file.originalname || '').slice(0, 255),
          mime: fileCheck.mime || req.file.mimetype,
          size: req.file.size,
          width: quality?.width ?? null,
          height: quality?.height ?? null,
          hash,
        },
        grade,
        status,
        quantity: data.quantity ?? null,
        weightKg: data.weightKg ?? null,
        sizeMm: data.sizeMm ?? null,
        appearance: data.appearance || '',
        gradedAt: data.gradedAt || new Date(),
        reviewerName: data.reviewerName || '',
        observations: data.observations || '',
        notes: data.notes || '',
        imageQuality: quality || undefined,
      });

      await logActivity({
        user: req.user,
        type: 'record_created',
        message: `Manual grading record ${record.reportId} created${
          record.batchName ? ` in ${record.batchName}` : ''
        }.`,
        entityType: 'grading_record',
        entityId: String(record._id),
        entityLabel: record.reportId,
        batchCode: record.batchCode,
        metadata: {
          grade: record.grade,
          status: record.status,
          quantity: record.quantity,
          weightKg: record.weightKg,
          duplicateOverride: allowDuplicate,
        },
      });

      return res.status(201).json({
        success: true,
        record: serializeRecord(record, { includeCorrections: true }),
      });
    } catch (error) {
      if (req.file) removeTempFile(req.file.path);
      throw error;
    }
  })
);

// GET /api/manual/records
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const built = await buildRecordFilter(req.user._id, req.query);
    if (built.error) return res.status(400).json({ error: built.error });

    const [records, summary] = await Promise.all([
      ManualGrade.find(built.filter)
        .sort(built.sort)
        .skip(built.skip)
        .limit(built.limit)
        .select('-corrections -assessmentToken'),
      recordSummaryForFilter(built.filter),
    ]);

    const total = summary.total || 0;
    return res.json({
      items: records.map((record) => serializeRecord(record, { includeCorrections: false })),
      pagination: {
        page: built.page,
        limit: built.limit,
        total,
        pages: Math.max(1, Math.ceil(total / built.limit)),
      },
      summary,
    });
  })
);

// GET /api/manual/records/export.csv
router.get(
  '/export.csv',
  asyncHandler(async (req, res) => {
    const built = await buildRecordFilter(req.user._id, req.query);
    if (built.error) return res.status(400).json({ error: built.error });

    const records = await ManualGrade.find(built.filter)
      .sort({ gradedAt: 1, createdAt: 1 })
      .limit(5000)
      .select('-corrections -assessmentToken');
    const summary = summarizeRecords(records);

    const lines = [];
    lines.push('\ufeffManual arecanut grading export');
    lines.push(`Generated,${csvEscape(new Date().toISOString())}`);
    lines.push(`Records,${summary.totalRecords}`);
    lines.push(`Completed,${summary.completed}`);
    lines.push(`Drafts,${summary.drafts}`);
    lines.push(`Grade A,${summary.gradeA}`);
    lines.push(`Grade B,${summary.gradeB}`);
    lines.push(`Weight entered (kg),${summary.totalWeightKg}`);
    lines.push(
      'Note,"All grades are manually assigned by the user. Empty values were not entered."'
    );
    lines.push('');
    lines.push(
      [
        'Grading record ID',
        'Sample code',
        'Batch name',
        'Batch ID',
        'Status',
        'Manual grade',
        'Quantity',
        'Weight (kg)',
        'Size (mm)',
        'Visual condition',
        'Graded at',
        'Reviewer',
        'Review status',
        'Reviewed by',
        'Image flagged',
        'Observations',
        'Notes',
        'Created at',
      ]
        .map(csvEscape)
        .join(',')
    );

    records.forEach((record) => {
      lines.push(
        [
          record.reportId,
          record.sampleCode || '',
          record.batchName || '',
          record.batchCode || '',
          record.status,
          record.grade ? `Grade ${record.grade}` : '',
          record.quantity ?? '',
          record.weightKg ?? '',
          record.sizeMm ?? '',
          record.appearance || '',
          record.gradedAt ? record.gradedAt.toISOString() : '',
          record.reviewerName || '',
          record.review?.reviewed ? 'Reviewed' : 'Pending',
          record.review?.reviewedByName || '',
          record.review?.imageFlagged ? 'Yes' : 'No',
          record.observations || '',
          record.notes || '',
          record.createdAt ? record.createdAt.toISOString() : '',
        ]
          .map(csvEscape)
          .join(',')
      );
    });

    await logActivity({
      user: req.user,
      type: 'record_exported',
      message: `Exported ${summary.totalRecords} manual grading record(s) as CSV.`,
      entityType: 'export',
      entityLabel: 'Manual grading CSV',
      metadata: { format: 'csv', count: summary.totalRecords },
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="manual-grading-records-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`
    );
    return res.send(lines.join('\n'));
  })
);

// GET /api/manual/records/compare?ids=id1,id2
router.get(
  '/compare',
  asyncHandler(async (req, res) => {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const unique = [...new Set(ids)];
    if (unique.length !== 2 || unique.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      return res.status(400).json({ error: 'Select exactly two valid grading records' });
    }

    const records = await ManualGrade.find({
      _id: { $in: unique },
      user: req.user._id,
    })
      .select('-assessmentToken -corrections')
      .populate('batch', 'batchId name');

    if (records.length !== 2) {
      return res.status(404).json({ error: 'One or both grading records could not be found' });
    }
    const byId = new Map(records.map((record) => [String(record._id), record]));
    return res.json({
      items: unique.map((id) => serializeRecord(byId.get(id), { includeCorrections: false })),
    });
  })
);

// GET /api/manual/records/duplicates
router.get(
  '/duplicates',
  asyncHandler(async (req, res) => {
    const groups = await ManualGrade.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(req.user._id),
          'image.hash': { $nin: ['', null] },
        },
      },
      {
        $group: {
          _id: '$image.hash',
          count: { $sum: 1 },
          records: {
            $push: {
              id: '$_id',
              reportId: '$reportId',
              sampleCode: '$sampleCode',
              batchCode: '$batchCode',
              batchName: '$batchName',
              grade: '$grade',
              createdAt: '$createdAt',
            },
          },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 50 },
    ]);

    return res.json({
      groups: groups.map((group) => ({
        hash: group._id,
        count: group.count,
        items: group.records.map((record) => ({
          id: String(record.id),
          reportId: record.reportId,
          sampleCode: record.sampleCode || '',
          batchCode: record.batchCode || '',
          batchName: record.batchName || '',
          grade: record.grade || null,
          createdAt: record.createdAt,
        })),
      })),
      note: 'Groups contain files with identical SHA-256 content. Visually similar but different photos are not treated as duplicates.',
    });
  })
);

// GET /api/manual/records/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid grading record ID' });
    }
    const record = await ManualGrade.findOne({ _id: req.params.id, user: req.user._id })
      .select('+assessmentToken')
      .populate('batch', 'batchId name status');
    if (!record) return res.status(404).json({ error: 'Grading record not found' });
    return res.json({
      record: serializeRecord(record, {
        includeCorrections: true,
        includeAssessmentToken: true,
      }),
    });
  })
);

// PATCH /api/manual/records/:id
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid grading record ID' });
    }
    const record = await ManualGrade.findOne({ _id: req.params.id, user: req.user._id }).select(
      '+assessmentToken'
    );
    if (!record) return res.status(404).json({ error: 'Grading record not found' });

    const fields = validateRecordFields(req.body, { partial: true });
    if (fields.errors.length) return res.status(400).json({ error: fields.errors[0] });
    const data = fields.out;

    const reasonError = validateText(req.body.correctionReason, {
      field: 'Correction reason',
      max: LIMITS.correctionReason,
    });
    if (reasonError) return res.status(400).json({ error: reasonError });
    const correctionReason = cleanText(req.body.correctionReason, LIMITS.correctionReason);

    const changes = [];
    const addChange = (field, label, from, to) => {
      const fromValue = from instanceof Date ? from.toISOString() : from;
      const toValue = to instanceof Date ? to.toISOString() : to;
      if (String(fromValue ?? '') === String(toValue ?? '')) return;
      changes.push({ field, label, from: fromValue ?? null, to: toValue ?? null });
    };

    const nextGrade = data.grade !== undefined ? data.grade : record.grade;
    const nextStatus = data.status !== undefined ? data.status : record.status;
    const gradeChanged = record.grade !== nextGrade;
    if (nextStatus === 'completed' && !nextGrade) {
      return res.status(400).json({
        error: 'Select Grade A or Grade B before completing this record.',
      });
    }
    if (gradeChanged && correctionReason.length < 3) {
      return res.status(400).json({
        error: 'Provide a correction reason of at least 3 characters when changing a grade.',
      });
    }

    if (data.grade !== undefined) {
      addChange(
        'grade',
        'Manual grade',
        record.grade ? `Grade ${record.grade}` : 'Not graded',
        data.grade ? `Grade ${data.grade}` : 'Not graded'
      );
      record.grade = data.grade;
    }
    if (data.status !== undefined) {
      addChange('status', 'Status', record.status, data.status);
      record.status = data.status;
    }
    if (data.sampleCode !== undefined) {
      addChange('sampleCode', 'Sample code', record.sampleCode || '', data.sampleCode);
      record.sampleCode = data.sampleCode;
    }
    if (data.quantity !== undefined) {
      addChange('quantity', 'Quantity', record.quantity, data.quantity);
      record.quantity = data.quantity;
    }
    if (data.weightKg !== undefined) {
      addChange('weightKg', 'Weight (kg)', record.weightKg, data.weightKg);
      record.weightKg = data.weightKg;
    }
    if (data.sizeMm !== undefined) {
      addChange('sizeMm', 'Size (mm)', record.sizeMm, data.sizeMm);
      record.sizeMm = data.sizeMm;
    }
    if (data.appearance !== undefined) {
      addChange('appearance', 'Visual condition', record.appearance || '', data.appearance);
      record.appearance = data.appearance;
    }
    if (data.gradedAt !== undefined) {
      addChange('gradedAt', 'Grading date', record.gradedAt, data.gradedAt);
      record.gradedAt = data.gradedAt;
    }
    if (data.reviewerName !== undefined) {
      addChange('reviewerName', 'Reviewer', record.reviewerName || '', data.reviewerName);
      record.reviewerName = data.reviewerName;
    }
    if (data.observations !== undefined) {
      addChange('observations', 'Observations', record.observations || '', data.observations);
      record.observations = data.observations;
    }
    if (data.notes !== undefined) {
      addChange('notes', 'Notes', record.notes || '', data.notes);
      record.notes = data.notes;
    }

    if (req.body.batch !== undefined) {
      const batchResult = await resolveBatch(req.user._id, req.body.batch);
      if (batchResult.error) return res.status(400).json({ error: batchResult.error });
      addChange(
        'batch',
        'Batch',
        record.batchCode || '',
        batchResult.batch?.batchId || ''
      );
      record.batch = batchResult.batch?._id || null;
      if (batchResult.batch) {
        record.batchCode = batchResult.batch.batchId;
        record.batchName = batchResult.batch.name;
      } else {
        // Explicitly removing a record from a batch must clear the live snapshot.
        // Deleted batches intentionally keep their snapshot; explicit unassignment does not.
        record.batchCode = '';
        record.batchName = '';
      }
    }

    if (gradeChanged) {
      if (record.review.reviewed) {
        changes.push({
          field: 'review.reviewed',
          label: 'Review status',
          from: 'Reviewed',
          to: 'Needs re-review',
        });
      }
      record.review.reviewed = false;
      record.review.reviewedAt = null;
    }

    if (!changes.length) {
      return res.json({
        success: true,
        record: serializeRecord(record, {
          includeCorrections: true,
          includeAssessmentToken: true,
        }),
        message: 'No changes were detected.',
      });
    }

    record.corrections.push({
      action: gradeChanged ? 'grade-correction' : 'update',
      at: new Date(),
      by: req.user._id,
      byName: displayName(req.user),
      reason: correctionReason,
      changes,
    });

    await record.save();

    await logActivity({
      user: req.user,
      type: gradeChanged ? 'record_corrected' : 'record_updated',
      message: `Manual grading record ${record.reportId} ${
        gradeChanged ? 'corrected' : 'updated'
      }.`,
      entityType: 'grading_record',
      entityId: String(record._id),
      entityLabel: record.reportId,
      batchCode: record.batchCode,
      metadata: {
        changedFields: changes.map((change) => change.field),
        grade: record.grade,
        reasonProvided: Boolean(correctionReason),
      },
    });

    const populated = await ManualGrade.findById(record._id)
      .select('+assessmentToken')
      .populate('batch', 'batchId name status');

    return res.json({
      success: true,
      record: serializeRecord(populated, {
        includeCorrections: true,
        includeAssessmentToken: true,
      }),
    });
  })
);

// POST /api/manual/records/:id/review
router.post(
  '/:id/review',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid grading record ID' });
    }
    const record = await ManualGrade.findOne({ _id: req.params.id, user: req.user._id }).select(
      '+assessmentToken'
    );
    if (!record) return res.status(404).json({ error: 'Grading record not found' });

    const notesError = validateText(req.body.notes, {
      field: 'Review notes',
      max: LIMITS.reviewNotes,
    });
    if (notesError) return res.status(400).json({ error: notesError });

    const changes = [];
    const addChange = (field, label, from, to) => {
      if (String(from ?? '') === String(to ?? '')) return;
      changes.push({ field, label, from, to });
    };

    if (req.body.reviewed !== undefined) {
      const reviewed = req.body.reviewed === true || req.body.reviewed === 'true';
      addChange('review.reviewed', 'Reviewed', record.review.reviewed, reviewed);
      record.review.reviewed = reviewed;
      record.review.reviewedAt = reviewed ? new Date() : null;
      record.review.reviewedByName = reviewed ? displayName(req.user) : '';
    }
    if (req.body.notes !== undefined) {
      const notes = cleanText(req.body.notes, LIMITS.reviewNotes);
      addChange('review.notes', 'Review notes', record.review.notes || '', notes);
      record.review.notes = notes;
    }
    if (req.body.imageFlagged !== undefined) {
      const flagged = req.body.imageFlagged === true || req.body.imageFlagged === 'true';
      addChange('review.imageFlagged', 'Image flagged', record.review.imageFlagged, flagged);
      record.review.imageFlagged = flagged;
    }

    if (!changes.length) {
      return res.json({
        success: true,
        record: serializeRecord(record, {
          includeCorrections: true,
          includeAssessmentToken: true,
        }),
        message: 'No review changes were detected.',
      });
    }

    const flagChanged = changes.some(
      (change) => change.field === 'review.imageFlagged' && change.to === true
    );

    record.corrections.push({
      action: 'review',
      at: new Date(),
      by: req.user._id,
      byName: displayName(req.user),
      reason: cleanText(req.body.reason, LIMITS.reviewNotes),
      changes,
    });
    await record.save();

    await logActivity({
      user: req.user,
      type: flagChanged ? 'record_flagged' : 'record_reviewed',
      message: `Manual grading record ${record.reportId} ${
        flagChanged ? 'had its image flagged' : 'review details were updated'
      }.`,
      entityType: 'grading_record',
      entityId: String(record._id),
      entityLabel: record.reportId,
      batchCode: record.batchCode,
      metadata: {
        reviewed: record.review.reviewed,
        imageFlagged: record.review.imageFlagged,
      },
    });

    const populated = await ManualGrade.findById(record._id)
      .select('+assessmentToken')
      .populate('batch', 'batchId name status');
    return res.json({
      success: true,
      record: serializeRecord(populated, {
        includeCorrections: true,
        includeAssessmentToken: true,
      }),
    });
  })
);

// DELETE /api/manual/records/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid grading record ID' });
    }
    const record = await ManualGrade.findOne({ _id: req.params.id, user: req.user._id });
    if (!record) return res.status(404).json({ error: 'Grading record not found' });

    const snapshot = {
      reportId: record.reportId,
      batchCode: record.batchCode,
      batchName: record.batchName,
      filename: record.image?.filename,
    };
    await record.deleteOne();
    if (snapshot.filename) {
      const { unlinkUploadFile } = require('../utils/files');
      unlinkUploadFile(snapshot.filename);
    }

    await logActivity({
      user: req.user,
      type: 'record_deleted',
      message: `Manual grading record ${snapshot.reportId} deleted.`,
      entityType: 'grading_record',
      entityId: String(record._id),
      entityLabel: snapshot.reportId,
      batchCode: snapshot.batchCode,
      metadata: { batchName: snapshot.batchName },
    });

    return res.json({ message: 'Grading record and stored image deleted.' });
  })
);

// GET /api/manual/records/:id/image
router.get(
  '/:id/image',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid grading record ID' });
    }
    const record = await ManualGrade.findOne({ _id: req.params.id, user: req.user._id }).select(
      'image'
    );
    if (!record) return res.status(404).json({ error: 'Grading record not found' });
    const resolved = resolveUploadFile(record.image?.filename);
    if (!resolved) return res.status(404).json({ error: 'Stored image not found' });
    res.setHeader('Content-Type', record.image.mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', 'inline');
    return res.sendFile(resolved);
  })
);

// GET /api/manual/records/:id/report.pdf
router.get(
  '/:id/report.pdf',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid grading record ID' });
    }
    const record = await ManualGrade.findOne({ _id: req.params.id, user: req.user._id })
      .populate('batch', 'batchId name supplier collectionDate status targetSamples targetWeightKg notes');
    if (!record) return res.status(404).json({ error: 'Grading record not found' });

    let imageBuffer = null;
    const resolved = resolveUploadFile(record.image?.filename);
    if (resolved) {
      try {
        imageBuffer = fs.readFileSync(resolved);
      } catch {
        imageBuffer = null;
      }
    }

    const pdf = await buildManualRecordPdf({
      record: record.toObject(),
      batch: record.batch && record.batch._id ? record.batch : null,
      imageBuffer,
    });

    await logActivity({
      user: req.user,
      type: 'record_report_generated',
      message: `PDF report generated for manual grading record ${record.reportId}.`,
      entityType: 'grading_record',
      entityId: String(record._id),
      entityLabel: record.reportId,
      batchCode: record.batchCode,
      metadata: { format: 'pdf' },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="manual-grading-record-${String(record.reportId).replace(
        /[^a-zA-Z0-9._-]/g,
        '_'
      )}.pdf"`
    );
    return res.send(pdf);
  })
);

function assessmentVerifyUrl(token) {
  return `${String(config.frontendUrl || 'http://localhost:5173').replace(/\/$/, '')}/verify/${token}`;
}

async function ensureAssessment(record) {
  let created = false;
  if (!record.assessment?.id) {
    record.assessment = {
      id: generateId('ASSESS', 4),
      issuedAt: new Date(),
    };
    created = true;
  }
  if (!record.assessmentToken) {
    record.assessmentToken = randomToken();
    created = true;
  }
  if (created) await record.save();
  return created;
}

// POST /api/manual/records/:id/assessment
router.post(
  '/:id/assessment',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid grading record ID' });
    }
    const record = await ManualGrade.findOne({ _id: req.params.id, user: req.user._id }).select(
      '+assessmentToken'
    );
    if (!record) return res.status(404).json({ error: 'Grading record not found' });
    if (!record.grade) {
      return res.status(400).json({ error: 'Assign a manual grade before creating an assessment.' });
    }

    await ensureAssessment(record);
    return res.json({
      success: true,
      assessment: {
        id: record.assessment.id,
        issuedAt: record.assessment.issuedAt,
        verifyPath: `/verify/${record.assessmentToken}`,
        verifyUrl: assessmentVerifyUrl(record.assessmentToken),
      },
    });
  })
);

// GET /api/manual/records/:id/assessment.pdf
router.get(
  '/:id/assessment.pdf',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid grading record ID' });
    }
    const record = await ManualGrade.findOne({ _id: req.params.id, user: req.user._id })
      .select('+assessmentToken')
      .populate('batch', 'batchId name supplier collectionDate status');
    if (!record) return res.status(404).json({ error: 'Grading record not found' });
    if (!record.grade) {
      return res.status(400).json({ error: 'Assign a manual grade before creating an assessment.' });
    }

    const created = await ensureAssessment(record);
    const verifyUrl = assessmentVerifyUrl(record.assessmentToken);
    const qrBuffer = await QRCode.toBuffer(verifyUrl, {
      type: 'png',
      margin: 1,
      width: 180,
      errorCorrectionLevel: 'M',
    });

    let imageBuffer = null;
    const resolved = resolveUploadFile(record.image?.filename);
    if (resolved) {
      try {
        imageBuffer = fs.readFileSync(resolved);
      } catch {
        imageBuffer = null;
      }
    }

    const pdf = await buildManualAssessmentPdf({
      record: record.toObject(),
      batch: record.batch && record.batch._id ? record.batch : null,
      assessment: {
        id: record.assessment.id,
        issuedAt: record.assessment.issuedAt,
      },
      verifyUrl,
      qrBuffer,
      imageBuffer,
    });

    await logActivity({
      user: req.user,
      type: 'assessment_generated',
      message: `Digital grading assessment ${record.assessment.id} generated for ${record.reportId}.`,
      entityType: 'assessment',
      entityId: String(record._id),
      entityLabel: record.assessment.id,
      batchCode: record.batchCode,
      metadata: { recordId: record.reportId, firstIssue: created },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="manual-grading-assessment-${String(
        record.assessment.id
      ).replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf"`
    );
    return res.send(pdf);
  })
);

module.exports = router;
