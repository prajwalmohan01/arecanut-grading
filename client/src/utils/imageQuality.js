const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_BYTES = 10 * 1024 * 1024;

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      URL.revokeObjectURL(url);
      resolve({ source: image, width, height });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The selected file could not be opened as an image.'));
    };
    image.src = url;
  });
}

async function loadSource(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, bitmap: true };
    } catch {
      // Fall back to an image element for browsers/files that createImageBitmap cannot decode.
    }
  }
  return loadImageElement(file);
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Browser-side upload usability check.
 * It measures resolution, exposure and a Laplacian-variance blur heuristic.
 * It does not evaluate arecanut quality and it never assigns a grade.
 */
export async function inspectImageFile(file) {
  if (!file) throw new Error('Choose an image first.');
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new Error('Use a JPEG, PNG, or WebP image.');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('The image is larger than the 10 MB upload limit.');
  }

  const { source, width, height, bitmap } = await loadSource(file);
  const maxSide = 360;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser could not inspect the image.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);

  let brightnessSum = 0;
  const gray = new Float32Array(canvas.width * canvas.height);
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    brightnessSum += value;
    gray[index / 4] = value;
  }
  const brightness = brightnessSum / (data.length / 4 || 1);

  let lapSum = 0;
  let lapCount = 0;
  for (let y = 1; y < canvas.height - 1; y += 1) {
    for (let x = 1; x < canvas.width - 1; x += 1) {
      const index = y * canvas.width + x;
      const lap =
        4 * gray[index] -
        gray[index - 1] -
        gray[index + 1] -
        gray[index - canvas.width] -
        gray[index + canvas.width];
      lapSum += lap * lap;
      lapCount += 1;
    }
  }
  const blurScore = lapCount ? lapSum / lapCount : 0;

  const warnings = [];
  const minSide = Math.min(width, height);
  if (minSide < 800) {
    warnings.push('Resolution is below 800 px on one side. Use a higher-resolution photo if possible.');
  }
  if ((width * height) / 1_000_000 < 0.6) {
    warnings.push('The image is under 0.6 megapixels. Fine detail may be limited.');
  }
  if (brightness < 45) {
    warnings.push('The image may be too dark. More even lighting can help.');
  } else if (brightness > 220) {
    warnings.push('The image may be overexposed. Avoid strong direct light or glare.');
  }
  if (blurScore < 35) {
    warnings.push('The image may be too blurry. Hold the camera steady and refocus.');
  }
  const aspect = width / height;
  if (aspect > 3 || aspect < 1 / 3) {
    warnings.push('The image is unusually wide or tall. Make sure the full sample is visible.');
  }

  if (bitmap && typeof source.close === 'function') source.close();

  return {
    checked: true,
    width,
    height,
    brightness: round(brightness),
    blurScore: round(blurScore),
    warnings,
    source: 'browser-canvas',
  };
}

export function qualityTone(quality) {
  if (!quality?.checked) return 'neutral';
  return quality.warnings?.length ? 'b' : 'a';
}

export function qualitySummary(quality) {
  if (!quality?.checked) return 'Upload check not completed';
  if (quality.warnings?.length) {
    return `${quality.warnings.length} advisory upload warning${
      quality.warnings.length === 1 ? '' : 's'
    }`;
  }
  return 'No upload warnings detected';
}

export function qualityMetric(value, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`;
}
