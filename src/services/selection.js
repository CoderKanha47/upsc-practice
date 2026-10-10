import crypto from 'node:crypto';
import CONFIG, { getPaper, examOfPaper, yearRange } from '../../config/exam.config.js';
import { getDb } from '../db/database.js';

/**
 * QUESTION SELECTION ENGINE
 * -------------------------
 * Builds papers that resemble the distribution and character of real papers
 * for the selected exam: subject ratios, difficulty mix and question-type
 * variety are driven by CONFIG.DISTRIBUTIONS. Selection is seeded so a paper
 * can be reproduced exactly from its seed.
 */

/* ------------------------------------------------------------------ random */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function makeRng(seed) {
  const seedFn = xmur3(String(seed));
  let a = seedFn();
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return crypto.randomBytes(8).toString('hex');
}

export function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* -------------------------------------------------------------------- pool */
const BASE_SELECT = `
  SELECT id, year, exam, paper, tier, shift, question_number, question_text, passage, group_id,
         group_index, options_json, subject, topic, subtopic, difficulty,
         question_type, estimated_time_seconds, marks, negative_marks,
         source_type, validation_state, source, is_official_pyq, dup_key
  FROM questions
  WHERE is_duplicate = 0
`;

function buildWhere(filters = {}) {
  const clauses = [];
  const params = [];
  const add = (sql, ...vals) => {
    clauses.push(sql);
    params.push(...vals);
  };

  if (filters.exam) add('exam = ?', filters.exam);
  if (filters.exams?.length) add(`exam IN (${filters.exams.map(() => '?').join(',')})`, ...filters.exams);
  if (filters.paper) add('paper = ?', filters.paper);
  if (filters.papers?.length) add(`paper IN (${filters.papers.map(() => '?').join(',')})`, ...filters.papers);
  if (filters.shift) add('shift = ?', filters.shift);
  if (filters.years?.length) add(`year IN (${filters.years.map(() => '?').join(',')})`, ...filters.years);
  if (filters.subjects?.length) add(`subject IN (${filters.subjects.map(() => '?').join(',')})`, ...filters.subjects);
  if (filters.topics?.length) add(`topic IN (${filters.topics.map(() => '?').join(',')})`, ...filters.topics);
  if (filters.subtopics?.length) add(`subtopic IN (${filters.subtopics.map(() => '?').join(',')})`, ...filters.subtopics);
  if (filters.types?.length) add(`question_type IN (${filters.types.map(() => '?').join(',')})`, ...filters.types);
  if (filters.difficulties?.length) add(`difficulty IN (${filters.difficulties.map(() => '?').join(',')})`, ...filters.difficulties);
  if (filters.sourceTypes?.length) add(`source_type IN (${filters.sourceTypes.map(() => '?').join(',')})`, ...filters.sourceTypes);
  if (filters.validationStates?.length) add(`validation_state IN (${filters.validationStates.map(() => '?').join(',')})`, ...filters.validationStates);
  else add(`validation_state IN ('PARSED','REVIEW_REQUIRED','VERIFIED')`);
  if (filters.requireAnswered !== false) add('correct_answer IS NOT NULL AND correct_answer != \'\'');
  if (filters.excludeIds?.length) add(`id NOT IN (${filters.excludeIds.map(() => '?').join(',')})`, ...filters.excludeIds);
  if (filters.includeIds?.length) add(`id IN (${filters.includeIds.map(() => '?').join(',')})`, ...filters.includeIds);
  if (filters.avoidSeen) add(`id NOT IN (SELECT question_id FROM question_stats WHERE attempt_count > 0)`);

  return { where: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

export function loadPool(filters = {}, { limit = 0 } = {}) {
  const db = getDb();
  const { where, params } = buildWhere(filters);
  const sql = `${BASE_SELECT}${where} ORDER BY year DESC, question_number ASC${limit ? ` LIMIT ${Number(limit)}` : ''}`;
  return db.prepare(sql).all(...params).map(decorate);
}

export function countPool(filters = {}) {
  const db = getDb();
  const { where, params } = buildWhere(filters);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM questions WHERE is_duplicate = 0${where}`).get(...params);
  return row ? Number(row.n) : 0;
}

function decorate(row) {
  let options = [];
  try {
    options = JSON.parse(row.options_json || '[]');
  } catch {
    options = [];
  }
  return { ...row, options };
}

/* ------------------------------------------------------------- exact paper */
/** Reproduce an actual historical paper exactly, in original order. */
export function pickExactPaper(year, paperId, opts = {}) {
  const db = getDb();
  const clauses = ['year = ?', 'paper = ?', 'is_duplicate = 0', "source_type = 'OFFICIAL_PYQ'", "validation_state IN ('PARSED','REVIEW_REQUIRED','VERIFIED')"];
  const params = [Number(year), paperId];
  if (opts.shift) {
    clauses.push('shift = ?');
    params.push(opts.shift);
  }
  const rows = db
    .prepare(
      `SELECT id, question_number FROM questions
       WHERE ${clauses.join(' AND ')}
       ORDER BY question_number ASC, id ASC`,
    )
    .all(...params);
  const expected = getPaper(paperId).questionCount ?? rows.length;
  return {
    questionIds: rows.map((r) => r.id),
    found: rows.length,
    expected,
    complete: rows.length >= expected,
  };
}

/* ------------------------------------------------------------- mixed paper */
function quotaPlan(paperId, count) {
  const dist = CONFIG.DISTRIBUTIONS[paperId] || [];
  const plan = new Map();
  let assigned = 0;
  for (const d of dist) {
    if (d.target <= 0) continue;
    const q = Math.round(d.target * count);
    plan.set(d.subject, q);
    assigned += q;
  }
  return { plan, assigned };
}

function difficultyDeficit(selected, cfg = CONFIG) {
  const mix = cfg.DISTRIBUTIONS.DIFFICULTY_MIX;
  const total = selected.length || 1;
  const counts = { easy: 0, medium: 0, hard: 0 };
  for (const q of selected) counts[q.difficulty] = (counts[q.difficulty] || 0) + 1;
  const deficit = {};
  for (const d of Object.keys(mix)) {
    if (d === 'tolerance') continue;
    deficit[d] = (mix[d] * total - counts[d]) / total;
  }
  return deficit;
}

/**
 * B. 20-YEAR MIXED PAPER — 100 (or n) PYQs from the configured year range with
 * UPSC-like subject/difficulty/type distribution. Always labelled MIXED PYQ
 * PAPER, never "official UPSC paper".
 */
export function buildMixedPaper(paperId, count, opts = {}) {
  const cfg = opts.config || CONFIG;
  const seed = opts.seed || randomSeed();
  const rng = makeRng(`${seed}:${paperId}:${count}`);
  const years = opts.years || rangeYearsFor(paperId);

  const pool = loadPool({
    paper: paperId,
    years,
    sourceTypes: ['OFFICIAL_PYQ'],
    excludeIds: opts.excludeIds,
  });

  if (pool.length === 0) {
    const err = new Error(
      'No official PYQs are available for this paper yet. Import papers first (Admin → Import). Nothing is generated or invented.',
    );
    err.status = 409;
    err.code = 'POOL_EMPTY';
    throw err;
  }

  const target = Math.min(count, pool.length);
  const bySubject = new Map();
  for (const q of shuffle(pool, rng)) {
    const key = q.subject || 'Miscellaneous';
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(q);
  }

  const { plan } = quotaPlan(paperId, target);
  const selected = [];
  const selectedIds = new Set();

  // Pass 1: fill subject quotas (capped so the paper length is exact),
  // biased toward under-represented difficulties.
  for (const [subject, quotaRaw] of plan) {
    const quota = Math.min(quotaRaw, target - selected.length);
    if (quota <= 0) break;
    const candidates = bySubject.get(subject) || [];
    let taken = 0;
    while (taken < quota && candidates.length) {
      const deficit = difficultyDeficit(selected, cfg);
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < candidates.length; i += 1) {
        const c = candidates[i];
        const score = (deficit[c.difficulty] || 0) + rng() * 0.05;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      const [pick] = candidates.splice(bestIdx, 1);
      if (pick && !selectedIds.has(pick.id)) {
        selected.push(pick);
        selectedIds.add(pick.id);
        taken += 1;
      }
    }
  }

  // Pass 2: top up to target from whatever remains (difficulty-first).
  const leftovers = shuffle(pool.filter((q) => !selectedIds.has(q.id)), rng);
  while (selected.length < target && leftovers.length) {
    const deficit = difficultyDeficit(selected, cfg);
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < leftovers.length; i += 1) {
      const c = leftovers[i];
      const score = (deficit[c.difficulty] || 0) + rng() * 0.05;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const [pick] = leftovers.splice(bestIdx, 1);
    if (pick) {
      selected.push(pick);
      selectedIds.add(pick.id);
    }
  }

  // Pass 3: enforce a minimum variety of question types.
  const distinctTypes = new Set(selected.map((q) => q.question_type));
  if (distinctTypes.size < cfg.DISTRIBUTIONS.MIN_DISTINCT_TYPES) {
    const missingTypes = cfg.QUESTION_TYPES.filter((t) => !distinctTypes.has(t));
    const spare = leftovers.filter((q) => missingTypes.includes(q.question_type));
    for (const type of missingTypes) {
      if (distinctTypes.size >= cfg.DISTRIBUTIONS.MIN_DISTINCT_TYPES) break;
      const idx = selected.findIndex((q) => q.question_type === type);
      const spareIdx = spare.findIndex((q) => q.question_type === type);
      if (idx >= 0 && spareIdx >= 0) {
        const [add] = spare.splice(spareIdx, 1);
        const [removed] = selected.splice(idx, 1);
        selectedIds.delete(removed.id);
        selected.push(add);
        selectedIds.add(add.id);
        distinctTypes.add(type);
      }
    }
  }

  return {
    seed,
    questions: selected,
    distribution: distributionReport(selected),
    poolSize: pool.length,
    requested: count,
    actual: selected.length,
  };
}

function rangeYears(cfg = CONFIG) {
  const out = [];
  for (let y = cfg.YEARS.END_YEAR; y >= cfg.YEARS.START_YEAR; y -= 1) out.push(y);
  return out;
}

/** Year list of the exam a paper belongs to (descending). */
function rangeYearsFor(paperId) {
  try {
    return yearRange(examOfPaper(paperId).id);
  } catch {
    return rangeYears(CONFIG);
  }
}

export function distributionReport(questions) {
  const bySubject = {};
  const byDifficulty = {};
  const byType = {};
  const byYear = {};
  for (const q of questions) {
    bySubject[q.subject || 'Unassigned'] = (bySubject[q.subject || 'Unassigned'] || 0) + 1;
    byDifficulty[q.difficulty || 'medium'] = (byDifficulty[q.difficulty || 'medium'] || 0) + 1;
    byType[q.question_type || 'conceptual'] = (byType[q.question_type || 'conceptual'] || 0) + 1;
    byYear[q.year] = (byYear[q.year] || 0) + 1;
  }
  const pct = (obj) =>
    Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, Math.round((v / questions.length) * 1000) / 10]),
    );
  return {
    count: questions.length,
    subject: pct(bySubject),
    difficulty: pct(byDifficulty),
    questionType: pct(byType),
    year: byYear,
  };
}

/* --------------------------------------------------------- selective set */
/**
 * SELECTIVE PRACTICE — always unlocked, any day, unlimited attempts.
 * Linked questions (shared passage/group) are kept together as a unit.
 */
export function buildSelectiveSet(filters, count, opts = {}) {
  const seed = opts.seed || randomSeed();
  const rng = makeRng(`${seed}:${JSON.stringify(filters)}:${count}`);

  let pool = loadPool(filters);
  if (!pool.length) {
    const err = new Error('No questions match these filters yet.');
    err.status = 409;
    err.code = 'POOL_EMPTY';
    throw err;
  }
  pool = shuffle(pool, rng);

  const groups = new Map();
  const singles = [];
  for (const q of pool) {
    if (q.group_id) {
      if (!groups.has(q.group_id)) groups.set(q.group_id, []);
      groups.get(q.group_id).push(q);
    } else singles.push(q);
  }
  for (const g of groups.values()) g.sort((a, b) => (a.group_index || 0) - (b.group_index || 0));

  const wantAll = count === null || count === 'all' || count === 'ALL' || count >= Infinity;
  const selected = [];
  const used = new Set();

  if (wantAll) {
    for (const q of pool) selected.push(q);
  } else {
    const groupList = shuffle([...groups.entries()], rng);
    // Prefer exact fill: singles first, then groups that still fit.
    for (const q of singles) {
      if (selected.length >= count) break;
      selected.push(q);
      used.add(q.id);
    }
    for (const [, members] of groupList) {
      if (selected.length >= count) break;
      if (members.some((m) => used.has(m.id))) continue;
      if (selected.length + members.length > count && singles.length === 0) continue;
      for (const m of members) {
        selected.push(m);
        used.add(m.id);
      }
    }
    // If still short (pool smaller than requested), add remaining singles/groups.
    if (selected.length < count) {
      for (const q of pool) {
        if (selected.length >= count) break;
        if (used.has(q.id)) continue;
        if (q.group_id && groups.get(q.group_id).some((m) => used.has(m.id))) continue;
        selected.push(q);
        used.add(q.id);
      }
    }
  }

  return {
    seed,
    questions: selected,
    requested: count,
    actual: selected.length,
    poolSize: pool.length,
    filteredOutSeen: Boolean(filters.avoidSeen),
  };
}

export default {
  loadPool,
  countPool,
  pickExactPaper,
  buildMixedPaper,
  buildSelectiveSet,
  distributionReport,
  randomSeed,
  makeRng,
  shuffle,
};
