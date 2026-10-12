// Accès aux données : une interface commune, deux implémentations.
//   - db-sqlite.ts   : fichier SQLite local (développement, ordinateur, petit serveur) ;
//   - db-postgres.ts : base Postgres (hébergement en ligne, ex. Supabase).
// Le moteur du bot et l'API ne connaissent que cette interface.

import type { Bot, BotConfig, BotStatus, EquityPoint, LogEntry, LogLevel, Side, Trade, TradeTrigger } from '../shared/types.ts';

/** Mémoire interne du bot entre deux analyses. */
export interface BotState {
  /** Heure de la dernière bougie analysée, par symbole (pour ne traiter chaque bougie qu'une fois). */
  lastBar: Record<string, number>;
  everHeld: Record<string, boolean>;
  marketOpen: Record<string, boolean>;
  lastPrice: Record<string, number>;
  /** Informations d'affichage : nom, clôture de la veille et derniers cours (mini-courbe). */
  names: Record<string, string>;
  prevClose: Record<string, number>;
  spark: Record<string, number[]>;
}

export function parseState(raw: unknown): BotState {
  const s = (typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}) as Partial<BotState>;
  return {
    lastBar: s.lastBar ?? {},
    everHeld: s.everHeld ?? {},
    marketOpen: s.marketOpen ?? {},
    lastPrice: s.lastPrice ?? {},
    names: s.names ?? {},
    prevClose: s.prevClose ?? {},
    spark: s.spark ?? {},
  };
}

export interface PositionRow {
  symbol: string;
  qty: number;
  entryPrice: number;
  costBasis: number;
  openedAt: number;
  lastPrice: number | null;
  lastPriceAt: number | null;
}

export interface NewTrade {
  time: number;
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  fees: number;
  amount: number;
  pnl: number | null;
  pnlPct: number | null;
  reason: string;
  trigger: TradeTrigger;
  cashAfter: number;
}

export interface TradeTotals {
  count: number;
  fees: number;
  realizedPnl: number;
  closed: number;
  wins: number;
}

export interface Repo {
  listBots(): Promise<Bot[]>;
  getBot(id: number): Promise<Bot | undefined>;
  insertBot(cfg: BotConfig, currency: string, startPrices: Record<string, number>, now: number): Promise<number>;
  getBotState(id: number): Promise<BotState>;
  saveBotState(id: number, state: BotState): Promise<void>;
  setBotStatus(id: number, status: BotStatus): Promise<void>;
  setBotName(id: number, name: string): Promise<void>;
  setCash(id: number, cash: number): Promise<void>;
  setBotTick(id: number, time: number, error: string | null): Promise<void>;
  deleteBot(id: number): Promise<void>;
  /** Remet le bot à zéro : capital initial, aucune position, historique effacé. */
  resetBot(id: number, startPrices: Record<string, number>, now: number): Promise<void>;
  /** Verrou d'analyse : empêche deux analyses simultanées du même bot (même sur plusieurs serveurs). */
  tryLockBot(id: number, now: number, ttlMs: number): Promise<boolean>;
  unlockBot(id: number): Promise<void>;

  getPositions(botId: number): Promise<PositionRow[]>;
  getPosition(botId: number, symbol: string): Promise<PositionRow | undefined>;
  insertPosition(botId: number, p: PositionRow): Promise<void>;
  deletePosition(botId: number, symbol: string): Promise<void>;
  updatePositionPrice(botId: number, symbol: string, price: number, time: number): Promise<void>;

  insertTrade(botId: number, t: NewTrade): Promise<number>;
  listTrades(botId: number, symbol?: string): Promise<Trade[]>;
  tradeTotals(botId: number): Promise<TradeTotals>;

  insertEquity(botId: number, p: EquityPoint): Promise<void>;
  listEquity(botId: number): Promise<EquityPoint[]>;
  lastEquity(botId: number): Promise<EquityPoint | undefined>;

  insertLog(botId: number, level: LogLevel, symbol: string | null, message: string, time?: number): Promise<void>;
  listLogs(botId: number, limit: number, levels?: LogLevel[]): Promise<LogEntry[]>;

  /** Exécute plusieurs écritures de façon atomique (tout ou rien). */
  transaction<T>(fn: (tx: Repo) => Promise<T>): Promise<T>;
}

type Row = Record<string, any>;

/** Conversion d'une ligne de la table `bots` (identique pour SQLite et Postgres). */
export function botFromRow(r: Row): Bot {
  const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
  return {
    id: Number(r.id),
    name: r.name,
    status: r.status,
    strategy: r.strategy,
    params: json(r.params),
    symbols: json(r.symbols),
    interval: r.interval,
    currency: r.currency,
    initialCapital: Number(r.initial_capital),
    cash: Number(r.cash),
    positionSizePct: Number(r.position_size_pct),
    stopLossPct: Number(r.stop_loss_pct),
    takeProfitPct: Number(r.take_profit_pct),
    feePct: Number(r.fee_pct),
    allowFractional: !!r.allow_fractional,
    startPrices: json(r.start_prices),
    createdAt: Number(r.started_at),
    lastTickAt: r.last_tick_at === null ? null : Number(r.last_tick_at),
    lastError: r.last_error,
  };
}

export function positionFromRow(r: Row): PositionRow {
  return {
    symbol: r.symbol,
    qty: Number(r.qty),
    entryPrice: Number(r.entry_price),
    costBasis: Number(r.cost_basis),
    openedAt: Number(r.opened_at),
    lastPrice: r.last_price === null ? null : Number(r.last_price),
    lastPriceAt: r.last_price_at === null ? null : Number(r.last_price_at),
  };
}

export function tradeFromRow(r: Row): Trade {
  return {
    id: Number(r.id),
    botId: Number(r.bot_id),
    time: Number(r.time),
    symbol: r.symbol,
    side: r.side,
    qty: Number(r.qty),
    price: Number(r.price),
    fees: Number(r.fees),
    amount: Number(r.amount),
    pnl: r.pnl === null ? null : Number(r.pnl),
    pnlPct: r.pnl_pct === null ? null : Number(r.pnl_pct),
    reason: r.reason,
    trigger: r.trigger,
    cashAfter: Number(r.cash_after),
  };
}

export function equityFromRow(r: Row): EquityPoint {
  return { time: Number(r.time), equity: Number(r.equity), cash: Number(r.cash), benchmark: r.benchmark === null ? null : Number(r.benchmark) };
}

export function logFromRow(r: Row): LogEntry {
  return { id: Number(r.id), time: Number(r.time), level: r.level, symbol: r.symbol, message: r.message };
}
