/**
 * Vercel serverless entrypoint.
 *
 * Vercel hands us a Node req/res pair; this wraps the shared Express app so
 * the same routing, DB adapter and static shell run locally and on Vercel.
 * `DATABASE_URL` (Neon/Postgres) is read from the project's env vars.
 */
import { createApp } from '../src/server.js';

let appPromise = null;

function app() {
  if (!appPromise) appPromise = createApp();
  return appPromise;
}

export default async function handler(req, res) {
  const expressApp = await app();
  return expressApp(req, res);
}
