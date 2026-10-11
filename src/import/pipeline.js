import { getDb, now, newId, toJson, audit } from '../db/database.js';
import { parseJsonPayload, applyAnswerKey } from './parsers/jsonParser.js';
import { parsePaperText } from './parsers/textParser.js';
import { insertMany, refreshCoverage } from '../services/questionService.js';

/**
 * IMPORT PIPELINE
 * ---------------
 *   source (JSON / raw text / PDF text layer / answer key)
 *     → parse
 *     → structural validation + duplicate detection
 *     → classification defaults (metadata can be fixed in Admin)
 *     → database (batch + per-question validation states)
 *
 * States: IMPORTED → PARSED → REVIEW_REQUIRED → VERIFIED
 * Nothing is ever invented: unparseable sources come back as warnings.
 */

async function newBatch(filename, format, sourceType, exam = null) {
  const id = newId('batch');
  await getDb()
    .prepare(
      `INSERT INTO import_batches (id, filename, format, source_type, exam, state, created_at)
       VALUES (?, ?, ?, ?, ?, 'IMPORTED', ?)`,
    )
    .run(id, filename || null, format, sourceType || null, exam, now());
  return id;
}

async function finishBatch(id, patch) {
  await getDb()
    .prepare(
      `UPDATE import_batches SET state = ?, total = ?, inserted = ?, duplicates = ?,
         rejected = ?, needs_review = ?, notes = ? WHERE id = ?`,
    )
    .run(
      patch.state,
      patch.total,
      patch.inserted,
      patch.duplicates,
      patch.rejected,
      patch.needsReview,
      patch.notes ? toJson(patch.notes) : null,
      id,
    );
  return getDb().prepare('SELECT * FROM import_batches WHERE id = ?').get(id);
}

export async function listBatches(limit = 30) {
  return getDb()
    .prepare('SELECT * FROM import_batches ORDER BY created_at DESC LIMIT ?')
    .all(limit);
}

/**
 * Import structured questions (canonical JSON).
 */
export async function importJson({ content, filename = 'upload.json', sourceType = 'OFFICIAL_PYQ', exam = null, tier = null, shift = null }) {
  const { meta, questions, answerKey } = parseJsonPayload(content);
  const withKey = applyAnswerKey(questions, answerKey);
  // Request-level exam defaults fill gaps left by the file's own meta.
  const stamped = withKey.questions.map((q) => ({
    ...q,
    exam: q.exam || exam || null,
    tier: q.tier || tier || null,
    shift: q.shift || shift || null,
  }));
  const batchId = await newBatch(filename, 'json', sourceType || meta.source_type, stamped[0]?.exam || exam);

  const summary = await insertMany(stamped, { batchId, source: meta.source });
  const state = summary.inserted === 0 ? 'REVIEW_REQUIRED' : summary.review > 0 ? 'REVIEW_REQUIRED' : 'PARSED';
  const batch = await finishBatch(batchId, {
    state,
    total: summary.total,
    inserted: summary.inserted,
    duplicates: summary.duplicates,
    rejected: summary.rejected,
    needsReview: summary.review,
    notes: {
      warnings: summary.errors.slice(0, 50),
      answerKeyApplied: withKey.applied,
      meta,
    },
  });
  await refreshCoverage();
  return { batch, summary: { ...summary, answerKeyApplied: withKey.applied }, batchId };
}

/**
 * Import raw paper text (from a PDF text layer or a transcription).
 * Questions land as REVIEW_REQUIRED until an answer key is attached and an
 * admin verifies them.
 */
export async function importText({ content, filename = 'paper.txt', year = null, paper = 'GS1', source = null, exam = null, tier = null, shift = null }) {
  const parsed = parsePaperText(content, {
    paper,
    year,
    source: source || filename,
    exam,
    tier,
    shift,
  });
  const batchId = await newBatch(filename, 'text', 'OFFICIAL_PYQ', exam);
  const summary = await insertMany(parsed.questions, { batchId, source: source || filename });
  const needsReview = summary.inserted; // text imports always need verification
  const batch = await finishBatch(batchId, {
    state: parsed.questions.length ? 'REVIEW_REQUIRED' : 'IMPORTED',
    total: parsed.questions.length,
    inserted: summary.inserted,
    duplicates: summary.duplicates,
    rejected: summary.rejected,
    needsReview,
    notes: { warnings: parsed.warnings.slice(0, 100), preamble: parsed.preamble.slice(0, 500) },
  });
  await refreshCoverage();
  return { batch, summary: { ...summary, warnings: parsed.warnings }, batchId };
}

/* ------------------------------------------------------------- answer keys */

export function parseAnswerKeyText(text) {
  const out = {};
  const re = /^\s*(\d{1,3})\s*[.):\-]?\s*\(?\s*([a-fA-F])\s*\)?\s*$/;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.trim().match(re);
    if (m) out[m[1]] = m[2].toUpperCase();
  }
  return out;
}

/**
 * Attach an official/community answer key to an already-imported paper.
 * Updates correct_answer for matching (year, paper, question_number).
 */
export async function importAnswerKey({ content, year, paper, filename = 'answer-key', shift = null }) {
  let answers = {};
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.startsWith('{')) {
      const data = JSON.parse(trimmed);
      answers = data.answers || data;
      if (answers.year) year = answers.year;
      if (answers.paper) paper = answers.paper;
      if (answers.answers) answers = answers.answers;
    } else {
      answers = parseAnswerKeyText(content);
    }
  } else if (content && typeof content === 'object') {
    answers = content.answers || content;
  }

  const db = getDb();
  const batchId = await newBatch(filename, 'answerkey', 'ANSWER_KEY');
  let applied = 0;
  const missing = [];
  const conflicts = [];

  for (const [numStr, ansRaw] of Object.entries(answers)) {
    const num = Number(numStr);
    const ans = String(ansRaw).toUpperCase().replace(/[().]/g, '').trim();
    if (!Number.isFinite(num) || !/^[A-F]$/.test(ans)) continue;
    const row = await db
      .prepare(
        `SELECT id, correct_answer, validation_state, options_json FROM questions
         WHERE year = ? AND paper = ? AND question_number = ? AND is_duplicate = 0
           AND (shift IS ? OR shift = ?)`,
      )
      .get(Number(year), paper, num, shift ?? null, shift ?? null);
    if (!row) {
      missing.push(num);
      continue;
    }
    if (row.correct_answer && row.correct_answer !== ans) {
      conflicts.push({ number: num, existing: row.correct_answer, incoming: ans });
    }
    await db.prepare(
      `UPDATE questions SET correct_answer = ?, updated_at = ?,
         validation_state = CASE WHEN validation_state = 'VERIFIED' THEN 'VERIFIED'
           WHEN validation_state = 'IMPORTED' THEN 'PARSED' ELSE validation_state END
       WHERE id = ?`,
    ).run(ans, now(), row.id);
    applied += 1;
    audit('question', row.id, 'answer_key', { correct_answer: row.correct_answer }, { correct_answer: ans }, 'import');
  }

  const batch = await finishBatch(batchId, {
    state: applied ? 'PARSED' : 'REVIEW_REQUIRED',
    total: Object.keys(answers).length,
    inserted: 0,
    duplicates: 0,
    rejected: missing.length,
    needsReview: conflicts.length + missing.length,
    notes: { applied, missingNumbers: missing.slice(0, 100), conflicts: conflicts.slice(0, 50), year, paper },
  });
  await refreshCoverage();
  return { batch, applied, missing, conflicts, batchId };
}

/** Unified entry point used by the CLI and the admin API. */
export async function runImport({ format, content, meta = {} }) {
  switch (format) {
    case 'json':
      return await importJson({
        content,
        filename: meta.filename,
        sourceType: meta.sourceType || 'OFFICIAL_PYQ',
        exam: meta.exam || null,
        tier: meta.tier || null,
        shift: meta.shift || null,
      });
    case 'text':
      return await importText({
        content,
        filename: meta.filename,
        year: meta.year,
        paper: meta.paper,
        source: meta.source,
        exam: meta.exam || null,
        tier: meta.tier || null,
        shift: meta.shift || null,
      });
    case 'answerkey':
      return await importAnswerKey({
        content,
        year: meta.year,
        paper: meta.paper,
        filename: meta.filename,
        shift: meta.shift || null,
      });
    default: {
      const err = new Error(`Unknown import format: ${format}`);
      err.status = 400;
      throw err;
    }
  }
}

export default { runImport, importJson, importText, importAnswerKey, parseAnswerKeyText, listBatches };
