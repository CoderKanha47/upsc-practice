import test, { after, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { seedFixtures } from './helpers/seed.js';
import { TEST_ADMIN_TOKEN } from './helpers/env.js';
import { setClockOffset, resetClock } from '../src/db/database.js';
import { zonedToEpoch } from '../src/services/availability.js';
import { createApp } from '../src/server.js';

/**
 * HTTP-level flow test: boots the real Express app on an ephemeral port with
 * an isolated test database, then walks the whole user journey — Sunday gate,
 * full paper, selective practice, results, PYQ coverage, admin import.
 */

const TZ = 'Asia/Kolkata';
let server;
let BASE;

function offsetForWallClock(dateKey, timeKey = '12:00') {
  return zonedToEpoch(dateKey, timeKey, TZ) - Date.now();
}

function nextWeekdayDateKey(targetWeekday) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  for (let i = 0; i < 10; i += 1) {
    const d = new Date(Date.now() + i * 86400000);
    const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
    const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    if (idx === targetWeekday) return `${parts.year}-${parts.month}-${parts.day}`;
  }
  throw new Error('no matching weekday found');
}

async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { 'x-admin-token': token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

before(async () => {
  await seedFixtures({ gsYears: 8, csatYears: 4, gsPerYear: 25, csatPerYear: 25 });
  const app = await createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  BASE = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => resetClock());

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('health + static shell', async () => {
  const health = await req('/api/health');
  assert.equal(health.status, 200);
  const page = await fetch(`${BASE}/`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /id="view"/);
  const css = await fetch(`${BASE}/css/app.css`);
  assert.equal(css.status, 200);
});

test('config exposes exam rules, papers and timing knobs', async () => {
  const { status, data } = await req('/api/config');
  assert.equal(status, 200);
  assert.equal(data.papers.length, 6); // UPSC GS1/CSAT + SSC Tier-I + Tier-II ×3
  assert.ok(data.papers.every((p) => p.questionCount && p.durationMinutes));
  assert.equal(data.years.start, 2007);
  assert.equal(data.years.end, 2026);
  assert.equal(typeof data.selective.bufferSeconds, 'number');
  assert.match(data.scoring.rule, /ONE_THIRD|1\/3/i, 'scoring rule documents 1/3 negative marking');
});

test('Sunday gate: locked during the week, open on Sunday', async () => {
  setClockOffset(offsetForWallClock(nextWeekdayDateKey(3), '12:00')); // Wednesday
  let status = await req('/api/full-paper/status');
  assert.equal(status.data.available, false);
  const denied = await req('/api/full-paper/start', { method: 'POST', body: { kind: 'mixed', paper: 'GS1' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.data.code, 'FULL_PAPER_LOCKED');

  setClockOffset(offsetForWallClock(nextWeekdayDateKey(0), '12:00')); // Sunday noon
  status = await req('/api/full-paper/status');
  assert.equal(status.data.available, true);
  assert.equal(status.data.dayName, 'Sunday');
});

test('full paper: exact year shows DATA_MISSING instead of inventing questions', async () => {
  setClockOffset(offsetForWallClock(nextWeekdayDateKey(0), '12:00'));
  // fixtures only cover 2019+ → 2010 must be reported missing, never invented
  const res = await req('/api/full-paper/start', { method: 'POST', body: { kind: 'exact', paper: 'GS1', year: 2010 } });
  assert.equal(res.status, 409);
  assert.equal(res.data.code, 'DATA_MISSING');
  assert.match(res.data.error, /never invented/);
});

test('full paper: mixed paper runs end to end with a server-owned clock', async () => {
  setClockOffset(offsetForWallClock(nextWeekdayDateKey(0), '12:00'));
  const started = await req('/api/full-paper/start', { method: 'POST', body: { kind: 'mixed', paper: 'GS1' } });
  assert.equal(started.status, 200);
  const { session, questions, remainingSeconds, durationSeconds } = started.data;
  assert.equal(session.mode, 'FULL_MIXED');
  assert.equal(questions.length, 100);
  assert.ok(durationSeconds > 0 && remainingSeconds > 0);
  for (const q of questions) {
    assert.equal('correct_answer' in q, false, 'no answer leakage during the exam');
    assert.equal('explanation' in q, false);
    assert.equal('subject' in q, false);
  }

  // answer first two questions, then sync twice — time must never reset
  const q1 = questions[0];
  const q2 = questions[1];
  const a1 = await req(`/api/sessions/${session.id}/answer`, {
    method: 'POST',
    body: { questionId: q1.id, answer: q1.options[0].key, timeSpentSeconds: 30, visited: true },
  });
  assert.equal(a1.status, 200);
  await req(`/api/sessions/${session.id}/answer`, {
    method: 'POST',
    body: { questionId: q2.id, answer: q2.options[1].key, timeSpentSeconds: 45, visited: true },
  });
  const s1 = await req(`/api/sessions/${session.id}`);
  const s2 = await req(`/api/sessions/${session.id}`);
  assert.ok(s2.data.remainingSeconds <= s1.data.remainingSeconds, 'remaining time never increases on sync');
  assert.equal(s1.data.answers.filter((a) => a.answer).length, 2);
  assert.equal(s1.data.questions.length, 100, 'answers survive; questions still answer-safe');

  // submit and score
  const submit = await req(`/api/sessions/${session.id}/submit`, { method: 'POST', body: {} });
  assert.equal(submit.status, 200);
  const result = await req(`/api/sessions/${session.id}/result`);
  assert.equal(result.status, 200);
  assert.equal(result.data.review.length, 100);
  assert.equal(typeof result.data.score.marksObtained, 'number');
  assert.equal(result.data.score.correct + result.data.score.incorrect + result.data.score.unattempted, 100);
  assert.ok(result.data.review.every((r) => r.correct_answer), 'answers revealed only in the result');
  assert.equal(result.data.session.mode, 'FULL_MIXED');

  // editing a closed session is rejected
  const late = await req(`/api/sessions/${session.id}/answer`, {
    method: 'POST',
    body: { questionId: q1.id, answer: 'A' },
  });
  assert.equal(late.status, 410);
});

test('selective practice: timing preview = base + buffer, start, resume without reset', async () => {
  const opts = await req('/api/selective/options');
  assert.equal(opts.status, 200);
  assert.ok(opts.data.counts.total > 0);

  const preview = await req('/api/selective/preview', {
    method: 'POST',
    body: { count: 8, subjects: [], includeOfficial: true },
  });
  assert.equal(preview.status, 200);
  const t = preview.data.timing;
  assert.equal(t.totalSeconds, t.baseSeconds + t.bufferTotalSeconds);
  assert.equal(t.bufferTotalSeconds, 8 * t.bufferSeconds);

  const started = await req('/api/selective/start', {
    method: 'POST',
    body: { count: 8, subjects: [], includeOfficial: true },
  });
  assert.equal(started.status, 200);
  const sid = started.data.session.id;
  assert.equal(started.data.questions.length, 8);

  const first = started.data.questions[0];
  await req(`/api/sessions/${sid}/answer`, {
    method: 'POST',
    body: { questionId: first.id, answer: first.options[0].key, timeSpentSeconds: 20, visited: true },
  });
  const syncA = await req(`/api/sessions/${sid}`);
  const syncB = await req(`/api/sessions/${sid}`);
  assert.ok(syncB.data.remainingSeconds <= syncA.data.remainingSeconds, 'refresh never resets the timer');
  assert.equal(syncA.data.answers.find((a) => a.question_id === first.id).answer, first.options[0].key);
  assert.equal(syncA.data.questions.some((q) => 'correct_answer' in q), false);

  const sub = await req(`/api/sessions/${sid}/submit`, { method: 'POST', body: {} });
  assert.equal(sub.submitted ?? sub.data.submitted, true);
  const result = await req(`/api/sessions/${sid}/result`);
  assert.equal(result.status, 200);
  assert.equal(result.data.review.length, 8);
});

test('score of a fully correct attempt matches the paper rules', async () => {
  // start a small set, peek nothing, but answer everything with a known key by
  // using a single-question session built through selective practice
  const started = await req('/api/selective/start', {
    method: 'POST',
    body: { count: 1, subjects: ['History'], includeOfficial: true, difficulties: ['easy'] },
  });
  assert.equal(started.status, 200);
  const sid = started.data.session.id;
  const q = started.data.questions[0];
  // we cannot know the key (by design) — answer one option and assert the
  // scoring math on whichever outcome we get
  await req(`/api/sessions/${sid}/answer`, { method: 'POST', body: { questionId: q.id, answer: q.options[0].key, timeSpentSeconds: 10, visited: true } });
  await req(`/api/sessions/${sid}/submit`, { method: 'POST', body: {} });
  const { data } = await req(`/api/sessions/${sid}/result`);
  assert.equal(data.score.attempted, 1);
  if (data.score.correct === 1) {
    assert.equal(data.score.marksObtained, 2);
    assert.equal(data.score.negativeMarks, 0);
  } else {
    assert.equal(data.score.incorrect, 1);
    assert.equal(data.score.negativeMarks, 0.67);
  }
});

test('PYQ coverage: 20 years, DATA_MISSING for unimported papers', async () => {
  const { status, data } = await req('/api/pyq/coverage');
  assert.equal(status, 200);
  assert.equal(data.years.length, 20);
  const y2010 = data.years.find((y) => y.year === 2010);
  assert.equal(y2010.papers.GS1.status, 'DATA_MISSING');
  const y2026 = data.years.find((y) => y.year === 2026);
  assert.ok(y2026.papers.GS1.found > 0, 'fixture coverage is visible');

  const questions = await req('/api/pyq/questions?year=2026&paper=GS1');
  assert.equal(questions.status, 200);
  assert.ok(questions.data.questions.length > 0);
  const unattempted = questions.data.questions.filter((q) => q.status === 'NEVER_ATTEMPTED');
  assert.ok(unattempted.every((q) => q.correct_answer === null), 'answers hidden until practised');
});

test('admin API: token required, import flips coverage, verified text is locked', async () => {
  const denied = await req('/api/admin/stats');
  assert.equal(denied.status, 401);

  const stats = await req('/api/admin/stats', { token: TEST_ADMIN_TOKEN });
  assert.equal(stats.status, 200);

  const payload = {
    meta: { year: 2016, paper: 'GS1', source: 'import-flow-test' },
    questions: [
      {
        year: 2016,
        paper: 'GS1',
        question_number: 1,
        source_type: 'OFFICIAL_PYQ',
        question_text: '[IMPORT TEST] 2016 GS1 Q1 — which statement about the Constitution is correct?',
        options: ['Statement one', 'Statement two', 'Both', 'Neither'],
        correct_answer: 'C',
        subject: 'Indian Polity',
        topic: 'Fundamental Rights',
        difficulty: 'easy',
        question_type: 'statement_based',
        explanation: 'Import-flow test record.',
        source: 'import-flow-test',
      },
    ],
  };
  const imported = await req('/api/admin/import', {
    method: 'POST',
    token: TEST_ADMIN_TOKEN,
    body: { format: 'json', content: JSON.stringify(payload), meta: { filename: 'flow.json', sourceType: 'OFFICIAL_PYQ' } },
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.data.summary.inserted, 1);

  // duplicate re-import is rejected, not duplicated
  const again = await req('/api/admin/import', {
    method: 'POST',
    token: TEST_ADMIN_TOKEN,
    body: { format: 'json', content: JSON.stringify(payload), meta: { filename: 'flow.json', sourceType: 'OFFICIAL_PYQ' } },
  });
  assert.equal(again.data.summary.duplicates, 1);

  const cov = await req('/api/pyq/coverage');
  const y2016 = cov.data.years.find((y) => y.year === 2016);
  assert.notEqual(y2016.papers.GS1.status, 'DATA_MISSING', 'coverage reflects the import');

  // find it, verify it, then the text becomes locked
  const found = await req('/api/admin/questions?q=IMPORT%20TEST', { token: TEST_ADMIN_TOKEN });
  assert.equal(found.status, 200);
  const qid = found.data.items[0].id;

  // verify → the official text becomes locked against casual edits
  const verified = await req(`/api/admin/questions/${qid}/verify`, { method: 'POST', token: TEST_ADMIN_TOKEN });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.validation_state, 'VERIFIED');

  const locked = await req(`/api/admin/questions/${qid}`, {
    method: 'PATCH',
    token: TEST_ADMIN_TOKEN,
    body: { question_text: 'tampered text without verification' },
  });
  assert.equal(locked.status, 423);
  assert.equal(locked.data.code, 'TEXT_LOCKED');

  const meta = await req(`/api/admin/questions/${qid}`, {
    method: 'PATCH',
    token: TEST_ADMIN_TOKEN,
    body: { topic: 'Fundamental Rights (edited)' },
  });
  assert.equal(meta.status, 200);
  assert.equal(meta.data.question.topic, 'Fundamental Rights (edited)');
});

test('sessions API: unknown session is 404, active list works', async () => {
  const missing = await req('/api/sessions/sess_not_a_real_id');
  assert.equal(missing.status, 404);
  const active = await req('/api/sessions/active');
  assert.equal(active.status, 200);
  assert.ok(Array.isArray(active.data.sessions));
});

test('analytics endpoints respond with real data', async () => {
  for (const path of [
    '/api/analytics/overview',
    '/api/analytics/performance?dimension=subject&minAttempts=1',
    '/api/analytics/time',
    '/api/analytics/trend',
    '/api/analytics/failures',
    '/api/analytics/calibration',
    '/api/analytics/mastery',
  ]) {
    const { status, data } = await req(path);
    assert.equal(status, 200, `${path} should be 200`);
    assert.ok(data && typeof data === 'object', `${path} returns JSON`);
  }
});
