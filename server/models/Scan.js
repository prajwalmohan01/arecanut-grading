'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

function createReportId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `ARG-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

const detectionSchema = new mongoose.Schema(
  {
    label: String,
    grade: String,
    confidence: Number,
    confidence_pct: Number,
    bbox: [Number],
    box_width_px: Number,
    box_height_px: Number,
    area_px2: Number,
    area_ratio: Number,
    aspect_ratio: Number,
  },
  { _id: false }
);

const scanSchema = new mongoose.Schema(
  {
    reportId: {
      type: String,
      unique: true,
      index: true,
      default: createReportId,
    },
    filename: { type: String, required: true },
    originalImage: { type: String, default: null },
    processedImage: { type: String, default: null },
    // File name for new records; legacy records may contain a base64 string.
    annotatedImage: { type: String, default: null },

    gradeA: { type: Number, default: 0 },
    gradeB: { type: Number, default: 0 },
    gradeC: { type: Number, default: 0 },
    gradeD: { type: Number, default: 0 },
    totalCount: { type: Number, default: 0 },
    // Grades actually supported by the checkpoint that produced this scan.
    supportedGrades: { type: [String], default: [] },
    finalGrade: {
      type: String,
      enum: ['Grade A', 'Grade B', 'Grade C', 'Grade D', 'Invalid'],
      required: true,
    },
    finalGradeSource: {
      type: String,
      enum: ['model', 'gemini_advisory', 'none'],
      default: 'model',
    },

    confidence: { type: Number, default: null },
    confidenceMethod: { type: String, default: null },
    qualityScore: { type: Number, default: null },
    qualityMethod: { type: String, default: null },
    // Advisory Gemini visual review. This never contains per-nut counts or
    // bounding boxes and is not treated as an object detector.
    geminiAdvisory: { type: mongoose.Schema.Types.Mixed, default: null },
    // Non-secret snapshot of the settings that were active at prediction time.
    settingsSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    detections: { type: [detectionSchema], default: [] },
    measurements: { type: mongoose.Schema.Types.Mixed, default: null },
    defects: { type: mongoose.Schema.Types.Mixed, default: null },
    warnings: { type: [String], default: [] },

    // Majority grade calculation (calculated at prediction time and stored)
    majorityGrade: {
      type: String,
      enum: ['Grade A', 'Grade B', 'Grade C', 'Grade D', 'Joint', 'Not Available'],
      default: 'Not Available',
    },
    majorityGradeCount: { type: Number, default: 0 },
    majorityGradePercentage: { type: Number, default: null },
    majorityGradeDetails: { type: mongoose.Schema.Types.Mixed, default: null },

    // Multi-model inference fields for Grade C/D fallback
    cDModelUsed: {
      type: String,
      enum: ['primary_yolo', 'gemini_advisory', 'huggingface', 'roboflow', 'custom', 'none'],
      default: 'none',
    },
    alternativeModelResult: { type: mongoose.Schema.Types.Mixed, default: null },

    modelId: { type: String, default: null },
    modelVersion: { type: String, default: null },
    modelChecksum: { type: String, default: null },
    processingMs: { type: Number, default: null },
    imageWidth: { type: Number, default: null },
    imageHeight: { type: Number, default: null },

    lot: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lot',
      default: null,
      index: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

scanSchema.index({ user: 1, createdAt: -1 });
scanSchema.index({ user: 1, finalGrade: 1 });

scanSchema.statics.createReportId = createReportId;

module.exports = mongoose.model('Scan', scanSchema);
