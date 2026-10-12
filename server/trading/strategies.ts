// Les stratégies de trading : chacune transforme des bougies en un signal ACHAT / VENTE / ATTENTE,
// accompagné d'une explication en français qui est enregistrée dans l'historique des trades.

import type { Bar, OverlayDef, StrategyId, StrategyInfo } from '../../shared/types.ts';
import { bollinger, crossedAbove, crossedBelow, macd, rsi, sma, type Series } from './indicators.ts';

export type Action = 'BUY' | 'SELL' | 'HOLD';

export interface Signal {
  action: Action;
  reason: string;
}

export interface SignalContext {
  bars: Bar[];
  series: Record<string, Series>;
  /** Indice de la bougie analysée (la dernière bougie clôturée). */
  i: number;
  hasPosition: boolean;
  /** Le bot a-t-il déjà détenu ce titre ? (utile pour le Buy & Hold) */
  everHeld: boolean;
  p: Record<string, number>;
}

export interface Strategy {
  info: StrategyInfo;
  /** Nombre minimum de bougies nécessaires avant de pouvoir produire un signal. */
  warmup(p: Record<string, number>): number;
  validate?(p: Record<string, number>): string | null;
  overlays(p: Record<string, number>): OverlayDef[];
  compute(bars: Bar[], p: Record<string, number>): Record<string, Series>;
  signal(ctx: SignalContext): Signal;
}

const f2 = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toFixed(2));
const closes = (bars: Bar[]) => bars.map((b) => b.close);

const COLORS = {
  fast: '#f59e0b',
  slow: '#38bdf8',
  band: '#a78bfa',
  osc: '#f472b6',
  signal: '#38bdf8',
  hist: '#64748b',
};

// ---------------------------------------------------------------------------
// 1. Croisement de moyennes mobiles (suivi de tendance)
// ---------------------------------------------------------------------------
const smaCross: Strategy = {
  info: {
    id: 'sma_cross',
    name: 'Croisement de moyennes mobiles',
    short: 'Moyennes mobiles',
    description:
      "Stratégie de suivi de tendance. On compare une moyenne mobile courte (qui réagit vite) à une moyenne mobile longue (qui représente la tendance de fond). Quand la courte passe au-dessus de la longue, la tendance devient haussière : le bot achète. Quand elle repasse en dessous, il vend.",
    rules: {
      buy: 'La moyenne courte croise la moyenne longue vers le haut (« golden cross »).',
      sell: 'La moyenne courte croise la moyenne longue vers le bas (« death cross »).',
    },
    params: [
      { key: 'fast', label: 'Moyenne courte (périodes)', default: 20, min: 2, max: 200, step: 1 },
      { key: 'slow', label: 'Moyenne longue (périodes)', default: 50, min: 3, max: 400, step: 1 },
    ],
  },
  warmup: (p) => p.slow + 1,
  validate: (p) => (p.fast >= p.slow ? 'La moyenne courte doit avoir une période plus petite que la moyenne longue.' : null),
  overlays: (p) => [
    { key: 'fast', label: `MM${p.fast}`, pane: 'price', color: COLORS.fast },
    { key: 'slow', label: `MM${p.slow}`, pane: 'price', color: COLORS.slow },
  ],
  compute: (bars, p) => {
    const c = closes(bars);
    return { fast: sma(c, p.fast), slow: sma(c, p.slow) };
  },
  signal: ({ series, i, p }) => {
    const f = series.fast[i];
    const s = series.slow[i];
    if (crossedAbove(series.fast, series.slow, i))
      return { action: 'BUY', reason: `Croisement haussier : MM${p.fast} (${f2(f)}) passe au-dessus de MM${p.slow} (${f2(s)})` };
    if (crossedBelow(series.fast, series.slow, i))
      return { action: 'SELL', reason: `Croisement baissier : MM${p.fast} (${f2(f)}) passe sous MM${p.slow} (${f2(s)})` };
    const trend = f !== null && s !== null && f > s ? 'haussière' : 'baissière';
    return { action: 'HOLD', reason: `Pas de croisement — MM${p.fast} ${f2(f)} / MM${p.slow} ${f2(s)} (tendance ${trend})` };
  },
};

// ---------------------------------------------------------------------------
// 2. RSI (retour à la moyenne)
// ---------------------------------------------------------------------------
const rsiStrategy: Strategy = {
  info: {
    id: 'rsi',
    name: 'RSI — survente / surachat',
    short: 'RSI',
    description:
      "Stratégie de retour à la moyenne. Le RSI mesure, sur une échelle de 0 à 100, la force des hausses récentes par rapport aux baisses. Un RSI très bas signifie que le titre a beaucoup baissé (survendu) et pourrait rebondir : le bot achète. Un RSI très haut signifie qu'il a beaucoup monté (suracheté) : le bot vend.",
    rules: {
      buy: 'Le RSI passe sous le seuil de survente (30 par défaut).',
      sell: 'Le RSI dépasse le seuil de surachat (70 par défaut).',
    },
    params: [
      { key: 'period', label: 'Période du RSI', default: 14, min: 2, max: 50, step: 1 },
      { key: 'oversold', label: 'Seuil de survente', default: 30, min: 5, max: 50, step: 1 },
      { key: 'overbought', label: 'Seuil de surachat', default: 70, min: 50, max: 95, step: 1 },
    ],
  },
  warmup: (p) => p.period + 1,
  validate: (p) => (p.oversold >= p.overbought ? 'Le seuil de survente doit être inférieur au seuil de surachat.' : null),
  overlays: (p) => [{ key: 'rsi', label: `RSI ${p.period}`, pane: 'oscillator', color: COLORS.osc, levels: [p.oversold, p.overbought] }],
  compute: (bars, p) => ({ rsi: rsi(closes(bars), p.period) }),
  signal: ({ series, i, p }) => {
    const r = series.rsi[i];
    if (r === null) return { action: 'HOLD', reason: 'RSI pas encore calculable' };
    if (r < p.oversold) return { action: 'BUY', reason: `RSI à ${f2(r)} < ${p.oversold} : titre survendu` };
    if (r > p.overbought) return { action: 'SELL', reason: `RSI à ${f2(r)} > ${p.overbought} : titre suracheté` };
    return { action: 'HOLD', reason: `RSI à ${f2(r)} (zone neutre ${p.oversold}–${p.overbought})` };
  },
};

// ---------------------------------------------------------------------------
// 3. MACD (momentum)
// ---------------------------------------------------------------------------
const macdStrategy: Strategy = {
  info: {
    id: 'macd',
    name: 'MACD — croisement de la ligne de signal',
    short: 'MACD',
    description:
      "Stratégie de momentum. Le MACD est l'écart entre deux moyennes mobiles exponentielles (12 et 26 périodes). Sa propre moyenne (sur 9 périodes) forme la « ligne de signal ». Quand le MACD passe au-dessus de sa ligne de signal, la hausse s'accélère : le bot achète. Dans le cas inverse, il vend.",
    rules: {
      buy: 'Le MACD croise sa ligne de signal vers le haut.',
      sell: 'Le MACD croise sa ligne de signal vers le bas.',
    },
    params: [
      { key: 'fast', label: 'EMA rapide', default: 12, min: 2, max: 50, step: 1 },
      { key: 'slow', label: 'EMA lente', default: 26, min: 5, max: 100, step: 1 },
      { key: 'signal', label: 'Ligne de signal', default: 9, min: 2, max: 50, step: 1 },
    ],
  },
  warmup: (p) => p.slow + p.signal,
  validate: (p) => (p.fast >= p.slow ? "L'EMA rapide doit avoir une période plus petite que l'EMA lente." : null),
  overlays: () => [
    { key: 'histogram', label: 'Histogramme', pane: 'oscillator', color: COLORS.hist, type: 'histogram' },
    { key: 'macd', label: 'MACD', pane: 'oscillator', color: COLORS.fast, levels: [0] },
    { key: 'signal', label: 'Signal', pane: 'oscillator', color: COLORS.signal },
  ],
  compute: (bars, p) => macd(closes(bars), p.fast, p.slow, p.signal),
  signal: ({ series, i }) => {
    const m = series.macd[i];
    const s = series.signal[i];
    if (crossedAbove(series.macd, series.signal, i))
      return { action: 'BUY', reason: `MACD (${f2(m)}) croise sa ligne de signal (${f2(s)}) vers le haut` };
    if (crossedBelow(series.macd, series.signal, i))
      return { action: 'SELL', reason: `MACD (${f2(m)}) croise sa ligne de signal (${f2(s)}) vers le bas` };
    const side = m !== null && s !== null && m > s ? 'au-dessus' : 'en dessous';
    return { action: 'HOLD', reason: `Pas de croisement — MACD ${f2(m)} ${side} du signal ${f2(s)}` };
  },
};

// ---------------------------------------------------------------------------
// 4. Bandes de Bollinger (retour à la moyenne)
// ---------------------------------------------------------------------------
const bollingerStrategy: Strategy = {
  info: {
    id: 'bollinger',
    name: 'Bandes de Bollinger',
    short: 'Bollinger',
    description:
      "Stratégie statistique de retour à la moyenne. On trace une moyenne mobile entourée de deux bandes situées à ±2 écarts-types. Statistiquement, le prix reste la plupart du temps entre les bandes. Quand il passe sous la bande basse, il est « anormalement » bas : le bot achète en pariant sur un retour vers la moyenne, puis revend quand le prix l'a rejointe.",
    rules: {
      buy: 'Le prix de clôture passe sous la bande inférieure.',
      sell: 'Le prix de clôture remonte au niveau de la moyenne (bande centrale).',
    },
    params: [
      { key: 'period', label: 'Période', default: 20, min: 5, max: 100, step: 1 },
      { key: 'k', label: "Nombre d'écarts-types", default: 2, min: 0.5, max: 4, step: 0.1 },
    ],
  },
  warmup: (p) => p.period,
  overlays: () => [
    { key: 'upper', label: 'Bande haute', pane: 'price', color: COLORS.band },
    { key: 'middle', label: 'Moyenne', pane: 'price', color: COLORS.fast },
    { key: 'lower', label: 'Bande basse', pane: 'price', color: COLORS.band },
  ],
  compute: (bars, p) => bollinger(closes(bars), p.period, p.k),
  signal: ({ bars, series, i }) => {
    const close = bars[i].close;
    const lower = series.lower[i];
    const middle = series.middle[i];
    if (lower === null || middle === null) return { action: 'HOLD', reason: 'Bandes pas encore calculables' };
    if (close < lower) return { action: 'BUY', reason: `Clôture ${f2(close)} sous la bande basse (${f2(lower)})` };
    if (close >= middle) return { action: 'SELL', reason: `Clôture ${f2(close)} revenue à la moyenne (${f2(middle)})` };
    return { action: 'HOLD', reason: `Clôture ${f2(close)} entre la bande basse (${f2(lower)}) et la moyenne (${f2(middle)})` };
  },
};

// ---------------------------------------------------------------------------
// 5. Score multi-indicateurs (vote de plusieurs indicateurs)
// ---------------------------------------------------------------------------
function scoreAt(series: Record<string, Series>, i: number) {
  const f = series.fast[i];
  const s = series.slow[i];
  const r = series.rsi[i];
  const m = series.macd[i];
  const sig = series.signal[i];
  if (f === null || s === null || r === null || m === null || sig === null) return null;
  const trend = f > s ? 1 : -1;
  const momentum = r < 40 ? 1 : r > 60 ? -1 : 0;
  const macdVote = m > sig ? 1 : -1;
  return { total: trend + momentum + macdVote, trend, momentum, macdVote, r };
}

const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

const scoreStrategy: Strategy = {
  info: {
    id: 'score',
    name: 'Score multi-indicateurs',
    short: 'Score',
    description:
      "Le bot combine trois indicateurs qui « votent » chacun : la tendance (moyennes mobiles : +1 si haussière, −1 sinon), le momentum (RSI : +1 sous 40, −1 au-dessus de 60, 0 entre les deux) et le MACD (+1 au-dessus de sa ligne de signal, −1 sinon). Le score total va de −3 à +3. C'est le principe d'un modèle de décision qui pondère plusieurs informations, comme le font (en beaucoup plus complexe) les algorithmes professionnels.",
    rules: {
      buy: 'Le score atteint le seuil d’achat (+2 par défaut) alors qu’il était en dessous.',
      sell: 'Le score descend au seuil de vente (−2 par défaut) ou plus bas.',
    },
    params: [
      { key: 'fast', label: 'Moyenne courte', default: 20, min: 2, max: 200, step: 1 },
      { key: 'slow', label: 'Moyenne longue', default: 50, min: 3, max: 400, step: 1 },
      { key: 'rsiPeriod', label: 'Période du RSI', default: 14, min: 2, max: 50, step: 1 },
      { key: 'threshold', label: 'Seuil de décision (1 à 3)', default: 2, min: 1, max: 3, step: 1 },
    ],
  },
  warmup: (p) => Math.max(p.slow, 26 + 9, p.rsiPeriod) + 1,
  validate: (p) => (p.fast >= p.slow ? 'La moyenne courte doit avoir une période plus petite que la moyenne longue.' : null),
  overlays: (p) => [
    { key: 'fast', label: `MM${p.fast}`, pane: 'price', color: COLORS.fast },
    { key: 'slow', label: `MM${p.slow}`, pane: 'price', color: COLORS.slow },
    { key: 'score', label: 'Score', pane: 'oscillator', color: COLORS.osc, type: 'histogram', levels: [p.threshold, -p.threshold] },
  ],
  compute: (bars, p) => {
    const c = closes(bars);
    const m = macd(c, 12, 26, 9);
    const series: Record<string, Series> = { fast: sma(c, p.fast), slow: sma(c, p.slow), rsi: rsi(c, p.rsiPeriod), macd: m.macd, signal: m.signal };
    series.score = c.map((_, i) => scoreAt(series, i)?.total ?? null);
    return series;
  },
  signal: ({ series, i, p }) => {
    const now = scoreAt(series, i);
    if (!now) return { action: 'HOLD', reason: 'Score pas encore calculable' };
    const prev = scoreAt(series, i - 1);
    const detail = `tendance ${sign(now.trend)}, RSI ${f2(now.r)} ${sign(now.momentum)}, MACD ${sign(now.macdVote)}`;
    if (now.total >= p.threshold && (prev === null || prev.total < p.threshold))
      return { action: 'BUY', reason: `Score ${sign(now.total)} ≥ ${p.threshold} (${detail})` };
    if (now.total <= -p.threshold) return { action: 'SELL', reason: `Score ${sign(now.total)} ≤ −${p.threshold} (${detail})` };
    return { action: 'HOLD', reason: `Score ${sign(now.total)} (${detail})` };
  },
};

// ---------------------------------------------------------------------------
// 6. Buy & Hold (stratégie de référence)
// ---------------------------------------------------------------------------
const buyHold: Strategy = {
  info: {
    id: 'buy_hold',
    name: 'Buy & Hold (référence)',
    short: 'Buy & Hold',
    description:
      "Stratégie passive qui sert de point de comparaison : le bot achète au départ et ne revend jamais. C'est ce que ferait un investisseur qui place son argent et attend. Un algorithme n'a d'intérêt que s'il fait mieux que cette stratégie, à risque égal.",
    rules: { buy: 'Achat unique au démarrage.', sell: 'Jamais (sauf stop-loss / take-profit si activés).' },
    params: [],
  },
  warmup: () => 1,
  overlays: () => [],
  compute: () => ({}),
  signal: ({ everHeld, hasPosition }) =>
    !everHeld && !hasPosition
      ? { action: 'BUY', reason: 'Achat initial (stratégie passive Buy & Hold)' }
      : { action: 'HOLD', reason: 'Conservation de la position' },
};

export const STRATEGIES: Record<StrategyId, Strategy> = {
  sma_cross: smaCross,
  rsi: rsiStrategy,
  macd: macdStrategy,
  bollinger: bollingerStrategy,
  score: scoreStrategy,
  buy_hold: buyHold,
};

export const STRATEGY_IDS = Object.keys(STRATEGIES) as StrategyId[];

export function getStrategy(id: StrategyId): Strategy {
  const s = STRATEGIES[id];
  if (!s) throw new Error(`Stratégie inconnue : ${id}`);
  return s;
}

/** Complète les paramètres manquants avec les valeurs par défaut et les borne dans les limites autorisées. */
export function normalizeParams(id: StrategyId, input: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const def of getStrategy(id).info.params) {
    const raw = Number(input[def.key]);
    const v = Number.isFinite(raw) ? raw : def.default;
    out[def.key] = Math.min(def.max, Math.max(def.min, v));
  }
  return out;
}
