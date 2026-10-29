'use strict';

const crypto = require('crypto');
const { config } = require('../config');
const { normalizeForGemini } = require('../utils/imageNormalizer');

const DEFAULT_COOLDOWN_MS = Math.max(Number(config.geminiCooldownMs) || 60000, 5000);
const KEY_ENV_NAMES = [
  'GEMINI_API_KEY',
  ...Array.from({ length: 10 }, (_value, index) => `GEMINI_API_KEY_${index + 1}`),
];

const keyState = new Map();
let testFetch = null;

class GeminiServiceError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'GeminiServiceError';
    this.statusCode = options.statusCode || 503;
    this.code = options.code || 'gemini_unavailable';
    this.attempts = options.attempts || 0;
    this.retryable = Boolean(options.retryable);
    this.expose = true;
  }
}

function keyFingerprint(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function configuredKeys() {
  const seen = new Set();
  const keys = [];
  KEY_ENV_NAMES.forEach((envName) => {
    const value = String(process.env[envName] || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    keys.push({
      envName,
      label: envName,
      value,
      fingerprint: keyFingerprint(value),
    });
  });
  return keys;
}

function stateFor(key) {
  if (!keyState.has(key.fingerprint)) {
    keyState.set(key.fingerprint, {
      coolingUntil: 0,
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
    });
  }
  return keyState.get(key.fingerprint);
}

function scrubSecrets(text) {
  let result = String(text || '');
  configuredKeys().forEach((key) => {
    if (key.value) result = result.split(key.value).join('[redacted-key]');
  });
  return result.slice(0, 500);
}

function classifyFailure(status, bodyText) {
  const body = String(bodyText || '');
  const lower = body.toLowerCase();
  if (
    status === 400 &&
    (lower.includes('api key') ||
      lower.includes('api_key') ||
      lower.includes('invalid_argument'))
  ) {
    return { kind: 'key', retryable: false, code: 'invalid_key' };
  }
  if (status === 401 || status === 403) {
    return { kind: 'key', retryable: false, code: 'permission_denied' };
  }
  if (status === 429) {
    return { kind: 'key', retryable: false, code: 'quota_or_rate_limit' };
  }
  if (status >= 500) {
    return { kind: 'transient', retryable: true, code: 'upstream_error' };
  }
  if (status === 400) {
    return { kind: 'request', retryable: false, code: 'invalid_request' };
  }
  return { kind: 'transient', retryable: true, code: 'upstream_error' };
}

function markSuccess(key) {
  const state = stateFor(key);
  state.coolingUntil = 0;
  state.consecutiveFailures = 0;
  state.lastSuccessAt = new Date().toISOString();
  state.lastError = null;
}

function markFailure(key, failure, cooldownMs = DEFAULT_COOLDOWN_MS) {
  const state = stateFor(key);
  state.consecutiveFailures += 1;
  state.lastFailureAt = new Date().toISOString();
  state.lastError = failure.code;
  if (failure.kind === 'key' || state.consecutiveFailures >= 2) {
    state.coolingUntil = Math.max(state.coolingUntil, Date.now() + cooldownMs);
  }
}

function configuredKeyCount() {
  return configuredKeys().length;
}

function getKeyStatuses() {
  return configuredKeys().map((key) => {
    const state = stateFor(key);
    const cooling = state.coolingUntil > Date.now();
    return {
      label: key.label,
      configured: true,
      state: cooling ? 'cooling_down' : state.lastError ? 'degraded' : 'available',
      coolingUntil: cooling ? new Date(state.coolingUntil).toISOString() : null,
      consecutiveFailures: state.consecutiveFailures,
      lastSuccessAt: state.lastSuccessAt,
      lastFailureAt: state.lastFailureAt,
      lastError: state.lastError,
    };
  });
}

function geminiStatus(settings) {
  const statuses = getKeyStatuses();
  return {
    enabledInSettings: Boolean(
      settings && settings.predictions && settings.predictions.geminiEnabled
    ),
    configuredKeys: statuses.length,
    availableKeys: statuses.filter((item) => item.state !== 'cooling_down').length,
    coolingDownKeys: statuses.filter((item) => item.state === 'cooling_down').length,
    model:
      (settings && settings.gemini && settings.gemini.model) || config.geminiModel,
    timeoutMs:
      (settings && settings.gemini && settings.gemini.timeoutMs) ||
      config.geminiTimeoutMs,
    maxRetries:
      (settings && settings.gemini && settings.gemini.maxRetries) ??
      config.geminiMaxRetries,
    imageMaxDimension:
      (settings && settings.gemini && settings.gemini.imageMaxDimension) ||
      config.geminiImageMaxDimension,
    keys: statuses,
    advisoryOnly: true,
    note:
      'Gemini keys are read only from server environment variables. Key values are never returned by the API or written to audit logs.',
  };
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    imageUsable: { type: 'BOOLEAN' },
    gradeHint: {
      type: 'STRING',
      enum: ['Grade A', 'Grade B', 'Grade C', 'Grade D', 'unknown'],
    },
    evidence: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    limitations: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    containsMixedGrades: { type: 'BOOLEAN' },
  },
  required: ['imageUsable', 'gradeHint', 'evidence', 'limitations', 'containsMixedGrades'],
};

function buildPrompt(context = {}) {
  const supported = Array.isArray(context.supportedGrades)
    ? context.supportedGrades.join(', ')
    : 'A, B';
  const counts =
    context.counts && typeof context.counts === 'object'
      ? JSON.stringify(context.counts)
      : 'not supplied';
  return [
    'You are an independent visual reviewer for arecanut (betel nut) quality.',
    'This is an image-level advisory review only. You are not an object detector.',
    'Do NOT estimate or invent nut counts, bounding boxes, or numerical confidence.',
    'Do NOT claim calibration or a validated grading accuracy.',
    'The existing detector supports these grades: ' + supported + '.',
    'Existing detector counts: ' + counts + '.',
    '',
    'Grade definitions for the visual convention used by this app:',
    'Grade A = excellent appearance, uniform, clean, few visible defects.',
    'Grade B = good appearance, minor variation or minor surface defects.',
    'Grade C = fair appearance, noticeable defects, discolouration, or unevenness.',
    'Grade D = poor appearance, substantial defects, damage, or severe unevenness.',
    'Use "unknown" when the image is not usable or the evidence is insufficient.',
    '',
    'Rules:',
    '- Judge only what is visibly supported in the image.',
    '- Use short evidence items; do not guess hidden or off-frame nuts.',
    '- If the image contains mixed quality, set containsMixedGrades=true and still return one overall image-level hint.',
    '- If the image is not arecanut, is too blurry, or is too dark, set imageUsable=false and gradeHint="unknown".',
    '- Return only JSON matching the supplied schema.',
  ].join('\n');
}

function parseJsonResponse(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Gemini response was not a JSON object.');
  }
  if (typeof parsed.imageUsable !== 'boolean') {
    throw new Error('Gemini response is missing imageUsable.');
  }
  const allowed = ['Grade A', 'Grade B', 'Grade C', 'Grade D', 'unknown'];
  if (!allowed.includes(parsed.gradeHint)) {
    throw new Error('Gemini response has an invalid gradeHint.');
  }
  if (!Array.isArray(parsed.evidence) || !Array.isArray(parsed.limitations)) {
    throw new Error('Gemini response is missing evidence or limitations.');
  }
  if (typeof parsed.containsMixedGrades !== 'boolean') {
    throw new Error('Gemini response is missing containsMixedGrades.');
  }
  const evidence = parsed.evidence
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((item) => item.slice(0, 240));
  const limitations = parsed.limitations
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((item) => item.slice(0, 240));

  if (parsed.imageUsable && parsed.gradeHint !== 'unknown' && evidence.length === 0) {
    throw new Error('Gemini returned a grade hint without supporting visual evidence.');
  }

  return {
    imageUsable: parsed.imageUsable,
    gradeHint: parsed.gradeHint,
    evidence,
    limitations,
    containsMixedGrades: parsed.containsMixedGrades,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOnce({ key, model, timeoutMs, maxOutputTokens, image, prompt }) {
  const fetchImpl = testFetch || global.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new GeminiServiceError('No fetch implementation is available.', {
      code: 'runtime_error',
      statusCode: 500,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) +
      ':generateContent?key=' +
      encodeURIComponent(key.value);
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: image.mime,
                  data: image.base64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          topP: 0.8,
          maxOutputTokens,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      }),
    });

    const bodyText = await response.text();
    if (!response.ok) {
      const failure = classifyFailure(response.status, bodyText);
      const retryAfter = Number(response.headers.get('retry-after'));
      const cooldown = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.max(retryAfter * 1000, 5000)
        : DEFAULT_COOLDOWN_MS;
      throw Object.assign(
        new GeminiServiceError(
          `Gemini request failed (${response.status}): ${failure.code}.`,
          { code: failure.code, retryable: failure.retryable, statusCode: 503 }
        ),
        { failure, cooldown, bodyText: scrubSecrets(bodyText) }
      );
    }

    let envelope;
    try {
      envelope = JSON.parse(bodyText);
    } catch {
      throw new GeminiServiceError('Gemini returned a non-JSON envelope.', {
        code: 'invalid_response',
        retryable: true,
      });
    }

    if (envelope.promptFeedback && envelope.promptFeedback.blockReason) {
      throw new GeminiServiceError(
        `Gemini blocked the review (${envelope.promptFeedback.blockReason}).`,
        { code: 'blocked', retryable: false, statusCode: 422 }
      );
    }

    const candidates = Array.isArray(envelope.candidates) ? envelope.candidates : [];
    const parts = candidates[0] && candidates[0].content && candidates[0].content.parts;
    const text = Array.isArray(parts)
      ? parts.map((part) => part.text || '').join('')
      : '';
    if (!text.trim()) {
      throw new GeminiServiceError('Gemini returned an empty response.', {
        code: 'empty_response',
        retryable: true,
      });
    }

    let parsed;
    try {
      parsed = parseJsonResponse(text);
    } catch (error) {
      throw new GeminiServiceError(
        `Gemini response failed validation: ${scrubSecrets(error.message)}`,
        { code: 'invalid_response', retryable: false, statusCode: 502 }
      );
    }
    return parsed;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new GeminiServiceError(
        `Gemini request timed out after ${timeoutMs} ms.`,
        { code: 'timeout', retryable: true, statusCode: 504 }
      );
    }
    if (error instanceof GeminiServiceError) throw error;
    throw new GeminiServiceError(
      `Gemini request failed: ${scrubSecrets(error && error.message)}`,
      { code: 'network_error', retryable: true, statusCode: 503 }
    );
  } finally {
    clearTimeout(timer);
  }
}

async function analyzeImage(buffer, options = {}) {
  const settings = options.settings || {};
  const geminiSettings = {
    model: settings.gemini?.model || config.geminiModel,
    timeoutMs: settings.gemini?.timeoutMs || config.geminiTimeoutMs,
    maxRetries: settings.gemini?.maxRetries ?? config.geminiMaxRetries,
    imageMaxDimension:
      settings.gemini?.imageMaxDimension || config.geminiImageMaxDimension,
  };
  const keys = configuredKeys();
  if (!keys.length) {
    throw new GeminiServiceError(
      'Gemini-assisted review is enabled but no GEMINI_API_KEY or GEMINI_API_KEY_1..10 is configured on the server. Ask the administrator to add keys and restart.',
      { code: 'not_configured', statusCode: 503 }
    );
  }

  let image;
  try {
    image = await normalizeForGemini(buffer, {
      maxDimension: geminiSettings.imageMaxDimension,
    });
  } catch (error) {
    throw new GeminiServiceError(
      `The uploaded image could not be prepared for Gemini: ${scrubSecrets(error.message)}`,
      { code: 'invalid_image', statusCode: 400 }
    );
  }
  if (!image) {
    throw new GeminiServiceError('The uploaded image is empty.', {
      code: 'invalid_image',
      statusCode: 400,
    });
  }

  const prompt = buildPrompt(options.context);
  const startedAt = Date.now();
  const errors = [];
  const available = keys.filter((key) => stateFor(key).coolingUntil <= Date.now());
  const cooling = keys.length - available.length;

  let stopAllKeys = false;
  for (const key of available) {
    if (stopAllKeys) break;
    let lastError = null;
    for (let attempt = 0; attempt <= geminiSettings.maxRetries; attempt += 1) {
      try {
        const parsed = await callOnce({
          key,
          model: geminiSettings.model,
          timeoutMs: geminiSettings.timeoutMs,
          maxOutputTokens: config.geminiMaxOutputTokens,
          image,
          prompt,
        });
        markSuccess(key);
        return {
          status: 'ok',
          advisoryOnly: true,
          model: geminiSettings.model,
          latencyMs: Date.now() - startedAt,
          imageWidth: image.width,
          imageHeight: image.height,
          imageUsable: parsed.imageUsable,
          gradeHint: parsed.gradeHint,
          evidence: parsed.evidence,
          limitations: parsed.limitations,
          containsMixedGrades: parsed.containsMixedGrades,
          note:
            'Gemini visual review is an advisory image-level hint. It is not a validated detector and is never used to create Grade C/D nut counts.',
        };
      } catch (error) {
        lastError = error;
        errors.push({
          key: key.label,
          code: error.code || 'gemini_error',
          message: scrubSecrets(error.message),
        });
        const failure = error.failure || {
          kind: error.code === 'invalid_response' || error.code === 'blocked' ? 'request' : 'key',
          retryable: Boolean(error.retryable),
          code: error.code || 'gemini_error',
        };
        if (failure.kind === 'request' || !failure.retryable) {
          if (failure.kind === 'key') {
            markFailure(key, failure, error.cooldown || DEFAULT_COOLDOWN_MS);
          } else if (failure.kind === 'request') {
            stopAllKeys = true;
          }
          break;
        }
        if (attempt < geminiSettings.maxRetries) {
          await sleep(Math.min(750 * 2 ** attempt, 3000));
        } else {
          markFailure(key, failure, error.cooldown || DEFAULT_COOLDOWN_MS);
        }
      }
    }
    if (lastError && lastError.code === 'blocked') break;
  }

  const reason = errors.length
    ? errors[errors.length - 1].message
    : cooling
    ? `All ${cooling} configured Gemini key(s) are cooling down after failures.`
    : 'Gemini-assisted review could not be completed.';
  throw new GeminiServiceError(reason, {
    code: 'all_keys_failed',
    statusCode: 503,
    attempts: errors.length,
    retryable: true,
  });
}

function resetGeminiState() {
  keyState.clear();
}

function setFetchForTests(fetchImpl) {
  testFetch = fetchImpl || null;
}

module.exports = {
  GeminiServiceError,
  analyzeImage,
  geminiStatus,
  configuredKeyCount,
  getKeyStatuses,
  parseJsonResponse,
  resetGeminiState,
  setFetchForTests,
  scrubSecrets,
};
