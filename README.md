# Prelims Practice Simulator — UPSC CSE & SSC CGL

A personal mock-test and Previous Year Question (PYQ) practice system for two
independent exam systems, switchable from the topbar:

- **UPSC CSE Prelims** — GS Paper I and CSAT, Sunday-only full-paper
  simulation (2007–2026).
- **SSC CGL** — Tier-I (100 Q / 60 min / 200 marks, **sectional timers with
  auto-lock**), Tier-II Paper-I session-I subjects, Paper-II Statistics and
  Paper-III AAO (2006–2026).

Both exams share always-unlocked selective practice, a PYQ explorer, accurate
scoring, analytics/mastery tracking, an import pipeline and a data-validation
admin console. Exam rules live in one config file; the database, sessions,
timers and analytics are exam-scoped throughout.

No accounts, no cloud, no build step — a Node.js server + SQLite + a vanilla
ES-module SPA, running locally at `http://127.0.0.1:3456`.

---

## 1. Ground rules (what this app never does)

| Rule | How it is enforced |
| --- | --- |
| **Official PYQs are never invented** | Un-imported papers show `DATA_MISSING · 0/N`. The server returns `409 DATA_MISSING` instead of starting a fake paper; mixed papers draw only from imported official questions. SSC full papers stay locked until official SSC imports exist — the seeded bank is practice material only. |
| **AI-generated questions are always labelled** | Every question carries `source_type` (`OFFICIAL_PYQ` / `AI_GENERATED` / `CUSTOM`) and a badge is rendered everywhere it appears. The seeded banks (63 UPSC + 47 SSC practice questions) are labelled `AI GENERATED`. |
| **Sectional auto-lock is server-enforced** | SSC Tier-I sectional timers run on the server clock. When a section's deadline passes the server rejects its answers (`409 SECTION_LOCKED`), the palette disables those questions, and the result reports a per-section breakdown. Never a client-side guess. |
| **No answer leakage during an exam** | `playableQuestions()` strips `correct_answer`, `explanation`, `subject`, `topic`, `difficulty` before anything reaches the browser. Answers appear only in the result review after submission (and in PYQ Explorer only after you have attempted that question). |
| **The server owns the clock** | `started_at` + `deadline_at` live in the database. The client only *displays* remaining time received from the server and re-syncs every ~15 s. Refresh, closed tab, laptop sleep or a changed system clock cannot reset or extend time. |
| **Sunday lock is server-side** | `fullPaperStatus()` is computed from the server clock in `Asia/Kolkata`. The client cannot influence it (`FULL_PAPER_FORCE_AVAILABLE` is an env-only test override, never read from the client). |
| **Exam rules are configuration** | Papers, window, scoring, buffer, time model, mastery rules, taxonomy — all in `config/exam.config.js`. If UPSC changes the scheme, one file changes. |

---

## 2. Quick start

### Windows (double-click)

```bat
start.bat      :: starts the server in its own window, opens the browser
stop.bat       :: stops only the server process, frees port 3456
```

### Command line

```bash
npm install
npm run seed        # schema + 63 UPSC + 47 SSC labelled AI practice questions
npm start           # http://127.0.0.1:3456
npm test            # full test suite (78 tests)
```

Default admin token: `local-admin-token` (override with env `ADMIN_TOKEN`).

---

## 3. How the app works (user guide)

**Exam switcher:** the dropdown in the topbar switches between UPSC CSE
Prelims and SSC CGL. The choice is saved in the browser and injected into
every API call, so the dashboard, selective practice, full papers, PYQ
explorer, results and analytics are always scoped to one exam. Shared links
accept `?exam=SSC_CGL` to force an exam.

**Appearance:** the **Theme** button in the topbar switches between light and dark
mode. Your choice is saved in the browser (`localStorage`); with no saved choice
the app follows the OS preference (`prefers-color-scheme`).

### Dashboard (`#/`)

Shows the two entry modes with their live status for the selected exam, your
performance tiles (PYQs attempted, accuracy, average score, strongest/weakest
subject, mastery, year-span coverage) and your recent tests, scoped to that
exam. If a test is still running you get a **resume banner** — its original
deadline is untouched.

### Full Paper (`#/full`) — Sunday only

- **Window:** every Sunday 00:01–23:59 `Asia/Kolkata`, enforced by the server
  for both exams. On other days the page shows `LOCKED` with the reason and
  the next opening time; the start buttons are disabled (and the API answers
  `403` if you try).
- **UPSC:** pick year + paper (GS Paper I or CSAT) as an exact PYQ paper, or a
  mixed paper from the imported official pool. Each paper is its own session —
  100 Q / 120 min, then 80 Q / 120 min. Never a combined 4-hour test.
- **SSC CGL:** pick the paper (Tier-I, Tier-II Paper-I…), the shift, and either
  an exact imported paper or a current-pattern mixed mock. Tier-I mocks follow
  the sectional rules: four 25-question sections, each with its own 15-minute
  timer that **auto-locks** — closed sections cannot be reopened. Historical
  papers (2006–2021) keep their original formats.
- Mixed papers draw randomised questions from the imported pool with a server
  seed, and are disabled with an explanatory hint when the official pool for
  that paper is empty (`DATA_MISSING` — nothing is ever invented).
- **Resume:** if you already have an in-progress paper of the same kind, the
  server resumes it instead of creating a new one.

### SSC CGL weekly cycles & cutoffs

- Each Sunday is an **independent cycle** with id `SSC-CGL-YYYY-MM-DD` (the
  Sunday's date in Asia/Kolkata). Qualification never carries over.
- **Cutoff modes** (Admin → SSC Configuration):
  - `MANUAL` — one configured percentage for every cycle.
  - `RANDOM_WEEKLY` — one secure draw inside a configured min/max range.
  - `DIFFICULTY_AWARE` — historical baseline adjusted by paper difficulty
    (EASY +3pp, MEDIUM 0, HARD −3pp, clamped 55–85%). The baseline is
    `resolveBaseline` (AVERAGE_RECENT of official-looking historical figures).
- The cutoff is **generated once per cycle and persisted**; it is never
  regenerated on refresh, retry or reopen. Concurrent starts are race-safe via
  `UNIQUE(cycle_date)`.
- **Tier-I qualification gate:** Tier-II full paper starts only if this
  cycle's Tier-I result meets the cutoff (`CYCLE_CUTOFF` qualification type).
  Selective Tier-II practice is always available, 24/7.
- **Finalization:** at cycle close (or lazily on next access, or manually in
  Admin), sessions are settled as `ABSENT` (null score), `NOT_ELIGIBLE`,
  `NOT_QUALIFIED` etc. A finalized cycle is immutable — cutoff and scores are
  never rewritten.
- **Historical cutoffs** (2022: 114.27, 2023: 150.05, 2024: 153.19, 2025:
  ~136.83 / 200 UR) are stored as `UNVERIFIED` reference only and are never
  mixed with the simulated cutoff.

### Selective Practice (`#/selective`) — always open

1. **Scope:** paper(s), subject(s), topics, question type, difficulty, years.
2. **Question bank:** Official PYQ / AI-generated / custom toggles, plus
   "avoid questions I have already seen".
3. **Count:** presets (5 → 100) or all in pool.
4. **Timing preview — shown *before* you start:**

   ```
   Total time = Σ (estimated question time) + buffer × count
   ```

   Base estimates come from the time model (type × difficulty × paper factor,
   plus passage reading at 0.4 s/word shared across a comprehension group).
   Buffer defaults to **15 s** per question (config/env
   `SELECTIVE_BUFFER_SECONDS`). Example: 10 questions → base 5m 32s +
   buffer 1m 15s = **6m 47s** on your exam timer.

### Exam runner (`#/exam/:id`)

- Server-synced countdown (red under 1 min, amber under 10 min); auto-submits
  at 00:00 even if the tab was closed.
- **Sectional papers (SSC Tier-I):** a section strip shows each section's state
  (open / upcoming / locked). When a section's server deadline passes, its
  palette buttons disable, answers are rejected (`409`), and the runner jumps
  to the next open section automatically. When all sections close, the test
  auto-submits.
- **Palette** (right) with glyph states, not colour alone:
  `✓` answered · `●` visited-not-answered · `M` marked for review · blank = not
  visited. Click any number to jump.
- **Controls:** option click or `A`–`D` / `1`–`4`; `N`/`→` next, `P`/`←`
  previous, `M` mark/unmark; Clear response; Submit (with a confirmation
  summary of answered/unanswered/marked counts).
- Answers are queued and flushed to the server immediately; on tab close a
  `keepalive` flush still saves pending answers. Reloading restores the exact
  question, answers and remaining time.

### Result (`#/result/:id`)

- Score hero: `marks / total`, accuracy, attempt split, time used, and a
  qualification badge driven by the paper's strategy:
  - **UPSC CSAT** — qualifying 33% (66/200) pass/fail badge.
  - **UPSC GS1** — indicative cutoff band with its disclaimer.
  - **SSC Tier-I** — `SHORTLISTING STAGE` (Tier-I shortlists; it decides
    nothing on its own).
  - **SSC Tier-II qualifying papers** (Computer Knowledge / Statistics /
    AAO) — raw score only, with the disclaimer that no cutoff is implied.
- **Section breakdown table** for sectional papers: per-section attempted /
  correct / incorrect / unattempted, marks and accuracy.
- Breakdowns by subject / question type / difficulty, time analysis
  (average, median, fastest, slowest vs estimate).
- **Answer review** with filters (all / incorrect / correct / unattempted /
  marked) and text search: your answer vs correct answer, explanation,
  concept, source, time spent vs estimated — plus **"Practice 5 similar"** to
  drill the same subject/topic immediately.

### PYQ Explorer (`#/pyq`)

- Coverage grid for the selected exam (UPSC 2007–2026 × GS Paper I/CSAT;
  SSC 2006–2026 × Tier-I/Tier-II papers) with per-cell status:
  `VERIFIED · PARTIAL · REQUIRES VERIFICATION · DATA_MISSING`.
- Per-question chips coloured by your status (correct / incorrect / mixed /
  skipped / never attempted).
- Browse every imported official question (answers hidden until attempted) and
  **"Practice this paper"** — same questions, dynamically calculated timer,
  always unlocked (unlike Full Paper).

### Analytics (`#/analytics`)

- Score-trend line chart across submitted tests for the selected exam.
- **Progress by mode** — a four-series chart (UPSC Full Paper / UPSC
  Selective / SSC Full Paper / SSC Selective) of score % normalised across
  every submitted session, with a toggleable legend.
- Performance table by subject / topic / question type / difficulty with
  accuracy, average time, estimated time and calibration delta (Δ > 0 means
  you are running slower than the model expects).
- **Repeated failures** (wrong ≥ 2, never right) — the learning loop.
- **Timing calibration** report: biggest estimate mismatches.
- **PYQ mastery:** a question counts as *mastered* only with ≥ N correct,
  ≥ M attempts and average time within the configured ratio of its estimate.
  Shows mastered / attempted / struggling / never-attempted over the official
  corpus, scoped to the selected exam.

### Admin (`#/admin`) — token protected

- **Overview:** counts by validation state, unkeyed questions, duplicate
  groups, import batches, "refresh coverage".
- **Import:** paste or choose a file — JSON, raw OCR text, or an answer key —
  and pick the exam, paper, tier, shift and source type (Custom / Official
  PYQ / AI generated). SSC imports stamp `exam`, `tier` and `shift` on every
  row so coverage and duplicate keys stay per-shift correct.
- **Review queue:** search + filter (needs review, unkeyed, duplicates …),
  edit metadata, **Verify**, mark duplicate, delete. Verified official text is
  locked against casual edits (`423 TEXT_LOCKED`; metadata still editable, text
  edits need an explicit `allowTextEdit`).
- **Audit log:** every import/verify/edit/delete with actor and timestamp.

---

## 4. Getting real question data in

Official UPSC papers are published as **scanned PDFs with no text layer**
(verified: the 2024 GS1 PDF is 48 pages of images, 0 extractable characters),
so the pipeline is:

```bash
# 1. download the PDFs listed in data/sources.manifest.json
npm run fetch-sources
#    → data/sources/2024-GS1.pdf + data/sources/index.json report
#    → detects SCANNED_NEEDS_OCR vs TEXT_LAYER_OK

# 2. OCR the PDF with your tool of choice (tesseract, Adobe, ...)

# 3. import the OCR text — lands as REVIEW_REQUIRED until a human verifies it
npm run import -- 2024-GS1-ocr.txt --format text --year 2024 --paper GS1

# 4. attach the official answer key ("1. B   2. D" / "1:B, 2:D")
npm run import -- 2024-GS1-key.txt --format answerkey --year 2024 --paper GS1

# or structured JSON (canonical format)
npm run import -- questions.json --format json --source-type OFFICIAL_PYQ
```

The same pipeline serves SSC: pass `--paper SSC_T1` (or `SSC_T2_P1` …) and the
import stamps `exam`/`tier`/`shift` from the paper/meta, so duplicate keys stay
`year|paper|shift|number` per shift. The Admin → Import form exposes exam,
paper, tier and shift dropdowns for the same purpose.

Guarantees: duplicates are caught (`year|paper|question_number` unique key
plus a content-hash report), bad rows are **rejected and reported — never
guessed**, every import becomes a batch with counters visible in the admin
console, and coverage is refreshed automatically so the dashboard and explorer
reflect exactly what exists.

---

## 5. Scoring model

### UPSC CSE Prelims

| | GS Paper I | CSAT |
| --- | --- | --- |
| Questions / duration | 100 / 120 min | 80 / 120 min |
| Marks | 2 per question (200 total) | 2.5 per question (200 total) |
| Negative marking | 1/3 of the question's marks (−0.67) | 1/3 (−0.83) |
| Qualifying | cutoff race (indicative band 70–95, shown with disclaimer) | **33% = 66 marks**, pass/fail |

### SSC CGL (2026 pattern)

| | Tier-I | Tier-II Paper-I Session-I | Tier-II Paper-II/III |
| --- | --- | --- | --- |
| Questions / duration | 100 / 60 min (4 × 25 sections, **15-min sectional auto-lock**) | 135 Q / 135 min (section time caps: Math 30m, Reasoning 30m, English 40m, GA 20m, Computer 15m) | 100 / 2 h |
| Marks | 2 per question (200 total) | Math/Reasoning 3, English 3, GA 3, Computer 2 (total 450) | 2 per question (200 total) |
| Negative marking | −0.50 per wrong | −1 per wrong | −0.50 per wrong |
| Role | **shortlisting only** — raw score shown with `SHORTLISTING STAGE`, never a final-merit claim | meritdeciding; Computer Knowledge is qualifying within the session | merit (Statistics / AAO) |

Tier-II DEST (Session-II, ~2000 keystrokes in 15 min) is a typing test, not an
MCQ — the app does not simulate it. Historical SSC papers (2006–2021) use their
original imported formats.

Accuracy = correct / attempted. Unattempted questions cost nothing.

---

## 6. Configuration cheat sheet (`config/exam.config.js` + env)

| Env var | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `3456` / `127.0.0.1` | Server bind |
| `ADMIN_TOKEN` | `local-admin-token` | Admin API/UI token (`x-admin-token`) |
| `TZ_WINDOW` | `Asia/Kolkata` | Timezone of the Sunday window |
| `SELECTIVE_BUFFER_SECONDS` | `15` | Buffer per selective question (10–25 target), UPSC |
| `SSC_SELECTIVE_BUFFER_SECONDS` | `15` | Buffer per selective question, SSC |
| `DB_FILE` | `data/upsc.db` | SQLite location |
| `FULL_PAPER_FORCE_AVAILABLE` | — | Test-only server override of the Sunday lock |

PYQ year ranges are per exam in the registry (UPSC 2007–, SSC 2006–), not a
global env. Other config sections: `EXAMS` (the two-exam registry with papers,
sectional rules, taxonomy and historical-format notes), `FULL_PAPER`,
`SELECTIVE`, `TIME_MODEL`, `SESSION` (sync interval, grace period, max active
sessions), `MASTERY`, `SCORING`, `SOURCE_TYPES`, `VALIDATION_STATES`.

---

## 7. Architecture

```
Browser (public/)
  index.html + js/exam-state.js (exam switcher, shared config cache)
  app.js → router.js → views/{dashboard,fullpaper,selective,exam,result,
            pyq,analytics,admin}.js      vanilla ES modules, no build step
        │  fetch JSON (?exam= on every request)
        ▼
Express (src/server.js)
  /api/*        public API   (src/routes/api.js)
  /api/admin/*  token-gated  (src/routes/admin.js)
  static + SPA fallback, central error handler
        ▼
Services (src/services/)
  availability  Sunday window from the server clock
  session       owns deadlines, sectional locks, answers, submit, result
  timing        estimated seconds + buffer, preview
  scoring       marks, negative marking, qualification per strategy
  selection     exact paper / mixed paper / selective filters (exam-scoped)
  question      validation, duplicates, verify, lock, coverage refresh
  mastery / analytics   improvement, calibration, 4-series progress
        ▼
SQLite via node:sqlite (src/db/  schema.sql + database.js)
  questions (exam/tier/shift columns, CHECK-healed via selfHeal) ·
  import_batches · paper_coverage · test_sessions (total_marks) ·
  session_answers · question_stats · settings · audit_log
  + test-only clock offset (advanceClock/setClockOffset) for deterministic tests
```

**Request lifecycle of an exam:** `POST /api/sessions…` creates rows → server
returns sanitised questions + `remainingSeconds` → client renders and polls
`GET /api/sessions/:id` (auto-submit if the deadline passed) → answers POST
with time spent → `POST …/submit` scores inside a transaction, freezes the
session and updates `question_stats` → `GET …/result` reveals answers,
explanations and analytics.

---

## 8. Project layout

```
start.bat / stop.bat      Windows run/stop helpers
config/exam.config.js     ALL exam rules in one place
data/                     upsc.db, sources.manifest.json, downloaded PDFs
public/                   index.html + css/app.css + js/ (views, router, api)
scripts/
  seed.js                 schema + AI practice bank
  run-import.js           CLI import (json / text / answerkey)
  fetch-sources.js        manifest downloader + text-layer/OCR detection
src/
  server.js               createApp / startServer
  routes/                 api.js (public), admin.js (token)
  services/               availability, timing, scoring, selection,
                          sessionService, questionService, mastery, analytics
  import/                 pipeline + parsers (json, text, answerkey, pdf)
  db/                     schema.sql, database.js
test/                     node:test suite (78 tests) + isolated temp DBs
```

---

## 9. Testing

```bash
npm test
```

- **78 tests** across config (exam registry), availability (Sunday window incl.
  forced open/closed), timing (base+buffer math), scoring, text parser,
  selection, question service, `test/api-flow.test.js` (full HTTP walk-through
  of the real Express app: Sunday gate 403/200, `DATA_MISSING`, mixed-paper
  end-to-end, no-answer-leakage, timer monotonicity, score math, coverage
  refresh, verified-text lock, every analytics endpoint) and
  `test/ssc.test.js` (schema CHECK healed, shift-aware duplicate keys,
  exam-scoped selection isolation, SSC taxonomy subjects, Tier-I mixed-paper
  build, qualification strategies, sectional lock via the server clock,
  sessions filtered by exam, four-series progress, per-exam coverage).
- Each test run uses its own `data/test-<pid>.db` and deletes it on exit — the
  dev database is never touched.
- The UI was additionally verified in headless Chrome: UPSC and SSC journeys
  (exam switcher persistence, SSC selective → shortlisting badge, sectional
  runner, 4-series progress chart toggles, admin import with exam/tier/shift)
  all pass with zero console errors.

---

## 10. Current data status

- **110 AI-generated practice questions** seeded and labelled:
  - **UPSC (63)** — GS1 across 11 subjects, CSAT incl. a comprehension set and
    a data-interpretation set.
  - **SSC (47)** — Tier-I (Reasoning 12, General Awareness 10, Quantitative
    Aptitude 10, English 8) plus Tier-II Paper-I Computer Knowledge (5) and
    Paper-II Statistics (2).
- **Official corpus: 0 imported → coverage 0%, everything shows
  `DATA_MISSING`** — by design. UPSC PDFs are scans; SSC papers can be imported
  as JSON/OCR text through Admin → Import (exam, paper, tier and shift are
  stamped per row). The dashboard, explorer, Full Paper and mastery metrics
  light up automatically as `VERIFIED` papers arrive.
