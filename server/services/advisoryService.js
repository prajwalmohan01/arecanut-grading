'use strict';

/**
 * Shared helpers for the Gemini image-level advisory.
 *
 * Gemini cannot produce a validated per-nut Grade C/D count. It can report
 * whether an example of a grade is visibly present. These helpers keep the
 * final-advisory decision explicit and testable instead of relying on a single
 * free-form hint.
 */

const GRADE_LETTERS = ['A', 'B', 'C', 'D'];
const ADVISORY_GRADES = ['C', 'D'];
// Lower quality is more severe. If several enabled advisory grades are
// visible, report the most severe one rather than implying a majority count.
const SEVERITY = { D: 4, C: 3, B: 2, A: 1 };

function gradeLetter(value) {
  const match = String(value || '').trim().match(/(?:^|\s)([abcd])$/i);
  return match ? match[1].toUpperCase() : null;
}

function cleanEvidence(value) {
  return String(value === undefined || value === null ? '' : value)
    .trim()
    .slice(0, 320);
}

function normaliseGradePresence(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const result = {};
  GRADE_LETTERS.forEach((letter) => {
    const item = raw[letter];
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    result[letter] = {
      visible: item.visible === true,
      evidence: cleanEvidence(item.evidence),
    };
  });
  return Object.keys(result).length ? result : null;
}

function visibleAdvisoryGrades(advisory, letters = GRADE_LETTERS) {
  const presence = normaliseGradePresence(advisory && advisory.gradePresence);
  if (!presence) return [];
  const allowed = Array.isArray(letters) ? letters : GRADE_LETTERS;
  return allowed.filter(
    (letter) => presence[letter] && presence[letter].visible
  );
}

/**
 * Select a Grade C/D advisory grade from visible per-grade evidence.
 *
 * New responses contain gradePresence for all four grades. A C/D grade is
 * selected only when that grade is visibly present, even if the overall
 * gradeHint names a dominant A/B grade. Older stored advisories without
 * gradePresence fall back to their C/D hint, preserving history.
 */
function selectAdvisoryFinalGrade(advisory, enabledLetters = ADVISORY_GRADES) {
  if (!advisory || advisory.status !== 'ok' || advisory.imageUsable === false) {
    return null;
  }
  const enabled = (Array.isArray(enabledLetters) ? enabledLetters : [])
    .map((letter) => String(letter).toUpperCase())
    .filter((letter) => ADVISORY_GRADES.includes(letter));
  if (!enabled.length) return null;

  const presence = normaliseGradePresence(advisory.gradePresence);
  if (presence) {
    const visible = enabled
      .filter((letter) => presence[letter] && presence[letter].visible)
      .sort((left, right) => (SEVERITY[right] || 0) - (SEVERITY[left] || 0));
    return visible.length ? `Grade ${visible[0]}` : null;
  }

  // Legacy advisory: no per-grade presence was stored. Only a C/D hint can be
  // used, and only when it is one of the enabled advisory grades.
  const hint = gradeLetter(advisory.gradeHint);
  return hint && enabled.includes(hint) ? `Grade ${hint}` : null;
}

function unavailableAdvisory(message, errorCode) {
  return {
    status: 'unavailable',
    advisoryOnly: true,
    analysisMethod: 'gemini_vision',
    imageUsable: false,
    gradeHint: null,
    gradePresence: null,
    reviewRecommendation: null,
    evidence: [],
    limitations: [
      message ||
        'Gemini-assisted Grade C/D review is unavailable. No Grade C/D count or grade was invented.',
    ],
    note:
      'Gemini-assisted Grade C/D review is unavailable. No Grade C/D count or grade was invented. This is not a validation result.',
    errorCode: errorCode || 'gemini_unavailable',
  };
}

module.exports = {
  GRADE_LETTERS,
  ADVISORY_GRADES,
  gradeLetter,
  normaliseGradePresence,
  visibleAdvisoryGrades,
  selectAdvisoryFinalGrade,
  unavailableAdvisory,
};
