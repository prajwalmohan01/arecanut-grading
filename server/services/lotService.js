'use strict';

const Lot = require('../models/Lot');

const GRADE_LETTERS = ['A', 'B', 'C', 'D'];

function toNumber(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return number;
}

function aggregateScans(scans) {
  const gradeCounts = { A: 0, B: 0, C: 0, D: 0 };
  let totalNuts = 0;
  let scanCount = 0;
  let confidenceSum = 0;
  let confidenceWeight = 0;
  let qualitySum = 0;
  let qualityWeight = 0;

  if (Array.isArray(scans)) {
    scans.forEach((scan) => {
      scanCount += 1;
      totalNuts += toNumber(scan.totalCount);
      gradeCounts.A += toNumber(scan.gradeA);
      gradeCounts.B += toNumber(scan.gradeB);
      gradeCounts.C += toNumber(scan.gradeC);
      gradeCounts.D += toNumber(scan.gradeD);
      if (typeof scan.confidence === 'number') {
        confidenceSum += scan.confidence * toNumber(scan.totalCount || 1);
        confidenceWeight += toNumber(scan.totalCount || 1);
      }
      if (typeof scan.qualityScore === 'number') {
        qualitySum += scan.qualityScore * toNumber(scan.totalCount || 1);
        qualityWeight += toNumber(scan.totalCount || 1);
      }
    });
  }

  return {
    scanCount,
    totalNuts,
    gradeCounts,
    avgConfidence: confidenceWeight > 0 ? confidenceSum / confidenceWeight : null,
    avgQualityScore: qualityWeight > 0 ? qualitySum / qualityWeight : null,
  };
}

function computeValuation(aggregates, lot) {
  const avgNutWeightG = toNumber(lot?.avgNutWeightG);
  const prices = {
    A: toNumber(lot?.prices?.A),
    B: toNumber(lot?.prices?.B),
    C: toNumber(lot?.prices?.C),
    D: toNumber(lot?.prices?.D),
  };
  const currency = String(lot?.currency || 'INR').trim().toUpperCase().slice(0, 8) || 'INR';

  const perGrade = {};
  let totalWeightKg = 0;
  let totalValue = 0;

  GRADE_LETTERS.forEach((letter) => {
    const count = toNumber(aggregates?.gradeCounts?.[letter]);
    const weightKg = avgNutWeightG > 0 ? (count * avgNutWeightG) / 1000 : 0;
    const pricePerKg = prices[letter];
    const value = pricePerKg > 0 && weightKg > 0 ? weightKg * pricePerKg : 0;
    totalWeightKg += weightKg;
    totalValue += value;
    perGrade[letter] = {
      count,
      weightKg: Math.round(weightKg * 1000) / 1000,
      pricePerKg,
      value: Math.round(value * 100) / 100,
    };
  });

  return {
    currency,
    avgNutWeightG,
    prices,
    perGrade,
    totalWeightKg: Math.round(totalWeightKg * 1000) / 1000,
    totalValue: Math.round(totalValue * 100) / 100,
    assumptions: {
      weight: avgNutWeightG > 0 ? 'Provided average nut weight' : 'No average weight set',
      pricing: totalValue > 0 ? 'Price per kg applied' : 'No prices set',
    },
  };
}

function serializeLotSummary(lot, scans) {
  const aggregates = aggregateScans(scans);
  const valuation = computeValuation(aggregates, lot);
  return {
    id: String(lot._id),
    lotId: String(lot._id),
    name: lot.name,
    reference: lot.reference || '',
    supplier: lot.supplier || '',
    notes: lot.notes || '',
    prices: valuation.prices,
    avgNutWeightG: valuation.avgNutWeightG,
    currency: valuation.currency,
    createdAt: lot.createdAt,
    updatedAt: lot.updatedAt,
    totals: aggregates,
    valuation,
    scanCount: aggregates.scanCount,
  };
}

function getLotMap(lots) {
  const map = new Map();
  if (Array.isArray(lots)) {
    lots.forEach((lot) => {
      map.set(String(lot._id), lot);
    });
  }
  return map;
}

module.exports = {
  aggregateScans,
  computeValuation,
  serializeLotSummary,
  getLotMap,
  GRADE_LETTERS,
};
