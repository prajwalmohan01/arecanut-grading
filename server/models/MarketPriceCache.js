'use strict';

const mongoose = require('mongoose');

const marketPriceCacheSchema = new mongoose.Schema(
  {
    cacheKey: { type: String, required: true, unique: true, index: true },
    source: { type: String, required: true, default: 'agmarknet' },
    query: { type: mongoose.Schema.Types.Mixed, default: {} },
    records: { type: [mongoose.Schema.Types.Mixed], default: [] },
    selected: { type: mongoose.Schema.Types.Mixed, default: null },
    fetchedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    lastError: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('MarketPriceCache', marketPriceCacheSchema);
