# UPSC CSE Prelims Simulator (2007–2026)

A personal mock-test and Previous Year Question (PYQ) practice system for the
UPSC Civil Services Preliminary Examination: **GS Paper I** and **CSAT** as two
separate papers, with a Sunday-only full-paper simulation, always-unlocked
selective practice, a PYQ explorer, accurate scoring, analytics/mastery
tracking, an import pipeline and a data-validation admin console.

No accounts, no cloud, no build step — a Node.js server + SQLite + a vanilla
ES-module SPA, running locally at `http://127.0.0.1:3456`.

---

## 1. Ground rules (what this app never does)

| Rule | How it is enforced |
| --- | --- |
| **Official PYQs are never invented** | Un-imported papers show `DATA_MISSING · 0/N`. The server returns `409 DATA_MISSING` instead of starting a fake paper; mixed papers draw only from imported official questions. |
| **AI-generated questions are always labelled** | Every question carries `source_type` (`OFFICIAL_PYQ` / `AI_GENERATED` / `CUSTOM`) and a badge is rendered everywhere it appears. The seeded bank of 63 practice questions is labelled `AI GENERATED`. |
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
npm run seed        # schema + 63 labelled AI-generated practice questions
npm start           # http://127.0.0.1:3456
npm test            # full test suite (65 tests)
```

Default admin token: `local-admin-token` (override with env `ADMIN_TOKEN`).

---

## 3. How the app works (user guide)

**Appearance:** the **Theme** button in the topbar switches between light and dark
mode. Your choice is saved in the browser (`localStorage`); with no saved choice
the app follows the OS preference (`prefers-color-scheme`).

### Dashboard (`#/`)

Shows the two entry modes with their live status, your performance tiles
(PYQs attempted, accuracy, average score, strongest/weakest subject, mastery,
20-year coverage) and your recent tests. If a test is still running you get a
**resume banner** — its original deadline is untouched.

### Full Paper (`#/full`) — Sunday only

- **Window:** every Sunday 00:01–23:59 `Asia/Kolkata`, enforced by the server.
  On other days the page shows `LOCKED` with the reason and the next opening
  time; the start buttons are disabled (and the API answers `403` if you try).
- **Two ways to start:**
  1. **Exact PYQ paper** — pick year + paper (GS1 or CSAT). If that paper is not
     fully imported you get a `DATA MISSING — 2010 GS Paper I: 0/100 …` notice,
     not a fabricated test.
  2. **Mixed paper** — 100 (or 80) randomised official questions from the whole
     imported pool, shuffled with a server seed. Disabled with an explanatory
     hint when the official pool for that paper is empty.
- **Format:** each paper is its own session — GS Paper I 100 Q / 120 min / 200
  marks, then CSAT 80 Q / 120 min / 200 marks. Never a combined 4-hour test.
- **Resume:** if you already have an in-progress paper of the same kind, the
  server resumes it instead of creating a new one.

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

- Score hero: `marks / total`, accuracy, attempt split, time used, CSAT
  qualified/not-qualified badge (33% = 66/200) or the **indicative GS cutoff
  band (70–95) with its disclaimer**.
- Breakdowns by subject / question type / difficulty, time analysis
  (average, median, fastest, slowest vs estimate).
- **Answer review** with filters (all / incorrect / correct / unattempted /
  marked) and text search: your answer vs correct answer, explanation,
  concept, source, time spent vs estimated — plus **"Practice 5 similar"** to
  drill the same subject/topic immediately.

### PYQ Explorer (`#/pyq`)

- 20-year coverage grid (2007–2026 × GS1/CSAT) with per-cell status:
  `VERIFIED · PARTIAL · REQUIRES VERIFICATION · DATA_MISSING`.
- Per-question chips coloured by your status (correct / incorrect / mixed /
  skipped / never attempted).
- Browse every imported official question (answers hidden until attempted) and
  **"Practice this paper"** — same questions, dynamically calculated timer,
  always unlocked (unlike Full Paper).

### Analytics (`#/analytics`)

- Score-trend line chart across submitted tests.
- Performance table by subject / topic / question type / difficulty with
  accuracy, average time, estimated time and calibration delta (Δ > 0 means
  you are running slower than the model expects).
- **Repeated failures** (wrong ≥ 2, never right) — the learning loop.
- **Timing calibration** report: biggest estimate mismatches.
- **PYQ mastery:** a question counts as *mastered* only with ≥ N correct,
  ≥ M attempts and average time within the configured ratio of its estimate.
  Shows mastered / attempted / struggling / never-attempted over the official
  corpus.

### Admin (`#/admin`) — token protected

- **Overview:** counts by validation state, unkeyed questions, duplicate
  groups, import batches, "refresh coverage".
- **Import:** paste or choose a file — JSON, raw OCR text, or an answer key —
  and pick the source type (Custom / Official PYQ / AI generated).
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

Guarantees: duplicates are caught (`year|paper|question_number` unique key
plus a content-hash report), bad rows are **rejected and reported — never
guessed**, every import becomes a batch with counters visible in the admin
console, and coverage is refreshed automatically so the dashboard and explorer
reflect exactly what exists.

---

## 5. Scoring model

| | GS Paper I | CSAT |
| --- | --- | --- |
| Questions / duration | 100 / 120 min | 80 / 120 min |
| Marks | 2 per question (200 total) | 2.5 per question (200 total) |
| Negative marking | 1/3 of the question's marks (−0.67) | 1/3 (−0.83) |
| Qualifying | cutoff race (indicative band 70–95, shown with disclaimer) | **33% = 66 marks**, pass/fail |
| When it runs | Sunday Full Paper mode | Sunday Full Paper mode |

Accuracy = correct / attempted. Unattempted questions cost nothing.

---

## 6. Configuration cheat sheet (`config/exam.config.js` + env)

| Env var | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `3456` / `127.0.0.1` | Server bind |
| `ADMIN_TOKEN` | `local-admin-token` | Admin API/UI token (`x-admin-token`) |
| `TZ_WINDOW` | `Asia/Kolkata` | Timezone of the Sunday window |
| `SELECTIVE_BUFFER_SECONDS` | `15` | Buffer per selective question (10–25 target) |
| `PYQ_START_YEAR` / `PYQ_END_YEAR` | `2007` / `2026` | PYQ range |
| `DB_FILE` | `data/upsc.db` | SQLite location |
| `FULL_PAPER_FORCE_AVAILABLE` | — | Test-only server override of the Sunday lock |

Other config sections: `PAPERS`, `FULL_PAPER`, `SELECTIVE`, `TIME_MODEL`,
`SUBJECTS`/`QUESTION_TYPES`/`DIFFICULTIES`, `SESSION` (sync interval, grace
period, max active sessions), `MASTERY`, `SCORING`, `SOURCE_TYPES`,
`VALIDATION_STATES`.

---

## 7. Architecture

```
Browser (public/)
  app.js → router.js → views/{dashboard,fullpaper,selective,exam,result,
            pyq,analytics,admin}.js      vanilla ES modules, no build step
        │  fetch JSON
        ▼
Express (src/server.js)
  /api/*        public API   (src/routes/api.js)
  /api/admin/*  token-gated  (src/routes/admin.js)
  static + SPA fallback, central error handler
        ▼
Services (src/services/)
  availability  Sunday window from the server clock
  session       owns deadlines, answers, submit, result (no answer leakage)
  timing        estimated seconds + buffer, preview
  scoring       marks, negative marking, CSAT qualification, GS band
  selection     exact paper / mixed paper / selective filters
  question      validation, duplicates, verify, lock, coverage refresh
  mastery / analytics   improvement, calibration, failure loops
        ▼
SQLite via node:sqlite (src/db/  schema.sql + database.js)
  questions · import_batches · paper_coverage · test_sessions ·
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
test/                     node:test suite (65 tests) + isolated temp DBs
```

---

## 9. Testing

```bash
npm test
```

- **65 tests** across config, availability (Sunday window incl. forced
  open/closed), timing (base+buffer math), scoring, text parser, selection,
  question service, and `test/api-flow.test.js` — a full HTTP walk-through of
  the real Express app: Sunday gate 403/200 (clock offset to a Wednesday/Sunday),
  `DATA_MISSING` for unimported years, a 100-question mixed paper end to end,
  no-answer-leakage assertions, timer never increasing across syncs, score math,
  coverage flipping after an admin import, verified-text lock (`423`), and every
  analytics endpoint.
- Each test run uses its own `data/test-<pid>.db` and deletes it on exit — the
  dev database is never touched.
- The UI was additionally verified in headless Chrome: all eight routes render
  with zero console errors, and the full journey (dashboard → selective →
  exam → reload → keyboard → submit → result → admin import) passes.

---

## 10. Current data status

- **63 AI-generated practice questions** seeded (GS1 across 11 subjects, CSAT
  incl. a comprehension set and a data-interpretation set), all labelled.
- **Official corpus: 0 imported → coverage 0%, everything shows
  `DATA_MISSING`** — by design, because UPSC PDFs are scans. Use
  `npm run fetch-sources` → OCR → `npm run import` to fill it; the dashboard,
  explorer, Full Paper and mastery metrics light up automatically as
  `VERIFIED` papers arrive.
