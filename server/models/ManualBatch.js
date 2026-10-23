'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

function createBatchId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `BATCH-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

const manualBatchSchema = new mongoose.Schema(
  {
    batchId: {
      type: String,
      unique: true,
      index: true,
      default: createBatchId,
    },
    name: {
      type: String,
      required: [true, 'Batch name is required'],
      trim: true,
      minlength: [2, 'Batch name must be at least 2 characters'],
      maxlength: [80, 'Batch name must be 80 characters or fewer'],
    },
    supplier: {
      type: String,
      trim: true,
      maxlength: [120, 'Supplier must be 120 characters or fewer'],
      default: '',
    },
    collectionDate: { type: Date, default: null },
    targetSamples: { type: Number, min: 0, max: 1_000_000, default: null },
    targetWeightKg: { type: Number, min: 0, max: 100_000_000, default: null },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, 'Batch notes must be 1000 characters or fewer'],
      default: '',
    },
    status: {
      type: String,
      enum: ['open', 'completed'],
      default: 'open',
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

manualBatchSchema.index({ user: 1, createdAt: -1 });
manualBatchSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('ManualBatch', manualBatchSchema);
