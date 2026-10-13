-- Profil d'investisseur : limite de perte globale et réponses au questionnaire, gardées avec chaque bot.

alter table bots add column if not exists max_loss_pct double precision not null default 0;
alter table bots add column if not exists profile jsonb;
