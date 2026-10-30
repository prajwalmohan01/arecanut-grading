'use strict';

const mongoose = require('mongoose');

const adminAuditSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        'settings_initialized',
        'predictions_updated',
        'defects_updated',
        'gemini_updated',
        'pricing_updated',
      ],
      index: true,
    },
    summary: { type: String, required: true, maxlength: 500 },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    ip: { type: String, default: '', maxlength: 80 },
  },
  { timestamps: true }
);

adminAuditSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AdminAudit', adminAuditSchema);
