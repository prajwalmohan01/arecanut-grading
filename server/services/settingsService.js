'use strict';

const SystemSettings = require('../models/SystemSettings');
const AdminAudit = require('../models/AdminAudit');
const { config } = require('../config');

const GRADES = ['A', 'B', 'C', 'D'];
const PRICE_UNITS = ['per_nut', 'per_kg', 'per_quintal'];
const PRICING_MODES = ['none', 'live', 'manual'];

let cache = null;
let cacheAt = 0;
const CACHE_MS = 1500;

class SettingsValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SettingsValidationError';
    this.statusCode = 400;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultSettings() {
  return {
    predictions: {
      masterEnabled: true,
      grades: { A: true, B: true, C: false, D: false },
      geminiEnabled: false,
    },
    gemini: {
      model: config.geminiModel,
      timeoutMs: config.geminiTimeoutMs,
      maxRetries: config.geminiMaxRetries,
      imageMaxDimension: config.geminiImageMaxDimension,
    },
    pricing: {
      mode: 'none',
      currency: 'INR',
      manual: {
        A: { price: 0, unit: 'per_kg' },
        B: { price: 0, unit: 'per_kg' },
        C: { price: 0, unit: 'per_kg' },
        D: { price: 0, unit: 'per_kg' },
      },
      live: {
        source: 'agmarknet',
        state: '',
        district: '',
        market: '',
        commodity: 'Arecanut(Betelnut/Supari)',
        variety: '',
        marketGrade: '',
        priceField: 'modal',
        refreshMinutes: config.marketCacheMinutes,
      },
    },
  };
}

function mergeDefaults(raw) {
  const defaults = defaultSettings();
  if (!raw || typeof raw !== 'object') return defaults;
  const merged = {
    predictions: {
      ...defaults.predictions,
      ...(raw.predictions || {}),
      grades: {
        ...defaults.predictions.grades,
        ...((raw.predictions && raw.predictions.grades) || {}),
      },
    },
    gemini: { ...defaults.gemini, ...(raw.gemini || {}) },
    pricing: {
      ...defaults.pricing,
      ...(raw.pricing || {}),
      manual: {
        ...defaults.pricing.manual,
        ...((raw.pricing && raw.pricing.manual) || {}),
      },
      live: {
        ...defaults.pricing.live,
        ...((raw.pricing && raw.pricing.live) || {}),
      },
    },
  };
  // gemini-2.5-flash is no longer available to new API keys. Migrate an old
  // stored default without overriding any other administrator choice.
  if (merged.gemini.model === 'gemini-2.5-flash') {
    merged.gemini.model = defaults.gemini.model;
  }
  return merged;
}

function invalidateSettingsCache() {
  cache = null;
  cacheAt = 0;
}

async function getSettings(options = {}) {
  if (!options.fresh && cache && Date.now() - cacheAt < CACHE_MS) {
    return clone(cache);
  }

  let doc = await SystemSettings.findOne({ singleton: 'global' });
  if (!doc) {
    const defaults = defaultSettings();
    try {
      doc = await SystemSettings.create({ singleton: 'global', ...defaults });
    } catch (error) {
      // Another request may have created it between findOne and create.
      if (error && error.code === 11000) {
        doc = await SystemSettings.findOne({ singleton: 'global' });
      } else {
        throw error;
      }
    }
  }

  const raw = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const settings = mergeDefaults(raw);
  settings.version = raw && Number.isFinite(Number(raw.version)) ? Number(raw.version) : 1;
  settings.updatedAt = raw && raw.updatedAt ? raw.updatedAt : null;
  cache = settings;
  cacheAt = Date.now();
  return clone(settings);
}

function booleanValue(value, label, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw new SettingsValidationError(`${label} must be true or false.`);
}

function numberInRange(value, label, min, max, fallback, integer = false) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new SettingsValidationError(
      `${label} must be a number between ${min} and ${max}.`
    );
  }
  if (integer && !Number.isInteger(number)) {
    throw new SettingsValidationError(`${label} must be a whole number.`);
  }
  return number;
}

function cleanString(value, label, maxLength, fallback = '') {
  if (value === undefined) return fallback;
  if (value === null) return '';
  const text = String(value).trim();
  if (text.length > maxLength) {
    throw new SettingsValidationError(
      `${label} must be ${maxLength} characters or fewer.`
    );
  }
  return text;
}

function normalizePredictions(input, current) {
  if (!input || typeof input !== 'object') {
    throw new SettingsValidationError('Prediction settings are required.');
  }
  const base = current.predictions;
  const rawGrades = input.grades && typeof input.grades === 'object' ? input.grades : {};
  const grades = {};
  GRADES.forEach((letter) => {
    grades[letter] = booleanValue(
      rawGrades[letter],
      `Grade ${letter}`,
      Boolean(base.grades[letter])
    );
  });

  const geminiEnabled = booleanValue(
    input.geminiEnabled,
    'Gemini-assisted prediction',
    Boolean(base.geminiEnabled)
  );
  const masterEnabled = booleanValue(
    input.masterEnabled,
    'Master prediction',
    Boolean(base.masterEnabled)
  );

  if (masterEnabled && (grades.C || grades.D) && !geminiEnabled) {
    throw new SettingsValidationError(
      'Grade C/D review requires the Gemini-assisted prediction switch. No validated C/D detector is installed.'
    );
  }
  if (masterEnabled && !GRADES.some((letter) => grades[letter])) {
    throw new SettingsValidationError(
      'Enable at least one grade when master prediction is on.'
    );
  }

  return { masterEnabled, grades, geminiEnabled };
}

function normalizeGemini(input, current) {
  if (!input || typeof input !== 'object') {
    throw new SettingsValidationError('Gemini settings are required.');
  }
  const base = current.gemini;
  const model = cleanString(input.model, 'Gemini model', 120, base.model);
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
    throw new SettingsValidationError(
      'Gemini model may contain only letters, numbers, dots, underscores, and hyphens.'
    );
  }
  return {
    model,
    timeoutMs: numberInRange(
      input.timeoutMs,
      'Gemini timeout',
      3000,
      120000,
      base.timeoutMs,
      true
    ),
    maxRetries: numberInRange(
      input.maxRetries,
      'Gemini retries',
      0,
      5,
      base.maxRetries,
      true
    ),
    imageMaxDimension: numberInRange(
      input.imageMaxDimension,
      'Gemini image size',
      256,
      4096,
      base.imageMaxDimension,
      true
    ),
  };
}

function normalizeUnit(value, label, fallback) {
  if (value === undefined) return fallback;
  const unit = String(value || '').trim();
  if (!PRICE_UNITS.includes(unit)) {
    throw new SettingsValidationError(
      `${label} unit must be per_nut, per_kg, or per_quintal.`
    );
  }
  return unit;
}

function normalizePrice(value, label, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0 || price > 10000000) {
    throw new SettingsValidationError(
      `${label} price must be a number between 0 and 10,000,000.`
    );
  }
  return Math.round(price * 100) / 100;
}

function normalizePricing(input, current) {
  if (!input || typeof input !== 'object') {
    throw new SettingsValidationError('Pricing settings are required.');
  }
  if (input.liveEnabled === true && input.manualEnabled === true) {
    throw new SettingsValidationError(
      'Live market price and manual price mode cannot be enabled at the same time.'
    );
  }

  let mode = input.mode;
  if (mode === undefined) {
    if (input.liveEnabled === true) mode = 'live';
    else if (input.manualEnabled === true) mode = 'manual';
    else if (input.liveEnabled === false || input.manualEnabled === false) mode = 'none';
    else mode = current.pricing.mode;
  }
  mode = String(mode || '').trim();
  if (!PRICING_MODES.includes(mode)) {
    throw new SettingsValidationError(
      'Pricing mode must be none, live, or manual.'
    );
  }

  const base = current.pricing;
  const currency = cleanString(
    input.currency,
    'Currency',
    8,
    base.currency || 'INR'
  ).toUpperCase() || 'INR';
  if (!/^[A-Z]{2,8}$/.test(currency)) {
    throw new SettingsValidationError('Currency must be a 2-8 letter code such as INR.');
  }

  const manualInput = input.manual && typeof input.manual === 'object' ? input.manual : {};
  const manual = {};
  GRADES.forEach((letter) => {
    const item = manualInput[letter] && typeof manualInput[letter] === 'object'
      ? manualInput[letter]
      : {};
    const previous = base.manual[letter] || { price: 0, unit: 'per_kg' };
    manual[letter] = {
      price: normalizePrice(item.price, `Grade ${letter}`, previous.price),
      unit: normalizeUnit(item.unit, `Grade ${letter}`, previous.unit),
    };
  });

  const liveInput = input.live && typeof input.live === 'object' ? input.live : {};
  const liveBase = base.live || {};
  const priceField = cleanString(
    liveInput.priceField,
    'Live price field',
    10,
    liveBase.priceField || 'modal'
  ).toLowerCase();
  if (!['modal', 'min', 'max'].includes(priceField)) {
    throw new SettingsValidationError(
      'Live price field must be modal, min, or max.'
    );
  }
  const source = cleanString(
    liveInput.source,
    'Market source',
    20,
    liveBase.source || 'agmarknet'
  ).toLowerCase();
  if (source !== 'agmarknet') {
    throw new SettingsValidationError('Only the AGMARKNET live source is supported.');
  }

  const live = {
    source,
    state: cleanString(liveInput.state, 'State', 80, liveBase.state || ''),
    district: cleanString(liveInput.district, 'District', 80, liveBase.district || ''),
    market: cleanString(liveInput.market, 'Market', 120, liveBase.market || ''),
    commodity: cleanString(
      liveInput.commodity,
      'Commodity',
      120,
      liveBase.commodity || 'Arecanut(Betelnut/Supari)'
    ),
    variety: cleanString(liveInput.variety, 'Variety', 80, liveBase.variety || ''),
    marketGrade: cleanString(
      liveInput.marketGrade,
      'Market grade filter',
      40,
      liveBase.marketGrade || ''
    ),
    priceField,
    refreshMinutes: numberInRange(
      liveInput.refreshMinutes,
      'Market refresh interval',
      15,
      1440,
      liveBase.refreshMinutes || 360,
      true
    ),
  };
  if (!live.commodity) {
    throw new SettingsValidationError('A commodity is required for live market prices.');
  }

  return { mode, currency, manual, live };
}

async function writeAudit(adminUser, action, summary, before, after, meta = {}) {
  if (!adminUser || !adminUser._id) return;
  try {
    await AdminAudit.create({
      admin: adminUser._id,
      action,
      summary,
      before,
      after,
      ip: String(meta.ip || '').slice(0, 80),
    });
  } catch (error) {
    // Audit failure must not roll back a valid settings update, but it should
    // be visible in server logs.
    console.error('[settings] Failed to write admin audit entry:', error.message);
  }
}

async function persistSettings(settings, adminUser, action, summary, before, meta = {}) {
  const next = clone(settings);
  next.version = (Number(before.version) || 1) + 1;
  const doc = await SystemSettings.findOneAndUpdate(
    { singleton: 'global', version: Number(before.version) || 1 },
    {
      $set: {
        predictions: next.predictions,
        gemini: next.gemini,
        pricing: next.pricing,
        version: next.version,
        updatedBy: adminUser && adminUser._id ? adminUser._id : null,
      },
    },
    { new: true }
  );
  if (!doc) {
    throw Object.assign(
      new Error('Settings changed in another session. Reload and try again.'),
      { statusCode: 409 }
    );
  }
  await writeAudit(adminUser, action, summary, before, next, meta);
  invalidateSettingsCache();
  return getSettings({ fresh: true });
}

async function updatePredictions(input, adminUser, meta = {}) {
  const current = await getSettings({ fresh: true });
  const predictions = normalizePredictions(input, current);
  const next = { ...current, predictions };
  return persistSettings(
    next,
    adminUser,
    'predictions_updated',
    `Prediction switches updated: master=${predictions.masterEnabled}, grades=${GRADES.filter(
      (letter) => predictions.grades[letter]
    ).join('') || 'none'}, gemini=${predictions.geminiEnabled}`,
    current,
    meta
  );
}

async function updateGemini(input, adminUser, meta = {}) {
  const current = await getSettings({ fresh: true });
  const gemini = normalizeGemini(input, current);
  const next = { ...current, gemini };
  return persistSettings(
    next,
    adminUser,
    'gemini_updated',
    `Gemini settings updated: model=${gemini.model}, timeout=${gemini.timeoutMs}ms, retries=${gemini.maxRetries}`,
    current,
    meta
  );
}

async function updatePricing(input, adminUser, meta = {}) {
  const current = await getSettings({ fresh: true });
  const pricing = normalizePricing(input, current);
  const next = { ...current, pricing };
  return persistSettings(
    next,
    adminUser,
    'pricing_updated',
    `Pricing settings updated: mode=${pricing.mode}, currency=${pricing.currency}`,
    current,
    meta
  );
}

function settingsSnapshot(settings) {
  return {
    version: settings.version || 1,
    masterEnabled: Boolean(settings.predictions.masterEnabled),
    grades: clone(settings.predictions.grades),
    geminiEnabled: Boolean(settings.predictions.geminiEnabled),
    geminiModel: settings.gemini.model,
    pricingMode: settings.pricing.mode,
    currency: settings.pricing.currency,
  };
}

function buildPolicy(settings) {
  const masterEnabled = Boolean(settings.predictions.masterEnabled);
  const enabledLetters = masterEnabled
    ? GRADES.filter((letter) => settings.predictions.grades[letter])
    : [];
  return {
    version: settings.version || 1,
    masterEnabled,
    enabledLetters,
    grades: clone(settings.predictions.grades),
    geminiEnabled: Boolean(masterEnabled && settings.predictions.geminiEnabled),
    pricingMode: masterEnabled ? settings.pricing.mode : 'none',
  };
}

function gradeOfDetection(detection) {
  if (!detection || typeof detection !== 'object') return null;
  const raw = detection.grade || detection.label || '';
  const match = String(raw).match(/([abcd])$/i);
  return match ? match[1].toUpperCase() : null;
}

function rawSupportedGrades(scan) {
  return Array.isArray(scan && scan.supportedGrades) && scan.supportedGrades.length
    ? scan.supportedGrades.map((letter) => String(letter).toUpperCase())
    : ['A', 'B'];
}

/**
 * The annotated image contains every box produced by the checkpoint. It may
 * only be exposed when every model-supported grade is also enabled by policy;
 * otherwise it would visually reveal a disabled grade even though the JSON
 * counts and detections were filtered.
 */
function isAnnotatedImageAllowed(scan, settingsOrPolicy) {
  const policy =
    settingsOrPolicy && settingsOrPolicy.predictions
      ? buildPolicy(settingsOrPolicy)
      : settingsOrPolicy;
  if (!policy || !policy.masterEnabled) return false;
  return rawSupportedGrades(scan).every((letter) =>
    policy.enabledLetters.includes(letter)
  );
}

function applyScanPolicy(scan, settings) {
  const policy = buildPolicy(settings);
  const source = scan && typeof scan.toObject === 'function' ? scan.toObject() : scan;
  const result = clone(source || {});
  const hadDetections = Array.isArray(result.detections);
  const rawCounts = result.gradeCounts || {
    A: result.gradeA || 0,
    B: result.gradeB || 0,
    C: result.gradeC || 0,
    D: result.gradeD || 0,
  };
  const rawSupported = rawSupportedGrades(result);

  result.predictionPolicy = policy;
  result.gradingEnabled = policy.masterEnabled;
  result.gradingStatus = policy.masterEnabled ? 'enabled' : 'disabled_by_admin';

  if (!policy.masterEnabled) {
    result.finalGrade = null;
    result.grade = null;
    result.gradeA = null;
    result.gradeB = null;
    result.gradeC = null;
    result.gradeD = null;
    result.gradeCounts = null;
    result.supportedGrades = [];
    result.unavailableGrades = [];
    result.gradeAvailability = {};
    result.totalCount = null;
    result.confidence = null;
    result.qualityScore = null;
    result.qualityMethod = null;
    result.confidenceMethod = null;
    result.measurements = null;
    result.defects = null;
    result.warnings = [];
    result.finalGradeSource = 'none';
    if (hadDetections) result.detections = [];
    else delete result.detections;
    result.geminiAdvisory = null;
    result.annotatedImageAllowed = false;
    if (result.images && typeof result.images === 'object') {
      result.images = {
        original: result.images.original || null,
        processed: null,
        annotated: null,
      };
    }
    result.pricing = {
      active: false,
      mode: 'none',
      status: 'pricing_disabled',
      reason: 'Grading and pricing are disabled by the administrator.',
      currency: settings.pricing.currency || 'INR',
      lineItems: [],
      totalValue: null,
      totalWeightKg: null,
      weightedPricePerKg: null,
      requiresWeight: false,
    };
    return result;
  }

  const availability = {};
  const visibleCounts = {};
  policy.enabledLetters.forEach((letter) => {
    const supported = rawSupported.includes(letter);
    availability[letter] = {
      enabled: true,
      supported,
      count: supported ? Number(rawCounts[letter]) || 0 : null,
      reason: supported
        ? null
        : 'No validated Grade C/D detector is installed. Gemini can provide a non-counting visual advisory only.',
    };
    visibleCounts[letter] = supported ? Number(rawCounts[letter]) || 0 : null;
  });

  const visibleDetections = hadDetections
    ? result.detections.filter((detection) => {
        const letter = gradeOfDetection(detection);
        return letter && policy.enabledLetters.includes(letter);
      })
    : undefined;

  result.gradeCounts = visibleCounts;
  result.gradeA = policy.enabledLetters.includes('A') ? Number(rawCounts.A) || 0 : undefined;
  result.gradeB = policy.enabledLetters.includes('B') ? Number(rawCounts.B) || 0 : undefined;
  result.gradeC = policy.enabledLetters.includes('C') ? visibleCounts.C : undefined;
  result.gradeD = policy.enabledLetters.includes('D') ? visibleCounts.D : undefined;
  if (result.gradeA === undefined) delete result.gradeA;
  if (result.gradeB === undefined) delete result.gradeB;
  if (result.gradeC === undefined) delete result.gradeC;
  if (result.gradeD === undefined) delete result.gradeD;

  result.supportedGrades = rawSupported.filter((letter) =>
    policy.enabledLetters.includes(letter)
  );
  result.annotatedImageAllowed = rawSupported.every((letter) =>
    policy.enabledLetters.includes(letter)
  );
  if (!result.annotatedImageAllowed && result.images && typeof result.images === 'object') {
    result.images.annotated = null;
  }
  result.unavailableGrades = policy.enabledLetters.filter(
    (letter) => !rawSupported.includes(letter)
  );
  result.gradeAvailability = availability;
  const hasSupportedOutput = rawSupported.some((letter) =>
    policy.enabledLetters.includes(letter)
  );
  result.totalCount = hasSupportedOutput
    ? Object.values(visibleCounts).reduce(
        (sum, value) => sum + (Number(value) || 0),
        0
      )
    : null;
  if (!hasSupportedOutput) {
    // Confidence and quality are derived from the A/B detections. When neither
    // is displayed they must not leak through as an unexplained number.
    result.confidence = null;
    result.qualityScore = null;
    result.qualityMethod = null;
    result.confidenceMethod = null;
  }
  if (hadDetections) result.detections = visibleDetections;
  else delete result.detections;

  const finalLetterMatch = String(result.finalGrade || '').match(/grade\s*([abcd])/i);
  const finalLetter = finalLetterMatch ? finalLetterMatch[1].toUpperCase() : null;
  const advisorySource = result.finalGradeSource === 'gemini_advisory';
  if (
    finalLetter &&
    policy.enabledLetters.includes(finalLetter) &&
    (rawSupported.includes(finalLetter) ||
      (advisorySource && ['C', 'D'].includes(finalLetter)))
  ) {
    result.grade = result.finalGrade;
    result.finalGradeSource = advisorySource ? 'gemini_advisory' : 'model';
    if (advisorySource) {
      result.finalGradeLabel = 'Gemini visual advisory (not a validated detector)';
    }
  } else if (finalLetter) {
    result.finalGrade = null;
    result.grade = null;
    result.finalGradeSource = 'hidden_by_policy';
    result.confidence = null;
    result.qualityScore = null;
    result.qualityMethod = null;
    result.confidenceMethod = null;
  } else {
    // "Invalid" means no boxes/decision. It is not a hidden grade.
    result.grade = result.finalGrade;
    result.finalGradeSource = 'model';
  }

  if (Array.isArray(result.warnings)) {
    result.warnings = result.warnings.filter((warning) => {
      const text = String(warning);
      if (!policy.enabledLetters.includes('C') && /grade\s*c/i.test(text)) return false;
      if (!policy.enabledLetters.includes('D') && /grade\s*d/i.test(text)) return false;
      return true;
    });
  }

  if (!policy.enabledLetters.some((letter) => ['C', 'D'].includes(letter))) {
    result.geminiAdvisory = null;
  } else if (result.geminiAdvisory && typeof result.geminiAdvisory === 'object') {
    const hint = result.geminiAdvisory.gradeHint;
    const hintLetterMatch = String(hint || '').match(/([abcd])$/i);
    const hintLetter = hintLetterMatch ? hintLetterMatch[1].toUpperCase() : null;
    if (hintLetter && !policy.enabledLetters.includes(hintLetter)) {
      result.geminiAdvisory = {
        status: result.geminiAdvisory.status || 'hidden_by_policy',
        advisoryOnly: true,
        gradeHint: null,
        evidence: [],
        limitations: [
          'The Gemini advisory mentioned a grade hidden by the active display policy, so its text was suppressed.',
        ],
        hiddenReason: 'The advisory mentioned a grade hidden by the display policy.',
        note:
          'Gemini is never used as an object detector or to create Grade C/D nut counts.',
      };
    }
  }

  return result;
}

async function listAudit(limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return AdminAudit.find({})
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .populate('admin', 'username displayName role')
    .lean();
}

function resetSettingsCache() {
  invalidateSettingsCache();
}

module.exports = {
  GRADES,
  PRICE_UNITS,
  PRICING_MODES,
  SettingsValidationError,
  defaultSettings,
  getSettings,
  updatePredictions,
  updateGemini,
  updatePricing,
  settingsSnapshot,
  buildPolicy,
  applyScanPolicy,
  isAnnotatedImageAllowed,
  listAudit,
  invalidateSettingsCache,
  resetSettingsCache,
};
