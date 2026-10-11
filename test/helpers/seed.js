import './env.js';
import { insertMany } from '../../src/services/questionService.js';

/**
 * SYNTHETIC FIXTURES — used only by the test suite (separate DB file).
 * These are NOT real UPSC PYQs and never touch the application database.
 */
const GS_SUBJECTS = [
  'History', 'Art & Culture', 'Geography', 'Indian Polity', 'Governance',
  'Economy', 'Environment & Ecology', 'Science & Technology', 'Current Affairs',
  'International Relations', 'Society & Social Issues',
];
const CSAT_SUBJECTS = [
  'Reading Comprehension', 'Logical Reasoning', 'Analytical Ability',
  'Quantitative Aptitude', 'Basic Numeracy', 'Data Interpretation', 'Decision Making',
];
const TYPES = ['factual', 'conceptual', 'statement_based', 'match_the_following', 'assertion_reason', 'elimination'];
const CSAT_TYPES = ['comprehension', 'quantitative', 'data_interpretation', 'logical_reasoning', 'analytical_ability', 'basic_numeracy'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];

function makeQuestion(paper, year, number, subjects, types) {
  const subject = subjects[(year + number) % subjects.length];
  const type = types[number % types.length];
  const difficulty = DIFFICULTIES[number % 3];
  const passage =
    paper === 'CSAT' && type === 'comprehension'
      ? `Passage for fixture question ${number}. ${'The quick brown fox jumps over the lazy dog. '.repeat(8)}`
      : null;
  return {
    year,
    paper,
    question_number: number,
    question_text: `[FIXTURE] ${paper} ${year} Q${number} regarding ${subject} — which statement is correct?`,
    options: [
      { key: 'A', text: 'Statement one is correct' },
      { key: 'B', text: 'Statement two is correct' },
      { key: 'C', text: 'Both are correct' },
      { key: 'D', text: 'Neither is correct' },
    ],
    correct_answer: ['A', 'B', 'C', 'D'][number % 4],
    subject,
    topic: `${subject} Topic ${number % 5}`,
    difficulty,
    question_type: type,
    passage,
    group_id: passage ? `fixture_group_${year}_${Math.ceil(number / 4)}` : null,
    group_index: passage ? number : null,
    source_type: 'OFFICIAL_PYQ',
    source: 'TEST FIXTURE — not a real UPSC question',
    explanation: 'Fixture explanation.',
    concept: 'Fixture concept',
  };
}

export async function seedFixtures({ gsYears = 8, csatYears = 4, gsPerYear = 25, csatPerYear = 25 } = {}) {
  const items = [];
  for (let i = 0; i < gsYears; i += 1) {
    const year = 2026 - i;
    for (let n = 1; n <= gsPerYear; n += 1) {
      items.push(makeQuestion('GS1', year, n, GS_SUBJECTS, TYPES));
    }
  }
  for (let i = 0; i < csatYears; i += 1) {
    const year = 2026 - i;
    for (let n = 1; n <= csatPerYear; n += 1) {
      items.push(makeQuestion('CSAT', year, n, CSAT_SUBJECTS, CSAT_TYPES));
    }
  }
  return await insertMany(items, { source: 'TEST FIXTURE' });
}

const SSC_T1_SUBJECTS = [
  'General Intelligence & Reasoning', 'General Awareness',
  'Quantitative Aptitude', 'English Comprehension',
];

function makeSscQuestion(year, number) {
  const subject = SSC_T1_SUBJECTS[number % SSC_T1_SUBJECTS.length];
  return {
    year,
    paper: 'SSC_T1',
    question_number: number,
    question_text: `[FIXTURE SSC] ${year} Q${number} regarding ${subject} — pick the correct option?`,
    options: [
      { key: 'A', text: 'Option one' },
      { key: 'B', text: 'Option two' },
      { key: 'C', text: 'Option three' },
      { key: 'D', text: 'Option four' },
    ],
    correct_answer: ['A', 'B', 'C', 'D'][number % 4],
    subject,
    topic: `SSC ${subject} Topic ${number % 5}`,
    difficulty: DIFFICULTIES[number % 3],
    question_type: 'factual',
    source_type: 'OFFICIAL_PYQ',
    source: 'TEST FIXTURE — not a real SSC question',
  };
}

export async function seedSscFixtures({ t1Years = 3, perYear = 40 } = {}) {
  const items = [];
  for (let i = 0; i < t1Years; i += 1) {
    const year = 2026 - i;
    for (let n = 1; n <= perYear; n += 1) {
      items.push(makeSscQuestion(year, n));
    }
  }
  return await insertMany(items, { source: 'TEST FIXTURE' });
}

/** SSC Tier-II Paper-I Session-I style fixtures (Quant/Reasoning/English/GA/Computer). */
export async function seedSscTier2Fixtures({ years = 1, perYear = 60 } = {}) {
  const subjects = [
    'Mathematical Abilities',
    'Reasoning & General Intelligence',
    'English Language & Comprehension',
    'General Awareness',
    'Computer Knowledge',
  ];
  const items = [];
  for (let i = 0; i < years; i += 1) {
    const year = 2026 - i;
    for (let n = 1; n <= perYear; n += 1) {
      const subject = subjects[n % subjects.length];
      items.push({
        year,
        paper: 'SSC_T2_P1',
        question_number: n,
        question_text: `[FIXTURE SSC T2] ${year} Q${n} regarding ${subject} — pick the correct option?`,
        options: [
          { key: 'A', text: 'Option one' },
          { key: 'B', text: 'Option two' },
          { key: 'C', text: 'Option three' },
          { key: 'D', text: 'Option four' },
        ],
        correct_answer: ['A', 'B', 'C', 'D'][n % 4],
        subject,
        topic: `SSC T2 ${subject} Topic ${n % 5}`,
        difficulty: DIFFICULTIES[n % 3],
        question_type: 'factual',
        source_type: 'OFFICIAL_PYQ',
        source: 'TEST FIXTURE — not a real SSC question',
      });
    }
  }
  return await insertMany(items, { source: 'TEST FIXTURE' });
}

export { GS_SUBJECTS, CSAT_SUBJECTS, SSC_T1_SUBJECTS };
