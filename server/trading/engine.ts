// Le moteur du bot en direct. À chaque « tick » (par défaut toutes les 60 s), pour chaque action suivie :
//   1. récupère le cours réel et l'historique de bougies ;
//   2. vérifie le stop-loss / take-profit de la position ouverte ;
//   3. si une nouvelle bougie vient de se clôturer, calcule les indicateurs et le signal de la stratégie ;
//   4. exécute l'ordre simulé (achat / vente) et l'enregistre dans l'historique avec sa justification ;
//   5. enregistre la valeur du portefeuille pour la courbe de performance.

import type { Bot } from '../../shared/types.ts';
import { closedBars, getChart, rangeFor, type ChartData } from '../market/yahoo.ts';
import type { BotState, PositionRow, Repo } from '../repo.ts';
import { computeSell, sizeBuy, stopLossPrice, takeProfitPrice } from './portfolio.ts';
import { getStrategy } from './strategies.ts';

const money = (n: number, currency: string) => `${n.toFixed(2)} ${currency}`;
const qtyStr = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(4));

/** Valeur totale du portefeuille : liquidités + valeur des positions au dernier cours connu. */
export async function currentEquity(repo: Repo, botId: number, cash: number): Promise<number> {
  return (await repo.getPositions(botId)).reduce((sum, p) => sum + p.qty * (p.lastPrice ?? p.entryPrice), cash);
}

async function buy(repo: Repo, bot: Bot, state: BotState, symbol: string, price: number, reason: string, now: number): Promise<boolean> {
  return repo.transaction(async (tx) => {
    const fresh = (await tx.getBot(bot.id))!;
    const equity = await currentEquity(tx, bot.id, fresh.cash);
    const order = sizeBuy({
      cash: fresh.cash,
      equity,
      price,
      positionSizePct: bot.positionSizePct,
      feePct: bot.feePct,
      allowFractional: bot.allowFractional,
    });
    if (!order) {
      await tx.insertLog(
        bot.id,
        'warn',
        symbol,
        `Signal d'achat non exécuté : liquidités insuffisantes (${money(fresh.cash, bot.currency)} disponibles, cours ${money(price, bot.currency)}). ${reason}`,
        now,
      );
      return false;
    }
    const cashAfter = fresh.cash - order.total;
    await tx.setCash(bot.id, cashAfter);
    await tx.insertPosition(bot.id, {
      symbol,
      qty: order.qty,
      entryPrice: price,
      costBasis: order.total,
      openedAt: now,
      lastPrice: price,
      lastPriceAt: now,
    });
    await tx.insertTrade(bot.id, {
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
    await tx.insertLog(
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

export async function sell(
  repo: Repo,
  bot: Bot,
  position: PositionRow,
  price: number,
  trigger: 'signal' | 'stop_loss' | 'take_profit' | 'manual',
  reason: string,
  now: number,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const fresh = (await tx.getBot(bot.id))!;
    const r = computeSell(position.qty, price, position.costBasis, bot.feePct);
    const cashAfter = fresh.cash + r.proceeds;
    await tx.setCash(bot.id, cashAfter);
    await tx.deletePosition(bot.id, position.symbol);
    await tx.insertTrade(bot.id, {
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
    await tx.insertLog(
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
export async function processSymbol(
  repo: Repo,
  bot: Bot,
  state: BotState,
  symbol: string,
  data: ChartData,
  opts: { now: number; trade: boolean },
): Promise<void> {
  const { quote } = data;
  const { now } = opts;
  const price = quote.price;
  await repo.updatePositionPrice(bot.id, symbol, price, quote.priceTime);
  state.lastPrice[symbol] = price;
  if (quote.name) state.names[symbol] = quote.name;
  if (quote.previousClose) state.prevClose[symbol] = quote.previousClose;
  state.spark[symbol] = [...data.bars.slice(-47).map((b) => b.close), price];

  if (state.marketOpen[symbol] !== quote.marketOpen) {
    await repo.insertLog(
      bot.id,
      'info',
      symbol,
      quote.marketOpen ? `Marché ouvert (${quote.exchange})` : `Marché fermé (${quote.exchange}) — le bot attend la prochaine séance`,
      now,
    );
    state.marketOpen[symbol] = quote.marketOpen;
  }
  // On ne passe des ordres que pendant les heures d'ouverture de la bourse.
  if (!quote.marketOpen || !opts.trade) return;

  // 1. Gestion du risque : stop-loss et take-profit, vérifiés à chaque tick avec le dernier cours.
  let position = await repo.getPosition(bot.id, symbol);
  let exitedNow = false;
  if (position) {
    const sl = stopLossPrice(position.entryPrice, bot.stopLossPct);
    const tp = takeProfitPrice(position.entryPrice, bot.takeProfitPct);
    if (sl !== null && price <= sl) {
      await sell(repo, bot, position, price, 'stop_loss', `Stop-loss : cours ${price.toFixed(2)} ≤ ${sl.toFixed(2)} (−${bot.stopLossPct} % sous le prix d'achat)`, now);
      position = undefined;
      exitedNow = true;
    } else if (tp !== null && price >= tp) {
      await sell(repo, bot, position, price, 'take_profit', `Take-profit : cours ${price.toFixed(2)} ≥ ${tp.toFixed(2)} (+${bot.takeProfitPct} % au-dessus du prix d'achat)`, now);
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
    await repo.insertLog(bot.id, 'warn', symbol, `Historique insuffisant pour la stratégie (${bars.length}/${warmup} bougies)`, now);
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
    if (position) await repo.insertLog(bot.id, 'signal', symbol, `Signal d'achat, mais position déjà ouverte : ${signal.reason}`, now);
    else if (exitedNow) await repo.insertLog(bot.id, 'signal', symbol, `Signal d'achat ignoré (position vendue à l'instant) : ${signal.reason}`, now);
    else await buy(repo, bot, state, symbol, price, signal.reason, now);
  } else if (signal.action === 'SELL') {
    if (position) await sell(repo, bot, position, price, 'signal', signal.reason, now);
    else await repo.insertLog(bot.id, 'signal', symbol, `Signal de vente, mais aucune position ouverte : ${signal.reason}`, now);
  } else {
    await repo.insertLog(bot.id, 'info', symbol, `Analyse : ${signal.reason}`, now);
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

const SNAPSHOT_WHEN_CLOSED_MS = 30 * 60_000;
const LOCK_TTL_MS = 2 * 60_000;

/** Un cycle complet d'analyse pour un bot. Un bot en pause suit toujours les cours mais ne passe aucun ordre. */
export async function tickBot(repo: Repo, botId: number, opts: { force?: boolean } = {}): Promise<void> {
  // Verrou en base : deux analyses du même bot ne peuvent pas se chevaucher (même sur plusieurs serveurs).
  if (!(await repo.tryLockBot(botId, Date.now(), LOCK_TTL_MS))) return;
  try {
    const bot = await repo.getBot(botId);
    if (!bot) return;
    const state = await repo.getBotState(botId);
    const strategy = getStrategy(bot.strategy);
    const range = rangeFor(bot.interval, strategy.warmup(bot.params) + 5);
    const errors: string[] = [];
    let anyOpen = false;

    // Les cours de toutes les actions sont téléchargés en parallèle, puis traités un par un.
    const charts = await Promise.allSettled(bot.symbols.map((s) => getChart(s, bot.interval, range)));
    for (let i = 0; i < bot.symbols.length; i++) {
      const symbol = bot.symbols[i];
      const res = charts[i];
      if (res.status === 'rejected') {
        errors.push(`${symbol} : ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`);
        continue;
      }
      anyOpen ||= res.value.quote.marketOpen;
      try {
        await processSymbol(repo, bot, state, symbol, res.value, { now: Date.now(), trade: bot.status === 'running' });
      } catch (err) {
        errors.push(`${symbol} : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await repo.saveBotState(botId, state);

    const now = Date.now();
    const error = errors.length ? errors.join(' ; ') : null;
    if (error && error !== bot.lastError) await repo.insertLog(botId, 'error', null, `Erreur de données : ${error}`, now);

    const fresh = (await repo.getBot(botId))!;
    const last = await repo.lastEquity(botId);
    if (anyOpen || opts.force || !last || now - last.time >= SNAPSHOT_WHEN_CLOSED_MS) {
      await repo.insertEquity(botId, {
        time: now,
        equity: await currentEquity(repo, botId, fresh.cash),
        cash: fresh.cash,
        benchmark: benchmarkValue(fresh, state.lastPrice),
      });
    }
    await repo.setBotTick(botId, now, error);
  } finally {
    await repo.unlockBot(botId);
  }
}

/** Analyse tous les bots, l'un après l'autre. */
export async function tickAllBots(repo: Repo): Promise<{ bots: number; errors: string[] }> {
  const bots = await repo.listBots();
  const errors: string[] = [];
  for (const bot of bots) {
    try {
      await tickBot(repo, bot.id);
    } catch (err) {
      errors.push(`#${bot.id} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { bots: bots.length, errors };
}
