import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeSell, sizeBuy, stopLossPrice, takeProfitPrice } from '../server/trading/portfolio.ts';
import { closedTradeStats, maxDrawdownPct } from '../server/trading/stats.ts';
import { approx } from './helpers.ts';

describe('calcul des ordres', () => {
  it('achète des actions entières avec 20 % du portefeuille, frais compris', () => {
    const o = sizeBuy({ cash: 10_000, equity: 10_000, price: 150, positionSizePct: 20, feePct: 0.1, allowFractional: false });
    assert.ok(o);
    assert.equal(o.qty, 13); // 2000 / (150 × 1.001) = 13.32 → 13 actions
    assert.ok(approx(o.fees, 13 * 150 * 0.001));
    assert.ok(o.total <= 2000);
  });

  it('autorise les fractions d’actions si demandé', () => {
    const o = sizeBuy({ cash: 1000, equity: 1000, price: 400, positionSizePct: 50, feePct: 0, allowFractional: true });
    assert.ok(o);
    assert.equal(o.qty, 1.25);
  });

  it('ne dépasse jamais le cash disponible', () => {
    const o = sizeBuy({ cash: 500, equity: 10_000, price: 100, positionSizePct: 50, feePct: 0, allowFractional: false });
    assert.ok(o);
    assert.equal(o.qty, 5);
  });

  it('refuse l’achat si le budget ne permet pas une action entière', () => {
    assert.equal(sizeBuy({ cash: 100, equity: 100, price: 250, positionSizePct: 100, feePct: 0, allowFractional: false }), null);
  });

  it('calcule le résultat d’une vente, frais d’achat et de vente inclus', () => {
    // Achat : 10 × 100 + 1 de frais = 1001 ; vente : 10 × 110 − 1.1 de frais = 1098.9
    const r = computeSell(10, 110, 1001, 0.1);
    assert.ok(approx(r.proceeds, 1098.9));
    assert.ok(approx(r.pnl, 97.9));
    assert.ok(approx(r.pnlPct, (97.9 / 1001) * 100));
  });

  it('niveaux de stop-loss et take-profit', () => {
    assert.ok(approx(stopLossPrice(200, 5) as number, 190));
    assert.ok(approx(takeProfitPrice(200, 10) as number, 220));
    assert.equal(stopLossPrice(200, 0), null);
  });
});

describe('statistiques', () => {
  it('drawdown maximal', () => {
    assert.equal(maxDrawdownPct([100, 120, 90, 130, 117]), 25);
    assert.equal(maxDrawdownPct([100, 101, 102]), 0);
  });

  it('taux de réussite et profit factor', () => {
    const s = closedTradeStats([
      { pnl: 100, pnlPct: 10 },
      { pnl: -50, pnlPct: -5 },
      { pnl: 50, pnlPct: 5 },
      { pnl: null, pnlPct: null },
    ]);
    assert.equal(s.closedTrades, 3);
    assert.ok(approx(s.winRate as number, 200 / 3));
    assert.equal(s.profitFactor, 3);
    assert.equal(s.avgWinPct, 7.5);
  });
});
