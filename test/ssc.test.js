import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedFixtures, seedSscFixtures } from './helpers/seed.js';
import { getDb, setClockOffset, resetClock } from '../src/db/database.js';
import {
  buildMixedPaper,
  buildSelectiveSet,
  countPool,
  distributionReport,
} from '../src/services/selection.js';
import { resultQualification } from '../src/services/scoring.js';
import { dupKeyFor } from '../src/services/questionService.js';
import {
  createSession,
  saveAnswer,
  submitSession,
  buildResult,
  listSessions,
} from '../src/services/sessionService.js';
import { progressSeries, coverage } from '../src/services/analytics.js';

await seedFixtures({ gsYears: 3, csatYears: 2, gsPerYear: 20, csatPerYear: 15 });
await seedSscFixtures({ t1Years: 3, perYear: 40 });

const REASONING = 'General Intelligence & Reasoning';

test('schema: fresh DB has no paper CHECK and is at SCHEMA_VERSION', () => {
  const db = getDb();
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'questions'").get().sql;
  assert.ok(!/\bpaper\b\s+TEXT\s+NOT\s+NULL\s+CHECK/i.test(sql.replace(/\s+/g, ' ')));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
  const sessCols = db.prepare('PRAGMA table_info(test_sessions)').all().map((c) => c.name);
  assert.ok(sessCols.includes('cycle_id'), 'test_sessions.cycle_id present after v3 migration');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  assert.ok(tables.includes('ssc_cycles') && tables.includes('ssc_cutoff_history') && tables.includes('paper_difficulty'));
  const cols = db.prepare('PRAGMA table_info(questions)').all().map((c) => c.name);
  assert.ok(cols.includes('exam') && cols.includes('tier') && cols.includes('shift'));
});

test('dupKey: shift-aware keys, legacy keys when no shift', () => {
  const official = { source_type: 'OFFICIAL_PYQ' };
  assert.equal(dupKeyFor({ ...official, year: 2024, paper: 'SSC_T1', shift: 'SHIFT_1', question_number: 3 }), '2024|SSC_T1|SHIFT_1|3');
  assert.equal(dupKeyFor({ ...official, year: 2024, paper: 'SSC_T1', question_number: 3 }), '2024|SSC_T1|3');
  assert.equal(dupKeyFor({ ...official, year: 2024, paper: 'GS1', question_number: 7 }), '2024|GS1|7');
  assert.equal(dupKeyFor({ ...official, year: 2024, paper: 'SSC_T1', shift: 'S1', question_number: 3, source_type: 'AI_GENERATED' }), null);
});

test('selective: exam filter returns only SSC questions', async () => {
  const built = await buildSelectiveSet({ exam: 'SSC_CGL', papers: ['SSC_T1'] }, 12, { seed: 'ssc1' });
  assert.equal(built.actual, 12);
  assert.ok(built.questions.every((q) => q.exam === 'SSC_CGL'));
  assert.ok(built.questions.every((q) => q.paper === 'SSC_T1'));
});

test('selective: UPSC filters never return SSC questions', async () => {
  const built = await buildSelectiveSet({ papers: ['GS1'] }, 15, { seed: 'upsc1' });
  assert.ok(built.questions.every((q) => q.exam === 'UPSC_CSE_PRELIMS'));
  const sscCount = await countPool({ exam: 'SSC_CGL' });
  assert.ok(sscCount >= 40, `SSC pool expected in test DB, got ${sscCount}`);
  const upscOnly = await countPool({ exam: 'UPSC_CSE_PRELIMS', papers: ['GS1'] });
  assert.ok(upscOnly > 0);
});

test('selective: SSC subject filter honours the taxonomy label', async () => {
  const built = await buildSelectiveSet({ exam: 'SSC_CGL', papers: ['SSC_T1'], subjects: [REASONING] }, 8, { seed: 'ssc2' });
  assert.equal(built.actual, 8);
  assert.ok(built.questions.every((q) => q.subject === REASONING));
});

test('mixed paper: SSC Tier-I builds from SSC fixtures with subject spread', async () => {
  const built = await buildMixedPaper('SSC_T1', 20, { seed: 'ssc-mixed' });
  assert.equal(built.actual, 20);
  assert.ok(built.questions.every((q) => q.exam === 'SSC_CGL'));
  const report = distributionReport(built.questions);
  assert.ok(Object.keys(report.subject).length >= 3, 'subject variety expected');
});

test('qualification strategy is chosen from paper config, never hardcoded', () => {
  assert.equal(resultQualification(120, 'SSC_T1').type, 'SHORTLISTING_STAGE');
  assert.equal(resultQualification(90, 'CSAT').type, 'QUALIFYING_PERCENTAGE');
  assert.equal(resultQualification(90, 'GS1').type, 'CUTOFF_ESTIMATE');
  assert.equal(resultQualification(150, 'SSC_T2_P2').type, 'RAW_SCORE');
});

async function sscQuestionIds(n) {
  const rows = await getDb()
    .prepare(
      `SELECT id FROM questions WHERE exam = 'SSC_CGL' AND paper = 'SSC_T1'
       AND subject = ? ORDER BY year DESC, question_number ASC LIMIT ?`,
    )
    .all(REASONING, n);
  return rows.map((r) => r.id);
}

test('sectional lock: closed section rejects answers, upcoming section not yet open', async () => {
  const ids = await sscQuestionIds(4);
  assert.equal(ids.length, 4);
  const [q1, q2, q3, q4] = ids;
  const sections = [
    { id: 'sec_rs', section: 'Reasoning', title: 'General Intelligence & Reasoning', questionCount: 2, durationSeconds: 600, marks: 4 },
    { id: 'sec_ga', section: 'GA', title: 'General Awareness', questionCount: 2, durationSeconds: 300, marks: 4 },
  ];
  const session = await createSession({
    mode: 'FULL_MIXED',
    kindLabel: 'SSC TIER-I MOCK',
    paper: 'SSC_T1',
    exam: 'SSC_CGL',
    title: 'Sectional lock fixture',
    questionIds: [q1, q2, q3, q4],
    durationSeconds: 1200,
    config: {
      sectional: true,
      sections,
      sectionOf: { [q1]: 'sec_rs', [q2]: 'sec_rs', [q3]: 'sec_ga', [q4]: 'sec_ga' },
    },
  });
  assert.equal(session.exam, 'SSC_CGL');
  assert.equal(session.config.sectional, true);

  // t+0: section 1 open — answering works.
  resetClock();
  assert.equal((await saveAnswer(session.id, { questionId: q1, answer: 'A' })).saved, true);

  // t+300s: section 2 has not started — SECTION_NOT_OPEN.
  setClockOffset(300 * 1000);
  await assert.rejects(
    () => saveAnswer(session.id, { questionId: q3, answer: 'B' }),
    (err) => err.status === 409 && err.code === 'SECTION_NOT_OPEN',
  );

  // t+700s: section 1 closed, section 2 open.
  setClockOffset(700 * 1000);
  await assert.rejects(
    () => saveAnswer(session.id, { questionId: q1, answer: 'B' }),
    (err) => err.status === 409 && err.code === 'SECTION_LOCKED',
  );
  assert.equal((await saveAnswer(session.id, { questionId: q3, answer: 'B' })).saved, true);

  // Result carries a per-section breakdown.
  await submitSession(session.id);
  const result = await buildResult(session.id);
  assert.equal(result.session.exam, 'SSC_CGL');
  assert.equal(result.sections.length, 2);
  assert.ok(result.sections.every((s) => typeof s.marksObtained === 'number'));
  assert.equal(result.qualification.type, 'SHORTLISTING_STAGE');
  assert.ok(result.score.totalMarks > 0);
  resetClock();
});

test('sessions list filters by exam', async () => {
  const ssc = await listSessions({ exam: 'SSC_CGL', limit: 50 });
  assert.ok(ssc.length >= 1);
  assert.ok(ssc.every((s) => s.exam === 'SSC_CGL'));
  const upsc = await listSessions({ exam: 'UPSC_CSE_PRELIMS', limit: 5 });
  assert.ok(upsc.every((s) => s.exam === 'UPSC_CSE_PRELIMS'));
});

test('analytics: progressSeries exposes the six exam-mode-tier series', async () => {
  // A submitted SSC SELECTIVE session so the series has a point.
  const ids = await sscQuestionIds(2);
  const sel = await createSession({
    mode: 'SELECTIVE',
    kindLabel: 'SELECTIVE PRACTICE',
    paper: 'SSC_T1',
    exam: 'SSC_CGL',
    title: 'Reasoning drill · 2 questions',
    questionIds: ids,
    durationSeconds: 300,
    config: { filters: { exam: 'SSC_CGL' } },
  });
  await saveAnswer(sel.id, { questionId: ids[0], answer: 'A' });
  await submitSession(sel.id);

  const { series } = await progressSeries();
  const seriesIds = series.map((s) => s.id);
  const expected = [
    'UPSC_FULL', 'UPSC_SELECTIVE',
    'SSC_T1_FULL', 'SSC_T1_SELECTIVE',
    'SSC_T2_FULL', 'SSC_T2_SELECTIVE',
  ];
  for (const id of expected) {
    assert.ok(seriesIds.includes(id), `missing series ${id}`);
  }
  const sscSel = series.find((s) => s.id === 'SSC_T1_SELECTIVE');
  assert.ok(sscSel.points.length >= 1, 'submitted SSC selective session should appear');
  assert.ok(sscSel.points.every((p) => p.scorePercent !== undefined));
  assert.equal(sscSel.points.at(-1).tier, 'TIER_I');
});

test('analytics: coverage is exam-scoped', async () => {
  const upsc = await coverage('UPSC_CSE_PRELIMS');
  assert.equal(upsc.exam, 'UPSC_CSE_PRELIMS');
  assert.ok(upsc.years.length > 0);
  const ssc = await coverage('SSC_CGL');
  assert.equal(ssc.exam, 'SSC_CGL');
  assert.ok(ssc.years.length > 0);
  assert.ok(ssc.years.every((y) => Object.keys(y.papers).every((id) => id.startsWith('SSC_'))));
});
