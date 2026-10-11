/**
 * Request-scoped database context.
 *
 * On Postgres every query needs a client, and `tx()` needs all statements
 * issued inside its callback to land on that transaction's client — including
 * the ones services issue via a fresh `getDb()` call. AsyncLocalStorage is
 * what carries that client across the await boundaries the Postgres path
 * introduces.
 *
 * The SQLite driver never touches this module: its handle is a synchronous
 * singleton that already behaves correctly inside `BEGIN IMMEDIATE`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/** The client bound to the current request/transaction, if any. */
export function currentClient() {
  return storage.getStore()?.client || null;
}

/** Run `fn` with `client` published to every nested `getDb()`. */
export function runInClient(client, fn) {
  return storage.run({ client }, fn);
}

/** Express middleware: publish a pooled client for the life of one request. */
export function withDbClient(pool) {
  return async (req, res, next) => {
    const client = await pool.connect();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      client.release();
    };
    res.on('finish', release);
    res.on('close', release);
    try {
      await storage.run({ client }, () => next());
    } catch (err) {
      release();
      throw err;
    }
  };
}
