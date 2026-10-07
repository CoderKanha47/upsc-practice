/**
 * CENTRAL EXAM CONFIGURATION
 * ---------------------------
 * Every exam rule, timing constant, distribution target and mastery rule lives
 * here. Nothing else in the application may hardcode these values.
 *
 * Values marked "current UPSC scheme" can be updated in ONE place if UPSC
 * changes its examination rules.
 */

const CURRENT_YEAR = new Date().getFullYear();

export const CONFIG = Object.freeze({
  APP: {
    NAME: 'UPSC CSE Prelims Simulator',
    SHORT_NAME: 'Prelims Simulator',
    // Timezone used for the Sunday Full-Paper window. IST is the default.
    TIMEZONE: process.env.TZ_WINDOW || 'Asia/Kolkata',
    PORT: Number(process.env.PORT || 3456),
    // The app is intended for personal use on this machine.
    HOST: process.env.HOST || '127.0.0.1',
    DATA_DIR: process.env.DATA_DIR || 'data',
    DB_FILE: process.env.DB_FILE || 'data/upsc.db',
    ADMIN_TOKEN: process.env.ADMIN_TOKEN || 'local-admin-token',
  },

  // ---------------------------------------------------------------- PYQ range
  // Configuration driven so 2027, 2028 ... can be added later without code
  // changes (just extend END_YEAR, or set PYQ_END_YEAR env var).
  YEARS: {
    START_YEAR: Number(process.env.PYQ_START_YEAR || 2007),
    END_YEAR: Number(process.env.PYQ_END_YEAR || Math.max(2026, CURRENT_YEAR)),
  },

  // ------------------------------------------------------------ Exam papers
  // The two papers are modelled separately. There is no 4-hour combined paper.
  PAPERS: {
    GS1: {
      id: 'GS1',
      code: 'GS_PAPER_I',
      title: 'General Studies Paper I',
      shortTitle: 'GS Paper I',
      description: 'Counts toward the Prelims cutoff.',
      questionCount: 100,
      durationMinutes: 120,
      marks: 200,
      qualifying: false,
      // UPSC awards 2 marks per GS1 question and deducts one-third of the
      // marks of a question for a wrong answer (2/3 = 0.666... per question).
      marksPerQuestion: 2,
      negativeFraction: 1 / 3,
      qualifyingPercentage: null,
    },
    CSAT: {
      id: 'CSAT',
      code: 'GS_PAPER_II',
      title: 'General Studies Paper II (CSAT)',
      shortTitle: 'CSAT',
      description: 'Qualifying paper. Minimum qualifying standard 33%.',
      questionCount: 80,
      durationMinutes: 120,
      marks: 200,
      qualifying: true,
      // 200/80 = 2.5 marks per CSAT question; wrong answer deducts one-third.
      marksPerQuestion: 2.5,
      negativeFraction: 1 / 3,
      qualifyingPercentage: 33,
    },
  },

  // -------------------------------------------------- Full Paper availability
  // Server-side determined. Sunday 00:01 -> Sunday 23:59 in CONFIG.APP.TIMEZONE.
  FULL_PAPER: {
    // 0 = Sunday ... 6 = Saturday (JS Date#getDay in the configured timezone)
    ALLOWED_DAY: 0,
    OPEN_MINUTE_AFTER_MIDNIGHT: 1,
    CLOSE_MINUTE_BEFORE_MIDNIGHT: 1, // 23:59
    // Server-side override for local testing only. NEVER exposed to the client.
    FORCE_AVAILABLE: process.env.FULL_PAPER_FORCE_AVAILABLE === '1',
    LABEL_LOCKED: 'FULL PAPER\nLOCKED\n\nAvailable every Sunday.',
  },

  // ---------------------------------------------------- Selective Practice
  SELECTIVE: {
    // Configurable per-question buffer (target design range 10–25 seconds).
    BUFFER_SECONDS: Number(process.env.SELECTIVE_BUFFER_SECONDS || 15),
    MIN_BUFFER_SECONDS: 10,
    MAX_BUFFER_SECONDS: 25,
    PRESET_COUNTS: [5, 10, 15, 20, 25, 30, 50, 100],
    CUSTOM_MAX: 500,
    // Always unlocked, every day, unlimited attempts.
    LOCKED: false,
  },

  // ------------------------------------------------------- Question time model
  // estimated_time_seconds = base(paper, type, difficulty) + passageReading
  // The value is stored on every question and later calibrated against
  // actual_time_taken observed in analytics.
  TIME_MODEL: {
    // Reading speed allowance used for comprehension passages (~150 wpm).
    PASSAGE_SECONDS_PER_WORD: 0.4,
    BASE_BY_TYPE: {
      // GS Paper I
      factual: 55,
      conceptual: 75,
      statement_based: 85,
      match_the_following: 75,
      assertion_reason: 75,
      elimination: 70,
      current_affairs: 60,
      map_based: 75,
      // Paper II / CSAT
      comprehension: 60, // + passage reading time
      quantitative: 130,
      data_interpretation: 145,
      logical_reasoning: 110,
      analytical_ability: 115,
      decision_making: 100,
      basic_numeracy: 115,
      default: 72,
    },
    // Multiplied after the type base.
    DIFFICULTY_FACTOR: { easy: 0.8, medium: 1.0, hard: 1.3 },
    // CSAT questions generally run longer than GS questions.
    PAPER_FACTOR: { GS1: 1.0, CSAT: 1.1 },
    MIN_SECONDS: 30,
    MAX_SECONDS: 600,
  },

  // ------------------------------------------- Full-paper selection engine
  // A generated paper must resemble the subject character of real UPSC papers.
  // Targets are ratios of the total paper; the engine fills them in order.
  DISTRIBUTIONS: {
    GS1: [
      { subject: 'History', target: 0.13, tolerance: 0.04 },
      { subject: 'Art & Culture', target: 0.05, tolerance: 0.03 },
      { subject: 'Geography', target: 0.12, tolerance: 0.04 },
      { subject: 'Indian Polity', target: 0.13, tolerance: 0.04 },
      { subject: 'Governance', target: 0.05, tolerance: 0.03 },
      { subject: 'Economy', target: 0.12, tolerance: 0.04 },
      { subject: 'Environment & Ecology', target: 0.14, tolerance: 0.04 },
      { subject: 'Science & Technology', target: 0.1, tolerance: 0.04 },
      { subject: 'Current Affairs', target: 0.07, tolerance: 0.04 },
      { subject: 'International Relations', target: 0.05, tolerance: 0.03 },
      { subject: 'Society & Social Issues', target: 0.04, tolerance: 0.03 },
      { subject: 'Miscellaneous', target: 0.0, tolerance: 1.0 },
    ],
    CSAT: [
      { subject: 'Reading Comprehension', target: 0.3, tolerance: 0.08 },
      { subject: 'Logical Reasoning', target: 0.18, tolerance: 0.06 },
      { subject: 'Analytical Ability', target: 0.12, tolerance: 0.06 },
      { subject: 'Quantitative Aptitude', target: 0.16, tolerance: 0.06 },
      { subject: 'Basic Numeracy', target: 0.1, tolerance: 0.05 },
      { subject: 'Data Interpretation', target: 0.09, tolerance: 0.05 },
      { subject: 'Decision Making', target: 0.05, tolerance: 0.05 },
      { subject: 'Miscellaneous', target: 0.0, tolerance: 1.0 },
    ],
    // Difficulty mix targeted by the mixed-paper builder.
    DIFFICULTY_MIX: { easy: 0.3, medium: 0.5, hard: 0.2, tolerance: 0.12 },
    // Question-type variety target for mixed papers.
    MIN_DISTINCT_TYPES: 5,
  },

  // ------------------------------------------------------------- Scoring rules
  SCORING: {
    // Attempted but wrong => deduct negativeFraction * marksPerQuestion.
    // Unattempted => zero.
    RULE: 'UPSC_ONE_THIRD_NEGATIVE',
    // Indicative only. Never presented as a guarantee of qualification.
    GS_CUTOFF_ESTIMATE_RANGE: [70, 95],
    CUTOFF_DISCLAIMER:
      'Indicative estimate only. Actual cutoff varies by year, paper difficulty and category. A mock score never guarantees qualification.',
  },

  // ----------------------------------------------------------------- Mastery
  MASTERY: {
    // A question is mastered only after configurable successful performance.
    MIN_CORRECT_ATTEMPTS: 2,
    // Average response time must not exceed this ratio of the estimate.
    MAX_TIME_RATIO: 1.25,
    MIN_ATTEMPTS: 2,
  },

  // ----------------------------------------------------------- Source taxonomy
  SOURCE_TYPES: Object.freeze(['OFFICIAL_PYQ', 'AI_GENERATED', 'CUSTOM']),
  VALIDATION_STATES: Object.freeze([
    'IMPORTED',
    'PARSED',
    'REVIEW_REQUIRED',
    'VERIFIED',
  ]),
  PAPER_COVERAGE_STATES: Object.freeze([
    'DATA_MISSING',
    'IMPORTED',
    'PARTIAL',
    'REQUIRES_VERIFICATION',
    'VERIFIED',
  ]),

  // ------------------------------------------------------------- Taxonomy
  SUBJECTS: {
    GS1: [
      'History',
      'Art & Culture',
      'Geography',
      'Indian Polity',
      'Governance',
      'Economy',
      'Environment & Ecology',
      'Science & Technology',
      'Current Affairs',
      'International Relations',
      'Society & Social Issues',
      'Miscellaneous',
    ],
    CSAT: [
      'Reading Comprehension',
      'Logical Reasoning',
      'Analytical Ability',
      'Quantitative Aptitude',
      'Basic Numeracy',
      'Data Interpretation',
      'Decision Making',
      'Miscellaneous',
    ],
  },
  QUESTION_TYPES: [
    'factual',
    'conceptual',
    'statement_based',
    'match_the_following',
    'assertion_reason',
    'elimination',
    'current_affairs',
    'map_based',
    'comprehension',
    'quantitative',
    'data_interpretation',
    'logical_reasoning',
    'analytical_ability',
    'decision_making',
    'basic_numeracy',
  ],
  DIFFICULTIES: ['easy', 'medium', 'hard'],

  // ------------------------------------------------------------ Exam session
  SESSION: {
    // How often the client asks the server for remaining time.
    SYNC_INTERVAL_MS: 15000,
    // Server hard limit: a session can never outlive deadline + grace.
    SUBMIT_GRACE_MS: 30 * 1000,
    MAX_ACTIVE_SESSIONS: 5,
  },
});

export function getPaper(paperId) {
  const paper = CONFIG.PAPERS[paperId];
  if (!paper) throw new Error(`Unknown paper: ${paperId}`);
  return paper;
}

export function paperList() {
  return Object.values(CONFIG.PAPERS);
}

export function yearRange() {
  const { START_YEAR, END_YEAR } = CONFIG.YEARS;
  const years = [];
  for (let y = END_YEAR; y >= START_YEAR; y -= 1) years.push(y);
  return years;
}

export default CONFIG;
