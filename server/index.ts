// Point d'entrée du serveur Node.js : API + dashboard web + planificateur du bot.
// Base de données : SQLite par défaut, ou Postgres si DATABASE_URL est défini.

import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApi } from './app.ts';
import { config } from './config.ts';
import type { Repo } from './repo.ts';
import { tickAllBots } from './trading/engine.ts';

async function openRepo(): Promise<Repo> {
  if (config.databaseUrl) {
    const { default: postgres } = await import('postgres');
    const { createPostgresRepo, ensurePostgresSchema } = await import('./db-postgres.ts');
    const sql = postgres(config.databaseUrl, { prepare: false, max: 5, onnotice: () => {} });
    await ensurePostgresSchema(sql);
    console.log('Base de données : Postgres');
    return createPostgresRepo(sql);
  }
  const { createSqliteRepo } = await import('./db-sqlite.ts');
  console.log(`Base de données : SQLite (${config.dbPath})`);
  return createSqliteRepo(config.dbPath);
}

const repo = await openRepo();
const app = new Hono();
app.route('/api', createApi({ repo, tickSeconds: config.tickSeconds, adminPassword: async () => config.adminPassword || null }));
app.all('/api/*', (c) => c.json({ error: 'Route inconnue' }, 404));

// En production, le serveur sert aussi le dashboard (généré par `npm run build`).
if (fs.existsSync('dist/web/index.html')) {
  app.use('/*', serveStatic({ root: './dist/web' }));
  app.get('*', serveStatic({ path: './dist/web/index.html' }));
}

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`TradeBot démarré sur http://localhost:${config.port} (analyse toutes les ${config.tickSeconds} s)`);
});

// Planificateur : analyse tous les bots à intervalle régulier.
let busy = false;
async function runAllBots() {
  if (busy) return;
  busy = true;
  try {
    const { errors } = await tickAllBots(repo);
    for (const e of errors) console.error(`Erreur du bot ${e}`);
  } finally {
    busy = false;
  }
}
setTimeout(runAllBots, 2_000);
setInterval(runAllBots, config.tickSeconds * 1000);
