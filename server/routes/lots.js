'use strict';

const express = require('express');
const mongoose = require('mongoose');

const Lot = require('../models/Lot');
const Scan = require('../models/Scan');
const { protect } = require('../middleware/authMiddleware');
const asyncHandler = require('../utils/asyncHandler');
const { serializeScan } = require('../services/scanService');
const { serializeLotSummary, aggregateScans, computeValuation } = require('../services/lotService');

const router = express.Router();

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildLotQuery(userId, query = {}) {
  const filter = { user: userId };
  if (query.q) {
    const term = String(query.q).trim().slice(0, 80);
    if (term) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { reference: { $regex: escaped, $options: 'i' } },
        { supplier: { $regex: escaped, $options: 'i' } },
      ];
    }
  }
  return filter;
}

router.use(protect);

// POST /api/lots
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Lot name is required' });
    }
    if (name.length > 80) {
      return res.status(400).json({ error: 'Lot name must be 80 characters or less' });
    }

    const prices = {
      A: Math.max(0, Number(req.body?.prices?.A || 0) || 0),
      B: Math.max(0, Number(req.body?.prices?.B || 0) || 0),
      C: Math.max(0, Number(req.body?.prices?.C || 0) || 0),
      D: Math.max(0, Number(req.body?.prices?.D || 0) || 0),
    };
    const avgNutWeightG = Math.max(0, Number(req.body.avgNutWeightG || 0) || 0);
    if (avgNutWeightG > 1000) {
      return res.status(400).json({ error: 'Average nut weight cannot exceed 1000 g' });
    }

    const lot = await Lot.create({
      name,
      reference: String(req.body.reference || '').trim().slice(0, 80),
      supplier: String(req.body.supplier || '').trim().slice(0, 80),
      notes: String(req.body.notes || '').trim().slice(0, 500),
      prices,
      avgNutWeightG,
      currency: String(req.body.currency || 'INR').trim().toUpperCase().slice(0, 8) || 'INR',
      user: req.user._id,
    });

    return res.status(201).json({ success: true, lot: serializeLotSummary(lot, []) });
  })
);

// GET /api/lots
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = buildLotQuery(req.user._id, req.query);
    const lots = await Lot.find(filter).sort({ createdAt: -1 });
    if (lots.length === 0) {
      return res.json({ items: [] });
    }

    const lotIds = lots.map((lot) => lot._id);
    const scans = await Scan.find({ user: req.user._id, lot: { $in: lotIds } })
      .select('lot gradeA gradeB gradeC gradeD totalCount confidence qualityScore');

    const scansByLot = new Map();
    scans.forEach((scan) => {
      const key = String(scan.lot);
      if (!scansByLot.has(key)) scansByLot.set(key, []);
      scansByLot.get(key).push(scan);
    });

    const items = lots.map((lot) => {
      const lotScans = scansByLot.get(String(lot._id)) || [];
      return serializeLotSummary(lot, lotScans);
    });

    return res.json({ items });
  })
);

// GET /api/lots/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid lot ID' });
    }
    const lot = await Lot.findOne({ _id: req.params.id, user: req.user._id });
    if (!lot) return res.status(404).json({ error: 'Lot not found' });

    const scans = await Scan.find({ user: req.user._id, lot: lot._id }).sort({
      createdAt: -1,
    });
    const summary = serializeLotSummary(lot, scans);
    const items = scans.map((scan) => serializeScan(scan, { includeDetections: false }));

    return res.json({
      lot: summary,
      scans: items,
    });
  })
);

// PATCH /api/lots/:id
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid lot ID' });
    }
    const lot = await Lot.findOne({ _id: req.params.id, user: req.user._id });
    if (!lot) return res.status(404).json({ error: 'Lot not found' });

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'Lot name is required' });
      if (name.length > 80) return res.status(400).json({ error: 'Lot name must be 80 characters or less' });
      lot.name = name;
    }
    if (req.body.reference !== undefined) lot.reference = String(req.body.reference).trim().slice(0, 80);
    if (req.body.supplier !== undefined) lot.supplier = String(req.body.supplier).trim().slice(0, 80);
    if (req.body.notes !== undefined) lot.notes = String(req.body.notes).trim().slice(0, 500);
    if (req.body.currency !== undefined) {
      lot.currency = String(req.body.currency).trim().toUpperCase().slice(0, 8) || 'INR';
    }
    if (req.body.avgNutWeightG !== undefined) {
      const avgNutWeightG = Math.max(0, Number(req.body.avgNutWeightG) || 0);
      if (avgNutWeightG > 1000) return res.status(400).json({ error: 'Average nut weight cannot exceed 1000 g' });
      lot.avgNutWeightG = avgNutWeightG;
    }
    if (req.body.prices) {
      ['A', 'B', 'C', 'D'].forEach((letter) => {
        if (req.body.prices[letter] !== undefined) {
          lot.prices[letter] = Math.max(0, Number(req.body.prices[letter]) || 0);
        }
      });
    }

    await lot.save();
    const scans = await Scan.find({ user: req.user._id, lot: lot._id })
      .select('gradeA gradeB gradeC gradeD totalCount confidence qualityScore');
    return res.json({ success: true, lot: serializeLotSummary(lot, scans) });
  })
);

// GET /api/lots/:id/export.csv
router.get(
  '/:id/export.csv',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid lot ID' });
    }
    const lot = await Lot.findOne({ _id: req.params.id, user: req.user._id });
    if (!lot) return res.status(404).json({ error: 'Lot not found' });

    const scans = await Scan.find({ user: req.user._id, lot: lot._id }).sort({ createdAt: 1 });
    const aggregates = aggregateScans(scans);
    const valuation = computeValuation(aggregates, lot);

    const lines = [];
    lines.push('\ufeffLot,Arecanut batch export');
    lines.push(`Lot name,${csvEscape(lot.name)}`);
    lines.push(`Lot reference,${csvEscape(lot.reference || '')}`);
    lines.push(`Supplier,${csvEscape(lot.supplier || '')}`);
    lines.push(`Currency,${csvEscape(valuation.currency)}`);
    lines.push(`Average nut weight (g),${valuation.avgNutWeightG}`);
    lines.push(`Price A (per kg),${valuation.prices.A}`);
    lines.push(`Price B (per kg),${valuation.prices.B}`);
    lines.push(`Price C (per kg),${valuation.prices.C}`);
    lines.push(`Price D (per kg),${valuation.prices.D}`);
    lines.push(`Scans,${aggregates.scanCount}`);
    lines.push(`Total nuts,${aggregates.totalNuts}`);
    lines.push(`Grade A,${aggregates.gradeCounts.A}`);
    lines.push(`Grade B,${aggregates.gradeCounts.B}`);
    lines.push(`Grade C,${aggregates.gradeCounts.C}`);
    lines.push(`Grade D,${aggregates.gradeCounts.D}`);
    lines.push(`Estimated total weight (kg),${valuation.totalWeightKg}`);
    lines.push(`Estimated total value,${valuation.totalValue}`);
    lines.push('Note,"Values are estimates based on user-provided average weight and prices."');
    lines.push('');
    lines.push(
      [
        'Report ID',
        'Scan ID',
        'Filename',
        'Created at',
        'Final grade',
        'Grade A',
        'Grade B',
        'Grade C',
        'Grade D',
        'Total count',
        'Confidence',
        'Quality score',
        'Model version',
      ]
        .map(csvEscape)
        .join(',')
    );

    scans.forEach((scan) => {
      lines.push(
        [
          scan.reportId || '',
          String(scan._id),
          scan.filename || '',
          scan.createdAt ? scan.createdAt.toISOString() : '',
          scan.finalGrade || '',
          scan.gradeA || 0,
          scan.gradeB || 0,
          scan.gradeC || 0,
          scan.gradeD || 0,
          scan.totalCount || 0,
          scan.confidence ?? '',
          scan.qualityScore ?? '',
          scan.modelVersion || '',
        ]
          .map(csvEscape)
          .join(',')
      );
    });

    const csv = lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="arecanut-lot-${String(lot.name).replace(/[^a-zA-Z0-9._-]/g, '_')}-${Date.now()}.csv"`
    );
    return res.send(csv);
  })
);

// DELETE /api/lots/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid lot ID' });
    }
    const lot = await Lot.findOne({ _id: req.params.id, user: req.user._id });
    if (!lot) return res.status(404).json({ error: 'Lot not found' });

    await Scan.updateMany({ user: req.user._id, lot: lot._id }, { $set: { lot: null } });
    await lot.deleteOne();
    return res.json({ message: 'Lot deleted. Scans were unassigned and remain in history.' });
  })
);

module.exports = router;
