import { getDb, now, tx, toJson, parseJson, isUniqueViolation } from '../db/database.js';
import { zonedToEpoch } from './availability.js';
import { getSscConfig } from './sscConfig.js';
import { computeCutoff, resolveBaseline, metadataDifficulty } from './cutoff.js';

/**
 * SSC CGL weekly exam cycles (one independent record per Sunday, IST).
 *
 * Cycle id: SSC-CGL-YYYY-MM-DD (the Sunday's date in Asia/Kolkata).
 * The cutoff is generated exactly once per cycle and persisted; it is never
 * regenerated on refresh, retry, logout or reopen. Each Sunday is independent:
 * qualification never carries over.
 *
 * Finalization is idempotent and runs lazily whenever a cycle is accessed
 * after its closing time, even if the user never opened the app at 23:59.
 */

export const TIER1_STATUSES = Object.freeze(['NOT_ATTEMPTED', 'IN_PROGRESS', 'COMPLETED', 'ABSENT']);
export const TIER2_STATUSES = Object.freeze(['NOT_ELIGIBLE', 'ELIGIBLE', 'IN_PROGRESS', 'COMPLETED', 'ABSENT']);
export const QUALIFICATION_STATUSES = Object.freeze(['PENDING', 'QUALIFIED', 'NOT_QUALIFIED', 'ABSENT']);

/* ------------------------------------------------------------- date helpers */

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Sunday date key ('YYYY-MM-DD') in IST for the given instant. */
export function cycleDateKey(at = now(), tz = 'Asia/Kolkata') {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const map = {};
  for (const p of dtf.formatToParts(new Date(at))) map[p.type] = p.value;
  if (map.weekday !== 'Sun') {
    // Walk forward to the coming Sunday (or stay on today's Sunday).
    const daysAhead = (0 - ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(map.weekday) + 7) % 7;
    const d = new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day) + daysAhead));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

/** Previous Sunday's date key (for cycle history). */
export function previousCycleDateKey(at = now(), tz = 'Asia/Kolkata') {
  const current = cycleDateKey(at, tz);
  const d = new Date(`${current}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function cycleIdFor(dateKey) {
  return `SSC-CGL-${dateKey}`;
}

/** Open/close epoch (ms) of the given cycle's Sunday window, IST. */
export function cycleWindow(dateKey, cfg = getSscConfig()) {
  const tz = 'Asia/Kolkata';
  const openMin = Number(cfg.weeklyWindow?.openMinuteAfterMidnight ?? 1);
  const closeMinTotal = 24 * 60 - Number(cfg.weeklyWindow?.closeMinuteBeforeMidnight ?? 1); // 1439 → 23:59
  const openTime = `${pad(Math.floor(openMin / 60))}:${pad(openMin % 60)}`;
  const closeTime = `${pad(Math.floor(closeMinTotal / 60))}:${pad(closeMinTotal % 60)}`;
  return {
    dateKey,
    timezone: tz,
    openTime,
    closeTime,
    openAt: zonedToEpoch(dateKey, openTime, tz),
    closeAt: zonedToEpoch(dateKey, closeTime, tz) + 59_999, // inclusive through 23:59:59.999
  };
}

export function windowStatus(at = now(), cfg = getSscConfig()) {
  const dateKey = cycleDateKey(at, 'Asia/Kolkata');
  const w = cycleWindow(dateKey, cfg);
  const open = at >= w.openAt && at <= w.closeAt;
  return { ...w, available: open, serverNow: new Date(at).toISOString() };
}

/* ------------------------------------------------------------- cycle access */

function rowToCycle(row) {
  if (!row) return null;
  return {
    ...row,
    cutoffSnapshot: parseJson(row.cutoff_snapshot_json, {}) || {},
    finalized: row.finalized_at != null,
  };
}

export function getCycle(cycleId) {
  return rowToCycle(getDb().prepare('SELECT * FROM ssc_cycles WHERE id = ?').get(cycleId));
}

export function getCycleByDate(dateKey) {
  return rowToCycle(getDb().prepare('SELECT * FROM ssc_cycles WHERE cycle_date = ?').get(dateKey));
}

export function listCycles({ limit = 52 } = {}) {
  return getDb()
    .prepare('SELECT * FROM ssc_cycles ORDER BY cycle_date DESC LIMIT ?')
    .all(Math.min(500, Number(limit) || 52))
    .map(rowToCycle);
}

/* --------------------------------------------------- cycle creation + cutoff */

/**
 * Ensure the cycle for `dateKey` exists, generating and persisting its cutoff
 * exactly once. Concurrent callers are safe: the UNIQUE(cycle_date) constraint
 * plus a retry means only one generation is persisted; everyone else reuses it.
 */
export function ensureCycle(dateKey = cycleDateKey(), { difficulty = null, forceRegenerateCutoff = false, randomFn = undefined } = {}) {
  const cfg = getSscConfig();
  const existing = getCycleByDate(dateKey);
  if (existing && !forceRegenerateCutoff) {
    // Lazy finalization on access: a cycle whose window already closed is
    // settled here rather than handed back as if it were still live.
    // `currentCycle()` cannot cover this — it only resolves the current Sunday.
    if (cfg.finalization?.lazyFinalizeOnAccess !== false && now() > cycleWindow(dateKey, cfg).closeAt) {
      finalizeCycle(existing.id, { at: now() });
      return getCycle(existing.id);
    }
    return existing;
  }

  // Resolve difficulty (never invented): manual param → stored manual
  // classification for this cycle (or a general one) → metadata when enabled.
  let effDifficulty = difficulty || null;
  let difficultySource = effDifficulty ? 'MANUAL' : null;
  let difficultyMeta = null;
  if (!effDifficulty && cfg.cutoffMode === 'DIFFICULTY_AWARE') {
    const stored = getDb()
      .prepare(
        `SELECT difficulty FROM paper_difficulty
         WHERE paper_id = 'SSC_T1' AND (cycle_date = ? OR cycle_date IS NULL)
         ORDER BY (cycle_date IS NULL) LIMIT 1`,
      )
      .get(dateKey);
    if (stored?.difficulty) {
      effDifficulty = stored.difficulty;
      difficultySource = 'MANUAL';
    }
  }
  if (!effDifficulty && cfg.cutoffMode === 'DIFFICULTY_AWARE') {
    if (cfg.difficultyAssignment === 'METADATA_WHEN_RELIABLE') {
      const meta = metadataDifficulty('SSC_T1', cfg);
      difficultyMeta = meta;
      if (meta.sufficient) {
        effDifficulty = meta.difficulty;
        difficultySource = 'METADATA';
      }
    }
    if (!effDifficulty) {
      const err = new Error(
        'This cycle needs a paper difficulty classification before a difficulty-aware cutoff can be generated. Set it in Admin → SSC Configuration (classify the paper Easy/Medium/Hard).',
      );
      err.code = 'DIFFICULTY_REQUIRED';
      err.status = 422;
      throw err;
    }
  }

  const baseline = cfg.cutoffMode === 'DIFFICULTY_AWARE' ? resolveBaseline(cfg) : null;
  const cutoff = computeCutoff(cfg, { difficulty: effDifficulty, baseline, randomFn });
  const snapshot = {
    ...cutoff,
    generatedAt: new Date(now()).toISOString(),
    configAtGeneration: {
      cutoffMode: cfg.cutoffMode,
      cutoffScope: cfg.cutoffScope,
      clampMinPercent: cfg.cutoff.clampMinPercent,
      clampMaxPercent: cfg.cutoff.clampMaxPercent,
      randomVariationEnabled: cfg.cutoff.randomVariationEnabled,
      randomVariationRange: cfg.cutoff.randomVariationRange,
    },
    disclaimer: 'Simulated practice cutoff. Not an official SSC cutoff and not a claim about the real examination.',
    difficultyMeta: difficultyMeta && !difficultyMeta.sufficient ? { total: difficultyMeta.total, reason: difficultyMeta.reason } : null,
  };

  const tier2EligibleInitially = Boolean(cfg.tier2Enabled) && !cfg.tier1QualificationGatingEnabled ? 'ELIGIBLE' : 'NOT_ELIGIBLE';
  const id = cycleIdFor(dateKey);
  const at = now();
  try {
    getDb()
      .prepare(
        `INSERT INTO ssc_cycles
           (id, cycle_date, cutoff_mode, cutoff_percent, cutoff_snapshot_json, difficulty, difficulty_source,
            historical_baseline_percent, adjustment_pp, tier1_paper_id, tier1_status, qualification_status,
            tier2_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SSC_T1', 'NOT_ATTEMPTED', 'PENDING', ?, ?, ?)`,
      )
      .run(
        id, dateKey, cutoff.mode, cutoff.percent, toJson(snapshot),
        effDifficulty, difficultySource,
        cutoff.baselinePercent ?? null, cutoff.adjustmentPp ?? null,
        tier2EligibleInitially, at, at,
      );
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Another caller won the race — reuse their persisted cutoff.
      return getCycleByDate(dateKey);
    }
    throw err;
  }
  return getCycleByDate(dateKey);
}

/** Current cycle (creating it if needed). Finalizes lazily when past close. */
export function currentCycle({ at = now(), autoFinalize = true } = {}) {
  const cfg = getSscConfig();
  const dateKey = cycleDateKey(at, 'Asia/Kolkata');
  let cycle = getCycleByDate(dateKey);
  if (!cycle) {
    try {
      cycle = ensureCycle(dateKey);
    } catch (err) {
      if (err?.code === 'DIFFICULTY_REQUIRED') {
        // Cycle cannot be generated yet — surface a shell so the UI can prompt
        // the administrator, without inventing a cutoff.
        const win = cycleWindow(dateKey, cfg);
        return { missingDifficulty: true, dateKey, id: cycleIdFor(dateKey), window: win, config: cfg };
      }
      throw err;
    }
  }
  if (autoFinalize && cfg.finalization?.lazyFinalizeOnAccess !== false && at > cycleWindow(cycle.cycle_date, cfg).closeAt) {
    // Pass `at` through: finalizeCycle() refuses to close a cycle whose window
    // is still open, so omitting it would silently skip this transition.
    finalizeCycle(cycle.id, { at });
    cycle = getCycle(cycle.id);
  }
  return cycle;
}

/* -------------------------------------------------------- record results */

/** Link a full-paper session to a cycle (used when starting Tier-I/Tier-II). */
export function attachSessionToCycle(sessionId, cycleId, tier) {
  getDb().prepare('UPDATE test_sessions SET cycle_id = ? WHERE id = ?').run(cycleId, sessionId);
  const col = tier === 1 ? 'tier1_session_id' : 'tier2_session_id';
  const statusCol = tier === 1 ? 'tier1_status' : 'tier2_status';
  const status = tier === 1 ? 'IN_PROGRESS' : 'IN_PROGRESS';
  getDb()
    .prepare(`UPDATE ssc_cycles SET ${col} = ?, ${statusCol} = ?, updated_at = ? WHERE id = ?`)
    .run(sessionId, status, now(), cycleId);
}

/**
 * Record a completed Tier-I full-paper attempt against its cycle and decide
 * qualification server-side from the persisted cutoff. The client can never
 * influence this: the score comes from the scored session row.
 */
export function recordTier1Result(cycleId, session) {
  return tx(() => {
    const cycle = getCycle(cycleId);
    if (!cycle) return null;
    if (cycle.tier1_status === 'COMPLETED' && cycle.tier1_session_id === session.id) return cycle; // idempotent
    const total = Number(session.total_marks || 0);
    const marks = Number(session.marks_obtained || 0);
    const percent = total > 0 ? Math.round((marks / total) * 10000) / 100 : 0;
    const qualified = percent >= Number(cycle.cutoff_percent);
    const cfg = getSscConfig();
    const tier2Status = qualified
      ? (cfg.tier2Enabled ? 'ELIGIBLE' : 'NOT_ELIGIBLE')
      : 'NOT_ELIGIBLE';
    getDb()
      .prepare(
        `UPDATE ssc_cycles SET tier1_session_id = ?, tier1_status = 'COMPLETED',
           tier1_marks = ?, tier1_total_marks = ?, tier1_percent = ?,
           qualification_status = ?, tier2_status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(session.id, marks, total || null, percent, qualified ? 'QUALIFIED' : 'NOT_QUALIFIED', tier2Status, now(), cycleId);
    return getCycle(cycleId);
  });
}

export function recordTier2Start(cycleId, sessionId, paperId) {
  getDb()
    .prepare(
      `UPDATE ssc_cycles SET tier2_session_id = ?, tier2_paper_id = ?, tier2_status = 'IN_PROGRESS', updated_at = ? WHERE id = ?`,
    )
    .run(sessionId, paperId, now(), cycleId);
}

export function recordTier2Result(cycleId, session) {
  return tx(() => {
    const cycle = getCycle(cycleId);
    if (!cycle) return null;
    if (cycle.tier2_status === 'COMPLETED' && cycle.tier2_session_id === session.id) return cycle;
    const total = Number(session.total_marks || 0);
    const marks = Number(session.marks_obtained || 0);
    const percent = total > 0 ? Math.round((marks / total) * 10000) / 100 : 0;
    getDb()
      .prepare(
        `UPDATE ssc_cycles SET tier2_session_id = ?, tier2_status = 'COMPLETED',
           tier2_marks = ?, tier2_total_marks = ?, tier2_percent = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(session.id, marks, total || null, percent, now(), cycleId);
    return getCycle(cycleId);
  });
}

/* ------------------------------------------------------------ eligibility */

/**
 * Server-side eligibility to START a Tier-II full paper in the current cycle.
 * Throws 403/409 with a machine-readable code; the client only displays it.
 */
export function assertTier2FullPaperAllowed({ at = now() } = {}) {
  const cfg = getSscConfig();
  if (!cfg.tier2Enabled) {
    const err = new Error('SSC CGL Tier-II full paper is disabled in Admin → SSC Configuration.');
    err.status = 403;
    err.code = 'TIER2_DISABLED';
    throw err;
  }
  const win = windowStatus(at, cfg);
  if (!win.available) {
    const err = new Error(`Tier-II full paper is available only during the Sunday window (${win.openTime}–${win.closeTime} IST).`);
    err.status = 403;
    err.code = 'FULL_PAPER_LOCKED';
    throw err;
  }
  const cycle = currentCycle({ at });
  if (cycle?.finalized) {
    const err = new Error('This Sunday cycle is already finalized. Wait for the next Sunday cycle.');
    err.status = 409;
    err.code = 'CYCLE_FINALIZED';
    throw err;
  }
  if (!cycle || cycle.qualification_status !== 'QUALIFIED') {
    const err = new Error(
      cfg.tier1QualificationGatingEnabled
        ? 'You have not qualified this cycle\u2019s Tier-I cutoff. Tier-II full paper stays locked for this Sunday.'
        : 'Cycle not ready.',
    );
    err.status = 403;
    err.code = 'TIER1_NOT_QUALIFIED';
    throw err;
  }
  if (cycle.tier2_status === 'COMPLETED') {
    const err = new Error('Tier-II full paper for this cycle is already completed.');
    err.status = 409;
    err.code = 'TIER2_ALREADY_COMPLETED';
    throw err;
  }
  if (cycle.tier2_status === 'ABSENT') {
    const err = new Error('This cycle\u2019s Tier-II attempt was finalized as ABSENT. Wait for the next Sunday cycle.');
    err.status = 409;
    err.code = 'TIER2_ABSENT';
    throw err;
  }
  if (cycle.tier2_status === 'IN_PROGRESS' && cycle.tier2_session_id) {
    return { resumed: true, cycle, sessionId: cycle.tier2_session_id };
  }
  return { resumed: false, cycle };
}

/** True when the cycle's Tier-II full paper may be attempted right now. */
export function tier2Eligible(cycle, cfg = getSscConfig(), at = now()) {
  if (!cfg.tier2Enabled) return { eligible: false, reason: 'Tier-II is disabled.' };
  if (!cycle) return { eligible: false, reason: 'No cycle.' };
  if (cycle.finalized) return { eligible: false, reason: 'Cycle finalized.' };
  if (cfg.tier1QualificationGatingEnabled && cycle.qualification_status !== 'QUALIFIED') {
    return { eligible: false, reason: 'Tier-I qualification required for this cycle.' };
  }
  if (cycle.tier2_status === 'COMPLETED') return { eligible: false, reason: 'Already completed this cycle.' };
  if (cycle.tier2_status === 'ABSENT') return { eligible: false, reason: 'Finalized as ABSENT this cycle.' };
  const win = windowStatus(at, cfg);
  if (!win.available) return { eligible: false, reason: `Sunday window ${win.openTime}–${win.closeTime} IST only.` };
  return { eligible: true, reason: 'Eligible.', inProgress: cycle.tier2_status === 'IN_PROGRESS' };
}

/* --------------------------------------------------------- finalization */

/**
 * Idempotent end-of-cycle finalization (Cases A–G). Safe to call repeatedly
 * and concurrently: the UPDATE is guarded on finalized_at IS NULL inside a
 * transaction, so only one caller performs the transition.
 */
export function finalizeCycle(cycleId, { at = now(), force = false } = {}) {
  const cfg = getSscConfig();
  return tx(() => {
    const cycle = getCycle(cycleId);
    if (!cycle) return null;
    if (cycle.finalized_at != null) return cycle; // idempotent
    const win = cycleWindow(cycle.cycle_date, cfg);
    if (!force && at <= win.closeAt) return cycle; // not yet time

    const db = getDb();
    // Re-check inside the transaction to defeat concurrent finalizers.
    const fresh = db.prepare('SELECT finalized_at FROM ssc_cycles WHERE id = ?').get(cycleId);
    if (fresh.finalized_at != null) return getCycle(cycleId);

    let {
      tier1_status: t1, tier1_session_id: t1sid,
      tier2_status: t2, tier2_session_id: t2sid,
      qualification_status: qual,
    } = cycle;

    // --- Tier-I -----------------------------------------------------------
    if (t1 === 'IN_PROGRESS' && t1sid) {
      // Case F/E: started but not submitted by the window close → ABSENT.
      // Partial answers stay in session_answers for diagnostics.
      db.prepare(`UPDATE test_sessions SET status = 'ABSENT' WHERE id = ? AND status = 'IN_PROGRESS'`).run(t1sid);
      t1 = 'ABSENT';
      qual = 'ABSENT';
    } else if (t1 === 'NOT_ATTEMPTED' || !t1sid) {
      // Case D: never attempted → ABSENT, no fabricated score.
      t1 = 'ABSENT';
      if (qual === 'PENDING') qual = 'ABSENT';
    }

    // --- Tier-II ----------------------------------------------------------
    if (t2 === 'IN_PROGRESS' && t2sid) {
      // Case E: qualified, started, not completed → ABSENT, score stays null.
      db.prepare(`UPDATE test_sessions SET status = 'ABSENT' WHERE id = ? AND status = 'IN_PROGRESS'`).run(t2sid);
      t2 = 'ABSENT';
    } else if (t2 === 'ELIGIBLE' && cfg.tier2Enabled) {
      // Case B: qualified but never completed Tier-II by close → ABSENT (null score).
      t2 = 'ABSENT';
    } else if (t2 === 'NOT_ELIGIBLE') {
      // Cases C/D: stays NOT_ELIGIBLE — never mislabelled as an absence.
      t2 = 'NOT_ELIGIBLE';
    }

    db.prepare(
      `UPDATE ssc_cycles SET tier1_status = ?, qualification_status = ?, tier2_status = ?,
         finalized_at = ?, updated_at = ? WHERE id = ? AND finalized_at IS NULL`,
    ).run(t1, qual, t2, at, at, cycleId);
    return getCycle(cycleId);
  });
}

/** Finalize every cycle whose window has closed (cheap lazy sweep). */
export function finalizeExpiredCycles({ at = now() } = {}) {
  const rows = getDb()
    .prepare(`SELECT id FROM ssc_cycles WHERE finalized_at IS NULL ORDER BY cycle_date`)
    .all();
  let done = 0;
  for (const r of rows) {
    const c = getCycle(r.id);
    const win = cycleWindow(c.cycle_date, getSscConfig());
    if (at > win.closeAt) {
      const out = finalizeCycle(r.id, { at });
      if (out?.finalized_at != null) done += 1;
    }
  }
  return done;
}

/* ------------------------------------------------------- view for clients */

export function cycleView(cycle, cfg = getSscConfig(), at = now()) {
  if (!cycle) return null;
  const win = cycleWindow(cycle.cycle_date, cfg);
  const elig = tier2Eligible(cycle, cfg, at);
  return {
    id: cycle.id,
    dateKey: cycle.cycle_date,
    window: { ...win, available: at >= win.openAt && at <= win.closeAt },
    cutoff: {
      mode: cycle.cutoff_mode,
      percent: cycle.cutoff_percent,
      marksOutOf200: Math.round((Number(cycle.cutoff_percent) / 100) * 200 * 100) / 100,
      snapshot: cycle.cutoffSnapshot,
      difficulty: cycle.difficulty,
      difficultySource: cycle.difficulty_source,
      historicalBaselinePercent: cycle.historical_baseline_percent,
      adjustmentPp: cycle.adjustment_pp,
      simulated: true,
      disclaimer: 'Simulated practice cutoff — not an official SSC cutoff.',
    },
    tier1: {
      paperId: cycle.tier1_paper_id,
      sessionId: cycle.tier1_session_id,
      status: cycle.tier1_status,
      marks: cycle.tier1_marks,
      totalMarks: cycle.tier1_total_marks,
      percent: cycle.tier1_percent,
    },
    qualificationStatus: cycle.qualification_status,
    tier2: {
      paperId: cycle.tier2_paper_id,
      sessionId: cycle.tier2_session_id,
      status: cycle.tier2_status,
      marks: cycle.tier2_marks,          // null for ABSENT — never zero
      totalMarks: cycle.tier2_total_marks,
      percent: cycle.tier2_percent,
      eligible: elig.eligible,
      eligibilityReason: elig.reason,
    },
    finalized: cycle.finalized,
    finalizedAt: cycle.finalized_at,
  };
}

export default {
  cycleDateKey, previousCycleDateKey, cycleIdFor, cycleWindow, windowStatus,
  ensureCycle, currentCycle, getCycle, getCycleByDate, listCycles,
  attachSessionToCycle, recordTier1Result, recordTier2Start, recordTier2Result,
  assertTier2FullPaperAllowed, tier2Eligible, finalizeCycle, finalizeExpiredCycles, cycleView,
};
