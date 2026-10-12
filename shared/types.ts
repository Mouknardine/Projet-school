// Types partagés entre le serveur (API) et le dashboard web.
// Convention : tous les horodatages sont en millisecondes (epoch UTC).

export type Interval = '5m' | '15m' | '1h' | '1d';
export type Side = 'BUY' | 'SELL';
export type BotStatus = 'running' | 'paused';
export type StrategyId = 'sma_cross' | 'rsi' | 'macd' | 'bollinger' | 'score' | 'buy_hold';
export type TradeTrigger = 'signal' | 'stop_loss' | 'take_profit' | 'manual';
export type LogLevel = 'info' | 'signal' | 'trade' | 'warn' | 'error';

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
  /** Frais de courtage par ordre, en % du montant. */
  feePct: number;
  allowFractional: boolean;
}

export interface Bot extends BotConfig {
  id: number;
  status: BotStatus;
  currency: string;
  cash: number;
  startPrices: Record<string, number>;
  createdAt: number;
  lastTickAt: number | null;
  lastError: string | null;
}

export interface Position {
  symbol: string;
  qty: number;
  /** Prix moyen d'achat (hors frais). */
  entryPrice: number;
  /** Montant total payé, frais inclus. */
  costBasis: number;
  openedAt: number;
  lastPrice: number | null;
  lastPriceAt: number | null;
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
  price: number;
  fees: number;
  /** Montant net : débité du cash pour un achat, crédité pour une vente. */
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
}

export interface WatchItem {
  symbol: string;
  price: number | null;
  marketOpen: boolean | null;
  /** Variation du cours depuis le lancement du bot (en %). */
  sinceStartPct: number | null;
}

export interface BotDetail {
  bot: Bot;
  summary: BotSummary;
  positions: Position[];
  strategy: StrategyInfo;
  watchlist: WatchItem[];
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
  intervals: { id: Interval; label: string; backtestRanges: { id: string; label: string }[] }[];
}
