import CONFIG, { yearRange, paperList } from '../../config/exam.config.js';
import { getDb } from '../db/database.js';
import { masteryOverview } from './mastery.js';

/**
 * ANALYTICS ENGINE
 * Answers: am I improving? which subjects/topics/types are weak? where do I
 * lose time? how much of the 20-year corpus have I actually mastered?
 */

const round1 = (n) => Math.round(n * 10) / 10;

function statRows(whereExtra = '', params = []) {
  const db = getDb();
  return db
    .prepare(
      `SELECT q.id, q.year, q.paper, q.subject, q.topic, q.subtopic, q.difficulty,
              q.question_type, q.estimated_time_seconds, q.source_type, q.is_official_pyq,
              s.attempt_count, s.correct_count, s.incorrect_count, s.skipped_count,
              s.average_time_seconds, s.best_time_seconds, s.total_time_seconds,
              s.timed_count, s.last_attempted_at, s.consecutive_correct
       FROM question_stats s
       JOIN questions q ON q.id = s.question_id
       WHERE q.is_duplicate = 0 ${whereExtra}`,
    )
    .all(...params);
}

function aggregate(rows, keyFn) {
  const bucket = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    if (!key) continue;
    if (!bucket.has(key)) {
      bucket.set(key, {
        key,
        attempted: 0,
        correct: 0,
        incorrect: 0,
        skipped: 0,
        totalExposures: 0,
        timeSeconds: 0,
        timedCount: 0,
        estimatedSeconds: 0,
      });
    }
    const b = bucket.get(key);
    const attempts = Number(r.attempt_count || 0);
    b.attempted += attempts;
    b.correct += Number(r.correct_count || 0);
    b.incorrect += Number(r.incorrect_count || 0);
    b.skipped += Number(r.skipped_count || 0);
    b.totalExposures += attempts;
    b.timeSeconds += Number(r.total_time_seconds || 0);
    b.timedCount += Number(r.timed_count || 0);
    b.estimatedSeconds += Number(r.estimated_time_seconds || 0) * attempts;
  }
  return [...bucket.values()]
    .map((b) => ({
      key: b.key,
      attempted: b.attempted,
      correct: b.correct,
      incorrect: b.incorrect,
      skipped: b.skipped,
      accuracy: b.attempted ? round1((b.correct / b.attempted) * 100) : 0,
      averageTimeSeconds: b.timedCount ? Math.round(b.timeSeconds / b.timedCount) : null,
      averageEstimatedSeconds: b.attempted ? Math.round(b.estimatedSeconds / b.attempted) : null,
      calibrationDelta:
        b.timedCount && b.attempted
          ? Math.round(b.timeSeconds / b.timedCount) - Math.round(b.estimatedSeconds / b.attempted)
          : null,
      exposureCount: b.totalExposures,
    }))
    .sort((a, b) => b.accuracy - a.accuracy || b.attempted - a.attempted);
}

/** Dashboard-level numbers. */
export function overview() {
  const rows = statRows();
  const sessions = getDb()
    .prepare(
      `SELECT id, mode, kind_label, paper, title, status, started_at, marks_obtained,
              accuracy, attempted, correct, incorrect, unattempted, duration_seconds,
              time_used_seconds
       FROM test_sessions WHERE status != 'IN_PROGRESS' ORDER BY started_at DESC`,
    )
    .all();

  const official = rows.filter((r) => r.source_type === 'OFFICIAL_PYQ');
  const attemptedOfficial = official.filter((r) => Number(r.attempt_count) > 0);
  const totalAttempts = rows.reduce((s, r) => s + Number(r.attempt_count || 0), 0);
  const totalCorrect = rows.reduce((s, r) => s + Number(r.correct_count || 0), 0);
  const accuracy = totalAttempts ? round1((totalCorrect / totalAttempts) * 100) : 0;

  const subjects = aggregate(rows.filter((r) => r.subject), (r) => r.subject);
  const eligible = subjects.filter((s) => s.attempted >= 3);
  const strongest = eligible.length ? eligible.slice().sort((a, b) => b.accuracy - a.accuracy)[0] : null;
  const weakest = eligible.length ? eligible.slice().sort((a, b) => a.accuracy - b.accuracy)[0] : null;

  const gsSessions = sessions.filter((s) => s.paper === 'GS1');
  const avgScore = gsSessions.length
    ? round1(gsSessions.reduce((s, x) => s + Number(x.accuracy || 0), 0) / gsSessions.length)
    : null;

  const mastery = masteryOverview();

  return {
    pyqsAttempted: attemptedOfficial.length,
    pyqTotal: official.length,
    accuracy,
    averageScorePercent: avgScore,
    strongestSubject: strongest ? { name: strongest.key, accuracy: strongest.accuracy } : null,
    weakestSubject: weakest ? { name: weakest.key, accuracy: weakest.accuracy } : null,
    totalTests: sessions.length,
    totalQuestionExposures: totalAttempts,
    mastery,
    recentSessions: sessions.slice(0, 8).map(s => ({
      id: s.id, mode: s.mode, kindLabel: s.kind_label, paper: s.paper, title: s.title,
      startedAt: s.started_at, marksObtained: s.marks_obtained, accuracy: s.accuracy,
      attempted: s.attempted, correct: s.correct, incorrect: s.incorrect,
      unattempted: s.unattempted, timeUsedSeconds: s.time_used_seconds,
    })),
  };
}

/** Performance broken down by subject / topic / question type / difficulty. */
export function performanceBy(dimension, { paper = null, minAttempts = 1 } = {}) {
  const rows = statRows(paper ? 'AND q.paper = ?' : '', paper ? [paper] : []);
  const keyMap = { subject: (r) => r.subject, topic: (r) => r.topic, questionType: (r) => r.question_type, difficulty: (r) => r.difficulty };
  const fn = keyMap[dimension];
  if (!fn) {
    const err = new Error(`Unknown dimension: ${dimension}`);
    err.status = 400;
    throw err;
  }
  const agg = aggregate(rows, fn).filter((x) => x.attempted >= minAttempts);
  const strongest = agg.length ? agg.slice().sort((a, b) => b.accuracy - a.accuracy)[0] : null;
  const weakest = agg.length ? agg.slice().sort((a, b) => a.accuracy - b.accuracy)[0] : null;
  return { dimension, items: agg, strongest, weakest };
}

/** Average / median time, fastest & slowest questions, time by category. */
export function timeAnalytics() {
  const rows = statRows();
  const detail = getDb()
    .prepare(
      `SELECT s.question_id, s.best_time_seconds, s.average_time_seconds, s.timed_count,
              q.question_number, q.year, q.paper, q.subject, q.question_type, q.difficulty,
              q.estimated_time_seconds, q.question_text
       FROM question_stats s JOIN questions q ON q.id = s.question_id
       WHERE s.timed_count > 0 AND q.is_duplicate = 0`,
    )
    .all();

  const averages = detail
    .map((d) => ({ ...d, avg: Number(d.average_time_seconds) }))
    .sort((a, b) => a.avg - b.avg);

  const median = averages.length ? averages[Math.floor(averages.length / 2)].avg : null;
  const overallAvg = averages.length
    ? Math.round(averages.reduce((s, x) => s + x.avg, 0) / averages.length)
    : null;

  const fmt = (d) =>
    d && {
      seconds: Math.round(d.avg),
      question: `Q${d.question_number} (${d.year} ${d.paper})`,
      subject: d.subject,
      text: String(d.question_text || '').slice(0, 120),
    };

  return {
    count: averages.length,
    averageSeconds: overallAvg,
    medianSeconds: median,
    fastest: averages.length ? fmt(averages[0]) : null,
    slowest: averages.length ? fmt(averages[averages.length - 1]) : null,
    bySubject: aggregate(rows, (r) => r.subject)
      .filter((x) => x.timedCount || x.attempted)
      .map((x) => ({ key: x.key, averageTimeSeconds: x.averageTimeSeconds, averageEstimatedSeconds: x.averageEstimatedSeconds, calibrationDelta: x.calibrationDelta, attempted: x.attempted }))
      .sort((a, b) => (b.averageTimeSeconds || 0) - (a.averageTimeSeconds || 0)),
    byDifficulty: aggregate(rows, (r) => r.difficulty).map((x) => ({ key: x.key, averageTimeSeconds: x.averageTimeSeconds, attempted: x.attempted })),
    byQuestionType: aggregate(rows, (r) => r.question_type).map((x) => ({ key: x.key, averageTimeSeconds: x.averageTimeSeconds, averageEstimatedSeconds: x.averageEstimatedSeconds, calibrationDelta: x.calibrationDelta, attempted: x.attempted })),
  };
}

/** Score trend across submitted tests — "Am I improving?" */
export function trend(limit = 30) {
  const sessions = getDb()
    .prepare(
      `SELECT id, title, paper, mode, kind_label, started_at, accuracy, marks_obtained,
              attempted, correct, incorrect, time_used_seconds
       FROM test_sessions WHERE status != 'IN_PROGRESS'
       ORDER BY started_at DESC LIMIT ?`,
    )
    .all(limit)
    .reverse();
  return sessions.map((s) => ({
    id: s.id,
    title: s.title,
    paper: s.paper,
    mode: s.mode,
    kindLabel: s.kind_label,
    date: new Date(s.started_at).toISOString(),
    accuracy: Number(s.accuracy || 0),
    marksObtained: Number(s.marks_obtained || 0),
    attempted: s.attempted,
    correct: s.correct,
    incorrect: s.incorrect,
    timeUsedSeconds: s.time_used_seconds,
  }));
}

/** PYQs the user has repeatedly failed — the learning loop entry point. */
export function repeatedFailures(limit = 25) {
  const db = getDb();
  return db
    .prepare(
      `SELECT q.id, q.year, q.paper, q.question_number, q.question_text, q.subject, q.topic,
              q.question_type, q.difficulty, q.explanation, q.concept, q.source_type,
              s.attempt_count, s.correct_count, s.incorrect_count, s.consecutive_correct,
              s.last_attempted_at
       FROM question_stats s JOIN questions q ON q.id = s.question_id
       WHERE s.incorrect_count >= 2 AND q.is_duplicate = 0
       ORDER BY (s.incorrect_count - s.correct_count) DESC, s.incorrect_count DESC
       LIMIT ?`,
    )
    .all(limit)
    .map((r) => ({
      ...r,
      mastery: false,
      text: String(r.question_text || '').slice(0, 400),
    }));
}

/** Estimated vs actual per-question calibration (feeds the timing model). */
export function calibrationReport(limit = 40) {
  const db = getDb();
  return db
    .prepare(
      `SELECT q.id, q.year, q.paper, q.question_number, q.question_type, q.difficulty,
              q.estimated_time_seconds, s.average_time_seconds, s.timed_count, s.attempt_count
       FROM questions q JOIN question_stats s ON s.question_id = q.id
       WHERE s.timed_count >= 1 AND q.is_duplicate = 0
       ORDER BY ABS(s.average_time_seconds - q.estimated_time_seconds) DESC
       LIMIT ?`,
    )
    .all(limit)
    .map((r) => ({
      id: r.id,
      question: `Q${r.question_number} (${r.year} ${r.paper})`,
      questionType: r.question_type,
      difficulty: r.difficulty,
      estimated: r.estimated_time_seconds,
      actualAverage: Math.round(r.average_time_seconds),
      delta: Math.round(r.average_time_seconds - r.estimated_time_seconds),
      samples: r.timed_count,
    }));
}

/** 20-year corpus coverage: how much of 2007–2026 is actually in the DB? */
export function coverage() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT year, paper, COUNT(*) AS n,
              SUM(CASE WHEN correct_answer IS NOT NULL AND correct_answer != '' THEN 1 ELSE 0 END) AS keyed,
              SUM(CASE WHEN validation_state = 'VERIFIED' THEN 1 ELSE 0 END) AS verified
       FROM questions WHERE is_duplicate = 0 AND source_type = 'OFFICIAL_PYQ'
       GROUP BY year, paper`,
    )
    .all();
  const index = new Map(rows.map((r) => [`${r.year}:${r.paper}`, r]));
  const years = [];
  for (const year of yearRange()) {
    const papers = {};
    let complete = true;
    for (const paper of paperList()) {
      const r = index.get(`${year}:${paper.id}`);
      const expected = paper.questionCount;
      const found = r ? Number(r.n) : 0;
      const keyed = r ? Number(r.keyed) : 0;
      const verified = r ? Number(r.verified) : 0;
      let status;
      if (found === 0) status = 'DATA_MISSING';
      else if (keyed === 0) status = 'REQUIRES_VERIFICATION';
      else if (keyed < expected || verified < expected) status = 'PARTIAL';
      else status = 'VERIFIED';
      if (status !== 'VERIFIED') complete = false;
      papers[paper.id] = {
        title: paper.shortTitle,
        found,
        keyed,
        verified,
        expected,
        status,
        percent: Math.round((found / expected) * 100),
      };
    }
    years.push({ year, papers, complete });
  }
  const totals = rows.reduce(
    (acc, r) => ({ found: acc.found + Number(r.n), keyed: acc.keyed + Number(r.keyed) }),
    { found: 0, keyed: 0 },
  );
  const expectedTotal = paperList().reduce((s, p) => s + p.questionCount, 0) * yearRange().length;
  return {
    years,
    totals: {
      expected: expectedTotal,
      found: totals.found,
      keyed: totals.keyed,
      percent: Math.round((totals.found / expectedTotal) * 1000) / 10,
    },
    note: 'DATA_MISSING years have not been imported. Nothing is ever invented — see Admin → Import to add official papers.',
  };
}

export default {
  overview,
  performanceBy,
  timeAnalytics,
  trend,
  repeatedFailures,
  calibrationReport,
  coverage,
};
