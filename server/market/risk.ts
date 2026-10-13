// Mesure du risque d'une action à partir de ses cours de l'année passée.
// La volatilité dit de combien le prix varie habituellement : c'est elle qui sert à choisir des actions
// calmes pour un profil prudent et plus agitées pour un profil audacieux.

import type { Bar } from '../../shared/types.ts';
import type { MeasuredAsset } from '../../shared/profile.ts';
import { fxAt, getFxHistory } from './fx.ts';
import { getChart } from './yahoo.ts';

const YEAR_MS = 365 * 86_400_000;

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

/** Les cours de l'année qui précède `asOf` (rien après : aucune information du futur). */
export function yearBefore(bars: Bar[], asOf: number): Bar[] {
  return bars.filter((b) => b.time <= asOf && b.time > asOf - YEAR_MS);
}

/**
 * Mesure plusieurs actions sur l'année qui précède `asOf` (par défaut : maintenant), quelques requêtes à la fois
 * pour ne pas surcharger Yahoo Finance. Avec une date passée, seuls les cours connus à cette date sont utilisés :
 * c'est ce qui permet de simuler honnêtement ce que le bot aurait choisi à l'époque.
 */
export async function measureAssets(
  symbols: string[],
  opts: { asOf?: number; accountCurrency?: string; concurrency?: number } = {},
): Promise<{ measured: MeasuredAsset[]; errors: string[] }> {
  const asOf = opts.asOf ?? null;
  const range = asOf === null ? '1y' : '5y';
  // Le risque et le rendement sont mesurés dans la monnaie du compte, tels que la personne les vivrait :
  // pour une action en dollars et un compte en francs, les variations du dollar comptent aussi.
  const account = opts.accountCurrency ?? null;
  const fxHistories = new Map<string, Promise<Bar[]>>();
  const fxHistory = (from: string) => {
    if (!fxHistories.has(from)) fxHistories.set(from, getFxHistory(from, account as string, '1d', range));
    return fxHistories.get(from) as Promise<Bar[]>;
  };
  const measured: MeasuredAsset[] = [];
  const errors: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < symbols.length) {
      const symbol = symbols[next++];
      try {
        const { quote, bars } = await getChart(symbol, '1d', range);
        let window = asOf === null ? bars : yearBefore(bars, asOf);
        const price = window[window.length - 1]?.close ?? quote.price;
        if (account && quote.currency !== account && window.length) {
          const rate = fxAt(await fxHistory(quote.currency), NaN);
          window = window.map((b) => ({ ...b, close: b.close * rate(b.time) })).filter((b) => Number.isFinite(b.close));
        }
        const risk = measureRisk(window);
        if (!risk) errors.push(`${symbol} : pas assez d'historique`);
        else measured.push({ symbol, name: quote.name || symbol, currency: quote.currency, price, ...risk });
      } catch (err) {
        errors.push(`${symbol} : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, symbols.length) }, worker));
  // Ordre stable, quel que soit l'ordre d'arrivée des réponses.
  const order = new Map(symbols.map((s, i) => [s, i]));
  measured.sort((x, y) => (order.get(x.symbol) ?? 0) - (order.get(y.symbol) ?? 0));
  return { measured, errors };
}
