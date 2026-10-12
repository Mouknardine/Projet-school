// Configuration du serveur, lue depuis les variables d'environnement (ou un fichier .env).

try {
  process.loadEnvFile();
} catch {
  // Pas de fichier .env : on garde les valeurs par défaut.
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  /** Fréquence d'analyse du marché par le bot, en secondes. */
  tickSeconds: Math.max(15, Number(process.env.TICK_SECONDS ?? 60)),
  /** Si défini, ce mot de passe est demandé pour créer, modifier ou supprimer un bot. */
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  dbPath: process.env.DB_PATH ?? 'data/tradebot.db',
};
