'use strict';

const { serializeScan } = require('./scanService');
const { applyScanPolicy, buildPolicy } = require('./settingsService');
const { computeScanPricing } = require('./pricingService');
const { getLiveMarketPrice } = require('./marketPriceService');
const { configuredKeyCount } = require('./geminiService');

async function resolveLivePrice(settings, options = {}) {
  if (settings.pricing.mode !== 'live') return { price: null, error: null };
  if (options.livePrice !== undefined) {
    return { price: options.livePrice, error: null };
  }
  try {
    const result = await getLiveMarketPrice(settings, {
      force: Boolean(options.forceMarketRefresh),
    });
    return { price: result.price, error: null, result };
  } catch (error) {
    return {
      price: null,
      error: {
        code: error.code || 'market_unavailable',
        message: error.message,
        stale: Boolean(error.stale),
        cache: error.cache || null,
      },
    };
  }
}

async function presentScan(scan, settings, options = {}) {
  const serialized = serializeScan(scan, {
    includeDetections: options.includeDetections !== false,
  });
  const policy = applyScanPolicy(serialized, settings);
  if (options.includePricing === false || !policy.gradingEnabled) {
    return policy;
  }

  const live = await resolveLivePrice(settings, options);
  const pricing = computeScanPricing(policy, settings, {
    livePrice: live.price,
    weightKg: options.weightKg,
    weightSource: options.weightSource,
  });
  if (live.error) pricing.marketError = live.error;
  policy.pricing = pricing;
  policy.pricingPolicy = {
    mode: settings.pricing.mode,
    currency: settings.pricing.currency,
    liveSource: settings.pricing.mode === 'live' ? 'AGMARKNET 2.0 public dashboard' : null,
    manualUnitMode: settings.pricing.mode === 'manual',
  };
  return policy;
}

async function presentScans(scans, settings, options = {}) {
  const live = settings.predictions.masterEnabled
    ? await resolveLivePrice(settings, options)
    : { price: null, error: null };
  return Promise.all(
    (scans || []).map((scan) =>
      presentScan(scan, settings, {
        ...options,
        livePrice: live.price,
      })
    )
  );
}

function publicPolicy(settings) {
  return {
    ...buildPolicy(settings),
    currency: settings.pricing.currency,
    geminiConfigured: configuredKeyCount() > 0,
    marketKeyConfigured: Boolean(
      process.env.DATA_GOV_IN_API_KEY || process.env.AGMARKNET_API_KEY
    ),
    pricingMode: settings.predictions.masterEnabled
      ? settings.pricing.mode
      : 'none',
  };
}

module.exports = {
  presentScan,
  presentScans,
  resolveLivePrice,
  publicPolicy,
};
