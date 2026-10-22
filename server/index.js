'use strict';

const { config, validateConfig } = require('./config');
const createApp = require('./app');
const { connectDatabase, disconnectDatabase } = require('./database');
const { getModelArtifactStatus } = require('./services/modelService');
const { ensureUploadDir } = require('./utils/files');

async function start() {
  const { errors, warnings } = validateConfig();
  warnings.forEach((warning) => console.warn(`[config] warning: ${warning}`));
  if (errors.length) {
    console.error('[config] Cannot start the server:');
    errors.forEach((error) => console.error(`  - ${error}`));
    process.exitCode = 1;
    return;
  }

  if (config.mlTransport === 'local') {
    const artifact = await getModelArtifactStatus();
    if (!artifact.exists || artifact.checksumMatchesMetadata === false) {
      console.error('[model] Cannot start: trained model artifact is not usable.');
      console.error(`  ${artifact.error || 'Model checksum does not match metadata.'}`);
      console.error('  Run: python scripts/verify_model.py');
      process.exitCode = 1;
      return;
    }
    console.log(`[model] Verified preserved model: ${artifact.metadata.id} (${artifact.checksum})`);
  } else {
    console.log(`[model] Inference transport: HTTP (${config.mlServiceUrl})`);
  }

  ensureUploadDir();

  try {
    await connectDatabase();
    console.log('[db] MongoDB connected');
  } catch (error) {
    console.error(`[db] MongoDB connection failed: ${error.message}`);
    console.error(
      '  Check MONGO_URI. Local MongoDB must be running, or use a MongoDB Atlas URI.'
    );
    process.exitCode = 1;
    return;
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[api] Arecanut API listening on http://localhost:${config.port}`);
    console.log(`[api] Health check: http://localhost:${config.port}/api/health`);
    if (!config.isProduction) {
      console.log('[api] Frontend dev server: http://localhost:5173');
    }
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[api] ${signal} received, shutting down...`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled rejection:', reason);
});

start().catch((error) => {
  console.error('[startup] Unexpected failure:', error);
  process.exit(1);
});
