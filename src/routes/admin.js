import { Router } from 'express';
import CONFIG from '../../config/exam.config.js';
import { getDb, now } from '../db/database.js';
import {
  searchQuestions,
  updateQuestion,
  verifyQuestion,
  markDuplicate,
  deleteQuestion,
  refreshCoverage,
} from '../services/questionService.js';
import { runImport, listBatches } from '../import/pipeline.js';

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

export default router;
