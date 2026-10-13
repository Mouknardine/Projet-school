// Le moteur du bot en direct. À chaque « tick » (par défaut toutes les 60 s), pour chaque action suivie :
//   1. récupère le cours réel et l'historique de bougies ;
//   2. vérifie le stop-loss / take-profit de la position ouverte ;
//   3. si une nouvelle bougie vient de se clôturer, calcule les indicateurs et le signal de la stratégie ;
//   4. exécute l'ordre simulé (achat / vente) et l'enregistre dans l'historique avec sa justification ;
//   5. enregistre la valeur du portefeuille pour la courbe de performance.

import { assetInfo, PROFILES } from '../../shared/profile.ts';
import type { Bot, TradeTrigger } from '../../shared/types.ts';
import { getFxRate } from '../market/fx.ts';
import { closedBars, getChart, rangeFor, type ChartData } from '../market/yahoo.ts';
import type { BotState, PositionRow, Repo } from '../repo.ts';
import { costsSummary, fractionalAllowed, orderCosts } from './costs.ts';
import { sizeOrder, stopLossPrice, takeProfitPrice } from './portfolio.ts';
import { exitReason, getStrategy, protectionReason } from './strategies.ts';

const money = (n: number, currency: string) => `${n.toFixed(2)} ${currency}`;
const qtyStr = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(4));
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const rateStr = (from: string, to: string, fx: number) => (from === to ? '' : ` (1 ${from} = ${fx.toFixed(4)} ${to})`);

/**
 * Pour un placement créé avec le questionnaire, la raison d'un achat ou d'une attente s'explique par le profil
 * de la personne (et non par la stratégie de référence « acheter et garder », qui ne sert qu'à comparer).
 */
export function profileReason(bot: Bot, symbol: string, action: 'BUY' | 'HOLD'): string | null {
  if (!bot.profile || bot.strategy !== 'buy_hold') return null;
  const name = assetInfo(symbol)?.name ?? symbol;
  const limit = bot.maxLossPct > 0 ? `que si votre placement entier perd plus de ${bot.maxLossPct} % (votre limite de perte), pour protéger le reste` : 'jamais de lui-même';
  return action === 'BUY'
    ? `Achat de départ : ${name} fait partie des placements choisis pour votre profil « ${PROFILES[bot.profile.level].name} ». Le bot y place ${bot.positionSizePct} % de votre argent, puis il le garde : il ne le revendra ${limit}.`
    : `Le bot garde ${name}, comme prévu : il ne le revendra ${limit}.`;
}

/** Cours d'une action prêt à être utilisé : prix dans sa devise et taux de change vers la devise du compte. */
export interface MarketPrice {
  price: number;
  currency: string;
  fx: number;
}

/** Valeur totale du portefeuille dans la devise du compte : liquidités + positions au dernier cours et dernier taux connus. */
export async function currentEquity(repo: Repo, botId: number, cash: number): Promise<number> {
  return (await repo.getPositions(botId)).reduce((sum, p) => sum + p.qty * (p.lastPrice ?? p.entryPrice) * p.lastFx, cash);
}

async function buy(repo: Repo, bot: Bot, state: BotState, symbol: string, mp: MarketPrice, reason: string, now: number): Promise<boolean> {
  return repo.transaction(async (tx) => {
    const fresh = (await tx.getBot(bot.id))!;
    const equity = await currentEquity(tx, bot.id, fresh.cash);
    const budget = Math.min((equity * bot.positionSizePct) / 100, fresh.cash);
    const costOf = (qty: number) =>
      orderCosts({
        broker: bot.broker,
        side: 'BUY',
        symbol,
        qty,
        price: mp.price,
        quoteCurrency: mp.currency,
        accountCurrency: bot.currency,
        fxRate: mp.fx,
        feePct: bot.feePct,
      });
    const order = sizeOrder({
      budget,
      unitCost: mp.price * mp.fx,
      fractional: fractionalAllowed(bot.broker, symbol, bot.allowFractional),
      costOf: (qty) => costOf(qty).total,
    });
    if (!order) {
      await tx.insertLog(
        bot.id,
        'warn',
        symbol,
        `Le bot voulait acheter, mais son budget (${money(budget, bot.currency)}) ne suffit pas pour une action à ${money(mp.price, mp.currency)}, frais compris. Raison du signal : ${reason}`,
        now,
      );
      return false;
    }
    const costs = costOf(order.qty);
    const cashAfter = fresh.cash - order.total;
    await tx.setCash(bot.id, cashAfter);
    await tx.insertPosition(bot.id, {
      symbol,
      qty: order.qty,
      currency: mp.currency,
      entryPrice: mp.price,
      entryFx: mp.fx,
      costBasis: order.total,
      openedAt: now,
      lastPrice: mp.price,
      lastPriceAt: now,
      lastFx: mp.fx,
    });
    await tx.insertTrade(bot.id, {
      time: now,
      symbol,
      side: 'BUY',
      qty: order.qty,
      price: mp.price,
      currency: mp.currency,
      fxRate: mp.fx,
      fees: costs.total,
      costs: costs.lines,
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
      `ACHAT de ${qtyStr(order.qty)} ${symbol} à ${money(mp.price, mp.currency)}${rateStr(mp.currency, bot.currency, mp.fx)} : total ${money(order.total, bot.currency)}, dont ${money(costs.total, bot.currency)} de frais (${costsSummary(costs.lines, bot.currency)}). Pourquoi : ${reason}`,
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
  mp: MarketPrice,
  trigger: TradeTrigger,
  reason: string,
  now: number,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const fresh = (await tx.getBot(bot.id))!;
    const costs = orderCosts({
      broker: bot.broker,
      side: 'SELL',
      symbol: position.symbol,
      qty: position.qty,
      price: mp.price,
      quoteCurrency: mp.currency,
      accountCurrency: bot.currency,
      fxRate: mp.fx,
      feePct: bot.feePct,
    });
    const gross = position.qty * mp.price * mp.fx;
    const proceeds = gross - costs.total;
    const pnl = proceeds - position.costBasis;
    const pnlPct = position.costBasis > 0 ? (pnl / position.costBasis) * 100 : 0;
    const cashAfter = fresh.cash + proceeds;
    await tx.setCash(bot.id, cashAfter);
    await tx.deletePosition(bot.id, position.symbol);
    await tx.insertTrade(bot.id, {
      time: now,
      symbol: position.symbol,
      side: 'SELL',
      qty: position.qty,
      price: mp.price,
      currency: mp.currency,
      fxRate: mp.fx,
      fees: costs.total,
      costs: costs.lines,
      amount: proceeds,
      pnl,
      pnlPct,
      reason,
      trigger,
      cashAfter,
    });
    const result = `${pnl >= 0 ? 'gain' : 'perte'} de ${money(Math.abs(pnl), bot.currency)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)} %)`;
    await tx.insertLog(
      bot.id,
      'trade',
      position.symbol,
      `VENTE de ${qtyStr(position.qty)} ${position.symbol} à ${money(mp.price, mp.currency)}${rateStr(mp.currency, bot.currency, mp.fx)} : ${result}, tous frais compris (frais de cette vente : ${money(costs.total, bot.currency)}). Pourquoi : ${reason}`,
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
  data: ChartData & { fx: number },
  opts: { now: number; trade: boolean },
): Promise<void> {
  const { quote, fx } = data;
  const { now } = opts;
  const price = quote.price;
  const mp: MarketPrice = { price, currency: quote.currency, fx };
  await repo.updatePositionPrice(bot.id, symbol, price, fx, quote.priceTime);
  state.lastPrice[symbol] = price;
  state.currency[symbol] = quote.currency;
  state.fx[symbol] = fx;
  if (quote.name) state.names[symbol] = quote.name;
  if (quote.previousClose) state.prevClose[symbol] = quote.previousClose;
  state.spark[symbol] = [...data.bars.slice(-47).map((b) => b.close), price];
  if (quote.session) state.session[symbol] = quote.session;
  // Ce que le bot « pense » de cette action, affiché sur le dashboard à côté de son cours.
  const think = (text: string) => {
    state.lastAnalysis[symbol] = { time: now, text };
  };

  if (state.marketOpen[symbol] !== quote.marketOpen) {
    await repo.insertLog(
      bot.id,
      'info',
      symbol,
      quote.marketOpen
        ? `Bourse ouverte (${quote.exchange}) : le bot peut acheter et vendre ${symbol}.`
        : `Bourse fermée (${quote.exchange}) : le bot attend la prochaine séance pour acheter ou vendre ${symbol}.`,
      now,
    );
    state.marketOpen[symbol] = quote.marketOpen;
  }
  // On ne passe des ordres que pendant les heures d'ouverture de la bourse.
  if (!quote.marketOpen || !opts.trade) return;

  // 0. Limite de perte atteinte : le bot vend tout ce qu'il possède et n'achète plus rien.
  if (state.protection) {
    const held = await repo.getPosition(bot.id, symbol);
    if (held) {
      const reason = protectionReason(state.protection.equity, state.protection.base, bot.maxLossPct, bot.currency);
      await sell(repo, bot, held, mp, 'protection', reason, now);
      think(`Vendu pour protéger votre argent. ${reason}`);
    } else think("Limite de perte atteinte : le bot n'achète plus rien et garde l'argent à l'abri.");
    return;
  }

  // 1. Gestion du risque : stop-loss et take-profit, vérifiés à chaque tick avec le dernier cours.
  let position = await repo.getPosition(bot.id, symbol);
  let exitedNow = false;
  if (position) {
    const sl = stopLossPrice(position.entryPrice, bot.stopLossPct);
    const tp = takeProfitPrice(position.entryPrice, bot.takeProfitPct);
    if (sl !== null && price <= sl) {
      const reason = exitReason('stop_loss', price, position.entryPrice, bot.stopLossPct);
      await sell(repo, bot, position, mp, 'stop_loss', reason, now);
      think(`Vendu automatiquement. ${reason}`);
      position = undefined;
      exitedNow = true;
    } else if (tp !== null && price >= tp) {
      const reason = exitReason('take_profit', price, position.entryPrice, bot.takeProfitPct);
      await sell(repo, bot, position, mp, 'take_profit', reason, now);
      think(`Vendu automatiquement. ${reason}`);
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
    const msg = `Pas encore assez d'historique de cours pour la stratégie (${bars.length} bougies sur ${warmup} nécessaires) : le bot attend.`;
    await repo.insertLog(bot.id, 'warn', symbol, msg, now);
    think(msg);
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
    interval: bot.interval,
  });

  const own = profileReason(bot, symbol, signal.action === 'BUY' ? 'BUY' : 'HOLD');
  if (own && signal.action !== 'SELL') signal.reason = own;

  // Pour un signal qu'on ne suit pas, on ne recopie que l'observation (pas « le bot achète », qui serait faux).
  const observed = lowerFirst(signal.fact ?? signal.reason);
  const ignore = async (msg: string) => {
    await repo.insertLog(bot.id, 'signal', symbol, msg, now);
    think(msg);
  };
  if (signal.action === 'BUY') {
    if (position) await ignore(`Signal d'achat ignoré, car le bot possède déjà ${symbol}. Ce qu'il a observé : ${observed}`);
    else if (exitedNow) await ignore(`Signal d'achat ignoré, car ${symbol} vient d'être vendu à l'instant. Ce qu'il a observé : ${observed}`);
    else if (await buy(repo, bot, state, symbol, mp, signal.reason, now)) think(`Acheté. ${signal.reason}`);
    else think(`Le bot voulait acheter, mais son budget ne suffisait pas, frais compris. ${signal.reason}`);
  } else if (signal.action === 'SELL') {
    if (position) {
      await sell(repo, bot, position, mp, 'signal', signal.reason, now);
      think(`Vendu. ${signal.reason}`);
    } else await ignore(`Signal de vente ignoré, car le bot ne possède pas ${symbol} : il n'y a rien à vendre. Ce qu'il a observé : ${observed}`);
  } else {
    await repo.insertLog(bot.id, 'info', symbol, `Analyse, aucun ordre : ${signal.reason}`, now);
    think(signal.reason);
  }
}

/**
 * Valeur qu'aurait le portefeuille d'un investisseur qui achète toutes les actions à parts égales au démarrage
 * et les garde (« acheter et garder »). Pour une comparaison honnête, il paie lui aussi les frais d'achat
 * (courtage, change, taxes) chez le même courtier, et subit les variations des taux de change.
 */
export function benchmarkValue(
  bot: Bot,
  lastPrices: Record<string, number>,
  lastFx: Record<string, number> = {},
  currencies: Record<string, string> = {},
): number | null {
  const share = bot.initialCapital / bot.symbols.length;
  let total = 0;
  for (const s of bot.symbols) {
    const p0 = bot.startPrices[s];
    const p = lastPrices[s];
    if (!p0 || !p) return null;
    const fx0 = bot.startFx[s] ?? 1;
    const fx = lastFx[s] ?? fx0;
    const currency = currencies[s] ?? bot.currency;
    const unitCost = p0 * fx0;
    const order = sizeOrder({
      budget: share,
      unitCost,
      fractional: true,
      costOf: (qty) =>
        orderCosts({ broker: bot.broker, side: 'BUY', symbol: s, qty, price: p0, quoteCurrency: currency, accountCurrency: bot.currency, fxRate: fx0, feePct: bot.feePct }).total,
    });
    const qty = order?.qty ?? 0;
    total += share - (order?.total ?? 0) + qty * p * fx;
  }
  return total;
}

/** Limite de perte globale : si le placement a trop baissé, le bot passe en mode protection (il va tout vendre). */
export async function checkLossLimit(repo: Repo, bot: Bot, state: BotState, now: number): Promise<boolean> {
  if (bot.status !== 'running' || !(bot.maxLossPct > 0) || state.protection) return false;
  if ((await repo.getPositions(bot.id)).length === 0) return false;
  const equity = await currentEquity(repo, bot.id, bot.cash);
  const base = state.floorBase ?? bot.initialCapital;
  if (equity > base * (1 - bot.maxLossPct / 100)) return false;
  state.protection = { since: now, equity, base };
  await repo.insertLog(
    bot.id,
    'warn',
    null,
    `${protectionReason(equity, base, bot.maxLossPct, bot.currency)} Il vend ses actions dès que leur bourse est ouverte, puis se met en pause.`,
    now,
  );
  return true;
}

/** Protection terminée : tout est vendu, le bot se met en pause et l'argent reste à l'abri. */
export async function endProtectionIfDone(repo: Repo, bot: Bot, state: BotState, now: number): Promise<void> {
  if (!state.protection || bot.status !== 'running') return;
  if ((await repo.getPositions(bot.id)).length > 0) return;
  const cash = (await repo.getBot(bot.id))!.cash;
  await repo.setBotStatus(bot.id, 'paused');
  await repo.insertLog(
    bot.id,
    'warn',
    null,
    `Toutes les actions sont vendues : le bot se met en pause. Votre argent (${money(cash, bot.currency)}) est à l'abri, en liquidités. Vous pouvez le relancer quand vous voulez.`,
    now,
  );
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

    await checkLossLimit(repo, bot, state, Date.now());

    // Les cours de toutes les actions sont téléchargés en parallèle, puis traités un par un.
    const charts = await Promise.allSettled(bot.symbols.map((s) => getChart(s, bot.interval, range)));
    // Taux de change réels vers la devise du compte (un par devise de cotation).
    const currencies = [...new Set(charts.flatMap((c) => (c.status === 'fulfilled' ? [c.value.quote.currency] : [])))];
    const rates = await Promise.allSettled(currencies.map((c) => getFxRate(c, bot.currency)));
    const fxOf = new Map(currencies.map((c, i) => [c, rates[i]]));
    for (let i = 0; i < bot.symbols.length; i++) {
      const symbol = bot.symbols[i];
      const res = charts[i];
      if (res.status === 'rejected') {
        errors.push(`${symbol} : ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`);
        continue;
      }
      const rate = fxOf.get(res.value.quote.currency);
      if (!rate || rate.status === 'rejected') {
        errors.push(`${symbol} : ${rate?.status === 'rejected' && rate.reason instanceof Error ? rate.reason.message : 'taux de change indisponible'}`);
        continue;
      }
      anyOpen ||= res.value.quote.marketOpen;
      try {
        await processSymbol(repo, bot, state, symbol, { ...res.value, fx: rate.value }, { now: Date.now(), trade: bot.status === 'running' });
      } catch (err) {
        errors.push(`${symbol} : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await endProtectionIfDone(repo, bot, state, Date.now());
    await repo.saveBotState(botId, state);

    const now = Date.now();
    const error = errors.length ? errors.join(' ; ') : null;
    if (error && error !== bot.lastError) await repo.insertLog(botId, 'error', null, `Impossible de récupérer certains cours : ${error}`, now);

    const fresh = (await repo.getBot(botId))!;
    const last = await repo.lastEquity(botId);
    if (anyOpen || opts.force || !last || now - last.time >= SNAPSHOT_WHEN_CLOSED_MS) {
      await repo.insertEquity(botId, {
        time: now,
        equity: await currentEquity(repo, botId, fresh.cash),
        cash: fresh.cash,
        benchmark: benchmarkValue(fresh, state.lastPrice, state.fx, state.currency),
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
