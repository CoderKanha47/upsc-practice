import { getDb, now, toJson, parseJson } from '../db/database.js';

/**
 * Admin-controlled SSC CGL Tier-II / weekly-cycle configuration.
 *
 * Stored as a single JSON blob in the `settings` table under
 * `SSC_CYCLE_CONFIG`, merged over DEFAULTS so partial saves are safe.
 * Nothing here touches UPSC or SSC Tier-I behaviour: every consumer reads
 * the config explicitly; absence of a setting never disables an existing
 * feature.
 */

export const CONFIG_KEY = 'SSC_CYCLE_CONFIG';

export const CUTOFF_MODES = Object.freeze(['MANUAL', 'RANDOM_WEEKLY', 'DIFFICULTY_AWARE']);
export const DIFFICULTIES = Object.freeze(['EASY', 'MEDIUM', 'HARD']);

export const SSC_CONFIG_DEFAULTS = Object.freeze({
  // Master switches -------------------------------------------------------
  tier2Enabled: false,                       // Tier-II full paper off by default
  tier1QualificationGatingEnabled: true,     // must qualify Tier-I to attempt Tier-II full paper
  requireTier1Completion: true,              // a completed Tier-I attempt is required (implied by qualifying)

  // Cutoff generation -----------------------------------------------------
  cutoffMode: 'DIFFICULTY_AWARE',            // MANUAL | RANDOM_WEEKLY | DIFFICULTY_AWARE
  cutoffScope: 'GLOBAL',                     // GLOBAL (one cutoff per Sunday) | PER_USER (reserved)
  cutoff: Object.freeze({
    // Mode A — manual
    manualPercent: 60,
    // Mode B — random weekly range (validated 0–100)
    randomMinPercent: 68,
    randomMaxPercent: 77,
    // Mode C — difficulty-aware
    historicalBaselinePercent: 73.35,        // fallback if no history rows exist
    baselineSource: 'AVERAGE_RECENT',        // AVERAGE_RECENT | YEAR | CUSTOM
    baselineYear: 2024,
    customBaselinePercent: null,
    difficultyAdjustments: Object.freeze({ EASY: 3, MEDIUM: 0, HARD: -3 }),
    clampMinPercent: 55,
    clampMaxPercent: 85,
    randomVariationEnabled: true,
    randomVariationRange: 1.0,               // ± percentage points
  }),

  // Difficulty assignment -------------------------------------------------
  // MANUAL_REQUIRED: an administrator must classify each cycle's paper.
  // METADATA_WHEN_RELIABLE: compute from imported question difficulty labels
  // when at least `metadataMinQuestions` labelled questions exist; otherwise
  // fall back to requiring a manual classification (never invent one).
  difficultyAssignment: 'MANUAL_REQUIRED',
  metadataMinQuestions: 20,
  metadataEasyFraction: 0.4,                 // ≥40% easy  → EASY
  metadataHardFraction: 0.4,                 // ≥40% hard  → HARD

  // Sunday window (Asia/Kolkata) ------------------------------------------
  weeklyWindow: Object.freeze({
    openMinuteAfterMidnight: 1,              // 00:01
    closeMinuteBeforeMidnight: 1,            // 23:59
  }),

  // Finalization ----------------------------------------------------------
  finalization: Object.freeze({ lazyFinalizeOnAccess: true }),
});

function deepMerge(base, override) {
  if (override === null || override === undefined) return base;
  if (typeof base !== 'object' || Array.isArray(base) || base === null) return override;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

export function sscConfigDefaults() {
  return JSON.parse(JSON.stringify(SSC_CONFIG_DEFAULTS));
}

/**
 * Cached effective config. The DB read is async (Postgres) but this function
 * must stay sync because every cycle/window/cutoff call site uses it inline,
 * so the value is loaded once via `loadSscConfig()` at boot and refreshed on
 * every save. Before the first load it reports pure defaults, never a broken
 * half-object.
 */
let cachedConfig = null;

export async function loadSscConfig() {
  const row = await getDb().prepare('SELECT value FROM settings WHERE key = ?').get(CONFIG_KEY);
  const stored = row ? parseJson(row.value, {}) || {} : {};
  cachedConfig = deepMerge(sscConfigDefaults(), stored);
  return cachedConfig;
}

/** Current effective config (defaults merged with any stored overrides). */
export function getSscConfig() {
  if (!cachedConfig) return sscConfigDefaults();
  return cachedConfig;
}

/** Persist a (partial) config update. Returns the new effective config. */
export async function setSscConfig(patch, actor = 'admin') {
  const before = getSscConfig();
  const after = deepMerge(before, patch || {});
  validateSscConfig(after);
  await getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(CONFIG_KEY, toJson(after), now());
  cachedConfig = after;
  return after;
}

/** Hard validation — throws with a helpful message on bad admin input. */
export function validateSscConfig(cfg) {
  const pct = (v, label) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new Error(`${label} must be a number between 0 and 100 (got ${v}).`);
    }
  };
  if (!CUTOFF_MODES.includes(cfg.cutoffMode)) {
    throw new Error(`cutoffMode must be one of ${CUTOFF_MODES.join(', ')}.`);
  }
  if (!['GLOBAL', 'PER_USER'].includes(cfg.cutoffScope)) {
    throw new Error('cutoffScope must be GLOBAL or PER_USER.');
  }
  pct(cfg.cutoff.manualPercent, 'cutoff.manualPercent');
  pct(cfg.cutoff.randomMinPercent, 'cutoff.randomMinPercent');
  pct(cfg.cutoff.randomMaxPercent, 'cutoff.randomMaxPercent');
  if (Number(cfg.cutoff.randomMinPercent) > Number(cfg.cutoff.randomMaxPercent)) {
    throw new Error('cutoff.randomMinPercent must be ≤ cutoff.randomMaxPercent.');
  }
  pct(cfg.cutoff.historicalBaselinePercent, 'cutoff.historicalBaselinePercent');
  if (cfg.cutoff.baselineSource === 'CUSTOM') pct(cfg.cutoff.customBaselinePercent, 'cutoff.customBaselinePercent');
  for (const d of DIFFICULTIES) {
    const adj = Number(cfg.cutoff.difficultyAdjustments?.[d]);
    if (!Number.isFinite(adj) || adj < -50 || adj > 50) {
      throw new Error(`cutoff.difficultyAdjustments.${d} must be a number between -50 and 50.`);
    }
  }
  pct(cfg.cutoff.clampMinPercent, 'cutoff.clampMinPercent');
  pct(cfg.cutoff.clampMaxPercent, 'cutoff.clampMaxPercent');
  if (Number(cfg.cutoff.clampMinPercent) > Number(cfg.cutoff.clampMaxPercent)) {
    throw new Error('cutoff.clampMinPercent must be ≤ cutoff.clampMaxPercent.');
  }
  const vr = Number(cfg.cutoff.randomVariationRange);
  if (!Number.isFinite(vr) || vr < 0 || vr > 25) {
    throw new Error('cutoff.randomVariationRange must be between 0 and 25 percentage points.');
  }
  if (!['MANUAL_REQUIRED', 'METADATA_WHEN_RELIABLE'].includes(cfg.difficultyAssignment)) {
    throw new Error('difficultyAssignment must be MANUAL_REQUIRED or METADATA_WHEN_RELIABLE.');
  }
  const w = cfg.weeklyWindow || {};
  const om = Number(w.openMinuteAfterMidnight);
  const cm = Number(w.closeMinuteBeforeMidnight);
  if (!Number.isFinite(om) || om < 0 || om > 1439 || !Number.isFinite(cm) || cm < 0 || cm > 1439) {
    throw new Error('weeklyWindow minutes must be between 0 and 1439.');
  }
  return true;
}

export default { getSscConfig, setSscConfig, loadSscConfig, validateSscConfig, sscConfigDefaults, CONFIG_KEY, CUTOFF_MODES };
