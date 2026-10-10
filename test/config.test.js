import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import CONFIG, { getPaper, yearRange, paperList, EXAMS } from '../config/exam.config.js';

test('central config: paper structure matches UPSC prelims', () => {
  const gs = getPaper('GS1');
  const csat = getPaper('CSAT');
  assert.equal(gs.questionCount, 100);
  assert.equal(gs.durationMinutes, 120);
  assert.equal(gs.marks, 200);
  assert.equal(gs.qualifying, false);
  assert.equal(csat.questionCount, 80);
  assert.equal(csat.durationMinutes, 120);
  assert.equal(csat.marks, 200);
  assert.equal(csat.qualifying, true);
  assert.equal(csat.qualifyingPercentage, 33);
});

test('central config: negative marking derives from one-third rule', () => {
  const gs = getPaper('GS1');
  const csat = getPaper('CSAT');
  assert.ok(Math.abs(gs.marksPerQuestion * gs.negativeFraction - 2 / 3) < 1e-9);
  assert.ok(Math.abs(csat.marksPerQuestion * csat.negativeFraction - 2.5 / 3) < 1e-9);
});

test('central config: PYQ year range covers 2007–2026', () => {
  const years = yearRange();
  assert.equal(years[0], 2026);
  assert.equal(years[years.length - 1], 2007);
  assert.equal(years.length, 20);
});

test('central config: selective buffer is configurable with 10–25s design range', () => {
  assert.equal(CONFIG.SELECTIVE.BUFFER_SECONDS, 15);
  assert.ok(CONFIG.SELECTIVE.MIN_BUFFER_SECONDS >= 10);
  assert.ok(CONFIG.SELECTIVE.MAX_BUFFER_SECONDS <= 25);
  assert.ok(CONFIG.SELECTIVE.PRESET_COUNTS.includes(5));
  assert.ok(CONFIG.SELECTIVE.PRESET_COUNTS.includes(100));
});

test('central config: full paper is Sunday-only', () => {
  assert.equal(CONFIG.FULL_PAPER.ALLOWED_DAY, 0);
  assert.equal(CONFIG.FULL_PAPER.OPEN_MINUTE_AFTER_MIDNIGHT, 1);
});

test('papers registry: UPSC two papers + SSC four papers', () => {
  assert.equal(Object.keys(EXAMS).length, 2);
  assert.equal(paperList('UPSC_CSE_PRELIMS').length, 2);
  assert.equal(paperList('SSC_CGL').length, 4);
  assert.equal(paperList().length, 6);
  assert.ok(paperList().every((p) => p.exam && EXAMS[p.exam]));
});

test('SSC CGL Tier-I matches the verified 2026 rules', () => {
  const t1 = getPaper('SSC_T1');
  assert.equal(t1.questionCount, 100);
  assert.equal(t1.durationMinutes, 60);
  assert.equal(t1.marks, 200);
  assert.equal(t1.marksPerQuestion * t1.negativeFraction, 0.5); // −0.50 per wrong
  assert.equal(t1.sectional.enabled, true);
  assert.equal(t1.sectional.lock, true);
  assert.equal(t1.sections.length, 4);
  assert.ok(t1.sections.every((s) => s.questionCount === 25 && s.durationSeconds === 900));
});

test('SSC Tier-II Paper-I matches the verified 2026 Session-I rules', () => {
  const p1 = getPaper('SSC_T2_P1');
  assert.equal(p1.questionCount, 150);
  assert.equal(p1.durationMinutes, 135);
  assert.equal(p1.marksPerQuestion * p1.negativeFraction, 1); // −1 per wrong
  assert.equal(p1.sections.length, 5);
  assert.equal(p1.extraSessions[0].simulated, false); // DEST is not MCQ
  assert.equal(p1.sectionQualification.status, 'REVIEW'); // thresholds not invented
});
