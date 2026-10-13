import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bandOf, candidatePool, computeProfile, configFromProfile, pickAssets, PROFILES, QUESTIONS, type Answers, type MeasuredAsset } from '../shared/profile.ts';
import { measureRisk } from '../server/market/risk.ts';
import { getStrategy, normalizeParams } from '../server/trading/strategies.ts';
import { barsFromCloses } from './helpers.ts';

const prudent: Answers = {
  horizon: 'gt10',
  share: 'small',
  reserve: 'yes',
  goal: 'protect',
  drop: 'sell_all',
  choice: 'a',
  maxloss: '5',
  experience: 'regular',
  quiz_stock: 'share',
  quiz_diversify: 'less_risk',
};
const bold: Answers = { ...prudent, goal: 'max', drop: 'buy_more', choice: 'd', maxloss: '35' };

describe('profil d’investisseur', () => {
  it('chaque question a des réponses uniques', () => {
    for (const q of QUESTIONS) assert.equal(new Set(q.options.map((o) => o.id)).size, q.options.length, q.id);
  });

  it('une personne qui ne veut rien perdre est « Très prudent », avec une limite de perte de 5 %', () => {
    const r = computeProfile(prudent);
    assert.equal(r.level, 1);
    assert.equal(r.maxLossPct, 5);
  });

  it('une personne audacieuse, expérimentée et sans contrainte est « Audacieux »', () => {
    const r = computeProfile(bold);
    assert.equal(r.level, 5);
    assert.equal(r.maxLossPct, 35);
    assert.deepEqual(r.limitedBy, []);
  });

  it('la situation limite le profil : argent nécessaire dans moins d’un an → très prudent, avec l’explication', () => {
    const r = computeProfile({ ...bold, horizon: 'lt1' });
    assert.equal(r.tolerance, 5);
    assert.equal(r.level, 1);
    assert.ok(r.limitedBy.some((t) => /besoin de cet argent/.test(t)));
    assert.ok(r.warnings.some((t) => /situation ne le permet pas/.test(t)));
  });

  it('un débutant ne dépasse pas le profil « Équilibré »', () => {
    const r = computeProfile({ ...bold, experience: 'never', quiz_stock: 'loan', quiz_diversify: 'less_risk' });
    assert.equal(r.knowledgeCap, 3);
    assert.equal(r.level, 3);
    assert.ok(r.limitedBy.some((t) => /débutez/.test(t)));
  });

  it('signale des réponses contradictoires', () => {
    const r = computeProfile({ ...bold, drop: 'sell_all' });
    assert.ok(r.warnings.some((t) => /gagner le plus possible/.test(t)));
  });

  it('la limite de perte ne dépasse jamais celle du profil', () => {
    const r = computeProfile({ ...bold, choice: 'b', goal: 'savings', drop: 'sell_part' });
    assert.ok(r.maxLossPct <= PROFILES[r.level].maxLossPct);
  });

  it('les réglages de chaque profil sont valides', () => {
    for (const p of Object.values(PROFILES)) {
      const s = getStrategy(p.strategy);
      assert.deepEqual(normalizeParams(p.strategy, p.params), p.params, `${p.name} : paramètres hors limites`);
      assert.equal(s.validate?.(p.params) ?? null, null);
    }
  });
});

describe('choix des actions selon le risque mesuré', () => {
  it('mesure la volatilité annuelle d’un cours', () => {
    // Un cours qui alterne +1 % / −1 % chaque jour : volatilité ≈ 1 % × √252 ≈ 15,9 %.
    const closes = Array.from({ length: 253 }, (_, i) => 100 * (i % 2 ? 1.01 : 1));
    const r = measureRisk(barsFromCloses(closes, Date.UTC(2025, 0, 1), (365 / 252) * 86_400_000))!;
    assert.ok(Math.abs(r.volatility - 15.9) < 0.3, `${r.volatility}`);
    assert.equal(measureRisk(barsFromCloses([1, 2, 3])), null);
  });

  const m = (symbol: string, volatility: number, perf1y = 10): MeasuredAsset => ({ symbol, name: symbol, currency: 'CHF', price: 100, volatility, perf1y });
  const universe = [
    m('CSBGC3.SW', 2, 1),
    m('CHCORP.SW', 4, 3),
    m('ZGLD.SW', 16, 30),
    m('NESN.SW', 17, -5),
    m('SCMN.SW', 13, 12),
    m('NOVN.SW', 18, 8),
    m('UBSG.SW', 32, 20),
    m('LOGN.SW', 36, 15),
    m('NVDA', 52, 80),
    m('TSLA', 60, 30),
    m('AAPL', 27, 12),
    m('MSFT', 24, 18),
  ];

  it('un profil très prudent reçoit des placements très calmes et calmes', () => {
    const picked = pickAssets(1, universe);
    assert.equal(picked.length, PROFILES[1].slots.length);
    assert.ok(picked.every((p) => p.band === 'very_calm' || p.band === 'calm'), picked.map((p) => p.symbol).join());
    assert.ok(picked.some((p) => p.symbol === 'CSBGC3.SW'));
  });

  it('un profil audacieux reçoit des actions agitées', () => {
    const picked = pickAssets(5, universe);
    assert.ok(picked.some((p) => p.symbol === 'NVDA'));
    assert.ok(!picked.some((p) => p.symbol === 'CSBGC3.SW'));
  });

  it('dans une même tranche, le meilleur rapport gain / risque passe en premier', () => {
    // Calme : Swisscom (12 / 13) bat Nestlé (−5 / 17) et Novartis (8 / 18).
    const picked = pickAssets(2, universe);
    const calm = picked.filter((p) => p.band === 'calm').map((p) => p.symbol);
    assert.equal(calm[0], 'ZGLD.SW'); // l'or : 30 / 16
    assert.ok(calm.includes('SCMN.SW'));
  });

  it('les entreprises choisies par la personne passent en premier, avec un avertissement si elles sont trop risquées', () => {
    const picked = pickAssets(1, universe, ['TSLA']);
    assert.equal(picked[0].symbol, 'TSLA');
    assert.equal(picked[0].favorite, true);
    assert.equal(picked[0].tooRisky, true);
    assert.equal(picked.length, PROFILES[1].slots.length);
  });

  it('la liste suisse ne contient que des placements suisses, et les cryptos seulement si acceptées', () => {
    assert.ok(candidatePool('ch', false).every((x) => x.region === 'CH'));
    assert.ok(!candidatePool('any', false).some((x) => x.kind === 'crypto'));
    assert.ok(candidatePool('any', true).some((x) => x.kind === 'crypto'));
    assert.equal(bandOf(5), 'very_calm');
    assert.equal(bandOf(50), 'very_agitated');
  });

  it('les réglages du bot répartissent l’argent investi entre les placements', () => {
    const result = computeProfile(prudent);
    const cfg = configFromProfile({ result, answers: prudent, symbols: ['A', 'B', 'C', 'D'], volatility: {}, capital: 10_000, currency: 'CHF', broker: 'unknown' });
    assert.equal(cfg.strategy, 'buy_hold');
    assert.equal(cfg.positionSizePct, 15); // 60 % investis au maximum, répartis sur 4 placements
    assert.equal(cfg.broker, 'yuh');
    assert.equal(cfg.maxLossPct, 5);
    assert.equal(cfg.profile?.level, 1);
  });
});
