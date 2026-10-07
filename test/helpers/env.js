// Test environment setup — MUST be imported before any module that reads config.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const dbFile = path.join(ROOT, 'data', `test-${process.pid}.db`);
process.env.DB_FILE = dbFile;
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'test-admin-token';
process.env.PYQ_START_YEAR = process.env.PYQ_START_YEAR || '2007';
process.env.PYQ_END_YEAR = process.env.PYQ_END_YEAR || '2026';

export const TEST_DB_FILE = dbFile;
export const TEST_ADMIN_TOKEN = process.env.ADMIN_TOKEN;

// Imported after the env vars above so the DB path is the test database.
const { closeDb } = await import('../../src/db/database.js');

export function cleanupTestDb() {
  closeDb(); // Windows cannot unlink an open database file
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(`${dbFile}${suffix}`);
    } catch {
      /* ignore */
    }
  }
}

// Each test process removes its own database when it exits.
process.on('exit', cleanupTestDb);
