#!/usr/bin/env node
/**
 * IMPORT CLI
 * ----------
 *   npm run import -- <file> [--format json|text|answerkey|auto]
 *                    [--year 2024] [--paper GS1|CSAT]
 *                    [--source-type OFFICIAL_PYQ|AI_GENERATED|CUSTOM]
 *                    [--source "reference"]
 *
 * Reads a file, runs it through the shared import pipeline and prints a
 * per-batch report (inserted / duplicates / rejected / needs review).
 * Nothing is ever invented: rejected rows are listed, not guessed.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { runImport } from '../src/import/pipeline.js';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const file = process.argv.find((a) => !a.startsWith('--') && a !== process.argv[0] && a !== process.argv[1]);
if (!file) {
  console.log('Usage: npm run import -- <file> [--format auto|json|text|answerkey] [--year YYYY] [--paper GS1|CSAT] [--source-type TYPE] [--source "ref"]');
  process.exit(1);
}

const ext = path.extname(file).toLowerCase();
const requested = arg('format', 'auto');
const format = requested !== 'auto' ? requested : ext === '.json' ? 'json' : ext === '.pdf' ? 'text' : 'text';

if (ext === '.pdf') {
  console.error('PDF detected. This CLI imports text/JSON, not raw PDFs.');
  console.error('1) If the PDF has a text layer: extract it to .txt first.');
  console.error('2) If it is a scan (most official UPSC papers): run OCR externally, then:');
  console.error('   npm run import -- ocr-output.txt --format text --year 2024 --paper GS1');
  process.exit(2);
}

const meta = {
  filename: path.basename(file),
  year: arg('year') ? Number(arg('year')) : null,
  paper: arg('paper'),
  sourceType: arg('source-type', 'OFFICIAL_PYQ'),
  source: arg('source', path.basename(file)),
};

let content;
try {
  content = await fs.readFile(file, 'utf8');
} catch (err) {
  console.error(`Cannot read ${file}: ${err.message}`);
  process.exit(1);
}

console.log(`Importing ${file}`);
console.log(`  format: ${format} · sourceType: ${meta.sourceType}${meta.year ? ` · year: ${meta.year}` : ''}${meta.paper ? ` · paper: ${meta.paper}` : ''}`);
console.log('');

try {
  const result = await runImport({ format, content, meta });
  const s = result.summary || {};
  if (Array.isArray(s.errors) && s.errors.length) {
    s.errors.forEach((e) => console.log(`  ! ${typeof e === 'string' ? e : e.errors?.join('; ') || JSON.stringify(e)}`));
  }
  if (Array.isArray(s.duplicatesList) && s.duplicatesList.length) {
    s.duplicatesList.forEach((d) => console.log(`  = duplicate: ${d}`));
  }
  console.log('');
  console.log(`Batch:   ${result.batchId || (result.batch && result.batch.id) || '—'}`);
  console.log(`Total:   ${s.total ?? '—'}`);
  console.log(`Added:   ${s.inserted ?? 0}`);
  console.log(`Duplicate: ${s.duplicates ?? 0}`);
  console.log(`Rejected:  ${s.rejected ?? 0}`);
  console.log(`Needs review: ${s.review ?? 0}`);
  if (result.applied) {
    console.log(`Answer key: applied ${result.applied.applied ?? 0}, missing ${result.applied.missing?.length ?? 0}, conflicts ${result.applied.conflicts?.length ?? 0}`);
  }
  console.log('');
  console.log((result.batch && result.batch.notes?.warnings?.length) ? 'Review warnings recorded on the batch (Admin → Overview).' : 'Done.');
  process.exit(s.inserted || s.rejected ? 0 : 1);
} catch (err) {
  console.error(`Import failed: ${err.message}`);
  process.exit(1);
}
