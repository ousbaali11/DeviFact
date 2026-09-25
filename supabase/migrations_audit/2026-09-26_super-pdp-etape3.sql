-- Super PDP, étape 3 (26/09/2026) : suivi des factures transmises — à lancer
-- dans l'éditeur SQL Supabase, après les scripts des étapes 1 et 2.
--
-- 1. pdp_invoices.paid_event_at : date de l'événement d'encaissement (fr:212)
--    transmis à Super PDP.
-- 2. Tâche planifiée quotidienne « superpdp-sync-events-quotidien » à
--    07:00 UTC (09:00 en été, 08:00 en hiver à Paris), après les relances et
--    l'export comptable : construite sur le modèle de la tâche des relances
--    (mêmes en-têtes, même secret x-cron-secret), en remplaçant le nom de la
--    fonction. Idempotent : une tâche existante du même nom est remplacée.

alter table public.pdp_invoices add column if not exists paid_event_at timestamptz;

do $$
declare
  modele text;
begin
  select command into modele from cron.job where jobname = 'send-payment-reminders-quotidien';
  if modele is null then
    raise exception 'Tâche « send-payment-reminders-quotidien » introuvable : créer d''abord la tâche des relances.';
  end if;
  if exists (select 1 from cron.job where jobname = 'superpdp-sync-events-quotidien') then
    perform cron.unschedule('superpdp-sync-events-quotidien');
  end if;
  perform cron.schedule(
    'superpdp-sync-events-quotidien',
    '0 7 * * *',
    replace(modele, 'send-payment-reminders', 'superpdp-sync-events')
  );
end $$;

-- Vérification attendue : la tâche active, pointant sur superpdp-sync-events,
-- et la colonne paid_event_at présente.
select jobid, jobname, schedule, active, position('superpdp-sync-events' in command) > 0 as bonne_fonction
from cron.job where jobname = 'superpdp-sync-events-quotidien';
select column_name from information_schema.columns where table_schema = 'public' and table_name = 'pdp_invoices' and column_name = 'paid_event_at';
