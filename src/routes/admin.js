import { Router } from 'express';
import CONFIG, { EXAMS, DEFAULT_EXAM } from '../../config/exam.config.js';
import { getDb, now, audit, newId, toJson } from '../db/database.js';
import {
  searchQuestions,
  updateQuestion,
  verifyQuestion,
  markDuplicate,
  deleteQuestion,
  refreshCoverage,
} from '../services/questionService.js';
import { runImport, listBatches } from '../import/pipeline.js';
import { getSscConfig, setSscConfig, sscConfigDefaults } from '../services/sscConfig.js';
import {
  computeCutoff, resolveBaseline, seedHistoricalCutoffs,
  listHistoricalCutoffs, addHistoricalCutoff, metadataDifficulty,
} from '../services/cutoff.js';
import {
  currentCycle, getCycle, listCycles, cycleView, cycleDateKey, cycleWindow,
  finalizeCycle,
} from '../services/sscCycle.js';

/**
 * ADMIN / DATA VALIDATION
 * Protected by x-admin-token (see config APP.ADMIN_TOKEN).
 * Verified official PYQ text is locked: metadata edits only.
 */
const router = Router();

router.use((req, res, next) => {
  const token = req.get('x-admin-token');
  if (token !== CONFIG.APP.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Admin token required (x-admin-token).' });
  }
  return next();
});

router.get('/stats', (req, res) => {
  const db = getDb();
  const byState = db
    .prepare('SELECT validation_state, source_type, COUNT(*) AS n FROM questions GROUP BY validation_state, source_type')
    .all();
  const unkeyed = db
    .prepare("SELECT COUNT(*) AS n FROM questions WHERE correct_answer IS NULL OR correct_answer = ''")
    .get().n;
  const duplicates = db
    .prepare(
      `SELECT content_hash, COUNT(*) AS n FROM questions
       WHERE is_duplicate = 0 GROUP BY content_hash HAVING COUNT(*) > 1`,
    )
    .all();
  res.json({ byState, unkeyed, duplicateGroups: duplicates, batches: listBatches(10) });
});

router.get('/questions', (req, res) => {
  const { page = 1, pageSize = 25, ...filters } = req.query;
  res.json(searchQuestions(filters, { page: Number(page), pageSize: Math.min(100, Number(pageSize)) }));
});

router.get('/questions/:id', (req, res) => {
  const q = getDb().prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Question not found.' });
  let options = [];
  try {
    options = JSON.parse(q.options_json || '[]');
  } catch {
    options = [];
  }
  return res.json({ ...q, options });
});

router.patch('/questions/:id', (req, res) => {
  const allowTextEdit = Boolean(req.body?.allowTextEdit);
  const result = updateQuestion(req.params.id, req.body || {}, { allowTextEdit });
  res.json(result);
});

router.post('/questions/:id/verify', (req, res) => {
  res.json(verifyQuestion(req.params.id));
});

router.post('/questions/:id/duplicate', (req, res) => {
  res.json(markDuplicate(req.params.id));
});

router.delete('/questions/:id', (req, res) => {
  res.json(deleteQuestion(req.params.id));
});

router.post('/import', async (req, res) => {
  const { format, content, meta = {} } = req.body || {};
  if (!content) return res.status(400).json({ error: 'content is required.' });
  const result = await runImport({
    format,
    content,
    meta: { ...meta, filename: meta.filename || 'api-import' },
  });
  res.json(result);
});

router.get('/batches', (req, res) => {
  res.json({ batches: listBatches(50) });
});

router.get('/taxonomy', (req, res) => {
  res.json({
    defaultExam: DEFAULT_EXAM,
    exams: Object.values(EXAMS).map((e) => ({
      id: e.id,
      name: e.name,
      papers: Object.values(e.papers).map((p) => ({
        id: p.id,
        title: p.title,
        shortTitle: p.shortTitle,
        tier: p.tier || null,
        sections: p.sections,
        sectional: p.sectional,
      })),
      years: Array.from(
        { length: e.years.END_YEAR - e.years.START_YEAR + 1 },
        (_, i) => e.years.END_YEAR - i,
      ),
      subjects: e.subjects,
      topics: e.topics || null,
    })),
    subjects: CONFIG.SUBJECTS,
    questionTypes: CONFIG.QUESTION_TYPES,
    difficulties: CONFIG.DIFFICULTIES,
    sourceTypes: CONFIG.SOURCE_TYPES,
    validationStates: CONFIG.VALIDATION_STATES,
    years: Array.from(
      { length: CONFIG.YEARS.END_YEAR - CONFIG.YEARS.START_YEAR + 1 },
      (_, i) => CONFIG.YEARS.END_YEAR - i,
    ),
  });
});

router.get('/audit', (req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?')
    .all(Math.min(200, Number(req.query.limit) || 50));
  res.json({ entries: rows });
});

router.post('/coverage/refresh', (req, res) => {
  refreshCoverage();
  res.json({ refreshed: true, at: now() });
});

/* ============================================================ SSC CONFIGURATION */

router.get('/ssc/config', (req, res) => {
  res.json({ config: getSscConfig(), defaults: sscConfigDefaults() });
});

router.put('/ssc/config', (req, res) => {
  try {
    const before = getSscConfig();
    const after = setSscConfig(req.body || {});
    audit('ssc_config', 'SSC_CYCLE_CONFIG', 'update', before, after);
    res.json({ config: after });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Preview a cutoff calculation without creating or changing any cycle. */
router.post('/ssc/cutoff/preview', (req, res) => {
  try {
    const cfg = getSscConfig();
    const { difficulty = null, baselineOverride = null } = req.body || {};
    const baseline = baselineOverride != null
      ? { percent: Number(baselineOverride), source: 'PREVIEW_OVERRIDE', includesUnverified: false, years: [] }
      : resolveBaseline(cfg);
    const cutoff = computeCutoff(cfg, { difficulty, baseline });
    res.json({ cutoff, baseline, wouldClamp: cutoff.clampedAt != null });
  } catch (err) {
    res.status(err.status || 400).json({ code: err.code || 'PREVIEW_ERROR', error: err.message });
  }
});

/** Store (or update) a manual paper difficulty classification. */
router.post('/ssc/difficulty', (req, res) => {
  const { paperId = 'SSC_T1', cycleDate = null, difficulty } = req.body || {};
  if (!['EASY', 'MEDIUM', 'HARD'].includes(difficulty)) {
    return res.status(400).json({ error: 'difficulty must be EASY, MEDIUM or HARD.' });
  }
  const db = getDb();
  const at = now();
  const existing = db
    .prepare('SELECT * FROM paper_difficulty WHERE paper_id = ? AND (cycle_date IS ? OR cycle_date = ?)')
    .get(paperId, cycleDate, cycleDate);
  if (existing) {
    db.prepare('UPDATE paper_difficulty SET difficulty = ?, difficulty_source = ?, computed_json = ? WHERE id = ?')
      .run(difficulty, 'MANUAL', null, existing.id);
  } else {
    db.prepare(
      `INSERT INTO paper_difficulty (id, paper_id, cycle_date, difficulty, difficulty_source, created_at)
       VALUES (?, ?, ?, ?, 'MANUAL', ?)`,
    ).run(newId('pdiff'), paperId, cycleDate, difficulty, at);
  }
  audit('paper_difficulty', `${paperId}:${cycleDate || 'general'}`, 'classify', existing || null, { difficulty });
  // If this cycle already exists and is not finalized, record the difficulty
  // on the cycle itself (the persisted cutoff is NOT regenerated).
  const dateKey = cycleDate || cycleDateKey();
  const cycle = getCycle(`SSC-CGL-${dateKey}`);
  let cycleUpdated = false;
  if (cycle && !cycle.finalized_at) {
    db.prepare('UPDATE ssc_cycles SET difficulty = ?, difficulty_source = ?, updated_at = ? WHERE id = ?')
      .run(difficulty, 'MANUAL', at, cycle.id);
    cycleUpdated = true;
  }
  res.json({ stored: true, difficulty, cycleUpdated });
});

/* ------------------------------------------------- cycles + dashboard */

router.get('/ssc/cycles', (req, res) => {
  res.json({ cycles: listCycles({ limit: Number(req.query.limit) || 104 }).map((c) => cycleView(c)) });
});

router.get('/ssc/cycles/:id', (req, res) => {
  const cycle = getCycle(req.params.id);
  if (!cycle) return res.status(404).json({ error: 'Cycle not found.' });
  return res.json({ cycle: cycleView(cycle) });
});

/** Explicit, audited cutoff/classification override. Never rewrites scores. */
router.post('/ssc/cycles/:id/override', (req, res) => {
  const cycle = getCycle(req.params.id);
  if (!cycle) return res.status(404).json({ error: 'Cycle not found.' });
  if (cycle.finalized_at) {
    return res.status(409).json({
      code: 'CYCLE_FINALIZED',
      error: 'This cycle is finalized. A completed attempt\'s cutoff and score are immutable; wait for a new Sunday cycle.',
    });
  }
  const { cutoffPercent = null, difficulty = null, reason = null } = req.body || {};
  const before = {
    cutoffPercent: cycle.cutoff_percent,
    difficulty: cycle.difficulty,
    snapshot: cycle.cutoffSnapshot,
  };
  const db = getDb();
  const at = now();
  if (cutoffPercent != null) {
    const p = Number(cutoffPercent);
    if (!Number.isFinite(p) || p < 0 || p > 100) return res.status(400).json({ error: 'cutoffPercent must be 0–100.' });
    const snapshot = { ...cycle.cutoffSnapshot, overridden: true, overrideAt: new Date(at).toISOString(), overrideReason: reason, originalPercent: cycle.cutoff_percent };
    db.prepare('UPDATE ssc_cycles SET cutoff_percent = ?, cutoff_snapshot_json = ?, updated_at = ? WHERE id = ?')
      .run(p, toJson(snapshot), at, cycle.id);
  }
  if (difficulty != null) {
    if (!['EASY', 'MEDIUM', 'HARD'].includes(difficulty)) return res.status(400).json({ error: 'difficulty must be EASY, MEDIUM or HARD.' });
    db.prepare('UPDATE ssc_cycles SET difficulty = ?, difficulty_source = ?, updated_at = ? WHERE id = ?')
      .run(difficulty, 'MANUAL', at, cycle.id);
  }
  audit('ssc_cycle', cycle.id, 'override', before, { cutoffPercent, difficulty, reason });
  res.json({ overridden: true, cycle: cycleView(getCycle(cycle.id)) });
});

/** Manual finalization trigger (also runs automatically lazily after close). */
router.post('/ssc/cycles/:id/finalize', (req, res) => {
  const cycle = getCycle(req.params.id);
  if (!cycle) return res.status(404).json({ error: 'Cycle not found.' });
  const out = finalizeCycle(cycle.id, { force: true });
  res.json({ finalized: Boolean(out?.finalized_at), cycle: cycleView(out) });
});

router.get('/ssc/dashboard', (req, res) => {
  const cfg = getSscConfig();
  seedHistoricalCutoffs();
  const db = getDb();
  let current = null;
  try {
    const c = currentCycle({ autoFinalize: true });
    current = c?.missingDifficulty ? { missingDifficulty: true, dateKey: c.dateKey, id: c.id } : cycleView(c, cfg);
  } catch (err) {
    current = { error: err.message, code: err.code };
  }
  const stats = db.prepare(
    `SELECT
       SUM(CASE WHEN tier1_status = 'COMPLETED' THEN 1 ELSE 0 END) AS tier1Attempts,
       SUM(CASE WHEN qualification_status = 'QUALIFIED' THEN 1 ELSE 0 END) AS qualified,
       SUM(CASE WHEN qualification_status = 'NOT_QUALIFIED' THEN 1 ELSE 0 END) AS notQualified,
       SUM(CASE WHEN tier2_status = 'COMPLETED' THEN 1 ELSE 0 END) AS tier2Completed,
       SUM(CASE WHEN tier2_status = 'ABSENT' THEN 1 ELSE 0 END) AS tier2Absent,
       COUNT(*) AS totalCycles
     FROM ssc_cycles`,
  ).get();
  // Cycles whose Tier-I paper has no imported questions at all (DATA_MISSING).
  const missingPaperCycles = db.prepare(
    `SELECT COUNT(*) AS n FROM ssc_cycles c
     WHERE NOT EXISTS (
       SELECT 1 FROM questions q WHERE q.paper = c.tier1_paper_id AND q.is_duplicate = 0
         AND q.source_type = 'OFFICIAL_PYQ' AND q.correct_answer IS NOT NULL
     )`,
  ).get().n;
  const baseline = resolveBaseline(cfg);
  const win = cycleWindow(cycleDateKey(), cfg);
  const nextDate = (() => {
    const d = new Date(`${win.dateKey}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  })();
  const nextWin = cycleWindow(nextDate, cfg);
  res.json({
    config: cfg,
    current,
    stats: { ...stats, missingPaperCycles },
    baseline,
    window: { current: { dateKey: win.dateKey, openTime: win.openTime, closeTime: win.closeTime, timezone: win.timezone }, next: { dateKey: nextDate, openTime: nextWin.openTime, closeTime: nextWin.closeTime } },
  });
});

/* ------------------------------------------ historical cutoff reference data */

router.get('/ssc/cutoffs', (req, res) => {
  seedHistoricalCutoffs();
  res.json({ cutoffs: listHistoricalCutoffs({ category: req.query.category || null, list: req.query.list || null }) });
});

router.post('/ssc/cutoffs', (req, res) => {
  try {
    const row = addHistoricalCutoff(req.body || {});
    audit('ssc_cutoff_history', row.id, 'upsert', null, row);
    res.json({ cutoff: row });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/ssc/difficulty', (req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM paper_difficulty ORDER BY created_at DESC LIMIT 100')
    .all();
  const meta = metadataDifficulty(req.query.paperId || 'SSC_T1');
  res.json({ classifications: rows, metadata });
});

export default router;
