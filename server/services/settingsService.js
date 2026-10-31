'use strict';

const SystemSettings = require('../models/SystemSettings');
const AdminAudit = require('../models/AdminAudit');
const { config } = require('../config');
const {
  DEFECT_KEYS,
  DEFECT_LABELS,
  filterDefectAnalysis,
} = require('./defectService');
const {
  normaliseGradePresence,
  visibleAdvisoryGrades,
} = require('./advisoryService');

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
    defects: {
      masterEnabled: false,
      categories: {
        blackSpots: true,
        cracks: true,
        mold: true,
        discoloration: true,
      },
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
    defects: {
      ...defaults.defects,
      ...(raw.defects || {}),
      categories: {
        ...defaults.defects.categories,
        ...((raw.defects && raw.defects.categories) || {}),
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
  // The original 1280 px default hid small defects in dense tray images. Move
  // only the untouched legacy default; administrators can set any value in the
  // 256-4096 px range and that value is preserved.
  if (
    Number(merged.gemini.imageMaxDimension) === 1280 &&
    Number(merged.gemini.timeoutMs) === 30000 &&
    Number(merged.gemini.maxRetries) === 2
  ) {
    merged.gemini.imageMaxDimension = defaults.gemini.imageMaxDimension;
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
    'Extended Grading Analysis',
    Boolean(base.geminiEnabled)
  );
  const masterEnabled = booleanValue(
    input.masterEnabled,
    'Master prediction',
    Boolean(base.masterEnabled)
  );

  if (masterEnabled && (grades.C || grades.D) && !geminiEnabled) {
    throw new SettingsValidationError(
      'Grade C/D review requires the Extended Grading Analysis switch. No validated C/D detector is installed.'
    );
  }
  if (masterEnabled && !GRADES.some((letter) => grades[letter])) {
    throw new SettingsValidationError(
      'Enable at least one grade when master prediction is on.'
    );
  }

  return { masterEnabled, grades, geminiEnabled };
}

function normalizeDefects(input, current) {
  if (!input || typeof input !== 'object') {
    throw new SettingsValidationError('Defect detection settings are required.');
  }
  const base = current.defects || defaultSettings().defects;
  const rawCategories =
    input.categories && typeof input.categories === 'object' ? input.categories : {};
  const categories = {};
  DEFECT_KEYS.forEach((key) => {
    categories[key] = booleanValue(
      rawCategories[key],
      DEFECT_LABELS[key],
      Boolean(base.categories && base.categories[key])
    );
  });
  const masterEnabled = booleanValue(
    input.masterEnabled,
    'Master defect detection',
    Boolean(base.masterEnabled)
  );
  return { masterEnabled, categories };
}

function normalizeGemini(input, current) {
  if (!input || typeof input !== 'object') {
    throw new SettingsValidationError('Extended Analysis settings are required.');
  }
  const base = current.gemini;
  const model = cleanString(input.model, 'Grading Service Model', 120, base.model);
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
    throw new SettingsValidationError(
      'Grading Service Model may contain only letters, numbers, dots, underscores, and hyphens.'
    );
  }
  return {
    model,
    timeoutMs: numberInRange(
      input.timeoutMs,
      'Service Timeout',
      3000,
      120000,
      base.timeoutMs,
      true
    ),
    maxRetries: numberInRange(
      input.maxRetries,
      'Service Retries',
      0,
      5,
      base.maxRetries,
      true
    ),
    imageMaxDimension: numberInRange(
      input.imageMaxDimension,
      'Service Image Size',
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
        defects: next.defects,
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

async function updateDefects(input, adminUser, meta = {}) {
  const current = await getSettings({ fresh: true });
  const defects = normalizeDefects(input, current);
  const next = { ...current, defects };
  const enabled = DEFECT_KEYS.filter((key) => defects.categories[key]).map(
    (key) => DEFECT_LABELS[key]
  );
  return persistSettings(
    next,
    adminUser,
    'defects_updated',
    `Defect detection switches updated: master=${defects.masterEnabled}, categories=${
      enabled.join(', ') || 'none'
    }`,
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
    `Extended Analysis settings updated: model=${gemini.model}, timeout=${gemini.timeoutMs}ms, retries=${gemini.maxRetries}`,
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
    defectDetectionEnabled: Boolean(
      settings.predictions.masterEnabled &&
        settings.defects &&
        settings.defects.masterEnabled
    ),
    defectCategories: clone(
      (settings.defects && settings.defects.categories) ||
        defaultSettings().defects.categories
    ),
    pricingMode: settings.pricing.mode,
    currency: settings.pricing.currency,
  };
}

function buildPolicy(settings) {
  const masterEnabled = Boolean(settings.predictions.masterEnabled);
  const enabledLetters = masterEnabled
    ? GRADES.filter((letter) => settings.predictions.grades[letter])
    : [];
  const defectSettings = settings.defects || defaultSettings().defects;
  const defectMasterEnabled = Boolean(
    masterEnabled && defectSettings.masterEnabled
  );
  const defectCategories = clone(defectSettings.categories || {});
  const enabledDefectCategories = defectMasterEnabled
    ? DEFECT_KEYS.filter((key) => defectCategories[key])
    : [];
  const defectDetectionEnabled = enabledDefectCategories.length > 0;
  const geminiEnabled = Boolean(
    masterEnabled && settings.predictions.geminiEnabled
  );
  return {
    version: settings.version || 1,
    masterEnabled,
    enabledLetters,
    grades: clone(settings.predictions.grades),
    geminiEnabled,
    defectDetectionEnabled,
    defectCategories,
    enabledDefectCategories,
    defectGeminiEnabled: Boolean(
      defectDetectionEnabled &&
        enabledDefectCategories.length > 0 &&
        geminiEnabled
    ),
    pricingMode: masterEnabled ? settings.pricing.mode : 'none',
  };
}

function gradeOfDetection(detection) {
  if (!detection || typeof detection !== 'object') return null;
  const raw = detection.grade || detection.label || '';
  const text = String(raw).trim();
  const quality = text.match(/\bq\s*([1-4])\b/i);
  if (quality) return ['A', 'B', 'C', 'D'][Number(quality[1]) - 1];
  const match = text.match(/([abcd])\s*$/i);
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
    result.defectDetectionEnabled = false;
    result.enabledDefectCategories = [];
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

  const enabledDefectKeys = policy.enabledDefectCategories || [];
  result.defectDetectionEnabled = enabledDefectKeys.length > 0;
  result.enabledDefectCategories = enabledDefectKeys;
  result.defects = enabledDefectKeys.length
    ? filterDefectAnalysis(result.defects, enabledDefectKeys, {
        model: settings.gemini && settings.gemini.model,
      })
    : null;

  /**
 * Calculate the majority grade from validated detection counts.
 * Only considers enabled grades with actual detection counts.
 * Returns an object with majorityGrade, count, percentage, and details.
 */
function calculateMajorityGrade(visibleCounts, policy) {
  const enabledLetters = policy.enabledLetters || [];
  // Build grade counts only for enabled letters that have valid counts
  const gradeCounts = {};
  let totalValidDetections = 0;
  
  enabledLetters.forEach((letter) => {
    const count = Number(visibleCounts[letter]) || 0;
    if (count > 0) {
      gradeCounts[`Grade ${letter}`] = count;
      totalValidDetections += count;
    }
  });
  
  // If no valid detections at all
  if (totalValidDetections === 0) {
    return {
      majorityGrade: 'Not Available',
      majorityGradeCount: 0,
      majorityGradePercentage: null,
      majorityGradeDetails: {
        gradeCounts: {},
        totalValidDetections: 0,
        enabledGrades: enabledLetters,
        message: 'No valid nuts detected in the image.'
      }
    };
  }
  
  // Find the maximum count
  const counts = Object.values(gradeCounts);
  const maxCount = Math.max(...counts);
  
  // Find all grades with the maximum count (handles ties)
  const majorityGrades = Object.entries(gradeCounts)
    .filter(([_, count]) => count === maxCount)
    .map(([grade]) => grade);
  
  // Calculate percentage
  const percentage = Math.round((maxCount / totalValidDetections) * 1000) / 10; // 1 decimal place
  
  let majorityGrade;
  if (majorityGrades.length === 1) {
    majorityGrade = majorityGrades[0];
  } else {
    majorityGrade = `Joint Majority: ${majorityGrades.join(' and ')}`;
  }
  
  // Determine if analysis is incomplete (some enabled grades have no counts due to unsupported models)
  const unsupportedEnabledGrades = enabledLetters.filter(
    (letter) => visibleCounts[letter] === null
  );
  
  return {
    majorityGrade,
    majorityGradeCount: maxCount,
    majorityGradePercentage: percentage,
    majorityGradeDetails: {
      gradeCounts,
      totalValidDetections,
      enabledGrades: enabledLetters,
      tied: majorityGrades.length > 1,
      tiedGrades: majorityGrades.length > 1 ? majorityGrades : null,
      incomplete: unsupportedEnabledGrades.length > 0,
      unsupportedGrades: unsupportedEnabledGrades.length > 0 ? unsupportedEnabledGrades : null,
      message: unsupportedEnabledGrades.length > 0
        ? `Analysis incomplete: Grades ${unsupportedEnabledGrades.join(', ')} are enabled but not supported by the active detector.`
        : null
    }
  };
}

const availability = {};
  const visibleCounts = {};
  policy.enabledLetters.forEach((letter) => {
    const supported = rawSupported.includes(letter);
    // Check if an alternative model was used for C/D detection
    const cDModelUsed = result.cDModelUsed || 'none';
    const alternativeModelUsed = ['huggingface', 'roboflow', 'custom'].includes(cDModelUsed);
    const geminiAdvisoryUsed = cDModelUsed === 'gemini_advisory';
    
    // For C/D: if alternative model was used, treat as supported with actual counts
    const isSupported = supported || (['C', 'D'].includes(letter) && alternativeModelUsed);
    // For C/D: if gemini advisory was used, we have presence info but not counts
    const hasCount = isSupported && (!['C', 'D'].includes(letter) || alternativeModelUsed);
    
    availability[letter] = {
      enabled: true,
      supported: isSupported,
      count: hasCount ? Number(rawCounts[letter]) || 0 : null,
      // Only add reason for truly unsupported grades (not assessed by any model)
      reason: isSupported
        ? null
        : (geminiAdvisoryUsed
            ? 'Grade C/D assessed via Gemini visual advisory (image-level presence only, no per-nut counts).'
            : 'No validated Grade C/D detector is installed. No count was invented.'),
    };
    visibleCounts[letter] = hasCount ? Number(rawCounts[letter]) || 0 : null;
  });

  // Calculate majority grade from validated detection counts
  const majorityGradeInfo = calculateMajorityGrade(visibleCounts, policy);
  result.majorityGrade = majorityGradeInfo.majorityGrade;
  result.majorityGradeCount = majorityGradeInfo.majorityGradeCount;
  result.majorityGradePercentage = majorityGradeInfo.majorityGradePercentage;
  result.majorityGradeDetails = majorityGradeInfo.majorityGradeDetails;

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

  // Fallback: compute confidence and qualityScore from detections if not provided by ML service
  // This ensures Quality/Confidence display even when ML service doesn't return them
  if ((result.confidence === null || result.confidence === undefined) && hadDetections && visibleDetections.length > 0) {
    const validConfidences = visibleDetections
      .map((d) => d.confidence_pct ?? (d.confidence !== undefined ? d.confidence * 100 : null))
      .filter((v) => v !== null && v !== undefined && !isNaN(v));
    if (validConfidences.length > 0) {
      result.confidence = Math.round(validConfidences.reduce((a, b) => a + b, 0) / validConfidences.length);
      result.confidenceMethod = result.confidenceMethod || 'computed_from_detections';
    }
  }
  if ((result.qualityScore === null || result.qualityScore === undefined) && hadDetections && visibleDetections.length > 0) {
    // Simple heuristic: quality score based on average detection confidence and count consistency
    const confidences = visibleDetections
      .map((d) => d.confidence_pct ?? (d.confidence !== undefined ? d.confidence * 100 : null))
      .filter((v) => v !== null && v !== undefined && !isNaN(v));
    if (confidences.length > 0) {
      const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
      // Quality score considers confidence and detection count (more nuts = more reliable)
      const countFactor = Math.min(1, visibleDetections.length / 50); // Saturates at 50 nuts
      result.qualityScore = Math.round(avgConfidence * 0.7 + countFactor * 30);
      result.qualityMethod = result.qualityMethod || 'computed_from_detections';
    }
  }

  // Use the calculated majority grade as the final grade (single source of truth)
  // Both Final Grade and Majority Grade are determined by highest valid detection count
  const calculatedGrade = majorityGradeInfo.majorityGrade;
  const isJointMajority = majorityGradeInfo.majorityGradeDetails?.tied === true;
  
  if (calculatedGrade && calculatedGrade !== 'Not Available') {
    // For joint majority, we use the joint format for both fields
    // For single majority, use the single grade
    result.finalGrade = calculatedGrade;
    result.grade = calculatedGrade;
    
    // Determine the source of the grade calculation
    if (isJointMajority) {
      result.finalGradeSource = 'count_based_joint';
      result.finalGradeLabel = 'Calculated from detection counts (joint majority)';
    } else {
      result.finalGradeSource = 'count_based';
      result.finalGradeLabel = 'Calculated from highest detection count';
    }
    // Preserve model's confidence and quality score (they reflect detection quality)
    // even though the grade is now calculated from counts
  } else {
    // No valid detections - both grades are Not Available
    result.finalGrade = 'Not Available';
    result.grade = 'Not Available';
    result.finalGradeSource = 'no_detections';
    result.finalGradeLabel = 'No valid nuts detected in the image';
    result.confidence = null;
    result.qualityScore = null;
    result.qualityMethod = null;
    result.confidenceMethod = null;
  }

  if (Array.isArray(result.warnings)) {
    const disabledDefectPatterns = DEFECT_KEYS.filter(
      (key) => !enabledDefectKeys.includes(key)
    ).map(
      (key) =>
        new RegExp(
          DEFECT_LABELS[key].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          'i'
        )
    );
    result.warnings = result.warnings.filter((warning) => {
      const text = String(warning);
      if (!policy.enabledLetters.includes('C') && /grade\s*c/i.test(text)) return false;
      if (!policy.enabledLetters.includes('D') && /grade\s*d/i.test(text)) return false;
      if (disabledDefectPatterns.some((pattern) => pattern.test(text))) return false;
      return true;
    });
  }

  if (!policy.enabledLetters.some((letter) => ['C', 'D'].includes(letter))) {
    result.geminiAdvisory = null;
  } else if (result.geminiAdvisory && typeof result.geminiAdvisory === 'object') {
    const advisory = result.geminiAdvisory;
    const hint = advisory.gradeHint;
    const hintLetterMatch = String(hint || '').match(/([abcd])$/i);
    const hintLetter = hintLetterMatch ? hintLetterMatch[1].toUpperCase() : null;
    const hintHidden = Boolean(
      hintLetter && !policy.enabledLetters.includes(hintLetter)
    );
    const presence = normaliseGradePresence(advisory.gradePresence);
    const visible = presence
      ? visibleAdvisoryGrades(
          { gradePresence: presence },
          policy.enabledLetters
        )
      : [];

    if (hintHidden && !visible.length) {
      result.geminiAdvisory = {
        status: advisory.status || 'hidden_by_policy',
        advisoryOnly: true,
        analysisMethod: advisory.analysisMethod || 'gemini_vision',
        imageUsable: advisory.imageUsable,
        gradeHint: null,
        gradePresence: null,
        visibleGrades: [],
        reviewRecommendation: null,
        evidence: [],
        limitations: [
          'The Gemini advisory mentioned a grade hidden by the active display policy, so its text was suppressed.',
        ],
        hiddenReason: 'The advisory mentioned a grade hidden by the display policy.',
        note:
          'This analysis is never used as an object detector or to create Grade C/D nut counts.',
      };
    } else {
      const hiddenGradePatterns = ['A', 'B', 'C', 'D']
        .filter((letter) => !policy.enabledLetters.includes(letter))
        .map((letter) => new RegExp(`grade\\s*${letter}\\b`, 'i'));
      const withoutHiddenMentions = (values) =>
        (Array.isArray(values) ? values : []).filter(
          (item) => !hiddenGradePatterns.some((pattern) => pattern.test(String(item)))
        );
      const filteredPresence = {};
      policy.enabledLetters.forEach((letter) => {
        if (presence && presence[letter]) filteredPresence[letter] = presence[letter];
      });
      result.geminiAdvisory = {
        ...advisory,
        gradeHint: hintHidden ? null : advisory.gradeHint,
        gradePresence: presence ? filteredPresence : null,
        visibleGrades: presence ? visible : [],
        reviewRecommendation: hiddenGradePatterns.some((pattern) =>
          pattern.test(String(advisory.reviewRecommendation || ''))
        )
          ? null
          : advisory.reviewRecommendation || null,
        evidence: withoutHiddenMentions(advisory.evidence),
        limitations: withoutHiddenMentions(advisory.limitations),
      };
      if (hintHidden) {
        result.geminiAdvisory.hiddenReason =
          'The overall grade hint named a grade hidden by the display policy. Per-grade evidence for enabled grades is retained.';
      }
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
  updateDefects,
  updateGemini,
  updatePricing,
  DEFECT_KEYS,
  settingsSnapshot,
  buildPolicy,
  applyScanPolicy,
  isAnnotatedImageAllowed,
  listAudit,
  invalidateSettingsCache,
  resetSettingsCache,
};
