'use strict';

const mongoose = require('mongoose');

const gradePriceSchema = new mongoose.Schema(
  {
    price: { type: Number, default: 0, min: 0, max: 10000000 },
    unit: {
      type: String,
      enum: ['per_nut', 'per_kg', 'per_quintal'],
      default: 'per_kg',
    },
  },
  { _id: false }
);

const systemSettingsSchema = new mongoose.Schema(
  {
    // A single settings document is used for the whole installation. The
    // unique singleton key makes accidental duplicate settings impossible.
    singleton: {
      type: String,
      default: 'global',
      unique: true,
      immutable: true,
    },
    version: { type: Number, default: 1, min: 1 },

    predictions: {
      masterEnabled: { type: Boolean, default: true },
      grades: {
        A: { type: Boolean, default: true },
        B: { type: Boolean, default: true },
        C: { type: Boolean, default: false },
        D: { type: Boolean, default: false },
      },
      geminiEnabled: { type: Boolean, default: false },
    },

    gemini: {
      model: { type: String, default: 'gemini-3.5-flash', trim: true, maxlength: 120 },
      timeoutMs: { type: Number, default: 30000, min: 3000, max: 120000 },
      maxRetries: { type: Number, default: 2, min: 0, max: 5 },
      imageMaxDimension: { type: Number, default: 1280, min: 256, max: 4096 },
    },

    pricing: {
      mode: {
        type: String,
        enum: ['none', 'live', 'manual'],
        default: 'none',
      },
      currency: { type: String, default: 'INR', trim: true, uppercase: true },
      manual: {
        A: { type: gradePriceSchema, default: () => ({ price: 0, unit: 'per_kg' }) },
        B: { type: gradePriceSchema, default: () => ({ price: 0, unit: 'per_kg' }) },
        C: { type: gradePriceSchema, default: () => ({ price: 0, unit: 'per_kg' }) },
        D: { type: gradePriceSchema, default: () => ({ price: 0, unit: 'per_kg' }) },
      },
      live: {
        source: { type: String, default: 'agmarknet', enum: ['agmarknet'] },
        state: { type: String, default: '', trim: true, maxlength: 80 },
        district: { type: String, default: '', trim: true, maxlength: 80 },
        market: { type: String, default: '', trim: true, maxlength: 120 },
        commodity: {
          type: String,
          default: 'Arecanut(Betelnut/Supari)',
          trim: true,
          maxlength: 120,
        },
        variety: { type: String, default: '', trim: true, maxlength: 80 },
        marketGrade: { type: String, default: '', trim: true, maxlength: 40 },
        priceField: {
          type: String,
          enum: ['modal', 'min', 'max'],
          default: 'modal',
        },
        refreshMinutes: { type: Number, default: 360, min: 15, max: 1440 },
      },
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SystemSettings', systemSettingsSchema);
