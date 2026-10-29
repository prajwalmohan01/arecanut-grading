'use strict';

const express = require('express');
const { protect, requireAdmin } = require('../middleware/authMiddleware');
const asyncHandler = require('../utils/asyncHandler');
const {
  getSettings,
  updatePredictions,
  updateGemini,
  updatePricing,
  listAudit,
  buildPolicy,
} = require('../services/settingsService');
const { geminiStatus } = require('../services/geminiService');
const { marketStatus, getLiveMarketPrice } = require('../services/marketPriceService');

const router = express.Router();

router.use(protect, requireAdmin);

function meta(req) {
  return { ip: req.ip || req.socket?.remoteAddress || '' };
}

function adminPayload(settings) {
  return {
    settings: {
      version: settings.version,
      predictions: settings.predictions,
      gemini: settings.gemini,
      pricing: settings.pricing,
      updatedAt: settings.updatedAt,
    },
    policy: buildPolicy(settings),
    gemini: geminiStatus(settings),
  };
}

// GET /api/admin/settings
router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const settings = await getSettings({ fresh: true });
    const market = await marketStatus(settings);
    return res.json({
      ...adminPayload(settings),
      market,
    });
  })
);

// PUT /api/admin/settings/predictions
router.put(
  '/settings/predictions',
  asyncHandler(async (req, res) => {
    const settings = await updatePredictions(req.body || {}, req.user, meta(req));
    return res.json({
      message: 'Prediction display policy updated.',
      ...adminPayload(settings),
    });
  })
);

// PUT /api/admin/settings/gemini
router.put(
  '/settings/gemini',
  asyncHandler(async (req, res) => {
    const settings = await updateGemini(req.body || {}, req.user, meta(req));
    return res.json({
      message: 'Gemini configuration updated. API key values remain server-side.',
      ...adminPayload(settings),
    });
  })
);

// PUT /api/admin/settings/pricing
router.put(
  '/settings/pricing',
  asyncHandler(async (req, res) => {
    const settings = await updatePricing(req.body || {}, req.user, meta(req));
    const market = await marketStatus(settings);
    return res.json({
      message: 'Pricing settings updated.',
      ...adminPayload(settings),
      market,
    });
  })
);

// GET /api/admin/gemini/status
router.get(
  '/gemini/status',
  asyncHandler(async (_req, res) => {
    const settings = await getSettings({ fresh: true });
    return res.json({ gemini: geminiStatus(settings) });
  })
);

// GET /api/admin/market/status
router.get(
  '/market/status',
  asyncHandler(async (_req, res) => {
    const settings = await getSettings({ fresh: true });
    return res.json({ market: await marketStatus(settings) });
  })
);

// POST /api/admin/market/refresh
router.post(
  '/market/refresh',
  asyncHandler(async (_req, res) => {
    const settings = await getSettings({ fresh: true });
    const result = await getLiveMarketPrice(settings, { force: true });
    return res.json({
      message:
        result.status === 'live'
          ? 'Live market price refreshed.'
          : 'Live refresh failed; the last cached quote is shown.',
      market: result,
    });
  })
);

// GET /api/admin/audit
router.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const items = await listAudit(req.query.limit);
    return res.json({ items });
  })
);

module.exports = router;
