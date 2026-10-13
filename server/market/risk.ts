// Mesure du risque d'une action à partir de ses cours de l'année passée.
// La volatilité dit de combien le prix varie habituellement : c'est elle qui sert à choisir des actions
// calmes pour un profil prudent et plus agitées pour un profil audacieux.

import type { Bar } from '../../shared/types.ts';
import type { MeasuredAsset } from '../../shared/profile.ts';
import { getChart } from './yahoo.ts';

/** Volatilité annuelle (en %) et évolution sur la période (en %), à partir de bougies d'un jour. */
export function measureRisk(bars: Bar[]): { volatility: number; perf1y: number } | null {
  if (bars.length < 60) return null;
  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) if (bars[i - 1].close > 0 && bars[i].close > 0) returns.push(Math.log(bars[i].close / bars[i - 1].close));
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  // Nombre de bougies par an réellement observé : ~252 pour une action, ~365 pour une cryptomonnaie (cotée tous les jours).
  const days = (bars[bars.length - 1].time - bars[0].time) / 86_400_000;
  const perYear = days > 0 ? ((bars.length - 1) * 365) / days : 252;
  return {
    volatility: Math.sqrt(variance * perYear) * 100,
    perf1y: (bars[bars.length - 1].close / bars[0].close - 1) * 100,
  };
}

/** Mesure plusieurs actions (quelques requêtes à la fois, pour ne pas surcharger Yahoo Finance). */
export async function measureAssets(symbols: string[], concurrency = 6): Promise<{ measured: MeasuredAsset[]; errors: string[] }> {
  const measured: MeasuredAsset[] = [];
  const errors: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < symbols.length) {
      const symbol = symbols[next++];
      try {
        const { quote, bars } = await getChart(symbol, '1d', '1y');
        const risk = measureRisk(bars);
        if (!risk) errors.push(`${symbol} : pas assez d'historique`);
        else measured.push({ symbol, name: quote.name || symbol, currency: quote.currency, price: quote.price, ...risk });
      } catch (err) {
        errors.push(`${symbol} : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, worker));
  // Ordre stable, quel que soit l'ordre d'arrivée des réponses.
  const order = new Map(symbols.map((s, i) => [s, i]));
  measured.sort((x, y) => (order.get(x.symbol) ?? 0) - (order.get(y.symbol) ?? 0));
  return { measured, errors };
}
