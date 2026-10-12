import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BotConfig } from '../shared/types.ts';
import { BacktestError, runBacktest } from '../server/trading/backtest.ts';
import { normalizeParams } from '../server/trading/strategies.ts';
import { approx, barsFromCloses } from './helpers.ts';

const base: Omit<BotConfig, 'name'> = {
  currency: 'USD',
  broker: 'simple',
  initialCapital: 10_000,
  symbols: ['TEST'],
  strategy: 'sma_cross',
  params: normalizeParams('sma_cross', { fast: 3, slow: 6 }),
  interval: '1d',
  positionSizePct: 100,
  stopLossPct: 0,
  takeProfitPct: 0,
  feePct: 0,
  allowFractional: true,
};

// Une sinusoïde : alternance de hausses et de baisses → plusieurs croisements de moyennes.
const wave = Array.from({ length: 120 }, (_, i) => 100 + 20 * Math.sin(i / 6));

describe('backtest', () => {
  it('Buy & Hold sans frais suit exactement la référence', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i);
    const r = runBacktest({ ...base, strategy: 'buy_hold', params: {} }, { TEST: barsFromCloses(closes) });
    assert.equal(r.trades.length, 1);
    const last = r.equity[r.equity.length - 1];
    assert.ok(approx(last.equity, last.benchmark as number, 1e-6));
    assert.ok(approx(r.stats.totalReturnPct, (149 / 100 - 1) * 100, 1e-6));
  });

  it('les ordres sont exécutés à l’ouverture de la bougie suivant le signal', () => {
    const bars = barsFromCloses(wave);
    const r = runBacktest(base, { TEST: bars });
    assert.ok(r.trades.length >= 4, `seulement ${r.trades.length} trades`);
    for (const t of r.trades) {
      const bar = bars.find((b) => b.time === t.time);
      assert.ok(bar, 'le trade doit correspondre à une bougie');
      assert.equal(t.price, bar.open);
    }
    // Achats et ventes alternent.
    r.trades.forEach((t, i) => assert.equal(t.side, i % 2 === 0 ? 'BUY' : 'SELL'));
  });

  it('la comptabilité est cohérente : valeur finale = cash + positions', () => {
    const bars = barsFromCloses(wave);
    const r = runBacktest({ ...base, feePct: 0.5, positionSizePct: 50, allowFractional: false }, { TEST: bars });
    const lastTrade = r.trades[r.trades.length - 1];
    const positionsValue = r.openPositions.reduce((a, p) => a + p.qty * p.lastPrice, 0);
    assert.ok(approx(r.stats.finalEquity, lastTrade.cashAfter + positionsValue, 1e-6));
    const realized = r.trades.reduce((a, t) => a + (t.pnl ?? 0), 0);
    if (r.openPositions.length === 0) assert.ok(approx(r.stats.finalEquity, base.initialCapital + realized, 1e-6));
    assert.ok(r.stats.feesPaid > 0);
  });

  it('le stop-loss coupe la perte au niveau prévu', () => {
    const closes = [...Array.from({ length: 10 }, () => 100), 100, 99, 98, 80, 70];
    const r = runBacktest({ ...base, strategy: 'buy_hold', params: {}, stopLossPct: 10 }, { TEST: barsFromCloses(closes) });
    const exit = r.trades.find((t) => t.side === 'SELL');
    assert.ok(exit);
    assert.equal(exit.trigger, 'stop_loss');
    assert.ok(approx(exit.price, 90)); // 100 × (1 − 10 %)
    assert.ok(r.stats.totalReturnPct > -10.01);
  });

  it('refuse un historique trop court', () => {
    assert.throws(() => runBacktest(base, { TEST: barsFromCloses([1, 2, 3]) }), BacktestError);
  });

  it('gère plusieurs actions avec un cash partagé', () => {
    const a = barsFromCloses(wave);
    const b = barsFromCloses(wave.map((v) => v * 2 + 5));
    const r = runBacktest({ ...base, symbols: ['A', 'B'], positionSizePct: 50 }, { A: a, B: b });
    assert.ok(r.trades.some((t) => t.symbol === 'A'));
    assert.ok(r.trades.some((t) => t.symbol === 'B'));
    assert.ok(r.trades.every((t) => t.cashAfter >= -1e-9));
  });
});
