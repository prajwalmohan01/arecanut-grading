'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normaliseResult,
  InferenceError,
} = require('../../services/inferenceService');

function rawResult(overrides = {}) {
  return {
    grade_a: 3,
    grade_b: 2,
    grade_c: 0,
    grade_d: 0,
    total: 5,
    final_grade: 'Grade A',
    report: {
      final_grade: 'Grade A',
      supported_grades: ['A', 'B'],
      unsupported_grades: ['C', 'D'],
      grade_counts: { A: 3, B: 2, C: 0, D: 0 },
      confidence_pct: 83.5,
      quality_score: 80,
      detections: [],
      warnings: ['Quality score is a heuristic.'],
      inference: {
        mode: 'tiled',
        tile_count: 12,
        tile_imgsz: 640,
        raw_detections: 180,
        deduped_detections: 5,
      },
      ...overrides.report,
    },
    model: { id: 'arecanut-yolov8-gradeab', supported_grades: ['A', 'B'] },
    image: { width: 1000, height: 800 },
    processing_ms: 1234.5,
    ...overrides,
  };
}

test('normaliseResult maps counts, grades, and inference metadata', () => {
  const result = normaliseResult(rawResult());

  assert.equal(result.gradeA, 3);
  assert.equal(result.gradeB, 2);
  assert.equal(result.gradeC, 0);
  assert.equal(result.gradeD, 0);
  assert.equal(result.total, 5);
  assert.equal(result.finalGrade, 'Grade A');
  assert.deepEqual(result.supportedGrades, ['A', 'B']);
  assert.equal(result.confidence, 83.5);
  assert.equal(result.qualityScore, 80);
  assert.equal(result.processingMs, 1234.5);
  assert.equal(result.inference.mode, 'tiled');
  assert.equal(result.inference.tile_count, 12);
  assert.equal(result.inference.raw_detections, 180);
  assert.equal(result.inference.deduped_detections, 5);
  assert.equal(result.warnings.length, 1);
});

test('normaliseResult keeps unsupported grades as zero', () => {
  const result = normaliseResult(
    rawResult({
      grade_a: 0,
      grade_b: 0,
      total: 0,
      final_grade: 'Invalid',
      report: {
        final_grade: 'Invalid',
        supported_grades: ['A', 'B'],
        confidence_pct: null,
        quality_score: null,
        detection: [],
      },
    })
  );

  assert.equal(result.finalGrade, 'Invalid');
  assert.equal(result.gradeC, 0);
  assert.equal(result.gradeD, 0);
  assert.equal(result.confidence, null);
  assert.equal(result.qualityScore, null);
  assert.equal(result.inference, null);
});

test('normaliseResult rejects an unknown final grade', () => {
  assert.throws(
    () => normaliseResult(rawResult({ final_grade: 'Grade E' })),
    (error) =>
      error instanceof InferenceError &&
      /unsupported grade/i.test(error.message)
  );
});

test('normaliseResult rejects negative counts', () => {
  assert.throws(
    () => normaliseResult(rawResult({ grade_a: -1 })),
    (error) => error instanceof InferenceError && /negative/i.test(error.message)
  );
});

test('normaliseResult surfaces service errors', () => {
  assert.throws(
    () => normaliseResult({ error: 'Model artifact missing' }),
    (error) =>
      error instanceof InferenceError &&
      /Model artifact missing/.test(error.message)
  );
});
