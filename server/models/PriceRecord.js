'use strict';

const mongoose = require('mongoose');

const priceRecordSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    marketName: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
    grade: {
      type: String,
      enum: ['A', 'B'],
      required: true,
    },
    weightKg: {
      type: Number,
      required: true,
      min: 0.000001,
      max: 1_000_000,
    },
    pricePerKg: {
      type: Number,
      required: true,
      min: 0.000001,
      max: 10_000_000,
    },
    value: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 8,
      default: 'INR',
    },
    priceDate: { type: Date, default: Date.now },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true }
);

priceRecordSchema.index({ user: 1, priceDate: -1 });
priceRecordSchema.index({ user: 1, grade: 1, priceDate: -1 });

module.exports = mongoose.model('PriceRecord', priceRecordSchema);
