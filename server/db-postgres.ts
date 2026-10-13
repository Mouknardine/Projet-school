// Implémentation Postgres de l'accès aux données (hébergement en ligne, ex. Supabase).
// Fonctionne avec Node.js et avec Deno (Edge Functions de Supabase).

import postgres from 'postgres';
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

/** Schéma de la base (les horodatages sont en millisecondes). */
export const POSTGRES_SCHEMA = `
create table if not exists bots (
  id                bigint generated always as identity primary key,
  name              text             not null,
  status            text             not null default 'running',
  strategy          text             not null,
  params            jsonb            not null,
  symbols           jsonb            not null,
  "interval"        text             not null,
  currency          text             not null,
  initial_capital   double precision not null,
  cash              double precision not null,
  position_size_pct double precision not null,
  stop_loss_pct     double precision not null,
  take_profit_pct   double precision not null,
  fee_pct           double precision not null,
  allow_fractional  boolean          not null,
  broker            text             not null default 'simple',
  start_prices      jsonb            not null,
  start_fx          jsonb            not null default '{}'::jsonb,
  max_loss_pct      double precision not null default 0,
  profile           jsonb,
  state             jsonb            not null default '{}'::jsonb,
  started_at        bigint           not null,
  last_tick_at      bigint,
  last_error        text,
  lock_until        bigint
);

create table if not exists positions (
  bot_id        bigint           not null references bots(id) on delete cascade,
  symbol        text             not null,
  qty           double precision not null,
  currency      text             not null default '',
  entry_price   double precision not null,
  entry_fx      double precision not null default 1,
  cost_basis    double precision not null,
  opened_at     bigint           not null,
  last_price    double precision,
  last_price_at bigint,
  last_fx       double precision not null default 1,
  primary key (bot_id, symbol)
);

create table if not exists trades (
  id         bigint generated always as identity primary key,
  bot_id     bigint           not null references bots(id) on delete cascade,
  time       bigint           not null,
  symbol     text             not null,
  side       text             not null,
  qty        double precision not null,
  price      double precision not null,
  currency   text             not null default '',
  fx_rate    double precision not null default 1,
  fees       double precision not null,
  costs      jsonb,
  amount     double precision not null,
  pnl        double precision,
  pnl_pct    double precision,
  reason     text             not null,
  "trigger"  text             not null,
  cash_after double precision not null
);
create index if not exists trades_bot_time on trades(bot_id, time);

create table if not exists equity (
  bot_id    bigint           not null references bots(id) on delete cascade,
  time      bigint           not null,
  equity    double precision not null,
  cash      double precision not null,
  benchmark double precision
);
create index if not exists equity_bot_time on equity(bot_id, time);

create table if not exists logs (
  id      bigint generated always as identity primary key,
  bot_id  bigint not null references bots(id) on delete cascade,
  time    bigint not null,
  level   text   not null,
  symbol  text,
  message text   not null
);
create index if not exists logs_bot_id on logs(bot_id, id);

-- Colonnes ajoutées après la première version (devises, change et détail des frais).
alter table bots add column if not exists broker text not null default 'simple';
alter table bots add column if not exists start_fx jsonb not null default '{}'::jsonb;
alter table bots add column if not exists max_loss_pct double precision not null default 0;
alter table bots add column if not exists profile jsonb;
alter table positions add column if not exists currency text not null default '';
alter table positions add column if not exists entry_fx double precision not null default 1;
alter table positions add column if not exists last_fx double precision not null default 1;
alter table trades add column if not exists currency text not null default '';
alter table trades add column if not exists fx_rate double precision not null default 1;
alter table trades add column if not exists costs jsonb;

-- Les tables ne sont accessibles qu'au serveur (aucun accès direct depuis le navigateur).
alter table bots enable row level security;
alter table positions enable row level security;
alter table trades enable row level security;
alter table equity enable row level security;
alter table logs enable row level security;
`;

type Sql = postgres.Sql | postgres.TransactionSql;

export async function ensurePostgresSchema(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(POSTGRES_SCHEMA);
}

export function createPostgresRepo(sql: Sql): Repo {
  const json = (v: unknown) => JSON.stringify(v);

  const repo: Repo = {
    async listBots() {
      return (await sql`select * from bots order by id desc`).map(botFromRow);
    },
    async getBot(id) {
      const [row] = await sql`select * from bots where id = ${id}`;
      return row ? botFromRow(row) : undefined;
    },
    async insertBot(cfg: BotConfig, startPrices, startFx, now) {
      const [row] = await sql`
        insert into bots (name, strategy, params, symbols, "interval", currency, initial_capital, cash,
          position_size_pct, stop_loss_pct, take_profit_pct, fee_pct, allow_fractional, broker, max_loss_pct, profile, start_prices, start_fx, started_at)
        values (${cfg.name}, ${cfg.strategy}, ${json(cfg.params)}::jsonb, ${json(cfg.symbols)}::jsonb, ${cfg.interval}, ${cfg.currency},
          ${cfg.initialCapital}, ${cfg.initialCapital}, ${cfg.positionSizePct}, ${cfg.stopLossPct}, ${cfg.takeProfitPct},
          ${cfg.feePct}, ${cfg.allowFractional}, ${cfg.broker}, ${cfg.maxLossPct ?? 0}, ${cfg.profile ? json(cfg.profile) : null}::jsonb,
          ${json(startPrices)}::jsonb, ${json(startFx)}::jsonb, ${now})
        returning id`;
      return Number(row.id);
    },
    async getBotState(id) {
      const [row] = await sql`select state from bots where id = ${id}`;
      return parseState(row?.state ?? {});
    },
    async saveBotState(id, state: BotState) {
      await sql`update bots set state = ${json(state)}::jsonb where id = ${id}`;
    },
    async setBotStatus(id, status) {
      await sql`update bots set status = ${status} where id = ${id}`;
    },
    async setBotName(id, name) {
      await sql`update bots set name = ${name} where id = ${id}`;
    },
    async setCash(id, cash) {
      await sql`update bots set cash = ${cash} where id = ${id}`;
    },
    async setBotTick(id, time, error) {
      await sql`update bots set last_tick_at = ${time}, last_error = ${error} where id = ${id}`;
    },
    async deleteBot(id) {
      await sql`delete from bots where id = ${id}`;
    },
    async resetBot(id, startPrices, startFx, now) {
      const exec = async (s: Sql) => {
        await s`delete from positions where bot_id = ${id}`;
        await s`delete from trades where bot_id = ${id}`;
        await s`delete from equity where bot_id = ${id}`;
        await s`delete from logs where bot_id = ${id}`;
        await s`update bots set cash = initial_capital, state = '{}'::jsonb, start_prices = ${json(startPrices)}::jsonb,
                 start_fx = ${json(startFx)}::jsonb, started_at = ${now}, last_tick_at = null, last_error = null where id = ${id}`;
      };
      if ('begin' in sql) await (sql as postgres.Sql).begin((tx) => exec(tx));
      else await exec(sql);
    },
    async tryLockBot(id, now, ttlMs) {
      const rows = await sql`update bots set lock_until = ${now + ttlMs}
        where id = ${id} and (lock_until is null or lock_until < ${now}) returning id`;
      return rows.length > 0;
    },
    async unlockBot(id) {
      await sql`update bots set lock_until = null where id = ${id}`;
    },

    async getPositions(botId) {
      return (await sql`select * from positions where bot_id = ${botId} order by opened_at`).map(positionFromRow);
    },
    async getPosition(botId, symbol) {
      const [row] = await sql`select * from positions where bot_id = ${botId} and symbol = ${symbol}`;
      return row ? positionFromRow(row) : undefined;
    },
    async insertPosition(botId, p: PositionRow) {
      await sql`insert into positions (bot_id, symbol, qty, currency, entry_price, entry_fx, cost_basis, opened_at, last_price, last_price_at, last_fx)
        values (${botId}, ${p.symbol}, ${p.qty}, ${p.currency}, ${p.entryPrice}, ${p.entryFx}, ${p.costBasis}, ${p.openedAt}, ${p.lastPrice},
          ${p.lastPriceAt}, ${p.lastFx})`;
    },
    async deletePosition(botId, symbol) {
      await sql`delete from positions where bot_id = ${botId} and symbol = ${symbol}`;
    },
    async updatePositionPrice(botId, symbol, price, fx, time) {
      await sql`update positions set last_price = ${price}, last_fx = ${fx}, last_price_at = ${time} where bot_id = ${botId} and symbol = ${symbol}`;
    },

    async insertTrade(botId, t: NewTrade) {
      const [row] = await sql`
        insert into trades (bot_id, time, symbol, side, qty, price, currency, fx_rate, fees, costs, amount, pnl, pnl_pct, reason, "trigger", cash_after)
        values (${botId}, ${t.time}, ${t.symbol}, ${t.side}, ${t.qty}, ${t.price}, ${t.currency}, ${t.fxRate}, ${t.fees}, ${json(t.costs)}::jsonb,
          ${t.amount}, ${t.pnl}, ${t.pnlPct}, ${t.reason}, ${t.trigger}, ${t.cashAfter})
        returning id`;
      return Number(row.id);
    },
    async listTrades(botId, symbol) {
      const rows = symbol
        ? await sql`select * from trades where bot_id = ${botId} and symbol = ${symbol} order by time desc, id desc`
        : await sql`select * from trades where bot_id = ${botId} order by time desc, id desc`;
      return rows.map(tradeFromRow);
    },
    async tradeTotals(botId) {
      const [r] = await sql`
        select count(*)::int as count,
               coalesce(sum(fees), 0)::float8 as fees,
               coalesce(sum(pnl), 0)::float8 as realized,
               (count(*) filter (where side = 'SELL'))::int as closed,
               (count(*) filter (where side = 'SELL' and pnl > 0))::int as wins
        from trades where bot_id = ${botId}`;
      return { count: Number(r.count), fees: Number(r.fees), realizedPnl: Number(r.realized), closed: Number(r.closed), wins: Number(r.wins) };
    },

    async insertEquity(botId, p: EquityPoint) {
      await sql`insert into equity (bot_id, time, equity, cash, benchmark) values (${botId}, ${p.time}, ${p.equity}, ${p.cash}, ${p.benchmark})`;
    },
    async listEquity(botId) {
      return (await sql`select time, equity, cash, benchmark from equity where bot_id = ${botId} order by time`).map(equityFromRow);
    },
    async lastEquity(botId) {
      const [row] = await sql`select time, equity, cash, benchmark from equity where bot_id = ${botId} order by time desc limit 1`;
      return row ? equityFromRow(row) : undefined;
    },

    async insertLog(botId, level: LogLevel, symbol, message, time = Date.now()) {
      await sql`insert into logs (bot_id, time, level, symbol, message) values (${botId}, ${time}, ${level}, ${symbol}, ${message})`;
    },
    async listLogs(botId, limit, levels) {
      const rows =
        levels && levels.length
          ? await sql`select id, time, level, symbol, message from logs
              where bot_id = ${botId} and level = any(${levels}::text[]) order by id desc limit ${limit}`
          : await sql`select id, time, level, symbol, message from logs where bot_id = ${botId} order by id desc limit ${limit}`;
      return rows.map(logFromRow);
    },

    async transaction(fn) {
      // Déjà dans une transaction : on la réutilise.
      if (!('begin' in sql)) return fn(repo);
      return (await (sql as postgres.Sql).begin((tx) => fn(createPostgresRepo(tx)))) as Awaited<ReturnType<typeof fn>>;
    },
  };
  return repo;
}
