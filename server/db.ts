// Base de données SQLite (fichier local) : bots, positions, historique des trades,
// évolution de la valeur du portefeuille et journal du bot.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  Bot,
  BotConfig,
  BotStatus,
  EquityPoint,
  LogEntry,
  LogLevel,
  Side,
  Trade,
  TradeTrigger,
} from '../shared/types.ts';
import { config } from './config.ts';

if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS bots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'running',
  strategy          TEXT    NOT NULL,
  params            TEXT    NOT NULL,
  symbols           TEXT    NOT NULL,
  interval          TEXT    NOT NULL,
  currency          TEXT    NOT NULL,
  initial_capital   REAL    NOT NULL,
  cash              REAL    NOT NULL,
  position_size_pct REAL    NOT NULL,
  stop_loss_pct     REAL    NOT NULL,
  take_profit_pct   REAL    NOT NULL,
  fee_pct           REAL    NOT NULL,
  allow_fractional  INTEGER NOT NULL,
  start_prices      TEXT    NOT NULL,
  state             TEXT    NOT NULL DEFAULT '{}',
  started_at        INTEGER NOT NULL,
  last_tick_at      INTEGER,
  last_error        TEXT
);

CREATE TABLE IF NOT EXISTS positions (
  bot_id        INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  symbol        TEXT    NOT NULL,
  qty           REAL    NOT NULL,
  entry_price   REAL    NOT NULL,
  cost_basis    REAL    NOT NULL,
  opened_at     INTEGER NOT NULL,
  last_price    REAL,
  last_price_at INTEGER,
  PRIMARY KEY (bot_id, symbol)
);

CREATE TABLE IF NOT EXISTS trades (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id     INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  time       INTEGER NOT NULL,
  symbol     TEXT    NOT NULL,
  side       TEXT    NOT NULL,
  qty        REAL    NOT NULL,
  price      REAL    NOT NULL,
  fees       REAL    NOT NULL,
  amount     REAL    NOT NULL,
  pnl        REAL,
  pnl_pct    REAL,
  reason     TEXT    NOT NULL,
  trigger    TEXT    NOT NULL,
  cash_after REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_bot ON trades(bot_id, time);

CREATE TABLE IF NOT EXISTS equity (
  bot_id    INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  time      INTEGER NOT NULL,
  equity    REAL    NOT NULL,
  cash      REAL    NOT NULL,
  benchmark REAL
);
CREATE INDEX IF NOT EXISTS idx_equity_bot ON equity(bot_id, time);

CREATE TABLE IF NOT EXISTS logs (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id  INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  time    INTEGER NOT NULL,
  level   TEXT    NOT NULL,
  symbol  TEXT,
  message TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_bot ON logs(bot_id, id);
`);

/** Exécute plusieurs écritures de façon atomique (tout ou rien). */
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

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

type Row = Record<string, any>;

function botFromRow(r: Row): Bot {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    strategy: r.strategy,
    params: JSON.parse(r.params),
    symbols: JSON.parse(r.symbols),
    interval: r.interval,
    currency: r.currency,
    initialCapital: r.initial_capital,
    cash: r.cash,
    positionSizePct: r.position_size_pct,
    stopLossPct: r.stop_loss_pct,
    takeProfitPct: r.take_profit_pct,
    feePct: r.fee_pct,
    allowFractional: !!r.allow_fractional,
    startPrices: JSON.parse(r.start_prices),
    createdAt: r.started_at,
    lastTickAt: r.last_tick_at,
    lastError: r.last_error,
  };
}

export function listBots(): Bot[] {
  return (db.prepare('SELECT * FROM bots ORDER BY id DESC').all() as Row[]).map(botFromRow);
}

export function getBot(id: number): Bot | undefined {
  const row = db.prepare('SELECT * FROM bots WHERE id = ?').get(id) as Row | undefined;
  return row ? botFromRow(row) : undefined;
}

export function insertBot(cfg: BotConfig, currency: string, startPrices: Record<string, number>, now: number): number {
  const res = db
    .prepare(
      `INSERT INTO bots (name, strategy, params, symbols, interval, currency, initial_capital, cash,
         position_size_pct, stop_loss_pct, take_profit_pct, fee_pct, allow_fractional, start_prices, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      cfg.name,
      cfg.strategy,
      JSON.stringify(cfg.params),
      JSON.stringify(cfg.symbols),
      cfg.interval,
      currency,
      cfg.initialCapital,
      cfg.initialCapital,
      cfg.positionSizePct,
      cfg.stopLossPct,
      cfg.takeProfitPct,
      cfg.feePct,
      cfg.allowFractional ? 1 : 0,
      JSON.stringify(startPrices),
      now,
    );
  return Number(res.lastInsertRowid);
}

export function getBotState(id: number): BotState {
  const row = db.prepare('SELECT state FROM bots WHERE id = ?').get(id) as Row | undefined;
  const s = row ? JSON.parse(row.state) : {};
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

export function saveBotState(id: number, state: BotState): void {
  db.prepare('UPDATE bots SET state = ? WHERE id = ?').run(JSON.stringify(state), id);
}

export function setBotStatus(id: number, status: BotStatus): void {
  db.prepare('UPDATE bots SET status = ? WHERE id = ?').run(status, id);
}

export function setBotName(id: number, name: string): void {
  db.prepare('UPDATE bots SET name = ? WHERE id = ?').run(name, id);
}

export function setCash(id: number, cash: number): void {
  db.prepare('UPDATE bots SET cash = ? WHERE id = ?').run(cash, id);
}

export function setBotTick(id: number, time: number, error: string | null): void {
  db.prepare('UPDATE bots SET last_tick_at = ?, last_error = ? WHERE id = ?').run(time, error, id);
}

export function deleteBot(id: number): void {
  db.prepare('DELETE FROM bots WHERE id = ?').run(id);
}

/** Remet le bot à zéro : capital initial, aucune position, historique effacé. */
export function resetBot(id: number, startPrices: Record<string, number>, now: number): void {
  transaction(() => {
    for (const table of ['positions', 'trades', 'equity', 'logs']) db.prepare(`DELETE FROM ${table} WHERE bot_id = ?`).run(id);
    db.prepare(
      `UPDATE bots SET cash = initial_capital, state = '{}', start_prices = ?, started_at = ?, last_tick_at = NULL, last_error = NULL
       WHERE id = ?`,
    ).run(JSON.stringify(startPrices), now, id);
  });
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

export interface PositionRow {
  symbol: string;
  qty: number;
  entryPrice: number;
  costBasis: number;
  openedAt: number;
  lastPrice: number | null;
  lastPriceAt: number | null;
}

function positionFromRow(r: Row): PositionRow {
  return {
    symbol: r.symbol,
    qty: r.qty,
    entryPrice: r.entry_price,
    costBasis: r.cost_basis,
    openedAt: r.opened_at,
    lastPrice: r.last_price,
    lastPriceAt: r.last_price_at,
  };
}

export function getPositions(botId: number): PositionRow[] {
  return (db.prepare('SELECT * FROM positions WHERE bot_id = ? ORDER BY opened_at').all(botId) as Row[]).map(positionFromRow);
}

export function getPosition(botId: number, symbol: string): PositionRow | undefined {
  const row = db.prepare('SELECT * FROM positions WHERE bot_id = ? AND symbol = ?').get(botId, symbol) as Row | undefined;
  return row ? positionFromRow(row) : undefined;
}

export function insertPosition(botId: number, p: PositionRow): void {
  db.prepare(
    `INSERT INTO positions (bot_id, symbol, qty, entry_price, cost_basis, opened_at, last_price, last_price_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(botId, p.symbol, p.qty, p.entryPrice, p.costBasis, p.openedAt, p.lastPrice, p.lastPriceAt);
}

export function deletePosition(botId: number, symbol: string): void {
  db.prepare('DELETE FROM positions WHERE bot_id = ? AND symbol = ?').run(botId, symbol);
}

export function updatePositionPrice(botId: number, symbol: string, price: number, time: number): void {
  db.prepare('UPDATE positions SET last_price = ?, last_price_at = ? WHERE bot_id = ? AND symbol = ?').run(price, time, botId, symbol);
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

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

function tradeFromRow(r: Row): Trade {
  return {
    id: r.id,
    botId: r.bot_id,
    time: r.time,
    symbol: r.symbol,
    side: r.side,
    qty: r.qty,
    price: r.price,
    fees: r.fees,
    amount: r.amount,
    pnl: r.pnl,
    pnlPct: r.pnl_pct,
    reason: r.reason,
    trigger: r.trigger,
    cashAfter: r.cash_after,
  };
}

export function insertTrade(botId: number, t: NewTrade): number {
  const res = db
    .prepare(
      `INSERT INTO trades (bot_id, time, symbol, side, qty, price, fees, amount, pnl, pnl_pct, reason, trigger, cash_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(botId, t.time, t.symbol, t.side, t.qty, t.price, t.fees, t.amount, t.pnl, t.pnlPct, t.reason, t.trigger, t.cashAfter);
  return Number(res.lastInsertRowid);
}

export function listTrades(botId: number, symbol?: string): Trade[] {
  const rows = symbol
    ? db.prepare('SELECT * FROM trades WHERE bot_id = ? AND symbol = ? ORDER BY time DESC, id DESC').all(botId, symbol)
    : db.prepare('SELECT * FROM trades WHERE bot_id = ? ORDER BY time DESC, id DESC').all(botId);
  return (rows as Row[]).map(tradeFromRow);
}

export interface TradeTotals {
  count: number;
  fees: number;
  realizedPnl: number;
  closed: number;
  wins: number;
}

export function tradeTotals(botId: number): TradeTotals {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(fees), 0) AS fees, COALESCE(SUM(pnl), 0) AS realized,
              SUM(CASE WHEN side = 'SELL' THEN 1 ELSE 0 END) AS closed,
              SUM(CASE WHEN side = 'SELL' AND pnl > 0 THEN 1 ELSE 0 END) AS wins
       FROM trades WHERE bot_id = ?`,
    )
    .get(botId) as Row;
  return { count: r.count, fees: r.fees, realizedPnl: r.realized, closed: r.closed ?? 0, wins: r.wins ?? 0 };
}

// ---------------------------------------------------------------------------
// Valeur du portefeuille dans le temps
// ---------------------------------------------------------------------------

export function insertEquity(botId: number, p: EquityPoint): void {
  db.prepare('INSERT INTO equity (bot_id, time, equity, cash, benchmark) VALUES (?, ?, ?, ?, ?)').run(
    botId,
    p.time,
    p.equity,
    p.cash,
    p.benchmark,
  );
}

export function listEquity(botId: number): EquityPoint[] {
  return db.prepare('SELECT time, equity, cash, benchmark FROM equity WHERE bot_id = ? ORDER BY time').all(botId) as unknown as EquityPoint[];
}

export function lastEquity(botId: number): EquityPoint | undefined {
  return db.prepare('SELECT time, equity, cash, benchmark FROM equity WHERE bot_id = ? ORDER BY time DESC LIMIT 1').get(botId) as
    | EquityPoint
    | undefined;
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export function insertLog(botId: number, level: LogLevel, symbol: string | null, message: string, time = Date.now()): void {
  db.prepare('INSERT INTO logs (bot_id, time, level, symbol, message) VALUES (?, ?, ?, ?, ?)').run(botId, time, level, symbol, message);
}

export function listLogs(botId: number, limit: number, levels?: LogLevel[]): LogEntry[] {
  if (levels && levels.length) {
    const placeholders = levels.map(() => '?').join(',');
    return db
      .prepare(`SELECT id, time, level, symbol, message FROM logs WHERE bot_id = ? AND level IN (${placeholders}) ORDER BY id DESC LIMIT ?`)
      .all(botId, ...levels, limit) as unknown as LogEntry[];
  }
  return db
    .prepare('SELECT id, time, level, symbol, message FROM logs WHERE bot_id = ? ORDER BY id DESC LIMIT ?')
    .all(botId, limit) as unknown as LogEntry[];
}
