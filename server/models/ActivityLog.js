'use strict';

const mongoose = require('mongoose');

const ACTIVITY_TYPES = [
  'record_created',
  'record_updated',
  'record_corrected',
  'record_deleted',
  'record_reviewed',
  'record_flagged',
  'record_exported',
  'record_report_generated',
  'batch_created',
  'batch_updated',
  'batch_deleted',
  'batch_exported',
  'batch_report_generated',
  'assessment_generated',
  'price_created',
  'price_deleted',
  'price_exported',
];

const activityLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ACTIVITY_TYPES,
      required: true,
      index: true,
    },
    message: { type: String, required: true, maxlength: 300 },
    entityType: {
      type: String,
      enum: ['grading_record', 'batch', 'price_record', 'assessment', 'export'],
      default: 'grading_record',
    },
    entityId: { type: String, default: '' },
    entityLabel: { type: String, default: '', maxlength: 120 },
    batchCode: { type: String, default: '', maxlength: 80 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

activityLogSchema.index({ user: 1, createdAt: -1 });
activityLogSchema.index({ user: 1, type: 1, createdAt: -1 });

activityLogSchema.statics.TYPES = ACTIVITY_TYPES;

module.exports = mongoose.model('ActivityLog', activityLogSchema);
