'use strict';

const multer = require('multer');
const { config } = require('../config');

function notFound(req, res) {
  res.status(404).json({ error: 'Route not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
  let status = error.statusCode || error.status || 500;
  let message = error.message || 'Internal server error';

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      message = `File exceeds the ${config.maxUploadMb}MB upload limit.`;
    } else if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      status = 400;
      message = 'Unexpected file field. Upload a single image.';
    } else {
      status = 400;
      message = `Upload error: ${error.message}`;
    }
  } else if (error.name === 'ValidationError') {
    status = 400;
    message = Object.values(error.errors)
      .map((item) => item.message)
      .join(' ');
  } else if (error.name === 'CastError') {
    status = 400;
    message = 'Invalid identifier supplied.';
  } else if (error.code === 11000) {
    status = 409;
    message = 'A record with these details already exists.';
  }

  if (status >= 500) {
    console.error(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${status}:`,
      error.message
    );
    if (!config.isProduction) console.error(error.stack);
  }

  if (res.headersSent) return next(error);

  const exposeMessage =
    status < 500 || error.expose === true || !config.isProduction;
  return res.status(status).json({
    error: exposeMessage ? message : 'Internal server error',
  });
}

module.exports = { notFound, errorHandler };
