'use strict';

const { buildPolicy } = require('./settingsService');
const { computeLotPricing } = require('./pricingService');

const GRADE_LETTERS = ['A', 'B', 'C', 'D'];

function toNumber(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return number;
}

function aggregateScans(scans, settings) {
  const policy = settings ? buildPolicy(settings) : null;
  const enabled = policy ? policy.enabledLetters : GRADE_LETTERS;
  const source = Array.isArray(scans) ? scans : [];
  // The bundled checkpoint is A/B-only. Additional supported letters can be
  // discovered from stored scans when a validated four-class model is installed.
  const supported = new Set(['A', 'B']);
  source.forEach((scan) => {
    const letters =
      Array.isArray(scan.supportedGrades) && scan.supportedGrades.length
        ? scan.supportedGrades
        : ['A', 'B'];
    letters.forEach((letter) => supported.add(String(letter).toUpperCase()));
  });
  const supportedEnabled = enabled.filter((letter) => supported.has(letter));
  const gradeCounts = {};
  enabled.forEach((letter) => {
    gradeCounts[letter] = supported.has(letter) ? 0 : null;
  });
  let totalNuts = 0;
  let scanCount = 0;
  let confidenceSum = 0;
  let confidenceWeight = 0;
  let qualitySum = 0;
  let qualityWeight = 0;

  source.forEach((scan) => {
    scanCount += 1;
    supportedEnabled.forEach((letter) => {
      const value = toNumber(scan[`grade${letter}`]);
      gradeCounts[letter] += value;
      totalNuts += value;
    });
    if (policy && !policy.masterEnabled) return;
    if (typeof scan.confidence === 'number') {
      confidenceSum += scan.confidence * toNumber(scan.totalCount || 1);
      confidenceWeight += toNumber(scan.totalCount || 1);
    }
    if (typeof scan.qualityScore === 'number') {
      qualitySum += scan.qualityScore * toNumber(scan.totalCount || 1);
      qualityWeight += toNumber(scan.totalCount || 1);
    }
  });

  const gradingOn = !policy || policy.masterEnabled;
  const hasModelOutput = supportedEnabled.length > 0;
  return {
    scanCount,
    totalNuts: gradingOn && hasModelOutput ? totalNuts : null,
    gradeCounts:
      gradingOn && hasModelOutput
        ? gradeCounts
        : Object.fromEntries(enabled.map((letter) => [letter, null])),
    unavailableGrades: policy
      ? enabled.filter((letter) => !supported.has(letter))
      : [],
    avgConfidence:
      gradingOn && hasModelOutput && confidenceWeight > 0
        ? confidenceSum / confidenceWeight
        : null,
    avgQualityScore:
      gradingOn && hasModelOutput && qualityWeight > 0
        ? qualitySum / qualityWeight
        : null,
  };
}

function legacyComputeValuation(aggregates, lot) {
  const avgNutWeightG = toNumber(lot?.avgNutWeightG);
  const prices = {
    A: toNumber(lot?.prices?.A),
    B: toNumber(lot?.prices?.B),
    C: toNumber(lot?.prices?.C),
    D: toNumber(lot?.prices?.D),
  };
  const currency = String(lot?.currency || 'INR').trim().toUpperCase().slice(0, 8) || 'INR';
  const perGrade = {};
  let totalWeightKg = 0;
  let totalValue = 0;

  GRADE_LETTERS.forEach((letter) => {
    const count = toNumber(aggregates?.gradeCounts?.[letter]);
    const weightKg = avgNutWeightG > 0 ? (count * avgNutWeightG) / 1000 : 0;
    const pricePerKg = prices[letter];
    const value = pricePerKg > 0 && weightKg > 0 ? weightKg * pricePerKg : 0;
    totalWeightKg += weightKg;
    totalValue += value;
    perGrade[letter] = {
      count,
      weightKg: Math.round(weightKg * 1000) / 1000,
      pricePerKg,
      value: Math.round(value * 100) / 100,
    };
  });

  return {
    active: totalValue > 0,
    mode: totalValue > 0 ? 'manual' : 'none',
    currency,
    avgNutWeightG,
    prices,
    perGrade,
    totalWeightKg: Math.round(totalWeightKg * 1000) / 1000,
    totalValue: Math.round(totalValue * 100) / 100,
    assumptions: {
      weight: avgNutWeightG > 0 ? 'Provided average nut weight' : 'No average weight set',
      pricing: totalValue > 0 ? 'Price per kg applied' : 'No prices set',
    },
  };
}

function computeValuation(aggregates, lot, settings, options = {}) {
  if (!settings) return legacyComputeValuation(aggregates, lot);

  const policy = buildPolicy(settings);
  const pricing = policy.masterEnabled
    ? computeLotPricing(aggregates, lot, settings, {
        livePrice: options.livePrice,
      })
    : {
        active: false,
        mode: 'none',
        status: 'pricing_disabled',
        currency: settings.pricing.currency || 'INR',
        lineItems: [],
        totalValue: null,
        weightedPricePerKg: null,
        requiresWeight: false,
        reason: 'Grading and pricing are disabled by the administrator.',
      };
  const avgNutWeightG = toNumber(lot?.avgNutWeightG);
  const measuredWeightKg =
    Number.isFinite(Number(lot?.measuredWeightKg)) && Number(lot.measuredWeightKg) > 0
      ? Number(lot.measuredWeightKg)
      : null;
  const enabled = policy.masterEnabled ? policy.enabledLetters : [];
  const totalCount = enabled.reduce(
    (sum, letter) => sum + toNumber(aggregates?.gradeCounts?.[letter]),
    0
  );
  const estimatedWeightKg =
    avgNutWeightG > 0 && totalCount > 0
      ? Math.round(((avgNutWeightG * totalCount) / 1000) * 10000) / 10000
      : null;
  const prices = {};
  const perGrade = {};
  const manual = settings.pricing.manual || {};
  const livePerKg =
    options.livePrice && Number.isFinite(Number(options.livePrice.pricePerKg))
      ? Number(options.livePrice.pricePerKg)
      : null;

  enabled.forEach((letter) => {
    const rawCount = aggregates?.gradeCounts?.[letter];
    const count =
      rawCount === null || rawCount === undefined ? null : toNumber(rawCount);
    // Per-grade weight is an allocation of measured lot weight, not a separate measurement.
    const weightKg =
      count !== null && measuredWeightKg !== null && totalCount > 0
        ? (measuredWeightKg * count) / totalCount
        : null;
    let pricePerKg = null;
    let value = null;
    if (settings.pricing.mode === 'live') {
      pricePerKg = livePerKg;
    } else if (settings.pricing.mode === 'manual') {
      const item = manual[letter] || {};
      if (item.unit === 'per_kg') pricePerKg = Number(item.price) || 0;
      else if (item.unit === 'per_quintal') pricePerKg = (Number(item.price) || 0) / 100;
      else if (item.unit === 'per_nut' && count !== null) {
        value = count * (Number(item.price) || 0);
      }
    }
    if (pricePerKg !== null && weightKg !== null && weightKg > 0) {
      value = weightKg * pricePerKg;
    }
    prices[letter] = pricePerKg;
    perGrade[letter] = {
      count,
      weightKg: weightKg === null ? null : Math.round(weightKg * 1000) / 1000,
      weightSource:
        weightKg === null ? null : 'allocated_from_measured_lot_weight_by_enabled_count',
      pricePerKg: pricePerKg === null ? null : Math.round(pricePerKg * 10000) / 10000,
      value: value === null ? null : Math.round(value * 100) / 100,
    };
  });

  return {
    ...pricing,
    currency: pricing.currency || settings.pricing.currency || 'INR',
    avgNutWeightG,
    measuredWeightKg,
    estimatedWeightKg,
    prices,
    perGrade,
    // Only a measured/calibrated lot weight can drive a weight-based total.
    totalWeightKg: measuredWeightKg,
    totalValue: pricing.totalValue,
    assumptions: {
      weight:
        measuredWeightKg !== null
          ? 'Measured net lot weight entered by the user'
          : avgNutWeightG > 0
          ? 'Average nut weight is an estimate only; it is not used to claim a lot total'
          : 'No measured lot weight or average nut weight set',
      pricing: !policy.masterEnabled
        ? 'Grading and pricing are disabled by the administrator'
        : settings.pricing.mode === 'none'
        ? 'No pricing mode active'
        : settings.pricing.mode === 'live'
        ? 'AGMARKNET live quote per kg'
        : 'Administrator manual grade prices',
    },
  };
}

function serializeLotSummary(lot, scans, settings, options = {}) {
  const aggregates = aggregateScans(scans, settings);
  const valuation = computeValuation(aggregates, lot, settings, options);
  return {
    id: String(lot._id),
    lotId: String(lot._id),
    name: lot.name,
    reference: lot.reference || '',
    supplier: lot.supplier || '',
    notes: lot.notes || '',
    prices: valuation.prices,
    avgNutWeightG: valuation.avgNutWeightG,
    measuredWeightKg: valuation.measuredWeightKg,
    currency: valuation.currency,
    createdAt: lot.createdAt,
    updatedAt: lot.updatedAt,
    totals: aggregates,
    valuation,
    scanCount: aggregates.scanCount,
    policy: settings ? buildPolicy(settings) : null,
  };
}

function getLotMap(lots) {
  const map = new Map();
  if (Array.isArray(lots)) {
    lots.forEach((lot) => {
      map.set(String(lot._id), lot);
    });
  }
  return map;
}

module.exports = {
  aggregateScans,
  computeValuation,
  serializeLotSummary,
  getLotMap,
  GRADE_LETTERS,
};
