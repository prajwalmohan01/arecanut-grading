'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

function createReportId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `MGR-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

const changeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    label: { type: String, default: '' },
    from: { type: mongoose.Schema.Types.Mixed, default: null },
    to: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const correctionSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['update', 'grade-correction', 'review'],
      default: 'update',
    },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '' },
    reason: { type: String, default: '', maxlength: 500 },
    changes: { type: [changeSchema], default: [] },
  },
  { _id: false }
);

const manualGradeSchema = new mongoose.Schema(
  {
    reportId: {
      type: String,
      unique: true,
      index: true,
      default: createReportId,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ManualBatch',
      default: null,
      index: true,
    },
    // Snapshots preserve context if a batch is renamed or deleted.
    batchCode: { type: String, default: '', trim: true, maxlength: 80 },
    batchName: { type: String, default: '', trim: true, maxlength: 80 },
    sampleCode: { type: String, default: '', trim: true, maxlength: 80 },

    image: {
      filename: { type: String, required: true },
      originalName: { type: String, default: '', maxlength: 255 },
      mime: { type: String, required: true },
      size: { type: Number, default: 0, min: 0 },
      width: { type: Number, default: null, min: 0 },
      height: { type: Number, default: null, min: 0 },
      hash: { type: String, required: true, index: true },
    },

    grade: {
      type: String,
      enum: ['A', 'B', null],
      default: null,
    },
    status: {
      type: String,
      enum: ['draft', 'completed'],
      default: 'completed',
      index: true,
    },
    quantity: { type: Number, default: null, min: 0, max: 1_000_000 },
    weightKg: { type: Number, default: null, min: 0, max: 1_000_000 },
    sizeMm: { type: Number, default: null, min: 0, max: 10_000 },
    appearance: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },
    gradedAt: { type: Date, default: Date.now, index: true },
    reviewerName: { type: String, trim: true, maxlength: 80, default: '' },
    observations: { type: String, trim: true, maxlength: 500, default: '' },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },

    // Advisory upload check from the browser. Never used to assign a grade.
    imageQuality: {
      checked: { type: Boolean, default: false },
      width: { type: Number, default: null },
      height: { type: Number, default: null },
      brightness: { type: Number, default: null },
      blurScore: { type: Number, default: null },
      warnings: { type: [String], default: [] },
      source: { type: String, default: 'browser-canvas' },
      checkedAt: { type: Date, default: null },
    },

    review: {
      reviewed: { type: Boolean, default: false },
      reviewedAt: { type: Date, default: null },
      reviewedByName: { type: String, default: '', maxlength: 80 },
      notes: { type: String, default: '', maxlength: 500 },
      imageFlagged: { type: Boolean, default: false },
    },

    assessment: {
      id: { type: String, default: null },
      issuedAt: { type: Date, default: null },
    },
    assessmentToken: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      select: false,
    },

    corrections: { type: [correctionSchema], default: [] },
  },
  { timestamps: true }
);

manualGradeSchema.index({ user: 1, createdAt: -1 });
manualGradeSchema.index({ user: 1, gradedAt: -1 });
manualGradeSchema.index({ user: 1, batch: 1 });
manualGradeSchema.index({ user: 1, grade: 1 });
manualGradeSchema.index({ user: 1, status: 1 });
manualGradeSchema.index({ user: 1, 'image.hash': 1 });

manualGradeSchema.statics.createReportId = createReportId;

module.exports = mongoose.model('ManualGrade', manualGradeSchema);
