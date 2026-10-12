// Point d'entrée du serveur : API + dashboard web + planificateur du bot.

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { api, errorHandler } from './api.ts';
import { config } from './config.ts';
import { listBots } from './db.ts';
import { tickBot } from './trading/engine.ts';

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use('/api', api);

// En production, le serveur sert aussi le dashboard (généré par `npm run build`).
const webDist = path.resolve('dist/web');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) res.sendFile(path.join(webDist, 'index.html'));
    else next();
  });
}
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`TradeBot démarré sur http://localhost:${config.port} (analyse toutes les ${config.tickSeconds} s)`);
});

// Planificateur : analyse tous les bots à intervalle régulier.
let busy = false;
async function runAllBots() {
  if (busy) return;
  busy = true;
  try {
    for (const bot of listBots()) {
      try {
        await tickBot(bot.id);
      } catch (err) {
        console.error(`Erreur du bot #${bot.id} :`, err);
      }
    }
  } finally {
    busy = false;
  }
}
setTimeout(runAllBots, 2_000);
setInterval(runAllBots, config.tickSeconds * 1000);
