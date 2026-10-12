// Configuration du serveur, lue depuis les variables d'environnement (ou un fichier .env en local).
// Fonctionne sous Node.js et sous Deno.

const g = globalThis as { process?: { env: Record<string, string | undefined>; loadEnvFile?: () => void }; Deno?: { env: { get(k: string): string | undefined } } };

try {
  g.process?.loadEnvFile?.();
} catch {
  // Pas de fichier .env : on garde les valeurs par défaut.
}

export function env(name: string): string | undefined {
  return g.process?.env?.[name] ?? g.Deno?.env.get(name);
}

export const config = {
  port: Number(env('PORT') ?? 3001),
  /** Fréquence d'analyse du marché par le bot, en secondes. */
  tickSeconds: Math.max(15, Number(env('TICK_SECONDS') ?? 60)),
  /** Si défini, ce mot de passe est demandé pour créer, modifier ou supprimer un bot. */
  adminPassword: env('ADMIN_PASSWORD') ?? '',
  /** Base SQLite locale (utilisée si DATABASE_URL n'est pas défini). */
  dbPath: env('DB_PATH') ?? 'data/tradebot.db',
  /** Adresse d'une base Postgres (optionnel) : postgres://utilisateur:motdepasse@hôte:5432/base */
  databaseUrl: env('DATABASE_URL') ?? '',
};
