import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedFixtures, seedSscFixtures, seedSscTier2Fixtures } from './helpers/seed.js';
import { getDb, setClockOffset, resetClock, now } from '../src/db/database.js';
import { zonedToEpoch } from '../src/services/availability.js';
import { getSscConfig, setSscConfig, sscConfigDefaults } from '../src/services/sscConfig.js';
import {
  computeCutoff, resolveBaseline, seedHistoricalCutoffs, listHistoricalCutoffs,
} from '../src/services/cutoff.js';
import {
  ensureCycle, currentCycle, getCycle, getCycleByDate, listCycles,
  cycleDateKey, cycleIdFor, cycleWindow, windowStatus,
  attachSessionToCycle, recordTier1Result, recordTier2Start, recordTier2Result,
  assertTier2FullPaperAllowed, tier2Eligible, finalizeCycle, cycleView,
} from '../src/services/sscCycle.js';
import {
  createSession, saveAnswer, submitSession, buildResult,
} from '../src/services/sessionService.js';
import { buildMixedPaper, buildSelectiveSet } from '../src/services/selection.js';
import { resultQualification } from '../src/services/scoring.js';
import { progressSeries } from '../src/services/analytics.js';

/**
 * SSC CGL Tier-II + weekly Sunday cycle regression suite.
 * Covers: three cutoff modes, persistence-once, difficulty requirement,
 * Tier-I→Tier-II gating, independence of cycles, late/absent semantics,
 * finalization cases, selective 24/7, analytics exclusion of ABSENT,
 * historical-vs-simulated cutoff separation, and UPSC isolation.
 */

const TZ = 'Asia/Kolkata';

seedFixtures({ gsYears: 2, csatYears: 1, gsPerYear: 12, csatPerYear: 8 });
seedSscFixtures({ t1Years: 3, perYear: 40 });
seedSscTier2Fixtures({ years: 1, perYear: 60 });

function offsetFor(dateKey, timeKey = '12:00') {
  return zonedToEpoch(dateKey, timeKey, TZ) - Date.now();
}

function nextWeekdayDateKey(targetWeekday, from = Date.now()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  for (let i = 0; i < 10; i += 1) {
    const d = new Date(from + i * 86400000);
    const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
    if (['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday) === targetWeekday) {
      return `${parts.year}-${parts.month}-${parts.day}`;
    }
  }
  throw new Error('no matching weekday');
}

function addDays(dateKey, days) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Every cycle test uses a fresh, future Sunday so it owns its own
 * ssc_cycles row. Reusing one date across tests would share a single row
 * (and its finalized_at), which makes tests order-dependent.
 */
const WEEK = (n) => addDays(nextWeekdayDateKey(0), 7 * n);

function pinTo(dateKey, timeKey) {
  setClockOffset(offsetFor(dateKey, timeKey));
}

function t1QuestionIds(n) {
  return getDb()
    .prepare(
      `SELECT id FROM questions WHERE paper = 'SSC_T1' ORDER BY year DESC, question_number ASC LIMIT ?`,
    )
    .all(n)
    .map((r) => r.id);
}

function answerAllCorrectly(sessionId) {
  const session = getDb().prepare('SELECT question_ids_json FROM test_sessions WHERE id = ?').get(sessionId);
  const ids = JSON.parse(session.question_ids_json);
  const rows = getDb()
    .prepare(`SELECT id, correct_answer FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids);
  for (const q of rows) saveAnswer(sessionId, { questionId: q.id, answer: q.correct_answer });
}

function answerAllWrongly(sessionId) {
  const session = getDb().prepare('SELECT question_ids_json FROM test_sessions WHERE id = ?').get(sessionId);
  const ids = JSON.parse(session.question_ids_json);
  const correct = new Set(
    getDb().prepare(`SELECT correct_answer FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((r) => r.correct_answer),
  );
  const letters = ['A', 'B', 'C', 'D'];
  for (const id of ids) {
    // Pick a letter that is never the correct answer for this question.
    saveAnswer(sessionId, { questionId: id, answer: letters.find((l) => !correct.has(l)) });
  }
}

test('defaults: Tier-II off, gating on, difficulty-aware cutoff, Sunday 00:01–23:59 IST', () => {
  const cfg = sscConfigDefaults();
  assert.equal(cfg.tier2Enabled, false);
  assert.equal(cfg.tier1QualificationGatingEnabled, true);
  assert.equal(cfg.cutoffMode, 'DIFFICULTY_AWARE');
  assert.equal(cfg.difficultyAssignment, 'MANUAL_REQUIRED');
  assert.equal(cfg.weeklyWindow.openMinuteAfterMidnight, 1);
  assert.equal(cfg.weeklyWindow.closeMinuteBeforeMidnight, 1);
  // Stored config equals defaults on a fresh DB.
  assert.equal(getSscConfig().cutoffMode, 'DIFFICULTY_AWARE');
});

test('config validation rejects out-of-range and inconsistent values', () => {
  assert.throws(() => setSscConfig({ cutoff: { randomMinPercent: 90, randomMaxPercent: 10 } }), /≤/);
  assert.throws(() => setSscConfig({ cutoffMode: 'NOPE' }), /cutoffMode/);
  assert.throws(() => setSscConfig({ cutoff: { manualPercent: 150 } }), /0 and 100/);
  // Valid partial patch sticks.
  const cfg = setSscConfig({ cutoffMode: 'MANUAL', cutoff: { manualPercent: 60 } });
  assert.equal(cfg.cutoffMode, 'MANUAL');
  assert.equal(cfg.cutoff.manualPercent, 60);
});

test('cutoff MANUAL mode: configured percentage used verbatim', () => {
  setSscConfig({ cutoffMode: 'MANUAL', cutoff: { manualPercent: 62.5 } });
  const cutoff = computeCutoff(getSscConfig(), {});
  assert.equal(cutoff.mode, 'MANUAL');
  assert.equal(cutoff.percent, 62.5);
  assert.equal(cutoff.marksOutOf200, 125);
});

test('cutoff RANDOM_WEEKLY: secure draw stays inside the configured range', () => {
  setSscConfig({ cutoffMode: 'RANDOM_WEEKLY', cutoff: { randomMinPercent: 68, randomMaxPercent: 77 } });
  for (let i = 0; i < 5; i += 1) {
    const cutoff = computeCutoff(getSscConfig(), {});
    assert.equal(cutoff.mode, 'RANDOM_WEEKLY');
    assert.ok(cutoff.percent >= 68 && cutoff.percent <= 77, `${cutoff.percent} outside [68,77]`);
  }
  // Injected deterministic RNG is honoured (test hook).
  const fixed = computeCutoff(getSscConfig(), { randomFn: () => 71.25 });
  assert.equal(fixed.percent, 71.25);
});

test('cutoff DIFFICULTY_AWARE: baseline + adjustment, clamped, never invented without difficulty', () => {
  seedHistoricalCutoffs();
  setSscConfig({
    cutoffMode: 'DIFFICULTY_AWARE',
    cutoff: { randomVariationEnabled: false, clampMinPercent: 55, clampMaxPercent: 85 },
  });
  const cfg = getSscConfig();
  const baseline = resolveBaseline(cfg);
  assert.ok(baseline.percent > 0, 'baseline resolved from historical rows');
  assert.equal(baseline.includesUnverified, true, 'reference rows are flagged unverified');

  for (const [difficulty, adj] of [['EASY', 3], ['MEDIUM', 0], ['HARD', -3]]) {
    const cutoff = computeCutoff(cfg, { difficulty, baseline });
    assert.equal(cutoff.difficulty, difficulty);
    assert.equal(cutoff.adjustmentPp, adj);
    const expected = Math.min(85, Math.max(55, baseline.percent + adj));
    assert.ok(Math.abs(cutoff.percent - expected) < 0.001, `${difficulty}: ${cutoff.percent} vs ${expected}`);
  }
  // Without a difficulty it is a hard 422 — never fabricated.
  assert.throws(() => computeCutoff(cfg, { difficulty: null }), (err) => err.code === 'DIFFICULTY_REQUIRED' && err.status === 422);
});

test('DIFFICULTY_REQUIRED: no cycle row is created until the paper is classified', () => {
  setSscConfig({ cutoffMode: 'DIFFICULTY_AWARE', difficultyAssignment: 'MANUAL_REQUIRED' });
  const dateKey = nextWeekdayDateKey(0);
  pinTo(dateKey, '09:00');
  assert.throws(() => ensureCycle(dateKey), (err) => err.code === 'DIFFICULTY_REQUIRED');
  assert.equal(getCycleByDate(dateKey), null, 'no cycle fabricated');
  // currentCycle surfaces a shell instead of inventing a cutoff.
  const shell = currentCycle({ autoFinalize: false });
  assert.equal(shell.missingDifficulty, true);
  assert.equal(shell.cutoff, undefined);

  // Admin classification (stored in paper_difficulty) unblocks generation.
  getDb()
    .prepare(
      `INSERT INTO paper_difficulty (id, paper_id, cycle_date, difficulty, difficulty_source, created_at)
       VALUES ('pdiff-test-1', 'SSC_T1', NULL, 'MEDIUM', 'MANUAL', ?)`,
    )
    .run(now());
  const cycle = ensureCycle(WEEK(3), { difficulty: 'MEDIUM' });
  assert.equal(cycle.difficulty, 'MEDIUM');
  assert.equal(cycle.difficulty_source, 'MANUAL');
  assert.ok(cycle.cutoff_percent > 0);
});

test('cycle id/window: SSC-CGL-YYYY-MM-DD, Sunday-only, IST inclusive close', () => {
  const dateKey = WEEK(1);
  assert.equal(cycleIdFor(dateKey), `SSC-CGL-${dateKey}`);
  const win = cycleWindow(dateKey, getSscConfig());
  assert.equal(win.openTime, '00:01');
  assert.equal(win.closeTime, '23:59');
  // 00:01:00.000 → 23:59:59.999 IST inclusive. closeAt already carries +59,999 ms,
  // so the span is (86,400,000 − 60,000) + 59,999 = 86,339,999 ms.
  assert.equal(win.closeAt - win.openAt, 86_339_999);

  pinTo(dateKey, '12:00');
  assert.equal(windowStatus().available, true);
  const wed = nextWeekdayDateKey(3);
  pinTo(wed, '12:00');
  assert.equal(windowStatus().available, false, 'locked mid-week');
});

test('cutoff is generated once per cycle and never regenerated (refresh/retry/reopen)', () => {
  // MANUAL mode makes the persisted value deterministic, so we can assert on it.
  setSscConfig({ cutoffMode: 'MANUAL', cutoff: { manualPercent: 69.5 } });
  const dateKey = WEEK(2);
  pinTo(dateKey, '08:00');
  // currentCycle() creates this Sunday's row, generating the cutoff exactly once.
  const first = currentCycle({ autoFinalize: false });
  assert.equal(first.cycle_date, dateKey);
  assert.equal(first.cutoff_percent, 69.5);
  // "Refresh": reopening the app reuses the persisted value.
  assert.equal(currentCycle({ autoFinalize: false }).cutoff_percent, 69.5);
  assert.equal(ensureCycle(dateKey).cutoff_percent, 69.5);
  // A later config change does not rewrite this cycle's cutoff.
  setSscConfig({ cutoffMode: 'MANUAL', cutoff: { manualPercent: 80 } });
  assert.equal(getCycleByDate(dateKey).cutoff_percent, 69.5);
  assert.equal(listCycles({ limit: 500 }).filter((c) => c.cycle_date === dateKey).length, 1);
  // RANDOM_WEEKLY still draws inside its configured range.
  setSscConfig({ cutoffMode: 'RANDOM_WEEKLY', cutoff: { randomMinPercent: 68, randomMaxPercent: 77 } });
  const rand = computeCutoff(getSscConfig(), { randomFn: () => 71.25 });
  assert.equal(rand.percent, 71.25);
  assert.ok(rand.percent >= 68 && rand.percent <= 77);
});

test('Tier-I attempt decides qualification server-side from the persisted cutoff', () => {
  setSscConfig({ cutoffMode: 'MANUAL', cutoff: { manualPercent: 60 }, tier2Enabled: true });
  const dateKey = WEEK(4);
  pinTo(dateKey, '10:00');
  const cycle = ensureCycle(dateKey);
  assert.equal(cycle.cutoff_percent, 60);

  // Above cutoff → QUALIFIED, Tier-II unlocked for this cycle only.
  const ids = t1QuestionIds(10);
  const pass = createSession({
    mode: 'FULL_MIXED', kindLabel: 'SSC TIER-I MOCK', paper: 'SSC_T1', exam: 'SSC_CGL',
    title: 'Tier-I pass', questionIds: ids, durationSeconds: 3600, cycleId: cycle.id,
  });
  attachSessionToCycle(pass.id, cycle.id, 1);
  answerAllCorrectly(pass.id);
  submitSession(pass.id);
  let after = getCycle(cycle.id);
  assert.equal(after.tier1_status, 'COMPLETED');
  assert.equal(after.qualification_status, 'QUALIFIED');
  assert.equal(after.tier2_status, 'ELIGIBLE');
  assert.equal(after.tier1_percent, 100);

  // Result carries the cycle cutoff, not a generic shortlisting label.
  const result = buildResult(pass.id);
  assert.equal(result.qualification.type, 'CYCLE_CUTOFF');
  assert.equal(result.qualification.qualified, true);
  assert.equal(result.qualification.cutoffPercent, 60);
  assert.equal(result.cycle.id, cycle.id);

  // Below cutoff on a second cycle → NOT_QUALIFIED + Tier-II locked.
  const nextKey = addDays(dateKey, 7);
  pinTo(nextKey, '10:00');
  const cycle2 = ensureCycle(nextKey);
  const fail = createSession({
    mode: 'FULL_MIXED', kindLabel: 'SSC TIER-I MOCK', paper: 'SSC_T1', exam: 'SSC_CGL',
    title: 'Tier-I fail', questionIds: t1QuestionIds(10), durationSeconds: 3600, cycleId: cycle2.id,
  });
  attachSessionToCycle(fail.id, cycle2.id, 1);
  answerAllWrongly(fail.id);
  submitSession(fail.id);
  after = getCycle(cycle2.id);
  assert.equal(after.qualification_status, 'NOT_QUALIFIED');
  assert.equal(after.tier2_status, 'NOT_ELIGIBLE');
  assert.equal(buildResult(fail.id).qualification.qualified, false);
  assert.equal(buildResult(fail.id).qualification.cutoffPercent, 60);

  // Qualification never carries over to the following Sunday.
  const cycle3Key = addDays(nextKey, 7);
  pinTo(cycle3Key, '10:00');
  const fresh = currentCycle({ autoFinalize: false });
  assert.equal(fresh.id, `SSC-CGL-${cycle3Key}`);
  assert.equal(fresh.qualification_status, 'PENDING');
  assert.equal(fresh.tier2_status, 'NOT_ELIGIBLE');
});

test('Tier-II full paper gating: disabled / not qualified / already completed', () => {
  // Disabled by default.
  setSscConfig({ cutoffMode: 'MANUAL', cutoff: { manualPercent: 50 }, tier2Enabled: false });
  const dateKey = WEEK(6);
  pinTo(dateKey, '11:00');
  const cycle = currentCycle({ autoFinalize: false });
  assert.throws(() => assertTier2FullPaperAllowed(), (err) => err.code === 'TIER2_DISABLED' && err.status === 403);

  // Enabled but Tier-I not qualified.
  setSscConfig({ tier2Enabled: true, tier1QualificationGatingEnabled: true });
  assert.throws(() => assertTier2FullPaperAllowed(), (err) => err.code === 'TIER1_NOT_QUALIFIED' && err.status === 403);

  // Qualify via a scored Tier-I attempt, then Tier-II may start and complete.
  const t1 = createSession({
    mode: 'FULL_MIXED', kindLabel: 'SSC TIER-I MOCK', paper: 'SSC_T1', exam: 'SSC_CGL',
    title: 'Gate T1', questionIds: t1QuestionIds(8), durationSeconds: 3600, cycleId: cycle.id,
  });
  attachSessionToCycle(t1.id, cycle.id, 1);
  answerAllCorrectly(t1.id);
  submitSession(t1.id);
  const gate = assertTier2FullPaperAllowed();
  assert.equal(gate.resumed, false);
  assert.equal(gate.cycle.qualification_status, 'QUALIFIED');

  const t2 = createSession({
    mode: 'FULL_MIXED', kindLabel: 'SSC TIER-II MOCK', paper: 'SSC_T2_P1', exam: 'SSC_CGL',
    title: 'Tier-II attempt', questionIds: buildMixedPaper('SSC_T2_P1', 10, { seed: 't2gate' }).questions.map((q) => q.id),
    durationSeconds: 8100, cycleId: cycle.id,
  });
  recordTier2Start(cycle.id, t2.id, 'SSC_T2_P1');
  // In-progress Tier-II resumes instead of double-starting.
  const resume = assertTier2FullPaperAllowed();
  assert.equal(resume.resumed, true);
  assert.equal(resume.sessionId, t2.id);

  answerAllCorrectly(t2.id);
  submitSession(t2.id);
  const completed = getCycle(cycle.id);
  assert.equal(completed.tier2_status, 'COMPLETED');
  assert.ok(completed.tier2_marks > 0);
  assert.throws(() => assertTier2FullPaperAllowed(), (err) => err.code === 'TIER2_ALREADY_COMPLETED' && err.status === 409);
});

test('cutoff is never derived from the user\'s own score', () => {
  setSscConfig({ cutoffMode: 'MANUAL', cutoff: { manualPercent: 55 } });
  const dateKey = WEEK(7);
  pinTo(dateKey, '12:30');
  const cycle = currentCycle({ autoFinalize: false });
  const before = cycle.cutoff_percent;
  const s = createSession({
    mode: 'FULL_MIXED', kindLabel: 'SSC TIER-I MOCK', paper: 'SSC_T1', exam: 'SSC_CGL',
    title: 'Score must not move cutoff', questionIds: t1QuestionIds(6), durationSeconds: 3600, cycleId: cycle.id,
  });
  attachSessionToCycle(s.id, cycle.id, 1);
  answerAllCorrectly(s.id);
  submitSession(s.id);
  assert.equal(getCycle(cycle.id).cutoff_percent, before);
  const res = buildResult(s.id);
  assert.equal(res.qualification.cutoffPercent, before);
  assert.equal(res.qualification.disclaimer, 'Simulated practice cutoff — not an official SSC cutoff.');
});

test('late submission after window close becomes ABSENT — never a completed result', () => {
  setSscConfig({ cutoffMode: 'MANUAL', cutoff: { manualPercent: 50 } });
  const dateKey = WEEK(8);
  pinTo(dateKey, '23:50');
  const cycle = currentCycle({ autoFinalize: false });
  const s = createSession({
    mode: 'FULL_MIXED', kindLabel: 'SSC TIER-I MOCK', paper: 'SSC_T1', exam: 'SSC_CGL',
    title: 'Late submit', questionIds: t1QuestionIds(5), durationSeconds: 3600, cycleId: cycle.id,
  });
  attachSessionToCycle(s.id, cycle.id, 1);
  answerAllCorrectly(s.id);
  // Window closes; submission lands the next morning.
  setClockOffset(offsetFor(addDays(dateKey, 1), '00:05'));
  const finished = submitSession(s.id);
  assert.equal(finished.status, 'ABSENT');
  const row = getDb().prepare('SELECT marks_obtained, status FROM test_sessions WHERE id = ?').get(s.id);
  assert.equal(row.status, 'ABSENT');
  assert.equal(row.marks_obtained, null, 'no score fabricated');
  const result = buildResult(s.id);
  assert.equal(result.absent, true);
  assert.equal(result.score.marksObtained, null);
  assert.equal(result.qualification.type, 'ABSENT');
});

test('finalization: qualified-but-no-Tier-II → ABSENT with null score (Case B)', () => {
  setSscConfig({ cutoffMode: 'MANUAL', cutoff: { manualPercent: 50 }, tier2Enabled: true });
  const dateKey = WEEK(9);
  pinTo(dateKey, '09:30');
  const cycle = currentCycle({ autoFinalize: false });
  const t1 = createSession({
    mode: 'FULL_MIXED', kindLabel: 'SSC TIER-I MOCK', paper: 'SSC_T1', exam: 'SSC_CGL',
    title: 'Case B T1', questionIds: t1QuestionIds(8), durationSeconds: 3600, cycleId: cycle.id,
  });
  attachSessionToCycle(t1.id, cycle.id, 1);
  answerAllCorrectly(t1.id);
  submitSession(t1.id);
  assert.equal(getCycle(cycle.id).tier2_status, 'ELIGIBLE');

  setClockOffset(offsetFor(addDays(dateKey, 1), '00:10'));
  const done = finalizeCycle(cycle.id, { force: true });
  assert.ok(done.finalized_at);
  assert.equal(done.tier1_status, 'COMPLETED');
  assert.equal(done.qualification_status, 'QUALIFIED');
  assert.equal(done.tier2_status, 'ABSENT');
  assert.equal(done.tier2_marks, null, 'ABSENT keeps a null score, never zero');
});

test('finalization: never attempted → Tier-I ABSENT, Tier-II NOT_ELIGIBLE (Case D)', () => {
  setSscConfig({ cutoffMode: 'MANUAL', cutoff: { manualPercent: 60 }, tier2Enabled: true });
  const dateKey = WEEK(10);
  pinTo(dateKey, '07:00');
  currentCycle({ autoFinalize: false });
  setClockOffset(offsetFor(addDays(dateKey, 1), '00:10'));
  const done = finalizeCycle(`SSC-CGL-${dateKey}`, { force: true });
  assert.equal(done.tier1_status, 'ABSENT');
  assert.equal(done.qualification_status, 'ABSENT');
  assert.equal(done.tier2_status, 'NOT_ELIGIBLE', 'not eligible is not mislabelled as absent');
  assert.equal(done.tier1_marks, null);
});

test('finalization: started-but-incomplete attempts → ABSENT (Cases E/F), idempotent', () => {
  setSscConfig({ cutoffMode: 'MANUAL', cutoff: { manualPercent: 40 }, tier2Enabled: true });
  const dateKey = WEEK(11);
  pinTo(dateKey, '10:00');
  currentCycle({ autoFinalize: false });
  const t1 = createSession({
    mode: 'FULL_MIXED', kindLabel: 'SSC TIER-I MOCK', paper: 'SSC_T1', exam: 'SSC_CGL',
    title: 'Case E T1 in progress', questionIds: t1QuestionIds(6), durationSeconds: 7200, cycleId: `SSC-CGL-${dateKey}`,
  });
  attachSessionToCycle(t1.id, `SSC-CGL-${dateKey}`, 1);
  // Never submitted before close.
  setClockOffset(offsetFor(addDays(dateKey, 1), '00:10'));
  const done = finalizeCycle(`SSC-CGL-${dateKey}`, { force: true });
  assert.equal(done.tier1_status, 'ABSENT');
  assert.equal(done.qualification_status, 'ABSENT');
  assert.equal(getDb().prepare('SELECT status FROM test_sessions WHERE id = ?').get(t1.id).status, 'ABSENT');

  // Idempotent: a second finalize changes nothing.
  const again = finalizeCycle(`SSC-CGL-${dateKey}`, { force: true });
  assert.equal(again.finalized_at, done.finalized_at);
  assert.equal(again.tier1_status, 'ABSENT');
});

test('Tier-II in-progress at close → ABSENT; lazy finalize runs on later access', () => {
  setSscConfig({ cutoffMode: 'MANUAL', cutoff: { manualPercent: 40 }, tier2Enabled: true });
  // A past Sunday: currentCycle() on the next day targets this closed cycle.
  const dateKey = addDays(nextWeekdayDateKey(0), -7);
  pinTo(dateKey, '10:30');
  const cycleId = `SSC-CGL-${dateKey}`;
  ensureCycle(dateKey);
  const t1 = createSession({
    mode: 'FULL_MIXED', kindLabel: 'SSC TIER-I MOCK', paper: 'SSC_T1', exam: 'SSC_CGL',
    title: 'Lazy T1', questionIds: t1QuestionIds(8), durationSeconds: 3600, cycleId,
  });
  attachSessionToCycle(t1.id, cycleId, 1);
  answerAllCorrectly(t1.id);
  submitSession(t1.id);
  const t2 = createSession({
    mode: 'FULL_MIXED', kindLabel: 'SSC TIER-II MOCK', paper: 'SSC_T2_P1', exam: 'SSC_CGL',
    title: 'Lazy T2 in progress', questionIds: buildMixedPaper('SSC_T2_P1', 8, { seed: 'lazy' }).questions.map((q) => q.id),
    durationSeconds: 8100, cycleId,
  });
  recordTier2Start(cycleId, t2.id, 'SSC_T2_P1');

  // Next day: merely reopening the cycle finalizes it lazily.
  setClockOffset(offsetFor(addDays(dateKey, 1), '09:00'));
  const viewed = ensureCycle(dateKey);
  assert.ok(viewed.finalized, 'lazy finalization on access');
  assert.equal(viewed.tier2_status, 'ABSENT');
  assert.equal(getDb().prepare('SELECT status FROM test_sessions WHERE id = ?').get(t2.id).status, 'ABSENT');
});

test('selective practice (Tier-I and Tier-II) is 24/7, ungated, and not cycle-linked', () => {
  const wed = nextWeekdayDateKey(3);
  pinTo(wed, '15:00');
  assert.equal(windowStatus().available, false, 'full paper locked mid-week');

  const t2set = buildSelectiveSet({ exam: 'SSC_CGL', papers: ['SSC_T2_P1'] }, 6, { seed: 'sel-t2' });
  assert.equal(t2set.actual, 6);
  assert.ok(t2set.questions.every((q) => q.paper === 'SSC_T2_P1'));

  const session = createSession({
    mode: 'SELECTIVE', kindLabel: 'SSC TIER-II SELECTIVE', paper: 'SSC_T2_P1', exam: 'SSC_CGL',
    title: 'Mid-week Tier-II selective', questionIds: t2set.questions.map((q) => q.id),
    durationSeconds: t2set.questions.length * 60,
  });
  assert.equal(session.cycle_id, null, 'selective never attaches to a cycle');
  answerAllCorrectly(session.id);
  const finished = submitSession(session.id);
  assert.equal(finished.status, 'SUBMITTED');
  const result = buildResult(session.id);
  assert.equal(result.absent, undefined);
  assert.ok(result.score.marksObtained > 0);
});

test('analytics: six series exist; ABSENT attempts are excluded from plots', () => {
  // One normal SSC Tier-I full submission + one ABSENT (late) attempt.
  setSscConfig({ cutoffMode: 'MANUAL', cutoff: { manualPercent: 50 } });
  const dateKey = nextWeekdayDateKey(0);
  pinTo(dateKey, '11:00');
  const cycle = ensureCycle(dateKey);
  const ok = createSession({
    mode: 'FULL_MIXED', kindLabel: 'SSC TIER-I MOCK', paper: 'SSC_T1', exam: 'SSC_CGL',
    title: 'Analytics normal', questionIds: t1QuestionIds(5), durationSeconds: 3600, cycleId: cycle.id,
  });
  attachSessionToCycle(ok.id, cycle.id, 1);
  answerAllCorrectly(ok.id);
  submitSession(ok.id);

  const late = createSession({
    mode: 'FULL_MIXED', kindLabel: 'SSC TIER-I MOCK', paper: 'SSC_T1', exam: 'SSC_CGL',
    title: 'Analytics absent', questionIds: t1QuestionIds(4), durationSeconds: 600, cycleId: cycle.id,
  });
  setClockOffset(offsetFor(addDays(dateKey, 1), '01:00'));
  submitSession(late.id); // → ABSENT

  const { series, absentCount } = progressSeries({});
  const ids = series.map((s) => s.id).sort();
  assert.deepEqual(ids, ['SSC_T1_FULL', 'SSC_T1_SELECTIVE', 'SSC_T2_FULL', 'SSC_T2_SELECTIVE', 'UPSC_FULL', 'UPSC_SELECTIVE']);
  const t1Full = series.find((s) => s.id === 'SSC_T1_FULL');
  assert.ok(t1Full.points.some((p) => p.sessionId === ok.id));
  assert.ok(!t1Full.points.some((p) => p.sessionId === late.id), 'ABSENT never plotted');
  assert.ok(absentCount >= 1, 'ABSENT counted separately');
});

test('historical cutoffs stay labelled UNVERIFIED and separate from simulated cutoffs', () => {
  seedHistoricalCutoffs();
  seedHistoricalCutoffs(); // idempotent
  const rows = listHistoricalCutoffs({ category: 'UR', list: 'GENERAL' });
  assert.equal(rows.length, 4, '2022–2025 reference rows');
  assert.ok(rows.every((r) => r.verification_status === 'UNVERIFIED'));
  const y2024 = rows.find((r) => r.year === 2024);
  assert.equal(y2024.raw_marks, 153.19);
  assert.equal(y2024.normalized_percent, 76.6);

  // A simulated cycle cutoff is explicitly flagged as such.
  setSscConfig({ cutoffMode: 'MANUAL', cutoff: { manualPercent: 64 } });
  const dateKey = nextWeekdayDateKey(0);
  pinTo(dateKey, '13:00');
  const view = cycleView(ensureCycle(dateKey));
  assert.equal(view.cutoff.simulated, true);
  assert.match(view.cutoff.disclaimer, /not an official SSC cutoff/i);
});

test('UPSC is untouched: Sunday gate, scoring and qualification strategies unchanged', () => {
  const wed = nextWeekdayDateKey(3);
  pinTo(wed, '12:00');
  assert.equal(windowStatus().available, false);
  // UPSC selective still works mid-week.
  const built = buildSelectiveSet({ papers: ['GS1'] }, 5, { seed: 'upsc-iso' });
  assert.ok(built.questions.every((q) => q.exam === 'UPSC_CSE_PRELIMS'));
  const s = createSession({
    mode: 'SELECTIVE', kindLabel: 'UPSC SELECTIVE', paper: 'GS1', exam: 'UPSC_CSE_PRELIMS',
    title: 'UPSC mid-week', questionIds: built.questions.map((q) => q.id), durationSeconds: 300,
  });
  answerAllCorrectly(s.id);
  assert.ok(submitSession(s.id).status === 'SUBMITTED');
  assert.equal(s.cycle_id, null);
  // Qualification strategies are unchanged.
  assert.equal(resultQualification(120, 'SSC_T1').type, 'SHORTLISTING_STAGE');
  assert.equal(resultQualification(90, 'CSAT').type, 'QUALIFYING_PERCENTAGE');
  assert.equal(resultQualification(90, 'GS1').type, 'CUTOFF_ESTIMATE');
});

test('cycleView never exposes a fabricated Tier-II score for ABSENT', () => {
  const dateKey = nextWeekdayDateKey(0);
  pinTo(dateKey, '14:00');
  setSscConfig({ cutoffMode: 'MANUAL', cutoff: { manualPercent: 50 }, tier2Enabled: true });
  const cycle = ensureCycle(dateKey);
  setClockOffset(offsetFor(addDays(dateKey, 1), '02:00'));
  finalizeCycle(cycle.id, { force: true });
  const view = cycleView(getCycle(cycle.id));
  assert.equal(view.tier2.status, 'ABSENT');
  assert.equal(view.tier2.marks, null);
  assert.equal(view.tier2.percent, null);
  assert.equal(view.tier2.eligibilityReason, 'Cycle finalized.');
});
