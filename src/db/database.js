/**
 * Database adapter exposing a node:sqlite-shaped surface
 * (`prepare().get/all/run`, `exec()`) so service code stays unchanged.
 *
 * Two drivers, selected by env:
 *   - `DATABASE_URL` set  → real Postgres (`pg`), for Vercel/serverless.
 *   - otherwise           → local `node:sqlite`, for dev and the test suite.
 *
 * The Postgres driver is async, so on that path this module exposes an ASYNC
 * surface (`await db.prepare(sql).get(...)`). Call sites are sync on the
 * SQLite path; because `await` on a non-promise is a no-op, a single codebase
 * serves both. See src/db/context.js for how the request-scoped client and
 * transactions are propagated.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import CONFIG from '../../config/exam.config.js';
import { currentClient, runInClient } from './context.js';

// node:sqlite is CJS-only in some Node builds; createRequire keeps the import
// valid under this module's ESM scope.
const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

export const usingPostgres = Boolean(process.env.DATABASE_URL);

/* ------------------------------------------------------------------ SQL rewrites */

/** Split a SQL string into statements, honouring '...' "..." and --/# comments. */
function splitStatements(sql) {
  const out = [];
  let cur = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      cur += c;
      i++;
      while (i < sql.length) {
        cur += sql[i];
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            cur += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '#') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (c === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Convert SQLite-flavoured SQL to Postgres. */
export function toPostgres(sql) {
  let out = sql;
  // Scalar two-arg MAX(a,b) → GREATEST(a,b). Only matches qualified/excluded
  // column refs, so it never fires on MAX(col) aggregates.
  out = out.replace(
    /\bMAX\s*\(\s*((?:excluded|[A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z_][A-Za-z0-9_]*)\s*,\s*([^()]+)\)/gi,
    'GREATEST($1, $2)',
  );
  out = out.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');
  // `col IS ?` → `col IS NOT DISTINCT FROM $n` (Postgres has no `IS <expr>`).
  out = out.replace(/\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\s+IS\s+(?=\?)/g, '$1 IS NOT DISTINCT FROM ');
  // SQLite LIKE is case-insensitive by default; match that with ILIKE.
  out = out.replace(/\bLIKE\s+(?=\?)/gi, 'ILIKE ');
  return out;
}

/** Rewrite `?` placeholders to `$1..$n`, ignoring those inside string literals. */
export function toNumberedPlaceholders(sql) {
  let out = '';
  let n = 0;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            out += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '?') {
      n += 1;
      out += `$${n}`;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Append ON CONFLICT DO NOTHING when the source used INSERT OR IGNORE. */
function withConflictNoop(sql, converted) {
  if (!/\bINSERT\s+OR\s+IGNORE\b/i.test(sql)) return converted;
  const m = converted.match(/^(\s*INSERT\s+INTO[\s\S]*?VALUES\s*\([\s\S]*?\))\s*;?\s*$/i);
  if (!m) return converted;
  return `${m[1]} ON CONFLICT DO NOTHING`;
}

const prepareCache = new Map();

/** Convert and cache a statement's Postgres form. */
function compile(sql) {
  let c = prepareCache.get(sql);
  if (c) return c;
  const converted = toPostgres(sql);
  c = {
    text: withConflictNoop(sql, toNumberedPlaceholders(converted)),
    source: sql,
  };
  prepareCache.set(sql, c);
  return c;
}

/** Normalise bound values into something `pg` accepts. */
function normaliseParam(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (Buffer.isBuffer(v)) return v;
  if (v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
    return JSON.stringify(v);
  }
  return v;
}

function normaliseParams(values) {
  return Array.from(values, normaliseParam);
}

/** Postgres unique-violation (used by the cycle race-retry path). */
export function isUniqueViolation(err) {
  return err?.code === '23505' || /duplicate key value/i.test(err?.message || '');
}

/* --------------------------------------------------------------- Postgres driver */

let pgPool = null;

/** Postgres connection pool (only when DATABASE_URL is set). */
export async function getPool() {
  if (!usingPostgres) throw new Error('getPool() requires DATABASE_URL');
  if (!pgPool) {
    const { default: pg } = await import('pg');
    // node-postgres returns JS numbers for int8 by default, which can silently
    // lose precision on epoch-ms timestamps. Keep them as strings.
    pg.types.setTypeParser(20, (v) => v);
    pgPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 5),
      ssl: process.env.PG_SSL === '0' ? false : { rejectUnauthorized: false },
    });
  }
  return pgPool;
}

class PgStatement {
  constructor(sql) {
    this.compiled = compile(sql);
  }

  async #exec(values) {
    const pool = await getPool();
    const client = currentClient() || pool;
    const res = await client.query(this.compiled.text, normaliseParams(values));
    return res;
  }

  async get(...values) {
    const res = await this.#exec(values);
    return res.rows[0];
  }

  async all(...values) {
    const res = await this.#exec(values);
    return res.rows;
  }

  async run(...values) {
    const res = await this.#exec(values);
    return { changes: res.rowCount, rowCount: res.rowCount };
  }
}

/* -------------------------------------------------------------- SQLite driver */

function makeSqliteStatement(raw) {
  return {
    get: (...values) => raw.get(...values),
    all: (...values) => raw.all(...values),
    run: (...values) => raw.run(...values),
  };
}

function makeSqliteDatabase(handle) {
  return {
    prepare: (sql) => makeSqliteStatement(handle.prepare(sql)),
    exec: (sql) => handle.exec(sql),
    close: () => handle.close(),
  };
}

/* ------------------------------------------------------------- Postgres handle */

/**
 * A synchronous-looking handle over the Postgres pool.
 *
 * The whole app calls `const db = getDb()` and then `db.prepare(sql).get(...)`
 * synchronously — 53 sites that must not change. `prepare()` therefore returns
 * an object whose methods are async, and every call site awaits them (awaiting
 * a non-promise is a no-op, so SQLite stays synchronous).
 */
function makePgDatabase() {
  const handle = {
    prepare: (sql) => new PgStatement(sql),
    exec: (sql) => {
      // Returns a promise so callers can await DDL; statements are serialised
      // on one client so ordering is preserved.
      return getPool().then(async (pool) => {
        const client = await pool.connect();
        try {
          for (const stmt of splitStatements(sql)) {
            // eslint-disable-next-line no-await-in-loop
            await client.query(stmt);
          }
        } finally {
          client.release();
        }
      });
    },
    close: () => {
      const p = pgPool;
      pgPool = null;
      return p ? p.end() : Promise.resolve();
    },
  };
  return handle;
}

/* ------------------------------------------------------------------- bootstrap */

let db = null;
let schemaReady = null;

export function dbPath() {
  const p = CONFIG.APP.DB_FILE;
  return path.isAbsolute(p) ? p : path.join(ROOT_DIR, p);
}

const SCHEMA_VERSION = 3;

async function applyPgSchema() {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => Number(r.version)));
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*PRAGMA\b/i.test(line))
      .join('\n');
    // The audit_log id column is AUTOINCREMENT in SQLite; Postgres uses an
    // identity column instead.
    const pgSchema = schema.replace(
      /id\s+INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/i,
      'id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY',
    );
    for (const stmt of splitStatements(pgSchema)) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(stmt);
    }
    if (!applied.has(SCHEMA_VERSION)) {
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [SCHEMA_VERSION]);
    }
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

async function initPg() {
  await applyPgSchema();
  return makePgDatabase();
}

function initSqlite() {
  const { DatabaseSync } = require('node:sqlite');
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const handle = new DatabaseSync(file);
  handle.exec('PRAGMA journal_mode = WAL');
  handle.exec('PRAGMA foreign_keys = ON');
  const hasQuestions = Boolean(
    handle.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'questions'`).get(),
  );
  // Existing databases are upgraded in place BEFORE the schema is (re)applied,
  // because schema.sql may reference columns that only the migration adds.
  if (hasQuestions) {
    migrate(handle);
    selfHeal(handle);
  }
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  handle.exec(schema);
  if (!hasQuestions) handle.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return makeSqliteDatabase(handle);
}

/**
 * Return the database handle.
 *
 * Always synchronous: SQLite returns the real handle, Postgres returns a
 * proxy whose `prepare()` methods are async. Callers `await` those methods,
 * which is a no-op on SQLite, so one codebase serves both drivers.
 *
 * The first call on the Postgres path must be preceded by `await dbReady()`
 * (server bootstrap does this), so the handle is never used before the schema
 * has been applied.
 */
export function getDb() {
  if (usingPostgres) {
    if (!db) db = makePgDatabase();
    return db;
  }
  if (!db) db = initSqlite();
  return db;
}

/** Await the database handle. Correct on both drivers. */
export async function dbReady() {
  if (usingPostgres) {
    if (!schemaReady) schemaReady = initPg();
    db = await schemaReady;
    return db;
  }
  return getDb();
}

export function closeDb() {
  if (usingPostgres) {
    const h = db;
    db = null;
    schemaReady = null;
    return h ? h.close() : Promise.resolve();
  }
  if (db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    db = null;
  }
  return undefined;
}

/* ----------------------------------------------------------------- transactions */

/**
 * Run a function inside a transaction (rolls back on throw).
 *
 * On Postgres a dedicated client is checked out of the pool, BEGIN is issued,
 * and the client is published through AsyncLocalStorage so every nested
 * `getDb()` resolves to it — which is what keeps statements issued inside the
 * callback on the same transaction.
 */
export function tx(fn) {
  if (usingPostgres) {
    return (async () => {
      const pool = await getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await runInClient(client, () => fn(undefined));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw err;
      } finally {
        client.release();
      }
    })();
  }
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  let result;
  try {
    result = fn(d);
  } catch (err) {
    try {
      d.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
  // An async callback settles after the synchronous statements above; wait for
  // it before COMMIT so its writes still sit inside the transaction.
  if (result && typeof result.then === 'function') {
    return result.then(
      (r) => {
        d.exec('COMMIT');
        return r;
      },
      (err) => {
        try {
          d.exec('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw err;
      },
    );
  }
  d.exec('COMMIT');
  return result;
}

/* ================================================================ SQLite migrations */
/* These only ever run on the local SQLite path (never Postgres, which gets a
   fresh schema from schema.sql). Kept verbatim from the original module. */

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

function needsQuestionsRebuild(d) {
  const norm = tableSql(d, 'questions').replace(/\s+/g, ' ');
  return norm.includes('paper TEXT NOT NULL CHECK');
}

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

function selfHeal(d) {
  if (needsQuestionsRebuild(d)) rebuildQuestionsTable(d);
  ensureColumn(d, 'questions', 'tier', 'TEXT');
  ensureColumn(d, 'questions', 'shift', 'TEXT');
  ensureColumn(d, 'test_sessions', 'exam', 'TEXT');
  ensureColumn(d, 'test_sessions', 'total_marks', 'REAL');
  ensureColumn(d, 'test_sessions', 'cycle_id', 'TEXT');
  ensureColumn(d, 'paper_coverage', 'exam', 'TEXT');
  ensureColumn(d, 'paper_coverage', 'tier', 'TEXT');
  ensureColumn(d, 'paper_coverage', 'shift', 'TEXT');
  ensureColumn(d, 'import_batches', 'exam', 'TEXT');
  d.exec(`UPDATE questions SET exam = 'UPSC_CSE_PRELIMS' WHERE exam = 'CSE_PRELIMS'`);
}

function migrate(d) {
  let version = 0;
  try {
    version = Number(d.prepare('PRAGMA user_version').get().user_version || 0);
  } catch {
    version = 0;
  }
  if (version >= SCHEMA_VERSION) return;

  if (version < 1) {
    if (needsQuestionsRebuild(d)) rebuildQuestionsTable(d);
    ensureColumn(d, 'test_sessions', 'exam', 'TEXT');
    ensureColumn(d, 'test_sessions', 'total_marks', 'REAL');
    ensureColumn(d, 'paper_coverage', 'exam', 'TEXT');
    ensureColumn(d, 'paper_coverage', 'tier', 'TEXT');
    ensureColumn(d, 'paper_coverage', 'shift', 'TEXT');
    ensureColumn(d, 'import_batches', 'exam', 'TEXT');
    d.exec(`UPDATE questions SET exam = 'UPSC_CSE_PRELIMS' WHERE exam = 'CSE_PRELIMS'`);
    d.exec(`UPDATE test_sessions SET exam = CASE WHEN paper IN ('GS1','CSAT') THEN 'UPSC_CSE_PRELIMS' ELSE exam END WHERE exam IS NULL`);
    d.exec(`UPDATE paper_coverage SET exam = CASE WHEN paper IN ('GS1','CSAT') THEN 'UPSC_CSE_PRELIMS' ELSE exam END WHERE exam IS NULL`);
  }

  if (version < 3) {
    ensureColumn(d, 'test_sessions', 'cycle_id', 'TEXT');
  }

  d.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/* ------------------------------------------------------------- shared helpers */

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

/**
 * Insert an audit log entry for admin actions.
 *
 * Fire-and-forget for callers (none read the return value), but the insert is
 * awaited internally so that on the Postgres path it stays inside the
 * surrounding `tx()` instead of escaping onto another pooled client.
 */
export function audit(entity, entityId, action, before, after, actor = 'admin') {
  const run = getDb()
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
  // On SQLite `run()` is sync, so this is a no-op await; on Postgres it keeps
  // the insert bound to the current transaction context.
  return Promise.resolve(run).catch((err) => {
    console.error('[audit] failed to write audit log entry:', err.message);
  });
}

export default { getDb, closeDb, tx, now, advanceClock, setClockOffset, resetClock, newId, contentHash, audit };
