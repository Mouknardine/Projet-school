// Point d'entrée du serveur dans le cloud : Supabase Edge Function (Deno).
// Même API que le serveur local (server/app.ts), avec la base Postgres de Supabase.
// Le bot est lancé chaque minute par pg_cron, qui appelle POST /api/cron/tick.

import { Hono } from 'hono';
import postgres from 'postgres';
import { createApi } from '../../../server/app.ts';
import { createPostgresRepo } from '../../../server/db-postgres.ts';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 3, idle_timeout: 20, onnotice: () => {} });
const repo = createPostgresRepo(sql);

// Réglages stockés dans la table app_settings (mot de passe administrateur, secret du planificateur).
const cache = new Map<string, { at: number; value: string | null }>();
async function setting(key: string): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const [row] = await sql`select value from app_settings where key = ${key}`;
  const value: string | null = row?.value || null;
  cache.set(key, { at: Date.now(), value });
  return value;
}

const app = new Hono();
app.route(
  '/api',
  createApi({
    repo,
    tickSeconds: 60,
    adminPassword: async () => Deno.env.get('ADMIN_PASSWORD') || (await setting('admin_password')),
    cronSecret: () => setting('cron_secret'),
  }),
);
app.all('*', (c) => c.json({ error: 'Route inconnue' }, 404));

Deno.serve(app.fetch);
