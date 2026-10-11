import test from 'node:test';
import assert from 'node:assert/strict';
import { toPostgres, toNumberedPlaceholders, isUniqueViolation } from '../src/db/database.js';

/**
 * The Postgres adapter rewrites SQLite-flavoured SQL at prepare time. These
 * tests pin the rewrites so a silent regression can't ship broken queries to
 * production. (The SQLite driver path is covered by the full app suite.)
 */

test('scalar two-arg MAX(a,b) becomes GREATEST', () => {
  const sql = 'UPDATE session_answers SET time_spent_seconds = MAX(session_answers.time_spent_seconds, excluded.time_spent_seconds)';
  assert.match(toPostgres(sql), /GREATEST\(session_answers\.time_spent_seconds, excluded\.time_spent_seconds\)/);
});

test('aggregate MAX(col) is left alone', () => {
  const sql = 'SELECT MAX(score) AS best FROM test_sessions';
  assert.equal(toPostgres(sql), sql);
});

test('INSERT OR IGNORE becomes INSERT + ON CONFLICT DO NOTHING', () => {
  const converted = toPostgres('INSERT OR IGNORE INTO ssc_cutoff_history (id, year) VALUES (?, ?)');
  assert.match(converted, /^INSERT INTO ssc_cutoff_history/i);
  assert.equal(toNumberedPlaceholders(converted), 'INSERT INTO ssc_cutoff_history (id, year) VALUES ($1, $2)');
});

test('`col IS ?` becomes IS NOT DISTINCT FROM', () => {
  const sql = "SELECT * FROM paper_difficulty WHERE paper_id = ? AND (cycle_date IS ? OR cycle_date = ?)";
  assert.match(toPostgres(sql), /cycle_date IS NOT DISTINCT FROM \? OR cycle_date = \?/);
});

test('LIKE becomes ILIKE to keep SQLite case-insensitivity', () => {
  assert.match(toPostgres('SELECT * FROM questions WHERE question_text LIKE ?'), /ILIKE \?/);
});

test('placeholders are numbered, ignoring those inside string literals', () => {
  const sql = "SELECT * FROM t WHERE a = ? AND b = '?' AND c = ?";
  assert.equal(toNumberedPlaceholders(sql), "SELECT * FROM t WHERE a = $1 AND b = '?' AND c = $2");
});

test('unique violations are detected by pg code and by message', () => {
  assert.equal(isUniqueViolation({ code: '23505', message: 'x' }), true);
  assert.equal(isUniqueViolation({ message: 'duplicate key value violates unique constraint "ux"' }), true);
  assert.equal(isUniqueViolation({ message: 'UNIQUE constraint failed: ssc_cycles.cycle_date' }), false);
  assert.equal(isUniqueViolation(new Error('boom')), false);
});
