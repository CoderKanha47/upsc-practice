import CONFIG, { EXAMS, DEFAULT_EXAM, examOfPaper } from '../../config/exam.config.js';
import { getDb } from '../db/database.js';

/**
 * DYNAMIC TIMING ENGINE
 * ---------------------
 * question_time = base_estimated_time(question) + SELECTIVE_BUFFER_SECONDS
 * total_selective_time = Σ question_time
 *
 * base_estimated_time derives from question metadata (type, difficulty, paper,
 * passage length) and is stored on the question so it can later be calibrated
 * against observed actual_time_taken. Each exam carries its own time model
 * (UPSC is slower, SSC papers are speed tests).
 */

function wordCount(text) {
  if (!text) return 0;
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

/** The time model of the exam a question belongs to. */
export function timeModelFor(meta, cfg = CONFIG) {
  let examId = meta.exam;
  if (!examId && meta.paper) {
    try {
      examId = examOfPaper(meta.paper).id;
    } catch {
      examId = DEFAULT_EXAM;
    }
  }
  return (examId && EXAMS[examId]?.timeModel) || cfg.TIME_MODEL;
}

/** Estimated seconds for a single question (before buffer). */
export function estimateSeconds(meta, cfg = CONFIG) {
  const T = timeModelFor(meta, cfg);
  const type = meta.question_type && meta.question_type in T.BASE_BY_TYPE
    ? meta.question_type
    : 'default';
  let base = T.BASE_BY_TYPE[type] ?? T.BASE_BY_TYPE.default;
  base *= T.DIFFICULTY_FACTOR[meta.difficulty] ?? 1;
  base *= T.PAPER_FACTOR[meta.paper] ?? 1;

  if (meta.passage) {
    const passageSeconds = wordCount(meta.passage) * T.PASSAGE_SECONDS_PER_WORD;
    const share = Math.max(1, meta.groupSize || 1);
    base += passageSeconds / share;
  }
  return Math.round(Math.min(T.MAX_SECONDS, Math.max(T.MIN_SECONDS, base)));
}

/** Stored estimate wins; fall back to the model for legacy rows. */
export function questionEstimate(question, cfg = CONFIG) {
  if (question.estimated_time_seconds) return question.estimated_time_seconds;
  return estimateSeconds(question, cfg);
}

export function bufferSeconds(cfg = CONFIG, examId = DEFAULT_EXAM) {
  const exam = EXAMS[examId];
  const settingsKey = exam?.selective?.SETTINGS_KEY || 'SELECTIVE_BUFFER_SECONDS';
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(settingsKey);
  if (row) {
    const v = Number(row.value);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  return exam?.selective?.BUFFER_SECONDS ?? cfg.SELECTIVE.BUFFER_SECONDS;
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(sec)}s`;
  if (m > 0) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Preview the timing of a proposed selective test BEFORE it starts.
 * Mirrors the display format required by the spec:
 *   20 Questions | Estimated base time | Buffer | Total
 */
export function previewTiming(questions, buffer = bufferSeconds(), cfg = CONFIG) {
  const baseSeconds = questions.reduce((sum, q) => sum + questionEstimate(q, cfg), 0);
  const bufferTotal = questions.length * buffer;
  const total = baseSeconds + bufferTotal;
  return {
    count: questions.length,
    baseSeconds,
    bufferSeconds: buffer,
    bufferTotalSeconds: bufferTotal,
    totalSeconds: total,
    averagePerQuestion: questions.length ? Math.round(total / questions.length) : 0,
    formatted: {
      base: formatDuration(baseSeconds),
      buffer: formatDuration(bufferTotal),
      total: formatDuration(total),
    },
  };
}

/** The duration a selective session should run for, in seconds. */
export function selectiveDurationSeconds(questions, buffer = bufferSeconds(), cfg = CONFIG) {
  return previewTiming(questions, buffer, cfg).totalSeconds;
}

/**
 * Calibration report: original estimate vs observed average.
 * Used by Analytics to decide whether estimates are too generous/aggressive.
 */
export function calibrationFor(question, stats, cfg = CONFIG) {
  const estimated = questionEstimate(question, cfg);
  const averageActual = stats && stats.average_time_seconds
    ? Math.round(stats.average_time_seconds)
    : null;
  if (averageActual === null) {
    return { estimated, averageActual: null, deltaSeconds: null, samples: stats?.attempt_count || 0 };
  }
  return {
    estimated,
    averageActual,
    deltaSeconds: averageActual - estimated,
    samples: stats.attempt_count,
  };
}

export default {
  timeModelFor,
  estimateSeconds,
  questionEstimate,
  bufferSeconds,
  formatDuration,
  previewTiming,
  selectiveDurationSeconds,
  calibrationFor,
};
