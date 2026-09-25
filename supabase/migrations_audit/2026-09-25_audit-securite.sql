-- Audit sécurité du 25/09/2026 — corrections côté base (à lancer dans
-- l'éditeur SQL Supabase). Vérifié sur la base réelle : RLS active sur les
-- 17 tables, vue product_stock en security_invoker, politiques par
-- organisation correctes. Deux points restaient :
--
-- 1. email_has_account(text) : fonction SECURITY DEFINER exécutable par
--    « anon » qui dit si une adresse a un compte. Elle n'est plus utilisée
--    par le site (l'inscription et la réinitialisation répondent de façon
--    neutre depuis l'audit du 22/09) et permettrait d'énumérer les
--    comptes. Exécution retirée à tout le monde sauf au serveur.
-- 2. Fonctions SECURITY DEFINER sans search_path figé (avertissement
--    « function_search_path_mutable » de Supabase) : tous leurs objets sont
--    déjà qualifiés (public., auth.), on fige quand même le chemin, comme
--    le font déjà get_organization_members_with_profiles et
--    update_member_profile.

revoke execute on function public.email_has_account(text) from public, anon, authenticated;

alter function public.confirm_account(uuid) set search_path = public;
alter function public.downgrade_expired_cancelled_subscriptions() set search_path = public;
alter function public.email_has_account(text) set search_path = public;
alter function public.ensure_user_has_organization(uuid, text) set search_path = public;
alter function public.handle_new_user() set search_path = public;
alter function public.is_current_user_admin() set search_path = public;
alter function public.my_editable_organization_ids() set search_path = public;
alter function public.my_organization_colleague_ids() set search_path = public;
alter function public.my_organization_ids() set search_path = public;
alter function public.my_owned_organization_ids() set search_path = public;
alter function public.organization_has_any_member(uuid) set search_path = public;
alter function public.prevent_unauthorized_admin_promotion() set search_path = public;
alter function public.prevent_unauthorized_plan_changes() set search_path = public;
alter function public.validate_paid_status_change() set search_path = public;
alter function public.validate_role_change() set search_path = public;

-- 3. ensure_user_has_organization(uuid, text) : exécutable par n'importe
--    quelle session (même anonyme) pour N'IMPORTE QUEL identifiant — on
--    exige que l'appelant agisse pour lui-même (le serveur, sans session,
--    reste libre) et on retire l'exécution à « anon ».
create or replace function public.ensure_user_has_organization(target_user_id uuid, fallback_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_org_id uuid;
  new_org_id uuid;
begin
  if auth.uid() is not null and auth.uid() <> target_user_id then
    raise exception 'Opération non autorisée' using errcode = '42501';
  end if;

  select organization_id into existing_org_id
  from public.organization_members
  where user_id = target_user_id and status = 'active'
  limit 1;
  if existing_org_id is not null then
    return existing_org_id;
  end if;

  perform pg_advisory_xact_lock(hashtext(target_user_id::text));

  select organization_id into existing_org_id
  from public.organization_members
  where user_id = target_user_id and status = 'active'
  limit 1;
  if existing_org_id is not null then
    return existing_org_id;
  end if;

  new_org_id := gen_random_uuid();
  insert into public.organizations (id, name) values (new_org_id, left(coalesce(fallback_name, ''), 120));
  insert into public.organization_members (organization_id, user_id, role, status)
  values (new_org_id, target_user_id, 'owner', 'active');
  return new_org_id;
end;
$$;
revoke execute on function public.ensure_user_has_organization(uuid, text) from public, anon;

-- 4. update_member_profile : longueurs bornées (nom 120, poste 120,
--    téléphone 40) et membre cible actif — un membre suspendu ou en attente
--    ne peut plus modifier sa fiche.
create or replace function public.update_member_profile(member_id uuid, new_full_name text, new_job_title text, new_phone text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.organization_members%rowtype;
  caller_is_owner boolean;
begin
  select * into target from public.organization_members where id = member_id;
  if not found then
    return false;
  end if;
  select exists (
    select 1 from public.organization_members
    where organization_id = target.organization_id and user_id = auth.uid() and role = 'owner' and status = 'active'
  ) into caller_is_owner;
  if not caller_is_owner and (target.user_id is distinct from auth.uid() or target.status <> 'active') then
    raise exception 'Modification non autorisée' using errcode = '42501';
  end if;
  update public.organization_members
  set full_name = nullif(left(trim(coalesce(new_full_name, '')), 120), ''),
      job_title = nullif(left(trim(coalesce(new_job_title, '')), 120), ''),
      phone = nullif(left(trim(coalesce(new_phone, '')), 40), '')
  where id = member_id;
  return true;
end;
$$;

-- 5. public_document_links : seuls les membres qui peuvent modifier
--    (owner, editor) créent des liens publics — un lecteur ne publie rien.
drop policy if exists "Les membres créent des liens pour leurs documents" on public.public_document_links;
create policy "Les membres éditeurs créent des liens pour leurs documents"
on public.public_document_links for insert to authenticated
with check (exists (
  select 1 from public.organization_members m
  where m.organization_id = public_document_links.organization_id
    and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'editor')
));

-- 6. validate_paid_status_change : un changement de forfait vers un forfait
--    payant est réservé au serveur / à un admin, quel que soit le statut de
--    paiement (avant : un propriétaire pouvait poser plan = 'entreprise'
--    avec payment_status = 'impayé' et passer les contrôles « forfait
--    Entreprise » de l'API).
create or replace function public.validate_paid_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  monthly numeric;
  annual numeric;
  caller_is_admin boolean;
begin
  caller_is_admin := auth.uid() is null or exists (
    select 1 from public.profiles where id = auth.uid() and is_admin = true
  );

  if new.plan <> 'gratuit'
     and (old.plan is distinct from new.plan or old.billing_cycle is distinct from new.billing_cycle
          or (new.payment_status = 'payé' and old.payment_status is distinct from new.payment_status)) then
    select monthly_price, annual_price into monthly, annual
    from public.plans
    where id = new.plan;
    -- Les DEUX prix : un forfait n'est gratuit que si les deux sont à 0.
    if coalesce(monthly, 0) > 0 or coalesce(annual, 0) > 0 then
      if not caller_is_admin then
        raise exception 'Impossible d''activer ce forfait payant (%) sans passer par un vrai paiement.', new.plan;
      end if;
    end if;
  end if;

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
$$;

-- 7. Fiche entreprise (kv_store, clé company-profile) : IBAN, BIC et
--    réglage d'export comptable modifiables par le propriétaire seulement
--    (le site grise ces champs, la base l'impose). Le serveur (sans
--    session) et la première création restent libres.
create or replace function public.protect_owner_only_company_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_owner boolean;
begin
  if auth.uid() is null then
    return new;
  end if;
  select exists (
    select 1 from public.organization_members
    where organization_id = new.organization_id and user_id = auth.uid() and role = 'owner' and status = 'active'
  ) into caller_is_owner;
  if caller_is_owner then
    return new;
  end if;
  if coalesce(old.value->>'iban', '') is distinct from coalesce(new.value->>'iban', '')
     or coalesce(old.value->>'bic', '') is distinct from coalesce(new.value->>'bic', '')
     or coalesce(old.value->'accountingExport', 'null'::jsonb) is distinct from coalesce(new.value->'accountingExport', 'null'::jsonb) then
    raise exception 'IBAN, BIC et réglage d''export comptable : modifiables par le propriétaire seulement' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists kv_store_protect_owner_only_company_fields on public.kv_store;
create trigger kv_store_protect_owner_only_company_fields
before update of value on public.kv_store
for each row when (new.key = 'company-profile')
execute function public.protect_owner_only_company_fields();

-- Vérification attendue : plus aucune fonction SECURITY DEFINER sans
-- search_path, email_has_account sans droit d'exécution pour anon /
-- authenticated, ensure_user_has_organization sans « anon= », et une seule
-- politique INSERT sur public_document_links (rôles owner/editor).
select p.proname, p.proconfig, p.proacl::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by 1;
select policyname, cmd, with_check from pg_policies where tablename = 'public_document_links' order by 1;
select tgname from pg_trigger where tgrelid = 'public.kv_store'::regclass and not tgisinternal order by 1;
