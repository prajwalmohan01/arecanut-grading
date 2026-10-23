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
} = require('../services/modelService');
const {
  serializeScan,
  loadScanImage,
  loadReportImages,
  deleteScanImages,
} = require('../services/scanService');
const { getLotMap } = require('../services/lotService');
const { buildPredictionReport, buildComparisonReport } = require('../utils/pdf');

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
  if (/^invalid$/i.test(raw)) return 'Invalid';
  return null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

// ── POST /api/scans/predict ────────────────────────────────────────────────
router.post(
  '/predict',
  protect,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
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
        finalGrade: inference.finalGrade,
        confidence: inference.confidence,
        qualityScore: inference.qualityScore,
        qualityMethod: inference.qualityMethod,
        confidenceMethod: inference.confidenceMethod,
        detections: inference.detections,
        measurements: inference.measurements,
        defects: inference.defects,
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

      const payload = serializeScan(scan);
      return res.status(201).json({
        success: true,
        scanId: scan._id,
        reportId: scan.reportId,
        // Legacy fields kept for clients that still read the original shape.
        gradeA: inference.gradeA,
        gradeB: inference.gradeB,
        gradeC: inference.gradeC,
        gradeD: inference.gradeD,
        supportedGrades: inference.supportedGrades,
        totalCount: inference.total,
        finalGrade: inference.finalGrade,
        annotatedImage: null,
        isBase64: false,
        scan: payload,
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
    const { page, limit, skip } = parsePagination(req.query, { limit: 10 });
    const filter = buildFilter(req.user._id, req.query);

    const [items, total, summaryRows] = await Promise.all([
      Scan.find(filter)
        .sort(sortOption(req.query.sort))
        .skip(skip)
        .limit(limit)
        .select('-annotatedImage -detections -defects'),
      Scan.countDocuments(filter),
      Scan.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$finalGrade',
            count: { $sum: 1 },
            avgQuality: { $avg: '$qualityScore' },
            nuts: { $sum: '$totalCount' },
          },
        },
      ]),
    ]);

    const summary = {
      total: summaryRows.reduce((sum, row) => sum + row.count, 0),
      gradeA: 0,
      gradeB: 0,
      gradeC: 0,
      gradeD: 0,
      invalid: 0,
      totalNuts: summaryRows.reduce((sum, row) => sum + (row.nuts || 0), 0),
      avgQualityScore: null,
    };
    let qualityWeight = 0;
    summaryRows.forEach((row) => {
      if (row._id === 'Grade A') summary.gradeA = row.count;
      else if (row._id === 'Grade B') summary.gradeB = row.count;
      else if (row._id === 'Grade C') summary.gradeC = row.count;
      else if (row._id === 'Grade D') summary.gradeD = row.count;
      else summary.invalid += row.count;
      if (typeof row.avgQuality === 'number') {
        summary.avgQualityScore =
          (summary.avgQualityScore || 0) + row.avgQuality * row.count;
        qualityWeight += row.count;
      }
    });
    if (qualityWeight > 0) {
      summary.avgQualityScore = Math.round((summary.avgQualityScore / qualityWeight) * 10) / 10;
    }

    return res.json({
      items: items.map((scan) => serializeScan(scan, { includeDetections: false })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
      summary,
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
    const MAX_ROWS = 5000;
    const filter = buildFilter(req.user._id, req.query);
    const [total, scans] = await Promise.all([
      Scan.countDocuments(filter),
      Scan.find(filter)
        .sort(sortOption(req.query.sort))
        .limit(MAX_ROWS)
        .select('-annotatedImage -detections -defects'),
    ]);

    const lotIds = [...new Set(scans.filter((scan) => scan.lot).map((scan) => String(scan.lot)))];
    const lots = lotIds.length
      ? await Lot.find({ _id: { $in: lotIds }, user: req.user._id }).select('name reference')
      : [];
    const lotMap = getLotMap(lots);

    const summary = {
      gradeA: 0,
      gradeB: 0,
      gradeC: 0,
      gradeD: 0,
      invalid: 0,
      nuts: 0,
    };
    scans.forEach((scan) => {
      const count = Number(scan.totalCount) || 0;
      summary.nuts += count;
      if (scan.finalGrade === 'Grade A') summary.gradeA += 1;
      else if (scan.finalGrade === 'Grade B') summary.gradeB += 1;
      else if (scan.finalGrade === 'Grade C') summary.gradeC += 1;
      else if (scan.finalGrade === 'Grade D') summary.gradeD += 1;
      else summary.invalid += 1;
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
    lines.push(`Matching predictions,${total}`);
    lines.push(`Rows exported,${scans.length}`);
    lines.push(`Total detected nuts,${summary.nuts}`);
    lines.push(`Majority Grade A,${summary.gradeA}`);
    lines.push(`Majority Grade B,${summary.gradeB}`);
    lines.push(`Majority Grade C,${summary.gradeC}`);
    lines.push(`Majority Grade D,${summary.gradeD}`);
    lines.push(`Invalid / no detections,${summary.invalid}`);
    if (total > scans.length) {
      lines.push(`Note,Export limited to the most recent ${MAX_ROWS} matching predictions`);
    }
    lines.push('');
    lines.push(
      [
        'Report ID',
        'Scan ID',
        'Filename',
        'Created at',
        'Final grade',
        'Grade A',
        'Grade B',
        'Grade C',
        'Grade D',
        'Total count',
        'Confidence',
        'Quality score',
        'Model version',
        'Lot',
        'Lot reference',
      ]
        .map(csvCell)
        .join(',')
    );

    scans.forEach((scan) => {
      const lot = scan.lot ? lotMap.get(String(scan.lot)) : null;
      lines.push(
        [
          scan.reportId || '',
          String(scan._id),
          scan.filename || '',
          scan.createdAt ? scan.createdAt.toISOString() : '',
          scan.finalGrade || '',
          scan.gradeA || 0,
          scan.gradeB || 0,
          scan.gradeC || 0,
          scan.gradeD || 0,
          scan.totalCount || 0,
          scan.confidence ?? '',
          scan.qualityScore ?? '',
          scan.modelVersion || '',
          lot?.name || '',
          lot?.reference || '',
        ]
          .map(csvCell)
          .join(',')
      );
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
    const userId = new mongoose.Types.ObjectId(req.user._id);
    const filter = buildFilter(userId, req.query);
    const activityDays = Math.min(
      Math.max(Number.parseInt(req.query.days, 10) || 14, 7),
      90
    );

    const activityStart = new Date();
    activityStart.setUTCHours(0, 0, 0, 0);
    activityStart.setUTCDate(activityStart.getUTCDate() - (activityDays - 1));

    const [groups, activity, recent, modelStatus] = await Promise.all([
      Scan.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$finalGrade',
            count: { $sum: 1 },
            nuts: { $sum: '$totalCount' },
            avgQuality: { $avg: '$qualityScore' },
            avgConfidence: { $avg: '$confidence' },
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
        .select('-annotatedImage -detections -defects'),
      getModelStatus(),
    ]);

    const counts = {
      'Grade A': 0,
      'Grade B': 0,
      'Grade C': 0,
      'Grade D': 0,
      Invalid: 0,
    };
    let total = 0;
    let nuts = 0;
    let qualitySum = 0;
    let qualityWeight = 0;
    let confidenceSum = 0;
    let confidenceWeight = 0;

    groups.forEach((group) => {
      counts[group._id] = (counts[group._id] || 0) + group.count;
      total += group.count;
      nuts += group.nuts || 0;
      if (typeof group.avgQuality === 'number') {
        qualitySum += group.avgQuality * group.count;
        qualityWeight += group.count;
      }
      if (typeof group.avgConfidence === 'number') {
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

    return res.json({
      totals: {
        predictions: total,
        detections: nuts,
        gradeA: counts['Grade A'] || 0,
        gradeB: counts['Grade B'] || 0,
        gradeC: counts['Grade C'] || 0,
        gradeD: counts['Grade D'] || 0,
        invalid: counts.Invalid || 0,
        avgQualityScore:
          qualityWeight > 0 ? Math.round((qualitySum / qualityWeight) * 10) / 10 : null,
        avgConfidence:
          confidenceWeight > 0
            ? Math.round((confidenceSum / confidenceWeight) * 10) / 10
            : null,
      },
      gradeDistribution: [
        { grade: 'Grade A', count: counts['Grade A'] || 0 },
        { grade: 'Grade B', count: counts['Grade B'] || 0 },
        { grade: 'Grade C', count: counts['Grade C'] || 0 },
        { grade: 'Grade D', count: counts['Grade D'] || 0 },
        { grade: 'Invalid', count: counts.Invalid || 0 },
      ],
      activity: series,
      recent: recent.map((scan) => serializeScan(scan, { includeDetections: false })),
      model: modelStatus,
      generatedAt: new Date().toISOString(),
    });
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
    return res.json({
      scans: ordered.map((scan) => serializeScan(scan)),
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
    const images = await Promise.all(ordered.map((scan) => loadReportImages(scan)));
    const buffer = await buildComparisonReport(ordered, images);
    return sendPdf(res, buffer, `arecanut-comparison-${Date.now()}.pdf`);
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
    return res.json({ scan: serializeScan(scan) });
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

    const images = await loadReportImages(scan);
    const buffer = await buildPredictionReport(scan, images);
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
