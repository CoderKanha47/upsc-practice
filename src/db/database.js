import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import CONFIG from '../../config/exam.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;

export function dbPath() {
  const p = CONFIG.APP.DB_FILE;
  return path.isAbsolute(p) ? p : path.join(ROOT_DIR, p);
}

export function getDb() {
  if (db) return db;
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  return db;
}

export function closeDb() {
  if (db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    db = null;
  }
}

/** Run a function inside a transaction (rolls back on throw). */
export function tx(fn) {
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(d);
    d.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      d.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * Application clock. A controllable offset lets tests fast-forward time
 * (timers, Sunday windows) without waiting or touching the real system clock.
 */
let clockOffsetMs = 0;

export function now() {
  return Date.now() + clockOffsetMs;
}

/** Test-only: jump the application clock by `ms`. */
export function advanceClock(ms) {
  clockOffsetMs += ms;
  return now();
}

/** Test-only: set the absolute application clock offset. */
export function setClockOffset(ms) {
  clockOffsetMs = ms;
  return now();
}

export function resetClock() {
  clockOffsetMs = 0;
  return now();
}

export function newId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(9).toString('hex')}`;
}

/** Stable content hash used for duplicate detection across sources. */
export function contentHash(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

export function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function toJson(value) {
  return JSON.stringify(value ?? null);
}

/** Insert an audit log entry for admin actions. */
export function audit(entity, entityId, action, before, after, actor = 'admin') {
  getDb()
    .prepare(
      `INSERT INTO audit_log (entity, entity_id, action, before_json, after_json, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entity,
      String(entityId),
      action,
      before === undefined ? null : toJson(before),
      after === undefined ? null : toJson(after),
      actor,
      now(),
    );
}

export default { getDb, closeDb, tx, now, advanceClock, setClockOffset, resetClock, newId, contentHash, audit };
