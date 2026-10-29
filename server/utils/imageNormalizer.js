'use strict';

const sharp = require('sharp');

/**
 * PDFKit only embeds JPEG and PNG reliably. This converts WebP, animated
 * images, CMYK JPEGs, and images with transparency to a bounded, upright JPEG.
 * EXIF orientation is applied by sharp's rotate() before resizing.
 */
async function normalizeForPdf(buffer, options = {}) {
  if (!buffer || !buffer.length) return null;
  const maxDimension = Math.min(
    Math.max(Number(options.maxDimension) || 1800, 320),
    5000
  );
  const quality = Math.min(Math.max(Number(options.quality) || 86, 60), 95);

  const pipeline = sharp(buffer, { failOn: 'none', animated: false })
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality, mozjpeg: true });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    mime: 'image/jpeg',
    width: info.width,
    height: info.height,
  };
}

async function normalizeForGemini(buffer, options = {}) {
  if (!buffer || !buffer.length) return null;
  const maxDimension = Math.min(
    Math.max(Number(options.maxDimension) || 1280, 256),
    4096
  );
  const { data, info } = await sharp(buffer, { failOn: 'none', animated: false })
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    mime: 'image/jpeg',
    width: info.width,
    height: info.height,
    base64: data.toString('base64'),
  };
}

async function imageMetadata(buffer) {
  if (!buffer || !buffer.length) return null;
  try {
    const metadata = await sharp(buffer, { failOn: 'none' }).metadata();
    return {
      format: metadata.format,
      width: metadata.width || null,
      height: metadata.height || null,
      orientation: metadata.orientation || null,
      hasAlpha: Boolean(metadata.hasAlpha),
    };
  } catch {
    return null;
  }
}

module.exports = {
  normalizeForPdf,
  normalizeForGemini,
  imageMetadata,
};
