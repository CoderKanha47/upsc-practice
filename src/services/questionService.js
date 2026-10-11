import CONFIG, { EXAMS, getPaper, paperList } from '../../config/exam.config.js';
import { getDb, tx, now, newId, contentHash, toJson, audit } from '../db/database.js';
import { estimateSeconds } from './timing.js';

/**
 * QUESTION REPOSITORY
 * Structural validation, duplicate detection and guarded writes.
 */

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((o, i) => {
      if (typeof o === 'string') return { key: OPTION_KEYS[i] || String(i + 1), text: o };
      return {
        key: String(o.key ?? OPTION_KEYS[i] ?? i + 1).toUpperCase(),
        text: String(o.text ?? o.value ?? '').trim(),
      };
    })
    .filter((o) => o.text.length > 0)
    .map((o) => ({ key: o.key, text: o.text }));
}

/** Structural validation. Returns { ok, state, errors }. */
export function validateQuestion(data) {
  const errors = [];
  const warnings = [];

  if (!data.question_text || String(data.question_text).trim().length < 5) {
    errors.push('question_text is missing or too short');
  }
  const validPapers = new Set(paperList().map((p) => p.id));
  if (!validPapers.has(data.paper)) errors.push(`invalid paper: ${data.paper}`);

  const options = normalizeOptions(data.options);
  if (options.length < 2) errors.push('at least two options are required');
  if (options.length > 6) warnings.push('more than six options');

  const answer = data.correct_answer ? String(data.correct_answer).toUpperCase().trim() : null;
  if (answer) {
    const keys = options.map((o) => o.key);
    if (keys.length && !keys.includes(answer)) {
      errors.push(`correct_answer "${answer}" does not match any option`);
    }
  } else {
    warnings.push('correct_answer missing — answer key required');
  }

  if (data.source_type && !CONFIG.SOURCE_TYPES.includes(data.source_type)) {
    errors.push(`invalid source_type: ${data.source_type}`);
  }
  if (data.difficulty && !CONFIG.DIFFICULTIES.includes(data.difficulty)) {
    warnings.push(`unknown difficulty "${data.difficulty}" — defaulting to medium`);
  }

  let state = 'PARSED';
  if (errors.length) state = 'REVIEW_REQUIRED';
  else if (!answer) state = 'REVIEW_REQUIRED';

  return { ok: errors.length === 0, errors, warnings, state, options, answer };
}

export function dupKeyFor(data) {
  if (data.source_type !== 'OFFICIAL_PYQ') return null;
  if (data.year === null || data.year === undefined || !data.paper || data.question_number === null || data.question_number === undefined) {
    return null;
  }
  // Shift-wise SSC papers repeat question numbers across shifts, so the shift
  // is part of the identity when present. UPSC (no shift) keeps the legacy
  // `year|paper|number` key so existing rows stay unique-compatible.
  if (data.shift) return `${data.year}|${data.paper}|${data.shift}|${data.question_number}`;
  return `${data.year}|${data.paper}|${data.question_number}`;
}

/** Find an existing question with the same text (any source). */
export function findContentDuplicate(text) {
  const hash = contentHash(text);
  return getDb()
    .prepare(
      `SELECT id, year, paper, question_number, source_type, validation_state, is_duplicate
       FROM questions WHERE content_hash = ? AND is_duplicate = 0`,
    )
    .all(hash);
}

/**
 * Insert one question. Duplicates are detected by
 *   1) year+paper+question_number (official PYQ identity)
 *   2) content hash (same text from a different source)
 * and are recorded/reported rather than silently dropped.
 */
export async function insertQuestion(raw, { batchId = null, source = null } = {}) {
  const db = getDb();
  const data = { ...raw };
  data.source_type = data.source_type || 'OFFICIAL_PYQ';
  data.is_official_pyq = data.source_type === 'OFFICIAL_PYQ' ? 1 : 0;
  data.source = data.source || source || null;

  const v = validateQuestion(data);
  if (!v.ok) {
    return { status: 'rejected', errors: v.errors, warnings: v.warnings };
  }

  const dupKey = dupKeyFor(data);
  if (dupKey) {
    const clash = db
      .prepare(
        `SELECT id, validation_state FROM questions
         WHERE dup_key = ? AND is_duplicate = 0`,
      )
      .get(dupKey);
    if (clash) {
      return {
        status: 'duplicate',
        reason: `Already imported: ${dupKey}`,
        existingId: clash.id,
        warnings: v.warnings,
      };
    }
  }

  const textHash = contentHash(data.question_text);
  const textDupes = findContentDuplicate(data.question_text);

  const paper = getPaper(data.paper);
  const id = newId('q');
  const nowTs = now();
  const marks = Number(data.marks ?? paper.marksPerQuestion);
  const negative = Number(data.negative_marks ?? marks * paper.negativeFraction);
  const estimated = Number(
    data.estimated_time_seconds ||
      estimateSeconds(
        {
          question_type: data.question_type,
          difficulty: data.difficulty,
          paper: data.paper,
          passage: data.passage,
          groupSize: data.group_size || 1,
        },
        CONFIG,
      ),
  );

  const state = data.validation_state || v.state;

  await db.prepare(
    `INSERT INTO questions
      (id, year, exam, paper, tier, shift, question_number, question_text, passage, group_id, group_index,
       options_json, correct_answer, subject, topic, subtopic, difficulty, question_type,
       estimated_time_seconds, marks, negative_marks, source, source_type, is_official_pyq,
       validation_state, is_duplicate, dup_key, content_hash, explanation, concept,
       tags_json, batch_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.year ?? null,
    data.exam || paper.exam,
    data.paper,
    data.tier || paper.tier || null,
    data.shift || null,
    data.question_number ?? null,
    String(data.question_text).trim(),
    data.passage || null,
    data.group_id || null,
    data.group_index ?? null,
    toJson(v.options),
    v.answer,
    data.subject || null,
    data.topic || null,
    data.subtopic || null,
    data.difficulty && CONFIG.DIFFICULTIES.includes(data.difficulty) ? data.difficulty : 'medium',
    data.question_type && CONFIG.QUESTION_TYPES.includes(data.question_type)
      ? data.question_type
      : 'conceptual',
    estimated,
    marks,
    negative,
    data.source || source || null,
    data.source_type,
    data.is_official_pyq,
    state,
    dupKey,
    textHash,
    data.explanation || null,
    data.concept || null,
    toJson(data.tags || null),
    batchId,
    nowTs,
    nowTs,
  );

  if (batchId) {
    await db.prepare(
      `INSERT INTO question_stats (question_id, attempt_count, correct_count, incorrect_count,
        skipped_count, total_time_seconds, timed_count, consecutive_correct)
       VALUES (?, 0, 0, 0, 0, 0, 0, 0)
       ON CONFLICT(question_id) DO NOTHING`,
    ).run(id);
  }

  return {
    status: 'inserted',
    id,
    state,
    warnings: v.warnings,
    contentDuplicates: textDupes,
    flaggedForReview: v.state === 'REVIEW_REQUIRED',
  };
}

export async function insertMany(items, { batchId = null, source = null } = {}) {
  const summary = { total: items.length, inserted: 0, duplicates: 0, rejected: 0, review: 0, errors: [], duplicatesList: [] };
  await tx(async () => {
    for (const item of items) {
      const res = await insertQuestion(item, { batchId, source });
      if (res.status === 'inserted') {
        summary.inserted += 1;
        if (res.state === 'REVIEW_REQUIRED') summary.review += 1;
        if (res.contentDuplicates?.length) {
          summary.errors.push({
            id: res.id,
            warning: 'Content matches existing question(s)',
            matches: res.contentDuplicates.map((d) => d.id),
          });
        }
      } else if (res.status === 'duplicate') {
        summary.duplicates += 1;
        summary.duplicatesList.push(res.reason);
      } else {
        summary.rejected += 1;
        summary.errors.push(res.errors);
      }
    }
  });
  return summary;
}

/* ------------------------------------------------------------ admin writes */

const METADATA_FIELDS = [
  'subject', 'topic', 'subtopic', 'difficulty', 'question_type',
  'estimated_time_seconds', 'source', 'correct_answer', 'explanation', 'concept',
  'question_number', 'year', 'validation_state', 'source_type',
];

export async function updateQuestion(id, patch, { actor = 'admin', allowTextEdit = false } = {}) {
  const db = getDb();
  const before = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  if (!before) {
    const err = new Error('Question not found.');
    err.status = 404;
    throw err;
  }

  const locked = before.source_type === 'OFFICIAL_PYQ' && before.validation_state === 'VERIFIED';
  if (locked && !allowTextEdit) {
    // Verified official PYQ text is protected: metadata only.
    if ('question_text' in patch || 'options_json' in patch || 'passage' in patch) {
      const err = new Error(
        'Verified official PYQ text cannot be modified casually. Fix metadata only, or set allowTextEdit after independent verification.',
      );
      err.status = 423;
      err.code = 'TEXT_LOCKED';
      throw err;
    }
  }

  const updates = [];
  const params = [];
  const after = {};
  for (const field of [...METADATA_FIELDS, 'question_text', 'passage', 'options', 'allowTextEdit']) {
    if (!(field in patch)) continue;
    if (field === 'allowTextEdit') continue;
    let value = patch[field];
    if (field === 'options') {
      const opts = normalizeOptions(value);
      updates.push('options_json = ?');
      params.push(toJson(opts));
      after.options = opts;
      continue;
    }
    if (field === 'correct_answer' && value) {
      value = String(value).toUpperCase().trim();
      const opts = normalizeOptions(JSON.parse(before.options_json || '[]'));
      if (opts.length && !opts.some((o) => o.key === value)) {
        const err = new Error(`correct_answer must be one of ${opts.map((o) => o.key).join(', ')}`);
        err.status = 400;
        throw err;
      }
    }
    if (field === 'estimated_time_seconds') value = Number(value) || null;
    updates.push(`${field} = ?`);
    params.push(value);
    after[field] = value;
  }

  if (!updates.length) return { updated: false, question: before };

  updates.push('updated_at = ?');
  params.push(now(), id);
  await tx(async () => {
    await db.prepare(`UPDATE questions SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    audit('question', id, 'update_metadata', pick(before, Object.keys(after)), after, actor);
  });
  return { updated: true, question: db.prepare('SELECT * FROM questions WHERE id = ?').get(id) };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

export async function verifyQuestion(id, { actor = 'admin' } = {}) {
  const db = getDb();
  const before = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  if (!before) {
    const err = new Error('Question not found.');
    err.status = 404;
    throw err;
  }
  if (!before.correct_answer) {
    const err = new Error('Cannot verify: no answer key attached. Import an answer key first.');
    err.status = 400;
    err.code = 'NO_ANSWER';
    throw err;
  }
  await db.prepare('UPDATE questions SET validation_state = ?, updated_at = ? WHERE id = ?').run('VERIFIED', now(), id);
  audit('question', id, 'verify', { validation_state: before.validation_state }, { validation_state: 'VERIFIED' }, actor);
  await refreshCoverage();
  return db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
}

export async function markDuplicate(id, { actor = 'admin' } = {}) {
  const db = getDb();
  const before = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  if (!before) {
    const err = new Error('Question not found.');
    err.status = 404;
    throw err;
  }
  await db.prepare('UPDATE questions SET is_duplicate = 1, updated_at = ? WHERE id = ?').run(now(), id);
  audit('question', id, 'mark_duplicate', { is_duplicate: 0 }, { is_duplicate: 1 }, actor);
  await refreshCoverage();
  return { id, is_duplicate: 1 };
}

export async function deleteQuestion(id, { actor = 'admin' } = {}) {
  const db = getDb();
  const before = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  if (!before) {
    const err = new Error('Question not found.');
    err.status = 404;
    throw err;
  }
  if (before.source_type === 'OFFICIAL_PYQ' && before.validation_state === 'VERIFIED') {
    const err = new Error('Verified official PYQs cannot be deleted. Mark as duplicate instead.');
    err.status = 423;
    err.code = 'LOCKED';
    throw err;
  }
  await db.prepare('DELETE FROM questions WHERE id = ?').run(id);
  audit('question', id, 'delete', before, null, actor);
  await refreshCoverage();
  return { deleted: true, id };
}

/** Recompute the paper coverage registry (drives the PYQ explorer), for every exam. */
export async function refreshCoverage() {
  const db = getDb();
  const rows = await db
    .prepare(
      `SELECT year, paper, COUNT(*) AS n,
              SUM(CASE WHEN correct_answer IS NOT NULL AND correct_answer != '' THEN 1 ELSE 0 END) AS keyed,
              SUM(CASE WHEN validation_state = 'VERIFIED' THEN 1 ELSE 0 END) AS verified
       FROM questions WHERE is_duplicate = 0 AND source_type = 'OFFICIAL_PYQ'
       GROUP BY year, paper`,
    )
    .all();
  const index = new Map(rows.map((r) => [`${r.year}:${r.paper}`, r]));
  const at = now();
  for (const exam of Object.values(EXAMS)) {
    const startYear = exam.years.START_YEAR;
    const endYear = exam.years.END_YEAR;
    for (let y = startYear; y <= endYear; y += 1) {
      for (const paper of Object.values(exam.papers)) {
        const r = index.get(`${y}:${paper.id}`);
        const found = r ? Number(r.n) : 0;
        const keyed = r ? Number(r.keyed) : 0;
        const verified = r ? Number(r.verified) : 0;
        let status = 'DATA_MISSING';
        if (found > 0 && keyed === 0) status = 'REQUIRES_VERIFICATION';
        else if (found > 0 && (keyed < paper.questionCount || verified < paper.questionCount)) status = 'PARTIAL';
        else if (found > 0 && keyed >= paper.questionCount && verified >= paper.questionCount) status = 'VERIFIED';
        else if (found > 0) status = 'IMPORTED';
        await db.prepare(
          `INSERT INTO paper_coverage (year, paper, exam, tier, shift, status, official_count, verified_count, keyed_count, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(year, paper) DO UPDATE SET
             exam = excluded.exam, tier = excluded.tier, shift = excluded.shift,
             status = excluded.status, official_count = excluded.official_count,
             verified_count = excluded.verified_count, keyed_count = excluded.keyed_count,
             updated_at = excluded.updated_at`,
        ).run(y, paper.id, exam.id, paper.tier || null, paper.shift || null, status, found, verified, keyed, at);
      }
    }
  }
}

export async function searchQuestions(filters = {}, { page = 1, pageSize = 25 } = {}) {
  const db = getDb();
  const clauses = ['1=1'];
  const params = [];
  if (filters.q) {
    clauses.push('(question_text LIKE ? OR subject LIKE ? OR topic LIKE ? OR id LIKE ?)');
    const like = `%${filters.q}%`;
    params.push(like, like, like, like);
  }
  if (filters.paper) {
    clauses.push('paper = ?');
    params.push(filters.paper);
  }
  if (filters.exam) {
    clauses.push('exam = ?');
    params.push(filters.exam);
  }
  if (filters.year) {
    clauses.push('year = ?');
    params.push(Number(filters.year));
  }
  if (filters.subject) {
    clauses.push('subject = ?');
    params.push(filters.subject);
  }
  if (filters.source_type) {
    clauses.push('source_type = ?');
    params.push(filters.source_type);
  }
  if (filters.validation_state) {
    clauses.push('validation_state = ?');
    params.push(filters.validation_state);
  }
  if (filters.state === 'unkeyed') clauses.push("(correct_answer IS NULL OR correct_answer = '')");
  if (filters.state === 'review') clauses.push("validation_state = 'REVIEW_REQUIRED'");
  if (filters.state === 'duplicates') clauses.push('content_hash IN (SELECT content_hash FROM questions GROUP BY content_hash HAVING COUNT(*) > 1)');

  const where = clauses.join(' AND ');
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM questions WHERE ${where}`).get(...params)).n;
  const offset = (Math.max(1, page) - 1) * pageSize;
  const items = await db
    .prepare(
      `SELECT * FROM questions WHERE ${where} ORDER BY year DESC, paper, question_number ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset);
  return { total, page, pageSize, items };
}

export default {
  insertQuestion,
  insertMany,
  updateQuestion,
  verifyQuestion,
  markDuplicate,
  deleteQuestion,
  refreshCoverage,
  searchQuestions,
  validateQuestion,
  normalizeOptions,
  findContentDuplicate,
};
