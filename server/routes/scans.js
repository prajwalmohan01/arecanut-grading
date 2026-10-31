'use strict';

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const Scan = require('../models/Scan');
const Lot = require('../models/Lot');
const { protect } = require('../middleware/authMiddleware');
const { config } = require('../config');
const asyncHandler = require('../utils/asyncHandler');
const {
  ensureUploadDir,
  validateImageFile,
  storedImageName,
  saveBase64Image,
  removeTempFile,
} = require('../utils/files');
const { parseDate, parsePagination } = require('../utils/validation');
const { runInference } = require('../services/inferenceService');
const {
  getModelStatus,
  getEvaluationReport,
  getModelMetadata,
  getXrayDatasetReport,
} = require('../services/modelService');
const {
  serializeScan,
  loadScanImage,
  loadReportImages,
  deleteScanImages,
} = require('../services/scanService');
const { getLotMap } = require('../services/lotService');
const { buildPredictionReport, buildComparisonReport } = require('../utils/pdf');
const {
  getSettings,
  applyScanPolicy,
  settingsSnapshot,
  buildPolicy,
  isAnnotatedImageAllowed,
} = require('../services/settingsService');
const {
  presentScan,
  presentScans,
  resolveLivePrice,
} = require('../services/presentationService');
const { analyzeImage } = require('../services/geminiService');
const {
  unavailableAdvisory,
  selectAdvisoryFinalGrade,
} = require('../services/advisoryService');
const {
  DEFECT_KEYS,
  DEFECT_LABELS,
  buildUnavailableDefects,
} = require('../services/defectService');

const router = express.Router();

ensureUploadDir();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ensureUploadDir()),
  filename: (_req, file, cb) =>
    cb(null, storedImageName(file.mimetype, 'upload')),
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(String(file.mimetype).toLowerCase())) {
      const error = new Error('Only JPEG, PNG, or WebP images are allowed');
      error.statusCode = 400;
      return cb(error);
    }
    return cb(null, true);
  },
});

const GRADE_VALUES = ['Grade A', 'Grade B', 'Grade C', 'Grade D', 'Invalid'];

function normalizeGrade(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const letterMatch = raw.match(/^(?:grade\s*)?([abcd])$/i);
  if (letterMatch) return `Grade ${letterMatch[1].toUpperCase()}`;
  const qualityMatch = raw.match(/^q[\s_-]*([1-4])$/i);
  if (qualityMatch) {
    return `Grade ${['A', 'B', 'C', 'D'][Number(qualityMatch[1]) - 1]}`;
  }
  if (/^invalid$/i.test(raw)) return 'Invalid';
  return null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function gradeLetterFromValue(value) {
  const normalized = normalizeGrade(value);
  const match = String(normalized || '').match(/grade\s*([abcd])/i);
  return match ? match[1].toUpperCase() : normalized === 'Invalid' ? 'Invalid' : null;
}

function gradeFilterError(query, policy) {
  if (!query.grade) return null;
  const letter = gradeLetterFromValue(query.grade);
  if (!letter) return null;
  if (!policy.masterEnabled) {
    return 'Grade filtering is unavailable while master prediction is disabled.';
  }
  if (letter !== 'Invalid' && !policy.enabledLetters.includes(letter)) {
    return `Grade ${letter} is disabled by the active display policy.`;
  }
  return null;
}

function gradeLetterForFinalGrade(value) {
  return gradeLetterFromValue(value);
}

async function runGeminiAnalysis({
  uploadedPath,
  uploadedBuffer,
  settings,
  inference,
  policy,
}) {
  const needsAdvisory = policy.enabledLetters.some((letter) => ['C', 'D'].includes(letter));
  const enabledDefectCategories = Array.isArray(policy.enabledDefectCategories)
    ? policy.enabledDefectCategories
    : [];
  const needsDefects = Boolean(
    policy.defectDetectionEnabled && enabledDefectCategories.length > 0
  );

  if (!needsAdvisory && !needsDefects) {
    return { advisory: null, defects: null };
  }

  function unavailable(message, errorCode) {
    return {
      advisory: needsAdvisory ? unavailableAdvisory(message, errorCode) : null,
      defects: needsDefects
        ? buildUnavailableDefects({
            error: message,
            errorCode,
            model: settings.gemini && settings.gemini.model,
            categories: enabledDefectCategories,
          })
        : null,
    };
  }

  if (!policy.geminiEnabled) {
    return unavailable(
      'Gemini-assisted analysis is disabled by the administrator or unavailable.',
      'gemini_disabled'
    );
  }

  try {
    const buffer = uploadedBuffer || fs.readFileSync(uploadedPath);
    const contextCounts = {};
    ['A', 'B'].forEach((letter) => {
      if (policy.enabledLetters.includes(letter)) {
        contextCounts[`Grade${letter}`] = inference[`grade${letter}`];
      }
    });
    const result = await analyzeImage(buffer, {
      settings,
      context: {
        supportedGrades: inference.supportedGrades.filter((letter) =>
          policy.enabledLetters.includes(letter)
        ),
        enabledGrades: policy.enabledLetters,
        counts: contextCounts,
        includeDefects: needsDefects,
        requireDefects: needsDefects,
        enabledDefectCategories,
      },
    });
    return {
      advisory: needsAdvisory ? result : null,
      defects: needsDefects ? result.defects : null,
    };
  } catch (error) {
    return unavailable(
      error.message || 'Gemini-assisted analysis failed.',
      error.code || 'gemini_unavailable'
    );
  }
}

function buildFilter(userId, query = {}) {
  const filter = { user: userId };
  const grade = normalizeGrade(query.grade);
  if (grade) filter.finalGrade = grade;

  if (query.lot && mongoose.Types.ObjectId.isValid(query.lot)) {
    filter.lot = query.lot;
  }

  const from = parseDate(query.from);
  const to = parseDate(query.to);
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) {
      // Treat a date-only 'to' as end of that day.
      const end = new Date(to);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.to || ''))) {
        end.setUTCHours(23, 59, 59, 999);
      }
      filter.createdAt.$lte = end;
    }
  }

  if (query.q) {
    const term = escapeRegex(String(query.q).trim().slice(0, 80));
    if (term) {
      filter.$or = [
        { reportId: { $regex: term, $options: 'i' } },
        { filename: { $regex: term, $options: 'i' } },
      ];
    }
  }

  return filter;
}

function sortOption(value) {
  switch (String(value || 'newest')) {
    case 'oldest':
      return { createdAt: 1 };
    case 'grade':
      return { finalGrade: 1, createdAt: -1 };
    case 'confidence':
      return { confidence: -1, createdAt: -1 };
    case 'newest':
    default:
      return { createdAt: -1 };
  }
}

function sendPdf(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`
  );
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buffer);
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function activeDefectKeys(policy) {
  return Array.isArray(policy && policy.enabledDefectCategories)
    ? policy.enabledDefectCategories
    : [];
}

function scanSelect(policy, options = {}) {
  const excluded = ['-annotatedImage'];
  if (!activeDefectKeys(policy).length) excluded.push('-defects');
  if (options.excludeDetections) excluded.push('-detections');
  return excluded.join(' ');
}

function emptyDefectSummary(enabledKeys) {
  const categories = {};
  enabledKeys.forEach((key) => {
    categories[key] = {
      key,
      name: DEFECT_LABELS[key],
      detected: 0,
      not_detected: 0,
      uncertain: 0,
      unavailable: 0,
      analyzed: 0,
    };
  });
  return { enabled: true, categories };
}

function defectSummaryPipeline(filter, enabledKeys) {
  if (!enabledKeys.length) return [];
  return [
    { $match: filter },
    {
      $project: {
        categories: {
          $cond: [
            { $eq: [{ $type: '$defects.categories' }, 'object'] },
            { $objectToArray: '$defects.categories' },
            [],
          ],
        },
      },
    },
    { $unwind: '$categories' },
    { $match: { 'categories.k': { $in: enabledKeys } } },
    {
      $group: {
        _id: { key: '$categories.k', status: '$categories.v.status' },
        count: { $sum: 1 },
      },
    },
  ];
}

function applyDefectRows(summary, rows) {
  (rows || []).forEach((row) => {
    const key = row && row._id && row._id.key;
    const rawStatus = row && row._id && row._id.status;
    const status = rawStatus === 'error' ? 'unavailable' : rawStatus;
    const category = key && summary.categories[key];
    if (
      !category ||
      !['detected', 'not_detected', 'uncertain', 'unavailable'].includes(status)
    ) {
      return;
    }
    category[status] += Number(row.count) || 0;
    category.analyzed += Number(row.count) || 0;
  });
  return summary;
}

// ── POST /api/scans/predict ────────────────────────────────────────────────
router.post(
  '/predict',
  protect,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const settings = await getSettings({ fresh: true });
    const policy = buildPolicy(settings);
    if (!policy.masterEnabled) {
      removeTempFile(req.file.path);
      return res.status(403).json({
        error:
          'Master prediction is switched off by the administrator. No grade, count, confidence, chart, or price was generated.',
        policy,
      });
    }

    let lotId = req.body?.lotId || req.body?.lot || null;
    if (lotId && !mongoose.Types.ObjectId.isValid(lotId)) {
      removeTempFile(req.file.path);
      return res.status(400).json({ error: 'Invalid lot ID' });
    }
    if (lotId) {
      const lot = await Lot.findOne({ _id: lotId, user: req.user._id });
      if (!lot) {
        removeTempFile(req.file.path);
        return res.status(400).json({ error: 'Lot not found' });
      }
    }

    const uploadedPath = req.file.path;
    const validation = validateImageFile(uploadedPath, req.file.mimetype);
    if (!validation.valid) {
      removeTempFile(uploadedPath);
      return res.status(400).json({ error: validation.error });
    }

    let inference;
    try {
      inference = await runInference(uploadedPath);
    } catch (error) {
      removeTempFile(uploadedPath);
      throw error;
    }

    const gemini = await runGeminiAnalysis({
      uploadedPath,
      settings,
      inference,
      policy,
    });
    const advisory = gemini.advisory;

    const enabledAb = policy.enabledLetters.filter(
      (letter) =>
        ['A', 'B'].includes(letter) && inference.supportedGrades.includes(letter)
    );
    const onlyAdvisoryGrades =
      policy.enabledLetters.length > 0 &&
      enabledAb.length === 0 &&
      policy.enabledLetters.some((letter) => ['C', 'D'].includes(letter));

    const defectsRequested = activeDefectKeys(policy).length > 0;
    if (
      onlyAdvisoryGrades &&
      (!advisory || advisory.status !== 'ok') &&
      !defectsRequested
    ) {
      removeTempFile(uploadedPath);
      return res.status(503).json({
        error:
          (advisory && advisory.limitations && advisory.limitations[0]) ||
          'Only Grade C/D is enabled, but Gemini-assisted review is unavailable. No grade or count was invented.',
        geminiAdvisory: advisory,
        policy,
      });
    }

    let finalGrade = inference.finalGrade;
    let finalGradeSource = 'model';
    if (onlyAdvisoryGrades) {
      const advisoryGrade = selectAdvisoryFinalGrade(
        advisory,
        policy.enabledLetters
      );
      if (advisoryGrade) {
        finalGrade = advisoryGrade;
        finalGradeSource = 'gemini_advisory';
      } else {
        finalGrade = 'Invalid';
        finalGradeSource = 'none';
      }
    }

    let annotatedImage = null;
    let processedImage = null;
    const createdFiles = [req.file.filename];

    try {
      if (inference.annotatedBase64) {
        annotatedImage = saveBase64Image(inference.annotatedBase64, 'annotated');
        if (annotatedImage) createdFiles.push(annotatedImage);
      } else if (inference.annotatedPath && fs.existsSync(inference.annotatedPath)) {
        annotatedImage = storedImageName('image/jpeg', 'annotated');
        fs.copyFileSync(
          inference.annotatedPath,
          path.join(config.uploadDir, annotatedImage)
        );
        createdFiles.push(annotatedImage);
      }

      if (inference.processedBase64) {
        processedImage = saveBase64Image(inference.processedBase64, 'processed');
        if (processedImage) createdFiles.push(processedImage);
      }

      const scan = await Scan.create({
        filename: path.basename(req.file.originalname || 'upload'),
        originalImage: req.file.filename,
        processedImage,
        annotatedImage,
        gradeA: inference.gradeA,
        gradeB: inference.gradeB,
        gradeC: inference.gradeC,
        gradeD: inference.gradeD,
        supportedGrades: inference.supportedGrades,
        totalCount: inference.total,
        finalGrade,
        finalGradeSource,
        confidence: finalGradeSource === 'gemini_advisory' ? null : inference.confidence,
        qualityScore: finalGradeSource === 'gemini_advisory' ? null : inference.qualityScore,
        qualityMethod: inference.qualityMethod,
        confidenceMethod: inference.confidenceMethod,
        geminiAdvisory: advisory,
        settingsSnapshot: settingsSnapshot(settings),
        detections: inference.detections,
        measurements: inference.measurements,
        defects: gemini.defects,
        warnings: inference.warnings,
        modelId: inference.model.id || null,
        modelVersion: inference.model.version || null,
        modelChecksum: inference.model.sha256 || null,
        processingMs: inference.processingMs,
        imageWidth: inference.image.width || null,
        imageHeight: inference.image.height || null,
        lot: lotId || null,
        user: req.user._id,
      });

      const view = await presentScan(scan, settings, {
        includeDetections: true,
        includePricing: true,
        weightKg: req.body?.weightKg,
      });
      return res.status(201).json({
        success: true,
        scanId: scan._id,
        reportId: scan.reportId,
        // Legacy fields are filtered by the same active policy as `scan`.
        gradeA: view.gradeA,
        gradeB: view.gradeB,
        gradeC: view.gradeC,
        gradeD: view.gradeD,
        gradeCounts: view.gradeCounts,
        supportedGrades: view.supportedGrades,
        unavailableGrades: view.unavailableGrades,
        totalCount: view.totalCount,
        finalGrade: view.finalGrade,
        finalGradeSource: view.finalGradeSource,
        geminiAdvisory: view.geminiAdvisory,
        defects: view.defects,
        pricing: view.pricing,
        policy: view.predictionPolicy,
        annotatedImage: null,
        isBase64: false,
        scan: view,
      });
    } catch (error) {
      // Do not leave orphaned files if persistence fails.
      createdFiles.forEach((name) => {
        try {
          const filePath = path.join(config.uploadDir, path.basename(name));
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch {
          // best-effort
        }
      });
      if (inference.annotatedPath && fs.existsSync(inference.annotatedPath)) {
        removeTempFile(inference.annotatedPath);
      }
      throw error;
    }
  })
);

// ── GET /api/scans/history ─────────────────────────────────────────────────
router.get(
  '/history',
  protect,
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const policy = buildPolicy(settings);
    const filterError = gradeFilterError(req.query, policy);
    if (filterError) return res.status(400).json({ error: filterError });

    const { page, limit, skip } = parsePagination(req.query, { limit: 10 });
    const filter = buildFilter(req.user._id, req.query);
    const enabledDefectKeys = activeDefectKeys(policy);

    const [items, total, summaryRows, defectRows] = await Promise.all([
      Scan.find(filter)
        .sort(sortOption(req.query.sort))
        .skip(skip)
        .limit(limit)
        .select(scanSelect(policy)),
      Scan.countDocuments(filter),
      Scan.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$finalGrade',
            count: { $sum: 1 },
            avgQuality: { $avg: '$qualityScore' },
            nuts: { $sum: '$totalCount' },
            gradeASum: { $sum: '$gradeA' },
            gradeBSum: { $sum: '$gradeB' },
            gradeCSum: { $sum: '$gradeC' },
            gradeDSum: { $sum: '$gradeD' },
          },
        },
      ]),
      enabledDefectKeys.length
        ? Scan.aggregate(defectSummaryPipeline(filter, enabledDefectKeys))
        : Promise.resolve([]),
    ]);

    const views = await presentScans(items, settings, {
      includeDetections: false,
      includePricing: true,
    });

    const summary = {
      gradingEnabled: policy.masterEnabled,
      total: summaryRows.reduce((sum, row) => sum + row.count, 0),
      invalid: 0,
      totalNuts: null,
      avgQualityScore: null,
      gradeAvailability: {},
    };
    let qualityWeight = 0;
    const gradeSums = { A: 0, B: 0, C: 0, D: 0 };

    summaryRows.forEach((row) => {
      gradeSums.A += Number(row.gradeASum) || 0;
      gradeSums.B += Number(row.gradeBSum) || 0;
      gradeSums.C += Number(row.gradeCSum) || 0;
      gradeSums.D += Number(row.gradeDSum) || 0;
      if (row._id === 'Invalid' && policy.masterEnabled) summary.invalid += row.count;
      if (typeof row.avgQuality === 'number' && policy.masterEnabled) {
        summary.avgQualityScore =
          (summary.avgQualityScore || 0) + row.avgQuality * row.count;
        qualityWeight += row.count;
      }
    });

    if (policy.masterEnabled) {
      summary.totalNuts = 0;
      policy.enabledLetters.forEach((letter) => {
        const supported = ['A', 'B'].includes(letter);
        summary[`grade${letter}`] = supported ? Math.round(gradeSums[letter]) : 0;
        summary.gradeAvailability[letter] = {
          supported,
          count: supported ? Math.round(gradeSums[letter]) : null,
          reason: supported
            ? null
            : 'No validated Grade C/D detector is installed; Gemini advisory does not create counts.',
        };
        if (supported) summary.totalNuts += gradeSums[letter];
      });
    }
    if (qualityWeight > 0) {
      summary.avgQualityScore = Math.round((summary.avgQualityScore / qualityWeight) * 10) / 10;
    }
    if (enabledDefectKeys.length) {
      summary.defects = applyDefectRows(
        emptyDefectSummary(enabledDefectKeys),
        defectRows
      );
    }

    return res.json({
      items: views,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
      summary,
      policy,
      filters: {
        grade: normalizeGrade(req.query.grade),
        from: req.query.from || null,
        to: req.query.to || null,
        q: req.query.q || null,
        lot: mongoose.Types.ObjectId.isValid(req.query.lot) ? req.query.lot : null,
        sort: req.query.sort || 'newest',
      },
    });
  })
);

// ── GET /api/scans/export.csv ──────────────────────────────────────────────
router.get(
  '/export.csv',
  protect,
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const policy = buildPolicy(settings);
    const filterError = gradeFilterError(req.query, policy);
    if (filterError) return res.status(400).json({ error: filterError });

    const MAX_ROWS = 5000;
    const enabledDefectKeys = activeDefectKeys(policy);
    const filter = buildFilter(req.user._id, req.query);
    const [total, scans] = await Promise.all([
      Scan.countDocuments(filter),
      Scan.find(filter)
        .sort(sortOption(req.query.sort))
        .limit(MAX_ROWS)
        .select(scanSelect(policy)),
    ]);
    const views = scans.map((scan) =>
      applyScanPolicy(serializeScan(scan, { includeDetections: false }), settings)
    );

    const lotIds = [...new Set(scans.filter((scan) => scan.lot).map((scan) => String(scan.lot)))];
    const lots = lotIds.length
      ? await Lot.find({ _id: { $in: lotIds }, user: req.user._id }).select('name reference')
      : [];
    const lotMap = getLotMap(lots);

    const summary = {
      invalid: 0,
      nuts: policy.masterEnabled ? 0 : null,
    };
    views.forEach((view) => {
      if (policy.masterEnabled) {
        summary.nuts += Number(view.totalCount) || 0;
        if (view.finalGradeSource === 'hidden_by_policy') return;
        const letter = gradeLetterForFinalGrade(view.finalGrade);
        if (letter && policy.enabledLetters.includes(letter)) {
          summary[`grade${letter}`] = (summary[`grade${letter}`] || 0) + 1;
        } else if (!letter) {
          summary.invalid += 1;
        }
      }
    });

    const filterParts = [];
    if (req.query.q) filterParts.push(`search="${String(req.query.q).slice(0, 80)}"`);
    if (normalizeGrade(req.query.grade)) filterParts.push(`grade=${normalizeGrade(req.query.grade)}`);
    if (req.query.from) filterParts.push(`from=${req.query.from}`);
    if (req.query.to) filterParts.push(`to=${req.query.to}`);
    if (req.query.lot) filterParts.push(`lot=${req.query.lot}`);

    const lines = [];
    lines.push('\ufeffArecanut prediction export');
    lines.push(`Generated at,${csvCell(new Date().toISOString())}`);
    lines.push(`Filters,${csvCell(filterParts.length ? filterParts.join('; ') : 'none')}`);
    lines.push(`Policy version,${policy.version}`);
    lines.push(
      `Master prediction,${policy.masterEnabled ? 'on' : 'off'}`
    );
    lines.push(
      `Enabled grades,${policy.enabledLetters.length ? policy.enabledLetters.join('') : 'none'}`
    );
    lines.push(`Pricing mode,${policy.pricingMode}`);
    if (enabledDefectKeys.length) {
      lines.push('Defect analysis,Gemini image-level review');
      lines.push(
        `Enabled defects,${enabledDefectKeys.map((key) => DEFECT_LABELS[key]).join('; ')}`
      );
      lines.push(
        'Defect counts and locations,not available without a validated detector'
      );
    }
    lines.push(`Matching predictions,${total}`);
    lines.push(`Rows exported,${scans.length}`);
    if (policy.masterEnabled) {
      lines.push(`Total enabled nuts,${summary.nuts}`);
      policy.enabledLetters.forEach((letter) => {
        lines.push(`Majority Grade ${letter},${summary[`grade${letter}`] || 0}`);
      });
      lines.push(`Invalid / no enabled grade,${summary.invalid}`);
    } else {
      lines.push(
        'Grade columns,hidden by administrator policy; historical records remain stored and are filtered non-destructively'
      );
    }
    if (total > scans.length) {
      lines.push(`Note,Export limited to the most recent ${MAX_ROWS} matching predictions`);
    }
    lines.push('');

    const header = [
      'Report ID',
      'Scan ID',
      'Filename',
      'Created at',
      ...(policy.masterEnabled ? ['Final grade'] : []),
      ...(policy.masterEnabled
        ? policy.enabledLetters.map((letter) => `Grade ${letter}`)
        : []),
      ...(policy.masterEnabled ? ['Total enabled count', 'Confidence', 'Quality score'] : []),
      ...(enabledDefectKeys.length
        ? enabledDefectKeys.flatMap((key) => [
            `${DEFECT_LABELS[key]} status`,
            `${DEFECT_LABELS[key]} affected nuts`,
            `${DEFECT_LABELS[key]} explanation`,
          ])
        : []),
      'Model version',
      'Lot',
      'Lot reference',
    ];
    lines.push(header.map(csvCell).join(','));

    views.forEach((view, index) => {
      const scan = scans[index];
      const lot = scan.lot ? lotMap.get(String(scan.lot)) : null;
      const row = [
        scan.reportId || '',
        String(scan._id),
        scan.filename || '',
        scan.createdAt ? scan.createdAt.toISOString() : '',
        ...(policy.masterEnabled
          ? [
              view.finalGradeSource === 'hidden_by_policy'
                ? ''
                : view.finalGrade || 'Invalid',
            ]
          : []),
        ...(policy.masterEnabled
          ? policy.enabledLetters.map((letter) => view.gradeCounts?.[letter] ?? '')
          : []),
        ...(policy.masterEnabled
          ? [view.totalCount ?? '', view.confidence ?? '', view.qualityScore ?? '']
          : []),
        ...(enabledDefectKeys.length
          ? enabledDefectKeys.flatMap((key) => {
              const category = view.defects?.categories?.[key];
              return [
                category?.status || '',
                Number.isInteger(category?.affectedNutCount)
                  ? category.affectedNutCount
                  : '',
                category?.explanation || '',
              ];
            })
          : []),
        scan.modelVersion || '',
        lot?.name || '',
        lot?.reference || '',
      ];
      lines.push(row.map(csvCell).join(','));
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="arecanut-history-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.setHeader('Cache-Control', 'no-store');
    return res.send(lines.join('\n'));
  })
);

// ── GET /api/scans/stats ───────────────────────────────────────────────────
router.get(
  '/stats',
  protect,
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const policy = buildPolicy(settings);
    const filterError = gradeFilterError(req.query, policy);
    if (filterError) return res.status(400).json({ error: filterError });

    const userId = new mongoose.Types.ObjectId(req.user._id);
    const filter = buildFilter(userId, req.query);
    const activityDays = Math.min(
      Math.max(Number.parseInt(req.query.days, 10) || 14, 7),
      90
    );

    const activityStart = new Date();
    activityStart.setUTCHours(0, 0, 0, 0);
    activityStart.setUTCDate(activityStart.getUTCDate() - (activityDays - 1));
    const enabledDefectKeys = activeDefectKeys(policy);

    const [groups, activity, recent, modelStatus, defectRows] = await Promise.all([
      Scan.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$finalGrade',
            count: { $sum: 1 },
            nuts: { $sum: '$totalCount' },
            avgQuality: { $avg: '$qualityScore' },
            avgConfidence: { $avg: '$confidence' },
            gradeASum: { $sum: '$gradeA' },
            gradeBSum: { $sum: '$gradeB' },
            gradeCSum: { $sum: '$gradeC' },
            gradeDSum: { $sum: '$gradeD' },
          },
        },
      ]),
      Scan.aggregate([
        { $match: { ...filter, createdAt: { ...(filter.createdAt || {}), $gte: activityStart } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Scan.find(filter)
        .sort({ createdAt: -1 })
        .limit(5)
        .select(scanSelect(policy, { excludeDetections: true })),
      getModelStatus(),
      enabledDefectKeys.length
        ? Scan.aggregate(defectSummaryPipeline(filter, enabledDefectKeys))
        : Promise.resolve([]),
    ]);

    const counts = {
      'Grade A': 0,
      'Grade B': 0,
      'Grade C': 0,
      'Grade D': 0,
      Invalid: 0,
    };
    let total = 0;
    let qualitySum = 0;
    let qualityWeight = 0;
    let confidenceSum = 0;
    let confidenceWeight = 0;
    const gradeSums = { A: 0, B: 0, C: 0, D: 0 };

    groups.forEach((group) => {
      counts[group._id] = (counts[group._id] || 0) + group.count;
      total += group.count;
      gradeSums.A += Number(group.gradeASum) || 0;
      gradeSums.B += Number(group.gradeBSum) || 0;
      gradeSums.C += Number(group.gradeCSum) || 0;
      gradeSums.D += Number(group.gradeDSum) || 0;
      if (typeof group.avgQuality === 'number' && policy.masterEnabled) {
        qualitySum += group.avgQuality * group.count;
        qualityWeight += group.count;
      }
      if (typeof group.avgConfidence === 'number' && policy.masterEnabled) {
        confidenceSum += group.avgConfidence * group.count;
        confidenceWeight += group.count;
      }
    });

    const activityMap = new Map(activity.map((row) => [row._id, row.count]));
    const series = [];
    for (let index = 0; index < activityDays; index += 1) {
      const date = new Date(activityStart);
      date.setUTCDate(activityStart.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      series.push({ date: key, count: activityMap.get(key) || 0 });
    }

    const totals = {
      predictions: total,
      detections: null,
      avgQualityScore: null,
      avgConfidence: null,
    };
    let gradeDistribution = [];
    if (policy.masterEnabled) {
      totals.detections = 0;
      policy.enabledLetters.forEach((letter) => {
        const supported = ['A', 'B'].includes(letter);
        const value = supported ? Math.round(gradeSums[letter]) : 0;
        totals[`grade${letter}`] = value;
        totals[`grade${letter}Supported`] = supported;
        if (supported) totals.detections += value;
        gradeDistribution.push({
          grade: `Grade ${letter}`,
          count: value,
          supported,
          reason: supported
            ? null
            : 'No validated Grade C/D detector; Gemini advisory is not a count.',
        });
      });
      totals.invalid = counts.Invalid || 0;
      totals.avgQualityScore =
        qualityWeight > 0 ? Math.round((qualitySum / qualityWeight) * 10) / 10 : null;
      totals.avgConfidence =
        confidenceWeight > 0
          ? Math.round((confidenceSum / confidenceWeight) * 10) / 10
          : null;
    }

    const payload = {
      totals,
      gradeDistribution,
      activity: series,
      recent: await presentScans(recent, settings, {
        includeDetections: false,
        includePricing: true,
      }),
      policy,
      model: modelStatus,
      generatedAt: new Date().toISOString(),
    };
    if (enabledDefectKeys.length) {
      payload.defects = applyDefectRows(
        emptyDefectSummary(enabledDefectKeys),
        defectRows
      );
    }
    return res.json(payload);
  })
);

// ── GET /api/scans/performance ─────────────────────────────────────────────
router.get(
  '/performance',
  protect,
  asyncHandler(async (_req, res) => {
    const [modelStatus, evaluation] = await Promise.all([
      getModelStatus({ ping: true }),
      Promise.resolve(getEvaluationReport()),
    ]);
    const metadata = getModelMetadata();
    return res.json({
      model: modelStatus.model,
      artifact: modelStatus.artifact,
      runtime: modelStatus.runtime,
      transport: modelStatus.transport,
      evaluation,
      xrayDataset: getXrayDatasetReport(),
      capabilities: metadata.capabilities || {},
      notes: metadata.evaluation || {},
    });
  })
);

// ── GET /api/scans/performance/export.csv ──────────────────────────────────
router.get(
  '/performance/export.csv',
  protect,
  asyncHandler(async (_req, res) => {
    const evaluation = getEvaluationReport();
    if (!evaluation.available) {
      return res.status(409).json({
        error:
          evaluation.reason ||
          'No verified evaluation metrics are available to export.',
      });
    }

    const rows = [
      ['metric', 'value'],
      ['model', getModelMetadata().id || ''],
      ['version', getModelMetadata().version || ''],
      ['evaluated_at', evaluation.metrics.evaluatedAt || ''],
      ['dataset_size', evaluation.metrics.datasetSize ?? ''],
      ['accuracy', evaluation.metrics.accuracy ?? ''],
      ['precision', evaluation.metrics.precision ?? ''],
      ['recall', evaluation.metrics.recall ?? ''],
      ['f1', evaluation.metrics.f1 ?? ''],
    ];
    Object.entries(evaluation.metrics.perClass || {}).forEach(([label, values]) => {
      rows.push([`class_${label}_precision`, values.precision ?? '']);
      rows.push([`class_${label}_recall`, values.recall ?? '']);
      rows.push([`class_${label}_f1`, values.f1 ?? '']);
    });

    const csv = rows
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="arecanut-model-metrics.csv"'
    );
    return res.send(csv);
  })
);

// ── GET /api/scans/compare ─────────────────────────────────────────────────
router.get(
  '/compare',
  protect,
  asyncHandler(async (req, res) => {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (ids.length !== 2) {
      return res.status(400).json({ error: 'Provide exactly two prediction IDs' });
    }
    if (!ids.every((id) => mongoose.Types.ObjectId.isValid(id))) {
      return res.status(400).json({ error: 'One or more prediction IDs are invalid' });
    }

    const scans = await Scan.find({ _id: { $in: ids }, user: req.user._id });
    if (scans.length !== 2) {
      return res.status(404).json({ error: 'Both predictions must exist and belong to you' });
    }
    const ordered = ids.map((id) => scans.find((scan) => String(scan._id) === id));
    const settings = await getSettings();
    const views = await presentScans(ordered, settings, {
      includeDetections: true,
      includePricing: true,
    });
    return res.json({
      scans: views,
      policy: buildPolicy(settings),
      caveat:
        'Comparison does not imply that the same physical nut was tracked across images.',
    });
  })
);

// ── GET /api/scans/compare/report.pdf ──────────────────────────────────────
router.get(
  '/compare/report.pdf',
  protect,
  asyncHandler(async (req, res) => {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (ids.length !== 2 || !ids.every((id) => mongoose.Types.ObjectId.isValid(id))) {
      return res.status(400).json({ error: 'Provide exactly two valid prediction IDs' });
    }

    const scans = await Scan.find({ _id: { $in: ids }, user: req.user._id });
    if (scans.length !== 2) {
      return res.status(404).json({ error: 'Both predictions must exist and belong to you' });
    }
    const ordered = ids.map((id) => scans.find((scan) => String(scan._id) === id));
    const settings = await getSettings();
    const views = await presentScans(ordered, settings, {
      includeDetections: true,
      includePricing: true,
    });
    const images = await Promise.all(ordered.map((scan) => loadReportImages(scan)));
    const missingOriginal = ordered.filter((_scan, index) => !images[index].original);
    if (missingOriginal.length) {
      return res.status(409).json({
        error:
          'The original uploaded image is missing for one or more predictions, so the comparison PDF cannot embed the required evidence. The PDF was not generated.',
      });
    }
    const buffer = await buildComparisonReport(views, images, {
      policy: buildPolicy(settings),
    });
    return sendPdf(res, buffer, `arecanut-comparison-${Date.now()}.pdf`);
  })
);

// ── POST /api/scans/:id/reanalyze ──────────────────────────────────────────
// Re-runs Gemini image analysis against the stored original image without
// rerunning the Grade A/B checkpoint or creating a new prediction.
router.post(
  '/:id/reanalyze',
  protect,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid prediction ID' });
    }
    const scan = await Scan.findOne({ _id: req.params.id, user: req.user._id });
    if (!scan) return res.status(404).json({ error: 'Prediction not found' });

    const settings = await getSettings({ fresh: true });
    const policy = buildPolicy(settings);
    if (!policy.masterEnabled) {
      return res.status(403).json({
        error: 'Master prediction is disabled by the administrator.',
        policy,
      });
    }
    const enabledDefectKeys = activeDefectKeys(policy);
    if (!policy.defectDetectionEnabled || !enabledDefectKeys.length) {
      return res.status(400).json({
        error: 'Defect detection is disabled or no defect category is enabled.',
        policy,
      });
    }
    if (!policy.geminiEnabled) {
      return res.status(409).json({
        error:
          'Gemini-assisted analysis is disabled by the administrator. Ask an administrator to enable it and configure a server-side key.',
        policy,
      });
    }

    const original = loadScanImage(scan, 'original');
    if (!original) {
      return res.status(409).json({
        error:
          'The original uploaded image is missing, so defect analysis cannot be retried. The stored images may have been removed.',
        policy,
      });
    }

    const inference = {
      gradeA: scan.gradeA,
      gradeB: scan.gradeB,
      gradeC: scan.gradeC,
      gradeD: scan.gradeD,
      supportedGrades: Array.isArray(scan.supportedGrades)
        ? scan.supportedGrades
        : ['A', 'B'],
    };
    const gemini = await runGeminiAnalysis({
      uploadedBuffer: original.buffer,
      settings,
      inference,
      policy,
    });

    scan.geminiAdvisory = gemini.advisory;
    scan.defects = gemini.defects;
    const supportedGrades = Array.isArray(scan.supportedGrades) && scan.supportedGrades.length
      ? scan.supportedGrades
      : ['A', 'B'];
    const enabledAb = policy.enabledLetters.filter(
      (letter) => ['A', 'B'].includes(letter) && supportedGrades.includes(letter)
    );
    const onlyAdvisoryGrades =
      policy.enabledLetters.length > 0 &&
      enabledAb.length === 0 &&
      policy.enabledLetters.some((letter) => ['C', 'D'].includes(letter));
    if (onlyAdvisoryGrades) {
      const advisoryGrade = selectAdvisoryFinalGrade(
        gemini.advisory,
        policy.enabledLetters
      );
      scan.finalGrade = advisoryGrade || 'Invalid';
      scan.finalGradeSource = advisoryGrade ? 'gemini_advisory' : 'none';
      scan.confidence = null;
      scan.qualityScore = null;
    }
    await scan.save();

    const view = await presentScan(scan, settings, {
      includeDetections: true,
      includePricing: true,
      weightKg: req.body?.weightKg || req.query.weightKg,
    });
    const analysisStatus = view.defects?.analysisStatus || 'unavailable';
    const unavailable = analysisStatus === 'unavailable';
    return res.json({
      success: analysisStatus === 'success',
      analysisUnavailable: unavailable,
      message:
        analysisStatus === 'success'
          ? 'Gemini defect analysis refreshed.'
          : analysisStatus === 'partial'
          ? 'Gemini defect analysis completed, but some enabled categories are still unavailable.'
          : view.defects?.error ||
            'Defect analysis is unavailable. No defect status was inferred; this is not a "not detected" result.',
      scan: view,
      policy: view.predictionPolicy,
    });
  })
);

// ── GET /api/scans/:id ─────────────────────────────────────────────────────
router.get(
  '/:id',
  protect,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid prediction ID' });
    }
    const scan = await Scan.findOne({ _id: req.params.id, user: req.user._id });
    if (!scan) return res.status(404).json({ error: 'Prediction not found' });
    const settings = await getSettings();
    const view = await presentScan(scan, settings, {
      includeDetections: true,
      includePricing: true,
      weightKg: req.query.weightKg,
    });
    return res.json({ scan: view, policy: buildPolicy(settings) });
  })
);

// ── GET /api/scans/:id/image/:kind ─────────────────────────────────────────
router.get(
  '/:id/image/:kind',
  protect,
  asyncHandler(async (req, res) => {
    const kind = req.params.kind;
    if (!['original', 'processed', 'annotated'].includes(kind)) {
      return res.status(400).json({ error: 'Unknown image type' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid prediction ID' });
    }
    const scan = await Scan.findOne({ _id: req.params.id, user: req.user._id });
    if (!scan) return res.status(404).json({ error: 'Prediction not found' });

    if (kind !== 'original') {
      const settings = await getSettings();
      const policy = buildPolicy(settings);
      if (!policy.masterEnabled) {
        return res.status(403).json({
          error:
            'Processed and annotated model-output images are unavailable while master prediction is disabled.',
          policy,
        });
      }
      if (kind === 'annotated' && !isAnnotatedImageAllowed(scan, policy)) {
        return res.status(403).json({
          error:
            'The annotated image contains boxes for a grade that is disabled by the active display policy.',
          policy,
        });
      }
    }

    const image = loadScanImage(scan, kind);
    if (!image) return res.status(404).json({ error: 'Image not available' });

    res.setHeader('Content-Type', image.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(image.buffer);
  })
);

// ── GET /api/scans/:id/report.pdf ──────────────────────────────────────────
router.get(
  '/:id/report.pdf',
  protect,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid prediction ID' });
    }
    const scan = await Scan.findOne({ _id: req.params.id, user: req.user._id });
    if (!scan) return res.status(404).json({ error: 'Prediction not found' });

    const settings = await getSettings();
    const view = await presentScan(scan, settings, {
      includeDetections: true,
      includePricing: true,
      weightKg: req.query.weightKg,
    });
    const images = await loadReportImages(scan);
    if (!images.original) {
      return res.status(409).json({
        error:
          'The original uploaded image is missing, so the PDF cannot embed the required evidence image. The PDF was not generated.',
      });
    }
    const buffer = await buildPredictionReport(view, images, {
      policy: buildPolicy(settings),
    });
    return sendPdf(res, buffer, `arecanut-report-${scan.reportId || scan._id}.pdf`);
  })
);

// ── DELETE /api/scans/:id ──────────────────────────────────────────────────
router.delete(
  '/:id',
  protect,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid prediction ID' });
    }
    const scan = await Scan.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!scan) return res.status(404).json({ error: 'Prediction not found' });
    deleteScanImages(scan);
    return res.json({ message: 'Prediction deleted' });
  })
);

module.exports = router;
