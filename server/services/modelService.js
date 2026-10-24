'use strict';

const crypto = require('crypto');
const fs = require('fs');
const axios = require('axios');
const { config } = require('../config');

let cachedHash = null;

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function fileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
  });
}

function getModelMetadata() {
  return readJson(config.modelMetadataPath) || {};
}

async function getModelArtifactStatus() {
  const metadata = getModelMetadata();
  const exists = fs.existsSync(config.modelPath);
  if (!exists) {
    return {
      exists: false,
      path: config.modelPath,
      metadata,
      checksum: null,
      checksumMatchesMetadata: false,
      error:
        'Trained model artifact is missing. Restore ml_service/weights/best.pt or set MODEL_PATH.',
    };
  }

  const stat = fs.statSync(config.modelPath);
  if (!cachedHash) {
    cachedHash = await fileSha256(config.modelPath);
  }
  const expected = metadata.sha256 ? metadata.sha256.toUpperCase() : null;

  return {
    exists: true,
    path: config.modelPath,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    checksum: cachedHash,
    checksumMatchesMetadata: expected ? expected === cachedHash : null,
    metadata,
    error: null,
  };
}

function getEvaluationReport() {
  const metrics = readJson(config.evaluationPath);
  const metadata = getModelMetadata();
  if (!metrics) {
    return {
      available: false,
      reason:
        (metadata.evaluation && metadata.evaluation.reason) ||
        'No verified held-out evaluation report is bundled with this model. Metrics are not fabricated.',
      metrics: null,
    };
  }
  return { available: true, reason: null, metrics };
}

function getXrayDatasetReport() {
  const report = readJson(config.xrayDatasetPath);
  if (!report || typeof report !== 'object') {
    return {
      available: false,
      downloaded: false,
      prepared: false,
      reason:
        'No X-ray dataset report exists yet. Download it explicitly with scripts/download_xray_dataset.py, then prepare it.',
    };
  }
  return {
    ...report,
    available: report.available !== false && report.status !== 'failed',
    downloaded: report.downloaded === true,
    prepared: report.prepared === true,
    reason: report.error || null,
  };
}

async function pingMlService() {
  if (config.mlTransport !== 'http') {
    return { reachable: null, detail: 'ML_TRANSPORT=local (in-process CLI transport)' };
  }
  try {
    const response = await axios.get(`${config.mlServiceUrl}/health`, {
      timeout: 4000,
    });
    return {
      reachable: response.status === 200,
      detail:
        (response.data && response.data.model && response.data.model.id) || 'ok',
    };
  } catch (error) {
    return { reachable: false, detail: error.message };
  }
}

async function getModelStatus({ ping = false } = {}) {
  const artifact = await getModelArtifactStatus();
  const metadata = artifact.metadata || {};
  const runtime = ping ? await pingMlService() : null;
  return {
    ready: artifact.exists && artifact.checksumMatchesMetadata !== false,
    artifact: {
      exists: artifact.exists,
      sizeBytes: artifact.sizeBytes || null,
      checksum: artifact.checksum,
      checksumMatchesMetadata: artifact.checksumMatchesMetadata,
      modifiedAt: artifact.modifiedAt || null,
    },
    model: {
      id: metadata.id || 'arecanut-yolov8',
      version: metadata.version || 'unknown',
      task: metadata.task || null,
      classes: metadata.classes || [],
      input: metadata.input || {},
      capabilities: metadata.capabilities || {},
    },
    transport: config.mlTransport,
    runtime,
    error: artifact.error,
  };
}

module.exports = {
  getModelMetadata,
  getModelArtifactStatus,
  getEvaluationReport,
  getXrayDatasetReport,
  getModelStatus,
  pingMlService,
};
