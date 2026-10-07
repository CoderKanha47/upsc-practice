import CONFIG, { getPaper } from '../../config/exam.config.js';
import { getDb, tx, now, newId, toJson, parseJson } from '../db/database.js';
import { scoreSubmission, csatQualification, gsCutoffEstimate } from './scoring.js';

/**
 * EXAM SESSION SERVICE
 * --------------------
 * A session owns the clock. The server stores started_at + deadline_at; the
 * client only ever *displays* remaining time received from the server, so a
 * refresh, a closed tab or a manipulated client cannot reset or extend time.
 *
 * Correct answers and explanations are NEVER sent to the browser before the
 * session is submitted.
 */

const EDITABLE_STATUSES = new Set(['IN_PROGRESS']);

function rowToSession(row) {
  if (!row) return null;
  return {
    ...row,
    question_ids: parseJson(row.question_ids_json, []),
    config: parseJson(row.config_json, {}),
  };
}

export function createSession({
  mode,
  kindLabel,
  paper,
  title,
  questionIds,
  durationSeconds,
  config = {},
  seed = null,
  startedAt = now(),
}) {
  const db = getDb();
  const id = newId('sess');
  const deadline = startedAt + durationSeconds * 1000;
  db.prepare(
    `INSERT INTO test_sessions
      (id, mode, kind_label, paper, title, status, config_json, question_ids_json,
       seed, started_at, duration_seconds, deadline_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    mode,
    kindLabel,
    paper,
    title,
    toJson(config),
    toJson(questionIds),
    seed,
    startedAt,
    durationSeconds,
    deadline,
    startedAt,
  );
  const stmt = db.prepare(
    `INSERT INTO session_answers (session_id, question_id, updated_at) VALUES (?, ?, ?)`,
  );
  for (const qid of questionIds) stmt.run(id, qid, startedAt);
  return getSession(id);
}

export function getSession(id) {
  const row = getDb().prepare('SELECT * FROM test_sessions WHERE id = ?').get(id);
  return rowToSession(row);
}

export function listSessions({ limit = 20, status = null, mode = null } = {}) {
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (mode) {
    clauses.push('mode = ?');
    params.push(mode);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .prepare(
      `SELECT * FROM test_sessions ${where} ORDER BY started_at DESC LIMIT ?`,
    )
    .all(...params, limit)
    .map(rowToSession);
}

export function activeSessions() {
  return listSessions({ status: 'IN_PROGRESS', limit: CONFIG.SESSION.MAX_ACTIVE_SESSIONS });
}

export function remainingSeconds(session, at = now()) {
  return Math.max(0, Math.round((session.deadline_at - at) / 1000));
}

/** Questions in exam-safe form: no answers, no explanations, no classifications. */
export function playableQuestions(session) {
  const db = getDb();
  if (!session.question_ids.length) return [];
  const placeholders = session.question_ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, question_text, passage, options_json, source_type, is_official_pyq
       FROM questions WHERE id IN (${placeholders})`,
    )
    .all(...session.question_ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return session.question_ids
    .map((qid, index) => {
      const r = byId.get(qid);
      if (!r) return null;
      let options = [];
      try {
        options = JSON.parse(r.options_json || '[]');
      } catch {
        options = [];
      }
      return {
        id: r.id,
        number: index + 1,
        question_text: r.question_text,
        passage: r.passage || null,
        options,
        source_type: r.source_type,
        is_official_pyq: Boolean(r.is_official_pyq),
      };
    })
    .filter(Boolean);
}

export function answerMap(sessionId) {
  const rows = getDb()
    .prepare('SELECT * FROM session_answers WHERE session_id = ?')
    .all(sessionId);
  const map = new Map();
  for (const r of rows) map.set(r.question_id, r);
  return map;
}

function assertEditable(session) {
  if (!session) {
    const err = new Error('Session not found.');
    err.status = 404;
    throw err;
  }
  if (!EDITABLE_STATUSES.has(session.status)) {
    const err = new Error('This test has already been submitted.');
    err.status = 410;
    err.code = 'SESSION_CLOSED';
    throw err;
  }
}

/** Returns true when the session clock has run out (server decision). */
export function isExpired(session, at = now()) {
  return at > session.deadline_at + CONFIG.SESSION.SUBMIT_GRACE_MS;
}

export function saveAnswer(sessionId, { questionId, answer = null, timeSpentSeconds = 0, marked = null, visited = null }) {
  const db = getDb();
  const session = getSession(sessionId);
  assertEditable(session);
  if (isExpired(session)) {
    submitSession(sessionId, { auto: true });
    const err = new Error('Time is over. The paper was submitted automatically.');
    err.status = 410;
    err.code = 'SESSION_EXPIRED';
    throw err;
  }

  const q = db.prepare('SELECT id, options_json FROM questions WHERE id = ?').get(questionId);
  if (!q) {
    const err = new Error('Question not found in this session.');
    err.status = 404;
    throw err;
  }
  if (!session.question_ids.includes(questionId)) {
    const err = new Error('Question does not belong to this session.');
    err.status = 400;
    throw err;
  }

  let normalized = null;
  if (answer !== null && answer !== undefined && answer !== '') {
    const upper = String(answer).toUpperCase();
    let options = [];
    try {
      options = JSON.parse(q.options_json || '[]');
    } catch {
      options = [];
    }
    const keys = options.map((o) => String(o.key).toUpperCase());
    if (keys.length && !keys.includes(upper)) {
      const err = new Error(`Invalid option "${answer}".`);
      err.status = 400;
      throw err;
    }
    normalized = upper;
  }

  const prev = answerMap(sessionId).get(questionId);
  const time = Math.max(
    Number(prev?.time_spent_seconds || 0),
    Number(timeSpentSeconds || 0),
  );

  db.prepare(
    `INSERT INTO session_answers (session_id, question_id, answer, marked, visited, time_spent_seconds, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, question_id) DO UPDATE SET
       answer = excluded.answer,
       marked = COALESCE(excluded.marked, session_answers.marked),
       visited = COALESCE(excluded.visited, session_answers.visited),
       time_spent_seconds = MAX(session_answers.time_spent_seconds, excluded.time_spent_seconds),
       updated_at = excluded.updated_at`,
  ).run(
    sessionId,
    questionId,
    normalized,
    marked === null ? (prev?.marked ?? 0) : marked ? 1 : 0,
    visited === null ? (prev?.visited ?? 0) : visited ? 1 : 0,
    time,
    now(),
  );
  return { saved: true, answer: normalized, remainingSeconds: remainingSeconds(session) };
}

export function setMarked(sessionId, questionId, marked) {
  const session = getSession(sessionId);
  assertEditable(session);
  if (isExpired(session)) {
    submitSession(sessionId, { auto: true });
    const err = new Error('Time is over. The paper was submitted automatically.');
    err.status = 410;
    err.code = 'SESSION_EXPIRED';
    throw err;
  }
  const db = getDb();
  db.prepare(
    `INSERT INTO session_answers (session_id, question_id, marked, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id, question_id) DO UPDATE SET marked = excluded.marked, updated_at = excluded.updated_at`,
  ).run(sessionId, questionId, marked ? 1 : 0, now());
  return { saved: true };
}

function updateQuestionStats(session, perQuestion, answers, at) {
  const db = getDb();
  const findStat = db.prepare('SELECT * FROM question_stats WHERE question_id = ?');
  const insertStat = db.prepare(
    `INSERT INTO question_stats
       (question_id, attempt_count, correct_count, incorrect_count, skipped_count,
        last_attempted_at, best_time_seconds, average_time_seconds, total_time_seconds,
        timed_count, consecutive_correct)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateStat = db.prepare(
    `UPDATE question_stats SET
       attempt_count = ?, correct_count = ?, incorrect_count = ?, skipped_count = ?,
       last_attempted_at = ?, best_time_seconds = ?, average_time_seconds = ?,
       total_time_seconds = ?, timed_count = ?, consecutive_correct = ?
     WHERE question_id = ?`,
  );

  for (const p of perQuestion) {
    const a = answers.get(p.question_id);
    const time = Number(a?.time_spent_seconds || 0);
    const correct = p.result === 'correct' ? 1 : 0;
    const incorrect = p.result === 'incorrect' ? 1 : 0;
    const skipped = p.result === 'unattempted' ? 1 : 0;
    const timed = time > 0 ? 1 : 0;
    const existing = findStat.get(p.question_id);

    if (!existing) {
      insertStat.run(
        p.question_id,
        correct,
        incorrect,
        skipped,
        at,
        timed ? time : null,
        timed ? time : null,
        time,
        timed,
        correct,
      );
      continue;
    }

    const attempts = Number(existing.attempt_count) + 1;
    const totalTime = Number(existing.total_time_seconds) + time;
    const timedCount = Number(existing.timed_count) + timed;
    let best = existing.best_time_seconds;
    if (timed) best = best === null || best === undefined ? time : Math.min(Number(best), time);
    const average = timedCount > 0 ? totalTime / timedCount : null;
    const consecutive = correct ? Number(existing.consecutive_correct) + 1 : 0;

    updateStat.run(
      attempts,
      Number(existing.correct_count) + correct,
      Number(existing.incorrect_count) + incorrect,
      Number(existing.skipped_count) + skipped,
      at,
      best,
      average,
      totalTime,
      timedCount,
      consecutive,
      p.question_id,
    );
  }
}

/** Submit (manually or automatically when the timer runs out). */
export function submitSession(sessionId, { auto = false } = {}) {
  const db = getDb();
  const session = getSession(sessionId);
  if (!session) {
    const err = new Error('Session not found.');
    err.status = 404;
    throw err;
  }
  if (session.status !== 'IN_PROGRESS') return getSession(sessionId);

  const at = now();
  const questions = db
    .prepare(
      `SELECT id, question_number, correct_answer, marks, negative_marks FROM questions
       WHERE id IN (${session.question_ids.map(() => '?').join(',')})`,
    )
    .all(...session.question_ids);
  const answerRows = db
    .prepare('SELECT * FROM session_answers WHERE session_id = ?')
    .all(sessionId);
  const answerMapLocal = new Map(answerRows.map((a) => [a.question_id, a]));
  const scoreAnswers = answerRows.map((a) => ({
    question_id: a.question_id,
    answer: a.answer,
    time_spent_seconds: a.time_spent_seconds,
  }));

  const scored = scoreSubmission(session.paper, questions, scoreAnswers, CONFIG);
  const paper = getPaper(session.paper);

  const timeUsed = Math.min(
    session.duration_seconds,
    Math.max(0, Math.round((at - session.started_at) / 1000)),
  );
  const remaining = Math.max(0, session.duration_seconds - timeUsed);

  tx(() => {
    db.prepare(
      `UPDATE test_sessions SET status = ?, submitted_at = ?, attempted = ?, correct = ?,
         incorrect = ?, unattempted = ?, marks_obtained = ?, negative_marks = ?,
         accuracy = ?, time_used_seconds = ?
       WHERE id = ?`,
    ).run(
      auto ? 'AUTO_SUBMITTED' : 'SUBMITTED',
      at,
      scored.attempted,
      scored.correct,
      scored.incorrect,
      scored.unattempted,
      scored.marksObtained,
      scored.negativeMarks,
      scored.accuracy,
      timeUsed,
      sessionId,
    );
    for (const p of scored.perQuestion) {
      db.prepare(
        `UPDATE session_answers SET is_correct = ? WHERE session_id = ? AND question_id = ?`,
      ).run(p.result === 'correct' ? 1 : p.result === 'incorrect' ? 0 : null, sessionId, p.question_id);
    }
    updateQuestionStats(session, scored.perQuestion, answerMapLocal, at);
  });

  const finished = getSession(sessionId);
  finished.timeRemainingSeconds = remaining;
  finished.autoSubmitted = auto;
  return finished;
}

/** Auto-submit if the deadline passed (called on every sync). */
export function syncSession(sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    const err = new Error('Session not found.');
    err.status = 404;
    throw err;
  }
  let auto = false;
  if (session.status === 'IN_PROGRESS' && now() > session.deadline_at) {
    submitSession(sessionId, { auto: true });
    auto = true;
  }
  const fresh = getSession(sessionId);
  const answers = [...answerMap(sessionId).values()].map((a) => ({
    question_id: a.question_id,
    answer: a.answer,
    marked: Boolean(a.marked),
    visited: Boolean(a.visited),
    time_spent_seconds: a.time_spent_seconds,
  }));
  return {
    session: publicSession(fresh),
    questions: fresh.status === 'IN_PROGRESS' ? playableQuestions(fresh) : [],
    answers,
    autoSubmitted: auto,
    serverNow: new Date(now()).toISOString(),
    remainingSeconds: fresh.status === 'IN_PROGRESS' ? remainingSeconds(fresh) : 0,
    durationSeconds: fresh.duration_seconds,
    syncIntervalMs: CONFIG.SESSION.SYNC_INTERVAL_MS,
  };
}

/** Session metadata that is safe to expose while the test is running. */
export function publicSession(s) {
  return {
    id: s.id,
    mode: s.mode,
    kindLabel: s.kind_label,
    paper: s.paper,
    title: s.title,
    status: s.status,
    started_at: s.started_at,
    duration_seconds: s.duration_seconds,
    deadline_at: s.deadline_at,
    submitted_at: s.submitted_at,
    questionCount: s.question_ids.length,
    config: s.config,
    seed: s.seed,
  };
}

/** Full post-submission result: scoring, cutoff/qualification, per-question review. */
export function buildResult(sessionId) {
  const db = getDb();
  const session = getSession(sessionId);
  if (!session) {
    const err = new Error('Session not found.');
    err.status = 404;
    throw err;
  }
  if (session.status === 'IN_PROGRESS') {
    const err = new Error('Result is available only after submission.');
    err.status = 409;
    err.code = 'NOT_SUBMITTED';
    throw err;
  }

  const questions = db
    .prepare(
      `SELECT * FROM questions WHERE id IN (${session.question_ids.map(() => '?').join(',')})`,
    )
    .all(...session.question_ids);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const ordered = session.question_ids.map((id) => byId.get(id)).filter(Boolean);
  const answerRows = db
    .prepare('SELECT * FROM session_answers WHERE session_id = ?')
    .all(sessionId);
  const answers = new Map(answerRows.map((a) => [a.question_id, a]));

  const scored = scoreSubmission(
    session.paper,
    ordered,
    answerRows.map((a) => ({
      question_id: a.question_id,
      answer: a.answer,
      time_spent_seconds: a.time_spent_seconds,
    })),
    CONFIG,
  );
  const paper = getPaper(session.paper);

  const review = ordered.map((q, i) => {
    const a = answers.get(q.id);
    const p = scored.perQuestion.find((x) => x.question_id === q.id);
    let options = [];
    try {
      options = JSON.parse(q.options_json || '[]');
    } catch {
      options = [];
    }
    return {
      number: i + 1,
      question_number: q.question_number,
      id: q.id,
      year: q.year,
      source_type: q.source_type,
      is_official_pyq: Boolean(q.is_official_pyq),
      question_text: q.question_text,
      passage: q.passage || null,
      options,
      your_answer: a?.answer || null,
      correct_answer: q.correct_answer || null,
      result: p?.result || 'unattempted',
      marked: Boolean(a?.marked),
      time_spent_seconds: a?.time_spent_seconds || 0,
      estimated_time_seconds: q.estimated_time_seconds,
      subject: q.subject,
      topic: q.topic,
      subtopic: q.subtopic,
      difficulty: q.difficulty,
      question_type: q.question_type,
      explanation: q.explanation || null,
      concept: q.concept || null,
      source: q.source || null,
      validation_state: q.validation_state,
    };
  });

  const timeUsed = session.time_used_seconds || 0;
  const timeRemaining = Math.max(0, session.duration_seconds - timeUsed);

  const result = {
    session: publicSession(session),
    paper: {
      id: paper.id,
      title: paper.title,
      marks: paper.marks,
      questionCount: paper.questionCount,
      qualifying: paper.qualifying,
      durationMinutes: paper.durationMinutes,
    },
    score: {
      marksObtained: scored.marksObtained,
      totalMarks: paper.marks,
      attempted: scored.attempted,
      correct: scored.correct,
      incorrect: scored.incorrect,
      unattempted: scored.unattempted,
      accuracy: scored.accuracy,
      negativeMarks: scored.negativeMarks,
      correctMarks: scored.correctMarks,
      timeUsedSeconds: timeUsed,
      timeRemainingSeconds: timeRemaining,
      autoSubmitted: session.status === 'AUTO_SUBMITTED',
    },
    qualification: paper.qualifying
      ? csatQualification(scored.marksObtained, session.paper, CONFIG)
      : gsCutoffEstimate(scored.marksObtained, CONFIG),
    review,
    distribution: reviewBreakdown(review),
    time: timeBreakdown(review),
  };
  return result;
}

function reviewBreakdown(review) {
  const bySubject = {};
  const byType = {};
  const byDifficulty = {};
  const byTopic = {};
  const bump = (bucket, key, item) => {
    if (!key) return;
    if (!bucket[key]) bucket[key] = { total: 0, correct: 0, attempted: 0, timeSeconds: 0 };
    bucket[key].total += 1;
    if (item.result !== 'unattempted') bucket[key].attempted += 1;
    if (item.result === 'correct') bucket[key].correct += 1;
    bucket[key].timeSeconds += item.time_spent_seconds || 0;
  };
  for (const r of review) {
    bump(bySubject, r.subject, r);
    bump(byTopic, r.topic, r);
    bump(byType, r.question_type, r);
    bump(byDifficulty, r.difficulty, r);
  }
  const finalize = (bucket) =>
    Object.fromEntries(
      Object.entries(bucket).map(([k, v]) => [
        k,
        {
          ...v,
          accuracy: v.attempted ? Math.round((v.correct / v.attempted) * 100) : 0,
          timeSeconds: Math.round(v.timeSeconds),
          averageTimeSeconds: v.total ? Math.round(v.timeSeconds / v.total) : 0,
        },
      ]),
    );
  return {
    subject: finalize(bySubject),
    topic: finalize(byTopic),
    questionType: finalize(byType),
    difficulty: finalize(byDifficulty),
  };
}

function timeBreakdown(review) {
  const times = review.map((r) => Number(r.time_spent_seconds || 0)).filter((t) => t > 0).sort((a, b) => a - b);
  if (!times.length) return { count: 0 };
  const sum = times.reduce((a, b) => a + b, 0);
  return {
    count: times.length,
    averageSeconds: Math.round(sum / times.length),
    medianSeconds: Math.round(times[Math.floor(times.length / 2)]),
    fastest: { seconds: Math.round(times[0]), question: review.find((r) => r.time_spent_seconds === times[0])?.number },
    slowest: {
      seconds: Math.round(times[times.length - 1]),
      question: review.find((r) => r.time_spent_seconds === times[times.length - 1])?.number,
    },
    totalSeconds: Math.round(sum),
  };
}

export default {
  createSession,
  getSession,
  listSessions,
  activeSessions,
  syncSession,
  saveAnswer,
  setMarked,
  submitSession,
  buildResult,
  playableQuestions,
  remainingSeconds,
  publicSession,
};
