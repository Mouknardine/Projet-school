// Types partagés entre le serveur (API) et le dashboard web.
// Convention : tous les horodatages sont en millisecondes (epoch UTC).

export type Interval = '5m' | '15m' | '1h' | '1d';
export type Side = 'BUY' | 'SELL';
export type BotStatus = 'running' | 'paused';
export type StrategyId = 'trend' | 'sma_cross' | 'rsi' | 'macd' | 'bollinger' | 'score' | 'buy_hold';
export type TradeTrigger = 'signal' | 'stop_loss' | 'take_profit' | 'manual' | 'protection';
export type LogLevel = 'info' | 'signal' | 'trade' | 'warn' | 'error';
/** Banque ou courtier dont le bot applique les vrais tarifs (« simple » = un pourcentage fixe choisi à la main). */
export type BrokerId = 'swissquote' | 'postfinance' | 'yuh' | 'ibkr' | 'simple';
/** Devises proposées pour le compte du bot. */
export const ACCOUNT_CURRENCIES = ['CHF', 'EUR', 'USD'] as const;
export type AccountCurrency = (typeof ACCOUNT_CURRENCIES)[number];

/** Une ligne de coût d'un ordre (courtage, change, droit de timbre…), dans la devise du compte. */
export interface CostLine {
  kind: 'commission' | 'fx' | 'stamp' | 'ftt' | 'us_fees' | 'simple';
  label: string;
  amount: number;
  /** Explication du calcul (taux, barème…). */
  detail: string;
}

/** Tarifs d'un courtier, résumés pour l'affichage. */
export interface BrokerInfo {
  id: BrokerId;
  name: string;
  kind: string;
  description: string;
  /** Résumé lisible des frais (une ligne par élément). */
  fees: string[];
  fractional: boolean;
  /** Le courtier est-il suisse ? (droit de timbre fédéral) */
  swiss: boolean;
  source: string;
}

/** Aperçu des frais réels d'un achat puis d'une revente, pour une action donnée. */
export interface CostPreviewItem {
  symbol: string;
  name: string;
  /** Devise de cotation de l'action. */
  currency: string;
  price: number;
  /** 1 unité de la devise de l'action = fxRate unités de la devise du compte. */
  fxRate: number;
  qty: number;
  /** Valeur des actions achetées, dans la devise du compte. */
  value: number;
  buy: CostLine[];
  buyTotal: number;
  sell: CostLine[];
  sellTotal: number;
  /** Hausse du cours nécessaire pour couvrir les frais d'achat et de revente (en %). */
  breakEvenPct: number;
}

export interface CostPreview {
  currency: string;
  /** Montant investi par achat (capital × part investie). */
  amount: number;
  items: CostPreviewItem[];
  errors: string[];
}

/** Une bougie (chandelier) : prix d'ouverture, plus haut, plus bas, clôture et volume sur une période. */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Paramètre réglable d'une stratégie (ex. période de la moyenne mobile). */
export interface ParamDef {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  help?: string;
}

/** Indicateur à afficher sur le graphique : soit sur le prix, soit dans un panneau séparé (oscillateur). */
export interface OverlayDef {
  key: string;
  label: string;
  pane: 'price' | 'oscillator';
  color: string;
  type?: 'line' | 'histogram';
  /** Lignes horizontales de référence (ex. 30 et 70 pour le RSI). */
  levels?: number[];
}

export interface StrategyInfo {
  id: StrategyId;
  name: string;
  short: string;
  description: string;
  rules: { buy: string; sell: string };
  /** Pourquoi un bot peut rester un moment sans rien acheter avec cette stratégie. */
  idle: string;
  params: ParamDef[];
}

/** Configuration choisie par l'utilisateur à la création d'un bot. */
export interface BotConfig {
  name: string;
  initialCapital: number;
  symbols: string[];
  strategy: StrategyId;
  params: Record<string, number>;
  interval: Interval;
  /** Part du portefeuille investie à chaque nouvelle position (en %). */
  positionSizePct: number;
  /** Vente automatique si la position perd X % (0 = désactivé). */
  stopLossPct: number;
  /** Vente automatique si la position gagne X % (0 = désactivé). */
  takeProfitPct: number;
  /** Frais de courtage par ordre, en % du montant (uniquement pour le courtier « simple »). */
  feePct: number;
  allowFractional: boolean;
  /** Devise du compte : le capital et les résultats sont exprimés dans cette devise. */
  currency: AccountCurrency | string;
  /** Courtier dont le bot applique les tarifs réels. */
  broker: BrokerId;
  /**
   * Limite de perte globale (en %) : si la valeur du placement baisse de plus que ce pourcentage,
   * le bot vend tout pour protéger le reste de l'argent, puis se met en pause. 0 = pas de limite.
   */
  maxLossPct: number;
  /** Résultat du questionnaire qui a servi à régler le bot (absent pour un bot réglé à la main). */
  profile: BotProfile | null;
}

/** Niveau de risque d'un investisseur, de 1 (très prudent) à 5 (audacieux). */
export type RiskLevel = 1 | 2 | 3 | 4 | 5;

/** Ce qu'on garde du questionnaire avec le bot, pour expliquer ses réglages. */
export interface BotProfile {
  level: RiskLevel;
  /** Réponses données (identifiant de la question → identifiant de la réponse). */
  answers: Record<string, string>;
  /** Agitation mesurée de chaque action au moment du choix (volatilité annuelle, en %). */
  volatility: Record<string, number>;
}

export interface Bot extends BotConfig {
  id: number;
  status: BotStatus;
  currency: string;
  cash: number;
  startPrices: Record<string, number>;
  /** Taux de change de chaque action vers la devise du compte au démarrage (1 si même devise). */
  startFx: Record<string, number>;
  createdAt: number;
  lastTickAt: number | null;
  lastError: string | null;
}

export interface Position {
  symbol: string;
  qty: number;
  /** Devise de cotation de l'action (USD, CHF, EUR…). */
  currency: string;
  /** Prix moyen d'achat (hors frais), dans la devise de l'action. */
  entryPrice: number;
  /** Taux de change au moment de l'achat (devise de l'action → devise du compte). */
  entryFx: number;
  /** Dernier taux de change connu. */
  lastFx: number;
  /** Montant total payé, frais inclus, dans la devise du compte. */
  costBasis: number;
  openedAt: number;
  lastPrice: number | null;
  lastPriceAt: number | null;
  /** Valeur actuelle dans la devise du compte. */
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
}

export interface Trade {
  id: number;
  botId: number;
  time: number;
  symbol: string;
  side: Side;
  qty: number;
  /** Prix d'une action, dans sa devise de cotation. */
  price: number;
  /** Devise de cotation de l'action. */
  currency: string;
  /** Taux de change utilisé (1 unité de la devise de l'action = fxRate unités de la devise du compte). */
  fxRate: number;
  /** Total des frais, dans la devise du compte. */
  fees: number;
  /** Détail des frais (absent pour les anciens trades). */
  costs: CostLine[] | null;
  /** Montant net dans la devise du compte : débité pour un achat, crédité pour une vente. */
  amount: number;
  /** Résultat réalisé (uniquement pour les ventes). */
  pnl: number | null;
  pnlPct: number | null;
  reason: string;
  trigger: TradeTrigger;
  cashAfter: number;
}

export interface EquityPoint {
  time: number;
  equity: number;
  cash: number;
  benchmark: number | null;
}

export interface LogEntry {
  id: number;
  time: number;
  level: LogLevel;
  symbol: string | null;
  message: string;
}

export interface BotSummary {
  equity: number;
  cash: number;
  positionsValue: number;
  pnl: number;
  pnlPct: number;
  benchmarkEquity: number | null;
  benchmarkPnlPct: number | null;
  realizedPnl: number;
  unrealizedPnl: number;
  feesPaid: number;
  tradesCount: number;
  closedTrades: number;
  winRate: number | null;
  maxDrawdownPct: number;
  /** Petite série pour les mini-graphiques (cartes de la page d'accueil). */
  sparkline: number[];
}

export interface BotListItem {
  bot: Bot;
  summary: BotSummary;
  /** La bourse d'au moins une des actions est-elle ouverte ? (null : pas encore observé) */
  marketOpen: boolean | null;
}

/** Horaires de la séance de bourse du jour (début et fin, en millisecondes). */
export interface Session {
  start: number;
  end: number;
}

export interface WatchItem {
  symbol: string;
  name: string | null;
  /** Devise de cotation de l'action. */
  currency: string | null;
  /** Taux de change actuel vers la devise du compte. */
  fx: number | null;
  price: number | null;
  marketOpen: boolean | null;
  /** Variation du cours depuis le lancement du bot (en %). */
  sinceStartPct: number | null;
  /** Variation du jour (par rapport à la clôture de la veille, en %). */
  dayChangePct: number | null;
  /** Derniers cours de clôture, pour la mini-courbe. */
  spark: number[];
  /** Dernière réflexion du bot sur cette action (ce qu'il a observé et décidé). */
  lastAnalysis: { time: number; text: string } | null;
  /** Horaires d'ouverture de la bourse de cette action. */
  session: Session | null;
}

export interface BotDetail {
  bot: Bot;
  summary: BotSummary;
  positions: Position[];
  strategy: StrategyInfo;
  watchlist: WatchItem[];
  /** Limite de perte globale : en dessous de cette valeur, le bot vend tout (null si pas de limite). */
  lossFloor: number | null;
  /** Limite atteinte : depuis quand, et la valeur du placement à ce moment-là. */
  protection: { since: number; equity: number; base: number } | null;
}

export interface Quote {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  price: number;
  priceTime: number;
  previousClose: number | null;
  marketOpen: boolean;
  /** Horaires de la séance du jour, quand Yahoo Finance les fournit. */
  session?: Session | null;
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export interface ChartResponse {
  quote: Quote;
  interval: Interval;
  bars: Bar[];
  overlays: OverlayDef[];
  series: Record<string, (number | null)[]>;
  trades: Trade[];
}

export interface BacktestRequest extends Omit<BotConfig, 'name'> {
  range: string;
}

export interface BacktestStats {
  startTime: number;
  endTime: number;
  finalEquity: number;
  totalReturnPct: number;
  benchmarkReturnPct: number;
  maxDrawdownPct: number;
  benchmarkMaxDrawdownPct: number;
  volatilityPct: number | null;
  sharpe: number | null;
  closedTrades: number;
  winRate: number | null;
  profitFactor: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  feesPaid: number;
  exposurePct: number;
}

export interface BacktestResult {
  currency: string;
  interval: Interval;
  range: string;
  warmupBars: number;
  /** Moment où la limite de perte globale a été atteinte (le bot a tout vendu), ou null. */
  protectionAt: number | null;
  equity: EquityPoint[];
  trades: Omit<Trade, 'id' | 'botId'>[];
  openPositions: { symbol: string; qty: number; entryPrice: number; lastPrice: number }[];
  stats: BacktestStats;
  /** Données pour afficher le graphique de chaque action avec ses indicateurs. */
  overlays: OverlayDef[];
  charts: Record<string, { bars: Bar[]; series: Record<string, (number | null)[]> }>;
}

export interface AppConfig {
  authRequired: boolean;
  tickSeconds: number;
  brokers: BrokerInfo[];
  accountCurrencies: string[];
  intervals: { id: Interval; label: string; backtestRanges: { id: string; label: string }[] }[];
}
