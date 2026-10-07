import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fullPaperStatus, assertFullPaperAllowed, zonedToEpoch } from '../src/services/availability.js';
import CONFIG from '../config/exam.config.js';

const TZ = 'Asia/Kolkata';
// 2026-10-11 is a Sunday; 2026-10-12 is a Monday.
const SUNDAY = '2026-10-11';
const MONDAY = '2026-10-12';

test('Sunday 10:00 IST → Full Paper available', () => {
  const ts = zonedToEpoch(SUNDAY, '10:00:00', TZ);
  const status = fullPaperStatus(ts);
  assert.equal(status.available, true);
  assert.equal(status.dayName, 'Sunday');
  assert.match(status.label, /AVAILABLE TODAY/);
});

test('Sunday 00:00 IST → locked (window opens 00:01)', () => {
  const ts = zonedToEpoch(SUNDAY, '00:00:00', TZ);
  const status = fullPaperStatus(ts);
  assert.equal(status.available, false);
  assert.match(status.reason, /opens at 00:01/);
});

test('Sunday 00:01 IST → available', () => {
  const ts = zonedToEpoch(SUNDAY, '00:01:00', TZ);
  assert.equal(fullPaperStatus(ts).available, true);
});

test('Sunday 23:59 IST → still available', () => {
  const ts = zonedToEpoch(SUNDAY, '23:59:00', TZ);
  assert.equal(fullPaperStatus(ts).available, true);
});

test('Monday → locked with clear reason', () => {
  const ts = zonedToEpoch(MONDAY, '10:00:00', TZ);
  const status = fullPaperStatus(ts);
  assert.equal(status.available, false);
  assert.match(status.reason, /locked on Monday/);
  assert.equal(status.dayName, 'Monday');
});

test('weekday names across the week', () => {
  const days = ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'];
  const names = days.map((d) => fullPaperStatus(zonedToEpoch(d, '09:00:00', TZ)).dayName);
  assert.deepEqual(names, ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
  const availableDays = days.map((d) => fullPaperStatus(zonedToEpoch(d, '09:00:00', TZ)).available);
  assert.deepEqual(availableDays, [true, false, false, false, false, false, false]);
});

test('assertFullPaperAllowed throws 403 outside the window', () => {
  const ts = zonedToEpoch(MONDAY, '10:00:00', TZ);
  assert.throws(() => assertFullPaperAllowed(ts), (err) => err.status === 403 && err.code === 'FULL_PAPER_LOCKED');
});

test('server-side FORCE flag (config only, never client-controlled) opens any day', () => {
  const ts = zonedToEpoch(MONDAY, '10:00:00', TZ);
  assert.equal(fullPaperStatus(ts).available, false);
  const forced = fullPaperStatus(ts, {
    ...CONFIG,
    FULL_PAPER: { ...CONFIG.FULL_PAPER, FORCE_AVAILABLE: true },
  });
  assert.equal(forced.available, true);
  assert.equal(forced.forced, true);
});
