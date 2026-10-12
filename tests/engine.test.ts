import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Bar, Quote } from '../shared/types.ts';
import { barsFromCloses } from './helpers.ts';

// Base de données en mémoire pour les tests (chargée après avoir défini la variable d'environnement).
process.env.DB_PATH = ':memory:';
let repo: typeof import('../server/db.ts');
let engine: typeof import('../server/trading/engine.ts');
let summary: typeof import('../server/trading/summary.ts');

before(async () => {
  repo = await import('../server/db.ts');
  engine = await import('../server/trading/engine.ts');
  summary = await import('../server/trading/summary.ts');
});

const HOUR = 3_600_000;

function quote(price: number, now: number, marketOpen = true): Quote {
  return { symbol: 'TEST', name: 'Test SA', currency: 'CHF', exchange: 'SIX', price, priceTime: now, previousClose: null, marketOpen };
}

function createBot(overrides: Record<string, unknown> = {}) {
  const id = repo.insertBot(
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
  return repo.getBot(id)!;
}

describe('moteur du bot en direct', () => {
  it('achète sur un croisement haussier, puis applique le stop-loss', () => {
    const bot = createBot();
    const state = repo.getBotState(bot.id);
    // Baisse puis forte hausse → la moyenne courte croise la longue vers le haut sur la dernière bougie.
    const closes = [110, 108, 106, 104, 102, 100, 98, 97, 96, 100, 106];
    const start = Date.now() - (closes.length + 1) * HOUR;
    const bars: Bar[] = barsFromCloses(closes, start, HOUR);
    const now = start + (closes.length + 0.5) * HOUR;

    engine.processSymbol(bot, state, 'TEST', { quote: quote(106, now), bars }, { now, trade: true });
    const trades = repo.listTrades(bot.id);
    assert.equal(trades.length, 1);
    assert.equal(trades[0].side, 'BUY');
    assert.match(trades[0].reason, /Croisement haussier/);
    assert.equal(trades[0].qty, 47); // 5000 / (106 × 1.001) = 47.1
    const pos = repo.getPosition(bot.id, 'TEST');
    assert.ok(pos);
    assert.ok(Math.abs(repo.getBot(bot.id)!.cash - (10_000 - pos.costBasis)) < 1e-9);

    // La même bougie n'est pas analysée deux fois.
    engine.processSymbol(bot, state, 'TEST', { quote: quote(106, now + 60_000), bars }, { now: now + 60_000, trade: true });
    assert.equal(repo.listTrades(bot.id).length, 1);

    // Le cours chute de plus de 5 % → stop-loss.
    engine.processSymbol(bot, state, 'TEST', { quote: quote(100, now + 120_000), bars }, { now: now + 120_000, trade: true });
    const after = repo.listTrades(bot.id);
    assert.equal(after.length, 2);
    assert.equal(after[0].side, 'SELL');
    assert.equal(after[0].trigger, 'stop_loss');
    assert.ok((after[0].pnl as number) < 0);
    assert.equal(repo.getPosition(bot.id, 'TEST'), undefined);

    const s = summary.computeSummary(repo.getBot(bot.id)!);
    assert.equal(s.closedTrades, 1);
    assert.equal(s.winRate, 0);
    assert.ok(Math.abs(s.equity - (10_000 + (after[0].pnl as number))) < 1e-6);
  });

  it('ne passe aucun ordre quand le marché est fermé ou que le bot est en pause', () => {
    const bot = createBot({ strategy: 'buy_hold', params: {} });
    const state = repo.getBotState(bot.id);
    const now = Date.now();
    const bars = barsFromCloses([100, 101, 102], now - 4 * HOUR, HOUR);
    engine.processSymbol(bot, state, 'TEST', { quote: quote(102, now, false), bars }, { now, trade: true });
    engine.processSymbol(bot, state, 'TEST', { quote: quote(102, now), bars }, { now, trade: false });
    assert.equal(repo.listTrades(bot.id).length, 0);
    engine.processSymbol(bot, state, 'TEST', { quote: quote(102, now), bars }, { now, trade: true });
    assert.equal(repo.listTrades(bot.id).length, 1);
  });

  it('calcule la référence Buy & Hold à parts égales', () => {
    const bot = createBot({ symbols: ['A', 'B'] });
    const withPrices = { ...bot, startPrices: { A: 100, B: 50 } };
    assert.equal(engine.benchmarkValue(withPrices, { A: 110, B: 45 }), 5000 * 1.1 + 5000 * 0.9);
    assert.equal(engine.benchmarkValue(withPrices, { A: 110 }), null);
  });
});
