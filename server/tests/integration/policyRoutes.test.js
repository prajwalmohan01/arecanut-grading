'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arecanut-policy-test-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'policy-routes-test-secret-32-characters';
process.env.UPLOAD_DIR = uploadDir;

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { PDFParse } = require('pdf-parse');

const createApp = require('../../app');
const Scan = require('../../models/Scan');
const User = require('../../models/User');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

let mongo;
let app;

function authed(req, token) {
  return req.set('Authorization', `Bearer ${token}`);
}

function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function pdfText(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

function scanDoc(userId, overrides = {}) {
  return {
    filename: 'tray-policy.png',
    originalImage: 'policy-original.png',
    processedImage: 'policy-processed.png',
    annotatedImage: 'policy-annotated.png',
    gradeA: 50,
    gradeB: 50,
    gradeC: 0,
    gradeD: 0,
    gradeCounts: { A: 50, B: 50, C: 0, D: 0 },
    supportedGrades: ['A', 'B'],
    totalCount: 100,
    finalGrade: 'Grade B',
    finalGradeSource: 'model',
    confidence: 88,
    qualityScore: 72,
    qualityMethod: 'heuristic',
    confidenceMethod: 'mean detection confidence',
    measurements: { available: false },
    defects: { supported: false, reason: 'Not supported' },
    warnings: [],
    detections: [
      {
        label: 'GradeA',
        grade: 'GradeA',
        confidence: 0.9,
        confidence_pct: 90,
        bbox: [1, 2, 10, 20],
        box_width_px: 9,
        box_height_px: 18,
      },
    ],
    modelId: 'test-model',
    modelVersion: 'test',
    modelChecksum: 'test-checksum',
    processingMs: 10,
    user: userId,
    ...overrides,
  };
}

test('admin policy, pricing, lot, and PDF routes honor display rules', async (t) => {
  mongo = await MongoMemoryServer.create({ binary: { version: '8.2.6' } });
  await mongoose.connect(mongo.getUri());
  app = createApp();

  t.after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  ['policy-original.png', 'policy-processed.png', 'policy-annotated.png'].forEach(
    (name) => {
      fs.writeFileSync(path.join(uploadDir, name), PNG);
    }
  );

  const adminSignup = await request(app)
    .post('/api/auth/signup')
    .send({
      username: 'policy_admin',
      password: 'StrongPolicy!234',
      displayName: 'Policy Admin',
    });
  assert.equal(adminSignup.status, 201, JSON.stringify(adminSignup.body));
  const adminToken = adminSignup.body.token;
  const adminId = adminSignup.body.userId;
  await User.updateOne({ _id: adminId }, { $set: { role: 'admin' } });

  const userSignup = await request(app)
    .post('/api/auth/signup')
    .send({
      username: 'policy_user',
      password: 'StrongPolicy!234',
      displayName: 'Policy User',
    });
  assert.equal(userSignup.status, 201, JSON.stringify(userSignup.body));
  const userToken = userSignup.body.token;
  const userId = userSignup.body.userId;

  const scanA = await Scan.create(
    scanDoc(userId, {
      filename: 'tray-a.png',
      gradeA: 50,
      gradeB: 50,
      totalCount: 100,
    })
  );
  const scanB = await Scan.create(
    scanDoc(userId, {
      filename: 'tray-b.png',
      gradeA: 10,
      gradeB: 5,
      gradeCounts: { A: 10, B: 5, C: 0, D: 0 },
      totalCount: 15,
      finalGrade: 'Grade A',
    })
  );

  await t.test('authenticated policy is public but admin routes are guarded', async () => {
    const settings = await authed(request(app).get('/api/settings'), userToken);
    assert.equal(settings.status, 200);
    assert.equal(settings.body.policy.masterEnabled, true);
    assert.deepEqual(settings.body.policy.enabledLetters, ['A', 'B']);
    assert.equal(settings.body.gemini.advisoryOnly, true);

    const denied = await authed(
      request(app).get('/api/admin/settings'),
      userToken
    );
    assert.equal(denied.status, 403);
  });

  await t.test('C/D cannot be enabled without Gemini-assisted review', async () => {
    const response = await authed(
      request(app).put('/api/admin/settings/predictions'),
      adminToken
    ).send({
      masterEnabled: true,
      grades: { A: true, B: true, C: true, D: false },
      geminiEnabled: false,
    });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /Extended Grading Analysis switch/);

    const allowed = await authed(
      request(app).put('/api/admin/settings/predictions'),
      adminToken
    ).send({
      masterEnabled: true,
      grades: { A: true, B: true, C: true, D: false },
      geminiEnabled: true,
    });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
    assert.deepEqual(allowed.body.policy.enabledLetters, ['A', 'B', 'C']);

    const reverted = await authed(
      request(app).put('/api/admin/settings/predictions'),
      adminToken
    ).send({
      masterEnabled: true,
      grades: { A: true, B: true, C: false, D: false },
      geminiEnabled: false,
    });
    assert.equal(reverted.status, 200, JSON.stringify(reverted.body));
  });

  await t.test('admin Gemini status never exposes configured key values', async () => {
    const fakeKey = 'unit-test-never-expose-this-gemini-key';
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = fakeKey;
    try {
      const response = await authed(
        request(app).get('/api/admin/settings'),
        adminToken
      );
      assert.equal(response.status, 200);
      assert.equal(JSON.stringify(response.body).includes(fakeKey), false);
      assert.ok(response.body.gemini.configuredKeys >= 1);
      assert.equal(
        response.body.market.keyEnvHint,
        'Optional data.gov.in fallback: DATA_GOV_IN_API_KEY or AGMARKNET_API_KEY'
      );
      assert.equal(response.body.market.publicSource, true);
      assert.equal(response.body.market.canRefresh, true);
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });

  await t.test('disabling Grade B filters counts, final grade, history, stats, CSV, and annotated access', async () => {
    const update = await authed(
      request(app).put('/api/admin/settings/predictions'),
      adminToken
    ).send({
      masterEnabled: true,
      grades: { A: true, B: false, C: false, D: false },
      geminiEnabled: false,
    });
    assert.equal(update.status, 200, JSON.stringify(update.body));

    const detail = await authed(
      request(app).get(`/api/scans/${scanA._id}`),
      userToken
    );
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.scan.gradingEnabled, true);
    // With new logic: final grade = majority grade = highest count among enabled grades
    // Grade A is enabled with 50 counts, Grade B is disabled -> final grade = Grade A
    assert.equal(detail.body.scan.finalGrade, 'Grade A');
    assert.equal(detail.body.scan.finalGradeSource, 'count_based');
    assert.equal(detail.body.scan.gradeA, 50);
    assert.equal('gradeB' in detail.body.scan, false);
    assert.deepEqual(detail.body.scan.gradeCounts, { A: 50 });
    assert.equal(detail.body.scan.totalCount, 50);
    // Confidence/quality still available from model's A/B detections
    assert.ok(detail.body.scan.images.processed);
    assert.equal(detail.body.scan.detections.length, 1);

    const history = await authed(
      request(app).get('/api/scans/history?limit=10'),
      userToken
    );
    assert.equal(history.status, 200, JSON.stringify(history.body));
    assert.equal(history.body.summary.gradingEnabled, true);
    assert.equal(history.body.summary.gradeA, 60);
    assert.equal(history.body.summary.gradeB, undefined);
    assert.equal(history.body.summary.totalNuts, 60);
    assert.equal(history.body.summary.invalid, 0);
    assert.ok(
      history.body.items.every((item) => item.images.annotated === null)
    );

    const stats = await authed(request(app).get('/api/scans/stats'), userToken);
    assert.equal(stats.status, 200, JSON.stringify(stats.body));
    assert.deepEqual(
      stats.body.gradeDistribution.map((row) => row.grade),
      ['Grade A']
    );
    assert.equal(stats.body.totals.detections, 60);
    assert.equal(stats.body.totals.gradeB, undefined);

    const csv = await authed(
      request(app).get('/api/scans/export.csv'),
      userToken
    );
    assert.equal(csv.status, 200);
    assert.match(csv.text, /Enabled grades,A/);
    assert.match(csv.text, /Grade A/);
    assert.doesNotMatch(csv.text, /Grade B/);
    assert.match(csv.text, /Final grade,Grade A,Total enabled count,Confidence/);
    assert.match(csv.text, /Invalid \/ no enabled grade,0/);

    const original = await authed(
      request(app).get(`/api/scans/${scanA._id}/image/original`),
      userToken
    );
    assert.equal(original.status, 200);
    const annotated = await authed(
      request(app).get(`/api/scans/${scanA._id}/image/annotated`),
      userToken
    );
    assert.equal(annotated.status, 403);
    assert.match(annotated.body.error, /grade that is disabled/);
    const processed = await authed(
      request(app).get(`/api/scans/${scanA._id}/image/processed`),
      userToken
    );
    assert.equal(processed.status, 200);

    const gradeFilter = await authed(
      request(app).get('/api/scans/history?grade=B'),
      userToken
    );
    assert.equal(gradeFilter.status, 400);
    assert.match(gradeFilter.body.error, /disabled by the active display policy/);
  });

  await t.test('measured lot weight drives manual per-kg valuation through the API', async () => {
    const predictions = await authed(
      request(app).put('/api/admin/settings/predictions'),
      adminToken
    ).send({
      masterEnabled: true,
      grades: { A: true, B: true, C: false, D: false },
      geminiEnabled: false,
    });
    assert.equal(predictions.status, 200, JSON.stringify(predictions.body));

    const pricing = await authed(
      request(app).put('/api/admin/settings/pricing'),
      adminToken
    ).send({
      mode: 'manual',
      currency: 'INR',
      manual: {
        A: { price: 100, unit: 'per_kg' },
        B: { price: 500, unit: 'per_kg' },
        C: { price: 0, unit: 'per_kg' },
        D: { price: 0, unit: 'per_kg' },
      },
    });
    assert.equal(pricing.status, 200, JSON.stringify(pricing.body));
    assert.equal(pricing.body.policy.pricingMode, 'manual');

    const created = await authed(request(app).post('/api/lots'), userToken).send({
      name: 'Measured lot',
      measuredWeightKg: 10,
      avgNutWeightG: 2,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const lotId = created.body.lot.id;
    assert.equal(created.body.lot.measuredWeightKg, 10);

    await Scan.updateOne({ _id: scanA._id }, { $set: { lot: lotId } });

    const patched = await authed(
      request(app).patch(`/api/lots/${lotId}`),
      userToken
    ).send({ measuredWeightKg: 12 });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    assert.equal(patched.body.lot.measuredWeightKg, 12);
    assert.equal(patched.body.lot.valuation.totalValue, 3600);

    const restored = await authed(
      request(app).patch(`/api/lots/${lotId}`),
      userToken
    ).send({ measuredWeightKg: 10 });
    assert.equal(restored.status, 200, JSON.stringify(restored.body));

    const detail = await authed(
      request(app).get(`/api/lots/${lotId}`),
      userToken
    );
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.lot.measuredWeightKg, 10);
    assert.equal(detail.body.lot.valuation.status, 'ready');
    assert.equal(detail.body.lot.valuation.totalValue, 3000);
    assert.equal(detail.body.lot.valuation.totalWeightKg, 10);
    assert.equal(detail.body.lot.valuation.perGrade.A.weightKg, 5);
    assert.equal(detail.body.lot.valuation.perGrade.A.value, 500);
    assert.equal(detail.body.lot.valuation.perGrade.B.value, 2500);
    assert.equal(detail.body.lot.valuation.estimatedWeightKg, 0.2);
    assert.equal(detail.body.lot.totals.totalNuts, 100);

    const list = await authed(request(app).get('/api/lots'), userToken);
    assert.equal(list.status, 200);
    assert.equal(list.body.items[0].measuredWeightKg, 10);
    assert.equal(list.body.items[0].valuation.totalValue, 3000);

    const lotCsv = await authed(
      request(app).get(`/api/lots/${lotId}/export.csv`),
      userToken
    );
    assert.equal(lotCsv.status, 200);
    assert.match(lotCsv.text, /Measured lot weight \(kg\),10/);
    assert.match(lotCsv.text, /Measured-weight total value,3000/);
    assert.match(lotCsv.text, /Grade A,50/);

    const annotated = await authed(
      request(app).get(`/api/scans/${scanA._id}/image/annotated`),
      userToken
    );
    assert.equal(annotated.status, 200);
  });

  await t.test('defect switches filter detail, history, stats, CSV, and PDF output', async () => {
    const update = await authed(
      request(app).put('/api/admin/settings/defects'),
      adminToken
    ).send({
      masterEnabled: true,
      categories: {
        blackSpots: true,
        cracks: false,
        mold: true,
        discoloration: false,
      },
    });
    assert.equal(update.status, 200, JSON.stringify(update.body));
    assert.equal(update.body.policy.defectDetectionEnabled, true);
    assert.deepEqual(update.body.policy.enabledDefectCategories, ['blackSpots', 'mold']);

    await Scan.updateOne(
      { _id: scanA._id },
      {
        $set: {
          defects: {
            analysisStatus: 'success',
            analysisMethod: 'gemini_vision',
            model: 'gemini-test',
            analyzedAt: new Date('2026-10-30T10:00:00Z'),
            latencyMs: 120,
            imageLevelOnly: true,
            localizationAvailable: false,
            affectedNutCountsAvailable: false,
            note: 'Image-level findings only.',
            limitations: ['Cracks are hard to see in this lighting.', 'Counts require a detector.'],
            categories: {
              blackSpots: {
                key: 'blackSpots',
                name: 'Black Spots',
                status: 'detected',
                affectedNutCount: 9,
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
        },
      }
    );

    const detail = await authed(
      request(app).get(`/api/scans/${scanA._id}`),
      userToken
    );
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.scan.defectDetectionEnabled, true);
    assert.deepEqual(Object.keys(detail.body.scan.defects.categories), [
      'blackSpots',
      'mold',
    ]);
    assert.equal(
      detail.body.scan.defects.categories.blackSpots.affectedNutCount,
      null
    );
    assert.equal(JSON.stringify(detail.body.scan).includes('Micro-fractures'), false);
    assert.equal(JSON.stringify(detail.body.scan).includes('Colour variation'), false);

    const history = await authed(
      request(app).get('/api/scans/history?limit=10'),
      userToken
    );
    assert.equal(history.status, 200, JSON.stringify(history.body));
    assert.deepEqual(history.body.summary.defects.categories.blackSpots.detected, 1);
    assert.deepEqual(history.body.summary.defects.categories.mold.uncertain, 1);
    assert.equal(
      'cracks' in history.body.summary.defects.categories,
      false
    );

    const stats = await authed(request(app).get('/api/scans/stats'), userToken);
    assert.equal(stats.status, 200, JSON.stringify(stats.body));
    assert.equal(stats.body.defects.categories.blackSpots.detected, 1);
    assert.equal('cracks' in stats.body.defects.categories, false);

    const csv = await authed(
      request(app).get('/api/scans/export.csv'),
      userToken
    );
    assert.equal(csv.status, 200);
    assert.match(csv.text, /Defect analysis,Image-level review/);
    assert.match(csv.text, /Black Spots status/);
    assert.match(csv.text, /Suspected Mold status/);
    assert.doesNotMatch(csv.text, /Cracks status/);
    assert.doesNotMatch(csv.text, /Discoloration status/);
    assert.doesNotMatch(csv.text, /Micro-fractures/);

    const report = await authed(
      request(app)
        .get(`/api/scans/${scanA._id}/report.pdf`)
        .buffer(true)
        .parse(binaryParser),
      userToken
    );
    assert.equal(report.status, 200);
    const text = await pdfText(report.body);
    assert.match(text, /DEFECT ANALYSIS \(IMAGE-LEVEL REVIEW\)/);
    assert.match(text, /Black Spots/);
    assert.match(text, /Suspected Mold/);
    assert.doesNotMatch(text, /Micro-fractures/);
    assert.doesNotMatch(text, /Colour variation/);

    const disabled = await authed(
      request(app).put('/api/admin/settings/defects'),
      adminToken
    ).send({
      masterEnabled: false,
      categories: {
        blackSpots: true,
        cracks: true,
        mold: true,
        discoloration: true,
      },
    });
    assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
    assert.equal(disabled.body.policy.defectDetectionEnabled, false);

    const hiddenDetail = await authed(
      request(app).get(`/api/scans/${scanA._id}`),
      userToken
    );
    assert.equal(hiddenDetail.body.scan.defects, null);
    assert.equal(hiddenDetail.body.scan.defectDetectionEnabled, false);

    const hiddenHistory = await authed(
      request(app).get('/api/scans/history'),
      userToken
    );
    assert.equal(hiddenHistory.body.summary.defects, undefined);
    assert.ok(hiddenHistory.body.items.every((item) => item.defects === null));

    const hiddenStats = await authed(
      request(app).get('/api/scans/stats'),
      userToken
    );
    assert.equal(hiddenStats.body.defects, undefined);

    const hiddenCsv = await authed(
      request(app).get('/api/scans/export.csv'),
      userToken
    );
    assert.doesNotMatch(hiddenCsv.text, /Defect analysis/);
    assert.doesNotMatch(hiddenCsv.text, /Black Spots status/);
  });

  await t.test('master off suppresses grading, output images, pricing, CSV, lot valuation, and PDF content', async () => {
    const update = await authed(
      request(app).put('/api/admin/settings/predictions'),
      adminToken
    ).send({
      masterEnabled: false,
      grades: { A: true, B: true, C: false, D: false },
      geminiEnabled: false,
    });
    assert.equal(update.status, 200, JSON.stringify(update.body));
    assert.equal(update.body.policy.masterEnabled, false);
    assert.equal(update.body.policy.pricingMode, 'none');
    const lot = await authed(request(app).get('/api/lots'), userToken);
    const lotId = lot.body.items[0].id;

    const detail = await authed(
      request(app).get(`/api/scans/${scanA._id}`),
      userToken
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.body.scan.gradingEnabled, false);
    assert.equal(detail.body.scan.finalGrade, null);
    assert.equal(detail.body.scan.finalGradeSource, 'none');
    assert.equal(detail.body.scan.totalCount, null);
    assert.equal(detail.body.scan.confidence, null);
    assert.equal(detail.body.scan.gradeCounts, null);
    assert.equal(detail.body.scan.measurements, null);
    assert.equal(detail.body.scan.defects, null);
    assert.deepEqual(detail.body.scan.warnings, []);
    assert.deepEqual(detail.body.scan.detections, []);
    assert.equal(detail.body.scan.pricing.active, false);
    assert.equal(detail.body.scan.images.processed, null);
    assert.equal(detail.body.scan.images.annotated, null);
    assert.ok(detail.body.scan.images.original);

    for (const kind of ['processed', 'annotated']) {
      const response = await authed(
        request(app).get(`/api/scans/${scanA._id}/image/${kind}`),
        userToken
      );
      assert.equal(response.status, 403, `${kind} image should be blocked`);
    }
    const original = await authed(
      request(app).get(`/api/scans/${scanA._id}/image/original`),
      userToken
    );
    assert.equal(original.status, 200);

    const history = await authed(
      request(app).get('/api/scans/history'),
      userToken
    );
    assert.equal(history.status, 200);
    assert.equal(history.body.summary.gradingEnabled, false);
    assert.equal(history.body.summary.totalNuts, null);
    assert.equal(history.body.summary.gradeA, undefined);
    assert.deepEqual(history.body.summary.gradeAvailability, {});
    assert.ok(
      history.body.items.every(
        (item) =>
          item.finalGrade === null &&
          item.gradeCounts === null &&
          item.images.annotated === null
      )
    );

    const stats = await authed(request(app).get('/api/scans/stats'), userToken);
    assert.equal(stats.status, 200);
    assert.equal(stats.body.totals.detections, null);
    assert.equal(stats.body.totals.gradeA, undefined);
    assert.deepEqual(stats.body.gradeDistribution, []);
    assert.ok(
      stats.body.recent.every(
        (item) => item.finalGrade === null && item.confidence === null
      )
    );

    const csv = await authed(
      request(app).get('/api/scans/export.csv'),
      userToken
    );
    assert.equal(csv.status, 200);
    assert.match(csv.text, /Grade columns,hidden/);
    assert.doesNotMatch(csv.text, /Final grade/);
    assert.doesNotMatch(csv.text, /Confidence/);
    assert.doesNotMatch(csv.text, /Grade A/);

    const lotDetail = await authed(
      request(app).get(`/api/lots/${lotId}`),
      userToken
    );
    assert.equal(lotDetail.status, 200, JSON.stringify(lotDetail.body));
    assert.equal(lotDetail.body.lot.totals.totalNuts, null);
    assert.deepEqual(lotDetail.body.lot.totals.gradeCounts, {});
    assert.equal(lotDetail.body.lot.valuation.active, false);
    assert.equal(lotDetail.body.lot.valuation.totalValue, null);
    assert.equal(lotDetail.body.lot.valuation.totalWeightKg, 10);
    assert.equal(lotDetail.body.lot.measuredWeightKg, 10);
    assert.ok(
      lotDetail.body.scans.every(
        (item) => item.finalGrade === null && item.gradeCounts === null
      )
    );

    const lotCsv = await authed(
      request(app).get(`/api/lots/${lotId}/export.csv`),
      userToken
    );
    assert.equal(lotCsv.status, 200);
    assert.match(lotCsv.text, /Grade and price columns,hidden/);
    assert.doesNotMatch(lotCsv.text, /Final grade/);
    assert.doesNotMatch(lotCsv.text, /Measured-weight total value/);
    assert.doesNotMatch(lotCsv.text, /Grade A/);

    const compare = await authed(
      request(app).get(`/api/scans/compare?ids=${scanA._id},${scanB._id}`),
      userToken
    );
    assert.equal(compare.status, 200);
    assert.ok(
      compare.body.scans.every(
        (item) =>
          item.finalGrade === null &&
          item.images.annotated === null &&
          item.images.processed === null
      )
    );

    const predict = await authed(
      request(app).post('/api/scans/predict'),
      userToken
    )
      .attach('file', PNG, 'master-off.png');
    assert.equal(predict.status, 403);
    assert.match(predict.body.error, /Master prediction is switched off/);

    const report = await authed(
      request(app)
        .get(`/api/scans/${scanA._id}/report.pdf`)
        .buffer(true)
        .parse(binaryParser),
      userToken
    );
    assert.equal(report.status, 200);
    assert.equal(report.headers['content-type'], 'application/pdf');
    const text = await pdfText(report.body);
    assert.match(text, /GRADING STATUS/);
    assert.match(text, /Disabled by administrator/);
    assert.match(text, /Original image/);
    assert.doesNotMatch(text, /FINAL GRADE/);
    assert.doesNotMatch(text, /Detected nuts:/);
    assert.doesNotMatch(text, /Confidence:/);
    assert.doesNotMatch(text, /Processed image/);
    assert.doesNotMatch(text, /Annotated image/);
    assert.doesNotMatch(text, /Price estimate/);
  });

  await t.test('admin audit records changes without secrets', async () => {
    const response = await authed(
      request(app).get('/api/admin/audit?limit=20'),
      adminToken
    );
    assert.equal(response.status, 200);
    assert.ok(response.body.items.length >= 4);
    assert.ok(
      response.body.items.some((item) => item.action === 'predictions_updated')
    );
    assert.ok(
      response.body.items.some((item) => item.action === 'pricing_updated')
    );
    assert.equal(
      JSON.stringify(response.body).includes('unit-test-never-expose-this-gemini-key'),
      false
    );
  });
});
