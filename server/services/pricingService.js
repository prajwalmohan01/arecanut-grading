'use strict';

const { GRADES, buildPolicy } = require('./settingsService');

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function round4(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

function pricePerKg(item) {
  if (!item || !Number.isFinite(Number(item.price))) return null;
  const price = Number(item.price);
  if (item.unit === 'per_kg') return price;
  if (item.unit === 'per_quintal') return price / 100;
  return null;
}

function cleanWeight(value) {
  if (value === null || value === undefined || value === '') return null;
  const weight = Number(value);
  if (!Number.isFinite(weight) || weight <= 0 || weight > 1000000) return null;
  return round4(weight);
}

function gradeCountsFromScan(scan) {
  const counts = {};
  const source = scan && scan.gradeCounts && typeof scan.gradeCounts === 'object'
    ? scan.gradeCounts
    : {};
  GRADES.forEach((letter) => {
    const value = source[letter] !== undefined ? source[letter] : scan?.[`grade${letter}`];
    if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
      counts[letter] = Math.max(0, Number(value));
    }
  });
  return counts;
}

function lineLabel(letter) {
  return `Grade ${letter}`;
}

function buildManualPricing(counts, settings, weightKg, weightSource) {
  const manual = settings.pricing.manual || {};
  const lineItems = [];
  const weightGrades = [];
  let perNutValue = 0;
  let hasPerNut = false;

  Object.keys(counts).forEach((letter) => {
    const count = counts[letter];
    if (count <= 0) return;
    const item = manual[letter] || { price: 0, unit: 'per_kg' };
    if (!Number.isFinite(Number(item.price))) return;
    const price = Number(item.price);
    const line = {
      grade: letter,
      label: lineLabel(letter),
      count,
      price: round2(price),
      unit: item.unit,
      unitLabel:
        item.unit === 'per_nut'
          ? `INR per nut`
          : item.unit === 'per_quintal'
          ? 'INR per quintal'
          : 'INR per kg',
      subtotal: null,
    };
    if (item.unit === 'per_nut') {
      line.subtotal = round2(count * price);
      perNutValue += line.subtotal;
      hasPerNut = true;
    } else {
      weightGrades.push({ letter, count, pricePerKg: pricePerKg(item) });
    }
    lineItems.push(line);
  });

  const hasConfiguredPrice = lineItems.some((item) => item.price > 0);
  let totalWeightKg = weightKg;
  let weightedPricePerKg = null;
  let weightValue = null;

  if (weightGrades.length && totalWeightKg) {
    const weightCount = weightGrades.reduce((sum, item) => sum + item.count, 0);
    const allCount = lineItems.reduce((sum, item) => sum + item.count, 0);
    const weightPriceTotal = weightGrades.reduce(
      (sum, item) => sum + item.count * (item.pricePerKg || 0),
      0
    );
    weightedPricePerKg = weightCount > 0 ? round4(weightPriceTotal / weightCount) : null;
    // Allocate the measured lot weight across every counted enabled grade, then
    // apply per-kg prices only to the weight-priced grades. This avoids pricing
    // the full lot weight at the weight-priced grades' rate when another enabled
    // grade uses per-nut pricing.
    weightValue =
      allCount > 0 && Number.isFinite(weightPriceTotal)
        ? totalWeightKg * (weightPriceTotal / allCount)
        : null;
  }

  const allCount = lineItems.reduce((sum, item) => sum + item.count, 0);
  if (hasConfiguredPrice && totalWeightKg && allCount > 0) {
    lineItems.forEach((line) => {
      if (line.unit === 'per_nut') return;
      const perKg = pricePerKg(line);
      if (perKg === null) return;
      line.subtotal = round2(totalWeightKg * ((line.count * perKg) / allCount));
    });
  }

  const requiresWeight = weightGrades.length > 0 && !totalWeightKg;
  let totalValue = null;
  if (!hasConfiguredPrice) {
    totalValue = null;
  } else if (hasPerNut && weightGrades.length === 0) {
    totalValue = round2(perNutValue);
  } else if (hasPerNut && totalWeightKg && weightValue !== null) {
    totalValue = round2(perNutValue + weightValue);
  } else if (!hasPerNut && totalWeightKg && weightValue !== null) {
    totalValue = round2(weightValue);
  }

  let status = 'ready';
  if (!lineItems.length) status = 'no_detections';
  else if (!hasConfiguredPrice) status = 'no_configured_prices';
  else if (requiresWeight) status = 'needs_weight';
  else if (totalValue === null) status = 'no_total';

  return {
    active: true,
    mode: 'manual',
    currency: settings.pricing.currency || 'INR',
    status,
    lineItems,
    totalValue,
    totalWeightKg,
    weightSource: totalWeightKg ? weightSource || 'user_entered_measured_weight' : null,
    weightedPricePerKg,
    requiresWeight,
    perNutFormula:
      'Manual per-nut value = enabled nut count × applicable price per nut. This is only used when the administrator explicitly selected per_nut.',
    formula:
      weightGrades.length > 0
        ? 'For per-kg/per-quintal prices, estimated value = measured net weight (kg) × count-weighted price per kg, after allocating the measured weight across all counted enabled grades. This assumes an equal average nut weight across enabled grades; use per-nut pricing if that assumption does not hold.'
        : 'Manual per-nut value = enabled nut count × price per nut.',
    note:
      'Manual prices are administrator-entered estimates, not live mandi quotes. No total is claimed without measured/calibrated weight when a per-kg or per-quintal unit is used.',
    estimateOnly: true,
  };
}

function buildLivePricing(counts, settings, livePrice, weightKg, weightSource) {
  const lineItems = Object.keys(counts).map((letter) => ({
    grade: letter,
    label: lineLabel(letter),
    count: counts[letter],
    price: livePrice && livePrice.pricePerKg !== null ? round4(livePrice.pricePerKg) : null,
    unit: 'per_kg',
    unitLabel: 'INR per kg',
    subtotal:
      livePrice && livePrice.pricePerKg !== null && weightKg
        ? null
        : null,
  }));

  const totalCount = lineItems.reduce((sum, item) => sum + item.count, 0);
  const hasPrice = Boolean(livePrice && Number.isFinite(Number(livePrice.pricePerKg)));
  const totalValue =
    hasPrice && weightKg && totalCount > 0
      ? round2(Number(livePrice.pricePerKg) * weightKg)
      : null;

  let status = 'ready';
  if (!totalCount) status = 'no_detections';
  else if (!hasPrice) status = 'live_unavailable';
  else if (!weightKg) status = 'needs_weight';

  return {
    active: true,
    mode: 'live',
    currency: settings.pricing.currency || 'INR',
    status,
    lineItems,
    totalValue,
    totalWeightKg: weightKg,
    weightSource: weightKg ? weightSource || 'user_entered_measured_weight' : null,
    weightedPricePerKg: hasPrice ? round4(Number(livePrice.pricePerKg)) : null,
    requiresWeight: Boolean(totalCount && hasPrice && !weightKg),
    formula:
      'Live estimated value = measured net weight (kg) × AGMARKNET price per kg (quintal quote ÷ 100).',
    note:
      'Live prices are daily AGMARKNET mandi quotes, not a guarantee. No lot total is claimed without measured/calibrated weight.',
    livePrice: livePrice || null,
    estimateOnly: true,
  };
}

function disabledPricing(settings, reason) {
  return {
    active: false,
    mode: 'none',
    status: 'pricing_disabled',
    reason,
    currency: (settings && settings.pricing && settings.pricing.currency) || 'INR',
    lineItems: [],
    totalValue: null,
    totalWeightKg: null,
    weightedPricePerKg: null,
    requiresWeight: false,
  };
}

function computePricing(options = {}) {
  const settings = options.settings;
  if (!settings || !settings.pricing) {
    return disabledPricing(settings, 'Pricing settings are unavailable.');
  }
  const policy = buildPolicy(settings);
  if (!policy.masterEnabled) {
    return disabledPricing(
      settings,
      'Grading and pricing are disabled by the administrator.'
    );
  }
  if (settings.pricing.mode === 'none') {
    return disabledPricing(
      settings,
      'No pricing mode is active. The administrator must enable manual or live pricing.'
    );
  }

  const sourceCounts = options.counts || gradeCountsFromScan(options.scan);
  const counts = {};
  policy.enabledLetters.forEach((letter) => {
    const value = Number(sourceCounts[letter]) || 0;
    if (value > 0) counts[letter] = value;
  });
  const weightKg = cleanWeight(options.weightKg);
  const weightSource = options.weightSource || null;
  if (settings.pricing.mode === 'manual') {
    return buildManualPricing(counts, settings, weightKg, weightSource);
  }
  return buildLivePricing(
    counts,
    settings,
    options.livePrice || null,
    weightKg,
    weightSource
  );
}

function computeScanPricing(scan, settings, options = {}) {
  return computePricing({
    scan,
    counts: gradeCountsFromScan(scan),
    settings,
    livePrice: options.livePrice,
    weightKg: options.weightKg,
    weightSource: options.weightSource || 'user_entered_measured_weight',
  });
}

function computeLotPricing(aggregate, lot, settings, options = {}) {
  const counts = aggregate && aggregate.gradeCounts
    ? aggregate.gradeCounts
    : {};
  const totalCount = Object.values(counts).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0
  );
  const measuredWeightKg =
    lot && Number.isFinite(Number(lot.measuredWeightKg)) && Number(lot.measuredWeightKg) > 0
      ? round4(Number(lot.measuredWeightKg))
      : null;
  return computePricing({
    counts,
    settings,
    livePrice: options.livePrice,
    // Only a physically measured/calibrated lot weight may drive a weight-based total.
    weightKg: measuredWeightKg,
    weightSource: measuredWeightKg ? 'measured_lot_weight' : null,
  });
}

module.exports = {
  computePricing,
  computeScanPricing,
  computeLotPricing,
  gradeCountsFromScan,
  round2,
};
