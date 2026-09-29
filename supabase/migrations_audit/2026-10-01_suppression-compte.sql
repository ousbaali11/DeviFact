-- Suppression d'un compte depuis l'Admin (01/10/2026) — à lancer dans
-- l'éditeur SQL Supabase AVANT de déployer la fonction admin-delete-account.
--
-- 1. Deux pièges corrigés en base :
--    - kv_store.created_by (dernier auteur) supprimait EN CASCADE toutes les
--      données (documents, clients, fiche entreprise) de l'organisation dont
--      le compte supprimé était le dernier auteur, même si d'autres membres
--      restaient. La colonne devient nullable et passe en « mise à null ».
--    - api_keys.created_by et official_indices.updated_by n'avaient aucune
--      règle : la suppression d'un compte ayant créé une clé API ou mis à
--      jour un indice était refusée par la base. Idem : mise à null.
-- 2. Journal des suppressions account_deletions (lecture admin).
-- 3. delete_account_preview(uuid) : ce que la suppression entraînerait
--    (organisations dont le compte est le seul membre actif, avec le nombre
--    de documents et de clients ; autres organisations, non touchées).
-- Idempotent.

alter table public.kv_store alter column created_by drop not null;
alter table public.kv_store drop constraint if exists kv_store_created_by_fkey;
alter table public.kv_store add constraint kv_store_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table if exists public.api_keys drop constraint if exists api_keys_created_by_fkey;
alter table if exists public.api_keys add constraint api_keys_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table if exists public.official_indices drop constraint if exists official_indices_updated_by_fkey;
alter table if exists public.official_indices add constraint official_indices_updated_by_fkey
  foreign key (updated_by) references auth.users(id) on delete set null;

create table if not exists public.account_deletions (
  id                    bigint generated always as identity primary key,
  deleted_user_id       uuid not null,
  deleted_email         text not null,
  deleted_by            uuid references auth.users(id) on delete set null,
  deleted_at            timestamptz not null default now(),
  organizations_deleted jsonb not null default '[]'::jsonb,   -- [{id, name, documents, clients}]
  organizations_kept    jsonb not null default '[]'::jsonb,   -- organisations vides conservées à la demande de l'admin
  memberships_removed   jsonb not null default '[]'::jsonb    -- [{id, name, role}] où d'autres membres restent
);
alter table public.account_deletions enable row level security;
drop policy if exists "account_deletions_admin_select" on public.account_deletions;
create policy "account_deletions_admin_select"
  on public.account_deletions for select
  using (public.is_current_user_admin());
-- Aucune politique d'écriture : seule la fonction serveur (clé de service) écrit.

create or replace function public.delete_account_preview(target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  target_email text;
  target_admin boolean := false;
  sole jsonb;
  others jsonb;
begin
  if not public.is_current_user_admin() then
    raise exception 'Réservé aux administrateurs du site' using errcode = '42501';
  end if;
  select p.email, coalesce(p.is_admin, false) into target_email, target_admin from public.profiles p where p.id = target_user_id;
  if target_email is null then
    select u.email into target_email from auth.users u where u.id = target_user_id;
  end if;
  if target_email is null then
    raise exception 'Compte introuvable' using errcode = 'P0002';
  end if;

  -- Organisations dont le compte est le seul membre actif : supprimées avec
  -- leurs données si l'admin le demande.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'role', m.role,
      'documents', coalesce((select jsonb_array_length(k.value) from public.kv_store k where k.organization_id = o.id and k.key = 'documents' and jsonb_typeof(k.value) = 'array' limit 1), 0),
      'clients', coalesce((select jsonb_array_length(k.value) from public.kv_store k where k.organization_id = o.id and k.key = 'clients' and jsonb_typeof(k.value) = 'array' limit 1), 0)
    ) order by o.name), '[]'::jsonb)
  into sole
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = target_user_id and m.status = 'active'
    and not exists (select 1 from public.organization_members m2 where m2.organization_id = m.organization_id and m2.user_id <> target_user_id and m2.status = 'active');

  -- Autres organisations (d'autres membres restent) : seule l'appartenance est retirée.
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'role', m.role) order by o.name), '[]'::jsonb)
  into others
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = target_user_id and m.status = 'active'
    and exists (select 1 from public.organization_members m2 where m2.organization_id = m.organization_id and m2.user_id <> target_user_id and m2.status = 'active');

  return jsonb_build_object('email', target_email, 'isAdmin', target_admin, 'soleOrganizations', sole, 'otherOrganizations', others);
end;
$$;
revoke all on function public.delete_account_preview(uuid) from public;
grant execute on function public.delete_account_preview(uuid) to authenticated;
