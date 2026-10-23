'use strict';

const mongoose = require('mongoose');

const lotSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 80,
    },
    reference: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
    supplier: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    prices: {
      A: { type: Number, default: 0, min: 0 },
      B: { type: Number, default: 0, min: 0 },
      C: { type: Number, default: 0, min: 0 },
      D: { type: Number, default: 0, min: 0 },
    },
    avgNutWeightG: {
      type: Number,
      default: 0,
      min: 0,
      max: 1000,
    },
    currency: {
      type: String,
      trim: true,
      maxlength: 8,
      default: 'INR',
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

lotSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Lot', lotSchema);
