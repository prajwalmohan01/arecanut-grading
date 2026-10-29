'use strict';

const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const asyncHandler = require('../utils/asyncHandler');
const { getSettings } = require('../services/settingsService');
const { publicPolicy } = require('../services/presentationService');
const { configuredKeyCount } = require('../services/geminiService');

const router = express.Router();

router.get(
  '/',
  protect,
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    const policy = publicPolicy(settings);
    return res.json({
      policy,
      pricing: {
        mode: policy.pricingMode,
        currency: settings.pricing.currency,
        live: {
          source: settings.pricing.live.source,
          state: settings.pricing.live.state,
          district: settings.pricing.live.district,
          market: settings.pricing.live.market,
          commodity: settings.pricing.live.commodity,
          priceField: settings.pricing.live.priceField,
          refreshMinutes: settings.pricing.live.refreshMinutes,
          unit: 'INR/quintal',
        },
      },
      gemini: {
        enabled: Boolean(settings.predictions.geminiEnabled),
        configured: configuredKeyCount() > 0,
        model: settings.gemini.model,
        advisoryOnly: true,
      },
    });
  })
);

module.exports = router;
