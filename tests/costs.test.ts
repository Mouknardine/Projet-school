import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { marketOf, orderCosts, type CostInput } from '../server/trading/costs.ts';
import { sizeOrder } from '../server/trading/portfolio.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const base: CostInput = { broker: 'swissquote', side: 'BUY', symbol: 'AAPL', qty: 10, price: 200, quoteCurrency: 'USD', accountCurrency: 'CHF', fxRate: 0.8, feePct: 0 };
const kinds = (c: ReturnType<typeof orderCosts>) => Object.fromEntries(c.lines.map((l) => [l.kind, l.amount]));

describe('frais réels d’un ordre', () => {
  it('reconnaît la bourse à partir du symbole', () => {
    assert.equal(marketOf('AAPL'), 'US');
    assert.equal(marketOf('NESN.SW'), 'CH');
    assert.equal(marketOf('MC.PA'), 'FR');
    assert.equal(marketOf('SAP.DE'), 'EU');
    assert.equal(marketOf('BTC-USD'), 'CRYPTO');
  });

  it('Swissquote, action américaine depuis un compte en CHF : courtage par palier + change 0,95 % + timbre 0,15 %', () => {
    // 10 × 200 USD × 0,80 = 1 600 CHF → palier « jusqu’à 2 000 » = 10 CHF.
    const c = kinds(orderCosts(base));
    near(c.commission, 10);
    near(c.fx, 1600 * 0.0095);
    near(c.stamp, 1600 * 0.0015);
  });

  it('le change va du compte vers l’action à l’achat, et dans l’autre sens à la vente', () => {
    const label = (side: 'BUY' | 'SELL') => orderCosts({ ...base, side }).lines.find((l) => l.kind === 'fx')?.label;
    assert.equal(label('BUY'), 'Change CHF → USD');
    assert.equal(label('SELL'), 'Change USD → CHF');
  });

  it('Yuh, action suisse : 0,5 % de courtage, pas de change, timbre 0,075 %', () => {
    const c = kinds(orderCosts({ ...base, broker: 'yuh', symbol: 'NESN.SW', qty: 20, price: 80, quoteCurrency: 'CHF', fxRate: 1 }));
    near(c.commission, 1600 * 0.005);
    assert.equal(c.fx, undefined);
    near(c.stamp, 1600 * 0.00075);
  });

  it('un fonds irlandais coté à la bourse suisse paie le timbre des titres étrangers', () => {
    const c = kinds(orderCosts({ ...base, broker: 'yuh', symbol: 'VWRL.SW', qty: 10, price: 150, quoteCurrency: 'CHF', fxRate: 1 }));
    near(c.stamp, 1500 * 0.0015);
    const smi = kinds(orderCosts({ ...base, broker: 'yuh', symbol: 'CSSMI.SW', qty: 10, price: 150, quoteCurrency: 'CHF', fxRate: 1 }));
    near(smi.stamp, 1500 * 0.00075);
  });

  it('Yuh applique un courtage minimum de 1 CHF', () => {
    const c = kinds(orderCosts({ ...base, broker: 'yuh', symbol: 'NESN.SW', qty: 1, price: 80, quoteCurrency: 'CHF', fxRate: 1 }));
    near(c.commission, 1);
  });

  it('Interactive Brokers : 1 USD minimum, change minimum 2 USD, pas de droit de timbre suisse', () => {
    const c = kinds(orderCosts({ ...base, broker: 'ibkr' }));
    near(c.commission, 1 * 0.8);
    near(c.fx, 2 * 0.8);
    assert.equal(c.stamp, undefined);
  });

  it('taxe française (TTF) de 0,4 % à l’achat d’une société française, pas pour Airbus (néerlandaise)', () => {
    const lvmh = kinds(orderCosts({ ...base, symbol: 'MC.PA', qty: 2, price: 600, quoteCurrency: 'EUR', fxRate: 0.95 }));
    near(lvmh.ftt, 1140 * 0.004);
    near(lvmh.commission, 10); // Swissquote, Euronext : 10 CHF minimum
    const airbus = kinds(orderCosts({ ...base, symbol: 'AIR.PA', qty: 2, price: 600, quoteCurrency: 'EUR', fxRate: 0.95 }));
    assert.equal(airbus.ftt, undefined);
    const sale = kinds(orderCosts({ ...base, side: 'SELL', symbol: 'MC.PA', qty: 2, price: 600, quoteCurrency: 'EUR', fxRate: 0.95 }));
    assert.equal(sale.ftt, undefined);
  });

  it('frais américains (SEC + FINRA) seulement à la vente, FINRA suspendu fin 2026', () => {
    const june = kinds(orderCosts({ ...base, side: 'SELL', time: Date.UTC(2026, 5, 1) }));
    near(june.us_fees, (2000 * 20.6e-6 + 10 * 0.000195) * 0.8);
    const november = kinds(orderCosts({ ...base, side: 'SELL', time: Date.UTC(2026, 10, 1) }));
    near(november.us_fees, 2000 * 20.6e-6 * 0.8);
    assert.equal(kinds(orderCosts(base)).us_fees, undefined);
  });

  it('cryptomonnaies : pourcentage du courtier, sans droit de timbre', () => {
    const c = orderCosts({ ...base, broker: 'yuh', symbol: 'BTC-USD', qty: 0.01, price: 80_000 });
    assert.deepEqual(
      c.lines.map((l) => l.kind),
      ['commission'],
    );
    near(c.total, 0.01 * 80_000 * 0.8 * 0.01);
  });

  it('le courtier « simple » garde un pourcentage fixe, sans taxe', () => {
    const c = orderCosts({ ...base, broker: 'simple', feePct: 0.1 });
    near(c.total, 1600 * 0.001);
    assert.equal(c.lines.length, 1);
  });

  it('la taille d’un ordre ne dépasse jamais le budget, frais par paliers compris', () => {
    const order = sizeOrder({
      budget: 2000,
      unitCost: 160,
      fractional: false,
      costOf: (q) => orderCosts({ ...base, qty: q }).total,
    });
    assert.ok(order);
    assert.ok(order.total <= 2000);
    // Une action de plus dépasserait le budget.
    const next = (order.qty + 1) * 160 + orderCosts({ ...base, qty: order.qty + 1 }).total;
    assert.ok(next > 2000);
  });
});
