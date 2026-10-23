'use strict';

const express = require('express');

const ActivityLog = require('../models/ActivityLog');
const { protect } = require('../middleware/authMiddleware');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination } = require('../utils/validation');
const { parseFilterDate } = require('../utils/manualValidation');
const { serializeActivity } = require('../services/manualService');

const router = express.Router();

router.use(protect);

// GET /api/manual/activity
// Audit entries are read-only through the API; there is intentionally no write route.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = { user: req.user._id };
    if (req.query.type) {
      const type = String(req.query.type).trim();
      if (!ActivityLog.TYPES.includes(type)) {
        return res.status(400).json({ error: 'Unknown activity type' });
      }
      filter.type = type;
    }

    const from = parseFilterDate(req.query.from, false);
    if (from.error) return res.status(400).json({ error: from.error });
    const to = parseFilterDate(req.query.to, true);
    if (to.error) return res.status(400).json({ error: to.error });
    if (from.value || to.value) {
      filter.createdAt = {};
      if (from.value) filter.createdAt.$gte = from.value;
      if (to.value) filter.createdAt.$lte = to.value;
    }
    if (from.value && to.value && from.value > to.value) {
      return res.status(400).json({ error: 'The start date must be before the end date' });
    }

    const pageInfo = parsePagination(req.query, { page: 1, limit: 25 });
    const [items, total, typeRows] = await Promise.all([
      ActivityLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(pageInfo.skip)
        .limit(pageInfo.limit),
      ActivityLog.countDocuments(filter),
      ActivityLog.aggregate([
        { $match: filter },
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    return res.json({
      items: items.map(serializeActivity),
      pagination: {
        page: pageInfo.page,
        limit: pageInfo.limit,
        total,
        pages: Math.max(1, Math.ceil(total / pageInfo.limit)),
      },
      summary: {
        total,
        types: typeRows.reduce((acc, row) => {
          acc[row._id] = row.count;
          return acc;
        }, {}),
      },
      availableTypes: ActivityLog.TYPES,
    });
  })
);

module.exports = router;
