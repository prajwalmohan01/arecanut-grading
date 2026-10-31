'use strict';

const path = require('path');

// Resolve server/.env relative to this file so `node server/index.js` from the
// repository root behaves the same as `npm start` inside server/.
require('dotenv').config({ path: path.join(__dirname, '.env') });

const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_UPLOAD_DIR = path.join(__dirname, 'uploads');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

const config = {
  env: NODE_ENV,
  isProduction,
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGO_URI || '',
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  allowedOrigins: (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  uploadDir: process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : DEFAULT_UPLOAD_DIR,
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),
  mlTransport:
    process.env.ML_TRANSPORT || (isProduction ? 'http' : 'local'),
  mlServiceUrl: (process.env.ML_SERVICE_URL || 'http://localhost:5001').replace(
    /\/+$/,
    ''
  ),
  mlTimeoutMs: Number(process.env.ML_TIMEOUT_MS || 120000),
  pythonPath: process.env.PYTHON_PATH || 'python',
  useInferenceWorker: process.env.USE_INFERENCE_WORKER !== 'false',
  workerStartupTimeoutMs: Number(process.env.ML_WORKER_STARTUP_TIMEOUT_MS || 90000),
  inferenceWorkerPath: path.join(
    ROOT_DIR,
    'ml_service',
    'inference_worker.py'
  ),
  modelPath: process.env.MODEL_PATH
    ? path.resolve(ROOT_DIR, process.env.MODEL_PATH)
    : path.join(ROOT_DIR, 'ml_service', 'weights', 'best.pt'),
  modelMetadataPath: process.env.MODEL_METADATA_PATH
    ? path.resolve(ROOT_DIR, process.env.MODEL_METADATA_PATH)
    : path.join(ROOT_DIR, 'ml_service', 'model_metadata.json'),
  evaluationPath: process.env.EVALUATION_METRICS_PATH
    ? path.resolve(ROOT_DIR, process.env.EVALUATION_METRICS_PATH)
    : path.join(ROOT_DIR, 'ml_service', 'evaluation', 'metrics.json'),
  xrayDatasetPath: process.env.XRAY_DATASET_REPORT_PATH
    ? path.resolve(ROOT_DIR, process.env.XRAY_DATASET_REPORT_PATH)
    : path.join(ROOT_DIR, 'training_reports', 'xray_dataset.json'),
  pythonScriptPath: path.join(
    ROOT_DIR,
    'ml_service',
    'standalone_predict.py'
  ),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 30),
  apiRateLimitMax: Number(process.env.API_RATE_LIMIT_MAX || 600),
  trustProxy: process.env.TRUST_PROXY === 'true',

  // Gemini-assisted visual review. API keys are read by geminiService and are
  // deliberately never copied into API responses or logs.
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || 30000),
  geminiMaxRetries: Number(process.env.GEMINI_MAX_RETRIES || 2),
  geminiImageMaxDimension: Number(
    process.env.GEMINI_IMAGE_MAX_DIMENSION || 2048
  ),
  geminiCooldownMs: Number(process.env.GEMINI_COOLDOWN_MS || 60000),
  geminiMaxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 1600),

  // AGMARKNET daily mandi prices. The public AGMARKNET 2.0 dashboard is the
  // default keyless source. data.gov.in remains an optional fallback when a
  // free DATA_GOV_IN_API_KEY (or legacy AGMARKNET_API_KEY) is configured.
  marketSource: String(process.env.MARKET_PRICE_SOURCE || 'agmarknet_public')
    .trim()
    .toLowerCase(),
  marketPublicBaseUrl: String(
    process.env.MARKET_PUBLIC_BASE_URL || 'https://api.agmarknet.gov.in/v1'
  )
    .trim()
    .replace(/\/+$/, ''),
  marketFiltersCacheMinutes: Number(
    process.env.MARKET_FILTERS_CACHE_MINUTES || 360
  ),
  marketLookbackDays: Number(process.env.MARKET_LOOKBACK_DAYS || 7),
  marketResourceId:
    process.env.MARKET_PRICE_RESOURCE_ID ||
    '9ef84268-d588-465a-a308-a864a43d0070',
  marketTimeoutMs: Number(process.env.MARKET_PRICE_TIMEOUT_MS || 20000),
  marketCacheMinutes: Number(process.env.MARKET_PRICE_CACHE_MINUTES || 360),
};

function validateConfig() {
  const errors = [];
  const warnings = [];

  if (!config.mongoUri) {
    errors.push('MONGO_URI is required (local mongod or MongoDB Atlas connection string).');
  }
  if (!config.jwtSecret) {
    errors.push('JWT_SECRET is required.');
  } else if (config.jwtSecret.length < 16) {
    errors.push('JWT_SECRET must be at least 16 characters.');
  } else if (
    config.isProduction &&
    /change[_-]?me|example|secret_key_here|local_dev_secret/i.test(config.jwtSecret)
  ) {
    errors.push('JWT_SECRET still uses a development placeholder. Set a strong secret in production.');
  }
  if (!Number.isFinite(config.maxUploadMb) || config.maxUploadMb <= 0) {
    errors.push('MAX_UPLOAD_MB must be a positive number.');
  }
  if (!['local', 'http'].includes(config.mlTransport)) {
    errors.push("ML_TRANSPORT must be either 'local' or 'http'.");
  }
  if (config.mlTransport === 'http' && !config.mlServiceUrl) {
    errors.push('ML_SERVICE_URL is required when ML_TRANSPORT=http.');
  }
  if (config.mlTransport === 'local' && config.useInferenceWorker) {
    if (!fs.existsSync(config.inferenceWorkerPath)) {
      warnings.push(
        `Inference worker script not found at ${config.inferenceWorkerPath}; requests will use the slower per-image CLI fallback.`
      );
    } else if (
      !Number.isFinite(config.workerStartupTimeoutMs) ||
      config.workerStartupTimeoutMs < 5000
    ) {
      errors.push('ML_WORKER_STARTUP_TIMEOUT_MS must be at least 5000.');
    }
  }
  if (config.isProduction && config.allowedOrigins.includes('http://localhost:5173')) {
    warnings.push(
      'FRONTEND_URL is still http://localhost:5173 in production. Set your deployed frontend URL for CORS.'
    );
  }
  if (!Number.isFinite(config.geminiTimeoutMs) || config.geminiTimeoutMs < 3000) {
    warnings.push('GEMINI_TIMEOUT_MS should be at least 3000.');
  }
  if (!Number.isFinite(config.geminiMaxRetries) || config.geminiMaxRetries < 0) {
    warnings.push('GEMINI_MAX_RETRIES should be zero or greater.');
  }
  if (
    !Number.isFinite(config.geminiImageMaxDimension) ||
    config.geminiImageMaxDimension < 256
  ) {
    warnings.push('GEMINI_IMAGE_MAX_DIMENSION should be at least 256.');
  }
  if (!['agmarknet_public', 'data_gov_in'].includes(config.marketSource)) {
    errors.push(
      "MARKET_PRICE_SOURCE must be 'agmarknet_public' (default) or 'data_gov_in'."
    );
  }
  if (!/^https:\/\//i.test(config.marketPublicBaseUrl || '')) {
    errors.push('MARKET_PUBLIC_BASE_URL must be an HTTPS URL.');
  }
  if (!Number.isFinite(config.marketTimeoutMs) || config.marketTimeoutMs < 2000) {
    warnings.push('MARKET_PRICE_TIMEOUT_MS should be at least 2000.');
  }
  if (!Number.isFinite(config.marketLookbackDays) || config.marketLookbackDays < 0) {
    warnings.push('MARKET_LOOKBACK_DAYS should be zero or greater.');
  }
  if (
    !Number.isFinite(config.marketFiltersCacheMinutes) ||
    config.marketFiltersCacheMinutes < 5
  ) {
    warnings.push('MARKET_FILTERS_CACHE_MINUTES should be at least 5.');
  }
  if (
    process.env.GEMINI_ENABLED === 'true' &&
    ![
      'GEMINI_API_KEY',
      ...Array.from({ length: 10 }, (_value, index) => `GEMINI_API_KEY_${index + 1}`),
    ].some((name) => String(process.env[name] || '').trim())
  ) {
    warnings.push(
      'GEMINI_ENABLED=true but no GEMINI_API_KEY or GEMINI_API_KEY_1..10 is configured. Gemini-assisted review will be unavailable.'
    );
  }

  return { errors, warnings };
}

module.exports = { config, validateConfig, ROOT_DIR };
