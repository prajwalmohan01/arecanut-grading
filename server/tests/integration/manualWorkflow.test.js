'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arecanut-manual-test-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'manual-workflow-test-secret-32-characters';
process.env.UPLOAD_DIR = uploadDir;

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const createApp = require('../../app');

const pngA = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const pngB = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2mQAAAAASUVORK5CYII=',
  'base64'
);

let mongo;
let app;

function authed(req, token) {
  return req.set('Authorization', `Bearer ${token}`);
}

test('manual grading workflow', async (t) => {
  mongo = await MongoMemoryServer.create({ binary: { version: '8.2.6' } });
  await mongoose.connect(mongo.getUri());
  app = createApp();

  t.after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ username: 'manual_tester', password: 'StrongTest!234', displayName: 'Manual Tester' });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const token = signup.body.token;

  let batch;
  let first;
  let duplicate;
  let second;
  let assessmentPath;

  await t.test('manual routes require authentication', async () => {
    const response = await request(app).get('/api/manual/records');
    assert.equal(response.status, 401);
  });

  await t.test('a manual batch can be created', async () => {
    const response = await authed(request(app).post('/api/manual/batches'), token).send({
      name: 'Test collection',
      supplier: 'Test supplier',
      collectionDate: '2026-10-20',
      targetSamples: 5,
      targetWeightKg: 20,
      notes: 'Integration test batch',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    batch = response.body.batch;
    assert.match(batch.batchId, /^BATCH-\d{8}-[A-F0-9]{6}$/);
    assert.equal(batch.stats.totalRecords, 0);
  });

  await t.test('a completed record requires a manual grade', async () => {
    const response = await authed(request(app).post('/api/manual/records'), token)
      .field('sampleCode', 'NO-GRADE')
      .field('status', 'completed')
      .attach('image', pngB, 'no-grade.png');
    assert.equal(response.status, 400);
    assert.match(response.body.error, /Grade A or Grade B/i);
  });

  await t.test('record upload stores manual values', async () => {
    const response = await authed(request(app).post('/api/manual/records'), token)
      .field('batch', batch.id)
      .field('sampleCode', 'TEST-A-001')
      .field('grade', 'A')
      .field('status', 'completed')
      .field('quantity', '100')
      .field('weightKg', '12.5')
      .field('sizeMm', '28.5')
      .field('appearance', 'Uniform test sample')
      .field('reviewerName', 'Manual Tester')
      .field('notes', 'Temporary integration note')
      .field(
        'imageQuality',
        JSON.stringify({
          checked: true,
          width: 1,
          height: 1,
          brightness: 120,
          blurScore: 300,
          warnings: ['Tiny test image'],
        })
      )
      .attach('image', pngA, 'sample-a.png');

    assert.equal(response.status, 201, JSON.stringify(response.body));
    first = response.body.record;
    assert.equal(first.grade, 'A');
    assert.equal(first.quantity, 100);
    assert.equal(first.batch.id, batch.id);
    assert.equal(first.imageQuality.checked, true);
    assert.equal(first.assessment, null);
  });

  await t.test('an exact duplicate image is rejected', async () => {
    const response = await authed(request(app).post('/api/manual/records'), token)
      .field('sampleCode', 'TEST-DUPLICATE')
      .field('grade', 'A')
      .field('status', 'completed')
      .attach('image', pngA, 'duplicate.png');
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.duplicate.id, first.id);
  });

  await t.test('an intentional duplicate override is accepted', async () => {
    const response = await authed(request(app).post('/api/manual/records'), token)
      .field('batch', batch.id)
      .field('sampleCode', 'TEST-DUPLICATE-OVERRIDE')
      .field('grade', 'A')
      .field('status', 'completed')
      .field('allowDuplicate', 'true')
      .attach('image', pngA, 'duplicate-override.png');
    assert.equal(response.status, 201, JSON.stringify(response.body));
    duplicate = response.body.record;
  });

  await t.test('a second unique record is stored without a batch', async () => {
    const response = await authed(request(app).post('/api/manual/records'), token)
      .field('sampleCode', 'TEST-B-001')
      .field('grade', 'B')
      .field('status', 'completed')
      .field('quantity', '50')
      .field('weightKg', '5')
      .attach('image', pngB, 'sample-b.png');
    assert.equal(response.status, 201, JSON.stringify(response.body));
    second = response.body.record;
    assert.equal(second.batch, null);
  });

  await t.test('list summary reflects only stored values', async () => {
    const response = await authed(request(app).get('/api/manual/records'), token);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.items.length, 3);
    assert.equal(response.body.summary.total, 3);
    assert.equal(response.body.summary.gradeA, 2);
    assert.equal(response.body.summary.gradeB, 1);
    assert.equal(response.body.summary.totalWeightKg, 17.5);
    assert.equal(response.body.summary.gradeC, undefined);
  });

  await t.test('search and batch filters work', async () => {
    const search = await authed(
      request(app).get('/api/manual/records').query({ q: 'TEST-B-001', grade: 'B' }),
      token
    );
    assert.equal(search.status, 200);
    assert.equal(search.body.items.length, 1);
    assert.equal(search.body.items[0].id, second.id);

    const byBatch = await authed(
      request(app).get('/api/manual/records').query({ batch: batch.id }),
      token
    );
    assert.equal(byBatch.status, 200);
    assert.equal(byBatch.body.items.length, 2);
  });

  await t.test('duplicate groups and record comparison work', async () => {
    const groups = await authed(request(app).get('/api/manual/records/duplicates'), token);
    assert.equal(groups.status, 200);
    assert.equal(groups.body.groups.length, 1);
    assert.equal(groups.body.groups[0].count, 2);

    const compare = await authed(
      request(app)
        .get('/api/manual/records/compare')
        .query({ ids: `${first.id},${second.id}` }),
      token
    );
    assert.equal(compare.status, 200, JSON.stringify(compare.body));
    assert.equal(compare.body.items.length, 2);
  });

  await t.test('review, correction history, and explicit unassignment work', async () => {
    const review = await authed(
      request(app).post(`/api/manual/records/${first.id}/review`),
      token
    ).send({ reviewed: true, notes: 'Reviewed once', imageFlagged: false });
    assert.equal(review.status, 200, JSON.stringify(review.body));
    assert.equal(review.body.record.review.reviewed, true);

    const correction = await authed(
      request(app).patch(`/api/manual/records/${first.id}`),
      token
    ).send({ grade: 'B', correctionReason: 'Corrected after re-check' });
    assert.equal(correction.status, 200, JSON.stringify(correction.body));
    assert.equal(correction.body.record.grade, 'B');
    assert.equal(correction.body.record.review.reviewed, false);
    assert.ok(
      correction.body.record.corrections.some((item) => item.action === 'grade-correction')
    );

    const unassign = await authed(
      request(app).patch(`/api/manual/records/${duplicate.id}`),
      token
    ).send({ batch: '' });
    assert.equal(unassign.status, 200, JSON.stringify(unassign.body));
    assert.equal(unassign.body.record.batch, null);

    const reassign = await authed(
      request(app).patch(`/api/manual/records/${duplicate.id}`),
      token
    ).send({ batch: batch.id });
    assert.equal(reassign.status, 200, JSON.stringify(reassign.body));
    assert.equal(reassign.body.record.batch.id, batch.id);
  });

  await t.test('record image is protected and returned to its owner', async () => {
    const anonymous = await request(app).get(`/api/manual/records/${first.id}/image`);
    assert.equal(anonymous.status, 401);

    const image = await authed(
      request(app).get(`/api/manual/records/${first.id}/image`),
      token
    ).buffer(true);
    assert.equal(image.status, 200);
    assert.match(image.headers['content-type'], /image\/png/);
    assert.ok(image.body.length > 0);
  });

  await t.test('assessment, public verification, and PDFs work', async () => {
    const created = await authed(
      request(app).post(`/api/manual/records/${first.id}/assessment`),
      token
    );
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assessmentPath = created.body.assessment.verifyPath;
    assert.match(assessmentPath, /^\/verify\/[a-f0-9]{64}$/);

    const publicVerify = await request(app).get(`/api${assessmentPath}`);
    assert.equal(publicVerify.status, 200, JSON.stringify(publicVerify.body));
    assert.equal(publicVerify.body.valid, true);
    assert.equal(publicVerify.body.assessment.grade, 'Grade B');
    assert.equal(publicVerify.body.assessment.image, undefined);
    const serialized = JSON.stringify(publicVerify.body);
    assert.ok(!serialized.includes('Temporary integration note'));
    assert.ok(!serialized.includes('Test supplier'));

    const recordPdf = await authed(
      request(app).get(`/api/manual/records/${first.id}/report.pdf`),
      token
    ).buffer(true);
    assert.equal(recordPdf.status, 200);
    assert.match(recordPdf.headers['content-type'], /application\/pdf/);
    assert.equal(recordPdf.body.subarray(0, 5).toString(), '%PDF-');

    const assessmentPdf = await authed(
      request(app).get(`/api/manual/records/${first.id}/assessment.pdf`),
      token
    ).buffer(true);
    assert.equal(assessmentPdf.status, 200);
    assert.match(assessmentPdf.headers['content-type'], /application\/pdf/);
    assert.ok(assessmentPdf.body.length > 1000);
  });

  await t.test('CSV and batch report exports work', async () => {
    const recordsCsv = await authed(request(app).get('/api/manual/records/export.csv'), token);
    assert.equal(recordsCsv.status, 200);
    assert.match(recordsCsv.headers['content-type'], /text\/csv/);
    assert.ok(recordsCsv.text.includes('Manual arecanut grading export'));

    const batchDetail = await authed(
      request(app).get(`/api/manual/batches/${batch.id}`),
      token
    );
    assert.equal(batchDetail.status, 200);
    assert.equal(batchDetail.body.pagination.total, 2);
    assert.equal(batchDetail.body.batch.stats.gradeA, 1);
    assert.equal(batchDetail.body.batch.stats.gradeB, 1);

    const batchPdf = await authed(
      request(app).get(`/api/manual/batches/${batch.id}/report.pdf`),
      token
    ).buffer(true);
    assert.equal(batchPdf.status, 200);
    assert.equal(batchPdf.body.subarray(0, 5).toString(), '%PDF-');

    const batchCsv = await authed(
      request(app).get(`/api/manual/batches/${batch.id}/export.csv`),
      token
    );
    assert.equal(batchCsv.status, 200);
    assert.ok(batchCsv.text.includes('Manual arecanut batch export'));
  });

  await t.test('price records use the entered values only', async () => {
    const created = await authed(request(app).post('/api/manual/prices'), token).send({
      marketName: 'Test market',
      grade: 'A',
      weightKg: 12.5,
      pricePerKg: 250,
      currency: 'INR',
      priceDate: '2026-10-20',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.price.value, 3125);
    assert.match(created.body.note, /No live market price/);

    const listed = await authed(request(app).get('/api/manual/prices'), token);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.summary.totalValue, 3125);
  });

  await t.test('batch deletion keeps and snapshots its records', async () => {
    const deleted = await authed(
      request(app).delete(`/api/manual/batches/${batch.id}`),
      token
    );
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

    const record = await authed(
      request(app).get(`/api/manual/records/${first.id}`),
      token
    );
    assert.equal(record.status, 200);
    assert.equal(record.body.record.batch.id, null);
    assert.equal(record.body.record.batch.batchId, batch.batchId);
    assert.equal(record.body.record.batch.name, batch.name);
  });

  await t.test('activity log contains the complete workflow', async () => {
    const activity = await authed(
      request(app).get('/api/manual/activity').query({ limit: 100 }),
      token
    );
    assert.equal(activity.status, 200);
    const types = new Set(activity.body.items.map((item) => item.type));
    [
      'record_created',
      'record_reviewed',
      'record_corrected',
      'assessment_generated',
      'batch_deleted',
      'price_created',
    ].forEach((type) => assert.ok(types.has(type), `missing activity type ${type}`));
  });
});
