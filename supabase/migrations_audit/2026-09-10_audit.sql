-- Migration issue de l'audit du 2026-09-10 (décisions du 3e tour).
-- Appliquée via `supabase db query --linked -f`.

-- ============================================================
-- 1. Tâches automatiques : un seul secret partagé (celui déjà utilisé
--    par cleanup-unconfirmed-accounts, qui fonctionne) et le même
--    en-tête Authorization pour les quatre appels.
-- ============================================================
do $$
declare
  ref_cmd  text;
  auth_val text;
  secret   text;
begin
  select command into ref_cmd from cron.job where jobname = 'cleanup-unconfirmed-accounts-quotidien';
  auth_val := substring(ref_cmd from '''Authorization'', ''([^'']+)''');
  secret   := substring(ref_cmd from '''x-cron-secret'', ''([^'']+)''');
  if auth_val is null or secret is null then
    raise exception 'Tâche de référence introuvable ou format inattendu';
  end if;

  -- process-recurring-invoices et send-payment-reminders : même appel,
  -- seul le secret change.
  perform cron.alter_job(
    j.jobid,
    command := regexp_replace(j.command, '(''x-cron-secret'', '')[^'']+', '\1' || secret)
  )
  from cron.job j
  where j.jobname in ('process-recurring-invoices-quotidien', 'send-payment-reminders-quotidien');

  -- sync-indices-france : même Authorization que les autres + ajout de
  -- l'en-tête x-cron-secret (la fonction l'exige désormais).
  perform cron.alter_job(
    j.jobid,
    command := regexp_replace(
      regexp_replace(j.command, '(''Authorization'', '')[^'']+', '\1' || auth_val),
      '(''Content-Type'', ''application/json'')',
      '\1,' || E'\n      ''x-cron-secret'', ''' || secret || ''''
    )
  )
  from cron.job j
  where j.jobname = 'sync-indices-france-mensuel'
    and j.command not like '%x-cron-secret%';
end $$;

-- ============================================================
-- 2. Indices : modification réellement réservée aux admins (la
--    condition était `true`, donc ouverte à tout utilisateur connecté).
-- ============================================================
alter policy "Modification des valeurs réservée aux admins" on public.official_indices
  using (is_current_user_admin()) with check (is_current_user_admin());
alter policy "Modification des indices réservée aux admins" on public.tracked_indices
  using (is_current_user_admin()) with check (is_current_user_admin());

-- ============================================================
-- 3. organizations : le déclencheur existant protège aussi expires_at,
--    subscription_cancelled et activated_via_free_button. Même règle
--    que pour plan/payment_status : seul un admin ou le serveur
--    (fonctions Edge en clé service, tâche quotidienne — auth.uid()
--    vide) peut les modifier. Une seule exception, indispensable au
--    bouton "Activer (0€)" du site : passer activated_via_free_button
--    à TRUE reste permis (ça ne fait qu'ajouter une contrainte au compte).
-- ============================================================
create or replace function public.validate_paid_status_change()
returns trigger
language plpgsql
security definer
as $function$
declare
  monthly numeric;
  annual numeric;
  caller_is_admin boolean;
begin
  caller_is_admin := auth.uid() is null or exists (
    select 1 from public.profiles where id = auth.uid() and is_admin = true
  );

  if new.payment_status = 'payé' and new.plan <> 'gratuit'
     and (old.payment_status is distinct from new.payment_status or old.plan is distinct from new.plan or old.billing_cycle is distinct from new.billing_cycle) then

    select monthly_price, annual_price into monthly, annual
    from public.plans
    where id = new.plan;

    -- Vérifie les DEUX prix à la fois plutôt que seulement celui du
    -- cycle demandé — sans ça, un forfait mal configuré (un des deux
    -- prix resté vide par erreur) pourrait être contourné en
    -- choisissant délibérément le cycle dont le prix est vide.
    -- Un forfait n'est considéré comme réellement gratuit QUE si les
    -- deux prix sont à 0 (ou vides).
    if coalesce(monthly, 0) > 0 or coalesce(annual, 0) > 0 then
      if not caller_is_admin then
        raise exception 'Impossible d''activer ce forfait payant (%) sans passer par un vrai paiement.', new.plan;
      end if;
    end if;
  end if;

  -- Colonnes d'abonnement gérées uniquement par le serveur (webhooks
  -- Stripe/PayPal, résiliation, tâche quotidienne) ou un admin.
  if old.expires_at is distinct from new.expires_at
     or old.subscription_cancelled is distinct from new.subscription_cancelled
     or (old.activated_via_free_button is distinct from new.activated_via_free_button
         and new.activated_via_free_button is not true) then
    if not caller_is_admin then
      raise exception 'Ces informations d''abonnement ne peuvent être modifiées que par le serveur ou un administrateur.';
    end if;
  end if;

  return new;
end;
$function$;

-- ============================================================
-- 4 et 5. profiles : confirmed_at, confirmation_token et email ne
--    peuvent jamais être modifiés depuis le site (rôles "authenticated"
--    et "anon"), quel que soit le compte. Les mécanismes légitimes
--    continuent de fonctionner : confirm_account (SECURITY DEFINER,
--    s'exécute en tant que postgres), fonctions Edge en clé service
--    (rôle service_role), SQL direct.
--    confirmation_token est inclus : sans ça, un utilisateur pourrait
--    poser son propre jeton puis appeler confirm_account avec.
--    Volontairement SANS "security definer" : le déclencheur doit voir
--    le vrai rôle de l'appelant.
-- ============================================================
create or replace function public.protect_profile_identity_columns()
returns trigger
language plpgsql
as $function$
begin
  if (old.confirmed_at is distinct from new.confirmed_at
      or old.confirmation_token is distinct from new.confirmation_token
      or old.email is distinct from new.email)
     and current_user in ('authenticated', 'anon') then
    raise exception 'Ces informations du profil ne peuvent pas être modifiées depuis le site.';
  end if;
  return new;
end;
$function$;

drop trigger if exists check_profile_identity_columns on public.profiles;
create trigger check_profile_identity_columns
  before update on public.profiles
  for each row execute function public.protect_profile_identity_columns();

-- ============================================================
-- 6. Doublon sans effet : deux policies INSERT identiques sur organizations.
-- ============================================================
drop policy if exists "Un utilisateur peut créer une organisation" on public.organizations;
