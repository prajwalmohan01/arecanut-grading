'use strict';

require('dotenv').config();

const path = require('path');

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
  if (config.isProduction && config.allowedOrigins.includes('http://localhost:5173')) {
    warnings.push(
      'FRONTEND_URL is still http://localhost:5173 in production. Set your deployed frontend URL for CORS.'
    );
  }

  return { errors, warnings };
}

module.exports = { config, validateConfig, ROOT_DIR };
