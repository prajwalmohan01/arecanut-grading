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

function validGradePresence(overrides = {}) {
  const base = {
    A: { visible: false, evidence: 'No uniform, clean examples of Grade A are visible.' },
    B: { visible: false, evidence: 'No clearly Grade B examples are visible.' },
    C: { visible: true, evidence: 'Darker, uneven surface colour is visible on some nuts.' },
    D: { visible: false, evidence: 'No severely damaged or substantially defective examples are visible.' },
  };
  return {
    ...base,
    ...overrides,
  };
}

function validAdvisory(overrides = {}) {
  return {
    imageUsable: true,
    gradeHint: 'Grade C',
    gradePresence: validGradePresence(),
    reviewRecommendation: 'Retake a closer, evenly lit photo to confirm the visible colour variation.',
    evidence: ['Darker, uneven surface colour is visible in the image.'],
    limitations: ['This is an advisory visual review, not a validated grade.'],
    containsMixedGrades: false,
    ...overrides,
  };
}

function validDefects(overrides = {}) {
  return {
    blackSpots: {
      status: 'detected',
      explanation: 'Several dark surface patches are visible on the nuts.',
      affectedNutCount: 4,
    },
    cracks: {
      status: 'not_detected',
      explanation: 'No visible splits or fissures are apparent.',
    },
    mold: {
      status: 'uncertain',
      explanation: 'A small pale patch is visible, but lighting makes it ambiguous.',
    },
    discoloration: {
      status: 'not_detected',
      explanation: 'Colour variation is consistent with natural nut appearance.',
    },
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
    '```json\n' + JSON.stringify(validAdvisory()) + '\n```',
    { requireDefects: false }
  );
  assert.deepEqual(parsed, { ...validAdvisory(), defects: null });

  const parsedWithDefects = parseJsonResponse(
    JSON.stringify({ ...validAdvisory(), defects: validDefects() })
  );
  assert.equal(parsedWithDefects.defects.mold.status, 'uncertain');
  assert.equal(parsedWithDefects.defects.blackSpots.affectedNutCount, null);
  assert.equal(parsedWithDefects.defects.cracks.affectedNutCount, null);

  assert.throws(
    () => parseJsonResponse(JSON.stringify(validAdvisory())),
    /missing defect findings/
  );
  assert.throws(
    () =>
      parseJsonResponse(
        JSON.stringify({
          ...validAdvisory(),
          defects: validDefects({ cracks: { status: 'maybe', explanation: 'Unclear.' } }),
        })
      ),
    /cracks.*invalid status/
  );
  assert.throws(
    () =>
      parseJsonResponse(
        JSON.stringify({
          ...validAdvisory(),
          defects: validDefects({ mold: { status: 'detected', explanation: '' } }),
        })
      ),
    /mold.*missing an explanation/
  );
  assert.throws(
    () =>
      parseJsonResponse(
        JSON.stringify({
          ...validAdvisory(),
          defects: validDefects({
            blackSpots: { status: 'detected', explanation: 'Dark spots.', affectedNutCount: 2.5 },
          }),
        })
      ),
    /blackSpots.*invalid affectedNutCount/
  );
  assert.throws(
    () => parseJsonResponse(JSON.stringify(validAdvisory({ gradeHint: 'Grade Z' }))),
    /invalid gradeHint/
  );
  assert.throws(
    () => parseJsonResponse(JSON.stringify(validAdvisory({ imageUsable: 'yes' }))),
    /imageUsable/
  );
  assert.throws(
    () =>
      parseJsonResponse(JSON.stringify(validAdvisory({ evidence: [] })), {
        requireDefects: false,
      }),
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
      ),
      { requireDefects: false }
    ),
    {
      imageUsable: false,
      gradeHint: 'unknown',
      gradePresence: validAdvisory().gradePresence,
      reviewRecommendation: validAdvisory().reviewRecommendation,
      evidence: [],
      limitations: validAdvisory().limitations,
      containsMixedGrades: true,
      defects: null,
    }
  );
});

test('Gemini rejects malformed, empty, and missing-grade-presence responses instead of inventing results', async (t) => {
  const env = snapshotEnv();
  const previousFetch = setFetchForTests(null);
  resetGeminiState();
  t.after(() => {
    restoreEnv(env);
    setFetchForTests(previousFetch);
    resetGeminiState();
  });

  clearKeys();
  process.env.GEMINI_API_KEY = 'unit-test-validation-key';

  const cases = [
    {
      label: 'empty response',
      reply: () => response(200, { candidates: [{ content: { parts: [] } }] }),
      expected: /empty response/i,
    },
    {
      label: 'truncated JSON',
      reply: () =>
        response(200, {
          candidates: [{ content: { parts: [{ text: '{"imageUsable": true' }] } }],
        }),
      expected: /failed validation/i,
    },
    {
      label: 'missing grade presence',
      reply: () => {
        const payload = validAdvisory();
        delete payload.gradePresence;
        return response(200, envelope(payload));
      },
      expected: /gradePresence/i,
    },
    {
      label: 'invalid defect status',
      reply: () =>
        response(
          200,
          envelope({
            ...validAdvisory(),
            defects: validDefects({
              cracks: { status: 'error', explanation: 'Could not assess.' },
            }),
          })
        ),
      expected: /cracks.*invalid status/i,
    },
  ];

  for (const item of cases) {
    resetGeminiState();
    setFetchForTests(async () => item.reply());
    await assert.rejects(
      analyzeImage(PNG, {
        settings: geminiSettings(),
        context: { includeDefects: item.label === 'invalid defect status', requireDefects: true },
      }),
      (error) =>
        error.code === 'all_keys_failed' &&
        item.expected.test(error.message) &&
        !/not_detected/.test(error.message),
      item.label
    );
  }
});

test('Gemini timeout is surfaced as unavailable, not as a clean negative finding', async (t) => {
  const env = snapshotEnv();
  const previousFetch = setFetchForTests(null);
  resetGeminiState();
  t.after(() => {
    restoreEnv(env);
    setFetchForTests(previousFetch);
    resetGeminiState();
  });

  clearKeys();
  process.env.GEMINI_API_KEY = 'unit-test-timeout-key';
  setFetchForTests(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
  );

  await assert.rejects(
    analyzeImage(PNG, {
      settings: geminiSettings({ timeoutMs: 10, maxRetries: 0 }),
      context: {
        includeDefects: true,
        requireDefects: true,
        enabledDefectCategories: ['blackSpots'],
      },
    }),
    (error) =>
      error.code === 'all_keys_failed' &&
      /timed out/i.test(error.message) &&
      !/not_detected/.test(error.message)
  );
});

test('Gemini defect analysis returns image-level statuses and discards unverified counts', async (t) => {
  const env = snapshotEnv();
  const previousFetch = setFetchForTests(null);
  resetGeminiState();
  t.after(() => {
    restoreEnv(env);
    setFetchForTests(previousFetch);
    resetGeminiState();
  });

  clearKeys();
  process.env.GEMINI_API_KEY = 'unit-test-defect-key-not-real';
  let requestBody = null;
  setFetchForTests(async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return response(
      200,
      envelope({
        ...validAdvisory({ evidence: ['Dark patches are visible on several nuts.'] }),
        defects: validDefects(),
      })
    );
  });

  const result = await analyzeImage(PNG, {
    settings: geminiSettings(),
    context: {
      supportedGrades: ['A', 'B'],
      includeDefects: true,
      requireDefects: true,
      enabledDefectCategories: ['blackSpots', 'mold'],
    },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.analysisMethod, 'gemini_vision');
  assert.equal(result.gradePresence.C.visible, true);
  assert.equal(result.visibleGrades.includes('C'), true);
  assert.match(result.reviewRecommendation, /closer|confirm/i);
  assert.equal(result.defects.analysisStatus, 'success');
  assert.equal(result.defects.analysisMethod, 'gemini_vision');
  assert.equal(result.defects.localizationAvailable, false);
  assert.equal(result.defects.affectedNutCountsAvailable, false);
  assert.equal(result.defects.categories.blackSpots.status, 'detected');
  assert.equal(result.defects.categories.blackSpots.affectedNutCount, null);
  assert.equal(result.defects.categories.mold.name, 'Suspected Mold');
  assert.equal(result.defects.categories.cracks, undefined);
  assert.equal(
    requestBody.generationConfig.responseSchema.properties.defects.required.includes('mold'),
    true
  );
  assert.equal(
    requestBody.generationConfig.responseSchema.properties.defects.properties.mold.properties.status.enum.includes('unavailable'),
    true
  );
  assert.equal(requestBody.generationConfig.responseSchema.properties.defects.properties.mold.properties.status.enum.includes('error'), false);
  const prompt = requestBody.contents[0].parts[0].text;
  assert.match(prompt, /Never claim a fungal infection/);
  assert.match(prompt, /affectedNutCount to null/);
  assert.match(prompt, /Never use not_detected as a default/);
  assert.match(prompt, /Grade C = fair appearance/);
  assert.match(prompt, /Grade D = poor appearance/);
  assert.match(prompt, /Review all four grade definitions/);
  const imagePart = requestBody.contents[0].parts[1];
  assert.equal(imagePart.inline_data.mime_type, 'image/jpeg');
  assert.ok(Buffer.from(imagePart.inline_data.data, 'base64').slice(0, 2).equals(Buffer.from([0xff, 0xd8])));
  assert.equal(JSON.stringify(result).includes('unit-test-defect-key-not-real'), false);
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
