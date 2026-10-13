import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Interval } from '../shared/types.ts';
import { exitReason, normalizeParams, spanLabel, STRATEGY_IDS, getStrategy } from '../server/trading/strategies.ts';
import { barsFromCloses } from './helpers.ts';

describe('explications des décisions', () => {
  it('traduit un nombre de bougies en durée de bourse', () => {
    assert.equal(spanLabel(20, '1d'), '20 jours de bourse');
    assert.equal(spanLabel(1, '1d'), '1 jour de bourse');
    assert.equal(spanLabel(20, '15m'), '5 h de bourse');
    assert.equal(spanLabel(50, '15m'), '12 h 30 de bourse');
    assert.equal(spanLabel(9, '5m'), '45 min de bourse');
    assert.equal(spanLabel(14, '1h'), '14 h de bourse');
  });

  it('explique un stop-loss et un take-profit avec la variation par rapport au prix d’achat', () => {
    const sl = exitReason('stop_loss', 98, 100, 2);
    assert.match(sl, /stop-loss/);
    assert.match(sl, /−2\.00 %/);
    assert.match(sl, /limite était fixée à −2 %/);
    const tp = exitReason('take_profit', 104.5, 100, 4);
    assert.match(tp, /\+4\.50 %/);
    assert.match(tp, /objectif était fixé à \+4 %/);
  });

  it('chaque stratégie produit des phrases complètes, sans valeur manquante', () => {
    // Un cours qui monte, chute puis remonte : de quoi déclencher achats, ventes et attentes.
    const closes = Array.from({ length: 160 }, (_, i) => 100 + 15 * Math.sin(i / 9) + (i % 7) - 3);
    const bars = barsFromCloses(closes);
    for (const interval of ['5m', '1d'] as Interval[]) {
      for (const id of STRATEGY_IDS) {
        const strategy = getStrategy(id);
        const p = normalizeParams(id, id === 'sma_cross' || id === 'score' ? { fast: 5, slow: 15 } : {});
        const series = strategy.compute(bars, p);
        const seen = new Set<string>();
        for (let i = strategy.warmup(p); i < bars.length; i++) {
          for (const hasPosition of [false, true]) {
            const sig = strategy.signal({ bars, series, i, hasPosition, everHeld: hasPosition, p, interval });
            assert.doesNotMatch(sig.reason, /undefined|NaN|null|–\)/, `${id} : ${sig.reason}`);
            assert.doesNotMatch(sig.reason, /\b(de|à) le\b/, `${id} : faute de français (« de le » → « du ») : ${sig.reason}`);
            assert.ok(sig.reason.length > 20, `${id} : explication trop courte`);
            if (sig.action !== 'HOLD' && id !== 'buy_hold') {
              assert.ok(sig.fact && sig.reason.startsWith(sig.fact), `${id} : l'observation doit précéder la décision`);
              assert.doesNotMatch(sig.fact, /Le bot (achète|vend)/, `${id} : l'observation ne doit pas contenir la décision`);
            }
            seen.add(sig.action);
          }
        }
        if (id !== 'buy_hold') assert.ok(seen.has('BUY') && seen.has('SELL'), `${id} devrait acheter et vendre sur ce cours : ${[...seen]}`);
      }
    }
  });
});

describe('stratégie « Suivre la tendance »', () => {
  const strategy = getStrategy('trend');
  const p = normalizeParams('trend', { period: 5, band: 1 });
  const at = (closes: number[], hasPosition: boolean) => {
    const bars = barsFromCloses(closes);
    return strategy.signal({ bars, series: strategy.compute(bars, p), i: bars.length - 1, hasPosition, everHeld: hasPosition, p, interval: '1d' });
  };

  it('achète dès que le prix est au-dessus de sa moyenne, sans attendre un croisement', () => {
    const s = at([100, 101, 102, 103, 104, 105, 106], false);
    assert.equal(s.action, 'BUY');
    assert.match(s.reason, /au-dessus de son prix moyen sur 5 jours de bourse/);
  });

  it('garde l’action tant que la tendance monte, puis la vend quand le prix passe nettement sous sa moyenne', () => {
    assert.equal(at([100, 101, 102, 103, 104, 105, 106], true).action, 'HOLD');
    // Juste sous la moyenne (102), mais pas de plus de 1 % : on garde, pour éviter un aller-retour coûteux.
    const hesitates = at([102, 102, 102, 102, 102, 102, 101.5], true);
    assert.equal(hesitates.action, 'HOLD');
    assert.match(hesitates.reason, /sans dépasser la marge de 1 %/);
    const sell = at([106, 105, 104, 103, 102, 101, 100], true);
    assert.equal(sell.action, 'SELL');
    assert.match(sell.reason, /mettre l'argent à l'abri/);
    assert.equal(at([106, 105, 104, 103, 102, 101, 100], false).action, 'HOLD');
  });
});
