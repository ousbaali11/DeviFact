-- Stripe Connect, livraison 1 : base et écran de connexion — 22 septembre 2026
--
-- Chaque organisation peut avoir un compte Stripe connecté (l'artisan
-- encaisse ses factures sur son propre compte, jamais sur celui de la
-- plateforme). Configuration validée : tableau de bord Stripe complet pour
-- l'artisan, frais Stripe payés par l'artisan, Stripe responsable des
-- soldes négatifs et de la collecte des informations (ancien « Standard »).
--
-- Ces colonnes ne sont écrites que par la fonction Edge connect-onboarding
-- (clé de service) : un déclencheur refuse toute modification venant d'un
-- utilisateur connecté, même propriétaire — sinon, la règle « Le
-- propriétaire modifie son organisation » lui permettrait de se déclarer
-- « paiements actifs » sans compte Stripe réel.
--
-- À exécuter dans l'éditeur SQL de Supabase (projet ieshjvzmpbxtqielhaii),
-- en une fois. Script rejouable sans effet de bord.

-- 1. Colonnes ----------------------------------------------------------------
alter table public.organizations
  add column if not exists stripe_account_id text,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false,
  add column if not exists stripe_connect_updated_at timestamptz;

create unique index if not exists organizations_stripe_account_id_key
  on public.organizations (stripe_account_id)
  where stripe_account_id is not null;

-- 2. Protection : colonnes Stripe Connect réservées au serveur ---------------
-- auth.role() vaut 'authenticated' ou 'anon' pour un appel via l'API,
-- 'service_role' pour les fonctions Edge, et null depuis l'éditeur SQL ou
-- une migration (session sans jeton) : seuls les appels API d'utilisateurs
-- sont refusés.
create or replace function public.protect_stripe_connect_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.stripe_account_id is distinct from old.stripe_account_id
      or new.stripe_charges_enabled is distinct from old.stripe_charges_enabled
      or new.stripe_payouts_enabled is distinct from old.stripe_payouts_enabled
      or new.stripe_details_submitted is distinct from old.stripe_details_submitted
      or new.stripe_connect_updated_at is distinct from old.stripe_connect_updated_at)
     and auth.role() is not null and auth.role() <> 'service_role' then
    raise exception 'Les informations Stripe Connect ne sont modifiables que par le serveur'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_protect_stripe_connect on public.organizations;
create trigger organizations_protect_stripe_connect
  before update on public.organizations
  for each row execute function public.protect_stripe_connect_columns();

-- 3. Vérification -------------------------------------------------------------
-- Attendu : cinq colonnes stripe_account_id, stripe_charges_enabled,
-- stripe_connect_updated_at, stripe_details_submitted, stripe_payouts_enabled,
-- puis une ligne pour le déclencheur.
select column_name, data_type, column_default from information_schema.columns
where table_name = 'organizations' and column_name like 'stripe_%'
  and column_name not in ('stripe_subscription_id', 'stripe_customer_id')
order by column_name;
select tgname from pg_trigger where tgname = 'organizations_protect_stripe_connect';
