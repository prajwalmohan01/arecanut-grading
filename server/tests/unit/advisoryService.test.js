'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  gradeLetter,
  normaliseGradePresence,
  visibleAdvisoryGrades,
  selectAdvisoryFinalGrade,
  unavailableAdvisory,
} = require('../../services/advisoryService');

function presence(overrides = {}) {
  return {
    A: { visible: false, evidence: 'No clean, uniform Grade A examples are visible.' },
    B: { visible: false, evidence: 'No clearly Grade B examples are visible.' },
    C: { visible: false, evidence: 'No clearly Grade C examples are visible.' },
    D: { visible: false, evidence: 'No clearly Grade D examples are visible.' },
    ...overrides,
  };
}

function advisory(overrides = {}) {
  return {
    status: 'ok',
    imageUsable: true,
    gradeHint: 'Grade B',
    gradePresence: presence(),
    ...overrides,
  };
}

test('gradeLetter reads explicit grade labels but not arbitrary text', () => {
  assert.equal(gradeLetter('Grade C'), 'C');
  assert.equal(gradeLetter('grade d'), 'D');
  assert.equal(gradeLetter('unknown'), null);
  assert.equal(gradeLetter('C grade'), null);
  assert.equal(gradeLetter(null), null);
});

test('normaliseGradePresence keeps only bounded, non-secret visual evidence', () => {
  const normalised = normaliseGradePresence(
    presence({
      C: { visible: true, evidence: '  Darker uneven surface colour.  ' },
      D: { visible: 'yes', evidence: 'ignored' },
    })
  );
  assert.equal(normalised.A.visible, false);
  assert.equal(normalised.C.visible, true);
  assert.equal(normalised.C.evidence, 'Darker uneven surface colour.');
  assert.equal(normalised.D.visible, false);
  assert.equal(normaliseGradePresence(null), null);
  assert.equal(normaliseGradePresence([1, 2, 3]), null);
});

test('visibleAdvisoryGrades reports enabled grades with visible evidence', () => {
  const visible = visibleAdvisoryGrades(
    advisory({
      gradePresence: presence({
        B: { visible: true, evidence: 'A few slightly uneven nuts are visible.' },
        D: { visible: true, evidence: 'Severely damaged nuts are visible.' },
      }),
    }),
    ['B', 'C']
  );
  assert.deepEqual(visible, ['B']);
});

test('C/D selection uses the most severe visible advisory grade', () => {
  const result = selectAdvisoryFinalGrade(
    advisory({
      gradeHint: 'Grade A',
      gradePresence: presence({
        C: { visible: true, evidence: 'Noticeable discolouration is visible.' },
        D: { visible: true, evidence: 'Substantial damage is visible.' },
      }),
    }),
    ['C', 'D']
  );
  assert.equal(result, 'Grade D');
});

test('C/D selection keeps visible C/D evidence when the overall hint is Grade A/B', () => {
  const result = selectAdvisoryFinalGrade(
    advisory({
      gradeHint: 'Grade A',
      gradePresence: presence({
        C: { visible: true, evidence: 'A visibly uneven, darker nut is present.' },
      }),
    }),
    ['C', 'D']
  );
  assert.equal(result, 'Grade C');
});

test('C/D selection does not fall back to a C/D hint when complete presence says no C/D', () => {
  const result = selectAdvisoryFinalGrade(
    advisory({
      gradeHint: 'Grade C',
      gradePresence: presence(),
    }),
    ['C', 'D']
  );
  assert.equal(result, null);
});

test('C/D selection honors only enabled advisory grades', () => {
  const result = selectAdvisoryFinalGrade(
    advisory({
      gradePresence: presence({
        C: { visible: true, evidence: 'Noticeable unevenness is visible.' },
        D: { visible: true, evidence: 'Substantial damage is visible.' },
      }),
    }),
    ['D']
  );
  assert.equal(result, 'Grade D');
  assert.equal(
    selectAdvisoryFinalGrade(
      advisory({
        gradePresence: presence({
          D: { visible: true, evidence: 'Substantial damage is visible.' },
        }),
      }),
      ['C']
    ),
    null
  );
});

test('legacy C/D advisory uses a C/D hint only when it is enabled', () => {
  const legacy = advisory({ gradeHint: 'Grade D' });
  delete legacy.gradePresence;
  assert.equal(selectAdvisoryFinalGrade(legacy, ['C', 'D']), 'Grade D');
  assert.equal(selectAdvisoryFinalGrade(legacy, ['C']), null);
});

test('unavailable or unusable advisory never produces a C/D grade', () => {
  assert.equal(
    selectAdvisoryFinalGrade(
      advisory({ status: 'unavailable', gradeHint: 'Grade C' }),
      ['C', 'D']
    ),
    null
  );
  assert.equal(
    selectAdvisoryFinalGrade(
      advisory({ imageUsable: false, gradeHint: 'Grade D' }),
      ['C', 'D']
    ),
    null
  );
  const unavailable = unavailableAdvisory('Gemini timed out.', 'all_keys_failed');
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.gradeHint, null);
  assert.equal(unavailable.gradePresence, null);
  assert.match(unavailable.note, /not a validation result/i);
});
