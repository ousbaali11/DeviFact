-- Export comptable programmé (25/09/2026) : tâche pg_cron quotidienne qui
-- appelle la fonction send-accounting-exports, sur le même modèle que la
-- tâche « send-payment-reminders-quotidien » déjà en place (net.http_post
-- avec l'en-tête x-cron-secret). La fonction n'envoie qu'à partir du 3 du
-- mois, pour la période précédente, une seule fois par période : l'appel
-- quotidien est donc sans effet les autres jours.
--
-- Les en-têtes (clé service et secret de cron) sont repris tels quels de la
-- tâche des relances, en remplaçant seulement le nom de la fonction : rien
-- de secret n'est écrit dans ce fichier. À lancer dans l'éditeur SQL
-- Supabase, après le déploiement de la fonction.

do $$
declare
  modele text;
begin
  select command into modele from cron.job where jobname = 'send-payment-reminders-quotidien';
  if modele is null then
    raise exception 'Tâche « send-payment-reminders-quotidien » introuvable : créer d''abord la tâche des relances.';
  end if;
  -- Idempotent : une tâche existante du même nom est remplacée.
  if exists (select 1 from cron.job where jobname = 'send-accounting-exports-quotidien') then
    perform cron.unschedule('send-accounting-exports-quotidien');
  end if;
  perform cron.schedule(
    'send-accounting-exports-quotidien',
    '30 6 * * *',   -- tous les jours à 06:30 UTC (08:30 en été, 07:30 en hiver à Paris)
    replace(modele, 'send-payment-reminders', 'send-accounting-exports')
  );
end $$;

-- Vérification attendue : la nouvelle tâche, active, avec l'horaire 30 6 * * *,
-- et une commande qui pointe vers .../functions/v1/send-accounting-exports.
select jobid, jobname, schedule, active, position('send-accounting-exports' in command) > 0 as bonne_fonction
from cron.job
where jobname in ('send-payment-reminders-quotidien', 'send-accounting-exports-quotidien')
order by jobid;
