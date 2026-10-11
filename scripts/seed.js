// `--postgres` (or a DATABASE_URL already in the env) targets Postgres instead
// of the local SQLite file. The flag must be resolved before the DB layer is
// imported, because `usingPostgres` is read at module load.
if (process.argv.includes('--postgres') && !process.env.DATABASE_URL) {
  console.error('seed:pg requires DATABASE_URL to be set (your Neon connection string).');
  process.exit(1);
}

const { dbReady } = await import('../src/db/database.js');
const { insertMany, refreshCoverage } = await import('../src/services/questionService.js');
const { ALL_SEED_QUESTIONS } = await import('./seed-questions.js');
const { ALL_SSC_SEED_QUESTIONS } = await import('./seed-ssc-questions.js');

/** Seeds the built-in AI-generated practice sets (never presented as PYQs). */
const db = await dbReady();

async function seedSet(label, questions, source) {
  const existing = (await db
    .prepare('SELECT COUNT(*) AS n FROM questions WHERE source = ?')
    .get(source)).n;
  if (existing > 0) {
    console.log(`Already seeded: ${existing} questions present for ${label}.`);
    return;
  }
  const summary = await insertMany(questions, { source });
  console.log(
    `Seeded ${summary.inserted} ${label} questions ` +
      `(${summary.rejected} rejected, ${summary.duplicates} duplicates).`,
  );
}

await seedSet('UPSC AI-generated practice', ALL_SEED_QUESTIONS, 'Built-in practice set (AI generated — not a UPSC PYQ)');
await seedSet('SSC AI-generated practice', ALL_SSC_SEED_QUESTIONS, 'Built-in SSC practice set (AI generated — not an SSC PYQ)');

await refreshCoverage();
const counts = await db
  .prepare('SELECT exam, source_type, COUNT(*) AS n FROM questions GROUP BY exam, source_type')
  .all();
for (const c of counts) console.log(`  ${c.exam} ${c.source_type}: ${c.n}`);
console.log('Done. Official PYQs are added only via the import pipeline (npm run import).');
