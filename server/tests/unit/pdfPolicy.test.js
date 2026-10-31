'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { PDFParse } = require('pdf-parse');

const { buildPredictionReport, buildComparisonReport } = require('../../utils/pdf');
const { defaultSettings, applyScanPolicy } = require('../../services/settingsService');

async function makeImages() {
  const original = await sharp({
    create: {
      width: 240,
      height: 120,
      channels: 3,
      background: { r: 25, g: 120, b: 70 },
    },
  })
    .webp()
    .toBuffer();
  const processed = await sharp({
    create: {
      width: 120,
      height: 240,
      channels: 4,
      background: { r: 220, g: 80, b: 45, alpha: 0.45 },
    },
  })
    .png()
    .toBuffer();
  const annotated = await sharp({
    create: {
      width: 240,
      height: 120,
      channels: 3,
      background: { r: 245, g: 220, b: 130 },
    },
  })
    .jpeg()
    .toBuffer();
  return { original, processed, annotated };
}

function pricing() {
  return {
    active: true,
    mode: 'manual',
    currency: 'INR',
    status: 'ready',
    lineItems: [
      {
        grade: 'A',
        label: 'Grade A',
        count: 3,
        price: 200,
        unit: 'per_kg',
        unitLabel: 'INR per kg',
        subtotal: 1000,
      },
      {
        grade: 'B',
        label: 'Grade B',
        count: 2,
        price: 300,
        unit: 'per_kg',
        unitLabel: 'INR per kg',
        subtotal: 1500,
      },
    ],
    totalValue: 2500,
    totalWeightKg: 5,
    weightSource: 'user_entered_measured_weight',
    weightedPricePerKg: 250,
    requiresWeight: false,
    formula: 'measured weight x count-weighted price per kg',
    note: 'Manual estimate.',
    estimateOnly: true,
  };
}

function scan(overrides = {}) {
  return {
    _id: 'pdf-scan-1',
    reportId: 'ARG-PDF-TEST-1',
    filename: 'tray.webp',
    createdAt: new Date('2026-10-29T10:00:00Z'),
    processingMs: 123,
    modelId: 'arecanut-yolov8',
    modelVersion: 'preserved',
    modelChecksum: '5E141ABD6BD334E61AA733AA00994B8E5AF4D2104A677BE4A7B7215092883268',
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
    defects: { supported: false, reason: 'No defect classifier is bundled.' },
    measurements: {
      available: true,
      method: 'image-space',
      units: 'pixels',
      avg_major_axis_px: 20,
      avg_minor_axis_px: 16,
      avg_aspect_ratio: 1.25,
    },
    warnings: ['Grade C/D are advisory only.'],
    detections: [
      {
        label: 'GradeA',
        grade: 'GradeA',
        confidence_pct: 90,
        bbox: [1, 2, 20, 30],
        box_width_px: 19,
        box_height_px: 28,
      },
    ],
    pricing: pricing(),
    images: {
      original: '/original',
      processed: '/processed',
      annotated: '/annotated',
    },
    ...overrides,
  };
}

function settingsWithGrades(grades, extra = {}) {
  const settings = defaultSettings();
  settings.predictions.grades = grades;
  settings.predictions.masterEnabled = extra.masterEnabled ?? true;
  settings.predictions.geminiEnabled = Boolean(extra.geminiEnabled);
  settings.pricing.mode = extra.pricingMode || 'manual';
  settings.version = 7;
  if (extra.defects) settings.defects = extra.defects;
  return settings;
}

function storedDefects() {
  return {
    analysisStatus: 'success',
    analysisMethod: 'gemini_vision',
    model: 'gemini-test',
    analyzedAt: '2026-10-30T10:00:00.000Z',
    latencyMs: 120,
    imageLevelOnly: true,
    localizationAvailable: false,
    affectedNutCountsAvailable: false,
    note: 'Image-level findings only. No affected-nut count is claimed.',
    limitations: ['Defect counts require a validated detector.'],
    categories: {
      blackSpots: {
        key: 'blackSpots',
        name: 'Black Spots',
        status: 'detected',
        affectedNutCount: 7,
        countBasis: 'not_established',
        explanation: 'Dark surface patches are visible.',
      },
      cracks: {
        key: 'cracks',
        name: 'Cracks',
        status: 'detected',
        affectedNutCount: null,
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
  };
}

async function textOf(pdf) {
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function imageCount(pdf) {
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    const result = await parser.getImage();
    return (result.pages || []).reduce(
      (sum, page) => sum + ((page.images && page.images.length) || 0),
      0
    );
  } finally {
    await parser.destroy();
  }
}

test('master-on PDF keeps all evidence images and policy-approved sections', async () => {
  const images = await makeImages();
  const view = applyScanPolicy(
    scan(),
    settingsWithGrades({ A: true, B: true, C: false, D: false })
  );
  const pdf = await buildPredictionReport(view, images);
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');

  const text = await textOf(pdf);
  assert.match(text, /FINAL GRADE/);
  assert.match(text, /Confidence: 88\.5%/);
  assert.match(text, /Quality score: 72\.3/);
  assert.match(text, /Detected nuts: 5 \(A: 3, B: 2\)/);
  assert.match(text, /Original image/);
  assert.match(text, /Processed image/);
  assert.match(text, /Annotated image/);
  assert.match(text, /aspect preserved/);
  assert.match(text, /PRICE ESTIMATE/);
  assert.match(text, /Estimated total: INR 2500\.00/);
  assert.doesNotMatch(text, /Image normalization warning/);
  assert.ok((await imageCount(pdf)) >= 3);
});

test('PDF includes enabled defect findings and omits disabled categories and unverified counts', async () => {
  const images = await makeImages();
  const view = applyScanPolicy(
    scan({ defects: storedDefects() }),
    settingsWithGrades(
      { A: true, B: true, C: false, D: false },
      {
        geminiEnabled: true,
        defects: {
          masterEnabled: true,
          categories: {
            blackSpots: true,
            cracks: false,
            mold: true,
            discoloration: false,
          },
        },
      }
    )
  );
  assert.equal(view.defectDetectionEnabled, true);
  const pdf = await buildPredictionReport(view, images);
  const text = await textOf(pdf);

  assert.match(text, /DEFECT ANALYSIS \(IMAGE-LEVEL REVIEW\)/);
  assert.match(text, /Black Spots/);
  assert.match(text, /Suspected Mold/);
  assert.match(text, /Analysis method/);
  assert.match(text, /Automated Vision, Image-Level/);
  assert.match(text, /Not established \(requires a validated detector\)/);
  assert.doesNotMatch(text, /Micro-fractures/);
  assert.doesNotMatch(text, /Colour variation/);
  assert.doesNotMatch(text, /Affected nuts: 7/);
});

test('PDF never renders an unavailable defect analysis as \"None detected\" and shows advisory presence', async () => {
  const images = await makeImages();
  const defects = storedDefects();
  defects.analysisStatus = 'unavailable';
  defects.categories = {
    blackSpots: {
      key: 'blackSpots',
      name: 'Black Spots',
      status: 'unavailable',
      affectedNutCount: null,
      explanation: 'Analysis unavailable: Gemini timed out. This is not a detection result.',
    },
    cracks: {
      key: 'cracks',
      name: 'Cracks',
      status: 'unavailable',
      affectedNutCount: null,
      explanation: 'Analysis unavailable: Gemini timed out. This is not a detection result.',
    },
    mold: {
      key: 'mold',
      name: 'Suspected Mold',
      status: 'unavailable',
      affectedNutCount: null,
      explanation: 'Analysis unavailable: Gemini timed out. This is not an absence finding.',
    },
    discoloration: {
      key: 'discoloration',
      name: 'Discoloration',
      status: 'unavailable',
      affectedNutCount: null,
      explanation: 'Analysis unavailable: Gemini timed out. This is not an absence finding.',
    },
  };

  const view = applyScanPolicy(
    scan({
      finalGrade: 'Grade D',
      finalGradeSource: 'gemini_advisory',
      finalGradeLabel: 'Advisory visual grade (non-counting)',
      defects,
      geminiAdvisory: {
        status: 'ok',
        advisoryOnly: true,
        imageUsable: true,
        gradeHint: 'Grade A',
        gradePresence: {
          A: { visible: true, evidence: 'Clean Grade A examples are visible.' },
          B: { visible: false, evidence: 'No Grade B example is visible.' },
          C: { visible: false, evidence: 'No clearly Grade C example is visible.' },
          D: { visible: true, evidence: 'Substantial damage is visible on a nut.' },
        },
        reviewRecommendation: 'Retake a closer, evenly lit photo for a second review.',
        evidence: ['A damaged nut is visible.'],
        limitations: ['Advisory only.'],
      },
    }),
    settingsWithGrades(
      { A: false, B: false, C: true, D: true },
      {
        geminiEnabled: true,
        defects: {
          masterEnabled: true,
          categories: {
            blackSpots: true,
            cracks: true,
            mold: true,
            discoloration: true,
          },
        },
      }
    )
  );

  const pdf = await buildPredictionReport(view, images);
  const text = await textOf(pdf);
  assert.match(text, /DEFECT ANALYSIS \(IMAGE-LEVEL REVIEW\)/);
  assert.match(text, /Analysis unavailable/);
  assert.match(text, /This is not a detection result/);
  assert.doesNotMatch(text, /None detected/);
  assert.match(text, /Visible grade presence/);
  assert.match(text, /Visible grade presence\s*Grade D/);
  assert.doesNotMatch(text, /Grade A visible/);
  assert.match(text, /Review recommendation/);
  assert.match(text, /Retake a closer, evenly lit photo/);
  assert.match(text, /EXTENDED GRADING ANALYSIS/);
});

test('PDF omits defect analysis when master defect detection is off', async () => {
  const images = await makeImages();
  const view = applyScanPolicy(
    scan({ defects: storedDefects() }),
    settingsWithGrades(
      { A: true, B: true, C: false, D: false },
      {
        geminiEnabled: true,
        defects: {
          masterEnabled: false,
          categories: {
            blackSpots: true,
            cracks: true,
            mold: true,
            discoloration: true,
          },
        },
      }
    )
  );
  assert.equal(view.defects, null);
  const pdf = await buildPredictionReport(view, images);
  const text = await textOf(pdf);
  assert.doesNotMatch(text, /Defect analysis/);
  assert.doesNotMatch(text, /Black Spots/);
  assert.doesNotMatch(text, /Suspected Mold/);
});

test('master-off PDF embeds only the original image and hides grading and price sections', async () => {
  const images = await makeImages();
  const view = applyScanPolicy(
    scan(),
    settingsWithGrades(
      { A: true, B: true, C: false, D: false },
      { masterEnabled: false }
    )
  );
  const pdf = await buildPredictionReport(view, images);
  const text = await textOf(pdf);

  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.match(text, /GRADING STATUS/);
  assert.match(text, /Disabled by administrator/);
  assert.match(text, /Original image/);
  assert.doesNotMatch(text, /FINAL GRADE/);
  assert.doesNotMatch(text, /Confidence:/);
  assert.doesNotMatch(text, /Detected nuts:/);
  assert.doesNotMatch(text, /Quality score:/);
  assert.doesNotMatch(text, /Processed image/);
  assert.doesNotMatch(text, /Annotated image/);
  assert.doesNotMatch(text, /Price estimate/);
  assert.doesNotMatch(text, /Estimated total/);
  assert.doesNotMatch(text, /Grade composition/);
  assert.equal(await imageCount(pdf), 1);
});

test('annotated PDF evidence is hidden when the active policy disables a model-supported grade', async () => {
  const images = await makeImages();
  const view = applyScanPolicy(
    scan({
      finalGrade: 'Grade C',
      finalGradeSource: 'gemini_advisory',
      geminiAdvisory: {
        status: 'ok',
        advisoryOnly: true,
        gradeHint: 'Grade C',
        evidence: ['Visual surface colour is consistent with Grade C.'],
        limitations: ['Advisory only.'],
      },
    }),
    settingsWithGrades(
      { A: false, B: false, C: true, D: false },
      { geminiEnabled: true }
    )
  );
  assert.equal(view.annotatedImageAllowed, false);
  assert.equal(view.images.annotated, null);

  const pdf = await buildPredictionReport(view, images);
  const text = await textOf(pdf);
  assert.match(text, /Processed image/);
  assert.match(text, /annotated image is hidden because it contains boxes for a grade disabled/);
  assert.doesNotMatch(text, /Annotated image \(model detections\)/);
  assert.equal(await imageCount(pdf), 2);
});

test('comparison PDF applies the same master-off suppression', async () => {
  const images = await makeImages();
  const views = [
    applyScanPolicy(
      scan({ _id: 'pdf-a', reportId: 'ARG-PDF-A' }),
      settingsWithGrades(
        { A: true, B: true, C: false, D: false },
        { masterEnabled: false }
      )
    ),
    applyScanPolicy(
      scan({ _id: 'pdf-b', reportId: 'ARG-PDF-B' }),
      settingsWithGrades(
        { A: true, B: true, C: false, D: false },
        { masterEnabled: false }
      )
    ),
  ];
  const pdf = await buildComparisonReport(views, [images, images]);
  const text = await textOf(pdf);
  assert.match(text, /Comparison report/);
  assert.doesNotMatch(text, /FINAL GRADE/);
  assert.doesNotMatch(text, /Confidence/);
  assert.doesNotMatch(text, /Detected nuts/);
  assert.doesNotMatch(text, /Price estimate/);
  assert.doesNotMatch(text, /Processed image/);
  assert.doesNotMatch(text, /Annotated image/);
  assert.equal(await imageCount(pdf), 2);
});
