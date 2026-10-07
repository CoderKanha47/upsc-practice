import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSubmission, csatQualification, gsCutoffEstimate } from '../src/services/scoring.js';

function qs(n, correctAnswers) {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${i + 1}`,
    question_number: i + 1,
    correct_answer: correctAnswers[i] || 'A',
    marks: 2,
    negative_marks: 2 / 3,
  }));
}

test('GS scoring: correct +2, wrong −2/3, unattempted 0', () => {
  const questions = qs(4, ['A', 'B', 'C', 'D']);
  const answers = [
    { question_id: 'q1', answer: 'A', time_spent_seconds: 40 },
    { question_id: 'q2', answer: 'C', time_spent_seconds: 50 }, // wrong (correct B)
    { question_id: 'q3', answer: 'C', time_spent_seconds: 30 },
  ];
  const r = scoreSubmission('GS1', questions, answers);
  assert.equal(r.attempted, 3);
  assert.equal(r.correct, 2);
  assert.equal(r.incorrect, 1);
  assert.equal(r.unattempted, 1);
  assert.ok(Math.abs(r.marksObtained - (4 - 2 / 3)) < 0.01);
  assert.equal(r.accuracy, 66.67);
  assert.equal(r.timeUsedSeconds, 120);
});

test('CSAT scoring uses 2.5 marks and 0.833 negative per question', () => {
  const questions = [1, 2, 3, 4].map((n) => ({
    id: `c${n}`,
    question_number: n,
    correct_answer: 'A',
    marks: 2.5,
    negative_marks: 2.5 / 3,
  }));
  const answers = [
    { question_id: 'c1', answer: 'A', time_spent_seconds: 10 },
    { question_id: 'c2', answer: 'B', time_spent_seconds: 10 },
    { question_id: 'c3', answer: null, time_spent_seconds: 10 },
    { question_id: 'c4', answer: 'A', time_spent_seconds: 10 },
  ];
  const r = scoreSubmission('CSAT', questions, answers);
  assert.equal(r.correct, 2);
  assert.equal(r.incorrect, 1);
  assert.equal(r.unattempted, 1);
  assert.ok(Math.abs(r.negativeMarks - 2.5 / 3) < 0.01);
});

test('CSAT qualifying status at 33% (66/200)', () => {
  assert.equal(csatQualification(66).status, 'QUALIFIED');
  assert.equal(csatQualification(65.99).status, 'NOT QUALIFIED');
  assert.equal(csatQualification(150).status, 'QUALIFIED');
  assert.equal(csatQualification(10).thresholdMarks, 66);
});

test('GS cutoff estimate is labelled as an indicative range', () => {
  const low = gsCutoffEstimate(20);
  const mid = gsCutoffEstimate(80);
  const high = gsCutoffEstimate(180);
  assert.equal(low.position, 'BELOW INDICATIVE RANGE');
  assert.equal(mid.position, 'WITHIN INDICATIVE RANGE');
  assert.equal(high.position, 'ABOVE INDICATIVE RANGE');
  assert.match(low.disclaimer, /never guarantees qualification/i);
});

test('no answers = zero score, no negatives', () => {
  const r = scoreSubmission('GS1', qs(3, []), []);
  assert.equal(r.marksObtained, 0);
  assert.equal(r.unattempted, 3);
  assert.equal(r.accuracy, 0);
});
