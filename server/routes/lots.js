'use strict';

const express = require('express');
const mongoose = require('mongoose');

const Lot = require('../models/Lot');
const Scan = require('../models/Scan');
const { protect } = require('../middleware/authMiddleware');
const asyncHandler = require('../utils/asyncHandler');
const { serializeScan } = require('../services/scanService');
const { serializeLotSummary, aggregateScans, computeValuation } = require('../services/lotService');
const {
  getSettings,
  buildPolicy,
  applyScanPolicy,
} = require('../services/settingsService');
const { presentScans, resolveLivePrice } = require('../services/presentationService');

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
    const measuredWeightKg = Math.max(0, Number(req.body.measuredWeightKg || 0) || 0);
    if (measuredWeightKg > 1000000) {
      return res.status(400).json({ error: 'Measured lot weight is outside the supported range' });
    }

    const lot = await Lot.create({
      name,
      reference: String(req.body.reference || '').trim().slice(0, 80),
      supplier: String(req.body.supplier || '').trim().slice(0, 80),
      notes: String(req.body.notes || '').trim().slice(0, 500),
      prices,
      avgNutWeightG,
      measuredWeightKg,
      currency: String(req.body.currency || 'INR').trim().toUpperCase().slice(0, 8) || 'INR',
      user: req.user._id,
    });

    const settings = await getSettings();
    return res.status(201).json({
      success: true,
      lot: serializeLotSummary(lot, [], settings),
      policy: buildPolicy(settings),
    });
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

    const settings = await getSettings();
    const live = await resolveLivePrice(settings);
    const items = lots.map((lot) => {
      const lotScans = scansByLot.get(String(lot._id)) || [];
      return serializeLotSummary(lot, lotScans, settings, {
        livePrice: live.price,
      });
    });

    return res.json({ items, policy: buildPolicy(settings) });
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
    const settings = await getSettings();
    const live = await resolveLivePrice(settings);
    const summary = serializeLotSummary(lot, scans, settings, {
      livePrice: live.price,
    });
    const items = await presentScans(scans, settings, {
      includeDetections: false,
      includePricing: true,
      livePrice: live.price,
    });

    return res.json({
      lot: summary,
      scans: items,
      policy: buildPolicy(settings),
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
    if (req.body.measuredWeightKg !== undefined) {
      const measuredWeightKg = Math.max(0, Number(req.body.measuredWeightKg) || 0);
      if (measuredWeightKg > 1000000) {
        return res.status(400).json({ error: 'Measured lot weight is outside the supported range' });
      }
      lot.measuredWeightKg = measuredWeightKg;
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
    const settings = await getSettings();
    const live = await resolveLivePrice(settings);
    return res.json({
      success: true,
      lot: serializeLotSummary(lot, scans, settings, { livePrice: live.price }),
      policy: buildPolicy(settings),
    });
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
    const settings = await getSettings();
    const policy = buildPolicy(settings);
    const live = await resolveLivePrice(settings);
    const aggregates = aggregateScans(scans, settings);
    const valuation = computeValuation(aggregates, lot, settings, {
      livePrice: live.price,
    });
    const views = scans.map((scan) =>
      applyScanPolicy(serializeScan(scan, { includeDetections: false }), settings)
    );

    const lines = [];
    lines.push('\ufeffLot,Arecanut batch export');
    lines.push(`Lot name,${csvEscape(lot.name)}`);
    lines.push(`Lot reference,${csvEscape(lot.reference || '')}`);
    lines.push(`Supplier,${csvEscape(lot.supplier || '')}`);
    lines.push(`Policy version,${policy.version}`);
    lines.push(`Master prediction,${policy.masterEnabled ? 'on' : 'off'}`);
    lines.push(
      `Enabled grades,${policy.enabledLetters.length ? policy.enabledLetters.join('') : 'none'}`
    );
    lines.push(`Pricing mode,${policy.pricingMode}`);
    lines.push(`Currency,${csvEscape(valuation.currency)}`);
    lines.push(`Average nut weight (g),${csvEscape(valuation.avgNutWeightG)}`);
    lines.push(`Measured lot weight (kg),${csvEscape(valuation.measuredWeightKg ?? '')}`);
    lines.push(`Estimated nut-count weight (kg),${csvEscape(valuation.estimatedWeightKg ?? '')}`);
    lines.push(`Scans,${aggregates.scanCount}`);
    if (policy.masterEnabled) {
      lines.push(`Total enabled nuts,${csvEscape(aggregates.totalNuts)}`);
      policy.enabledLetters.forEach((letter) => {
        lines.push(`Grade ${letter},${csvEscape(aggregates.gradeCounts[letter] ?? 0)}`);
        if (settings.pricing.mode === 'manual') {
          lines.push(
            `Manual price ${letter},${csvEscape(
              settings.pricing.manual[letter]?.price ?? ''
            )} ${settings.pricing.manual[letter]?.unit || ''}`
          );
        }
      });
      if (settings.pricing.mode === 'live' && live.price) {
        lines.push(`Live price per kg,${csvEscape(live.price.pricePerKg)}`);
      }
      lines.push(`Measured total weight (kg),${csvEscape(valuation.totalWeightKg ?? '')}`);
      lines.push(`Measured-weight total value,${csvEscape(valuation.totalValue ?? '')}`);
    } else {
      lines.push(
        'Grade and price columns,hidden by administrator policy; historical records remain stored'
      );
    }
    lines.push(
      'Note,"Values are estimates only. No total is claimed without measured/calibrated weight when a weight-based unit is used."'
    );
    lines.push('');

    const header = [
      'Report ID',
      'Scan ID',
      'Filename',
      'Created at',
      ...(policy.masterEnabled ? ['Final grade'] : []),
      ...(policy.masterEnabled
        ? policy.enabledLetters.map((letter) => `Grade ${letter}`)
        : []),
      ...(policy.masterEnabled ? ['Total enabled count', 'Confidence', 'Quality score'] : []),
      'Model version',
    ];
    lines.push(header.map(csvEscape).join(','));

    views.forEach((view, index) => {
      const scan = scans[index];
      const row = [
        scan.reportId || '',
        String(scan._id),
        scan.filename || '',
        scan.createdAt ? scan.createdAt.toISOString() : '',
        ...(policy.masterEnabled
          ? [
              view.finalGradeSource === 'hidden_by_policy'
                ? ''
                : view.finalGrade || 'Invalid',
            ]
          : []),
        ...(policy.masterEnabled
          ? policy.enabledLetters.map((letter) => view.gradeCounts?.[letter] ?? '')
          : []),
        ...(policy.masterEnabled
          ? [view.totalCount ?? '', view.confidence ?? '', view.qualityScore ?? '']
          : []),
        scan.modelVersion || '',
      ];
      lines.push(row.map(csvEscape).join(','));
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
