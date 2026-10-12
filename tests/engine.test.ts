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
      ...overrides,
    },
    'CHF',
    { TEST: 100 },
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

    await processSymbol(repo, bot, state, 'TEST', { quote: quote(106, now), bars }, { now, trade: true });
    const trades = await repo.listTrades(bot.id);
    assert.equal(trades.length, 1);
    assert.equal(trades[0].side, 'BUY');
    assert.match(trades[0].reason, /La tendance devient haussière/);
    assert.equal(trades[0].qty, 47); // 5000 / (106 × 1.001) = 47.1
    const pos = await repo.getPosition(bot.id, 'TEST');
    assert.ok(pos);
    assert.ok(Math.abs((await repo.getBot(bot.id))!.cash - (10_000 - pos.costBasis)) < 1e-9);

    // La même bougie n'est pas analysée deux fois.
    await processSymbol(repo, bot, state, 'TEST', { quote: quote(106, now + 60_000), bars }, { now: now + 60_000, trade: true });
    assert.equal((await repo.listTrades(bot.id)).length, 1);

    // Le cours chute de plus de 5 % → stop-loss.
    await processSymbol(repo, bot, state, 'TEST', { quote: quote(100, now + 120_000), bars }, { now: now + 120_000, trade: true });
    const after = await repo.listTrades(bot.id);
    assert.equal(after.length, 2);
    assert.equal(after[0].side, 'SELL');
    assert.equal(after[0].trigger, 'stop_loss');
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
    await processSymbol(repo, bot, state, 'TEST', { quote: quote(102, now, false), bars }, { now, trade: true });
    await processSymbol(repo, bot, state, 'TEST', { quote: quote(102, now), bars }, { now, trade: false });
    assert.equal((await repo.listTrades(bot.id)).length, 0);
    await processSymbol(repo, bot, state, 'TEST', { quote: quote(102, now), bars }, { now, trade: true });
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
    const bot = await createBot({ symbols: ['A', 'B'] });
    const withPrices = { ...bot, startPrices: { A: 100, B: 50 } };
    assert.equal(benchmarkValue(withPrices, { A: 110, B: 45 }), 5000 * 1.1 + 5000 * 0.9);
    assert.equal(benchmarkValue(withPrices, { A: 110 }), null);
  });
});
