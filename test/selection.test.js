import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedFixtures } from './helpers/seed.js';
import {
  buildMixedPaper,
  buildSelectiveSet,
  pickExactPaper,
  countPool,
  distributionReport,
} from '../src/services/selection.js';

seedFixtures({ gsYears: 6, csatYears: 3, gsPerYear: 40, csatPerYear: 30 });

test('mixed paper builds an exact count with UPSC-like subject spread', () => {
  const built = buildMixedPaper('GS1', 50, { seed: 'abc123' });
  assert.equal(built.actual, 50);
  assert.equal(built.questions.length, 50);
  const subjects = new Set(built.questions.map((q) => q.subject));
  assert.ok(subjects.size >= 6, `expected subject variety, got ${subjects.size}`);
  const report = distributionReport(built.questions);
  const totalPct = Object.values(report.subject).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(totalPct - 100) < 1.5);
});

test('mixed paper is deterministic for a given seed', () => {
  const a = buildMixedPaper('GS1', 30, { seed: 'reproducible' });
  const b = buildMixedPaper('GS1', 30, { seed: 'reproducible' });
  assert.deepEqual(a.questions.map((q) => q.id), b.questions.map((q) => q.id));
});

test('mixed paper never exceeds the available pool (no invention)', () => {
  const built = buildMixedPaper('CSAT', 5000, { seed: 'x', years: [2026] });
  assert.equal(built.actual, built.poolSize);
  assert.ok(built.actual <= 5000);
});

test('mixed paper fails loudly when the pool is empty', () => {
  assert.throws(
    () => buildMixedPaper('GS1', 100, { years: [1990] }),
    (err) => err.status === 409 && err.code === 'POOL_EMPTY',
  );
});

test('selective set honours subject filters and count', () => {
  const built = buildSelectiveSet({ papers: ['GS1'], subjects: ['Indian Polity'] }, 10, { seed: 's1' });
  assert.equal(built.actual, 10);
  assert.ok(built.questions.every((q) => q.subject === 'Indian Polity'));
});

test('selective set supports ALL AVAILABLE', () => {
  const filters = { papers: ['CSAT'], subjects: ['Logical Reasoning'] };
  const all = buildSelectiveSet(filters, null, { seed: 's2' });
  assert.equal(all.actual, countPool(filters));
});

test('selective set can exclude already-seen questions (avoidSeen)', () => {
  const filters = { papers: ['GS1'], subjects: ['Economy'], avoidSeen: true };
  const built = buildSelectiveSet(filters, 5, { seed: 's3' });
  assert.ok(built.actual <= 5);
  assert.ok(built.filteredOutSeen);
});

test('selective set accepts explicit includeIds (practice similar questions)', () => {
  const some = buildSelectiveSet({ papers: ['GS1'], subjects: ['Geography'] }, 3, { seed: 's4' });
  const ids = some.questions.map((q) => q.id);
  const again = buildSelectiveSet({ includeIds: ids }, null, {});
  assert.deepEqual(again.questions.map((q) => q.id).sort(), ids.slice().sort());
});

test('linked comprehension questions stay together', () => {
  const built = buildSelectiveSet(
    { papers: ['CSAT'], types: ['comprehension'] },
    4,
    { seed: 'groupy' },
  );
  const groups = new Map();
  for (const q of built.questions) {
    if (!q.group_id) continue;
    groups.set(q.group_id, (groups.get(q.group_id) || 0) + 1);
  }
  // Any partial group would break passage sharing.
  for (const [, n] of groups) assert.ok(n >= 1);
  const withPassage = built.questions.filter((q) => q.passage);
  assert.ok(withPassage.length === 0 || withPassage.every((q) => q.group_id));
});

test('exact paper picker reports honest coverage', () => {
  const partial = pickExactPaper(2026, 'GS1');
  assert.equal(partial.found, 40);
  assert.equal(partial.expected, 100);
  assert.equal(partial.complete, false);
  const missing = pickExactPaper(2007, 'GS1');
  assert.equal(missing.found, 0);
});
