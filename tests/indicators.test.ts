import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bollinger, crossedAbove, crossedBelow, ema, macd, rsi, sma } from '../server/trading/indicators.ts';
import { approx } from './helpers.ts';

describe('indicateurs', () => {
  it('moyenne mobile simple', () => {
    assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  });

  it('moyenne mobile exponentielle (initialisée par la moyenne simple)', () => {
    // α = 2 / (3 + 1) = 0.5
    assert.deepEqual(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
    const e = ema([10, 10, 10, 20], 3);
    assert.equal(e[3], 15);
  });

  it('RSI : 100 si le prix ne fait que monter, 0 s’il ne fait que baisser, 50 s’il est constant', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const down = Array.from({ length: 30 }, (_, i) => 100 - i);
    const flat = Array.from({ length: 30 }, () => 100);
    assert.equal(rsi(up, 14)[29], 100);
    assert.equal(rsi(down, 14)[29], 0);
    assert.equal(rsi(flat, 14)[29], 50);
    assert.equal(rsi(up, 14)[13], null);
  });

  it('RSI : valeur de référence (moyennes de Wilder)', () => {
    // Hausses de +2 et baisses de −1 en alternance : moyenne des hausses = 1, des baisses = 0.5 → RS = 2 → RSI = 66.67
    const values = [100];
    for (let i = 0; i < 40; i++) values.push(values[values.length - 1] + (i % 2 === 0 ? 2 : -1));
    const r = rsi(values, 14)[40] as number;
    assert.ok(Math.abs(r - 66.67) < 1.5, `RSI = ${r}`);
  });

  it('bandes de Bollinger sur un prix constant : les trois bandes sont confondues', () => {
    const b = bollinger([5, 5, 5, 5, 5], 3, 2);
    assert.deepEqual(b.middle.slice(2), [5, 5, 5]);
    assert.deepEqual(b.upper.slice(2), [5, 5, 5]);
    assert.deepEqual(b.lower.slice(2), [5, 5, 5]);
  });

  it('bandes de Bollinger : ± k écarts-types', () => {
    const b = bollinger([1, 2, 3], 3, 2);
    const sd = Math.sqrt(2 / 3);
    assert.ok(approx(b.upper[2] as number, 2 + 2 * sd));
    assert.ok(approx(b.lower[2] as number, 2 - 2 * sd));
  });

  it('MACD : histogramme = MACD − signal', () => {
    const values = Array.from({ length: 80 }, (_, i) => 100 + 10 * Math.sin(i / 5));
    const m = macd(values, 12, 26, 9);
    for (let i = 0; i < values.length; i++) {
      if (m.histogram[i] === null) continue;
      assert.ok(approx(m.histogram[i] as number, (m.macd[i] as number) - (m.signal[i] as number)));
    }
    assert.equal(m.signal[26 + 9 - 3], null);
    assert.notEqual(m.signal[26 + 9 - 2], null);
  });

  it('croisements', () => {
    const a = [1, 2, 3];
    const b = [2, 2, 2];
    assert.equal(crossedAbove(a, b, 1), false);
    assert.equal(crossedAbove(a, b, 2), true);
    assert.equal(crossedBelow([3, 1], [2, 2], 1), true);
    assert.equal(crossedAbove([null, 3], [2, 2], 1), false);
  });
});
