import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateSeconds,
  previewTiming,
  formatDuration,
  questionEstimate,
} from '../src/services/timing.js';

test('easy factual GS question gets the shortest estimate', () => {
  const easy = estimateSeconds({ question_type: 'factual', difficulty: 'easy', paper: 'GS1' });
  const hard = estimateSeconds({ question_type: 'statement_based', difficulty: 'hard', paper: 'GS1' });
  assert.ok(easy < hard);
  assert.ok(easy >= 30 && hard <= 600);
});

test('CSAT quantitative questions run longer than GS factual questions', () => {
  const gs = estimateSeconds({ question_type: 'factual', difficulty: 'medium', paper: 'GS1' });
  const csatQuant = estimateSeconds({ question_type: 'quantitative', difficulty: 'medium', paper: 'CSAT' });
  assert.ok(csatQuant > gs);
});

test('comprehension includes passage reading time, shared across the group', () => {
  const words = 150;
  const passage = 'word '.repeat(words).trim();
  const solo = estimateSeconds({ question_type: 'comprehension', difficulty: 'medium', paper: 'CSAT', passage, groupSize: 1 });
  const shared = estimateSeconds({ question_type: 'comprehension', difficulty: 'medium', paper: 'CSAT', passage, groupSize: 5 });
  const noPassage = estimateSeconds({ question_type: 'comprehension', difficulty: 'medium', paper: 'CSAT' });
  assert.ok(solo > noPassage);
  assert.ok(shared > noPassage);
  assert.ok(shared < solo);
});

test('preview timing = Σ(base) + buffer × count (default buffer 15s)', () => {
  const questions = [
    { question_type: 'factual', difficulty: 'easy', paper: 'GS1', estimated_time_seconds: 40 },
    { question_type: 'statement_based', difficulty: 'hard', paper: 'GS1', estimated_time_seconds: 110 },
    { question_type: 'conceptual', difficulty: 'medium', paper: 'GS1', estimated_time_seconds: 75 },
  ];
  const preview = previewTiming(questions, 15);
  assert.equal(preview.count, 3);
  assert.equal(preview.baseSeconds, 225);
  assert.equal(preview.bufferTotalSeconds, 45);
  assert.equal(preview.totalSeconds, 270);
  assert.equal(preview.formatted.base, '3m 45s');
  assert.equal(preview.formatted.buffer, '45s');
  assert.equal(preview.formatted.total, '4m 30s');
});

test('stored estimate wins over the model', () => {
  assert.equal(questionEstimate({ estimated_time_seconds: 99 }), 99);
  assert.ok(questionEstimate({}) > 0);
});

test('formatDuration renders readable values', () => {
  assert.equal(formatDuration(23 * 60 + 40), '23m 40s');
  assert.equal(formatDuration(3600 + 65), '1h 01m 05s');
  assert.equal(formatDuration(45), '45s');
});
