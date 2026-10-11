-- Exam Practice Simulator — database schema (multi-exam)
-- Applied idempotently by src/db/database.js (SQLite via node:sqlite).
-- Existing databases are upgraded in-place by the migrations in database.js
-- (PRAGMA user_version). Paper ids are globally unique across exams:
--   UPSC: GS1, CSAT   ·   SSC CGL: SSC_T1, SSC_T2_P1, SSC_T2_P2, SSC_T2_P3

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- QUESTIONS
-- A question row is never silently rewritten once VERIFIED (enforced in the
-- admin service, see src/services/questionService.js).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS questions (
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
  created_at             BIGINT NOT NULL,
  updated_at             BIGINT NOT NULL
);

-- Official PYQs are uniquely identified by year + paper + question number
-- (plus shift for SSC shift-wise papers — see dupKeyFor in questionService).
CREATE UNIQUE INDEX IF NOT EXISTS ux_questions_dup_key
  ON questions (dup_key)
  WHERE source_type = 'OFFICIAL_PYQ' AND is_duplicate = 0 AND dup_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_questions_exam ON questions (exam);
CREATE INDEX IF NOT EXISTS ix_questions_paper_year ON questions (paper, year);
CREATE INDEX IF NOT EXISTS ix_questions_subject ON questions (subject);
CREATE INDEX IF NOT EXISTS ix_questions_topic ON questions (topic);
CREATE INDEX IF NOT EXISTS ix_questions_hash ON questions (content_hash);
CREATE INDEX IF NOT EXISTS ix_questions_state ON questions (validation_state);
CREATE INDEX IF NOT EXISTS ix_questions_source_type ON questions (source_type);
CREATE INDEX IF NOT EXISTS ix_questions_group ON questions (group_id);

-- ---------------------------------------------------------------------------
-- IMPORT PIPELINE: batches, coverage registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_batches (
  id              TEXT PRIMARY KEY,
  filename        TEXT,
  format          TEXT,
  source_type     TEXT,
  exam            TEXT,
  state           TEXT NOT NULL DEFAULT 'IMPORTED',
  total           INTEGER DEFAULT 0,
  inserted        INTEGER DEFAULT 0,
  duplicates      INTEGER DEFAULT 0,
  rejected        INTEGER DEFAULT 0,
  needs_review    INTEGER DEFAULT 0,
  notes           TEXT,
  created_at      BIGINT NOT NULL
);

-- One row per (year, paper). Paper ids are globally unique so (year, paper)
-- remains a valid key across exams. Drives "DATA MISSING" states.
CREATE TABLE IF NOT EXISTS paper_coverage (
  year            INTEGER NOT NULL,
  paper           TEXT NOT NULL,
  exam            TEXT,
  tier            TEXT,
  shift           TEXT,
  status          TEXT NOT NULL DEFAULT 'DATA_MISSING',
  official_count  INTEGER DEFAULT 0,
  verified_count  INTEGER DEFAULT 0,
  keyed_count     INTEGER DEFAULT 0,
  source          TEXT,
  notes           TEXT,
  updated_at      BIGINT NOT NULL,
  PRIMARY KEY (year, paper)
);

-- ---------------------------------------------------------------------------
-- TEST SESSIONS (persisted exam attempts — refresh never resets a session)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS test_sessions (
  id                 TEXT PRIMARY KEY,
  mode               TEXT NOT NULL,          -- FULL_EXACT | FULL_MIXED | SELECTIVE | PYQ_PRACTICE
  kind_label         TEXT NOT NULL,          -- EXACT PYQ PAPER | MIXED PYQ PAPER | SELECTIVE PRACTICE
  exam               TEXT,
  paper              TEXT NOT NULL,
  title              TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  cycle_id           TEXT,                   -- SSC weekly cycle link (full-paper attempts only)
  config_json        TEXT NOT NULL DEFAULT '{}',
  question_ids_json  TEXT NOT NULL DEFAULT '[]',
  seed               TEXT,
  started_at         BIGINT NOT NULL,
  duration_seconds   INTEGER NOT NULL,
  deadline_at        BIGINT NOT NULL,
  submitted_at       BIGINT,
  attempted          INTEGER DEFAULT 0,
  correct            INTEGER DEFAULT 0,
  incorrect          INTEGER DEFAULT 0,
  unattempted        INTEGER DEFAULT 0,
  marks_obtained     REAL DEFAULT 0,
  negative_marks     REAL DEFAULT 0,
  total_marks        REAL,
  accuracy           REAL DEFAULT 0,
  time_used_seconds  REAL DEFAULT 0,
  created_at         BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_sessions_status ON test_sessions (status);
CREATE INDEX IF NOT EXISTS ix_sessions_started ON test_sessions (started_at);
CREATE INDEX IF NOT EXISTS ix_sessions_exam ON test_sessions (exam);
CREATE INDEX IF NOT EXISTS ix_sessions_cycle ON test_sessions (cycle_id);

CREATE TABLE IF NOT EXISTS session_answers (
  session_id          TEXT NOT NULL REFERENCES test_sessions (id) ON DELETE CASCADE,
  question_id         TEXT NOT NULL,
  answer              TEXT,
  marked              INTEGER NOT NULL DEFAULT 0,
  visited             INTEGER NOT NULL DEFAULT 0,
  time_spent_seconds  REAL NOT NULL DEFAULT 0,
  is_correct          INTEGER,
  updated_at          BIGINT NOT NULL,
  PRIMARY KEY (session_id, question_id)
);

-- ---------------------------------------------------------------------------
-- PER-QUESTION PERFORMANCE (drives calibration, mastery, analytics)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS question_stats (
  question_id         TEXT PRIMARY KEY REFERENCES questions (id) ON DELETE CASCADE,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  correct_count       INTEGER NOT NULL DEFAULT 0,
  incorrect_count     INTEGER NOT NULL DEFAULT 0,
  skipped_count       INTEGER NOT NULL DEFAULT 0,
  last_attempted_at  BIGINT,
  best_time_seconds   REAL,
  average_time_seconds REAL,
  total_time_seconds  REAL NOT NULL DEFAULT 0,
  timed_count         INTEGER NOT NULL DEFAULT 0,
  consecutive_correct INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- SETTINGS (runtime-editable config overrides, e.g. SELECTIVE_BUFFER_SECONDS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- ---------------------------------------------------------------------------
-- AUDIT LOG (admin edits to question metadata / verification actions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  action     TEXT NOT NULL,
  before_json TEXT,
  after_json  TEXT,
  actor      TEXT,
  created_at BIGINT NOT NULL
);

-- ---------------------------------------------------------------------------
-- SSC CGL WEEKLY CYCLES (one independent record per Sunday, Asia/Kolkata)
-- cycle_date is the Sunday date key; the id is SSC-CGL-YYYY-MM-DD.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ssc_cycles (
  id                      TEXT PRIMARY KEY,
  cycle_date              TEXT NOT NULL UNIQUE,   -- 'YYYY-MM-DD' of the Sunday, IST
  cutoff_mode             TEXT NOT NULL,          -- MANUAL | RANDOM_WEEKLY | DIFFICULTY_AWARE
  cutoff_percent          REAL NOT NULL,          -- persisted once; never regenerated
  cutoff_snapshot_json    TEXT NOT NULL DEFAULT '{}',
  difficulty              TEXT,                   -- EASY | MEDIUM | HARD (null when not difficulty-aware)
  difficulty_source       TEXT,                   -- MANUAL | METADATA
  historical_baseline_percent REAL,
  adjustment_pp           REAL,
  tier1_paper_id          TEXT NOT NULL DEFAULT 'SSC_T1',
  tier1_session_id        TEXT,
  tier1_status            TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED', -- NOT_ATTEMPTED|IN_PROGRESS|COMPLETED|ABSENT
  tier1_marks             REAL,
  tier1_total_marks       REAL,
  tier1_percent           REAL,
  qualification_status    TEXT NOT NULL DEFAULT 'PENDING',        -- PENDING|QUALIFIED|NOT_QUALIFIED
  tier2_paper_id          TEXT,
  tier2_session_id        TEXT,
  tier2_status            TEXT NOT NULL DEFAULT 'NOT_ELIGIBLE',  -- NOT_ELIGIBLE|IN_PROGRESS|COMPLETED|ABSENT
  tier2_marks             REAL,                    -- null for ABSENT (never zero)
  tier2_total_marks       REAL,
  tier2_percent           REAL,
  finalized_at            BIGINT,
  created_at              BIGINT NOT NULL,
  updated_at              BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_ssc_cycles_date ON ssc_cycles (cycle_date);

-- ---------------------------------------------------------------------------
-- HISTORICAL SSC CUTOFFS (official reference data — never a simulated cutoff)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ssc_cutoff_history (
  id                  TEXT PRIMARY KEY,
  year                INTEGER NOT NULL,
  category            TEXT NOT NULL,             -- UR | OBC | EWS | SC | ST | ...
  list                TEXT NOT NULL DEFAULT 'GENERAL', -- GENERAL | JSO | STATISTICAL_INVESTIGATOR
  raw_marks           REAL NOT NULL,
  max_marks           REAL NOT NULL DEFAULT 200,
  normalized_percent  REAL NOT NULL,
  source_url          TEXT,
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED', -- VERIFIED | UNVERIFIED | MISSING
  notes               TEXT,
  created_at          BIGINT NOT NULL,
  UNIQUE (year, category, list)
);

-- ---------------------------------------------------------------------------
-- PAPER DIFFICULTY (optional metadata; never invented when data is thin)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paper_difficulty (
  id              TEXT PRIMARY KEY,
  paper_id        TEXT NOT NULL,
  cycle_date      TEXT,                          -- null = general classification
  difficulty      TEXT NOT NULL,                 -- EASY | MEDIUM | HARD
  difficulty_source TEXT NOT NULL,               -- MANUAL | METADATA
  question_count  INTEGER,
  computed_json   TEXT,
  created_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_paper_difficulty_paper ON paper_difficulty (paper_id, cycle_date);
