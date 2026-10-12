// Backtest : on rejoue la stratégie sur l'historique réel pour voir ce qu'elle aurait rapporté.
// Mêmes stratégies et mêmes règles de calcul que le bot en direct :
//   - le signal est calculé à la clôture d'une bougie ;
//   - l'ordre est exécuté à l'ouverture de la bougie suivante (comme le bot en direct, qui agit juste après) ;
//   - stop-loss et take-profit sont vérifiés avec le plus bas / plus haut de chaque bougie.

import type { BacktestResult, Bar, BotConfig, BrokerId, EquityPoint, Trade, TradeTrigger } from '../../shared/types.ts';
import { fractionalAllowed, orderCosts } from './costs.ts';
import { sizeOrder, stopLossPrice, takeProfitPrice } from './portfolio.ts';
import { closedTradeStats, downsample, maxDrawdownPct, riskMetrics } from './stats.ts';
import { exitReason, getStrategy, type Signal } from './strategies.ts';

type BacktestConfig = Omit<BotConfig, 'name' | 'currency' | 'broker'> & { currency?: string; broker?: BrokerId };

/** Devise de chaque action et taux de change historique vers la devise du compte (1 si même devise). */
export interface BacktestFx {
  currencyOf?: Record<string, string>;
  fxBySymbol?: Record<string, (time: number) => number>;
}
type SimTrade = Omit<Trade, 'id' | 'botId'>;

interface SimPosition {
  qty: number;
  entryPrice: number;
  costBasis: number;
}

export class BacktestError extends Error {}

export function runBacktest(
  cfg: BacktestConfig,
  barsBySymbol: Record<string, Bar[]>,
  fxData: BacktestFx = {},
): Omit<BacktestResult, 'currency' | 'range' | 'overlays' | 'charts'> {
  const strategy = getStrategy(cfg.strategy);
  const p = cfg.params;
  const warmup = strategy.warmup(p);
  const symbols = cfg.symbols;
  const broker = cfg.broker ?? 'simple';
  const account = cfg.currency ?? 'CHF';
  const currencyOf = (s: string) => fxData.currencyOf?.[s] ?? account;
  const fxAt = (s: string, t: number) => fxData.fxBySymbol?.[s]?.(t) ?? 1;
  const costs = (s: string, side: 'BUY' | 'SELL', qty: number, price: number, fx: number, time: number) =>
    orderCosts({ broker, side, symbol: s, qty, price, quoteCurrency: currencyOf(s), accountCurrency: account, fxRate: fx, feePct: cfg.feePct, time });

  for (const s of symbols) {
    const n = barsBySymbol[s]?.length ?? 0;
    if (n < warmup + 1)
      throw new BacktestError(
        `Pas assez d'historique pour ${s} : ${n} bougies, il en faut au moins ${warmup + 1} pour cette stratégie. Choisissez une période plus longue.`,
      );
  }

  const series = Object.fromEntries(symbols.map((s) => [s, strategy.compute(barsBySymbol[s], p)]));
  // Le test commence quand toutes les actions ont assez d'historique pour calculer les indicateurs.
  const startTime = Math.max(...symbols.map((s) => barsBySymbol[s][warmup - 1].time));
  const indexByTime = Object.fromEntries(symbols.map((s) => [s, new Map(barsBySymbol[s].map((b, i) => [b.time, i]))]));
  const times = [...new Set(symbols.flatMap((s) => barsBySymbol[s].map((b) => b.time)))].filter((t) => t >= startTime).sort((a, b) => a - b);

  let cash = cfg.initialCapital;
  const positions = new Map<string, SimPosition>();
  const pending = new Map<string, Signal>();
  const everHeld = new Set<string>();
  const lastPrice: Record<string, number> = {};
  const lastFx: Record<string, number> = {};
  // Référence « acheter et garder » : les mêmes actions achetées à parts égales au départ, frais compris.
  const share = cfg.initialCapital / symbols.length;
  const benchUnits: Record<string, number> = {};
  let benchCash = 0;
  for (const s of symbols) {
    const bars = barsBySymbol[s];
    let k = 0;
    while (k + 1 < bars.length && bars[k + 1].time <= startTime) k++;
    lastPrice[s] = bars[k].close;
    lastFx[s] = fxAt(s, bars[k].time);
    const order = sizeOrder({
      budget: share,
      unitCost: lastPrice[s] * lastFx[s],
      fractional: true,
      costOf: (q) => costs(s, 'BUY', q, lastPrice[s], lastFx[s], bars[k].time).total,
    });
    benchUnits[s] = order?.qty ?? 0;
    benchCash += share - (order?.total ?? 0);
  }

  const trades: SimTrade[] = [];
  const equity: EquityPoint[] = [];
  let exposed = 0;

  const portfolioValue = () => [...positions].reduce((a, [s, pos]) => a + pos.qty * lastPrice[s] * lastFx[s], cash);

  const doBuy = (s: string, price: number, time: number, reason: string) => {
    const fx = fxAt(s, time);
    const budget = Math.min((portfolioValue() * cfg.positionSizePct) / 100, cash);
    const order = sizeOrder({
      budget,
      unitCost: price * fx,
      fractional: fractionalAllowed(broker, s, cfg.allowFractional),
      costOf: (q) => costs(s, 'BUY', q, price, fx, time).total,
    });
    if (!order) return;
    const c = costs(s, 'BUY', order.qty, price, fx, time);
    cash -= order.total;
    positions.set(s, { qty: order.qty, entryPrice: price, costBasis: order.total });
    everHeld.add(s);
    trades.push({
      time,
      symbol: s,
      side: 'BUY',
      qty: order.qty,
      price,
      currency: currencyOf(s),
      fxRate: fx,
      fees: c.total,
      costs: c.lines,
      amount: order.total,
      pnl: null,
      pnlPct: null,
      reason,
      trigger: 'signal',
      cashAfter: cash,
    });
  };

  const doSell = (s: string, price: number, time: number, trigger: TradeTrigger, reason: string) => {
    const pos = positions.get(s)!;
    const fx = fxAt(s, time);
    const c = costs(s, 'SELL', pos.qty, price, fx, time);
    const proceeds = pos.qty * price * fx - c.total;
    const pnl = proceeds - pos.costBasis;
    cash += proceeds;
    positions.delete(s);
    trades.push({
      time,
      symbol: s,
      side: 'SELL',
      qty: pos.qty,
      price,
      currency: currencyOf(s),
      fxRate: fx,
      fees: c.total,
      costs: c.lines,
      amount: proceeds,
      pnl,
      pnlPct: pos.costBasis > 0 ? (pnl / pos.costBasis) * 100 : 0,
      reason,
      trigger,
      cashAfter: cash,
    });
  };

  for (const t of times) {
    for (const s of symbols) {
      const i = indexByTime[s].get(t);
      if (i === undefined) continue;
      const bars = barsBySymbol[s];
      const bar = bars[i];

      // a) Exécution, à l'ouverture, de l'ordre décidé à la clôture précédente.
      const order = pending.get(s);
      if (order) {
        pending.delete(s);
        if (order.action === 'BUY' && !positions.has(s)) doBuy(s, bar.open, t, order.reason);
        else if (order.action === 'SELL' && positions.has(s)) doSell(s, bar.open, t, 'signal', order.reason);
      }

      // b) Stop-loss / take-profit pendant la bougie (si les deux sont touchés, on suppose le pire : le stop-loss).
      let exited = false;
      const pos = positions.get(s);
      if (pos) {
        const sl = stopLossPrice(pos.entryPrice, cfg.stopLossPct);
        const tp = takeProfitPrice(pos.entryPrice, cfg.takeProfitPct);
        if (sl !== null && bar.low <= sl) {
          const fill = Math.min(bar.open, sl);
          doSell(s, fill, t, 'stop_loss', exitReason('stop_loss', fill, pos.entryPrice, cfg.stopLossPct));
          exited = true;
        } else if (tp !== null && bar.high >= tp) {
          const fill = Math.max(bar.open, tp);
          doSell(s, fill, t, 'take_profit', exitReason('take_profit', fill, pos.entryPrice, cfg.takeProfitPct));
          exited = true;
        }
      }
      lastPrice[s] = bar.close;
      lastFx[s] = fxAt(s, t);

      // c) Signal à la clôture de la bougie → ordre exécuté à la bougie suivante.
      if (i >= warmup - 1) {
        const sig = strategy.signal({ bars, series: series[s], i, hasPosition: positions.has(s), everHeld: everHeld.has(s), p, interval: cfg.interval });
        if (sig.action === 'BUY' && !positions.has(s) && !exited) pending.set(s, sig);
        else if (sig.action === 'SELL' && positions.has(s)) pending.set(s, sig);
      }
    }

    const benchmark = symbols.reduce((a, s) => a + benchUnits[s] * lastPrice[s] * lastFx[s], benchCash);
    equity.push({ time: t, equity: portfolioValue(), cash, benchmark });
    if (positions.size > 0) exposed++;
  }

  const values = equity.map((e) => e.equity);
  const benchValues = equity.map((e) => e.benchmark as number);
  const finalEquity = values[values.length - 1] ?? cfg.initialCapital;
  const finalBench = benchValues[benchValues.length - 1] ?? cfg.initialCapital;
  const risk = riskMetrics(values, cfg.interval);
  const closed = closedTradeStats(trades.filter((t) => t.side === 'SELL'));

  return {
    interval: cfg.interval,
    warmupBars: warmup,
    equity: downsample(equity, 3000),
    trades,
    openPositions: [...positions].map(([symbol, pos]) => ({ symbol, qty: pos.qty, entryPrice: pos.entryPrice, lastPrice: lastPrice[symbol] })),
    stats: {
      startTime: times[0] ?? startTime,
      endTime: times[times.length - 1] ?? startTime,
      finalEquity,
      totalReturnPct: (finalEquity / cfg.initialCapital - 1) * 100,
      benchmarkReturnPct: (finalBench / cfg.initialCapital - 1) * 100,
      maxDrawdownPct: maxDrawdownPct(values),
      benchmarkMaxDrawdownPct: maxDrawdownPct(benchValues),
      volatilityPct: risk.volatilityPct,
      sharpe: risk.sharpe,
      ...closed,
      feesPaid: trades.reduce((a, t) => a + t.fees, 0),
      exposurePct: times.length ? (exposed / times.length) * 100 : 0,
    },
  };
}
