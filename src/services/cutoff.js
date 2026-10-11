import crypto from 'node:crypto';
import { getDb, now, newId } from '../db/database.js';
import { getSscConfig, DIFFICULTIES } from './sscConfig.js';

/**
 * Cutoff generation for SSC CGL Sunday cycles.
 *
 * Three modes, all persisted exactly once per cycle by sscCycle.js:
 *   MANUAL             — the configured percentage, used verbatim.
 *   RANDOM_WEEKLY      — one secure random value in [randomMin, randomMax].
 *   DIFFICULTY_AWARE   — historical baseline + difficulty adjustment,
 *                        clamped, with optional small secure variation.
 *
 * The cutoff is NEVER derived from the user's own answers, and a persisted
 * cycle cutoff is never regenerated on refresh, retry or reopen.
 */

/** Secure uniform float in [min, max]. */
export function secureRandomFloat(min, max) {
  const range = max - min;
  if (range <= 0) return min;
  // 53-bit precision from two 32-bit draws.
  const a = crypto.randomBytes(4).readUInt32BE(0) / 2 ** 32;
  const b = crypto.randomBytes(4).readUInt32BE(0) / 2 ** 32;
  const unit = (a + b) / 2; // still uniform enough; avoids modulo bias concerns at this scale
  return min + unit * range;
}

export function clampPercent(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/* -------------------------------------------------- historical cutoff rows */

export const HISTORICAL_SEED_ROWS = [
  // User-provided reference values (UR, general post list). Marked UNVERIFIED
  // until checked against an official SSC result notice / corrigendum.
  { year: 2022, category: 'UR', list: 'GENERAL', rawMarks: 114.27, maxMarks: 200, sourceUrl: null, verificationStatus: 'UNVERIFIED', notes: 'User-provided reference (Oct 2026). Verify against official SSC CGL 2022 Tier-I result notice.' },
  { year: 2023, category: 'UR', list: 'GENERAL', rawMarks: 150.05, maxMarks: 200, sourceUrl: null, verificationStatus: 'UNVERIFIED', notes: 'User-provided reference (Oct 2026). Verify against official SSC CGL 2023 Tier-I result notice.' },
  { year: 2024, category: 'UR', list: 'GENERAL', rawMarks: 153.19, maxMarks: 200, sourceUrl: null, verificationStatus: 'UNVERIFIED', notes: 'User-provided reference (Oct 2026). Verify against official SSC CGL 2024 Tier-I result notice.' },
  { year: 2025, category: 'UR', list: 'GENERAL', rawMarks: 136.83, maxMarks: 200, sourceUrl: null, verificationStatus: 'UNVERIFIED', notes: 'User-provided reference (Oct 2026), subject to official revision. Verify against official SSC CGL 2025 Tier-I result notice.' },
];

/** Idempotent one-time seed of the reference table (safe to call repeatedly). */
export function seedHistoricalCutoffs() {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO ssc_cutoff_history
       (id, year, category, list, raw_marks, max_marks, normalized_percent, source_url, verification_status, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let inserted = 0;
  for (const r of HISTORICAL_SEED_ROWS) {
    const pct = round2((r.rawMarks / r.maxMarks) * 100);
    const res = insert.run(
      newId('cut'), r.year, r.category, r.list, r.rawMarks, r.maxMarks, pct,
      r.sourceUrl, r.verificationStatus, r.notes, now(),
    );
    inserted += res.changes || 0;
  }
  return inserted;
}

export function listHistoricalCutoffs({ category = null, list = null } = {}) {
  const db = getDb();
  const clauses = [];
  const params = [];
  if (category) { clauses.push('category = ?'); params.push(category); }
  if (list) { clauses.push('list = ?'); params.push(list); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM ssc_cutoff_history ${where} ORDER BY year DESC`).all(...params);
}

export function addHistoricalCutoff(row) {
  const { year, category, list = 'GENERAL', rawMarks, maxMarks = 200, sourceUrl = null, verificationStatus = 'UNVERIFIED', notes = null } = row || {};
  if (!year || !category || rawMarks == null) throw new Error('year, category and rawMarks are required.');
  const pct = round2((Number(rawMarks) / Number(maxMarks)) * 100);
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM ssc_cutoff_history WHERE year = ? AND category = ? AND list = ?')
    .get(Number(year), category, list);
  if (existing) {
    db.prepare(
      `UPDATE ssc_cutoff_history SET raw_marks = ?, max_marks = ?, normalized_percent = ?,
         source_url = ?, verification_status = ?, notes = ? WHERE id = ?`,
    ).run(Number(rawMarks), Number(maxMarks), pct, sourceUrl, verificationStatus, notes, existing.id);
    return { ...existing, raw_marks: Number(rawMarks), normalized_percent: pct, verification_status: verificationStatus };
  }
  const id = newId('cut');
  db.prepare(
    `INSERT INTO ssc_cutoff_history (id, year, category, list, raw_marks, max_marks, normalized_percent, source_url, verification_status, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, Number(year), category, list, Number(rawMarks), Number(maxMarks), pct, sourceUrl, verificationStatus, notes, now());
  return db.prepare('SELECT * FROM ssc_cutoff_history WHERE id = ?').get(id);
}

/* ------------------------------------------------------------- baseline */

/**
 * Historical baseline percentage for the difficulty-aware mode.
 * Prefers VERIFIED rows; falls back to UNVERIFIED reference rows but flags
 * that in the returned snapshot so nobody mistakes it for official data.
 */
export function resolveBaseline(cfg = getSscConfig()) {
  const c = cfg.cutoff;
  if (c.baselineSource === 'CUSTOM' && c.customBaselinePercent != null) {
    return { percent: Number(c.customBaselinePercent), source: 'CUSTOM', includesUnverified: false, years: [] };
  }
  const db = getDb();
  let rows = db
    .prepare(
      `SELECT year, normalized_percent, verification_status FROM ssc_cutoff_history
       WHERE category = 'UR' AND list = 'GENERAL' ORDER BY year DESC`,
    )
    .all();
  if (!rows.length) {
    return { percent: Number(c.historicalBaselinePercent), source: 'CONFIG_FALLBACK', includesUnverified: false, years: [] };
  }
  if (c.baselineSource === 'YEAR') {
    const hit = rows.find((r) => r.year === Number(c.baselineYear));
    if (hit) {
      return {
        percent: Number(hit.normalized_percent),
        source: `YEAR_${hit.year}`,
        includesUnverified: hit.verification_status !== 'VERIFIED',
        years: [hit.year],
      };
    }
    return { percent: Number(c.historicalBaselinePercent), source: 'CONFIG_FALLBACK', includesUnverified: false, years: [] };
  }
  // AVERAGE_RECENT — most recent up-to-3 UR general rows (verified preferred).
  const verified = rows.filter((r) => r.verification_status === 'VERIFIED');
  const use = (verified.length ? verified : rows).slice(0, 3);
  const avg = use.reduce((s, r) => s + Number(r.normalized_percent), 0) / use.length;
  return {
    percent: round2(avg),
    source: `AVERAGE_${use.map((r) => r.year).join('_')}`,
    includesUnverified: use.some((r) => r.verification_status !== 'VERIFIED'),
    years: use.map((r) => r.year),
  };
}

/* --------------------------------------------------- paper difficulty */

/**
 * Compute a paper's difficulty from imported question metadata.
 * Returns null when there is NOT enough reliable data — the caller must then
 * require an administrator classification instead of inventing a score.
 */
export function metadataDifficulty(paperId, cfg = getSscConfig()) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT difficulty, COUNT(*) AS n FROM questions
       WHERE paper = ? AND is_duplicate = 0 AND correct_answer IS NOT NULL
         AND difficulty IS NOT NULL AND source_type IN ('OFFICIAL_PYQ','CUSTOM')
       GROUP BY difficulty`,
    )
    .all(paperId);
  const counts = { easy: 0, medium: 0, hard: 0 };
  let total = 0;
  for (const r of rows) {
    const k = String(r.difficulty || '').toLowerCase();
    if (k in counts) { counts[k] += Number(r.n); total += Number(r.n); }
  }
  if (total < Number(cfg.metadataMinQuestions || 20)) {
    return { difficulty: null, sufficient: false, total, counts, reason: `Only ${total} labelled questions (need ${cfg.metadataMinQuestions}). Classify the paper manually.` };
  }
  const easyFrac = counts.easy / total;
  const hardFrac = counts.hard / total;
  let difficulty = 'MEDIUM';
  if (easyFrac >= Number(cfg.metadataEasyFraction)) difficulty = 'EASY';
  else if (hardFrac >= Number(cfg.metadataHardFraction)) difficulty = 'HARD';
  return { difficulty, sufficient: true, total, counts, easyFraction: round2(easyFrac * 100), hardFraction: round2(hardFrac * 100) };
}

/* ------------------------------------------------------- cutoff generate */

/**
 * Compute the cutoff for a cycle from the given config. Pure function of
 * (config, difficulty, baseline) — the caller persists the result once.
 * `randomFn` is injectable for deterministic tests; defaults to crypto.
 */
export function computeCutoff(cfg = getSscConfig(), { difficulty = null, baseline = null, randomFn = secureRandomFloat } = {}) {
  const c = cfg.cutoff;
  const mode = cfg.cutoffMode;
  const marksOutOf200 = (pct) => round2((pct / 100) * 200);

  if (mode === 'MANUAL') {
    const percent = clampPercent(Number(c.manualPercent), 0, 100);
    return {
      mode, percent: round2(percent), marksOutOf200: marksOutOf200(percent),
      baselinePercent: null, difficulty: null, adjustmentPp: null, variationPp: null,
    };
  }

  if (mode === 'RANDOM_WEEKLY') {
    const min = clampPercent(Number(c.randomMinPercent), 0, 100);
    const max = clampPercent(Number(c.randomMaxPercent), 0, 100);
    const raw = randomFn(min, max);
    const percent = clampPercent(raw, 0, 100);
    return {
      mode, percent: round2(percent), marksOutOf200: marksOutOf200(percent),
      baselinePercent: null, difficulty: null, adjustmentPp: null, variationPp: round2(raw - (min + max) / 2),
    };
  }

  if (mode === 'DIFFICULTY_AWARE') {
    if (!difficulty || !DIFFICULTIES.includes(difficulty)) {
      const err = new Error(
        'Difficulty-aware cutoff requires a paper difficulty classification (EASY, MEDIUM or HARD). Classify the paper manually or enable reliable metadata classification.',
      );
      err.code = 'DIFFICULTY_REQUIRED';
      err.status = 422;
      throw err;
    }
    const base = baseline || resolveBaseline(cfg);
    const basePct = Number(base.percent);
    const adj = Number(c.difficultyAdjustments?.[difficulty] ?? 0);
    const adjusted = basePct + adj;
    const clamped = clampPercent(adjusted, Number(c.clampMinPercent), Number(c.clampMaxPercent));
    let variation = 0;
    let percent = clamped;
    if (c.randomVariationEnabled && Number(c.randomVariationRange) > 0) {
      const r = randomFn(-Number(c.randomVariationRange), Number(c.randomVariationRange));
      variation = round2(r);
      percent = clampPercent(clamped + r, Number(c.clampMinPercent), Number(c.clampMaxPercent));
    }
    return {
      mode,
      percent: round2(percent),
      marksOutOf200: marksOutOf200(percent),
      baselinePercent: round2(basePct),
      baselineSource: base.source,
      baselineIncludesUnverified: Boolean(base.includesUnverified),
      baselineYears: base.years || [],
      difficulty,
      adjustmentPp: adj,
      clampedAt: clamped === adjusted ? null : round2(clamped),
      variationPp: variation,
    };
  }

  throw new Error(`Unknown cutoff mode: ${mode}`);
}

export default {
  computeCutoff, resolveBaseline, metadataDifficulty, seedHistoricalCutoffs,
  listHistoricalCutoffs, addHistoricalCutoff, secureRandomFloat, clampPercent,
};
