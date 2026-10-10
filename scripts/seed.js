import { getDb } from '../src/db/database.js';
import { insertMany, refreshCoverage } from '../src/services/questionService.js';
import { ALL_SEED_QUESTIONS } from './seed-questions.js';
import { ALL_SSC_SEED_QUESTIONS } from './seed-ssc-questions.js';

/** Seeds the built-in AI-generated practice sets (never presented as PYQs). */
const db = getDb();

function seedSet(label, questions, source) {
  const existing = db
    .prepare('SELECT COUNT(*) AS n FROM questions WHERE source = ?')
    .get(source).n;
  if (existing > 0) {
    console.log(`Already seeded: ${existing} questions present for ${label}.`);
    return;
  }
  const summary = insertMany(questions, { source });
  console.log(
    `Seeded ${summary.inserted} ${label} questions ` +
      `(${summary.rejected} rejected, ${summary.duplicates} duplicates).`,
  );
}

seedSet('UPSC AI-generated practice', ALL_SEED_QUESTIONS, 'Built-in practice set (AI generated — not a UPSC PYQ)');
seedSet('SSC AI-generated practice', ALL_SSC_SEED_QUESTIONS, 'Built-in SSC practice set (AI generated — not an SSC PYQ)');

refreshCoverage();
const counts = db
  .prepare('SELECT exam, source_type, COUNT(*) AS n FROM questions GROUP BY exam, source_type')
  .all();
for (const c of counts) console.log(`  ${c.exam} ${c.source_type}: ${c.n}`);
console.log('Done. Official PYQs are added only via the import pipeline (npm run import).');
