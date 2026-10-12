// Le moteur du bot en direct. À chaque « tick » (par défaut toutes les 60 s), pour chaque action suivie :
//   1. récupère le cours réel et l'historique de bougies ;
//   2. vérifie le stop-loss / take-profit de la position ouverte ;
//   3. si une nouvelle bougie vient de se clôturer, calcule les indicateurs et le signal de la stratégie ;
//   4. exécute l'ordre simulé (achat / vente) et l'enregistre dans l'historique avec sa justification ;
//   5. enregistre la valeur du portefeuille pour la courbe de performance.

import type { Bot } from '../../shared/types.ts';
import * as repo from '../db.ts';
import { closedBars, getChart, rangeFor, type ChartData } from '../market/yahoo.ts';
import { computeSell, sizeBuy, stopLossPrice, takeProfitPrice } from './portfolio.ts';
import { getStrategy } from './strategies.ts';

const money = (n: number, currency: string) => `${n.toFixed(2)} ${currency}`;
const qtyStr = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(4));

/** Valeur totale du portefeuille : liquidités + valeur des positions au dernier cours connu. */
export function currentEquity(botId: number, cash: number): number {
  return repo.getPositions(botId).reduce((sum, p) => sum + p.qty * (p.lastPrice ?? p.entryPrice), cash);
}

function buy(bot: Bot, state: repo.BotState, symbol: string, price: number, reason: string, now: number): boolean {
  return repo.transaction(() => {
    const fresh = repo.getBot(bot.id)!;
    const equity = currentEquity(bot.id, fresh.cash);
    const order = sizeBuy({
      cash: fresh.cash,
      equity,
      price,
      positionSizePct: bot.positionSizePct,
      feePct: bot.feePct,
      allowFractional: bot.allowFractional,
    });
    if (!order) {
      repo.insertLog(
        bot.id,
        'warn',
        symbol,
        `Signal d'achat non exécuté : liquidités insuffisantes (${money(fresh.cash, bot.currency)} disponibles, cours ${money(price, bot.currency)}). ${reason}`,
        now,
      );
      return false;
    }
    const cashAfter = fresh.cash - order.total;
    repo.setCash(bot.id, cashAfter);
    repo.insertPosition(bot.id, {
      symbol,
      qty: order.qty,
      entryPrice: price,
      costBasis: order.total,
      openedAt: now,
      lastPrice: price,
      lastPriceAt: now,
    });
    repo.insertTrade(bot.id, {
      time: now,
      symbol,
      side: 'BUY',
      qty: order.qty,
      price,
      fees: order.fees,
      amount: order.total,
      pnl: null,
      pnlPct: null,
      reason,
      trigger: 'signal',
      cashAfter,
    });
    repo.insertLog(
      bot.id,
      'trade',
      symbol,
      `ACHAT de ${qtyStr(order.qty)} ${symbol} à ${money(price, bot.currency)} (total ${money(order.total, bot.currency)}, frais ${money(order.fees, bot.currency)}) — ${reason}`,
      now,
    );
    state.everHeld[symbol] = true;
    return true;
  });
}

export function sell(
  bot: Bot,
  position: repo.PositionRow,
  price: number,
  trigger: 'signal' | 'stop_loss' | 'take_profit' | 'manual',
  reason: string,
  now: number,
): void {
  repo.transaction(() => {
    const fresh = repo.getBot(bot.id)!;
    const r = computeSell(position.qty, price, position.costBasis, bot.feePct);
    const cashAfter = fresh.cash + r.proceeds;
    repo.setCash(bot.id, cashAfter);
    repo.deletePosition(bot.id, position.symbol);
    repo.insertTrade(bot.id, {
      time: now,
      symbol: position.symbol,
      side: 'SELL',
      qty: position.qty,
      price,
      fees: r.fees,
      amount: r.proceeds,
      pnl: r.pnl,
      pnlPct: r.pnlPct,
      reason,
      trigger,
      cashAfter,
    });
    const result = `${r.pnl >= 0 ? 'gain' : 'perte'} de ${money(Math.abs(r.pnl), bot.currency)} (${r.pnlPct >= 0 ? '+' : ''}${r.pnlPct.toFixed(2)} %)`;
    repo.insertLog(
      bot.id,
      'trade',
      position.symbol,
      `VENTE de ${qtyStr(position.qty)} ${position.symbol} à ${money(price, bot.currency)} : ${result} — ${reason}`,
      now,
    );
  });
}

/**
 * Traite un symbole à partir des données de marché déjà téléchargées.
 * Séparé du téléchargement pour pouvoir être testé avec des données fixes.
 */
export function processSymbol(
  bot: Bot,
  state: repo.BotState,
  symbol: string,
  data: ChartData,
  opts: { now: number; trade: boolean },
): void {
  const { quote } = data;
  const { now } = opts;
  const price = quote.price;
  repo.updatePositionPrice(bot.id, symbol, price, quote.priceTime);
  state.lastPrice[symbol] = price;

  if (state.marketOpen[symbol] !== quote.marketOpen) {
    if (state.marketOpen[symbol] !== undefined || quote.marketOpen) {
      repo.insertLog(bot.id, 'info', symbol, quote.marketOpen ? `Marché ouvert (${quote.exchange})` : `Marché fermé (${quote.exchange}) — le bot attend la prochaine séance`, now);
    }
    state.marketOpen[symbol] = quote.marketOpen;
  }
  // On ne passe des ordres que pendant les heures d'ouverture de la bourse.
  if (!quote.marketOpen || !opts.trade) return;

  // 1. Gestion du risque : stop-loss et take-profit, vérifiés à chaque tick avec le dernier cours.
  let position = repo.getPosition(bot.id, symbol);
  let exitedNow = false;
  if (position) {
    const sl = stopLossPrice(position.entryPrice, bot.stopLossPct);
    const tp = takeProfitPrice(position.entryPrice, bot.takeProfitPct);
    if (sl !== null && price <= sl) {
      sell(bot, position, price, 'stop_loss', `Stop-loss : cours ${price.toFixed(2)} ≤ ${sl.toFixed(2)} (−${bot.stopLossPct} % sous le prix d'achat)`, now);
      position = undefined;
      exitedNow = true;
    } else if (tp !== null && price >= tp) {
      sell(bot, position, price, 'take_profit', `Take-profit : cours ${price.toFixed(2)} ≥ ${tp.toFixed(2)} (+${bot.takeProfitPct} % au-dessus du prix d'achat)`, now);
      position = undefined;
      exitedNow = true;
    }
  }

  // 2. Analyse de la stratégie, une seule fois par nouvelle bougie clôturée.
  const strategy = getStrategy(bot.strategy);
  const bars = closedBars(data.bars, bot.interval, quote.marketOpen, now);
  const last = bars[bars.length - 1];
  if (!last) return;
  const lastSeen = state.lastBar[symbol];
  if (lastSeen !== undefined && last.time <= lastSeen) return;
  state.lastBar[symbol] = last.time;

  const warmup = strategy.warmup(bot.params);
  if (bars.length < warmup) {
    repo.insertLog(bot.id, 'warn', symbol, `Historique insuffisant pour la stratégie (${bars.length}/${warmup} bougies)`, now);
    return;
  }
  const series = strategy.compute(bars, bot.params);
  const signal = strategy.signal({
    bars,
    series,
    i: bars.length - 1,
    hasPosition: !!position,
    everHeld: !!state.everHeld[symbol],
    p: bot.params,
  });

  if (signal.action === 'BUY') {
    if (position) repo.insertLog(bot.id, 'signal', symbol, `Signal d'achat, mais position déjà ouverte : ${signal.reason}`, now);
    else if (exitedNow) repo.insertLog(bot.id, 'signal', symbol, `Signal d'achat ignoré (position vendue à l'instant) : ${signal.reason}`, now);
    else buy(bot, state, symbol, price, signal.reason, now);
  } else if (signal.action === 'SELL') {
    if (position) sell(bot, position, price, 'signal', signal.reason, now);
    else repo.insertLog(bot.id, 'signal', symbol, `Signal de vente, mais aucune position ouverte : ${signal.reason}`, now);
  } else {
    repo.insertLog(bot.id, 'info', symbol, `Analyse : ${signal.reason}`, now);
  }
}

/** Valeur qu'aurait le portefeuille en achetant toutes les actions à parts égales au démarrage (Buy & Hold). */
export function benchmarkValue(bot: Bot, lastPrices: Record<string, number>): number | null {
  const share = bot.initialCapital / bot.symbols.length;
  let total = 0;
  for (const s of bot.symbols) {
    const start = bot.startPrices[s];
    const now = lastPrices[s];
    if (!start || !now) return null;
    total += share * (now / start);
  }
  return total;
}

const runningTicks = new Set<number>();
const SNAPSHOT_WHEN_CLOSED_MS = 30 * 60_000;

/** Un cycle complet d'analyse pour un bot. Un bot en pause suit toujours les cours mais ne passe aucun ordre. */
export async function tickBot(botId: number, opts: { force?: boolean } = {}): Promise<void> {
  if (runningTicks.has(botId)) return;
  runningTicks.add(botId);
  try {
    const bot = repo.getBot(botId);
    if (!bot) return;
    const state = repo.getBotState(botId);
    const strategy = getStrategy(bot.strategy);
    const range = rangeFor(bot.interval, strategy.warmup(bot.params) + 5);
    const errors: string[] = [];
    let anyOpen = false;

    for (const symbol of bot.symbols) {
      try {
        const data = await getChart(symbol, bot.interval, range);
        anyOpen ||= data.quote.marketOpen;
        processSymbol(bot, state, symbol, data, { now: Date.now(), trade: bot.status === 'running' });
      } catch (err) {
        errors.push(`${symbol} : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    repo.saveBotState(botId, state);

    const now = Date.now();
    const error = errors.length ? errors.join(' ; ') : null;
    if (error && error !== bot.lastError) repo.insertLog(botId, 'error', null, `Erreur de données : ${error}`, now);

    const fresh = repo.getBot(botId)!;
    const last = repo.lastEquity(botId);
    if (anyOpen || opts.force || !last || now - last.time >= SNAPSHOT_WHEN_CLOSED_MS) {
      repo.insertEquity(botId, {
        time: now,
        equity: currentEquity(botId, fresh.cash),
        cash: fresh.cash,
        benchmark: benchmarkValue(fresh, state.lastPrice),
      });
    }
    repo.setBotTick(botId, now, error);
  } finally {
    runningTicks.delete(botId);
  }
}
