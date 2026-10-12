// Taux de change réels (Yahoo Finance), pour convertir le prix d'une action dans la devise du compte du bot.

import type { Bar, Interval } from '../../shared/types.ts';
import { getChart, MarketDataError } from './yahoo.ts';

/** Symbole Yahoo d'une paire de devises : USDCHF=X donne le nombre de francs pour 1 dollar. */
export const fxSymbol = (from: string, to: string) => `${from}${to}=X`;

/** Taux de change actuel : 1 unité de `from` vaut `rate` unités de `to`. */
export async function getFxRate(from: string, to: string): Promise<number> {
  if (!from || from === to) return 1;
  try {
    const { quote } = await getChart(fxSymbol(from, to), '1d', '5d');
    if (!(quote.price > 0)) throw new Error('taux invalide');
    return quote.price;
  } catch (err) {
    throw new MarketDataError(`Taux de change ${from} → ${to} indisponible (${err instanceof Error ? err.message : String(err)})`);
  }
}

/** Historique d'un taux de change (pour le backtest), aux mêmes intervalles que les cours. */
export async function getFxHistory(from: string, to: string, interval: Interval, range: string): Promise<Bar[]> {
  if (!from || from === to) return [];
  return (await getChart(fxSymbol(from, to), interval, range)).bars;
}

/**
 * Renvoie une fonction qui donne le taux de change à une date : la dernière valeur connue à ce moment-là
 * (le marché des changes est ouvert presque en continu, mais ses bougies ne tombent pas pile sur celles des actions).
 */
export function fxAt(history: Bar[], fallback: number): (time: number) => number {
  if (history.length === 0) return () => fallback;
  return (time) => {
    let lo = 0;
    let hi = history.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (history[mid].time <= time) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found >= 0 ? history[found].close : history[0].open;
  };
}
