'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeGrade,
  normalizeStatus,
  normalizeBatchStatus,
  parseNumberField,
  parseDateTimeField,
  buildImageQuality,
  calculateEstimatedValue,
  summarizeRecords,
  summarizeBatch,
  csvEscape,
  escapeRegex,
} = require('../../utils/manualValidation');

test('manual grades accept only A and B', () => {
  assert.equal(normalizeGrade('A'), 'A');
  assert.equal(normalizeGrade('grade b'), 'B');
  assert.equal(normalizeGrade('B'), 'B');
  assert.equal(normalizeGrade('C'), null);
  assert.equal(normalizeGrade(''), null);
  assert.equal(normalizeGrade(null), null);
});

test('record and batch statuses are constrained', () => {
  assert.equal(normalizeStatus('DRAFT'), 'draft');
  assert.equal(normalizeStatus('completed'), 'completed');
  assert.equal(normalizeStatus('archived'), null);
  assert.equal(normalizeStatus(undefined), 'completed');
  assert.equal(normalizeBatchStatus('completed'), 'completed');
  assert.equal(normalizeBatchStatus('closed'), null);
  assert.equal(normalizeBatchStatus(undefined), 'open');
});

test('numeric fields reject invalid, fractional, and out-of-range values', () => {
  assert.deepEqual(parseNumberField('12.5', { field: 'Weight', min: 0, max: 100 }), {
    value: 12.5,
    error: null,
  });
  assert.match(
    parseNumberField('1.5', { field: 'Quantity', min: 1, max: 10, integer: true }).error,
    /whole number/
  );
  assert.match(
    parseNumberField('0', { field: 'Quantity', min: 1, max: 10 }).error,
    /at least 1/
  );
  assert.match(
    parseNumberField('11', { field: 'Quantity', min: 1, max: 10 }).error,
    /at most 10/
  );
  assert.equal(parseNumberField('', { field: 'Quantity', required: true }).error, 'Quantity is required');
});

test('date fields reject invalid dates and future grading dates', () => {
  assert.equal(parseDateTimeField('2026-01-15T10:30', { field: 'Graded at' }).error, null);
  assert.match(
    parseDateTimeField('not-a-date', { field: 'Graded at' }).error,
    /valid date/
  );
  assert.match(
    parseDateTimeField('2999-01-01', { field: 'Graded at' }).error,
    /cannot be in the future/
  );
});

test('image quality is sanitized and explicitly advisory', () => {
  const quality = buildImageQuality(
    JSON.stringify({
      checked: true,
      width: 100000,
      height: -5,
      brightness: '140',
      blurScore: 20,
      source: 'untrusted-client-source',
      warnings: ['  Blurry image  ', 42, '', 'Low light'],
    })
  );
  assert.equal(quality.checked, true);
  assert.equal(quality.width, 50000);
  assert.equal(quality.height, 0);
  assert.equal(quality.brightness, 140);
  assert.equal(quality.source, 'browser-canvas');
  assert.deepEqual(quality.warnings, ['Blurry image', 'Low light']);
  assert.ok(quality.checkedAt instanceof Date);

  assert.equal(buildImageQuality('not json'), null);
  assert.equal(buildImageQuality({ checked: false }).checked, false);
  assert.equal(buildImageQuality({ checked: false }).source, 'browser-canvas');
});

test('valuation uses only user-provided weight and price', () => {
  assert.deepEqual(calculateEstimatedValue(12.5, 250), {
    value: 3125,
    formula: 'Weight in kilograms × price per kilogram',
  });
  assert.equal(calculateEstimatedValue(-1, 250).value, null);
  assert.equal(calculateEstimatedValue('abc', 250).value, null);
});

test('record summaries count only real stored values', () => {
  const summary = summarizeRecords([
    {
      status: 'completed',
      grade: 'A',
      quantity: 100,
      weightKg: 12.5,
      review: { reviewed: true },
      imageQuality: { warnings: [] },
    },
    {
      status: 'draft',
      grade: null,
      quantity: null,
      weightKg: 2.5,
      review: { reviewed: false, imageFlagged: true },
      imageQuality: { warnings: ['Blurry'] },
    },
  ]);
  assert.equal(summary.totalRecords, 2);
  assert.equal(summary.completed, 1);
  assert.equal(summary.drafts, 1);
  assert.equal(summary.gradeA, 1);
  assert.equal(summary.gradeB, 0);
  assert.equal(summary.gradeC, undefined);
  assert.equal(summary.totalQuantity, 100);
  assert.equal(summary.totalWeightKg, 15);
  assert.equal(summary.reviewed, 1);
  assert.equal(summary.pendingReview, 1);
  assert.equal(summary.flagged, 1);
  assert.equal(summary.imageQualityWarnings, 1);
});

test('batch progress is derived only from real records and optional targets', () => {
  const stats = summarizeBatch(
    { targetSamples: 5, targetWeightKg: 20 },
    { totalRecords: 4, completed: 2, totalWeightKg: 7.5 }
  );
  assert.equal(stats.pendingSamples, 1);
  assert.equal(stats.progressPct, 40);
  assert.equal(stats.remainingWeightKg, 12.5);
  assert.equal(stats.weightProgressPct, 38);

  const untargeted = summarizeBatch({}, { totalRecords: 2, completed: 2 });
  assert.equal(untargeted.pendingSamples, null);
  assert.equal(untargeted.progressPct, null);
});

test('CSV output blocks spreadsheet formula injection and quotes fields', () => {
  assert.equal(csvEscape('=SUM(A1:A2)'), "'=SUM(A1:A2)");
  assert.equal(csvEscape('+1'), "'+1");
  assert.equal(csvEscape('@command'), "'@command");
  assert.equal(csvEscape('Grade, A'), '"Grade, A"');
  assert.equal(csvEscape('say "hello"'), '"say ""hello"""');
  assert.equal(csvEscape(12.5), '12.5');
});

test('search terms are escaped before becoming regular expressions', () => {
  assert.equal(escapeRegex('a.b*c?'), 'a\\.b\\*c\\?');
  assert.equal(escapeRegex('(test)[x]'), '\\(test\\)\\[x\\]');
});
