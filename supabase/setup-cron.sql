-- À exécuter une fois dans l'éditeur SQL de Supabase, après avoir déployé la fonction « api ».
-- Remplacez <PROJECT_REF> par l'identifiant de votre projet (visible dans l'URL du tableau de bord Supabase).

-- 1. Secrets (choisissez vos propres valeurs) :
insert into app_settings (key, value) values
  ('admin_password', 'choisissez-un-mot-de-passe'),
  ('cron_secret', encode(gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- 2. Le bot analyse le marché chaque minute :
select cron.schedule(
  'tradebot-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/api/cron/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_settings where key = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
