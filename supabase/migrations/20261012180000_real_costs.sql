-- Coûts réels : devise du compte, taux de change et détail des frais de chaque ordre.

alter table bots add column if not exists broker text not null default 'simple';
alter table bots add column if not exists start_fx jsonb not null default '{}'::jsonb;
alter table positions add column if not exists currency text not null default '';
alter table positions add column if not exists entry_fx double precision not null default 1;
alter table positions add column if not exists last_fx double precision not null default 1;
alter table trades add column if not exists currency text not null default '';
alter table trades add column if not exists fx_rate double precision not null default 1;
alter table trades add column if not exists costs jsonb;

-- Les bots créés avant ce changement n'avaient qu'une seule devise : celle de leur compte, avec un taux de 1.
update positions p set currency = b.currency from bots b where p.bot_id = b.id and p.currency = '';
update trades t set currency = b.currency from bots b where t.bot_id = b.id and t.currency = '';
-- (start_prices peut être stocké comme texte JSON : on le décode si besoin.)
update bots set start_fx = coalesce(
  (select jsonb_object_agg(k, 1)
     from jsonb_object_keys(
       case
         when jsonb_typeof(start_prices) = 'object' then start_prices
         when jsonb_typeof((start_prices #>> '{}')::jsonb) = 'object' then (start_prices #>> '{}')::jsonb
         else '{}'::jsonb
       end) k),
  '{}'::jsonb)
where start_fx = '{}'::jsonb;
