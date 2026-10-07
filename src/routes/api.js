import { Router } from 'express';
import CONFIG, { yearRange, paperList } from '../../config/exam.config.js';
import { getDb, now } from '../db/database.js';
import { fullPaperStatus, assertFullPaperAllowed } from '../services/availability.js';
import {
  buildMixedPaper,
  buildSelectiveSet,
  pickExactPaper,
  distributionReport,
} from '../services/selection.js';
import { previewTiming, bufferSeconds, formatDuration } from '../services/timing.js';
import {
  createSession,
  syncSession,
  saveAnswer,
  setMarked,
  submitSession,
  buildResult,
  listSessions,
  activeSessions,
  publicSession,
  playableQuestions,
} from '../services/sessionService.js';
import analytics from '../services/analytics.js';
import { masteryOverview } from '../services/mastery.js';
import { countPool } from '../services/selection.js';

const router = Router();

/* ------------------------------------------------------------------ config */
router.get('/config', (req, res) => {
  res.json({
    app: { name: CONFIG.APP.NAME, timezone: CONFIG.APP.TIMEZONE },
    years: { start: CONFIG.YEARS.START_YEAR, end: CONFIG.YEARS.END_YEAR },
    papers: paperList().map((p) => ({
      id: p.id,
      title: p.title,
      shortTitle: p.shortTitle,
      description: p.description,
      questionCount: p.questionCount,
      durationMinutes: p.durationMinutes,
      marks: p.marks,
      qualifying: p.qualifying,
      qualifyingPercentage: p.qualifyingPercentage,
      marksPerQuestion: p.marksPerQuestion,
      negativeFraction: Math.round(p.negativeFraction * 1000) / 1000,
    })),
    subjects: CONFIG.SUBJECTS,
    questionTypes: CONFIG.QUESTION_TYPES,
    difficulties: CONFIG.DIFFICULTIES,
    selective: {
      bufferSeconds: bufferSeconds(),
      minBuffer: CONFIG.SELECTIVE.MIN_BUFFER_SECONDS,
      maxBuffer: CONFIG.SELECTIVE.MAX_BUFFER_SECONDS,
      presets: CONFIG.SELECTIVE.PRESET_COUNTS,
      customMax: CONFIG.SELECTIVE.CUSTOM_MAX,
      locked: CONFIG.SELECTIVE.LOCKED,
    },
    mastery: CONFIG.MASTERY,
    scoring: {
      rule: CONFIG.SCORING.RULE,
      cutoffRange: CONFIG.SCORING.GS_CUTOFF_ESTIMATE_RANGE,
      disclaimer: CONFIG.SCORING.CUTOFF_DISCLAIMER,
    },
    sourceTypes: CONFIG.SOURCE_TYPES,
    validationStates: CONFIG.VALIDATION_STATES,
  });
});

/* --------------------------------------------------------------- dashboard */
router.get('/dashboard', (req, res) => {
  const overview = analytics.overview();
  res.json({
    ...overview,
    fullPaper: fullPaperStatus(),
    coverage: analytics.coverage().totals,
    bufferSeconds: bufferSeconds(),
  });
});

/* ------------------------------------------------ full paper (Sunday only) */
router.get('/full-paper/status', (req, res) => {
  res.json(fullPaperStatus());
});

router.get('/exact-papers', (req, res) => {
  res.json(analytics.coverage());
});

router.post('/full-paper/start', (req, res) => {
  // Server-side gate: the client cannot bypass the Sunday lock.
  assertFullPaperAllowed();
  const { kind = 'exact', paper = 'GS1', year = null } = req.body || {};
  const paperCfg = CONFIG.PAPERS[paper];
  if (!paperCfg) return res.status(400).json({ error: 'Unknown paper.' });

  // Resume: never reset an exam already in progress (same kind only).
  const existing = activeSessions().find(
    (s) =>
      s.paper === paper &&
      (s.mode === 'FULL_EXACT' || s.mode === 'FULL_MIXED') &&
      (kind === 'mixed' ? s.mode === 'FULL_MIXED' : s.mode === 'FULL_EXACT') &&
      (kind === 'exact' ? Number(s.config?.year) === Number(year) : true),
  );
  if (existing) {
    return res.json({ resumed: true, ...syncSession(existing.id) });
  }

  let questionIds;
  let title;
  let mode;
  let kindLabel;
  let seed = null;
  let distribution = null;

  if (kind === 'exact') {
    if (!year) return res.status(400).json({ error: 'year is required for an exact paper.' });
    const picked = pickExactPaper(year, paper);
    if (!picked.complete) {
      return res.status(409).json({
        code: 'DATA_MISSING',
        error: `DATA MISSING — ${year} ${paperCfg.shortTitle}: ${picked.found}/${picked.expected} questions imported. Official papers are never invented; import the paper first (Admin → Import).`,
        found: picked.found,
        expected: picked.expected,
      });
    }
    questionIds = picked.questionIds;
    title = `UPSC CSE Prelims ${year} · ${paperCfg.shortTitle}`;
    mode = 'FULL_EXACT';
    kindLabel = 'EXACT PYQ PAPER';
  } else if (kind === 'mixed') {
    const built = buildMixedPaper(paper, paperCfg.questionCount, {});
    questionIds = built.questions.map((q) => q.id);
    title = `Mixed PYQ Paper · ${CONFIG.YEARS.START_YEAR}–${CONFIG.YEARS.END_YEAR} · ${paperCfg.shortTitle}`;
    mode = 'FULL_MIXED';
    kindLabel = 'MIXED PYQ PAPER';
    seed = built.seed;
    distribution = built.distribution;
  } else {
    return res.status(400).json({ error: 'kind must be "exact" or "mixed".' });
  }

  const session = createSession({
    mode,
    kindLabel,
    paper,
    title,
    questionIds,
    durationSeconds: paperCfg.durationMinutes * 60,
    config: { kind, year, distribution, strictTimer: true, answersHidden: true },
    seed,
  });

  res.json({
    resumed: false,
    session: publicSession(session),
    questions: playableQuestions(session),
    answers: [],
    serverNow: new Date(now()).toISOString(),
    remainingSeconds: Math.round((session.deadline_at - now()) / 1000),
    durationSeconds: session.duration_seconds,
    syncIntervalMs: CONFIG.SESSION.SYNC_INTERVAL_MS,
    distribution,
  });
});

/* --------------------------------------------------- selective practice */
router.get('/selective/options', (req, res) => {
  const db = getDb();
  const topics = db
    .prepare(
      `SELECT subject, topic, COUNT(*) AS count FROM questions
       WHERE is_duplicate = 0 AND correct_answer IS NOT NULL AND validation_state IN ('PARSED','REVIEW_REQUIRED','VERIFIED')
       GROUP BY subject, topic ORDER BY subject, count DESC`,
    )
    .all();
  const counts = {
    GS1: countPool({ paper: 'GS1' }),
    CSAT: countPool({ paper: 'CSAT' }),
    official: countPool({ sourceTypes: ['OFFICIAL_PYQ'] }),
    aiGenerated: countPool({ sourceTypes: ['AI_GENERATED'] }),
    custom: countPool({ sourceTypes: ['CUSTOM'] }),
  };
  counts.total = counts.GS1 + counts.CSAT;
  res.json({
    subjects: CONFIG.SUBJECTS,
    questionTypes: CONFIG.QUESTION_TYPES,
    difficulties: CONFIG.DIFFICULTIES,
    years: yearRange(),
    topics,
    counts,
    presets: CONFIG.SELECTIVE.PRESET_COUNTS,
    customMax: CONFIG.SELECTIVE.CUSTOM_MAX,
    bufferSeconds: bufferSeconds(),
    available: true,
  });
});

function selectiveFilters(body = {}) {
  const filters = {};
  if (body.papers?.length) filters.papers = body.papers;
  else if (body.paper) filters.papers = [body.paper];
  if (body.subjects?.length) filters.subjects = body.subjects;
  if (body.topics?.length) filters.topics = body.topics;
  if (body.subtopics?.length) filters.subtopics = body.subtopics;
  if (body.types?.length) filters.types = body.types;
  if (body.difficulties?.length) filters.difficulties = body.difficulties;
  if (body.years?.length) filters.years = body.years;
  if (body.includeIds?.length) filters.includeIds = body.includeIds;

  const sourceTypes = [];
  if (body.includeOfficial !== false) sourceTypes.push('OFFICIAL_PYQ');
  if (body.includeAiGenerated) sourceTypes.push('AI_GENERATED');
  if (body.includeCustom) sourceTypes.push('CUSTOM');
  filters.sourceTypes = sourceTypes.length ? sourceTypes : ['OFFICIAL_PYQ'];

  if (body.avoidSeen) filters.avoidSeen = true;
  return filters;
}

router.post('/selective/preview', (req, res) => {
  const body = req.body || {};
  const filters = selectiveFilters(body);
  const count = body.count === 'all' || body.count === null ? null : Number(body.count);
  const built = buildSelectiveSet(filters, count, { seed: body.seed });
  const timing = previewTiming(built.questions);
  res.json({
    requested: count,
    actual: built.actual,
    poolSize: built.poolSize,
    seed: built.seed,
    timing: {
      ...timing,
      totalFormatted: formatDuration(timing.totalSeconds),
    },
    distribution: distributionReport(built.questions),
    sourceMix: built.questions.reduce((acc, q) => {
      acc[q.source_type] = (acc[q.source_type] || 0) + 1;
      return acc;
    }, {}),
    questionIds: built.questions.map((q) => q.id),
  });
});

router.post('/selective/start', (req, res) => {
  const body = req.body || {};
  const filters = selectiveFilters(body);
  const count = body.count === 'all' || body.count === null || body.count === 'ALL'
    ? null
    : Number(body.count);

  const built = buildSelectiveSet(filters, count, { seed: body.seed });
  const timing = previewTiming(built.questions);

  const subjects = [...new Set(built.questions.map((q) => q.subject).filter(Boolean))];
  const papers = [...new Set(built.questions.map((q) => q.paper))];
  const titleParts = [];
  if (subjects.length === 1) titleParts.push(subjects[0]);
  else if (filters.topics?.length === 1) titleParts.push(filters.topics[0]);
  else if (papers.length === 1) titleParts.push(papers[0] === 'GS1' ? 'GS Paper I' : 'CSAT');
  else titleParts.push('Mixed practice');
  titleParts.push(`${built.actual} questions`);

  const session = createSession({
    mode: 'SELECTIVE',
    kindLabel: 'SELECTIVE PRACTICE',
    paper: papers.length === 1 ? papers[0] : papers.includes('GS1') ? 'GS1' : 'CSAT',
    title: titleParts.join(' · '),
    questionIds: built.questions.map((q) => q.id),
    durationSeconds: timing.totalSeconds,
    config: {
      filters,
      timing,
      bufferSeconds: timing.bufferSeconds,
      sourceMix: built.questions.reduce((acc, q) => {
        acc[q.source_type] = (acc[q.source_type] || 0) + 1;
        return acc;
      }, {}),
      avoidSeen: Boolean(body.avoidSeen),
    },
    seed: built.seed,
  });

  res.json({
    session: publicSession(session),
    questions: playableQuestions(session),
    answers: [],
    serverNow: new Date(now()).toISOString(),
    remainingSeconds: Math.round((session.deadline_at - now()) / 1000),
    durationSeconds: session.duration_seconds,
    timing,
    syncIntervalMs: CONFIG.SESSION.SYNC_INTERVAL_MS,
  });
});

/** PYQ explorer practice: same questions, dynamic timing, always unlocked. */
router.post('/pyq/practice', (req, res) => {
  const { year, paper } = req.body || {};
  const paperCfg = CONFIG.PAPERS[paper];
  if (!paperCfg || !year) return res.status(400).json({ error: 'year and paper are required.' });

  const picked = pickExactPaper(year, paper);
  if (!picked.questionIds.length) {
    return res.status(409).json({
      code: 'DATA_MISSING',
      error: `DATA MISSING — ${year} ${paperCfg.shortTitle} has not been imported.`,
    });
  }
  const built = buildSelectiveSet(
    { papers: [paper], years: [Number(year)], includeIds: picked.questionIds },
    null,
    {},
  );
  const timing = previewTiming(built.questions);
  const session = createSession({
    mode: 'PYQ_PRACTICE',
    kindLabel: 'PYQ PRACTICE',
    paper,
    title: `UPSC ${year} · ${paperCfg.shortTitle} · Practice`,
    questionIds: built.questions.map((q) => q.id),
    durationSeconds: timing.totalSeconds,
    config: { timing, year, answersHidden: true, officialOnly: true },
    seed: built.seed,
  });
  res.json({
    session: publicSession(session),
    questions: playableQuestions(session),
    answers: [],
    serverNow: new Date(now()).toISOString(),
    remainingSeconds: Math.round((session.deadline_at - now()) / 1000),
    durationSeconds: session.duration_seconds,
    timing,
    syncIntervalMs: CONFIG.SESSION.SYNC_INTERVAL_MS,
  });
});

/* ---------------------------------------------------------------- sessions */
router.get('/sessions/active', (req, res) => {
  const active = activeSessions();
  res.json({ sessions: active.map(publicSession) });
});

router.get('/sessions', (req, res) => {
  res.json({
    sessions: listSessions({
      limit: Math.min(100, Number(req.query.limit) || 20),
      mode: req.query.mode || null,
    }).map(publicSession),
  });
});

router.get('/sessions/:id', (req, res) => {
  res.json(syncSession(req.params.id));
});

router.post('/sessions/:id/answer', (req, res) => {
  const { questionId, answer, timeSpentSeconds, marked, visited } = req.body || {};
  if (!questionId) return res.status(400).json({ error: 'questionId is required.' });
  res.json(
    saveAnswer(req.params.id, {
      questionId,
      answer,
      timeSpentSeconds,
      marked,
      visited,
    }),
  );
});

router.post('/sessions/:id/mark', (req, res) => {
  const { questionId, marked } = req.body || {};
  if (!questionId) return res.status(400).json({ error: 'questionId is required.' });
  res.json(setMarked(req.params.id, questionId, Boolean(marked)));
});

router.post('/sessions/:id/submit', (req, res) => {
  const session = submitSession(req.params.id, { auto: false });
  res.json({ submitted: true, session: publicSession(session) });
});

router.get('/sessions/:id/result', (req, res) => {
  res.json(buildResult(req.params.id));
});

/* --------------------------------------------------------------------- PYQ */
router.get('/pyq/coverage', (req, res) => {
  res.json(analytics.coverage());
});

router.get('/pyq/questions', (req, res) => {
  const { year, paper } = req.query;
  const db = getDb();
  const clauses = ['q.is_duplicate = 0', "q.source_type = 'OFFICIAL_PYQ'"];
  const params = [];
  if (year) {
    clauses.push('q.year = ?');
    params.push(Number(year));
  }
  if (paper) {
    clauses.push('q.paper = ?');
    params.push(paper);
  }
  const rows = db
    .prepare(
      `SELECT q.id, q.year, q.paper, q.question_number, q.question_text, q.options_json,
              q.subject, q.topic, q.difficulty, q.question_type, q.validation_state,
              q.correct_answer, q.explanation, q.is_official_pyq,
              s.attempt_count, s.correct_count, s.incorrect_count, s.skipped_count, s.last_attempted_at,
              (SELECT answer FROM session_answers a JOIN test_sessions t ON t.id = a.session_id
                WHERE a.question_id = q.id AND t.status != 'IN_PROGRESS'
                ORDER BY t.submitted_at DESC LIMIT 1) AS last_answer
       FROM questions q
       LEFT JOIN question_stats s ON s.question_id = q.id
       WHERE ${clauses.join(' AND ')}
       ORDER BY q.paper, q.question_number ASC`,
    )
    .all(...params);

  res.json({
    questions: rows.map((r) => {
      const attempted = Number(r.attempt_count || 0) > 0;
      let options = [];
      try {
        options = JSON.parse(r.options_json || '[]');
      } catch {
        options = [];
      }
      return {
        id: r.id,
        year: r.year,
        paper: r.paper,
        question_number: r.question_number,
        question_text: r.question_text,
        options,
        subject: r.subject,
        topic: r.topic,
        difficulty: r.difficulty,
        question_type: r.question_type,
        validation_state: r.validation_state,
        // Answers are revealed only after the question has been practised.
        correct_answer: attempted ? r.correct_answer : null,
        explanation: attempted ? r.explanation : null,
        status: !attempted
          ? 'NEVER_ATTEMPTED'
          : Number(r.correct_count) > 0 && Number(r.incorrect_count) === 0
            ? 'CORRECT'
            : Number(r.correct_count) > 0
              ? 'MIXED'
              : Number(r.skipped_count) > 0 && Number(r.incorrect_count) === 0
                ? 'SKIPPED'
                : 'INCORRECT',
        attempt_count: r.attempt_count || 0,
        correct_count: r.correct_count || 0,
        incorrect_count: r.incorrect_count || 0,
        last_attempted_at: r.last_attempted_at,
        last_answer: r.last_answer,
        is_official_pyq: Boolean(r.is_official_pyq),
      };
    }),
  });
});

/** "Practice 5 similar questions" — same subject/topic, untested ones first. */
router.get('/questions/:id/similar', (req, res) => {
  const db = getDb();
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Question not found.' });
  const limit = Math.min(20, Number(req.query.limit) || 5);
  const rows = db
    .prepare(
      `SELECT q.id, q.question_text, q.subject, q.topic, q.year, q.paper, q.question_number,
              (SELECT attempt_count FROM question_stats WHERE question_id = q.id) AS attempts
       FROM questions q
       WHERE q.is_duplicate = 0 AND q.correct_answer IS NOT NULL AND q.id != ?
         AND validation_state IN ('PARSED','REVIEW_REQUIRED','VERIFIED')
         AND ((q.topic = ? AND q.topic IS NOT NULL) OR (q.topic IS NULL AND q.subject = ?))
       ORDER BY COALESCE(attempts, 0) ASC, q.year DESC
       LIMIT ?`,
    )
    .all(q.id, q.topic, q.subject, limit);
  return res.json({ concept: q.concept, subject: q.subject, topic: q.topic, questions: rows });
});

/* -------------------------------------------------------------- analytics */
router.get('/analytics/overview', (req, res) => res.json(analytics.overview()));
router.get('/analytics/performance', (req, res) =>
  res.json(
    analytics.performanceBy(req.query.dimension || 'subject', {
      paper: req.query.paper || null,
      minAttempts: Number(req.query.minAttempts) || 1,
    }),
  ),
);
router.get('/analytics/time', (req, res) => res.json(analytics.timeAnalytics()));
router.get('/analytics/trend', (req, res) => res.json({ sessions: analytics.trend(Number(req.query.limit) || 30) }));
router.get('/analytics/failures', (req, res) => res.json({ questions: analytics.repeatedFailures(Number(req.query.limit) || 25) }));
router.get('/analytics/calibration', (req, res) => res.json({ items: analytics.calibrationReport(Number(req.query.limit) || 40) }));
router.get('/analytics/coverage', (req, res) => res.json(analytics.coverage()));
router.get('/analytics/mastery', (req, res) => res.json(masteryOverview({ paper: req.query.paper || null })));

export default router;
