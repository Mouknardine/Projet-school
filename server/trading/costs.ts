// Coûts réels d'un ordre de bourse pour un investisseur suisse : courtage (barème de chaque courtier),
// frais de change, droit de timbre fédéral, taxe française sur les transactions financières (TTF),
// droit de timbre britannique (SDRT) et frais réglementaires américains (SEC, FINRA).
//
// Sources (relevées le 12.10.2026) :
// - Droit de timbre : AFC/ESTV, « Umsatzabgabe » (état 01.01.2026) — 1,5 ‰ titres suisses, 3 ‰ étrangers,
//   moitié due par chaque partie → 0,075 % / 0,15 % pour le client, à l'achat ET à la vente, seulement chez un négociant suisse.
//   Les cryptomonnaies (BTC, ETH…) ne sont pas des titres : pas de droit de timbre.
// - TTF : art. 235 ter ZD CGI, 0,4 % depuis le 01.04.2025, sur les achats d'actions de sociétés françaises de plus d'1 Md€.
// - SDRT : gov.uk, 0,5 % sur les achats d'actions britanniques.
// - SEC Section 31 : 20,60 USD par million de ventes depuis le 04.04.2026 ; FINRA TAF : 0,000195 USD/action (max 9,79 USD),
//   suspendu (0 USD) du 01.10.2026 au 31.12.2026.
// - Barèmes des courtiers : pages tarifaires officielles de Swissquote, PostFinance, Yuh et Interactive Brokers.

import type { BrokerId, BrokerInfo, CostLine, Side } from '../../shared/types.ts';

/** Bourse d'une action, déduite de son symbole Yahoo Finance. */
export type Market = 'CH' | 'US' | 'FR' | 'EU' | 'UK' | 'CRYPTO' | 'OTHER';

export function marketOf(symbol: string): Market {
  const s = symbol.toUpperCase();
  if (/-(USD|EUR|CHF|GBP|USDT)$/.test(s)) return 'CRYPTO';
  if (s.endsWith('.SW')) return 'CH';
  if (s.endsWith('.PA')) return 'FR';
  if (s.endsWith('.L')) return 'UK';
  if (/\.(DE|F|AS|BR|MI|MC|LS|VI|HE|ST|CO|OL|IR)$/.test(s)) return 'EU';
  if (!s.includes('.')) return 'US';
  return 'OTHER';
}

/**
 * Sociétés cotées à Paris mais dont le siège n'est pas en France : elles ne paient pas la TTF.
 * (Simplification : on applique la TTF à toutes les autres actions de Paris, sans vérifier le seuil d'1 Md€.)
 */
const NOT_FRENCH_ON_PARIS = new Set(['AIR.PA', 'STLAP.PA', 'STMPA.PA', 'MT.PA', 'ERF.PA']);

const STAMP_CH = 0.075;
const STAMP_FOREIGN = 0.15;
const FTT_FR = 0.4;
const SDRT_UK = 0.5;
const SEC_RATE = 20.6 / 1_000_000;
const FINRA_TAF_PER_SHARE = 0.000195;
const FINRA_TAF_MAX = 9.79;
const FINRA_TAF_PAUSE = { from: Date.UTC(2026, 9, 1), to: Date.UTC(2027, 0, 1) };

/** Montant de frais exprimé dans une devise donnée (avant conversion dans la devise du compte). */
interface Fee {
  amount: number;
  /** 'quote' = devise de l'action, 'account' = devise du compte. */
  in: 'quote' | 'account';
  detail: string;
}

interface BrokerModel extends BrokerInfo {
  /** Courtage d'un ordre : `value` est le montant de l'ordre dans la devise de l'action, `valueAccount` dans celle du compte. */
  commission(market: Market, value: number, valueAccount: number, qty: number): Fee;
  /** Frais de change en % du montant converti (actions cotées dans une autre devise que le compte). */
  fxPct: number;
  /** Frais de change minimum (dans la devise du compte), le cas échéant. */
  fxMin?: number;
}

/** Barème par paliers : le premier palier dont la borne dépasse le montant s'applique. */
function tier(value: number, table: [number, number][]): number {
  for (const [max, fee] of table) if (value <= max) return fee;
  return table[table.length - 1][1];
}

const fmt = (n: number) => n.toFixed(2);

const SWISSQUOTE_TIERS: [number, number][] = [
  [500, 3],
  [1000, 5],
  [2000, 10],
  [10000, 29],
  [15000, 49],
  [25000, 79],
  [50000, 129],
  [Infinity, 190],
];
const SWISSQUOTE_EURONEXT: [number, number][] = [[2000, 10], ...SWISSQUOTE_TIERS.slice(3)];

const POSTFINANCE_SIX: [number, number][] = [
  [500, 6],
  [1000, 12],
  [5000, 20],
  [10000, 30],
  [15000, 40],
  [20000, 60],
  [30000, 80],
  [50000, 105],
  [100000, 160],
  [150000, 240],
  [Infinity, 300],
];
const POSTFINANCE_ABROAD: [number, number][] = [
  [500, 15],
  [1000, 20],
  [5000, 30],
  [10000, 35],
  [15000, 40],
  [20000, 60],
  [30000, 80],
  [50000, 105],
  [100000, 160],
  [150000, 240],
  [Infinity, 300],
];

const CRYPTO_PCT: Record<Exclude<BrokerId, 'simple'>, number> = { swissquote: 1, postfinance: 0.95, yuh: 1, ibkr: 0.18 };

const BROKERS: Record<Exclude<BrokerId, 'simple'>, BrokerModel> = {
  swissquote: {
    id: 'swissquote',
    name: 'Swissquote',
    kind: 'Banque en ligne suisse',
    description: 'La plus grande banque en ligne de Suisse. Courtage fixe par paliers selon le montant de l’ordre.',
    fees: [
      'Courtage par paliers : 3 CHF jusqu’à 500 CHF, 5 CHF jusqu’à 1 000, 10 CHF jusqu’à 2 000, 29 CHF jusqu’à 10 000, 49 CHF jusqu’à 15 000… (Paris : 10 CHF minimum)',
      'Change : 0,95 % du montant converti',
      'Droit de timbre suisse : 0,075 % (actions suisses) ou 0,15 % (étrangères), à l’achat et à la vente',
      'Cryptos : 1 % par ordre, sans droit de timbre',
    ],
    fractional: true,
    swiss: true,
    source: 'https://www.swissquote.com/fr-ch/private/trade/pricing/securities/stocks',
    fxPct: 0.95,
    commission(market, _value, valueAccount) {
      const table = market === 'FR' || market === 'EU' ? SWISSQUOTE_EURONEXT : SWISSQUOTE_TIERS;
      const fee = tier(valueAccount, table);
      return { amount: fee, in: 'account', detail: `barème Swissquote pour un ordre de ${fmt(valueAccount)}` };
    },
  },
  postfinance: {
    id: 'postfinance',
    name: 'PostFinance',
    kind: 'Banque suisse (e-trading)',
    description: 'Le service de bourse en ligne de PostFinance. Courtage par paliers, plus cher pour les bourses étrangères.',
    fees: [
      'Courtage bourse suisse : 6 CHF jusqu’à 500 CHF, 12 CHF jusqu’à 1 000, 20 CHF jusqu’à 5 000, 30 CHF jusqu’à 10 000…',
      'Courtage bourses étrangères (USA, Paris) : 15 jusqu’à 500, 20 jusqu’à 1 000, 30 jusqu’à 5 000, 35 jusqu’à 10 000… (en USD ou EUR)',
      'Change : environ 1,2 % (estimation, non publiée clairement)',
      'Droit de timbre suisse : 0,075 % / 0,15 %, à l’achat et à la vente',
      'Cryptos : 0,95 % par ordre',
    ],
    fractional: true,
    swiss: true,
    source: 'https://www.postfinance.ch/fr/particuliers/placer/solutions/negoce-en-ligne/e-trading/courtages-et-autres-frais.html',
    fxPct: 1.2,
    commission(market, value) {
      if (market === 'CH') return { amount: tier(value, POSTFINANCE_SIX), in: 'quote', detail: `barème PostFinance (bourse suisse) pour ${fmt(value)} CHF` };
      return { amount: tier(value, POSTFINANCE_ABROAD), in: 'quote', detail: `barème PostFinance (bourse étrangère) pour un ordre de ${fmt(value)}` };
    },
  },
  yuh: {
    id: 'yuh',
    name: 'Yuh',
    kind: 'Application suisse (Swissquote + PostFinance)',
    description: 'Appli de bourse très utilisée par les jeunes en Suisse. Courtage en pourcentage du montant, fractions d’actions possibles.',
    fees: [
      'Courtage : 0,5 % de l’ordre jusqu’à 10 000 CHF (0,35 % jusqu’à 20 000, puis 0,25 %), minimum 1 CHF',
      'Change : 0,95 % du montant converti',
      'Droit de timbre suisse : 0,075 % / 0,15 %, à l’achat et à la vente',
      'Cryptos : 1 % à l’achat et 1 % à la vente',
    ],
    fractional: true,
    swiss: true,
    source: 'https://www.yuh.com/fr/tarifs/',
    fxPct: 0.95,
    commission(_market, _value, valueAccount) {
      const pct = valueAccount <= 10000 ? 0.5 : valueAccount <= 20000 ? 0.35 : 0.25;
      const fee = Math.max(1, (valueAccount * pct) / 100);
      return { amount: fee, in: 'account', detail: `${pct.toString().replace('.', ',')} % de l’ordre, minimum 1` };
    },
  },
  ibkr: {
    id: 'ibkr',
    name: 'Interactive Brokers',
    kind: 'Courtier international (hors Suisse)',
    description: 'Courtier américain très bon marché, utilisé par les investisseurs expérimentés. N’étant pas suisse, il ne prélève pas le droit de timbre.',
    fees: [
      'Actions US : 0,005 USD par action, minimum 1 USD, maximum 1 % de l’ordre',
      'Bourse suisse : 0,05 % de l’ordre, minimum 5 CHF ; Paris et Europe : 0,05 %, minimum 3 EUR',
      'Change : presque gratuit (0,002 %, minimum 2 USD)',
      'Pas de droit de timbre suisse (courtier étranger)',
      'Cryptos : 0,18 %, minimum 1,75 USD',
    ],
    fractional: true,
    swiss: false,
    source: 'https://www.interactivebrokers.com/fr/pricing/commissions-stocks.php',
    fxPct: 0.002,
    fxMin: 2,
    commission(market, value, _valueAccount, qty) {
      if (market === 'US') {
        const fee = Math.min(Math.max(0.005 * qty, 1), value * 0.01);
        return { amount: fee, in: 'quote', detail: '0,005 USD par action, minimum 1 USD, maximum 1 %' };
      }
      if (market === 'CH') return { amount: Math.max(5, value * 0.0005), in: 'quote', detail: '0,05 % de l’ordre, minimum 5 CHF' };
      return { amount: Math.max(3, value * 0.0005), in: 'quote', detail: '0,05 % de l’ordre, minimum 3 (EUR/GBP)' };
    },
  },
};

const SIMPLE: BrokerInfo = {
  id: 'simple',
  name: 'Frais simplifiés',
  kind: 'Pourcentage fixe choisi à la main',
  description: 'Un seul pourcentage par ordre, sans change ni taxes. Pratique pour comprendre le principe, mais moins réaliste.',
  fees: ['Un pourcentage fixe du montant de chaque ordre (réglable)'],
  fractional: true,
  swiss: false,
  source: '',
};

export const BROKER_IDS: BrokerId[] = ['yuh', 'swissquote', 'postfinance', 'ibkr', 'simple'];
export const BROKER_LIST: BrokerInfo[] = BROKER_IDS.map((id) => {
  if (id === 'simple') return SIMPLE;
  const { commission: _c, fxPct: _f, fxMin: _m, ...info } = BROKERS[id];
  return info;
});

export function brokerName(id: BrokerId): string {
  return id === 'simple' ? 'simplifiés' : BROKERS[id].name;
}

/** Les cryptomonnaies s'achètent toujours par fractions ; sinon on suit le choix de l'utilisateur. */
export function fractionalAllowed(_broker: BrokerId, symbol: string, userChoice: boolean): boolean {
  return marketOf(symbol) === 'CRYPTO' || userChoice;
}

export interface CostInput {
  broker: BrokerId;
  side: Side;
  symbol: string;
  qty: number;
  /** Prix d'une action dans sa devise de cotation. */
  price: number;
  quoteCurrency: string;
  accountCurrency: string;
  /** 1 unité de la devise de l'action = fxRate unités de la devise du compte. */
  fxRate: number;
  /** Pourcentage du courtier « simple ». */
  feePct: number;
  /** Date de l'ordre (certains frais changent selon la période). */
  time?: number;
}

/** Tous les frais d'un ordre, convertis dans la devise du compte. */
export function orderCosts(i: CostInput): { lines: CostLine[]; total: number } {
  const market = marketOf(i.symbol);
  const value = i.qty * i.price;
  const valueAccount = value * i.fxRate;
  const pct = (n: number) => `${n.toLocaleString('fr-CH', { maximumFractionDigits: 3 })} %`;
  const lines: CostLine[] = [];
  const add = (kind: CostLine['kind'], label: string, amount: number, detail: string) => {
    if (amount > 0) lines.push({ kind, label, amount, detail });
  };

  if (i.broker === 'simple') {
    add('simple', 'Frais de courtage', (valueAccount * i.feePct) / 100, `${pct(i.feePct)} du montant`);
    return { lines, total: lines.reduce((a, l) => a + l.amount, 0) };
  }
  const b = BROKERS[i.broker];

  if (market === 'CRYPTO') {
    let fee = (valueAccount * CRYPTO_PCT[i.broker]) / 100;
    if (i.broker === 'ibkr') fee = Math.min(Math.max(fee, 1.75 * (i.quoteCurrency === 'USD' ? i.fxRate : 1)), valueAccount * 0.01);
    add('commission', `Frais crypto ${b.name}`, fee, `${pct(CRYPTO_PCT[i.broker])} de l’ordre (pas de droit de timbre sur les cryptos)`);
    return { lines, total: lines.reduce((a, l) => a + l.amount, 0) };
  }

  // 1. Courtage
  const c = b.commission(market, value, valueAccount, i.qty);
  add('commission', `Courtage ${b.name}`, c.in === 'quote' ? c.amount * i.fxRate : c.amount, c.detail);

  // 2. Change (si l'action n'est pas cotée dans la devise du compte)
  if (i.quoteCurrency !== i.accountCurrency) {
    const fee = Math.max((valueAccount * b.fxPct) / 100, b.fxMin ? b.fxMin * (i.quoteCurrency === 'USD' ? i.fxRate : 1) : 0);
    // À l'achat, la banque convertit la devise du compte vers celle de l'action ; à la vente, l'inverse.
    const [from, to] = i.side === 'BUY' ? [i.accountCurrency, i.quoteCurrency] : [i.quoteCurrency, i.accountCurrency];
    add('fx', `Change ${from} → ${to}`, fee, `${pct(b.fxPct)} du montant converti`);
  }

  // 3. Droit de timbre fédéral (seulement chez un courtier suisse, à l'achat et à la vente)
  if (b.swiss) {
    const rate = market === 'CH' ? STAMP_CH : STAMP_FOREIGN;
    add('stamp', 'Droit de timbre suisse', (valueAccount * rate) / 100, `${pct(rate)} (titre ${market === 'CH' ? 'suisse' : 'étranger'}), impôt fédéral`);
  }

  // 4. Taxes étrangères
  if (i.side === 'BUY' && market === 'FR' && !NOT_FRENCH_ON_PARIS.has(i.symbol.toUpperCase())) {
    add('ftt', 'Taxe française (TTF)', (valueAccount * FTT_FR) / 100, `${pct(FTT_FR)} sur les achats d’actions françaises (sociétés de plus d’1 milliard €)`);
  }
  if (i.side === 'BUY' && market === 'UK') {
    add('ftt', 'Droit de timbre britannique (SDRT)', (valueAccount * SDRT_UK) / 100, `${pct(SDRT_UK)} sur les achats d’actions britanniques`);
  }
  if (i.side === 'SELL' && market === 'US') {
    const time = i.time ?? Date.now();
    const tafPaused = time >= FINRA_TAF_PAUSE.from && time < FINRA_TAF_PAUSE.to;
    const taf = tafPaused ? 0 : Math.min(i.qty * FINRA_TAF_PER_SHARE, FINRA_TAF_MAX);
    const detail = tafPaused
      ? 'taxe SEC de 20,60 USD par million vendu (frais FINRA suspendus jusqu’au 31.12.2026)'
      : 'taxe SEC de 20,60 USD par million vendu + frais FINRA de 0,000195 USD par action';
    add('us_fees', 'Frais réglementaires américains', (value * SEC_RATE + taf) * i.fxRate, detail);
  }

  return { lines, total: lines.reduce((a, l) => a + l.amount, 0) };
}

/** Résumé court des frais, pour le journal et l'export CSV : « courtage Yuh 5.00 CHF, change CHF → USD 9.50 CHF ». */
export function costsSummary(lines: CostLine[], currency: string): string {
  if (lines.length === 0) return 'aucun frais';
  return lines.map((l) => `${l.label.charAt(0).toLowerCase()}${l.label.slice(1)} ${l.amount.toFixed(2)} ${currency}`).join(', ');
}
