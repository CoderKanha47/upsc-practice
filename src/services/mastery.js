import CONFIG from '../../config/exam.config.js';
import { getDb } from '../db/database.js';

/**
 * PYQ MASTERY
 * -----------
 * A question is not "mastered" merely because it was attempted. It must show
 * configured repeated successful performance (correct N times AND within a
 * reasonable response time). Thresholds live in CONFIG.MASTERY.
 */

export function isMastered(question, stats, cfg = CONFIG) {
  if (!stats) return false;
  const M = cfg.MASTERY;
  if (Number(stats.attempt_count || 0) < M.MIN_ATTEMPTS) return false;
  if (Number(stats.correct_count || 0) < M.MIN_CORRECT_ATTEMPTS) return false;
  const estimated = Number(question.estimated_time_seconds || 0);
  const average = stats.average_time_seconds === null || stats.average_time_seconds === undefined
    ? null
    : Number(stats.average_time_seconds);
  if (estimated > 0 && average !== null && average > estimated * M.MAX_TIME_RATIO) return false;
  return true;
}

export function statsFor(questionIds) {
  if (!questionIds.length) return new Map();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM question_stats WHERE question_id IN (${questionIds.map(() => '?').join(',')})`,
    )
    .all(...questionIds);
  return new Map(rows.map((r) => [r.question_id, r]));
}

/** Mastery over the whole official PYQ corpus (or a filtered subset). */
export function masteryOverview(filters = {}) {
  const db = getDb();
  const clauses = ["q.is_duplicate = 0", "q.source_type = 'OFFICIAL_PYQ'"];
  const params = [];
  if (filters.paper) {
    clauses.push('q.paper = ?');
    params.push(filters.paper);
  }
  const rows = db
    .prepare(
      `SELECT q.id, q.estimated_time_seconds, s.attempt_count, s.correct_count,
              s.incorrect_count, s.skipped_count, s.average_time_seconds, s.last_attempted_at
       FROM questions q
       LEFT JOIN question_stats s ON s.question_id = q.id
       WHERE ${clauses.join(' AND ')}`,
    )
    .all(...params);

  let attempted = 0;
  let mastered = 0;
  let correctOnce = 0;
  const masteredIds = [];
  const struggling = [];
  for (const r of rows) {
    if (Number(r.attempt_count || 0) > 0) attempted += 1;
    if (Number(r.correct_count || 0) > 0) correctOnce += 1;
    if (isMastered(r, r, CONFIG)) {
      mastered += 1;
      masteredIds.push(r.id);
    } else if (Number(r.incorrect_count || 0) >= 2 && Number(r.correct_count || 0) === 0) {
      struggling.push(r.id);
    }
  }
  const total = rows.length;
  return {
    total,
    attempted,
    mastered,
    correctOnce,
    struggling,
    neverAttempted: total - attempted,
    masteryPercent: total ? Math.round((mastered / total) * 1000) / 10 : 0,
    attemptedPercent: total ? Math.round((attempted / total) * 1000) / 10 : 0,
    masteredIds,
    rules: {
      minCorrect: CONFIG.MASTERY.MIN_CORRECT_ATTEMPTS,
      minAttempts: CONFIG.MASTERY.MIN_ATTEMPTS,
      maxTimeRatio: CONFIG.MASTERY.MAX_TIME_RATIO,
    },
  };
}

export default { isMastered, statsFor, masteryOverview };
