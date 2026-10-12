-- Schéma de TradeBot pour Supabase (généré depuis server/db-postgres.ts).
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
  start_prices      jsonb            not null,
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
  entry_price   double precision not null,
  cost_basis    double precision not null,
  opened_at     bigint           not null,
  last_price    double precision,
  last_price_at bigint,
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
  fees       double precision not null,
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

-- Les tables ne sont accessibles qu'au serveur (aucun accès direct depuis le navigateur).
alter table bots enable row level security;
alter table positions enable row level security;
alter table trades enable row level security;
alter table equity enable row level security;
alter table logs enable row level security;

-- Réglages privés du serveur : mot de passe administrateur et secret du planificateur.
create table if not exists app_settings (
  key   text primary key,
  value text not null
);
alter table app_settings enable row level security;

-- Extensions pour lancer le bot chaque minute : pg_cron (planificateur) et pg_net (requêtes HTTP).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
