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
  const hasQuestions = Boolean(
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'questions'`).get(),
  );
  // Existing databases are upgraded in place BEFORE the schema is (re)applied,
  // because schema.sql may reference columns that only the migration adds.
  if (hasQuestions) {
    migrate(db);
    selfHeal(db);
  }
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  if (!hasQuestions) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

/* ================================================================ migrations */
const SCHEMA_VERSION = 2;

function tableInfo(d, table) {
  return d.prepare(`PRAGMA table_info(${table})`).all();
}

function hasColumn(cols, name) {
  return cols.some((c) => c.name === name);
}

function tableSql(d, table) {
  const row = d.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
  return row ? row.sql || '' : '';
}

function ensureColumn(d, table, column, definition) {
  if (!hasColumn(tableInfo(d, table), column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * The legacy questions table carried `paper TEXT NOT NULL CHECK (paper IN
 * ('GS1','CSAT'))`. Its stored SQL uses column-aligned whitespace, so the
 * detection must be whitespace-normalised or the rebuild is silently skipped.
 */
function needsQuestionsRebuild(d) {
  const norm = tableSql(d, 'questions').replace(/\s+/g, ' ');
  return norm.includes('paper TEXT NOT NULL CHECK');
}

/**
 * Rebuild `questions` without the paper CHECK. Tolerates a source table that
 * is missing tier/shift (very old layout) or already has them (heal path).
 */
function rebuildQuestionsTable(d) {
  const cols = tableInfo(d, 'questions').map((c) => c.name);
  const has = (n) => cols.includes(n);
  const copyCols = [
    'id', 'year', 'exam', 'paper',
    ...(has('tier') ? ['tier'] : []),
    ...(has('shift') ? ['shift'] : []),
    'question_number', 'question_text', 'passage', 'group_id', 'group_index',
    'options_json', 'correct_answer', 'subject', 'topic', 'subtopic', 'difficulty',
    'question_type', 'estimated_time_seconds', 'marks', 'negative_marks', 'source',
    'source_type', 'is_official_pyq', 'validation_state', 'is_duplicate', 'dup_key',
    'content_hash', 'explanation', 'concept', 'tags_json', 'batch_id', 'created_at', 'updated_at',
  ];
  const targetCols = ['id', 'year', 'exam', 'paper', 'tier', 'shift', ...copyCols.slice(4).filter((c) => c !== 'tier' && c !== 'shift')];
  const selectList = targetCols.map((c) => (copyCols.includes(c) ? c : 'NULL')).join(', ');

  d.exec('PRAGMA foreign_keys = OFF');
  d.exec('BEGIN IMMEDIATE');
  try {
    d.exec(`CREATE TABLE questions_migrated (
      id                     TEXT PRIMARY KEY,
      year                   INTEGER,
      exam                   TEXT NOT NULL DEFAULT 'UPSC_CSE_PRELIMS',
      paper                  TEXT NOT NULL,
      tier                   TEXT,
      shift                  TEXT,
      question_number        INTEGER,
      question_text          TEXT NOT NULL,
      passage                TEXT,
      group_id               TEXT,
      group_index            INTEGER,
      options_json           TEXT NOT NULL,
      correct_answer         TEXT,
      subject                TEXT,
      topic                  TEXT,
      subtopic               TEXT,
      difficulty             TEXT DEFAULT 'medium',
      question_type          TEXT DEFAULT 'conceptual',
      estimated_time_seconds INTEGER,
      marks                  REAL NOT NULL DEFAULT 2,
      negative_marks         REAL NOT NULL DEFAULT 0.6667,
      source                 TEXT,
      source_type            TEXT NOT NULL DEFAULT 'OFFICIAL_PYQ'
                             CHECK (source_type IN ('OFFICIAL_PYQ', 'AI_GENERATED', 'CUSTOM')),
      is_official_pyq        INTEGER NOT NULL DEFAULT 0,
      validation_state       TEXT NOT NULL DEFAULT 'IMPORTED'
                             CHECK (validation_state IN ('IMPORTED', 'PARSED', 'REVIEW_REQUIRED', 'VERIFIED')),
      is_duplicate           INTEGER NOT NULL DEFAULT 0,
      dup_key                TEXT,
      content_hash           TEXT,
      explanation            TEXT,
      concept                TEXT,
      tags_json              TEXT,
      batch_id               TEXT,
      created_at             INTEGER NOT NULL,
      updated_at             INTEGER NOT NULL
    )`);
    d.exec(`INSERT INTO questions_migrated (${targetCols.join(', ')})
      SELECT ${selectList} FROM questions`);
    d.exec('DROP TABLE questions');
    d.exec('ALTER TABLE questions_migrated RENAME TO questions');
    d.exec('COMMIT');
  } catch (err) {
    try {
      d.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    d.exec('PRAGMA foreign_keys = ON');
    throw err;
  }
  d.exec('PRAGMA foreign_keys = ON');
  const violations = d.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) {
    throw new Error(`questions rebuild left ${violations.length} foreign-key violations.`);
  }
}

/**
 * Always-on structural repair, independent of user_version. Heals databases
 * that were partially migrated (e.g. legacy CHECK survived because an earlier
 * process wrote a stale table) so SSC inserts can never hit the old constraint.
 */
function selfHeal(d) {
  if (needsQuestionsRebuild(d)) rebuildQuestionsTable(d);
  ensureColumn(d, 'questions', 'tier', 'TEXT');
  ensureColumn(d, 'questions', 'shift', 'TEXT');
  ensureColumn(d, 'test_sessions', 'exam', 'TEXT');
  ensureColumn(d, 'test_sessions', 'total_marks', 'REAL');
  ensureColumn(d, 'paper_coverage', 'exam', 'TEXT');
  ensureColumn(d, 'paper_coverage', 'tier', 'TEXT');
  ensureColumn(d, 'paper_coverage', 'shift', 'TEXT');
  ensureColumn(d, 'import_batches', 'exam', 'TEXT');
  d.exec(`UPDATE questions SET exam = 'UPSC_CSE_PRELIMS' WHERE exam = 'CSE_PRELIMS'`);
}

/** Upgrade an existing database in place. Guarded by PRAGMA user_version. */
function migrate(d) {
  let version = 0;
  try {
    version = Number(d.prepare('PRAGMA user_version').get().user_version || 0);
  } catch {
    version = 0;
  }
  if (version >= SCHEMA_VERSION) return;

  if (version < 1) {
    // v1: multi-exam support -----------------------------------------------
    if (needsQuestionsRebuild(d)) rebuildQuestionsTable(d);
    ensureColumn(d, 'test_sessions', 'exam', 'TEXT');
    ensureColumn(d, 'test_sessions', 'total_marks', 'REAL');
    ensureColumn(d, 'paper_coverage', 'exam', 'TEXT');
    ensureColumn(d, 'paper_coverage', 'tier', 'TEXT');
    ensureColumn(d, 'paper_coverage', 'shift', 'TEXT');
    ensureColumn(d, 'import_batches', 'exam', 'TEXT');
    // Normalize legacy exam ids and backfill session/coverage exam columns.
    d.exec(`UPDATE questions SET exam = 'UPSC_CSE_PRELIMS' WHERE exam = 'CSE_PRELIMS'`);
    d.exec(`UPDATE test_sessions SET exam = CASE WHEN paper IN ('GS1','CSAT') THEN 'UPSC_CSE_PRELIMS' ELSE exam END WHERE exam IS NULL`);
    d.exec(`UPDATE paper_coverage SET exam = CASE WHEN paper IN ('GS1','CSAT') THEN 'UPSC_CSE_PRELIMS' ELSE exam END WHERE exam IS NULL`);
    // Indexes dropped with the rebuilt table are recreated when getDb()
    // applies schema.sql immediately after this migration finishes.
  }

  d.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
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
