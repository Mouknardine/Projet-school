// Les stratégies de trading : chacune transforme des bougies en un signal ACHAT / VENTE / ATTENTE,
// accompagné d'une explication en français qui est enregistrée dans l'historique des trades.

import type { Bar, Interval, OverlayDef, StrategyId, StrategyInfo } from '../../shared/types.ts';
import { bollinger, crossedAbove, crossedBelow, macd, rsi, sma, type Series } from './indicators.ts';

export type Action = 'BUY' | 'SELL' | 'HOLD';

export interface Signal {
  action: Action;
  /** Explication complète : ce que le bot a observé, puis ce qu'il décide. */
  reason: string;
  /** Seulement ce que le bot a observé (sans la décision), utile quand le signal est ignoré. */
  fact?: string;
}

/** Construit un signal d'achat ou de vente : l'observation, puis la décision qui en découle. */
const decide = (action: 'BUY' | 'SELL', fact: string, decision: string): Signal => ({ action, fact, reason: `${fact} ${decision}` });

export interface SignalContext {
  bars: Bar[];
  series: Record<string, Series>;
  /** Indice de la bougie analysée (la dernière bougie clôturée). */
  i: number;
  hasPosition: boolean;
  /** Le bot a-t-il déjà détenu ce titre ? (utile pour le Buy & Hold) */
  everHeld: boolean;
  p: Record<string, number>;
  /** Durée d'une bougie : sert à traduire « 20 périodes » en durée compréhensible (« 5 h de bourse »). */
  interval: Interval;
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

const MINUTES: Record<Interval, number> = { '5m': 5, '15m': 15, '1h': 60, '1d': 0 };

/** Traduit un nombre de bougies en durée lisible : 20 bougies de 15 min → « 5 h de bourse », 50 bougies d'un jour → « 50 jours de bourse ». */
export function spanLabel(bars: number, interval: Interval): string {
  if (interval === '1d') return `${bars} jour${bars > 1 ? 's' : ''} de bourse`;
  const m = bars * MINUTES[interval];
  if (m < 60) return `${m} min de bourse`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h} h${r ? ` ${String(r).padStart(2, '0')}` : ''} de bourse`;
}

/** Explication d'une vente automatique (stop-loss / take-profit), commune au bot en direct et au backtest. */
export function exitReason(kind: 'stop_loss' | 'take_profit', price: number, entryPrice: number, limitPct: number): string {
  const change = (price / entryPrice - 1) * 100;
  const pct = `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(2)} %`;
  return kind === 'stop_loss'
    ? `Protection contre les pertes (stop-loss) : le cours est tombé à ${f2(price)}, soit ${pct} par rapport au prix d'achat (${f2(entryPrice)}). La limite était fixée à −${limitPct} % : le bot vend automatiquement pour que la perte ne s'aggrave pas.`
    : `Objectif de gain atteint (take-profit) : le cours est monté à ${f2(price)}, soit ${pct} par rapport au prix d'achat (${f2(entryPrice)}). L'objectif était fixé à +${limitPct} % : le bot vend automatiquement pour encaisser le gain.`;
}
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
      "Stratégie qui suit la tendance. Le bot compare le prix moyen récent (moyenne courte, qui réagit vite) au prix moyen sur une plus longue période (moyenne longue, la tendance de fond). Si le prix moyen récent passe au-dessus, le prix est en train de monter : le bot achète. S'il repasse en dessous, le prix est en train de baisser : le bot vend.",
    rules: {
      buy: 'Le prix moyen récent passe au-dessus du prix moyen à long terme : la tendance devient haussière.',
      sell: 'Le prix moyen récent repasse sous le prix moyen à long terme : la tendance devient baissière.',
    },
    idle: "Cette stratégie n'achète qu'au moment précis où le prix moyen récent passe au-dessus du prix moyen à long terme. Si la tendance était déjà haussière au lancement du bot, ce moment est déjà passé : il attend le prochain croisement, ce qui peut prendre plusieurs heures, voire plusieurs jours.",
    params: [
      { key: 'fast', label: 'Moyenne courte', default: 20, min: 2, max: 200, step: 1, help: 'Nombre de bougies du prix moyen récent' },
      { key: 'slow', label: 'Moyenne longue', default: 50, min: 3, max: 400, step: 1, help: 'Nombre de bougies du prix moyen à long terme' },
    ],
  },
  warmup: (p) => p.slow + 1,
  validate: (p) => (p.fast >= p.slow ? 'La moyenne courte doit avoir une période plus petite que la moyenne longue.' : null),
  overlays: (p) => [
    { key: 'fast', label: `Moyenne courte (${p.fast})`, pane: 'price', color: COLORS.fast },
    { key: 'slow', label: `Moyenne longue (${p.slow})`, pane: 'price', color: COLORS.slow },
  ],
  compute: (bars, p) => {
    const c = closes(bars);
    return { fast: sma(c, p.fast), slow: sma(c, p.slow) };
  },
  signal: ({ series, i, p, interval }) => {
    const f = series.fast[i];
    const s = series.slow[i];
    const short = `le prix moyen sur ${spanLabel(p.fast, interval)} (${f2(f)})`;
    const long = `prix moyen sur ${spanLabel(p.slow, interval)} (${f2(s)})`;
    if (crossedAbove(series.fast, series.slow, i))
      return decide('BUY', `La tendance devient haussière : ${short} vient de passer au-dessus du ${long}.`, 'Le bot achète pour profiter de la hausse.');
    if (crossedBelow(series.fast, series.slow, i))
      return decide('SELL', `La tendance devient baissière : ${short} vient de passer sous le ${long}.`, 'Le bot vend pour ne pas subir la baisse.');
    const up = f !== null && s !== null && f > s;
    return {
      action: 'HOLD',
      reason: `Pas de changement de tendance (toujours ${up ? 'haussière' : 'baissière'}) : ${short} reste ${up ? 'au-dessus du' : 'en dessous du'} ${long}.`,
    };
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
      "Stratégie qui parie sur les rebonds. Le RSI est une note de 0 à 100 qui compare les hausses récentes aux baisses récentes. Une note très basse veut dire que l'action a beaucoup baissé (« survendue ») et pourrait rebondir : le bot achète. Une note très haute veut dire qu'elle a beaucoup monté (« surachetée ») et pourrait redescendre : le bot vend.",
    rules: {
      buy: "Le RSI tombe sous le seuil bas (30 par défaut) : l'action a beaucoup baissé, un rebond est probable.",
      sell: "Le RSI dépasse le seuil haut (70 par défaut) : l'action a beaucoup monté, une rechute est probable.",
    },
    idle: "Cette stratégie n'achète que lorsqu'une action a fortement baissé (RSI sous le seuil bas). Quand la bourse est calme, aucune action ne baisse assez : le bot peut attendre plusieurs heures, voire plusieurs jours.",
    params: [
      { key: 'period', label: 'Période du RSI', default: 14, min: 2, max: 50, step: 1, help: 'Nombre de bougies prises en compte' },
      { key: 'oversold', label: 'Seuil bas (achat)', default: 30, min: 5, max: 50, step: 1, help: 'Le bot achète si le RSI passe dessous' },
      { key: 'overbought', label: 'Seuil haut (vente)', default: 70, min: 50, max: 95, step: 1, help: 'Le bot vend si le RSI passe dessus' },
    ],
  },
  warmup: (p) => p.period + 1,
  validate: (p) => (p.oversold >= p.overbought ? 'Le seuil de survente doit être inférieur au seuil de surachat.' : null),
  overlays: (p) => [{ key: 'rsi', label: `RSI ${p.period}`, pane: 'oscillator', color: COLORS.osc, levels: [p.oversold, p.overbought] }],
  compute: (bars, p) => ({ rsi: rsi(closes(bars), p.period) }),
  signal: ({ series, i, p, interval }) => {
    const r = series.rsi[i];
    if (r === null) return { action: 'HOLD', reason: "Le RSI n'est pas encore calculable." };
    const note = `son RSI (note de 0 à 100 sur ${spanLabel(p.period, interval)}) est à ${f2(r)}`;
    if (r < p.oversold)
      return decide('BUY', `L'action a beaucoup baissé : ${note}, sous le seuil de ${p.oversold} (on dit qu'elle est « survendue »).`, 'Le bot achète en pariant sur un rebond.');
    if (r > p.overbought)
      return decide(
        'SELL',
        `L'action a beaucoup monté : ${note}, au-dessus du seuil de ${p.overbought} (on dit qu'elle est « surachetée »).`,
        'Le bot vend pour encaisser avant une éventuelle rechute.',
      );
    return { action: 'HOLD', reason: `RSI à ${f2(r)}, entre ${p.oversold} et ${p.overbought} : l'action n'a ni trop baissé ni trop monté, le bot attend.` };
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
      "Stratégie qui suit l'élan du prix. Le MACD mesure si le prix accélère ou ralentit : c'est l'écart entre un prix moyen très récent et un prix moyen un peu plus ancien. Sa propre moyenne forme la « ligne de signal ». Quand le MACD passe au-dessus de cette ligne, la hausse s'accélère : le bot achète. Quand il repasse en dessous, l'élan s'essouffle : le bot vend.",
    rules: {
      buy: "Le MACD passe au-dessus de sa ligne de signal : le prix prend de l'élan à la hausse.",
      sell: "Le MACD passe sous sa ligne de signal : le prix perd son élan et risque de baisser.",
    },
    idle: "Cette stratégie n'achète qu'au moment précis où le MACD repasse au-dessus de sa ligne de signal, c'est-à-dire quand le prix reprend de l'élan. Il faut parfois attendre plusieurs heures.",
    params: [
      { key: 'fast', label: 'Moyenne rapide', default: 12, min: 2, max: 50, step: 1, help: 'Bougies de la moyenne très récente' },
      { key: 'slow', label: 'Moyenne lente', default: 26, min: 5, max: 100, step: 1, help: 'Bougies de la moyenne plus ancienne' },
      { key: 'signal', label: 'Ligne de signal', default: 9, min: 2, max: 50, step: 1, help: 'Bougies de la moyenne du MACD' },
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
      return decide('BUY', `Le prix prend de l'élan : le MACD (${f2(m)}) vient de passer au-dessus de sa ligne de signal (${f2(s)}).`, 'Le bot achète pour profiter de la hausse.');
    if (crossedBelow(series.macd, series.signal, i))
      return decide('SELL', `Le prix perd son élan : le MACD (${f2(m)}) vient de passer sous sa ligne de signal (${f2(s)}).`, 'Le bot vend avant que le prix ne baisse davantage.');
    const up = m !== null && s !== null && m > s;
    return {
      action: 'HOLD',
      reason: `Pas de changement d'élan (toujours ${up ? 'à la hausse' : 'à la baisse'}) : le MACD (${f2(m)}) reste ${up ? 'au-dessus' : 'en dessous'} de sa ligne de signal (${f2(s)}).`,
    };
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
      "Stratégie statistique qui parie sur un retour à la normale. Autour du prix moyen, on trace deux bandes qui délimitent la zone où le prix se trouve presque toujours (±2 écarts-types). Quand le prix tombe sous la bande basse, il est anormalement bas : le bot achète en pariant qu'il va remonter vers la moyenne, puis il revend quand c'est le cas.",
    rules: {
      buy: 'Le prix tombe sous la bande basse : il est anormalement bas par rapport à sa moyenne.',
      sell: 'Le prix est remonté jusqu’à sa moyenne : le rebond attendu a eu lieu.',
    },
    idle: "Cette stratégie n'achète que lorsque le prix tombe anormalement bas (sous la bande basse), ce qui est rare par définition. Le bot peut attendre plusieurs heures, voire plusieurs jours.",
    params: [
      { key: 'period', label: 'Période de la moyenne', default: 20, min: 5, max: 100, step: 1, help: 'Nombre de bougies du prix moyen' },
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
  signal: ({ bars, series, i, p, interval }) => {
    const close = bars[i].close;
    const lower = series.lower[i];
    const middle = series.middle[i];
    if (lower === null || middle === null) return { action: 'HOLD', reason: 'Les bandes ne sont pas encore calculables.' };
    if (close < lower)
      return decide(
        'BUY',
        `Le prix est anormalement bas : il est tombé à ${f2(close)}, sous la bande basse (${f2(lower)}), alors que sa moyenne sur ${spanLabel(p.period, interval)} est de ${f2(middle)}.`,
        "Le bot achète en pariant qu'il va remonter vers cette moyenne.",
      );
    if (close >= middle)
      return decide('SELL', `Le prix est revenu à la normale : il est remonté à ${f2(close)}, au niveau de sa moyenne (${f2(middle)}).`, 'Le rebond attendu a eu lieu, le bot vend pour encaisser.');
    return { action: 'HOLD', reason: `Prix à ${f2(close)}, entre la bande basse (${f2(lower)}) et la moyenne (${f2(middle)}) : rien d'anormal, le bot attend.` };
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

const sign = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

function votesText(v: NonNullable<ReturnType<typeof scoreAt>>): string {
  const trend = v.trend > 0 ? 'tendance haussière (+1)' : 'tendance baissière (−1)';
  const momentum =
    v.momentum > 0 ? `RSI bas à ${f2(v.r)}, prix plutôt bas (+1)` : v.momentum < 0 ? `RSI haut à ${f2(v.r)}, prix plutôt haut (−1)` : `RSI neutre à ${f2(v.r)} (0)`;
  const macdVote = v.macdVote > 0 ? 'MACD : le prix accélère (+1)' : 'MACD : le prix ralentit (−1)';
  return `${trend}, ${momentum}, ${macdVote}`;
}

const scoreStrategy: Strategy = {
  info: {
    id: 'score',
    name: 'Score multi-indicateurs',
    short: 'Score',
    description:
      "Le bot demande l'avis de trois indicateurs, qui « votent » chacun +1 (plutôt acheter), 0 ou −1 (plutôt vendre) : la tendance (moyennes mobiles), le RSI (le prix a-t-il trop baissé ou trop monté ?) et le MACD (le prix accélère-t-il ?). Le score total va de −3 à +3. C'est le principe d'un modèle de décision qui combine plusieurs informations, comme le font (en beaucoup plus complexe) les algorithmes professionnels.",
    rules: {
      buy: 'Le score atteint le seuil d’achat (+2 par défaut) : la majorité des indicateurs sont positifs.',
      sell: 'Le score descend au seuil de vente (−2 par défaut) : la majorité des indicateurs sont négatifs.',
    },
    idle: "Cette stratégie n'achète qu'au moment où la majorité des indicateurs deviennent positifs en même temps. Il faut parfois attendre plusieurs heures.",
    params: [
      { key: 'fast', label: 'Moyenne courte', default: 20, min: 2, max: 200, step: 1, help: 'Nombre de bougies du prix moyen récent' },
      { key: 'slow', label: 'Moyenne longue', default: 50, min: 3, max: 400, step: 1, help: 'Nombre de bougies du prix moyen à long terme' },
      { key: 'rsiPeriod', label: 'Période du RSI', default: 14, min: 2, max: 50, step: 1, help: 'Nombre de bougies prises en compte' },
      { key: 'threshold', label: 'Seuil de décision', default: 2, min: 1, max: 3, step: 1, help: 'Nombre de votes nécessaires pour agir' },
    ],
  },
  warmup: (p) => Math.max(p.slow, 26 + 9, p.rsiPeriod) + 1,
  validate: (p) => (p.fast >= p.slow ? 'La moyenne courte doit avoir une période plus petite que la moyenne longue.' : null),
  overlays: (p) => [
    { key: 'fast', label: `Moyenne courte (${p.fast})`, pane: 'price', color: COLORS.fast },
    { key: 'slow', label: `Moyenne longue (${p.slow})`, pane: 'price', color: COLORS.slow },
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
    if (!now) return { action: 'HOLD', reason: "Le score n'est pas encore calculable." };
    const prev = scoreAt(series, i - 1);
    const detail = `Votes : ${votesText(now)}.`;
    if (now.total >= p.threshold && (prev === null || prev.total < p.threshold))
      return decide('BUY', `La majorité des indicateurs sont positifs : score de ${sign(now.total)} sur 3, le seuil d'achat (+${p.threshold}) est atteint. ${detail}`, 'Le bot achète.');
    if (now.total <= -p.threshold)
      return decide('SELL', `La majorité des indicateurs sont négatifs : score de ${sign(now.total)} sur 3, le seuil de vente (−${p.threshold}) est atteint. ${detail}`, 'Le bot vend.');
    return { action: 'HOLD', reason: `Score de ${sign(now.total)} sur 3 : pas assez net pour agir (achat à +${p.threshold}, vente à −${p.threshold}). ${detail}` };
  },
};

// ---------------------------------------------------------------------------
// 6. Buy & Hold (stratégie de référence)
// ---------------------------------------------------------------------------
const buyHold: Strategy = {
  info: {
    id: 'buy_hold',
    name: 'Acheter et garder (Buy & Hold)',
    short: 'Acheter et garder',
    description:
      "Stratégie passive qui sert de point de comparaison (« acheter et garder ») : le bot achète au départ et ne revend jamais. C'est ce que ferait un investisseur qui place son argent et attend. Un algorithme n'a d'intérêt que s'il fait mieux que cette stratégie, à risque égal.",
    rules: { buy: 'Une seule fois, au démarrage du bot.', sell: 'Jamais (sauf vente automatique stop-loss / objectif, si activée).' },
    idle: "Cette stratégie achète toutes ses actions dès la première analyse faite pendant que la bourse est ouverte.",
    params: [],
  },
  warmup: () => 1,
  overlays: () => [],
  compute: () => ({}),
  signal: ({ everHeld, hasPosition }) =>
    !everHeld && !hasPosition
      ? {
          action: 'BUY',
          reason: "Achat de départ : cette stratégie de référence (« acheter et garder ») achète une seule fois puis garde l'action sans jamais la revendre. Elle sert à vérifier si les autres bots font mieux.",
        }
      : { action: 'HOLD', reason: "Le bot garde ses actions : la stratégie « acheter et garder » ne vend jamais." },
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
