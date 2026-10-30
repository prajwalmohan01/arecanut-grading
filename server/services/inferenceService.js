'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
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
    // The bundled detector has no defect classes. Gemini defect findings are
    // added by the prediction route only when the administrator enables them.
    defects:
      report.defects && typeof report.defects === 'object' ? report.defects : null,
    inference: report.inference || null,
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

function workerEnv() {
  return {
    ...process.env,
    MODEL_PATH: config.modelPath,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
  };
}

const workerState = {
  child: null,
  reader: null,
  starting: null,
  ready: false,
  pending: new Map(),
  nextId: 1,
  lastError: null,
  stderrTail: '',
  stopping: false,
};

function workerUnavailable(message) {
  const error = new InferenceError(message);
  error.workerUnavailable = true;
  return error;
}

function rejectPending(error) {
  for (const [, pending] of workerState.pending) {
    pending.reject(error);
  }
  workerState.pending.clear();
}

function resetWorker(child) {
  // A timed-out worker can exit after a replacement has already started. Only
  // clear state when the finishing child is still the current one.
  if (child && workerState.child !== child) return false;
  const { reader } = workerState;
  workerState.ready = false;
  workerState.child = null;
  workerState.reader = null;
  if (reader) {
    try {
      reader.close();
    } catch {
      /* already closed */
    }
  }
  return true;
}

function startLocalWorker() {
  if (workerState.ready && workerState.child) {
    return Promise.resolve();
  }
  if (workerState.starting) {
    return workerState.starting;
  }
  if (!config.useInferenceWorker) {
    return Promise.reject(workerUnavailable('Persistent inference worker is disabled.'));
  }
  if (!fs.existsSync(config.inferenceWorkerPath)) {
    return Promise.reject(
      workerUnavailable(
        `Inference worker script not found at ${config.inferenceWorkerPath}.`
      )
    );
  }

  workerState.starting = new Promise((resolve, reject) => {
    let settled = false;
    let child;
    try {
      child = spawn(
        config.pythonPath,
        ['-u', config.inferenceWorkerPath],
        { windowsHide: true, env: workerEnv() }
      );
    } catch (error) {
      reject(workerUnavailable(`Cannot start Python worker: ${error.message}`));
      return;
    }

    workerState.child = child;
    workerState.ready = false;
    workerState.stopping = false;
    workerState.stderrTail = '';

    const fail = (error) => {
      if (settled) return;
      settled = true;
      workerState.lastError = error.message;
      clearTimeout(startTimer);
      reject(error);
    };

    const startTimer = setTimeout(() => {
      fail(
        workerUnavailable(
          `Inference worker did not become ready within ${Math.round(
            config.workerStartupTimeoutMs / 1000
          )}s.`
        )
      );
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }, config.workerStartupTimeoutMs);

    workerState.reader = readline.createInterface({ input: child.stdout });

    workerState.reader.on('line', (line) => {
      const text = line.trim();
      if (!text) return;
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        // Ultralytics or another dependency may print non-JSON diagnostics to
        // stdout despite verbose=False. They are not protocol messages.
        return;
      }

      if (message.type === 'ready') {
        if (message.ok) {
          workerState.ready = true;
          workerState.lastError = null;
          settled = true;
          clearTimeout(startTimer);
          resolve();
        } else {
          fail(
            workerUnavailable(
              `Inference worker failed to load the model: ${
                message.error || 'unknown error'
              }`
            )
          );
        }
        return;
      }

      const pending = workerState.pending.get(message.id);
      if (!pending) return;
      workerState.pending.delete(message.id);
      if (message.ok) {
        pending.resolve(message.result);
      } else {
        pending.reject(new InferenceError(String(message.error || 'Inference failed.')));
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      workerState.stderrTail = (workerState.stderrTail + text).slice(-4000);
    });

    child.on('error', (error) => {
      fail(workerUnavailable(`Cannot start Python worker: ${error.message}`));
    });

    child.on('close', (code) => {
      if (workerState.child !== child) return; // stale child; a replacement owns state
      const wasReady = workerState.ready;
      resetWorker(child);
      const detail = workerState.stderrTail.trim().split(/\r?\n/).pop();
      const reason = workerState.stopping
        ? 'Inference worker stopped.'
        : `Inference worker exited (code ${code}).${detail ? ` ${detail}` : ''}`;
      if (!wasReady) {
        fail(workerUnavailable(reason));
      }
      rejectPending(workerUnavailable(reason));
    });
  }).finally(() => {
    workerState.starting = null;
  });

  return workerState.starting;
}

function requestFromWorker(imagePath) {
  return new Promise((resolve, reject) => {
    const child = workerState.child;
    if (!child || !workerState.ready) {
      reject(workerUnavailable('Inference worker is not running.'));
      return;
    }

    const id = String(workerState.nextId++);
    const timer = setTimeout(() => {
      workerState.pending.delete(id);
      workerState.ready = false;
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      reject(
        workerUnavailable(
          `Inference worker timed out after ${Math.round(
            config.mlTimeoutMs / 1000
          )}s and was restarted.`
        )
      );
    }, config.mlTimeoutMs);

    workerState.pending.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });

    const payload = `${JSON.stringify({ id, action: 'predict', image: imagePath })}\n`;
    child.stdin.write(payload, 'utf8', (error) => {
      if (!error) return;
      workerState.pending.delete(id);
      clearTimeout(timer);
      reject(workerUnavailable(`Cannot send image to the inference worker: ${error.message}`));
    });
  });
}

// The worker handles one request at a time; serialise at the caller so two
// uploads never interleave their JSON lines.
let workerQueue = Promise.resolve();

function callMlWorker(imagePath) {
  const job = workerQueue.then(async () => {
    await startLocalWorker();
    return requestFromWorker(imagePath);
  });
  workerQueue = job.catch(() => {});
  return job;
}

async function warmupLocalInference() {
  if (config.mlTransport !== 'local' || !config.useInferenceWorker) {
    return { started: false, reason: 'worker disabled' };
  }
  const startedAt = Date.now();
  await startLocalWorker();
  return { started: true, startupMs: Date.now() - startedAt };
}

async function shutdownLocalInference() {
  const { child } = workerState;
  if (!child) return;
  workerState.stopping = true;
  try {
    child.stdin.write(`${JSON.stringify({ action: 'shutdown' })}\n`, 'utf8');
  } catch {
    /* fall through to kill */
  }
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      resolve();
    }, 3000);
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

let workerFallbackWarned = false;

async function runInference(imagePath) {
  let raw;
  if (config.mlTransport === 'http') {
    raw = await callMlHttp(imagePath);
  } else if (config.useInferenceWorker) {
    try {
      raw = await callMlWorker(imagePath);
    } catch (error) {
      if (!error.workerUnavailable) throw error;
      if (!workerFallbackWarned) {
        workerFallbackWarned = true;
        console.warn(
          `[model] Persistent worker unavailable, falling back to per-request CLI: ${error.message}`
        );
      }
      raw = await callMlLocal(imagePath);
    }
  } else {
    raw = await callMlLocal(imagePath);
  }
  return normaliseResult(raw);
}

module.exports = {
  runInference,
  normaliseResult,
  InferenceError,
  warmupLocalInference,
  shutdownLocalInference,
  startLocalWorker,
  callMlWorker,
  workerState,
};
