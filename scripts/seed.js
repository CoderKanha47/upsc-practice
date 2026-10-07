import { getDb } from '../src/db/database.js';
import { insertMany, refreshCoverage } from '../src/services/questionService.js';
import { ALL_SEED_QUESTIONS } from './seed-questions.js';

/** Seeds the built-in AI-generated practice set (never presented as PYQs). */
const db = getDb();
const existing = db
  .prepare("SELECT COUNT(*) AS n FROM questions WHERE source_type = 'AI_GENERATED'")
  .get().n;

if (existing > 0) {
  console.log(`Already seeded: ${existing} AI-generated practice questions present.`);
} else {
  const summary = insertMany(ALL_SEED_QUESTIONS, {
    source: 'Built-in practice set (AI generated — not a UPSC PYQ)',
  });
  console.log(
    `Seeded ${summary.inserted} AI-generated practice questions ` +
      `(${summary.rejected} rejected, ${summary.duplicates} duplicates).`,
  );
}

refreshCoverage();
const counts = db
  .prepare('SELECT source_type, COUNT(*) AS n FROM questions GROUP BY source_type')
  .all();
for (const c of counts) console.log(`  ${c.source_type}: ${c.n}`);
console.log('Done. Official PYQs are added only via the import pipeline (npm run import).');
