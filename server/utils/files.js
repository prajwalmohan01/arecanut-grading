'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('../config');

const MIME_EXTENSION = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_MIME = new Set(Object.keys(MIME_EXTENSION));

function ensureUploadDir() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  return config.uploadDir;
}

/** Detect the real file type from magic bytes; never trust the client mimetype. */
function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', extension: '.jpg' };
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', extension: '.png' };
  }
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', extension: '.webp' };
  }
  return null;
}

function validateImageFile(filePath, declaredMime) {
  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    return { valid: false, error: 'Uploaded file is empty' };
  }
  if (stat.size > config.maxUploadMb * 1024 * 1024) {
    return {
      valid: false,
      error: `File exceeds the ${config.maxUploadMb}MB upload limit`,
    };
  }
  if (declaredMime && !ALLOWED_MIME.has(String(declaredMime).toLowerCase())) {
    return {
      valid: false,
      error: 'Unsupported file type. Use JPEG, PNG, or WebP.',
    };
  }

  const handle = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(16);
  fs.readSync(handle, header, 0, 16, 0);
  fs.closeSync(handle);

  const detected = detectImageType(header);
  if (!detected) {
    return {
      valid: false,
      error: 'File content is not a valid JPEG, PNG, or WebP image.',
    };
  }
  return { valid: true, ...detected };
}

function safeExtension(originalname) {
  const ext = path.extname(originalname || '').toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext) ? ext : '.jpg';
}

function storedImageName(mimetype, prefix = 'scan') {
  const extension = MIME_EXTENSION[String(mimetype).toLowerCase()] || '.jpg';
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${extension}`;
}

function saveBase64Image(base64, prefix = 'image') {
  if (typeof base64 !== 'string' || !base64.length) return null;
  const cleaned = base64.includes(',') ? base64.split(',').pop() : base64;
  let buffer;
  try {
    buffer = Buffer.from(cleaned, 'base64');
  } catch {
    return null;
  }
  if (buffer.length < 32) return null;
  const detected = detectImageType(buffer);
  if (!detected || detected.mime !== 'image/jpeg') return null;

  ensureUploadDir();
  const filename = `${prefix}_${Date.now()}_${crypto
    .randomBytes(6)
    .toString('hex')}.jpg`;
  fs.writeFileSync(path.join(config.uploadDir, filename), buffer);
  return filename;
}

/** Resolve a stored image inside the upload directory, blocking traversal. */
function resolveUploadFile(filename) {
  if (!filename || typeof filename !== 'string') return null;
  const base = path.basename(filename);
  if (base !== filename) return null;
  const resolved = path.resolve(config.uploadDir, base);
  const rootWithSeparator = path.resolve(config.uploadDir) + path.sep;
  if (!resolved.startsWith(rootWithSeparator)) return null;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  return resolved;
}

function unlinkUploadFile(filename) {
  const resolved = resolveUploadFile(filename);
  if (!resolved) return false;
  try {
    fs.unlinkSync(resolved);
    return true;
  } catch {
    return false;
  }
}

function removeTempFile(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Best-effort cleanup; never mask the original request error.
  }
}

module.exports = {
  ALLOWED_MIME,
  ensureUploadDir,
  detectImageType,
  validateImageFile,
  safeExtension,
  storedImageName,
  saveBase64Image,
  resolveUploadFile,
  unlinkUploadFile,
  removeTempFile,
};
