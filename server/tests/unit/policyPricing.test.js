'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  defaultSettings,
  buildPolicy,
  applyScanPolicy,
  isAnnotatedImageAllowed,
} = require('../../services/settingsService');
const {
  computePricing,
  computeScanPricing,
  computeLotPricing,
} = require('../../services/pricingService');
const {
  aggregateScans,
  computeValuation,
  serializeLotSummary,
} = require('../../services/lotService');

function settingsWith(overrides = {}) {
  const settings = defaultSettings();
  settings.predictions.grades = { A: true, B: true, C: false, D: false };
  settings.predictions.masterEnabled = true;
  settings.predictions.geminiEnabled = false;
  settings.pricing.mode = 'none';
  settings.pricing.currency = 'INR';
  settings.pricing.manual = {
    A: { price: 0, unit: 'per_kg' },
    B: { price: 0, unit: 'per_kg' },
    C: { price: 0, unit: 'per_kg' },
    D: { price: 0, unit: 'per_kg' },
  };
  return Object.assign(settings, overrides);
}

function manualSettings(prices) {
  const settings = settingsWith();
  settings.pricing.mode = 'manual';
  Object.entries(prices).forEach(([letter, item]) => {
    settings.pricing.manual[letter] = { ...item };
  });
  return settings;
}

function liveSettings() {
  const settings = settingsWith();
  settings.pricing.mode = 'live';
  return settings;
}

function scan(overrides = {}) {
  return {
    _id: 'scan-1',
    reportId: 'ARG-TEST-1',
    finalGrade: 'Grade B',
    finalGradeSource: 'model',
    gradeA: 3,
    gradeB: 2,
    gradeC: 0,
    gradeD: 0,
    gradeCounts: { A: 3, B: 2, C: 0, D: 0 },
    supportedGrades: ['A', 'B'],
    totalCount: 5,
    confidence: 88.5,
    qualityScore: 72.25,
    qualityMethod: 'heuristic',
    confidenceMethod: 'mean detection confidence',
    measurements: { avgWidthPx: 20 },
    defects: { notes: ['none'] },
    warnings: ['Grade C/D are not evaluated by the bundled model.'],
    detections: [
      { label: 'GradeA', grade: 'GradeA', confidence: 0.9 },
      { label: 'GradeA', grade: 'GradeA', confidence: 0.8 },
      { label: 'GradeA', grade: 'GradeA', confidence: 0.7 },
      { label: 'GradeB', grade: 'GradeB', confidence: 0.6 },
      { label: 'GradeB', grade: 'GradeB', confidence: 0.5 },
    ],
    images: {
      original: '/scans/scan-1/image/original',
      processed: '/scans/scan-1/image/processed',
      annotated: '/scans/scan-1/image/annotated',
    },
    pricing: { active: false, mode: 'none', status: 'pricing_disabled' },
    ...overrides,
  };
}

test('master switch off removes every grading, confidence, measurement, and price output', () => {
  const settings = settingsWith();
  settings.predictions.masterEnabled = false;
  const visible = applyScanPolicy(scan(), settings);

  assert.equal(visible.gradingEnabled, false);
  assert.equal(visible.gradingStatus, 'disabled_by_admin');
  assert.equal(visible.finalGrade, null);
  assert.equal(visible.finalGradeSource, 'none');
  assert.equal(visible.totalCount, null);
  assert.equal(visible.confidence, null);
  assert.equal(visible.qualityScore, null);
  assert.equal(visible.gradeCounts, null);
  assert.equal(visible.gradeA, null);
  assert.equal(visible.measurements, null);
  assert.equal(visible.defects, null);
  assert.deepEqual(visible.warnings, []);
  assert.deepEqual(visible.detections, []);
  assert.equal(visible.annotatedImageAllowed, false);
  assert.equal(visible.images.original, '/scans/scan-1/image/original');
  assert.equal(visible.images.processed, null);
  assert.equal(visible.images.annotated, null);
  assert.equal(visible.pricing.active, false);
  assert.equal(visible.pricing.mode, 'none');
});

test('disabled grades are filtered from counts, detections, final grade, confidence, and annotation', () => {
  const settings = settingsWith();
  settings.predictions.grades = { A: true, B: false, C: false, D: false };
  const visible = applyScanPolicy(scan(), settings);

  assert.deepEqual(visible.gradeCounts, { A: 3 });
  assert.equal(visible.gradeA, 3);
  assert.equal('gradeB' in visible, false);
  assert.equal(visible.totalCount, 3);
  assert.equal(visible.finalGrade, null);
  assert.equal(visible.finalGradeSource, 'hidden_by_policy');
  assert.equal(visible.confidence, null);
  assert.equal(visible.qualityScore, null);
  assert.equal(visible.detections.length, 3);
  assert.ok(visible.detections.every((item) => item.grade === 'GradeA'));
  assert.equal(visible.annotatedImageAllowed, false);
  assert.equal(visible.images.annotated, null);
  assert.equal(isAnnotatedImageAllowed(scan(), buildPolicy(settings)), false);
});

test('A/B annotation remains available only when every model-supported grade is enabled', () => {
  const settings = settingsWith();
  const visible = applyScanPolicy(scan(), settings);
  assert.equal(visible.annotatedImageAllowed, true);
  assert.equal(
    visible.images.annotated,
    '/scans/scan-1/image/annotated'
  );
  assert.equal(isAnnotatedImageAllowed(scan(), buildPolicy(settings)), true);
});

test('C/D-only policy exposes no model count or confidence and keeps C/D counts null', () => {
  const settings = settingsWith();
  settings.predictions.grades = { A: false, B: false, C: true, D: true };
  settings.predictions.geminiEnabled = true;

  const visible = applyScanPolicy(
    scan({
      finalGrade: 'Grade C',
      finalGradeSource: 'gemini_advisory',
      geminiAdvisory: {
        status: 'ok',
        gradeHint: 'Grade C',
        evidence: ['Visual colour and texture are consistent with Grade C.'],
        limitations: [],
      },
    }),
    settings
  );

  assert.deepEqual(visible.gradeCounts, { C: null, D: null });
  assert.equal(visible.totalCount, null);
  assert.equal(visible.confidence, null);
  assert.equal(visible.qualityScore, null);
  assert.deepEqual(visible.supportedGrades, []);
  assert.deepEqual(visible.unavailableGrades, ['C', 'D']);
  assert.equal(visible.finalGrade, 'Grade C');
  assert.equal(visible.finalGradeSource, 'gemini_advisory');
  assert.equal(visible.geminiAdvisory.gradeHint, 'Grade C');
  assert.equal(visible.annotatedImageAllowed, false);
});

test('policy keeps enabled-grade presence when the overall advisory hint names a hidden A/B grade', () => {
  const settings = settingsWith();
  settings.predictions.grades = { A: false, B: false, C: false, D: true };
  settings.predictions.geminiEnabled = true;

  const visible = applyScanPolicy(
    scan({
      finalGrade: 'Grade D',
      finalGradeSource: 'gemini_advisory',
      geminiAdvisory: {
        status: 'ok',
        imageUsable: true,
        gradeHint: 'Grade A',
        gradePresence: {
          A: { visible: true, evidence: 'Clean Grade A examples are visible.' },
          B: { visible: false, evidence: 'No Grade B example is visible.' },
          C: { visible: false, evidence: 'Possible Grade C discolouration is visible.' },
          D: { visible: true, evidence: 'Substantial damage is visible on a nut.' },
        },
        reviewRecommendation: 'Grade A looks likely, but confirm the damaged nut.',
        evidence: ['Possible Grade C appearance and a damaged Grade D nut.'],
        limitations: ['Not a validated grade.'],
      },
    }),
    settings
  );

  assert.equal(visible.geminiAdvisory.gradeHint, null);
  assert.deepEqual(Object.keys(visible.geminiAdvisory.gradePresence), ['D']);
  assert.equal(visible.geminiAdvisory.gradePresence.D.visible, true);
  assert.deepEqual(visible.geminiAdvisory.visibleGrades, ['D']);
  assert.equal(visible.geminiAdvisory.reviewRecommendation, null);
  assert.deepEqual(visible.geminiAdvisory.evidence, []);
  assert.match(visible.geminiAdvisory.hiddenReason, /overall grade hint/i);
});

test('legacy error defect statuses are normalized to unavailable on read', () => {
  const settings = settingsWith();
  settings.defects = {
    masterEnabled: true,
    categories: { blackSpots: true, cracks: true, mold: true, discoloration: true },
  };
  const visible = applyScanPolicy(
    scan({
      defects: {
        analysisStatus: 'error',
        categories: {
          blackSpots: { status: 'error', explanation: 'Previous request failed.' },
          cracks: { status: 'not_detected', explanation: 'No splits visible.' },
          mold: { status: 'uncertain', explanation: 'Pale patch is ambiguous.' },
          discoloration: { status: 'not_detected', explanation: 'Natural variation.' },
        },
      },
    }),
    settings
  );

  assert.equal(visible.defects.analysisStatus, 'partial');
  assert.equal(visible.defects.categories.blackSpots.status, 'unavailable');
  assert.equal(
    ['detected', 'not_detected', 'uncertain', 'unavailable'].includes(
      visible.defects.categories.blackSpots.status
    ),
    true
  );
});

test('Gemini advisory text is suppressed when its hinted grade is disabled', () => {
  const settings = settingsWith();
  settings.predictions.grades = { A: false, B: false, C: false, D: true };
  settings.predictions.geminiEnabled = true;

  const visible = applyScanPolicy(
    scan({
      finalGrade: 'Grade C',
      finalGradeSource: 'gemini_advisory',
      geminiAdvisory: {
        status: 'ok',
        gradeHint: 'Grade C',
        evidence: ['Possible Grade C appearance.'],
        limitations: [],
      },
    }),
    settings
  );

  assert.equal(visible.finalGrade, null);
  assert.equal(visible.finalGradeSource, 'hidden_by_policy');
  assert.equal(visible.geminiAdvisory.gradeHint, null);
  assert.deepEqual(visible.geminiAdvisory.evidence, []);
  assert.match(visible.geminiAdvisory.hiddenReason, /hidden by the display policy/);
});

test('enabled defect categories are shown while disabled findings and explanations are removed', () => {
  const settings = settingsWith();
  settings.predictions.geminiEnabled = true;
  settings.defects = {
    masterEnabled: true,
    categories: { blackSpots: true, cracks: false, mold: true, discoloration: false },
  };
  const visible = applyScanPolicy(
    scan({
      defects: {
        analysisStatus: 'success',
        analysisMethod: 'gemini_vision',
        model: 'gemini-test',
        analyzedAt: '2026-10-30T10:00:00.000Z',
        latencyMs: 120,
        imageLevelOnly: true,
        localizationAvailable: false,
        affectedNutCountsAvailable: false,
        note: 'Image-level only.',
        limitations: ['Cracks are difficult to see in this lighting.', 'Counts need a detector.'],
        categories: {
          blackSpots: {
            key: 'blackSpots',
            name: 'Black Spots',
            status: 'detected',
            affectedNutCount: 7,
            countBasis: 'not_established',
            explanation: 'Dark patches are visible on several nuts.',
          },
          cracks: {
            key: 'cracks',
            name: 'Cracks',
            status: 'detected',
            affectedNutCount: 2,
            countBasis: 'not_established',
            explanation: 'Micro-fractures are visible.',
          },
          mold: {
            key: 'mold',
            name: 'Suspected Mold',
            status: 'uncertain',
            affectedNutCount: null,
            countBasis: 'not_established',
            explanation: 'A pale patch may be mold-like growth.',
          },
          discoloration: {
            key: 'discoloration',
            name: 'Discoloration',
            status: 'not_detected',
            affectedNutCount: null,
            countBasis: 'not_established',
            explanation: 'Colour variation looks natural.',
          },
        },
      },
    }),
    settings
  );

  assert.equal(visible.defectDetectionEnabled, true);
  assert.deepEqual(visible.enabledDefectCategories, ['blackSpots', 'mold']);
  assert.deepEqual(Object.keys(visible.defects.categories), ['blackSpots', 'mold']);
  assert.equal(visible.defects.categories.blackSpots.affectedNutCount, null);
  assert.equal(visible.defects.categories.mold.status, 'uncertain');
  assert.equal(JSON.stringify(visible.defects).includes('Micro-fractures'), false);
  assert.equal(JSON.stringify(visible.defects).includes('Colour variation'), false);
  assert.equal(JSON.stringify(visible.defects.limitations).includes('Cracks'), false);
});

test('master defect off or no enabled categories removes every defect finding', () => {
  const base = scan({
    defects: {
      analysisStatus: 'success',
      categories: {
        blackSpots: { status: 'detected', explanation: 'Dark patches.' },
      },
    },
  });

  const masterOff = settingsWith();
  masterOff.defects = {
    masterEnabled: false,
    categories: { blackSpots: true, cracks: true, mold: true, discoloration: true },
  };
  const hidden = applyScanPolicy(base, masterOff);
  assert.equal(hidden.defects, null);
  assert.equal(hidden.defectDetectionEnabled, false);
  assert.deepEqual(hidden.enabledDefectCategories, []);

  const allCategoriesOff = settingsWith();
  allCategoriesOff.defects = {
    masterEnabled: true,
    categories: { blackSpots: false, cracks: false, mold: false, discoloration: false },
  };
  const noCategories = applyScanPolicy(base, allCategoriesOff);
  assert.equal(noCategories.defects, null);
  assert.equal(noCategories.defectDetectionEnabled, false);
});

test('a missing stored defect analysis is reported as unavailable, not not-detected', () => {
  const settings = settingsWith();
  settings.predictions.geminiEnabled = true;
  settings.defects = {
    masterEnabled: true,
    categories: { blackSpots: true, cracks: true, mold: true, discoloration: true },
  };
  const visible = applyScanPolicy(scan({ defects: null }), settings);

  assert.equal(visible.defects.analysisStatus, 'unavailable');
  assert.equal(visible.defects.errorCode, 'not_analyzed');
  assert.equal(visible.defects.categories.blackSpots.status, 'unavailable');
  assert.match(visible.defects.categories.blackSpots.explanation, /No Gemini defect analysis/);
  assert.equal(
    Object.values(visible.defects.categories).some((item) => item.status === 'not_detected'),
    false
  );
});

test('manual pricing uses enabled counts and a measured weight, never avg nut weight', () => {
  const settings = manualSettings({
    A: { price: 200, unit: 'per_kg' },
    B: { price: 30000, unit: 'per_quintal' },
  });
  const pricing = computePricing({
    settings,
    counts: { A: 50, B: 50 },
    weightKg: 10,
  });

  assert.equal(pricing.status, 'ready');
  assert.equal(pricing.totalValue, 2500);
  assert.equal(pricing.totalWeightKg, 10);
  assert.equal(pricing.weightedPricePerKg, 250);
  const byGrade = Object.fromEntries(
    pricing.lineItems.map((item) => [item.grade, item])
  );
  assert.equal(byGrade.A.subtotal, 1000);
  assert.equal(byGrade.B.unit, 'per_quintal');
  assert.equal(byGrade.B.subtotal, 1500);

  const lot = { measuredWeightKg: 10, avgNutWeightG: 2 };
  const valuation = computeValuation(
    { gradeCounts: { A: 50, B: 50 } },
    lot,
    settings
  );
  assert.equal(valuation.totalWeightKg, 10);
  assert.equal(valuation.estimatedWeightKg, 0.2);
  assert.equal(valuation.totalValue, 2500);
  assert.equal(valuation.perGrade.A.weightKg, 5);
  assert.equal(valuation.perGrade.A.value, 1000);
});

test('measured weight is required for per-kg and per-quintal values', () => {
  const settings = manualSettings({
    A: { price: 200, unit: 'per_kg' },
  });
  const pricing = computePricing({
    settings,
    counts: { A: 50 },
    weightKg: null,
  });

  assert.equal(pricing.status, 'needs_weight');
  assert.equal(pricing.totalValue, null);
  assert.equal(pricing.lineItems[0].subtotal, null);

  const valuation = computeValuation(
    { gradeCounts: { A: 50 } },
    { avgNutWeightG: 2, measuredWeightKg: 0 },
    settings
  );
  assert.equal(valuation.totalValue, null);
  assert.equal(valuation.totalWeightKg, null);
  assert.equal(valuation.estimatedWeightKg, 0.1);
  assert.match(valuation.assumptions.weight, /estimate only/);
});

test('mixed per-nut and per-kg pricing allocates measured weight across all counted grades', () => {
  const settings = manualSettings({
    A: { price: 5, unit: 'per_nut' },
    B: { price: 100, unit: 'per_kg' },
  });
  const pricing = computePricing({
    settings,
    counts: { A: 50, B: 50 },
    weightKg: 10,
  });

  assert.equal(pricing.status, 'ready');
  assert.equal(pricing.totalValue, 750);
  const byGrade = Object.fromEntries(
    pricing.lineItems.map((item) => [item.grade, item])
  );
  assert.equal(byGrade.A.subtotal, 250);
  assert.equal(byGrade.B.subtotal, 500);

  const valuation = computeValuation(
    { gradeCounts: { A: 50, B: 50 } },
    { measuredWeightKg: 10 },
    settings
  );
  assert.equal(valuation.perGrade.A.weightKg, 5);
  assert.equal(valuation.perGrade.A.value, 250);
  assert.equal(valuation.perGrade.B.weightKg, 5);
  assert.equal(valuation.perGrade.B.value, 500);
});

test('pricing without configured prices reports no estimate instead of a zero total', () => {
  const settings = manualSettings({});
  const pricing = computePricing({
    settings,
    counts: { A: 20 },
    weightKg: 2,
  });
  assert.equal(pricing.status, 'no_configured_prices');
  assert.equal(pricing.totalValue, null);
  assert.equal(pricing.lineItems[0].subtotal, null);
});

test('live pricing requires a count, a quote, and measured weight', () => {
  const settings = liveSettings();
  const livePrice = { pricePerKg: 350, pricePerQuintal: 35000 };

  const noCount = computePricing({
    settings,
    counts: {},
    livePrice,
    weightKg: 10,
  });
  assert.equal(noCount.status, 'no_detections');
  assert.equal(noCount.totalValue, null);

  const noQuote = computeScanPricing(
    { gradeCounts: { A: 10 }, totalCount: 10 },
    settings,
    { livePrice: null, weightKg: 5 }
  );
  assert.equal(noQuote.status, 'live_unavailable');
  assert.equal(noQuote.totalValue, null);

  const noWeight = computePricing({
    settings,
    counts: { A: 10 },
    livePrice,
  });
  assert.equal(noWeight.status, 'needs_weight');
  assert.equal(noWeight.totalValue, null);

  const ready = computePricing({
    settings,
    counts: { A: 10 },
    livePrice,
    weightKg: 12.5,
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.totalValue, 4375);
});

test('per-nut pricing does not require measured weight', () => {
  const settings = manualSettings({
    A: { price: 3.5, unit: 'per_nut' },
  });
  const pricing = computeScanPricing(
    { gradeCounts: { A: 20 }, totalCount: 20 },
    settings
  );
  assert.equal(pricing.status, 'ready');
  assert.equal(pricing.totalValue, 70);
  assert.equal(pricing.requiresWeight, false);
});

test('no active pricing mode suppresses all price estimates', () => {
  const settings = settingsWith();
  const pricing = computePricing({
    settings,
    counts: { A: 20 },
    weightKg: 5,
  });
  assert.equal(pricing.active, false);
  assert.equal(pricing.status, 'pricing_disabled');
  assert.equal(pricing.totalValue, null);
});

test('lot aggregation and serialization respect master-off policy', () => {
  const settings = settingsWith();
  settings.predictions.masterEnabled = false;
  const scans = [
    { gradeA: 4, gradeB: 1, totalCount: 5, confidence: 90, qualityScore: 80 },
    { gradeA: 1, gradeB: 3, totalCount: 4, confidence: 70, qualityScore: 60 },
  ];

  const aggregates = aggregateScans(scans, settings);
  assert.equal(aggregates.scanCount, 2);
  assert.equal(aggregates.totalNuts, null);
  assert.deepEqual(aggregates.gradeCounts, {});
  assert.equal(aggregates.avgConfidence, null);
  assert.equal(aggregates.avgQualityScore, null);

  const lot = {
    _id: 'lot-1',
    name: 'Policy lot',
    measuredWeightKg: 10,
    avgNutWeightG: 2,
  };
  const summary = serializeLotSummary(lot, scans, settings);
  assert.equal(summary.totals.totalNuts, null);
  assert.equal(summary.valuation.totalValue, null);
  assert.equal(summary.valuation.totalWeightKg, 10);
  assert.equal(summary.measuredWeightKg, 10);
  assert.equal(summary.policy.masterEnabled, false);
});

test('lot valuation never uses avgNutWeightG for a priced total', () => {
  const settings = manualSettings({
    A: { price: 100, unit: 'per_kg' },
    B: { price: 100, unit: 'per_kg' },
  });
  const lot = {
    _id: 'lot-2',
    name: 'Estimate-only lot',
    avgNutWeightG: 2,
    measuredWeightKg: 0,
  };
  const summary = serializeLotSummary(
    lot,
    [{ gradeA: 50, gradeB: 50, totalCount: 100 }],
    settings
  );
  assert.equal(summary.valuation.status, 'needs_weight');
  assert.equal(summary.valuation.totalValue, null);
  assert.equal(summary.valuation.estimatedWeightKg, 0.2);
  assert.equal(summary.valuation.totalWeightKg, null);
});

test('C/D-only lot views hide A/B model counts and confidence', () => {
  const settings = settingsWith();
  settings.predictions.grades = { A: false, B: false, C: true, D: true };
  settings.predictions.geminiEnabled = true;
  const scans = [
    {
      gradeA: 50,
      gradeB: 20,
      gradeC: 0,
      gradeD: 0,
      totalCount: 70,
      confidence: 88,
      qualityScore: 70,
      supportedGrades: ['A', 'B'],
    },
  ];
  const aggregates = aggregateScans(scans, settings);
  assert.deepEqual(aggregates.gradeCounts, { C: null, D: null });
  assert.equal(aggregates.totalNuts, null);
  assert.equal(aggregates.avgConfidence, null);
  assert.equal(aggregates.avgQualityScore, null);
  assert.deepEqual(aggregates.unavailableGrades, ['C', 'D']);

  const valuation = computeValuation(
    aggregates,
    { measuredWeightKg: 10, avgNutWeightG: 2 },
    settings
  );
  assert.equal(valuation.totalValue, null);
  assert.equal(valuation.perGrade.C.count, null);
  assert.equal(valuation.perGrade.D.count, null);
  assert.equal(valuation.estimatedWeightKg, null);
});

test('lot measured-weight allocation includes only enabled grades', () => {
  const settings = manualSettings({
    A: { price: 100, unit: 'per_kg' },
    B: { price: 500, unit: 'per_kg' },
  });
  settings.predictions.grades = { A: true, B: false, C: false, D: false };
  const valuation = computeValuation(
    { gradeCounts: { A: 50, B: 50 } },
    { measuredWeightKg: 10 },
    settings
  );
  assert.equal(valuation.totalValue, 1000);
  assert.equal(valuation.perGrade.A.weightKg, 10);
  assert.equal(valuation.perGrade.A.value, 1000);
  assert.equal('B' in valuation.perGrade, false);
  assert.equal(computeLotPricing({ gradeCounts: { A: 50 } }, { measuredWeightKg: 10 }, settings).totalValue, 1000);
});
