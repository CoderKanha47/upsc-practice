import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  insertQuestion,
  updateQuestion,
  verifyQuestion,
  markDuplicate,
  deleteQuestion,
  refreshCoverage,
  searchQuestions,
  validateQuestion,
} from '../src/services/questionService.js';

const BASE = {
  year: 2024,
  paper: 'GS1',
  question_number: 1,
  question_text: 'Which article of the Constitution deals with the Right to Constitutional Remedies?',
  options: [
    { key: 'A', text: 'Article 30' },
    { key: 'B', text: 'Article 32' },
    { key: 'C', text: 'Article 21' },
    { key: 'D', text: 'Article 19' },
  ],
  correct_answer: 'B',
  subject: 'Indian Polity',
  topic: 'Fundamental Rights',
  question_type: 'factual',
  source_type: 'OFFICIAL_PYQ',
};

test('valid question inserts with computed estimate and dup key', () => {
  const res = insertQuestion({ ...BASE, question_number: 1 });
  assert.equal(res.status, 'inserted');
  assert.ok(res.id);
  assert.equal(res.state, 'PARSED');
});

test('same year+paper+question_number is rejected as a duplicate', () => {
  const res = insertQuestion({ ...BASE, question_number: 1 });
  assert.equal(res.status, 'duplicate');
  assert.match(res.reason, /2024\|GS1\|1/);
});

test('same content from another source is flagged, not silently dropped', () => {
  const res = insertQuestion({
    ...BASE,
    question_number: 90,
    source_type: 'CUSTOM',
    source: 'alternate-source',
  });
  assert.equal(res.status, 'inserted');
  assert.ok(res.contentDuplicates.length >= 1);
});

test('structural validation rejects bad answers and short text', () => {
  const bad = validateQuestion({ ...BASE, correct_answer: 'Z' });
  assert.equal(bad.ok, false);
  const short = validateQuestion({ ...BASE, question_text: '??' });
  assert.equal(short.ok, false);
  const unkeyed = validateQuestion({ ...BASE, correct_answer: null });
  assert.equal(unkeyed.ok, true);
  assert.equal(unkeyed.state, 'REVIEW_REQUIRED');
});

test('question without an answer key lands in REVIEW_REQUIRED', () => {
  const res = insertQuestion({ ...BASE, question_number: 77, correct_answer: null });
  assert.equal(res.status, 'inserted');
  assert.equal(res.state, 'REVIEW_REQUIRED');
  assert.equal(res.flaggedForReview, true);
});

test('verify requires an answer key', () => {
  const res = insertQuestion({ ...BASE, question_number: 78, correct_answer: null });
  assert.throws(
    () => verifyQuestion(res.id),
    (err) => err.code === 'NO_ANSWER',
  );
});

test('verify promotes to VERIFIED and coverage updates', () => {
  const res = insertQuestion({ ...BASE, question_number: 79 });
  const v = verifyQuestion(res.id);
  assert.equal(v.validation_state, 'VERIFIED');
  refreshCoverage();
});

test('verified official PYQ text is locked; metadata stays editable', () => {
  const res = insertQuestion({ ...BASE, question_number: 80 });
  verifyQuestion(res.id);
  assert.throws(
    () => updateQuestion(res.id, { question_text: 'rewritten text' }),
    (err) => err.code === 'TEXT_LOCKED' && err.status === 423,
  );
  const ok = updateQuestion(res.id, { difficulty: 'hard', topic: 'Constitution' });
  assert.equal(ok.updated, true);
  assert.equal(ok.question.difficulty, 'hard');
});

test('verified official PYQs cannot be deleted, only marked duplicate', () => {
  const res = insertQuestion({ ...BASE, question_number: 81 });
  verifyQuestion(res.id);
  assert.throws(
    () => deleteQuestion(res.id),
    (err) => err.code === 'LOCKED',
  );
  const dup = markDuplicate(res.id);
  assert.equal(dup.is_duplicate, 1);
  // once marked duplicate it no longer collides
  const again = insertQuestion({ ...BASE, question_number: 81 });
  assert.equal(again.status, 'inserted');
});

test('coverage registry reports DATA_MISSING / PARTIAL honestly', () => {
  refreshCoverage();
  const found = searchQuestions({ year: 2024, paper: 'GS1' });
  assert.ok(found.total > 0);
  const stats = found.items[0];
  assert.ok(stats.year === 2024);
});
