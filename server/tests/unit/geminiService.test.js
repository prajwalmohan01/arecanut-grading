'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeImage,
  parseJsonResponse,
  getKeyStatuses,
  geminiStatus,
  resetGeminiState,
  setFetchForTests,
} = require('../../services/geminiService');
const { defaultSettings } = require('../../services/settingsService');

const KEY_NAMES = [
  'GEMINI_API_KEY',
  ...Array.from({ length: 10 }, (_value, index) => `GEMINI_API_KEY_${index + 1}`),
];

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function validAdvisory(overrides = {}) {
  return {
    imageUsable: true,
    gradeHint: 'Grade C',
    evidence: ['Darker, uneven surface colour is visible in the image.'],
    limitations: ['This is an advisory visual review, not a validated grade.'],
    containsMixedGrades: false,
    ...overrides,
  };
}

function envelope(payload) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(payload) }],
        },
      },
    ],
  };
}

function response(status, payload, headers = {}) {
  return new Response(
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    }
  );
}

function geminiSettings(overrides = {}) {
  const settings = defaultSettings();
  settings.gemini = {
    ...settings.gemini,
    timeoutMs: 3000,
    maxRetries: 0,
    imageMaxDimension: 256,
    ...overrides,
  };
  return settings;
}

function clearKeys() {
  KEY_NAMES.forEach((name) => {
    delete process.env[name];
  });
}

function snapshotEnv() {
  return Object.fromEntries(KEY_NAMES.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  KEY_NAMES.forEach((name) => {
    if (snapshot[name] === undefined) delete process.env[name];
    else process.env[name] = snapshot[name];
  });
}

test('Gemini JSON parser enforces the strict advisory schema', () => {
  const parsed = parseJsonResponse(
    '```json\n' + JSON.stringify(validAdvisory()) + '\n```'
  );
  assert.deepEqual(parsed, validAdvisory());

  assert.throws(
    () => parseJsonResponse(JSON.stringify(validAdvisory({ gradeHint: 'Grade Z' }))),
    /invalid gradeHint/
  );
  assert.throws(
    () => parseJsonResponse(JSON.stringify(validAdvisory({ imageUsable: 'yes' }))),
    /imageUsable/
  );
  assert.throws(
    () => parseJsonResponse(JSON.stringify(validAdvisory({ evidence: [] }))),
    /without supporting visual evidence/
  );
  assert.throws(
    () => parseJsonResponse(JSON.stringify(validAdvisory({ containsMixedGrades: undefined }))),
    /containsMixedGrades/
  );

  assert.deepEqual(
    parseJsonResponse(
      JSON.stringify(
        validAdvisory({
          imageUsable: false,
          gradeHint: 'unknown',
          evidence: [],
          containsMixedGrades: true,
        })
      )
    ),
    {
      imageUsable: false,
      gradeHint: 'unknown',
      evidence: [],
      limitations: validAdvisory().limitations,
      containsMixedGrades: true,
    }
  );
});

test('Gemini review fails clearly when no server key is configured', async (t) => {
  const env = snapshotEnv();
  const previousFetch = setFetchForTests(null);
  resetGeminiState();
  t.after(() => {
    restoreEnv(env);
    setFetchForTests(previousFetch);
    resetGeminiState();
  });
  clearKeys();

  await assert.rejects(
    analyzeImage(PNG, { settings: geminiSettings() }),
    (error) =>
      error.code === 'not_configured' &&
      /GEMINI_API_KEY_1\.\.10/.test(error.message)
  );
  assert.equal(getKeyStatuses().length, 0);
});

test('Gemini key failover moves past a rejected key without exposing key material', async (t) => {
  const env = snapshotEnv();
  const previousFetch = setFetchForTests(null);
  resetGeminiState();
  t.after(() => {
    restoreEnv(env);
    setFetchForTests(previousFetch);
    resetGeminiState();
  });

  clearKeys();
  const first = 'unit-test-first-key-not-real';
  const second = 'unit-test-second-key-not-real';
  process.env.GEMINI_API_KEY = first;
  process.env.GEMINI_API_KEY_1 = second;

  const calls = [];
  setFetchForTests(async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return response(401, { error: { message: 'invalid key' } });
    }
    return response(200, envelope(validAdvisory()));
  });

  const settings = geminiSettings();
  const result = await analyzeImage(PNG, {
    settings,
    context: { supportedGrades: ['A', 'B'], counts: { GradeA: 4, GradeB: 2 } },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.gradeHint, 'Grade C');
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes(encodeURIComponent(first)));
  assert.ok(calls[1].includes(encodeURIComponent(second)));
  assert.equal(JSON.stringify(result).includes(first), false);
  assert.equal(JSON.stringify(result).includes(second), false);

  const statuses = getKeyStatuses();
  assert.equal(statuses.length, 2);
  assert.equal(
    statuses.some((item) => item.state === 'cooling_down'),
    true
  );
  assert.equal(JSON.stringify(statuses).includes(first), false);
  assert.equal(JSON.stringify(statuses).includes(second), false);
  assert.equal(geminiStatus(settings).configuredKeys, 2);

  const next = await analyzeImage(PNG, { settings });
  assert.equal(next.status, 'ok');
  assert.equal(calls.length, 3);
  assert.ok(calls[2].includes(encodeURIComponent(second)));
  assert.equal(calls[2].includes(encodeURIComponent(first)), false);
});

test('Gemini failover is bounded and puts exhausted keys into cooldown', async (t) => {
  const env = snapshotEnv();
  const previousFetch = setFetchForTests(null);
  resetGeminiState();
  t.after(() => {
    restoreEnv(env);
    setFetchForTests(previousFetch);
    resetGeminiState();
  });

  clearKeys();
  process.env.GEMINI_API_KEY = 'unit-test-key-one';
  process.env.GEMINI_API_KEY_1 = 'unit-test-key-two';
  process.env.GEMINI_API_KEY_2 = 'unit-test-key-three';

  let calls = 0;
  setFetchForTests(async () => {
    calls += 1;
    return response(401, { error: { message: 'invalid key' } }, { 'retry-after': '5' });
  });

  await assert.rejects(
    analyzeImage(PNG, { settings: geminiSettings() }),
    (error) =>
      error.code === 'all_keys_failed' &&
      error.attempts === 3 &&
      /Gemini request failed/.test(error.message)
  );
  assert.equal(calls, 3);
  assert.equal(
    getKeyStatuses().filter((item) => item.state === 'cooling_down').length,
    3
  );

  await assert.rejects(
    analyzeImage(PNG, { settings: geminiSettings() }),
    (error) => error.code === 'all_keys_failed' && error.attempts === 0
  );
  assert.equal(calls, 3, 'cooling keys must not be retried immediately');
});

test('transient Gemini failures are retried within the configured bound', async (t) => {
  const env = snapshotEnv();
  const previousFetch = setFetchForTests(null);
  resetGeminiState();
  t.after(() => {
    restoreEnv(env);
    setFetchForTests(previousFetch);
    resetGeminiState();
  });

  clearKeys();
  process.env.GEMINI_API_KEY = 'unit-test-retry-key';
  let calls = 0;
  setFetchForTests(async () => {
    calls += 1;
    if (calls === 1) return response(503, { error: { message: 'upstream unavailable' } });
    return response(200, envelope(validAdvisory()));
  });

  const result = await analyzeImage(PNG, {
    settings: geminiSettings({ maxRetries: 2 }),
  });
  assert.equal(result.status, 'ok');
  assert.equal(calls, 2);
  assert.equal(
    getKeyStatuses().filter((item) => item.state === 'cooling_down').length,
    0
  );
});

test('a quota-limited Gemini key is cooled down and the next key is used', async (t) => {
  const env = snapshotEnv();
  const previousFetch = setFetchForTests(null);
  resetGeminiState();
  t.after(() => {
    restoreEnv(env);
    setFetchForTests(previousFetch);
    resetGeminiState();
  });

  clearKeys();
  const first = 'unit-test-quota-key-one';
  const second = 'unit-test-quota-key-two';
  process.env.GEMINI_API_KEY = first;
  process.env.GEMINI_API_KEY_1 = second;
  const calls = [];
  setFetchForTests(async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return response(429, { error: { message: 'quota exceeded for this key' } });
    }
    return response(200, envelope(validAdvisory()));
  });

  const result = await analyzeImage(PNG, {
    settings: geminiSettings({ maxRetries: 2 }),
  });
  assert.equal(result.status, 'ok');
  assert.equal(calls.length, 2, 'a 429 should fail over rather than retry the same key');
  assert.ok(calls[0].includes(encodeURIComponent(first)));
  assert.ok(calls[1].includes(encodeURIComponent(second)));
  const statuses = getKeyStatuses();
  assert.equal(
    statuses.filter((item) => item.state === 'cooling_down').length,
    1
  );
});
