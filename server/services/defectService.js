'use strict';

/**
 * Shared normalisation for Gemini image-level defect findings.
 *
 * Gemini is a vision-language model, not a defect detector. It can report
 * whether a defect appearance is visible in an image, but it cannot provide
 * verified per-nut counts or bounding boxes. This module deliberately removes
 * any self-reported count unless it explicitly came from a validated detector.
 */

const DEFECT_KEYS = ['blackSpots', 'cracks', 'mold', 'discoloration'];
const DEFECT_LABELS = {
  blackSpots: 'Black Spots',
  cracks: 'Cracks',
  mold: 'Suspected Mold',
  discoloration: 'Discoloration',
};
const DEFECT_STATUSES = ['detected', 'not_detected', 'uncertain', 'error'];
const DEFECT_ANALYSIS_STATUSES = ['success', 'partial', 'unavailable', 'error'];

const COUNT_NOTE =
  'Defect findings are image-level only. Affected-nut counts and defect locations require a validated detector or segmentation model and are not claimed here.';

function cleanText(value, maxLength = 600) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLength);
}

function cleanList(value, maxItems = 8, maxLength = 400) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function defectLabel(key) {
  return DEFECT_LABELS[key] || key;
}

function uniqueKeys(keys) {
  return Array.from(new Set(Array.isArray(keys) ? keys : [])).filter((key) =>
    DEFECT_KEYS.includes(key)
  );
}

function normaliseCategory(raw, key, options = {}) {
  const fallbackStatus = DEFECT_STATUSES.includes(options.fallbackStatus)
    ? options.fallbackStatus
    : 'error';
  const status = DEFECT_STATUSES.includes(raw && raw.status)
    ? raw.status
    : options.forceError
    ? 'error'
    : fallbackStatus;
  const fallbackExplanation =
    options.fallbackExplanation ||
    'No verified result is available for this defect category.';
  let explanation = cleanText(raw && raw.explanation);
  if (status === 'error' && options.forceExplanation) {
    explanation = options.forceExplanation;
  }
  if (!explanation) explanation = fallbackExplanation;

  const countBasis = raw && raw.countBasis === 'validated_detector'
    ? 'validated_detector'
    : 'not_established';
  let affectedNutCount = null;
  if (
    countBasis === 'validated_detector' &&
    raw &&
    Number.isInteger(raw.affectedNutCount) &&
    raw.affectedNutCount >= 0
  ) {
    affectedNutCount = raw.affectedNutCount;
  }

  return {
    key,
    name: defectLabel(key),
    status,
    affectedNutCount,
    countBasis,
    explanation,
  };
}

function overallStatus(categories) {
  const values = Object.values(categories || {});
  if (!values.length) return 'unavailable';
  if (values.every((item) => item.status === 'error')) return 'unavailable';
  if (values.some((item) => item.status === 'error')) return 'partial';
  return 'success';
}

function buildGeminiDefectAnalysis(options = {}) {
  const imageUsable = options.imageUsable !== false;
  const enabledKeys = uniqueKeys(options.categories);
  const keys = enabledKeys.length ? enabledKeys : DEFECT_KEYS;
  const categories = {};

  keys.forEach((key) => {
    categories[key] = normaliseCategory(
      options.rawCategories && options.rawCategories[key],
      key,
      imageUsable
        ? {
            fallbackStatus: 'error',
            fallbackExplanation:
              'Gemini did not return a usable result for this defect category.',
          }
        : {
            fallbackStatus: 'error',
            forceError: true,
            forceExplanation:
              'Analysis unavailable because the uploaded image was not usable for a visual defect review. This is not a "not detected" result.',
          }
    );
    if (!imageUsable) {
      categories[key].status = 'error';
      categories[key].explanation =
        'Analysis unavailable because the uploaded image was not usable for a visual defect review. This is not a "not detected" result.';
      
    }
  });

  const analysisStatus = imageUsable ? overallStatus(categories) : 'unavailable';
  return {
    analysisStatus,
    analysisMethod: 'gemini_vision',
    model: cleanText(options.model, 120) || null,
    analyzedAt: options.analyzedAt || new Date().toISOString(),
    latencyMs: Number.isFinite(options.latencyMs) ? options.latencyMs : null,
    imageLevelOnly: true,
    localizationAvailable: false,
    affectedNutCountsAvailable: false,
    note: COUNT_NOTE,
    limitations: cleanList(options.limitations),
    errorCode: analysisStatus === 'success' ? null : 'partial_or_unusable_result',
    error: null,
    categories,
  };
}

function buildUnavailableDefects(options = {}) {
  const keys = uniqueKeys(options.categories);
  const effectiveKeys = keys.length ? keys : DEFECT_KEYS;
  const message = cleanText(options.error, 500) || 'Gemini defect analysis is unavailable.';
  const categories = {};
  effectiveKeys.forEach((key) => {
    categories[key] = normaliseCategory(null, key, {
      fallbackStatus: 'error',
      forceError: true,
      forceExplanation: `Analysis unavailable: ${message} This is not a "not detected" result.`,
    });
  });

  return {
    analysisStatus: 'unavailable',
    analysisMethod: 'gemini_vision',
    model: cleanText(options.model, 120) || null,
    analyzedAt: options.analyzedAt || new Date().toISOString(),
    latencyMs: null,
    imageLevelOnly: true,
    localizationAvailable: false,
    affectedNutCountsAvailable: false,
    note: COUNT_NOTE,
    limitations: cleanList(options.limitations),
    errorCode: cleanText(options.errorCode, 80) || 'gemini_unavailable',
    error: message,
    categories,
  };
}

function buildNotAnalysedDefects(options = {}) {
  return buildUnavailableDefects({
    ...options,
    error:
      options.error ||
      'No Gemini defect analysis is stored for this prediction. Run the analysis again to obtain a current result.',
    errorCode: options.errorCode || 'not_analyzed',
  });
}

function disabledLabelPatterns(enabledKeys) {
  return DEFECT_KEYS.filter((key) => !enabledKeys.includes(key)).map((key) => ({
    key,
    pattern: new RegExp(defectLabel(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
  }));
}

/**
 * Filter a stored defect result to the categories enabled by the active
 * policy. Disabled categories are removed entirely, including their
 * explanations and limitations. If the stored record predates defect
 * analysis, an honest "analysis unavailable" result is returned for enabled
 * categories instead of a fabricated "not detected".
 */
function filterDefectAnalysis(raw, enabledKeys, options = {}) {
  const keys = uniqueKeys(enabledKeys);
  if (!keys.length) return null;

  if (
    !raw ||
    typeof raw !== 'object' ||
    !raw.categories ||
    typeof raw.categories !== 'object' ||
    Array.isArray(raw.categories)
  ) {
    return buildNotAnalysedDefects({
      ...options,
      categories: keys,
      model: options.model,
    });
  }

  const categories = {};
  keys.forEach((key) => {
    const stored = raw.categories[key];
    if (!stored || typeof stored !== 'object') {
      categories[key] = normaliseCategory(null, key, {
        fallbackStatus: 'error',
        forceExplanation:
          'No stored result exists for this enabled defect category. Run the analysis again.',
      });
      return;
    }
    categories[key] = normaliseCategory(stored, key, {
      fallbackStatus: 'error',
      fallbackExplanation:
        'No usable stored result exists for this enabled defect category.',
    });
  });

  const disabledPatterns = disabledLabelPatterns(keys);
  const limitations = cleanList(raw.limitations).filter(
    (item) => !disabledPatterns.some(({ pattern }) => pattern.test(item))
  );

  let analysisStatus = DEFECT_ANALYSIS_STATUSES.includes(raw.analysisStatus)
    ? raw.analysisStatus
    : overallStatus(categories);
  if (analysisStatus === 'success') analysisStatus = overallStatus(categories);

  return {
    analysisStatus,
    analysisMethod: cleanText(raw.analysisMethod, 80) || 'gemini_vision',
    model: cleanText(raw.model, 120) || options.model || null,
    analyzedAt: raw.analyzedAt || null,
    latencyMs: Number.isFinite(raw.latencyMs) ? raw.latencyMs : null,
    imageLevelOnly: true,
    localizationAvailable: false,
    affectedNutCountsAvailable: false,
    note: COUNT_NOTE,
    limitations,
    errorCode: cleanText(raw.errorCode, 80) || null,
    error: cleanText(raw.error, 500) || null,
    categories,
  };
}

module.exports = {
  DEFECT_KEYS,
  DEFECT_LABELS,
  DEFECT_STATUSES,
  DEFECT_ANALYSIS_STATUSES,
  COUNT_NOTE,
  defectLabel,
  buildGeminiDefectAnalysis,
  buildUnavailableDefects,
  buildNotAnalysedDefects,
  filterDefectAnalysis,
};
