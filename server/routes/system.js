'use strict';

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const Scan = require('../models/Scan');
const User = require('../models/User');
const { protect, requireAdmin } = require('../middleware/authMiddleware');
const asyncHandler = require('../utils/asyncHandler');
const { getModelStatus } = require('../services/modelService');
const { config } = require('../config');

const router = express.Router();

function databaseState() {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  return states[mongoose.connection.readyState] || 'unknown';
}

// GET /api/health
router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const model = await getModelStatus();
    const database = databaseState();
    const healthy = database === 'connected' && model.ready;
    return res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      service: 'arecanut-api',
      environment: config.env,
      database,
      model: {
        ready: model.ready,
        id: model.model.id,
        version: model.model.version,
        checksumMatchesMetadata: model.artifact.checksumMatchesMetadata,
        transport: model.transport,
        error: model.error,
      },
      timestamp: new Date().toISOString(),
    });
  })
);

// GET /api/system/model
router.get(
  '/system/model',
  protect,
  asyncHandler(async (req, res) => {
    const ping = req.query.ping === '1' || req.query.ping === 'true';
    return res.json(await getModelStatus({ ping }));
  })
);

// GET /api/system/admin/stats — role gated, no fabricated values.
router.get(
  '/system/admin/stats',
  protect,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const [users, scans, gradeGroups] = await Promise.all([
      User.countDocuments(),
      Scan.countDocuments(),
      Scan.aggregate([{ $group: { _id: '$finalGrade', count: { $sum: 1 } } }]),
    ]);
    return res.json({
      users,
      scans,
      grades: gradeGroups,
      model: await getModelStatus(),
      timestamp: new Date().toISOString(),
    });
  })
);

// GET /api/openapi.yaml
router.get('/openapi.yaml', (req, res) => {
  const specPath = path.join(__dirname, '..', 'openapi.yaml');
  if (!fs.existsSync(specPath)) {
    return res.status(404).json({ error: 'OpenAPI specification not found' });
  }
  res.type('application/yaml');
  return res.sendFile(specPath);
});

module.exports = router;
