// Mesures de performance et de risque (statistiques utilisées en finance quantitative).

import type { Interval } from '../../shared/types.ts';

/**
 * Drawdown maximal : la plus grosse baisse (en %) entre un sommet et le creux qui suit.
 * Exemple : le portefeuille monte à 12 000, redescend à 9 000 → drawdown de 25 %.
 */
export function maxDrawdownPct(values: number[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) maxDd = Math.max(maxDd, (peak - v) / peak);
  }
  return maxDd * 100;
}

/** Nombre approximatif de bougies par an (bourse américaine : 252 jours de 6 h 30). */
const BARS_PER_YEAR: Record<Interval, number> = {
  '5m': 252 * 78,
  '15m': 252 * 26,
  '1h': 252 * 7,
  '1d': 252,
};

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdDev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Volatilité annualisée et ratio de Sharpe (rendement moyen / volatilité, annualisés, taux sans risque = 0).
 * Un Sharpe > 1 est généralement considéré comme bon : le rendement compense bien le risque pris.
 */
export function riskMetrics(values: number[], interval: Interval): { volatilityPct: number | null; sharpe: number | null } {
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) if (values[i - 1] > 0) returns.push(values[i] / values[i - 1] - 1);
  if (returns.length < 2) return { volatilityPct: null, sharpe: null };
  const sd = stdDev(returns);
  const n = BARS_PER_YEAR[interval];
  const volatilityPct = sd * Math.sqrt(n) * 100;
  const sharpe = sd > 0 ? (mean(returns) / sd) * Math.sqrt(n) : null;
  return { volatilityPct, sharpe };
}

export interface ClosedTradeStats {
  closedTrades: number;
  winRate: number | null;
  profitFactor: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
}

/** Statistiques sur les ventes (trades « fermés ») : taux de réussite, gain moyen, etc. */
export function closedTradeStats(sells: { pnl: number | null; pnlPct: number | null }[]): ClosedTradeStats {
  const closed = sells.filter((t) => t.pnl !== null);
  const wins = closed.filter((t) => (t.pnl as number) > 0);
  const losses = closed.filter((t) => (t.pnl as number) <= 0);
  const grossWin = wins.reduce((a, t) => a + (t.pnl as number), 0);
  const grossLoss = -losses.reduce((a, t) => a + (t.pnl as number), 0);
  return {
    closedTrades: closed.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgWinPct: wins.length ? mean(wins.map((t) => t.pnlPct as number)) : null,
    avgLossPct: losses.length ? mean(losses.map((t) => t.pnlPct as number)) : null,
  };
}

/** Réduit une longue série à au plus `max` points (pour les graphiques et les mini-courbes). */
export function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = (items.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]);
  return out;
}
