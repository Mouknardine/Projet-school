import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Bar, Quote } from '../shared/types.ts';
import { createSqliteRepo } from '../server/db-sqlite.ts';
import type { Repo } from '../server/repo.ts';
import { benchmarkValue, processSymbol, tickBot } from '../server/trading/engine.ts';
import { computeSummary } from '../server/trading/summary.ts';
import { barsFromCloses } from './helpers.ts';

// Base de données en mémoire pour les tests.
const repo: Repo = createSqliteRepo(':memory:');
const HOUR = 3_600_000;

function quote(price: number, now: number, marketOpen = true): Quote {
  return { symbol: 'TEST', name: 'Test SA', currency: 'CHF', exchange: 'SIX', price, priceTime: now, previousClose: null, marketOpen };
}

async function createBot(overrides: Record<string, unknown> = {}) {
  const id = await repo.insertBot(
    {
      name: 'Test',
      initialCapital: 10_000,
      symbols: ['TEST'],
      strategy: 'sma_cross',
      params: { fast: 3, slow: 6 },
      interval: '1h',
      positionSizePct: 50,
      stopLossPct: 5,
      takeProfitPct: 0,
      feePct: 0.1,
      allowFractional: false,
      currency: 'CHF',
      broker: 'simple',
      ...overrides,
    },
    { TEST: 100 },
    { TEST: 1 },
    Date.now(),
  );
  return (await repo.getBot(id))!;
}

describe('moteur du bot en direct', () => {
  it('achète sur un croisement haussier, puis applique le stop-loss', async () => {
    const bot = await createBot();
    const state = await repo.getBotState(bot.id);
    // Baisse puis forte hausse → la moyenne courte croise la longue vers le haut sur la dernière bougie.
    const closes = [110, 108, 106, 104, 102, 100, 98, 97, 96, 100, 106];
    const start = Date.now() - (closes.length + 1) * HOUR;
    const bars: Bar[] = barsFromCloses(closes, start, HOUR);
    const now = start + (closes.length + 0.5) * HOUR;

    await processSymbol(repo, bot, state, 'TEST', { quote: quote(106, now), bars, fx: 1 }, { now, trade: true });
    const trades = await repo.listTrades(bot.id);
    assert.equal(trades.length, 1);
    assert.equal(trades[0].side, 'BUY');
    assert.match(trades[0].reason, /La tendance devient haussière/);
    // Le dashboard affiche ce que le bot a pensé de cette action.
    assert.match(state.lastAnalysis.TEST.text, /^Acheté\. La tendance devient haussière/);
    assert.equal(trades[0].qty, 47); // 5000 / (106 × 1.001) = 47.1
    const pos = await repo.getPosition(bot.id, 'TEST');
    assert.ok(pos);
    assert.ok(Math.abs((await repo.getBot(bot.id))!.cash - (10_000 - pos.costBasis)) < 1e-9);

    // La même bougie n'est pas analysée deux fois.
    await processSymbol(repo, bot, state, 'TEST', { quote: quote(106, now + 60_000), bars, fx: 1 }, { now: now + 60_000, trade: true });
    assert.equal((await repo.listTrades(bot.id)).length, 1);

    // Le cours chute de plus de 5 % → stop-loss.
    await processSymbol(repo, bot, state, 'TEST', { quote: quote(100, now + 120_000), bars, fx: 1 }, { now: now + 120_000, trade: true });
    const after = await repo.listTrades(bot.id);
    assert.equal(after.length, 2);
    assert.equal(after[0].side, 'SELL');
    assert.equal(after[0].trigger, 'stop_loss');
    assert.match(state.lastAnalysis.TEST.text, /^Vendu automatiquement\. Protection contre les pertes/);
    assert.ok((after[0].pnl as number) < 0);
    assert.equal(await repo.getPosition(bot.id, 'TEST'), undefined);

    const s = await computeSummary(repo, (await repo.getBot(bot.id))!);
    assert.equal(s.closedTrades, 1);
    assert.equal(s.winRate, 0);
    assert.ok(Math.abs(s.equity - (10_000 + (after[0].pnl as number))) < 1e-6);
  });

  it('ne passe aucun ordre quand le marché est fermé ou que le bot est en pause', async () => {
    const bot = await createBot({ strategy: 'buy_hold', params: {} });
    const state = await repo.getBotState(bot.id);
    const now = Date.now();
    const bars = barsFromCloses([100, 101, 102], now - 4 * HOUR, HOUR);
    await processSymbol(repo, bot, state, 'TEST', { quote: quote(102, now, false), bars, fx: 1 }, { now, trade: true });
    await processSymbol(repo, bot, state, 'TEST', { quote: quote(102, now), bars, fx: 1 }, { now, trade: false });
    assert.equal((await repo.listTrades(bot.id)).length, 0);
    await processSymbol(repo, bot, state, 'TEST', { quote: quote(102, now), bars, fx: 1 }, { now, trade: true });
    assert.equal((await repo.listTrades(bot.id)).length, 1);
  });

  it('une transaction échouée est annulée entièrement', async () => {
    const bot = await createBot();
    await assert.rejects(
      repo.transaction(async (tx) => {
        await tx.setCash(bot.id, 1);
        throw new Error('panne');
      }),
    );
    assert.equal((await repo.getBot(bot.id))!.cash, 10_000);
  });

  it('le verrou empêche deux analyses simultanées du même bot', async () => {
    const bot = await createBot();
    const now = Date.now();
    assert.equal(await repo.tryLockBot(bot.id, now, 60_000), true);
    assert.equal(await repo.tryLockBot(bot.id, now + 1000, 60_000), false);
    // Une analyse lancée pendant le verrou ne fait rien (et ne lève pas d'erreur).
    await tickBot(repo, bot.id);
    assert.equal((await repo.getBot(bot.id))!.lastTickAt, null);
    await repo.unlockBot(bot.id);
    assert.equal(await repo.tryLockBot(bot.id, now + 2000, 60_000), true);
    // Un verrou expiré peut être repris.
    assert.equal(await repo.tryLockBot(bot.id, now + 120_000, 60_000), true);
    await repo.unlockBot(bot.id);
  });

  it('calcule la référence Buy & Hold à parts égales', async () => {
    const bot = await createBot({ symbols: ['A', 'B'], feePct: 0 });
    const withPrices = { ...bot, startPrices: { A: 100, B: 50 }, startFx: { A: 1, B: 1 } };
    assert.ok(Math.abs((benchmarkValue(withPrices, { A: 110, B: 45 }) as number) - (5000 * 1.1 + 5000 * 0.9)) < 1e-6);
    assert.equal(benchmarkValue(withPrices, { A: 110 }), null);
  });

  it('la référence Buy & Hold paie aussi les frais et subit le change', async () => {
    const bot = await createBot({ symbols: ['AAPL'], broker: 'yuh' });
    const b = { ...bot, startPrices: { AAPL: 200 }, startFx: { AAPL: 0.8 } };
    // Même cours, même taux : il ne reste que les frais d'achat (courtage 0,5 %, change 0,95 %, timbre 0,15 %).
    const flat = benchmarkValue(b, { AAPL: 200 }, { AAPL: 0.8 }, { AAPL: 'USD' }) as number;
    assert.ok(flat < 10_000 && flat > 10_000 * (1 - 0.017), `${flat}`);
    // Le dollar monte de 0,80 à 0,88 CHF : +10 % sur la partie investie.
    const up = benchmarkValue(b, { AAPL: 200 }, { AAPL: 0.88 }, { AAPL: 'USD' }) as number;
    assert.ok(Math.abs(up - (10_000 + (flat - 10_000) + (flat - 10_000 + 10_000) * 0.1)) < 20, `${up}`);
  });

  it('achète une action américaine depuis un compte en CHF, au vrai taux de change et avec les vrais frais', async () => {
    const bot = await createBot({ symbols: ['AAPL'], strategy: 'buy_hold', params: {}, broker: 'swissquote', positionSizePct: 20, allowFractional: false });
    const state = await repo.getBotState(bot.id);
    const now = Date.now();
    const bars = barsFromCloses([190, 195, 200], now - 4 * HOUR, HOUR);
    const usd: Quote = { ...quote(200, now), symbol: 'AAPL', currency: 'USD' };
    await processSymbol(repo, bot, state, 'AAPL', { quote: usd, bars, fx: 0.8 }, { now, trade: true });
    const [t] = await repo.listTrades(bot.id);
    assert.equal(t.currency, 'USD');
    assert.equal(t.fxRate, 0.8);
    // Budget 2 000 CHF : 12 actions × 200 USD × 0,80 = 1 920 CHF ; courtage 10 + change 0,95 % + timbre 0,15 %.
    assert.equal(t.qty, 12);
    const kinds = (t.costs ?? []).map((c) => c.kind).sort();
    assert.deepEqual(kinds, ['commission', 'fx', 'stamp']);
    assert.ok(Math.abs(t.fees - (10 + 1920 * 0.0095 + 1920 * 0.0015)) < 1e-6);
    assert.ok(Math.abs(t.amount - (1920 + t.fees)) < 1e-6);
    assert.ok(t.amount <= 2000);
    // La valeur du portefeuille suit le cours ET le taux de change.
    const pos = (await repo.getPosition(bot.id, 'AAPL'))!;
    assert.equal(pos.lastFx, 0.8);
    const s = await computeSummary(repo, (await repo.getBot(bot.id))!);
    assert.ok(Math.abs(s.positionsValue - 1920) < 1e-6);
  });
});
