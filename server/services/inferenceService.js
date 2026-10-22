'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { config } = require('../config');

class InferenceError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = 'InferenceError';
    this.statusCode = statusCode;
  }
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normaliseResult(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new InferenceError('The ML service returned an invalid response.');
  }
  if (raw.error) {
    throw new InferenceError(String(raw.error));
  }

  const report = raw.report && typeof raw.report === 'object' ? raw.report : {};
  const gradeCounts = (report.grade_counts && typeof report.grade_counts === 'object')
    ? report.grade_counts
    : {};
  const gradeA = asNumber(raw.grade_a ?? gradeCounts.A);
  const gradeB = asNumber(raw.grade_b ?? gradeCounts.B);
  const gradeC = asNumber(raw.grade_c ?? gradeCounts.C);
  const gradeD = asNumber(raw.grade_d ?? gradeCounts.D);
  const total = asNumber(
    raw.total,
    gradeA + gradeB + gradeC + gradeD
  );
  const finalGrade = raw.final_grade || report.final_grade;

  const SUPPORTED_GRADES = ['Grade A', 'Grade B', 'Grade C', 'Grade D', 'Invalid'];
  if (!SUPPORTED_GRADES.includes(finalGrade)) {
    throw new InferenceError(
      `The model returned an unsupported grade ("${finalGrade}"). Expected one of: ${SUPPORTED_GRADES.join(
        ', '
      )}.`
    );
  }
  if (gradeA < 0 || gradeB < 0 || gradeC < 0 || gradeD < 0) {
    throw new InferenceError('The ML service returned negative detection counts.');
  }

  // Grades supported by the checkpoint, as reported by the ML service.
  const supportedGrades = Array.isArray(report.supported_grades)
    ? report.supported_grades.map((value) => String(value).toUpperCase())
    : Array.from(
        new Set(
          (Array.isArray(report.detections) ? report.detections : [])
            .map((detection) => detection && detection.grade)
            .filter(Boolean)
            .map((value) => String(value).toUpperCase())
        )
      );

  const annotatedFromBase64 =
    raw.annotated_image_base64 ||
    (raw.image_type === 'base64' ? raw.annotated_image : null);
  let annotatedFromPath = null;
  if (
    !annotatedFromBase64 &&
    raw.annotated_image &&
    typeof raw.annotated_image === 'string' &&
    fs.existsSync(raw.annotated_image)
  ) {
    annotatedFromPath = raw.annotated_image;
  }

  return {
    gradeA: Math.round(gradeA),
    gradeB: Math.round(gradeB),
    gradeC: Math.round(gradeC),
    gradeD: Math.round(gradeD),
    total: Math.round(total),
    finalGrade,
    supportedGrades,
    confidence:
      report.confidence_pct === null || report.confidence_pct === undefined
        ? null
        : Math.max(0, Math.min(100, asNumber(report.confidence_pct))),
    qualityScore:
      report.quality_score === null || report.quality_score === undefined
        ? null
        : Math.max(0, Math.min(100, asNumber(report.quality_score))),
    qualityMethod: report.quality_method || null,
    confidenceMethod: report.confidence_method || null,
    detections: Array.isArray(report.detections) ? report.detections : [],
    measurements: report.measurements || null,
    defects: report.defects || {
      supported: false,
      reason: 'Defect detection is not supported by the preserved model.',
      categories: [],
      items: [],
    },
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
    model: raw.model || {},
    image: raw.image || {},
    processingMs: asNumber(raw.processing_ms, null),
    annotatedBase64: annotatedFromBase64,
    annotatedPath: annotatedFromPath,
    processedBase64: raw.processed_image_base64 || null,
  };
}

async function callMlHttp(imagePath) {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(imagePath), {
    filename: path.basename(imagePath),
  });

  try {
    const response = await axios.post(`${config.mlServiceUrl}/predict`, formData, {
      headers: formData.getHeaders(),
      timeout: config.mlTimeoutMs,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    return response.data;
  } catch (error) {
    const detail =
      (error.response && error.response.data && error.response.data.error) ||
      error.message;
    throw new InferenceError(`ML service request failed: ${detail}`);
  }
}

function callMlLocal(imagePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(config.pythonScriptPath)) {
      return reject(
        new InferenceError(
          `Local inference script not found at ${config.pythonScriptPath}.`
        )
      );
    }

    const child = spawn(config.pythonPath, [config.pythonScriptPath, imagePath], {
      windowsHide: true,
      env: {
        ...process.env,
        MODEL_PATH: config.modelPath,
        PYTHONIOENCODING: 'utf-8',
      },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(
          new InferenceError(
            `Local inference timed out after ${Math.round(
              config.mlTimeoutMs / 1000
            )}s.`
          )
        );
      }
    }, config.mlTimeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 60 * 1024 * 1024) {
        child.kill();
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new InferenceError(
          `Cannot start Python ("${config.pythonPath}"): ${error.message}`
        )
      );
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const line = stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter((value) => value.startsWith('{'))
        .pop();

      if (!line) {
        return reject(
          new InferenceError(
            `Local inference failed (exit ${code}). ${
              stderr.trim().split(/\r?\n/).pop() || 'No output from Python.'
            }`
          )
        );
      }

      try {
        const parsed = JSON.parse(line);
        if (parsed.error) {
          return reject(new InferenceError(String(parsed.error)));
        }
        resolve(parsed);
      } catch {
        reject(new InferenceError('Could not parse local inference JSON output.'));
      }
    });
  });
}

async function runInference(imagePath) {
  const raw =
    config.mlTransport === 'http'
      ? await callMlHttp(imagePath)
      : await callMlLocal(imagePath);
  return normaliseResult(raw);
}

module.exports = { runInference, normaliseResult, InferenceError };
