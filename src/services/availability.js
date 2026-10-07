import CONFIG from '../../config/exam.config.js';
import { now } from '../db/database.js';

/**
 * Server-side availability of Full Paper mode.
 *
 * The window is Sunday 00:01 → Sunday 23:59 in CONFIG.APP.TIMEZONE (IST by
 * default). The client can never influence this: every decision is taken from
 * the server clock using the configured timezone.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function partsInTz(ts, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const map = {};
  for (const p of dtf.formatToParts(new Date(ts))) map[p.type] = p.value;
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(map.weekday);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayIndex,
    dateKey: `${map.year}-${map.month}-${map.day}`,
  };
}

/** Offset (ms) of `tz` relative to UTC at the given instant. */
function tzOffset(ts, tz) {
  const p = partsInTz(ts, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** Convert a wall-clock time in `tz` to an epoch timestamp. */
export function zonedToEpoch(dateKey, timeKey, tz) {
  const parts = String(timeKey).split(':').map((n) => Number(n) || 0);
  const hh = String(parts[0] ?? 0).padStart(2, '0');
  const mm = String(parts[1] ?? 0).padStart(2, '0');
  const ss = String(parts[2] ?? 0).padStart(2, '0');
  const utcGuess = Date.parse(`${dateKey}T${hh}:${mm}:${ss}Z`);
  if (Number.isNaN(utcGuess)) throw new Error(`Invalid date/time: ${dateKey} ${timeKey}`);
  let ts = utcGuess;
  for (let i = 0; i < 3; i += 1) {
    ts = utcGuess - tzOffset(ts, tz);
  }
  return ts;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Full status of Full Paper mode for the given instant.
 * @param {number} nowMs server clock
 * @param {object} cfg optional config override (tests)
 */
export function fullPaperStatus(nowMs = now(), cfg = CONFIG) {
  const tz = cfg.APP.TIMEZONE;
  const { FULL_PAPER: FP } = cfg;
  const p = partsInTz(nowMs, tz);
  const dayName = WEEKDAYS[p.weekday];

  const openTime = `${pad(Math.floor(FP.OPEN_MINUTE_AFTER_MIDNIGHT / 60))}:${pad(
    FP.OPEN_MINUTE_AFTER_MIDNIGHT % 60,
  )}`;
  const closeMinutes = 24 * 60 - FP.CLOSE_MINUTE_BEFORE_MIDNIGHT;
  const closeTime = `${pad(Math.floor(closeMinutes / 60))}:${pad(closeMinutes % 60)}`;

  const minutesOfDay = p.hour * 60 + p.minute;
  const onAllowedDay = p.weekday === FP.ALLOWED_DAY;
  const afterOpen = minutesOfDay >= FP.OPEN_MINUTE_AFTER_MIDNIGHT;
  const beforeClose = minutesOfDay <= closeMinutes;
  const available = Boolean(FP.FORCE_AVAILABLE) || (onAllowedDay && afterOpen && beforeClose);

  // Next opening moment (for the locked state).
  let daysAhead = (FP.ALLOWED_DAY - p.weekday + 7) % 7;
  if (daysAhead === 0 && !afterOpen) daysAhead = 0;
  else if (daysAhead === 0) daysAhead = 7;
  const nextDate = new Date(Date.UTC(p.year, p.month - 1, p.day + daysAhead));
  const nextKey = `${nextDate.getUTCFullYear()}-${pad(nextDate.getUTCMonth() + 1)}-${pad(
    nextDate.getUTCDate(),
  )}`;
  const nextOpenAt = zonedToEpoch(nextKey, openTime, tz);

  let reason;
  if (available) {
    reason = `Available now (${dayName}). Window: ${openTime} – ${closeTime} ${tz}.`;
  } else if (!onAllowedDay) {
    reason = `Full Paper is locked on ${dayName}. Available every Sunday, ${openTime}–${closeTime} ${tz}.`;
  } else if (!afterOpen) {
    reason = `Today's window opens at ${openTime} ${tz}.`;
  } else {
    reason = `Today's window has closed (ended ${closeTime} ${tz}).`;
  }

  return {
    available,
    forced: Boolean(FP.FORCE_AVAILABLE),
    dayName,
    timezone: tz,
    openTime,
    closeTime,
    reason,
    serverNow: new Date(nowMs).toISOString(),
    serverNowLocal: `${p.dateKey} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} ${dayName}`,
    nextOpenAt: new Date(nextOpenAt).toISOString(),
    label: available
      ? 'FULL PAPER\nAVAILABLE TODAY'
      : 'FULL PAPER\nLOCKED\n\nAvailable every Sunday.',
  };
}

/** Hard server-side gate used when starting a Full Paper session. */
export function assertFullPaperAllowed(nowMs = now(), cfg = CONFIG) {
  const status = fullPaperStatus(nowMs, cfg);
  if (!status.available) {
    const err = new Error(status.reason);
    err.status = 403;
    err.code = 'FULL_PAPER_LOCKED';
    throw err;
  }
  return status;
}

export default { fullPaperStatus, assertFullPaperAllowed, zonedToEpoch };
