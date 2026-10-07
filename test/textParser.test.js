import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePaperText } from '../src/import/parsers/textParser.js';

const SAMPLE = `Union Public Service Commission
Civil Services (Preliminary) Examination, 2024
General Studies Paper I
DO NOT OPEN THIS BOOKLET UNTIL YOU ARE TOLD TO DO SO

1. How many delimitation Commissions have been constituted by the Government of India till December 2023?
(a) One
(b) Two
(c) Three
(d) Four

2. Consider the following statements:
1. It is a constitutional body.
2. It consists of the Chief Election Commissioner and other Election Commissioners.
Which of the statements given above is/are correct?
(a) 1 only
(b) 2 only
(c) Both 1 and 2
(d) Neither 1 nor 2

3. Which one of the following is the largest State of India in terms of area?
(A) Maharashtra
(B) Rajasthan
(C) Madhya Pradesh
(D) Uttar Pradesh
Answer: (b)

Passage
Read the following passage and answer the question that follows.
Forests are vital for ecological balance. They regulate the water cycle, conserve soil and support biodiversity.

4. The passage mainly highlights the importance of
(a) forests
(b) industries
(c) urbanisation
(d) mining
`;

test('parses questions, options and sequence correctly', () => {
  const { questions, warnings } = parsePaperText(SAMPLE, { paper: 'GS1', year: 2024 });
  assert.equal(questions.length, 4);
  assert.deepEqual(questions.map((q) => q.question_number), [1, 2, 3, 4]);

  const q1 = questions[0];
  assert.match(q1.question_text, /delimitation Commissions/);
  assert.equal(q1.options.length, 4);
  assert.deepEqual(q1.options.map((o) => o.key), ['A', 'B', 'C', 'D']);
  assert.equal(q1.options[0].text, 'One');
  assert.equal(q1.year, 2024);
  assert.equal(q1.source_type, 'OFFICIAL_PYQ');
  void warnings;
});

test('statement numbering inside a question is not mistaken for a new question', () => {
  const { questions } = parsePaperText(SAMPLE, { paper: 'GS1', year: 2024 });
  const q2 = questions[1];
  assert.match(q2.question_text, /Consider the following statements/);
  assert.match(q2.question_text, /constitutional body/);
  assert.match(q2.question_text, /Chief Election Commissioner/);
  assert.match(q2.question_text, /Which of the statements given above/);
  assert.equal(q2.options.length, 4);
});

test('inline answer markers are captured', () => {
  const { questions } = parsePaperText(SAMPLE, { paper: 'GS1', year: 2024 });
  assert.equal(questions[2].correct_answer, 'B');
});

test('passage is attached and shared as a group', () => {
  const { questions } = parsePaperText(SAMPLE, { paper: 'CSAT', year: 2024 });
  const q4 = questions[3];
  assert.match(q4.passage || '', /Forests are vital/);
  assert.ok(q4.group_id);
  assert.equal(q4.group_index, 1);
});

test('noise lines (instructions, page numbers) are dropped', () => {
  const text = `12\n1. First question text here?\n(a) one\n(b) two\n(c) three\n(d) four\n`;
  const { questions } = parsePaperText(text, { paper: 'GS1' });
  assert.equal(questions.length, 1);
  assert.equal(questions[0].question_number, 1);
});

test('missing options are flagged, not guessed', () => {
  const text = `1. Question without any options at all?\n`;
  const { questions, warnings } = parsePaperText(text, { paper: 'GS1' });
  assert.equal(questions.length, 1);
  assert.equal(questions[0].options.length, 0);
  assert.ok(warnings.some((w) => /option/.test(w)));
});

test('empty / scanned text yields no invented questions', () => {
  const { questions, warnings } = parsePaperText('   \n\n  ', { paper: 'GS1' });
  assert.equal(questions.length, 0);
  assert.ok(warnings.length > 0);
});
