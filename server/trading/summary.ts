// Calcul des chiffres clés affichés sur le dashboard.

import type { Bot, BotSummary, Position } from '../../shared/types.ts';
import * as repo from '../db.ts';
import { stopLossPrice, takeProfitPrice } from './portfolio.ts';
import { downsample, maxDrawdownPct } from './stats.ts';

export function positionsView(bot: Bot): Position[] {
  return repo.getPositions(bot.id).map((p) => {
    const price = p.lastPrice ?? p.entryPrice;
    const marketValue = p.qty * price;
    const unrealizedPnl = marketValue - p.costBasis;
    return {
      ...p,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPct: p.costBasis > 0 ? (unrealizedPnl / p.costBasis) * 100 : 0,
      stopLossPrice: stopLossPrice(p.entryPrice, bot.stopLossPct),
      takeProfitPrice: takeProfitPrice(p.entryPrice, bot.takeProfitPct),
    };
  });
}

export function computeSummary(bot: Bot, positions: Position[] = positionsView(bot)): BotSummary {
  const positionsValue = positions.reduce((a, p) => a + p.marketValue, 0);
  const equity = bot.cash + positionsValue;
  const pnl = equity - bot.initialCapital;
  const totals = repo.tradeTotals(bot.id);
  const history = repo.listEquity(bot.id);
  const values = [bot.initialCapital, ...history.map((h) => h.equity), equity];
  const benchmarkEquity = history.length ? history[history.length - 1].benchmark : null;

  return {
    equity,
    cash: bot.cash,
    positionsValue,
    pnl,
    pnlPct: (pnl / bot.initialCapital) * 100,
    benchmarkEquity,
    benchmarkPnlPct: benchmarkEquity !== null ? (benchmarkEquity / bot.initialCapital - 1) * 100 : null,
    realizedPnl: totals.realizedPnl,
    unrealizedPnl: positions.reduce((a, p) => a + p.unrealizedPnl, 0),
    feesPaid: totals.fees,
    tradesCount: totals.count,
    closedTrades: totals.closed,
    winRate: totals.closed ? (totals.wins / totals.closed) * 100 : null,
    maxDrawdownPct: maxDrawdownPct(values),
    sparkline: downsample(values, 60),
  };
}
