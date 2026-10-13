// Implémentation SQLite (fichier local) de l'accès aux données.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BotConfig, EquityPoint, LogLevel } from '../shared/types.ts';
import {
  botFromRow,
  equityFromRow,
  logFromRow,
  parseState,
  positionFromRow,
  tradeFromRow,
  type BotState,
  type NewTrade,
  type PositionRow,
  type Repo,
} from './repo.ts';

const SCHEMA = `
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
  broker            TEXT    NOT NULL DEFAULT 'simple',
  start_prices      TEXT    NOT NULL,
  start_fx          TEXT    NOT NULL DEFAULT '{}',
  max_loss_pct      REAL    NOT NULL DEFAULT 0,
  profile           TEXT,
  state             TEXT    NOT NULL DEFAULT '{}',
  started_at        INTEGER NOT NULL,
  last_tick_at      INTEGER,
  last_error        TEXT,
  lock_until        INTEGER
);

CREATE TABLE IF NOT EXISTS positions (
  bot_id        INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  symbol        TEXT    NOT NULL,
  qty           REAL    NOT NULL,
  currency      TEXT    NOT NULL DEFAULT '',
  entry_price   REAL    NOT NULL,
  entry_fx      REAL    NOT NULL DEFAULT 1,
  cost_basis    REAL    NOT NULL,
  opened_at     INTEGER NOT NULL,
  last_price    REAL,
  last_price_at INTEGER,
  last_fx       REAL    NOT NULL DEFAULT 1,
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
  currency   TEXT    NOT NULL DEFAULT '',
  fx_rate    REAL    NOT NULL DEFAULT 1,
  fees       REAL    NOT NULL,
  costs      TEXT,
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
`;

type Row = Record<string, any>;

export function createSqliteRepo(dbPath: string): Repo {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // Base créée par une ancienne version : ajoute les colonnes manquantes.
  const addColumns = (table: string, defs: Record<string, string>) => {
    const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((c) => c.name);
    for (const [name, def] of Object.entries(defs)) if (!columns.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  };
  addColumns('bots', {
    lock_until: 'INTEGER',
    broker: "TEXT NOT NULL DEFAULT 'simple'",
    start_fx: "TEXT NOT NULL DEFAULT '{}'",
    max_loss_pct: 'REAL NOT NULL DEFAULT 0',
    profile: 'TEXT',
  });
  addColumns('positions', { currency: "TEXT NOT NULL DEFAULT ''", entry_fx: 'REAL NOT NULL DEFAULT 1', last_fx: 'REAL NOT NULL DEFAULT 1' });
  addColumns('trades', { currency: "TEXT NOT NULL DEFAULT ''", fx_rate: 'REAL NOT NULL DEFAULT 1', costs: 'TEXT' });

  const run = (sql: string, ...params: any[]) => db.prepare(sql).run(...params);
  const get = (sql: string, ...params: any[]) => db.prepare(sql).get(...params) as Row | undefined;
  const all = (sql: string, ...params: any[]) => db.prepare(sql).all(...params) as Row[];
  let depth = 0;

  const repo: Repo = {
    async listBots() {
      return all('SELECT * FROM bots ORDER BY id DESC').map(botFromRow);
    },
    async getBot(id) {
      const row = get('SELECT * FROM bots WHERE id = ?', id);
      return row ? botFromRow(row) : undefined;
    },
    async insertBot(cfg: BotConfig, startPrices, startFx, now) {
      const res = run(
        `INSERT INTO bots (name, strategy, params, symbols, interval, currency, initial_capital, cash,
           position_size_pct, stop_loss_pct, take_profit_pct, fee_pct, allow_fractional, broker, max_loss_pct, profile, start_prices, start_fx, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        cfg.name,
        cfg.strategy,
        JSON.stringify(cfg.params),
        JSON.stringify(cfg.symbols),
        cfg.interval,
        cfg.currency,
        cfg.initialCapital,
        cfg.initialCapital,
        cfg.positionSizePct,
        cfg.stopLossPct,
        cfg.takeProfitPct,
        cfg.feePct,
        cfg.allowFractional ? 1 : 0,
        cfg.broker,
        cfg.maxLossPct ?? 0,
        cfg.profile ? JSON.stringify(cfg.profile) : null,
        JSON.stringify(startPrices),
        JSON.stringify(startFx),
        now,
      );
      return Number(res.lastInsertRowid);
    },
    async getBotState(id) {
      return parseState(get('SELECT state FROM bots WHERE id = ?', id)?.state ?? '{}');
    },
    async saveBotState(id, state: BotState) {
      run('UPDATE bots SET state = ? WHERE id = ?', JSON.stringify(state), id);
    },
    async setBotStatus(id, status) {
      run('UPDATE bots SET status = ? WHERE id = ?', status, id);
    },
    async setBotName(id, name) {
      run('UPDATE bots SET name = ? WHERE id = ?', name, id);
    },
    async setBotProfile(id, profile) {
      run('UPDATE bots SET profile = ? WHERE id = ?', JSON.stringify(profile), id);
    },
    async setCash(id, cash) {
      run('UPDATE bots SET cash = ? WHERE id = ?', cash, id);
    },
    async setBotTick(id, time, error) {
      run('UPDATE bots SET last_tick_at = ?, last_error = ? WHERE id = ?', time, error, id);
    },
    async deleteBot(id) {
      run('DELETE FROM bots WHERE id = ?', id);
    },
    async resetBot(id, startPrices, startFx, now) {
      await repo.transaction(async () => {
        for (const table of ['positions', 'trades', 'equity', 'logs']) run(`DELETE FROM ${table} WHERE bot_id = ?`, id);
        run(
          `UPDATE bots SET cash = initial_capital, state = '{}', start_prices = ?, start_fx = ?, started_at = ?, last_tick_at = NULL, last_error = NULL
           WHERE id = ?`,
          JSON.stringify(startPrices),
          JSON.stringify(startFx),
          now,
          id,
        );
      });
    },
    async tryLockBot(id, now, ttlMs) {
      const res = run('UPDATE bots SET lock_until = ? WHERE id = ? AND (lock_until IS NULL OR lock_until < ?)', now + ttlMs, id, now);
      return Number(res.changes) > 0;
    },
    async unlockBot(id) {
      run('UPDATE bots SET lock_until = NULL WHERE id = ?', id);
    },

    async getPositions(botId) {
      return all('SELECT * FROM positions WHERE bot_id = ? ORDER BY opened_at', botId).map(positionFromRow);
    },
    async getPosition(botId, symbol) {
      const row = get('SELECT * FROM positions WHERE bot_id = ? AND symbol = ?', botId, symbol);
      return row ? positionFromRow(row) : undefined;
    },
    async insertPosition(botId, p: PositionRow) {
      run(
        `INSERT INTO positions (bot_id, symbol, qty, currency, entry_price, entry_fx, cost_basis, opened_at, last_price, last_price_at, last_fx)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        botId,
        p.symbol,
        p.qty,
        p.currency,
        p.entryPrice,
        p.entryFx,
        p.costBasis,
        p.openedAt,
        p.lastPrice,
        p.lastPriceAt,
        p.lastFx,
      );
    },
    async deletePosition(botId, symbol) {
      run('DELETE FROM positions WHERE bot_id = ? AND symbol = ?', botId, symbol);
    },
    async updatePositionPrice(botId, symbol, price, fx, time) {
      run('UPDATE positions SET last_price = ?, last_fx = ?, last_price_at = ? WHERE bot_id = ? AND symbol = ?', price, fx, time, botId, symbol);
    },

    async insertTrade(botId, t: NewTrade) {
      const res = run(
        `INSERT INTO trades (bot_id, time, symbol, side, qty, price, currency, fx_rate, fees, costs, amount, pnl, pnl_pct, reason, trigger, cash_after)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        botId,
        t.time,
        t.symbol,
        t.side,
        t.qty,
        t.price,
        t.currency,
        t.fxRate,
        t.fees,
        JSON.stringify(t.costs),
        t.amount,
        t.pnl,
        t.pnlPct,
        t.reason,
        t.trigger,
        t.cashAfter,
      );
      return Number(res.lastInsertRowid);
    },
    async listTrades(botId, symbol) {
      const rows = symbol
        ? all('SELECT * FROM trades WHERE bot_id = ? AND symbol = ? ORDER BY time DESC, id DESC', botId, symbol)
        : all('SELECT * FROM trades WHERE bot_id = ? ORDER BY time DESC, id DESC', botId);
      return rows.map(tradeFromRow);
    },
    async tradeTotals(botId) {
      const r = get(
        `SELECT COUNT(*) AS count, COALESCE(SUM(fees), 0) AS fees, COALESCE(SUM(pnl), 0) AS realized,
                SUM(CASE WHEN side = 'SELL' THEN 1 ELSE 0 END) AS closed,
                SUM(CASE WHEN side = 'SELL' AND pnl > 0 THEN 1 ELSE 0 END) AS wins
         FROM trades WHERE bot_id = ?`,
        botId,
      ) as Row;
      return { count: Number(r.count), fees: Number(r.fees), realizedPnl: Number(r.realized), closed: Number(r.closed ?? 0), wins: Number(r.wins ?? 0) };
    },

    async insertEquity(botId, p: EquityPoint) {
      run('INSERT INTO equity (bot_id, time, equity, cash, benchmark) VALUES (?, ?, ?, ?, ?)', botId, p.time, p.equity, p.cash, p.benchmark);
    },
    async listEquity(botId) {
      return all('SELECT time, equity, cash, benchmark FROM equity WHERE bot_id = ? ORDER BY time', botId).map(equityFromRow);
    },
    async lastEquity(botId) {
      const row = get('SELECT time, equity, cash, benchmark FROM equity WHERE bot_id = ? ORDER BY time DESC LIMIT 1', botId);
      return row ? equityFromRow(row) : undefined;
    },

    async insertLog(botId, level: LogLevel, symbol, message, time = Date.now()) {
      run('INSERT INTO logs (bot_id, time, level, symbol, message) VALUES (?, ?, ?, ?, ?)', botId, time, level, symbol, message);
    },
    async listLogs(botId, limit, levels) {
      const rows =
        levels && levels.length
          ? all(
              `SELECT id, time, level, symbol, message FROM logs WHERE bot_id = ? AND level IN (${levels.map(() => '?').join(',')}) ORDER BY id DESC LIMIT ?`,
              botId,
              ...levels,
              limit,
            )
          : all('SELECT id, time, level, symbol, message FROM logs WHERE bot_id = ? ORDER BY id DESC LIMIT ?', botId, limit);
      return rows.map(logFromRow);
    },

    async transaction(fn) {
      // Les requêtes SQLite sont synchrones : une transaction imbriquée rejoint simplement la transaction en cours.
      if (depth > 0) return fn(repo);
      depth++;
      db.exec('BEGIN');
      try {
        const result = await fn(repo);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        depth--;
      }
    },
  };
  return repo;
}
