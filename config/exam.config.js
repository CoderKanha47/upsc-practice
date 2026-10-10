/**
 * CENTRAL EXAM CONFIGURATION (multi-exam registry)
 * ------------------------------------------------
 * Every exam rule, timing constant, distribution target and mastery rule lives
 * here. Nothing else in the application may hardcode these values.
 *
 * Two independent exam systems share this file:
 *   - UPSC_CSE_PRELIMS (legacy column value 'CSE_PRELIMS', papers GS1/CSAT)
 *   - SSC_CGL          (papers SSC_T1, SSC_T2_P1, SSC_T2_P2, SSC_T2_P3)
 *
 * SSC rules are versioned by official notification. The active version is
 * SSC_CGL_NOTIFICATION_2026 (F.No. HQ-C11018/1/2026-C-1, 21 May 2026):
 *   Tier-I  — 100Q / 200 marks / 60 min, NEW 15-min sectional timers that
 *             auto-lock (a closed section cannot be revisited), −0.50 per wrong.
 *   Tier-II Paper-I — Session-I only in this app (135 min):
 *             Math 30Q/30m, Reasoning 30Q/30m, English 45Q/40m, GA 25Q/20m,
 *             Computer Knowledge 20Q/15m (qualifying), 3 marks/q, −1 per wrong.
 *             Session-II is DEST (skill test, ~2000 key depressions/15 min) —
 *             not an MCQ paper; modelled but NOT simulated.
 *   Tier-II Paper-II (Statistics) / Paper-III (GS Finance & Economics) —
 *             100Q / 200 marks / 2h, −0.50 per wrong.
 * Rules that could not be verified from the notification are marked REVIEW.
 */

const CURRENT_YEAR = new Date().getFullYear();

/* ============================================================== UPSC CSE */
const UPSC_PAPERS = {
  GS1: {
    id: 'GS1',
    exam: 'UPSC_CSE_PRELIMS',
    tier: null,
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
    sectional: { enabled: false, lock: false },
    sections: null,
  },
  CSAT: {
    id: 'CSAT',
    exam: 'UPSC_CSE_PRELIMS',
    tier: null,
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
    sectional: { enabled: false, lock: false },
    sections: null,
  },
};

/* ================================================================ SSC CGL */
// Section subject names double as the question `subject` taxonomy for SSC.
const SSC_T1_SUBJECTS = [
  'General Intelligence & Reasoning',
  'General Awareness',
  'Quantitative Aptitude',
  'English Comprehension',
];

const SSC_PAPERS = {
  SSC_T1: {
    id: 'SSC_T1',
    exam: 'SSC_CGL',
    tier: 'TIER_I',
    code: 'SSC_CGL_TIER_I',
    title: 'SSC CGL Tier-I',
    shortTitle: 'Tier-I',
    description: 'Qualifying / shortlisting stage. Sectional timers lock each section.',
    questionCount: 100,
    durationMinutes: 60,
    marks: 200,
    qualifying: true,
    qualifyingNote:
      'Tier-I is a shortlisting stage; its marks are not counted in the final merit list (Tier-II decides merit).',
    marksPerQuestion: 2,
    negativeFraction: 0.25, // 0.50 marks per wrong answer (verified)
    qualifyingPercentage: null,
    // CGL 2026: 15 minutes per section, section auto-closes, no return.
    sectional: { enabled: true, lock: true },
    sectionOrder: SSC_T1_SUBJECTS,
    sections: [
      { id: 'A', title: 'General Intelligence & Reasoning', subject: 'General Intelligence & Reasoning', questionCount: 25, durationSeconds: 900, marks: 50, qualifying: false },
      { id: 'B', title: 'General Awareness', subject: 'General Awareness', questionCount: 25, durationSeconds: 900, marks: 50, qualifying: false },
      { id: 'C', title: 'Quantitative Aptitude', subject: 'Quantitative Aptitude', questionCount: 25, durationSeconds: 900, marks: 50, qualifying: false },
      { id: 'D', title: 'English Comprehension', subject: 'English Comprehension', questionCount: 25, durationSeconds: 900, marks: 50, qualifying: false },
    ],
    rulesVersion: 'SSC_CGL_NOTIFICATION_2026',
    rulesVerified: true,
    rulesNote:
      'Verified against SSC CGL Notification 2026 (21-May-2026): sectional timing introduced in Tier-I.',
  },
  SSC_T2_P1: {
    id: 'SSC_T2_P1',
    exam: 'SSC_CGL',
    tier: 'TIER_II',
    code: 'SSC_CGL_TIER_II_PAPER_I',
    title: 'SSC CGL Tier-II Paper-I',
    shortTitle: 'Tier-II Paper-I',
    description: 'Compulsory for all posts. Session-I (MCQ) simulated; Session-II (DEST) is a skill test.',
    questionCount: 150,
    durationMinutes: 135,
    marks: 450,
    qualifying: false,
    marksPerQuestion: 3,
    negativeFraction: 1 / 3, // 1 mark per wrong answer (verified)
    qualifyingPercentage: null,
    sectional: { enabled: true, lock: true },
    sectionOrder: [
      'Mathematical Abilities',
      'Reasoning & General Intelligence',
      'English Language & Comprehension',
      'General Awareness',
      'Computer Knowledge',
    ],
    sections: [
      { id: 'S1M1', section: 'Section-I', title: 'Mathematical Abilities', subject: 'Mathematical Abilities', questionCount: 30, durationSeconds: 1800, marks: 90, qualifying: false },
      { id: 'S1M2', section: 'Section-I', title: 'Reasoning & General Intelligence', subject: 'Reasoning & General Intelligence', questionCount: 30, durationSeconds: 1800, marks: 90, qualifying: false },
      { id: 'S2M1', section: 'Section-II', title: 'English Language & Comprehension', subject: 'English Language & Comprehension', questionCount: 45, durationSeconds: 2400, marks: 135, qualifying: false },
      { id: 'S2M2', section: 'Section-II', title: 'General Awareness', subject: 'General Awareness', questionCount: 25, durationSeconds: 1200, marks: 75, qualifying: false },
      { id: 'S3M1', section: 'Section-III', title: 'Computer Knowledge', subject: 'Computer Knowledge', questionCount: 20, durationSeconds: 900, marks: 60, qualifying: true },
    ],
    // Session-II is DEST: modelled for completeness, never simulated as MCQ.
    extraSessions: [
      {
        id: 'SESSION_II_DEST',
        title: 'Section-III Module-II — Data Entry Speed Test',
        type: 'SKILL_TEST',
        simulated: false,
        durationMinutes: 15,
        note: 'DEST: a passage of ~2000 key depressions in 15 minutes. Qualifying only. Not an MCQ paper — this app does not simulate it.',
      },
    ],
    // REVIEW: official per-section qualification thresholds for "must qualify
    // in all sections of Paper-I" are not stated as numbers in the sources we
    // verified. Section-wise marks are reported; no threshold is invented.
    sectionQualification: { status: 'REVIEW', note: 'Per-section qualifying thresholds are not configured — verify from the official notification before relying on them.' },
    rulesVersion: 'SSC_CGL_NOTIFICATION_2026',
    rulesVerified: true,
  },
  SSC_T2_P2: {
    id: 'SSC_T2_P2',
    exam: 'SSC_CGL',
    tier: 'TIER_II',
    code: 'SSC_CGL_TIER_II_PAPER_II',
    title: 'SSC CGL Tier-II Paper-II (Statistics)',
    shortTitle: 'Tier-II Paper-II',
    description: 'For Junior Statistical Officer (JSO) posts only.',
    questionCount: 100,
    durationMinutes: 120,
    marks: 200,
    qualifying: false,
    marksPerQuestion: 2,
    negativeFraction: 0.25, // 0.50 per wrong (verified)
    qualifyingPercentage: null,
    sectional: { enabled: false, lock: false },
    sections: null,
    rulesVersion: 'SSC_CGL_NOTIFICATION_2026',
    rulesVerified: true,
  },
  SSC_T2_P3: {
    id: 'SSC_T2_P3',
    exam: 'SSC_CGL',
    tier: 'TIER_II',
    code: 'SSC_CGL_TIER_II_PAPER_III',
    title: 'SSC CGL Tier-II Paper-III (GS Finance & Economics)',
    shortTitle: 'Tier-II Paper-III',
    description: 'For Assistant Audit Officer / Assistant Accounts Officer posts.',
    questionCount: 100,
    durationMinutes: 120,
    marks: 200,
    qualifying: false,
    marksPerQuestion: 2,
    negativeFraction: 0.25, // 0.50 per wrong (verified)
    qualifyingPercentage: null,
    sectional: { enabled: false, lock: false },
    sections: null,
    rulesVersion: 'SSC_CGL_NOTIFICATION_2026',
    rulesVerified: true,
  },
};

/* ============================================================== EXAM REGISTRY */
export const EXAMS = Object.freeze({
  UPSC_CSE_PRELIMS: {
    id: 'UPSC_CSE_PRELIMS',
    name: 'UPSC CSE Prelims',
    shortName: 'UPSC',
    // Existing UPSC rows were inserted with exam='CSE_PRELIMS'.
    legacyExamColumn: 'CSE_PRELIMS',
    defaultPaper: 'GS1',
    papers: UPSC_PAPERS,
    years: { START_YEAR: 2007, END_YEAR: Math.max(2026, CURRENT_YEAR) },
    subjects: {
      GS1: [
        'History', 'Art & Culture', 'Geography', 'Indian Polity', 'Governance',
        'Economy', 'Environment & Ecology', 'Science & Technology',
        'Current Affairs', 'International Relations', 'Society & Social Issues',
        'Miscellaneous',
      ],
      CSAT: [
        'Reading Comprehension', 'Logical Reasoning', 'Analytical Ability',
        'Quantitative Aptitude', 'Basic Numeracy', 'Data Interpretation',
        'Decision Making', 'Miscellaneous',
      ],
    },
    distributions: {
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
    },
    timeModel: {
      PASSAGE_SECONDS_PER_WORD: 0.4,
      BASE_BY_TYPE: {
        factual: 55, conceptual: 75, statement_based: 85, match_the_following: 75,
        assertion_reason: 75, elimination: 70, current_affairs: 60, map_based: 75,
        comprehension: 60, quantitative: 130, data_interpretation: 145,
        logical_reasoning: 110, analytical_ability: 115, decision_making: 100,
        basic_numeracy: 115, default: 72,
      },
      DIFFICULTY_FACTOR: { easy: 0.8, medium: 1.0, hard: 1.3 },
      PAPER_FACTOR: { GS1: 1.0, CSAT: 1.1 },
      MIN_SECONDS: 30,
      MAX_SECONDS: 600,
    },
    selective: {
      SETTINGS_KEY: 'SELECTIVE_BUFFER_SECONDS',
      BUFFER_SECONDS: Number(process.env.SELECTIVE_BUFFER_SECONDS || 15),
      MIN_BUFFER_SECONDS: 10,
      MAX_BUFFER_SECONDS: 25,
    },
    scoring: {
      RULE: 'UPSC_ONE_THIRD_NEGATIVE',
      GS_CUTOFF_ESTIMATE_RANGE: [70, 95],
      CUTOFF_DISCLAIMER:
        'Indicative estimate only. Actual cutoff varies by year, paper difficulty and category. A mock score never guarantees qualification.',
    },
    mixedKindLabel: 'MIXED PYQ PAPER',
    exactKindLabel: 'EXACT PYQ PAPER',
  },
  SSC_CGL: {
    id: 'SSC_CGL',
    name: 'SSC CGL',
    shortName: 'SSC',
    legacyExamColumn: 'SSC_CGL',
    defaultPaper: 'SSC_T1',
    papers: SSC_PAPERS,
    years: { START_YEAR: 2006, END_YEAR: Math.max(2026, CURRENT_YEAR) },
    subjects: {
      SSC_T1: SSC_T1_SUBJECTS,
      SSC_T2_P1: [
        'Mathematical Abilities', 'Reasoning & General Intelligence',
        'English Language & Comprehension', 'General Awareness', 'Computer Knowledge',
      ],
      SSC_T2_P2: ['Statistics'],
      SSC_T2_P3: ['General Studies (Finance & Economics)'],
    },
    // Topic taxonomy for selective practice (configurable, not a substitute
    // for the official syllabus).
    topics: {
      'General Intelligence & Reasoning': [
        'Analogy', 'Classification', 'Series', 'Coding-Decoding', 'Blood Relations',
        'Direction & Distance', 'Order & Ranking', 'Syllogism', 'Venn Diagrams',
        'Non-Verbal Reasoning', 'Figure-Based Reasoning', 'Logical & Analytical Reasoning',
      ],
      'General Awareness': [
        'History', 'Geography', 'Indian Polity', 'Economy', 'General Science',
        'Environment', 'Art & Culture', 'Static General Knowledge', 'Current Affairs',
      ],
      'Quantitative Aptitude': [
        'Number Systems', 'Simplification', 'Percentage', 'Ratio & Proportion',
        'Average', 'Profit & Loss', 'Discount', 'Simple & Compound Interest',
        'Time & Work', 'Pipes & Cisterns', 'Time Speed & Distance', 'Algebra',
        'Geometry', 'Mensuration', 'Trigonometry', 'Data Interpretation',
      ],
      'English Comprehension': [
        'Vocabulary', 'Synonyms & Antonyms', 'Idioms & Phrases',
        'One-Word Substitution', 'Spelling', 'Error Spotting', 'Sentence Improvement',
        'Fill in the Blanks', 'Active & Passive Voice', 'Direct & Indirect Speech',
        'Cloze Tests', 'Reading Comprehension', 'Sentence & Paragraph Arrangement',
      ],
      'Mathematical Abilities': [
        'Number Systems', 'Simplification', 'Percentage', 'Ratio & Proportion',
        'Average', 'Profit & Loss', 'Time & Work', 'Time Speed & Distance',
        'Algebra', 'Geometry', 'Mensuration', 'Trigonometry', 'Data Interpretation',
      ],
      'Reasoning & General Intelligence': [
        'Analogy', 'Series', 'Coding-Decoding', 'Blood Relations', 'Syllogism',
        'Venn Diagrams', 'Non-Verbal Reasoning', 'Logical & Analytical Reasoning',
      ],
      'English Language & Comprehension': [
        'Vocabulary', 'Synonyms & Antonyms', 'Idioms & Phrases',
        'One-Word Substitution', 'Error Spotting', 'Sentence Improvement',
        'Fill in the Blanks', 'Active & Passive Voice', 'Cloze Tests', 'Reading Comprehension',
      ],
      'Computer Knowledge': ['Computer Fundamentals', 'Software', 'Hardware', 'Networking', 'Internet & Security'],
      'Statistics': ['Collection & Classification of Data', 'Measures of Central Tendency', 'Measures of Dispersion', 'Correlation & Regression', 'Probability', 'Index Numbers', 'Time Series Analysis'],
      'General Studies (Finance & Economics)': ['Accounting', 'Business Economics', 'Finance & Banking', 'Indian Economy', 'Auditing', 'Governance'],
    },
    distributions: {
      SSC_T1: [
        { subject: 'General Intelligence & Reasoning', target: 0.25, tolerance: 0.05 },
        { subject: 'General Awareness', target: 0.25, tolerance: 0.05 },
        { subject: 'Quantitative Aptitude', target: 0.25, tolerance: 0.05 },
        { subject: 'English Comprehension', target: 0.25, tolerance: 0.05 },
      ],
      SSC_T2_P1: [
        { subject: 'Mathematical Abilities', target: 0.2, tolerance: 0.04 },
        { subject: 'Reasoning & General Intelligence', target: 0.2, tolerance: 0.04 },
        { subject: 'English Language & Comprehension', target: 0.3, tolerance: 0.05 },
        { subject: 'General Awareness', target: 0.167, tolerance: 0.04 },
        { subject: 'Computer Knowledge', target: 0.133, tolerance: 0.04 },
      ],
      SSC_T2_P2: [{ subject: 'Statistics', target: 1.0, tolerance: 0.1 }],
      SSC_T2_P3: [{ subject: 'General Studies (Finance & Economics)', target: 1.0, tolerance: 0.1 }],
    },
    // SSC papers are speed tests: base estimates are much shorter than UPSC.
    timeModel: {
      PASSAGE_SECONDS_PER_WORD: 0.35,
      BASE_BY_TYPE: {
        factual: 32, conceptual: 45, statement_based: 50, elimination: 40,
        current_affairs: 30, logical_reasoning: 55, analytical_ability: 60,
        quantitative: 60, basic_numeracy: 55, data_interpretation: 75,
        comprehension: 35, default: 40,
      },
      DIFFICULTY_FACTOR: { easy: 0.8, medium: 1.0, hard: 1.25 },
      PAPER_FACTOR: { SSC_T1: 0.8, SSC_T2_P1: 1.0, SSC_T2_P2: 0.95, SSC_T2_P3: 0.95 },
      MIN_SECONDS: 20,
      MAX_SECONDS: 400,
    },
    selective: {
      SETTINGS_KEY: 'SSC_SELECTIVE_BUFFER_SECONDS',
      BUFFER_SECONDS: Number(process.env.SSC_SELECTIVE_BUFFER_SECONDS || 15),
      MIN_BUFFER_SECONDS: 10,
      MAX_BUFFER_SECONDS: 25,
    },
    scoring: {
      RULE: 'SSC_TIERED_NEGATIVE',
      // Tier-I is shortlisting only; there is no meaningful "cutoff estimate"
      // configured — REVIEW rather than invent one.
      DISCLAIMER:
        'Raw mock score only. Tier-II marks decide the final merit. Normalisation across shifts applies in the real exam. A mock score never guarantees selection.',
    },
    mixedKindLabel: 'MIXED PYQ MOCK',
    exactKindLabel: 'EXACT PYQ PAPER',
    // Historical papers: never force current format onto old papers.
    historicalFormats: { note: 'Historical SSC papers (2006–2021) follow older patterns (e.g. cumulative timing, different question counts). Exact-paper mode reproduces the imported paper as-is; current-pattern mocks use the 2026 rules above.' },
  },
});

export const EXAM_IDS = Object.freeze(Object.keys(EXAMS));
export const DEFAULT_EXAM = 'UPSC_CSE_PRELIMS';

/* ================================================================ LEGACY CONFIG */
// Flat merges keep every existing UPSC call-site working unchanged.
const ALL_PAPERS = { ...UPSC_PAPERS, ...SSC_PAPERS };

const CONFIG = Object.freeze({
  APP: {
    NAME: 'Exam Practice — UPSC CSE Prelims & SSC CGL',
    SHORT_NAME: 'Exam Practice',
    TIMEZONE: process.env.TZ_WINDOW || 'Asia/Kolkata',
    PORT: Number(process.env.PORT || 3456),
    HOST: process.env.HOST || '127.0.0.1',
    DATA_DIR: process.env.DATA_DIR || 'data',
    DB_FILE: process.env.DB_FILE || 'data/upsc.db',
    ADMIN_TOKEN: process.env.ADMIN_TOKEN || 'local-admin-token',
  },

  YEARS: {
    START_YEAR: Number(process.env.PYQ_START_YEAR || 2007),
    END_YEAR: Number(process.env.PYQ_END_YEAR || Math.max(2026, CURRENT_YEAR)),
  },

  PAPERS: ALL_PAPERS,

  FULL_PAPER: {
    // Shared weekly policy for BOTH exams: Sunday 00:01–23:59 Asia/Kolkata.
    ALLOWED_DAY: 0,
    OPEN_MINUTE_AFTER_MIDNIGHT: 1,
    CLOSE_MINUTE_BEFORE_MIDNIGHT: 1,
    FORCE_AVAILABLE: process.env.FULL_PAPER_FORCE_AVAILABLE === '1',
    LABEL_LOCKED: 'FULL PAPER\nLOCKED\n\nAvailable every Sunday.',
  },

  SELECTIVE: {
    BUFFER_SECONDS: Number(process.env.SELECTIVE_BUFFER_SECONDS || 15),
    MIN_BUFFER_SECONDS: 10,
    MAX_BUFFER_SECONDS: 25,
    BUFFER_BY_EXAM: {
      UPSC_CSE_PRELIMS: Number(process.env.SELECTIVE_BUFFER_SECONDS || 15),
      SSC_CGL: Number(process.env.SSC_SELECTIVE_BUFFER_SECONDS || 15),
    },
    PRESET_COUNTS: [5, 10, 15, 20, 25, 30, 50, 100],
    CUSTOM_MAX: 500,
    LOCKED: false,
  },

  TIME_MODEL: EXAMS.UPSC_CSE_PRELIMS.timeModel,

  DISTRIBUTIONS: {
    ...EXAMS.UPSC_CSE_PRELIMS.distributions,
    ...EXAMS.SSC_CGL.distributions,
    DIFFICULTY_MIX: { easy: 0.3, medium: 0.5, hard: 0.2, tolerance: 0.12 },
    MIN_DISTINCT_TYPES: 5,
  },

  SCORING: {
    RULE: 'UPSC_ONE_THIRD_NEGATIVE',
    GS_CUTOFF_ESTIMATE_RANGE: [70, 95],
    CUTOFF_DISCLAIMER:
      'Indicative estimate only. Actual cutoff varies by year, paper difficulty and category. A mock score never guarantees qualification.',
  },

  MASTERY: {
    MIN_CORRECT_ATTEMPTS: 2,
    MAX_TIME_RATIO: 1.25,
    MIN_ATTEMPTS: 2,
  },

  SOURCE_TYPES: Object.freeze(['OFFICIAL_PYQ', 'AI_GENERATED', 'CUSTOM']),
  VALIDATION_STATES: Object.freeze(['IMPORTED', 'PARSED', 'REVIEW_REQUIRED', 'VERIFIED']),
  PAPER_COVERAGE_STATES: Object.freeze([
    'DATA_MISSING', 'IMPORTED', 'PARTIAL', 'REQUIRES_VERIFICATION', 'VERIFIED',
  ]),

  SUBJECTS: {
    ...EXAMS.UPSC_CSE_PRELIMS.subjects,
    ...EXAMS.SSC_CGL.subjects,
  },
  // Topic taxonomy by subject name (currently defined for SSC subjects).
  TOPICS: {
    ...EXAMS.SSC_CGL.topics,
  },
  QUESTION_TYPES: [
    'factual', 'conceptual', 'statement_based', 'match_the_following',
    'assertion_reason', 'elimination', 'current_affairs', 'map_based',
    'comprehension', 'quantitative', 'data_interpretation', 'logical_reasoning',
    'analytical_ability', 'decision_making', 'basic_numeracy',
  ],
  DIFFICULTIES: ['easy', 'medium', 'hard'],

  SESSION: {
    SYNC_INTERVAL_MS: 15000,
    SUBMIT_GRACE_MS: 30 * 1000,
    MAX_ACTIVE_SESSIONS: 5,
  },
});

/* ================================================================= helpers */
export function getExam(examId) {
  const exam = EXAMS[examId];
  if (!exam) throw new Error(`Unknown exam: ${examId}`);
  return exam;
}

export function getPaper(paperId) {
  const paper = ALL_PAPERS[paperId];
  if (!paper) throw new Error(`Unknown paper: ${paperId}`);
  return paper;
}

/** The exam a paper belongs to. */
export function examOfPaper(paperId) {
  return getExam(getPaper(paperId).exam);
}

export function paperList(examId = null) {
  if (!examId) return Object.values(ALL_PAPERS);
  return Object.values(getExam(examId).papers);
}

export function papersForExam(examId) {
  return paperList(examId);
}

export function yearRange(examId = DEFAULT_EXAM) {
  const years = getExam(examId).years;
  const out = [];
  for (let y = years.END_YEAR; y >= years.START_YEAR; y -= 1) out.push(y);
  return out;
}

/** Default selective buffer for an exam (env-configurable, 10–25 s intent). */
export function selectiveBufferSeconds(examId = DEFAULT_EXAM) {
  return CONFIG.SELECTIVE.BUFFER_BY_EXAM[examId] ?? CONFIG.SELECTIVE.BUFFER_SECONDS;
}

export default CONFIG;
