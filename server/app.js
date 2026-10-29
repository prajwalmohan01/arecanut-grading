'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { config } = require('./config');
const authRoutes = require('./routes/auth');
const scanRoutes = require('./routes/scans');
const lotRoutes = require('./routes/lots');
const manualRecordRoutes = require('./routes/manualRecords');
const manualBatchRoutes = require('./routes/manualBatches');
const manualPriceRoutes = require('./routes/manualPrices');
const manualActivityRoutes = require('./routes/manualActivity');
const verifyRoutes = require('./routes/verify');
const systemRoutes = require('./routes/system');
const adminRoutes = require('./routes/admin');
const settingsRoutes = require('./routes/settings');
const marketPriceRoutes = require('./routes/marketPrices');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { ensureUploadDir } = require('./utils/files');

function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  if (config.allowedOrigins.includes(origin)) return callback(null, true);
  if (!config.isProduction && /^http:\/\/localhost:\d+$/.test(origin)) {
    return callback(null, true);
  }
  return callback(new Error(`Origin ${origin} is not allowed by CORS`));
}

function createApp() {
  ensureUploadDir();
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  app.use(cors({ origin: corsOrigin, credentials: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  if (config.env !== 'test') {
    const apiLimiter = rateLimit({
      windowMs: config.rateLimitWindowMs,
      limit: config.apiRateLimitMax,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please try again later.' },
    });
    const authLimiter = rateLimit({
      windowMs: config.rateLimitWindowMs,
      limit: config.authRateLimitMax,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many authentication attempts. Please try again later.' },
    });
    app.use('/api', apiLimiter);
    app.use('/api/auth/login', authLimiter);
    app.use('/api/auth/signup', authLimiter);
  }

  app.use('/api/auth', authRoutes);
  app.use('/api/scans', scanRoutes);
  app.use('/api/lots', lotRoutes);
  app.use('/api/manual/records', manualRecordRoutes);
  app.use('/api/manual/batches', manualBatchRoutes);
  app.use('/api/manual/prices', manualPriceRoutes);
  app.use('/api/manual/activity', manualActivityRoutes);
  app.use('/api/verify', verifyRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/market-prices', marketPriceRoutes);
  app.use('/api', systemRoutes);

  app.get('/', (_req, res) => {
    res.json({
      service: 'Arecanut Quality Grading API',
      health: '/api/health',
      documentation: '/api/openapi.yaml',
    });
  });

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
