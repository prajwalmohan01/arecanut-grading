'use strict';

const fs = require('fs');
const {
  resolveUploadFile,
  unlinkUploadFile,
} = require('../utils/files');

function toObject(scan) {
  return typeof scan.toObject === 'function' ? scan.toObject() : scan;
}

function isLegacyBase64(value) {
  return (
    typeof value === 'string' &&
    value.length > 100 &&
    !/[\\/]/.test(value.slice(0, 20)) &&
    /^[A-Za-z0-9+/=\r\n]+$/.test(value.slice(0, 120))
  );
}

function imageUrl(scan, kind) {
  const source =
    kind === 'original'
      ? scan.originalImage
      : kind === 'processed'
      ? scan.processedImage
      : scan.annotatedImage;
  if (!source) return null;
  // Relative to the API base URL (the client already prefixes /api).
  return `/scans/${scan._id}/image/${kind}`;
}

function serializeScan(scan, options = {}) {
  const doc = toObject(scan);
  const includeDetections = options.includeDetections !== false;

  return {
    id: String(doc._id),
    scanId: String(doc._id),
    reportId: doc.reportId || null,
    filename: doc.filename,
    finalGrade: doc.finalGrade,
    grade: doc.finalGrade,
    gradeA: doc.gradeA || 0,
    gradeB: doc.gradeB || 0,
    gradeC: doc.gradeC || 0,
    gradeD: doc.gradeD || 0,
    gradeCounts: {
      A: doc.gradeA || 0,
      B: doc.gradeB || 0,
      C: doc.gradeC || 0,
      D: doc.gradeD || 0,
    },
    lot: doc.lot ? String(doc.lot) : null,
    supportedGrades: Array.isArray(doc.supportedGrades) ? doc.supportedGrades : [],
    totalCount: doc.totalCount || 0,
    confidence: doc.confidence ?? null,
    qualityScore: doc.qualityScore ?? null,
    qualityMethod: doc.qualityMethod || null,
    confidenceMethod: doc.confidenceMethod || null,
    detections: includeDetections ? doc.detections || [] : undefined,
    measurements: doc.measurements || null,
    defects: doc.defects || null,
    warnings: doc.warnings || [],
    modelId: doc.modelId || null,
    modelVersion: doc.modelVersion || null,
    modelChecksum: doc.modelChecksum || null,
    processingMs: doc.processingMs ?? null,
    imageWidth: doc.imageWidth ?? null,
    imageHeight: doc.imageHeight ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    images: {
      original: imageUrl(doc, 'original'),
      processed: imageUrl(doc, 'processed'),
      annotated: imageUrl(doc, 'annotated'),
    },
  };
}

function loadScanImage(scan, kind) {
  if (!scan) return null;
  const doc = toObject(scan);

  if (kind === 'original' || kind === 'processed') {
    const filename =
      kind === 'original' ? doc.originalImage : doc.processedImage;
    const resolved = resolveUploadFile(filename);
    if (!resolved) return null;
    return {
      buffer: fs.readFileSync(resolved),
      mime: filename.toLowerCase().endsWith('.png')
        ? 'image/png'
        : filename.toLowerCase().endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg',
      source: filename,
    };
  }

  if (kind === 'annotated') {
    const resolved = resolveUploadFile(doc.annotatedImage);
    if (resolved) {
      return {
        buffer: fs.readFileSync(resolved),
        mime: doc.annotatedImage.toLowerCase().endsWith('.png')
          ? 'image/png'
          : 'image/jpeg',
        source: doc.annotatedImage,
      };
    }
    if (isLegacyBase64(doc.annotatedImage)) {
      try {
        const cleaned = doc.annotatedImage.includes('base64,')
          ? doc.annotatedImage.split('base64,').pop()
          : doc.annotatedImage;
        return {
          buffer: Buffer.from(cleaned, 'base64'),
          mime: 'image/jpeg',
          source: 'legacy-base64',
        };
      } catch {
        return null;
      }
    }
  }

  return null;
}

function deleteScanImages(scan) {
  if (!scan) return;
  const doc = toObject(scan);
  [doc.originalImage, doc.processedImage, doc.annotatedImage].forEach((name) => {
    if (name && !isLegacyBase64(name)) unlinkUploadFile(name);
  });
}

async function loadReportImages(scan) {
  const original = loadScanImage(scan, 'original');
  const processed = loadScanImage(scan, 'processed');
  const annotated = loadScanImage(scan, 'annotated');
  return {
    original: original ? original.buffer : null,
    processed: processed ? processed.buffer : null,
    annotated: annotated ? annotated.buffer : null,
  };
}

module.exports = {
  serializeScan,
  loadScanImage,
  loadReportImages,
  deleteScanImages,
  isLegacyBase64,
};
