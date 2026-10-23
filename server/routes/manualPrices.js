'use strict';

const express = require('express');
const mongoose = require('mongoose');

const PriceRecord = require('../models/PriceRecord');
const { protect } = require('../middleware/authMiddleware');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination } = require('../utils/validation');
const {
  LIMITS,
  normalizeGrade,
  cleanText,
  validateText,
  parseNumberField,
  parseDateTimeField,
  parseFilterDate,
  calculateEstimatedValue,
  csvEscape,
  escapeRegex,
  round2,
} = require('../utils/manualValidation');
const { serializePrice, logActivity } = require('../services/manualService');

const router = express.Router();

router.use(protect);

function buildPriceFilter(userId, query = {}) {
  const filter = { user: userId };
  if (query.grade) {
    const grade = normalizeGrade(query.grade);
    if (!grade) return { error: 'Grade filter must be A or B' };
    filter.grade = grade;
  }
  const market = String(query.market || '').trim().slice(0, 80);
  if (market) {
    filter.marketName = { $regex: new RegExp(escapeRegex(market), 'i') };
  }
  const from = parseFilterDate(query.from, false);
  if (from.error) return { error: from.error };
  const to = parseFilterDate(query.to, true);
  if (to.error) return { error: to.error };
  if (from.value || to.value) {
    filter.priceDate = {};
    if (from.value) filter.priceDate.$gte = from.value;
    if (to.value) filter.priceDate.$lte = to.value;
  }
  if (from.value && to.value && from.value > to.value) {
    return { error: 'The start date must be before the end date' };
  }

  const sort =
    query.sort === 'oldest'
      ? { priceDate: 1, createdAt: 1 }
      : query.sort === 'price_low'
      ? { pricePerKg: 1 }
      : query.sort === 'price_high'
      ? { pricePerKg: -1 }
      : { priceDate: -1, createdAt: -1 };
  return { filter, sort };
}

// POST /api/manual/prices
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const grade = normalizeGrade(req.body.grade);
    if (!grade) return res.status(400).json({ error: 'Select Grade A or Grade B' });

    const marketError = validateText(req.body.marketName, {
      field: 'Market name',
      max: LIMITS.marketName,
    });
    if (marketError) return res.status(400).json({ error: marketError });
    const notesError = validateText(req.body.notes, {
      field: 'Notes',
      max: LIMITS.priceNotes,
    });
    if (notesError) return res.status(400).json({ error: notesError });

    const weight = parseNumberField(req.body.weightKg, {
      field: 'Batch weight',
      min: 0.000001,
      max: LIMITS.weightKg,
      required: true,
    });
    if (weight.error) return res.status(400).json({ error: weight.error });
    const price = parseNumberField(req.body.pricePerKg, {
      field: 'Price per kg',
      min: 0.000001,
      max: LIMITS.pricePerKg,
      required: true,
    });
    if (price.error) return res.status(400).json({ error: price.error });

    const priceDate = parseDateTimeField(req.body.priceDate, {
      field: 'Price date',
      allowFuture: false,
    });
    if (priceDate.error) return res.status(400).json({ error: priceDate.error });

    const currency = String(req.body.currency || 'INR').trim().toUpperCase().slice(0, 8) || 'INR';
    if (!/^[A-Z]{2,8}$/.test(currency)) {
      return res.status(400).json({ error: 'Currency must be a 2-8 letter code such as INR' });
    }

    const valuation = calculateEstimatedValue(weight.value, price.value);
    const record = await PriceRecord.create({
      user: req.user._id,
      marketName: cleanText(req.body.marketName, LIMITS.marketName),
      grade,
      weightKg: weight.value,
      pricePerKg: price.value,
      value: valuation.value,
      currency,
      priceDate: priceDate.value || new Date(),
      notes: cleanText(req.body.notes, LIMITS.priceNotes),
    });

    await logActivity({
      user: req.user,
      type: 'price_created',
      message: `Saved price record for Grade ${grade} at ${
        record.marketName || 'an unnamed market'
      }.`,
      entityType: 'price_record',
      entityId: String(record._id),
      entityLabel: `${currency} ${record.pricePerKg}/kg`,
      metadata: {
        grade,
        weightKg: record.weightKg,
        pricePerKg: record.pricePerKg,
        value: record.value,
      },
    });

    return res.status(201).json({
      success: true,
      price: serializePrice(record),
      note: 'The estimated value uses only the weight and price you entered. No live market price was used.',
    });
  })
);

// GET /api/manual/prices
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const built = buildPriceFilter(req.user._id, req.query);
    if (built.error) return res.status(400).json({ error: built.error });
    const pageInfo = parsePagination(req.query, { page: 1, limit: 20 });

    const [items, total, aggregates] = await Promise.all([
      PriceRecord.find(built.filter)
        .sort(built.sort)
        .skip(pageInfo.skip)
        .limit(pageInfo.limit),
      PriceRecord.countDocuments(built.filter),
      PriceRecord.aggregate([
        { $match: built.filter },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalWeightKg: { $sum: '$weightKg' },
            totalValue: { $sum: '$value' },
            avgPricePerKg: { $avg: '$pricePerKg' },
            gradeA: { $sum: { $cond: [{ $eq: ['$grade', 'A'] }, 1, 0] } },
            gradeB: { $sum: { $cond: [{ $eq: ['$grade', 'B'] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const summary = aggregates[0]
      ? {
          count: aggregates[0].count,
          totalWeightKg: round2(aggregates[0].totalWeightKg),
          totalValue: round2(aggregates[0].totalValue),
          avgPricePerKg: round2(aggregates[0].avgPricePerKg),
          gradeA: aggregates[0].gradeA,
          gradeB: aggregates[0].gradeB,
        }
      : {
          count: 0,
          totalWeightKg: 0,
          totalValue: 0,
          avgPricePerKg: null,
          gradeA: 0,
          gradeB: 0,
        };

    return res.json({
      items: items.map(serializePrice),
      pagination: {
        page: pageInfo.page,
        limit: pageInfo.limit,
        total,
        pages: Math.max(1, Math.ceil(total / pageInfo.limit)),
      },
      summary,
      note: 'Prices are user-provided. The application does not fetch or fabricate live market prices.',
    });
  })
);

// GET /api/manual/prices/export.csv
router.get(
  '/export.csv',
  asyncHandler(async (req, res) => {
    const built = buildPriceFilter(req.user._id, req.query);
    if (built.error) return res.status(400).json({ error: built.error });
    const records = await PriceRecord.find(built.filter)
      .sort({ priceDate: 1, createdAt: 1 })
      .limit(5000);

    const lines = [];
    lines.push('\ufeffUser-provided arecanut price records');
    lines.push(`Generated,${csvEscape(new Date().toISOString())}`);
    lines.push(
      'Note,"Estimated value is weight in kilograms multiplied by the user-provided price per kilogram. Prices are not live market data."'
    );
    lines.push('');
    lines.push(
      [
        'Price record ID',
        'Price date',
        'Market name',
        'Manual grade',
        'Weight (kg)',
        'Price per kg',
        'Currency',
        'Estimated value',
        'Notes',
        'Created at',
      ]
        .map(csvEscape)
        .join(',')
    );
    records.forEach((record) => {
      lines.push(
        [
          String(record._id),
          record.priceDate ? record.priceDate.toISOString() : '',
          record.marketName || '',
          `Grade ${record.grade}`,
          record.weightKg,
          record.pricePerKg,
          record.currency,
          record.value,
          record.notes || '',
          record.createdAt ? record.createdAt.toISOString() : '',
        ]
          .map(csvEscape)
          .join(',')
      );
    });

    await logActivity({
      user: req.user,
      type: 'price_exported',
      message: `Exported ${records.length} user-provided price record(s).`,
      entityType: 'export',
      entityLabel: 'Price records CSV',
      metadata: { count: records.length, format: 'csv' },
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="manual-price-records-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`
    );
    return res.send(lines.join('\n'));
  })
);

// DELETE /api/manual/prices/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid price record ID' });
    }
    const record = await PriceRecord.findOne({ _id: req.params.id, user: req.user._id });
    if (!record) return res.status(404).json({ error: 'Price record not found' });
    await record.deleteOne();
    await logActivity({
      user: req.user,
      type: 'price_deleted',
      message: `User-provided price record for Grade ${record.grade} deleted.`,
      entityType: 'price_record',
      entityId: String(record._id),
      entityLabel: `${record.currency} ${record.pricePerKg}/kg`,
      metadata: { grade: record.grade },
    });
    return res.json({ message: 'Price record deleted.' });
  })
);

module.exports = router;
