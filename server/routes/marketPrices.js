'use strict';

const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const asyncHandler = require('../utils/asyncHandler');
const { getSettings } = require('../services/settingsService');
const { getLiveMarketPrice } = require('../services/marketPriceService');

const router = express.Router();

// GET /api/market-prices — the active live quote for the configured market.
router.get(
  '/',
  protect,
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    if (!settings.predictions.masterEnabled || settings.pricing.mode !== 'live') {
      return res.status(409).json({
        error: settings.predictions.masterEnabled
          ? 'Live market pricing is not active. The administrator must select Live Market Price mode.'
          : 'Grading and pricing are disabled by the administrator.',
        pricingMode: settings.predictions.masterEnabled
          ? settings.pricing.mode
          : 'none',
      });
    }
    const force = req.query.refresh === '1' && req.user.role === 'admin';
    const market = await getLiveMarketPrice(settings, { force });
    return res.json({ market });
  })
);

module.exports = router;
