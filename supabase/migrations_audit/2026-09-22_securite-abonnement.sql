-- Sécurité : colonnes d'abonnement réservées au serveur — 22 septembre 2026
--
-- La règle « Le propriétaire modifie son organisation » autorise un
-- propriétaire à mettre à jour sa ligne organizations. Le déclencheur
-- existant protège déjà plan / payment_status / expires_at /
-- subscription_cancelled. Restaient modifiables depuis le site :
-- stripe_subscription_id, stripe_customer_id, paypal_subscription_id et
-- paid_at. Un propriétaire pouvait ainsi rattacher à son organisation
-- l'identifiant d'abonnement d'une autre (les webhooks de renouvellement
-- auraient alors prolongé son accès) ou antidater paid_at. Ces colonnes ne
-- sont désormais modifiables que par le serveur (webhooks, fonctions) ou un
-- administrateur.
--
-- À exécuter dans l'éditeur SQL de Supabase (projet ieshjvzmpbxtqielhaii).
-- Script rejouable sans effet de bord.

create or replace function public.protect_subscription_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_admin boolean;
begin
  if (new.stripe_subscription_id is distinct from old.stripe_subscription_id
      or new.stripe_customer_id is distinct from old.stripe_customer_id
      or new.paypal_subscription_id is distinct from old.paypal_subscription_id
      or new.paid_at is distinct from old.paid_at) then
    -- Session sans jeton (éditeur SQL, migration) ou clé de service : autorisé.
    if auth.role() is null or auth.role() = 'service_role' then
      return new;
    end if;
    select exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) into caller_is_admin;
    if not caller_is_admin then
      raise exception 'Les identifiants d''abonnement ne sont modifiables que par le serveur ou un administrateur'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_protect_subscription on public.organizations;
create trigger organizations_protect_subscription
  before update on public.organizations
  for each row execute function public.protect_subscription_columns();

-- Vérification : attendu une ligne.
select tgname from pg_trigger where tgname = 'organizations_protect_subscription';
