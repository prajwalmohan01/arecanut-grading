'use strict';

/**
 * Multi-Model Inference Service for Grade C/D Detection
 * 
 * This service implements a fallback chain for Grade C/D predictions:
 * 1. Primary: Existing YOLO model (only supports A/B, so skipped for C/D)
 * 2. Secondary: Gemini image-level visual review (advisory only)
 * 3. Tertiary: Alternative models (Hugging Face, Roboflow, etc.)
 * 4. Final: Honest "unclassified" status
 * 
 * Grade A/B predictions are preserved from the existing inference service.
 */

const { config } = require('../config');
const { runInference } = require('./inferenceService');
const { analyzeImage } = require('./geminiService');
const { InferenceError } = require('./inferenceService');
const { DEFECT_KEYS, buildUnavailableDefects, buildGeminiDefectAnalysis } = require('./defectService');
const { selectAdvisoryFinalGrade, unavailableAdvisory } = require('./advisoryService');

class MultiModelInferenceError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'MultiModelInferenceError';
    this.statusCode = options.statusCode || 502;
    this.code = options.code || 'multi_model_failed';
    this.details = options.details || {};
  }
}

/**
 * Attempts to get Grade C/D predictions using alternative models.
 * Currently checks for Hugging Face inference API and Roboflow hosted models.
 * Returns null if no alternative model is configured or available.
 */
async function tryAlternativeGradeCDModel(imageBuffer, settings, policy) {
  const altConfig = settings.alternativeModels || {};
  
  // Try Hugging Face model if configured
  if (altConfig.huggingFace && altConfig.huggingFace.enabled && altConfig.huggingFace.apiToken) {
    try {
      const result = await callHuggingFaceModel(imageBuffer, altConfig.huggingFace);
      if (result && result.gradeCDetections) {
        return {
          source: 'huggingface',
          model: altConfig.huggingFace.modelId,
          gradeC: result.gradeCDetections.C || 0,
          gradeD: result.gradeCDetections.D || 0,
          detections: result.detections || [],
          confidence: result.confidence || null,
        };
      }
    } catch (error) {
      console.warn('[multiModel] Hugging Face model failed:', error.message);
    }
  }

  // Try Roboflow model if configured
  if (altConfig.roboflow && altConfig.roboflow.enabled && altConfig.roboflow.apiKey) {
    try {
      const result = await callRoboflowModel(imageBuffer, altConfig.roboflow);
      if (result && result.gradeCDetections) {
        return {
          source: 'roboflow',
          model: altConfig.roboflow.modelId,
          gradeC: result.gradeCDetections.C || 0,
          gradeD: result.gradeCDetections.D || 0,
          detections: result.detections || [],
          confidence: result.confidence || null,
        };
      }
    } catch (error) {
      console.warn('[multiModel] Roboflow model failed:', error.message);
    }
  }

  // Try custom endpoint if configured
  if (altConfig.customEndpoint && altConfig.customEndpoint.enabled && altConfig.customEndpoint.url) {
    try {
      const result = await callCustomEndpoint(imageBuffer, altConfig.customEndpoint);
      if (result && result.gradeCDetections) {
        return {
          source: 'custom',
          model: altConfig.customEndpoint.modelName || 'custom',
          gradeC: result.gradeCDetections.C || 0,
          gradeD: result.gradeCDetections.D || 0,
          detections: result.detections || [],
          confidence: result.confidence || null,
        };
      }
    } catch (error) {
      console.warn('[multiModel] Custom endpoint failed:', error.message);
    }
  }

  return null;
}

/**
 * Calls a Hugging Face inference API for image classification.
 * Expected model: image classification with labels including Grade C and Grade D.
 */
async function callHuggingFaceModel(imageBuffer, hfConfig) {
  const fetch = (await import('node-fetch')).default;
  
  const modelId = hfConfig.modelId || 'google/vit-base-patch16-224';
  const apiToken = hfConfig.apiToken;
  const url = `https://api-inference.huggingface.co/models/${modelId}`;
  
  // Convert buffer to base64 for the API
  const base64Image = imageBuffer.toString('base64');
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: base64Image,
      parameters: {
        candidate_labels: ['Grade A', 'Grade B', 'Grade C', 'Grade D'],
        multi_label: false,
      },
    }),
    timeout: hfConfig.timeoutMs || 30000,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Hugging Face API error (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  
  // Parse Hugging Face zero-shot classification response
  // Format: [{label: "Grade C", score: 0.85}, ...]
  if (Array.isArray(result)) {
    const gradeScores = {};
    result.forEach(item => {
      const match = item.label.match(/Grade\s*([ABCD])/i);
      if (match) {
        gradeScores[match[1].toUpperCase()] = item.score;
      }
    });

    // For classification, we return the top prediction
    // For detection, we'd need a different model type
    const topGrade = Object.entries(gradeScores).sort((a, b) => b[1] - a[1])[0];
    
    return {
      gradeCDetections: {
        C: topGrade && topGrade[0] === 'C' ? 1 : 0,
        D: topGrade && topGrade[0] === 'D' ? 1 : 0,
      },
      confidence: topGrade ? Math.round(topGrade[1] * 100) : null,
      detections: [],
    };
  }

  return null;
}

/**
 * Calls a Roboflow hosted model for object detection.
 * Expected model: object detection with classes GradeA, GradeB, GradeC, GradeD.
 */
async function callRoboflowModel(imageBuffer, rfConfig) {
  const fetch = (await import('node-fetch')).default;
  
  const modelId = rfConfig.modelId; // e.g., "workspace/project/version"
  const apiKey = rfConfig.apiKey;
  const url = `https://serverless.roboflow.com/${modelId}?api_key=${apiKey}`;
  
  const base64Image = imageBuffer.toString('base64');
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      image: base64Image,
      confidence: String(rfConfig.confidence || 0.25),
      overlap: String(rfConfig.overlap || 0.45),
    }),
    timeout: rfConfig.timeoutMs || 30000,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Roboflow API error (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  
  // Parse Roboflow detection response
  // Format: {predictions: [{class: "GradeC", confidence: 0.85, x: ..., y: ..., width: ..., height: ...}, ...]}
  if (result.predictions && Array.isArray(result.predictions)) {
    const gradeC = result.predictions.filter(p => p.class === 'GradeC' || p.class === 'Grade C').length;
    const gradeD = result.predictions.filter(p => p.class === 'GradeD' || p.class === 'Grade D').length;
    
    const detections = result.predictions
      .filter(p => ['GradeC', 'Grade D', 'Grade C', 'GradeD'].includes(p.class))
      .map((p, idx) => ({
        label: p.class,
        grade: p.class.replace('Grade', '').trim(),
        confidence: p.confidence,
        bbox: [
          p.x - p.width / 2,
          p.y - p.height / 2,
          p.x + p.width / 2,
          p.y + p.height / 2,
        ],
        nut_id: `Alt-Nut-${idx + 1}`,
      }));

    const confidences = result.predictions
      .filter(p => ['GradeC', 'Grade D', 'Grade C', 'GradeD'].includes(p.class))
      .map(p => p.confidence);
    
    return {
      gradeCDetections: { C: gradeC, D: gradeD },
      confidence: confidences.length ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) : null,
      detections,
    };
  }

  return null;
}

/**
 * Calls a custom inference endpoint.
 * Expected response format: {gradeCDetections: {C: number, D: number}, detections: [...], confidence: number}
 */
async function callCustomEndpoint(imageBuffer, endpointConfig) {
  const fetch = (await import('node-fetch')).default;
  
  const base64Image = imageBuffer.toString('base64');
  const url = endpointConfig.url;
  
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (endpointConfig.apiKey) {
    headers['Authorization'] = `Bearer ${endpointConfig.apiKey}`;
  }
  
  if (endpointConfig.customHeaders) {
    Object.assign(headers, endpointConfig.customHeaders);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      image: base64Image,
      ...(endpointConfig.extraParams || {}),
    }),
    timeout: endpointConfig.timeoutMs || 30000,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Custom endpoint error (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  
  // Validate expected response format
  if (result.gradeCDetections && typeof result.gradeCDetections === 'object') {
    return {
      gradeCDetections: {
        C: Number(result.gradeCDetections.C) || 0,
        D: Number(result.gradeCDetections.D) || 0,
      },
      confidence: result.confidence || null,
      detections: Array.isArray(result.detections) ? result.detections : [],
    };
  }

  return null;
}

/**
 * Runs the complete multi-model inference pipeline.
 * 
 * @param {string} imagePath - Path to the uploaded image
 * @param {Object} settings - System settings
 * @param {Object} policy - Active prediction policy
 * @returns {Object} Combined inference result with Grade A/B from primary model and Grade C/D from fallback
 */
async function runMultiModelInference(imagePath, settings, policy) {
  const fs = require('fs');
  
  // Step 1: Run primary inference (Grade A/B detector)
  const primaryInference = await runInference(imagePath);
  
  // Step 2: Check if Grade C/D are needed and supported by primary model
  const needsGradeCD = policy.enabledLetters.some(l => ['C', 'D'].includes(l));
  const primarySupportsCD = primaryInference.supportedGrades.some(l => ['C', 'D'].includes(l));
  
  let gradeC = primaryInference.gradeC || 0;
  let gradeD = primaryInference.gradeD || 0;
  let finalGrade = primaryInference.finalGrade;
  let finalGradeSource = primaryInference.finalGrade === 'Invalid' ? 'model' : 'model';
  let advisory = null;
  let alternativeModelResult = null;
  let cDModelUsed = 'none';
  let cDWarnings = [];
  
  // If primary model supports C/D, use its results
  if (primarySupportsCD) {
    cDModelUsed = 'primary_yolo';
    cDWarnings.push('Grade C/D predictions from primary YOLO model.');
  } 
  // If primary doesn't support C/D but they're enabled, use advisory/alternative models
  else if (needsGradeCD) {
    // Try Gemini advisory first (if enabled)
    if (policy.geminiEnabled) {
      try {
        const imageBuffer = fs.readFileSync(imagePath);
        const geminiResult = await analyzeImage(imageBuffer, {
          settings,
          context: {
            supportedGrades: primaryInference.supportedGrades.filter(l => policy.enabledLetters.includes(l)),
            enabledGrades: policy.enabledLetters,
            counts: {
              GradeA: primaryInference.gradeA,
              GradeB: primaryInference.gradeB,
            },
            includeDefects: policy.defectDetectionEnabled,
            requireDefects: policy.defectDetectionEnabled,
            enabledDefectCategories: policy.enabledDefectCategories,
          },
        });
        
        if (geminiResult.status === 'ok') {
          advisory = geminiResult;
          
          // Use Gemini advisory to determine Grade C/D presence
          const advisoryGrade = selectAdvisoryFinalGrade(geminiResult, policy.enabledLetters);
          if (advisoryGrade) {
            finalGrade = advisoryGrade;
            finalGradeSource = 'gemini_advisory';
            
            // For advisory, we can only indicate presence, not counts
            // We'll set counts based on visual presence evidence
            const presence = geminiResult.gradePresence;
            if (presence) {
              gradeC = presence.C?.visible ? 1 : 0; // Advisory indicates presence, not count
              gradeD = presence.D?.visible ? 1 : 0;
            }
            
            cDModelUsed = 'gemini_advisory';
            cDWarnings.push('Grade C/D assessment from Gemini visual advisory (image-level, not per-nut counts).');
          } else if (geminiResult.gradeHint !== 'unknown' && geminiResult.imageUsable) {
            // Gemini found no C/D presence but image is usable
            cDModelUsed = 'gemini_advisory';
            cDWarnings.push('Gemini advisory found no visible Grade C/D nuts in the image.');
          }
        }
      } catch (error) {
        console.warn('[multiModel] Gemini advisory failed:', error.message);
        cDWarnings.push(`Gemini advisory unavailable: ${error.message}`);
      }
    }
    
    // If Gemini didn't provide a C/D grade or failed, try alternative models
    if (cDModelUsed === 'none' || (cDModelUsed === 'gemini_advisory' && finalGradeSource !== 'gemini_advisory')) {
      try {
        const imageBuffer = fs.readFileSync(imagePath);
        alternativeModelResult = await tryAlternativeGradeCDModel(imageBuffer, settings, policy);
        
        if (alternativeModelResult) {
          gradeC = alternativeModelResult.gradeC;
          gradeD = alternativeModelResult.gradeD;
          
          // Determine final grade from alternative model
          if (gradeD > 0) {
            finalGrade = 'Grade D';
          } else if (gradeC > 0) {
            finalGrade = 'Grade C';
          } else if (primaryInference.total > 0) {
            // Fall back to primary model's grade if alternative found no C/D
            finalGrade = primaryInference.finalGrade;
            finalGradeSource = 'model';
          } else {
            finalGrade = 'Invalid';
            finalGradeSource = 'none';
          }
          
          if (alternativeModelResult.source !== 'none') {
            cDModelUsed = alternativeModelResult.source;
            cDWarnings.push(`Grade C/D predictions from alternative model (${alternativeModelResult.model}).`);
          }
        }
      } catch (error) {
        console.warn('[multiModel] Alternative model failed:', error.message);
        cDWarnings.push(`Alternative model unavailable: ${error.message}`);
      }
    }
    
    // If all models failed to provide C/D predictions
    if (cDModelUsed === 'none' || (cDModelUsed === 'gemini_advisory' && finalGradeSource !== 'gemini_advisory' && !alternativeModelResult)) {
      cDWarnings.push('No validated Grade C/D detector available. Grade C/D counts set to 0.');
      gradeC = 0;
      gradeD = 0;
      // Keep primary model's final grade if it has detections
      if (primaryInference.total === 0) {
        finalGrade = 'Invalid';
        finalGradeSource = 'none';
      }
    }
  }

  // Combine detections: primary A/B + alternative C/D
  const combinedDetections = [...(primaryInference.detections || [])];
  if (alternativeModelResult && alternativeModelResult.detections) {
    combinedDetections.push(...alternativeModelResult.detections);
  }

  // Calculate total from all grades
  const total = primaryInference.gradeA + primaryInference.gradeB + gradeC + gradeD;

  // Build warnings
  const warnings = [
    ...(primaryInference.warnings || []),
    ...cDWarnings,
  ];

  // Add warning if C/D enabled but no validated detector
  if (needsGradeCD && !primarySupportsCD) {
    warnings.push('Grade C/D enabled but no validated detector installed. Results are from advisory/alternative models only.');
  }

  return {
    ...primaryInference,
    gradeC: Math.round(gradeC),
    gradeD: Math.round(gradeD),
    total: Math.round(total),
    finalGrade,
    finalGradeSource,
    supportedGrades: primaryInference.supportedGrades,
    detections: combinedDetections,
    warnings,
    cDModelUsed,
    advisory,
    alternativeModelResult,
    // Include defects from Gemini advisory (image-level review)
    defects: advisory?.defects || null,
  };
}

module.exports = {
  runMultiModelInference,
  tryAlternativeGradeCDModel,
  callHuggingFaceModel,
  callRoboflowModel,
  callCustomEndpoint,
  MultiModelInferenceError,
};