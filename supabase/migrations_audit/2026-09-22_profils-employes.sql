-- Profils des employés (page Équipe) — 22 septembre 2026
--
-- Chaque membre d'une organisation peut avoir un nom complet, un poste ou
-- une spécialité et un téléphone. Ces informations vivent sur
-- l'appartenance (organization_members), pas sur le profil personnel : une
-- même personne peut avoir un poste différent dans deux organisations.
--
-- À exécuter dans l'éditeur SQL de Supabase (projet ieshjvzmpbxtqielhaii),
-- en une fois. Script rejouable sans effet de bord.

-- 1. Colonnes ----------------------------------------------------------------
alter table public.organization_members
  add column if not exists full_name text,
  add column if not exists job_title text,
  add column if not exists phone text;

-- 2. Liste des membres avec leur profil --------------------------------------
-- Même fonction qu'avant (même vérification : l'appelant doit être membre
-- actif de l'organisation), avec les trois nouvelles colonnes en plus.
-- Le type de retour change, donc suppression puis recréation.
drop function if exists public.get_organization_members_with_profiles(uuid);
create function public.get_organization_members_with_profiles(org_id uuid)
returns table (id uuid, user_id uuid, role text, status text, email text, company_name text, full_name text, job_title text, phone text)
language sql
stable
security definer
set search_path = public
as $$
  select om.id, om.user_id, om.role, om.status, p.email, p.company_name, om.full_name, om.job_title, om.phone
  from public.organization_members om
  left join public.profiles p on p.id = om.user_id
  where om.organization_id = org_id
    and org_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  order by om.created_at asc;
$$;
grant execute on function public.get_organization_members_with_profiles(uuid) to authenticated;

-- 3. Modification du profil d'un membre --------------------------------------
-- Autorisée au propriétaire de l'organisation (n'importe quel membre) et à
-- chaque membre pour sa propre ligne. Seules ces trois colonnes sont
-- touchées : un membre ne peut pas changer son rôle ni son statut par ce
-- biais (la règle « Le propriétaire gère les membres » reste la seule voie).
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
  if not caller_is_owner and target.user_id is distinct from auth.uid() then
    raise exception 'Modification non autorisée' using errcode = '42501';
  end if;
  update public.organization_members
  set full_name = nullif(trim(coalesce(new_full_name, '')), ''),
      job_title = nullif(trim(coalesce(new_job_title, '')), ''),
      phone = nullif(trim(coalesce(new_phone, '')), '')
  where id = member_id;
  return true;
end;
$$;
grant execute on function public.update_member_profile(uuid, text, text, text) to authenticated;

-- 4. Vérification -------------------------------------------------------------
-- Attendu : trois lignes (full_name, job_title, phone) puis deux fonctions.
select column_name, data_type from information_schema.columns
where table_name = 'organization_members' and column_name in ('full_name', 'job_title', 'phone')
order by column_name;
select p.proname, pg_get_function_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('get_organization_members_with_profiles', 'update_member_profile')
order by 1;
