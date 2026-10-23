'use strict';

const express = require('express');

const ManualGrade = require('../models/ManualGrade');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// GET /api/verify/:token
// Public, deliberately limited verification. No image, notes, supplier, or account data.
router.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const token = String(req.params.token || '').trim();
    res.setHeader('Cache-Control', 'no-store');
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return res.status(404).json({ error: 'Assessment not found or verification link is invalid.' });
    }

    const record = await ManualGrade.findOne({ assessmentToken: token }).select(
      'reportId grade status assessment batchCode gradedAt review'
    );
    if (!record || !record.assessment?.id) {
      return res.status(404).json({ error: 'Assessment not found or verification link is invalid.' });
    }

    return res.json({
      valid: true,
      assessment: {
        id: record.assessment.id,
        issuedAt: record.assessment.issuedAt,
        recordId: record.reportId,
        grade: record.grade ? `Grade ${record.grade}` : null,
        status: record.status,
        batchCode: record.batchCode || '',
        gradedAt: record.gradedAt,
        reviewed: Boolean(record.review?.reviewed),
        imageFlagged: Boolean(record.review?.imageFlagged),
      },
      notice:
        'This is an application-generated grading assessment with a manually selected grade. It is not an officially accredited certificate.',
      privacy:
        'Verification intentionally excludes stored images, notes, supplier details, and account information.',
    });
  })
);

module.exports = router;
