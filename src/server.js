import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import CONFIG from '../config/exam.config.js';
import { dbReady, usingPostgres, getPool } from './db/database.js';
import { withDbClient } from './db/context.js';
import apiRouter from './routes/api.js';
import adminRouter from './routes/admin.js';
import { seedHistoricalCutoffs } from './services/cutoff.js';
import { finalizeExpiredCycles } from './services/sscCycle.js';
import { loadSscConfig } from './services/sscConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/** Publish a pooled Postgres client for the life of each request. */
async function dbMiddleware(req, res, next) {
  if (!usingPostgres) return next();
  const pool = await getPool();
  return withDbClient(pool)(req, res, next);
}

export async function createApp() {
  await dbReady(); // ensure schema exists
  await loadSscConfig(); // warm the SSC config cache so cycle logic never sees defaults-only

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));
  app.use(express.text({ type: 'text/plain', limit: '20mb' }));
  app.use((req, res, next) => dbMiddleware(req, res, next));

  app.get('/api/health', (req, res) =>
    res.json({ ok: true, app: CONFIG.APP.NAME, now: new Date().toISOString() }),
  );
  app.use('/api/admin', adminRouter);
  app.use('/api', apiRouter);

  app.use(express.static(PUBLIC_DIR));
  // SPA fallback (never for API paths).
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    }
    return next();
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err);
    res.status(status).json({ error: err.message || 'Internal error', code: err.code || null });
  });

  return app;
}

export async function startServer() {
  const app = await createApp();

  // Reference cutoffs are seeded before the first request so the admin
  // dashboard never shows a half-empty table.
  await seedHistoricalCutoffs();
  // Cycles whose Sunday window closed while the app was down are settled here
  // rather than waiting for someone to open that cycle's page.
  await finalizeExpiredCycles();

  return new Promise((resolve) => {
    const server = app.listen(CONFIG.APP.PORT, CONFIG.APP.HOST, () => {
      console.log(`${CONFIG.APP.NAME}`);
      console.log(`→ http://${CONFIG.APP.HOST}:${CONFIG.APP.PORT}`);
      resolve(server);
    });
  });
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startServer();
}

export default createApp;
