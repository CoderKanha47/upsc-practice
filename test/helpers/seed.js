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

export function seedFixtures({ gsYears = 8, csatYears = 4, gsPerYear = 25, csatPerYear = 25 } = {}) {
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
  return insertMany(items, { source: 'TEST FIXTURE' });
}

export { GS_SUBJECTS, CSAT_SUBJECTS };
