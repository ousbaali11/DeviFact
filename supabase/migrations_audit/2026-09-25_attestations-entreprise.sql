-- Attestations et assurances de l'entreprise (priorité 5 de la feuille de
-- route, 25/09/2026) — à lancer dans l'éditeur SQL Supabase.
--
-- 1. Bucket privé « company-files » : PDF, JPG, PNG, 10 Mo maximum, un
--    dossier par organisation (<organisation>/attestations/<fichier>).
-- 2. Politiques : lecture par les membres de l'organisation (liens signés),
--    ajout et suppression par le PROPRIÉTAIRE seulement (même niveau que
--    l'IBAN : my_owned_organization_ids()).
-- 3. Trigger de la fiche entreprise : la liste des attestations
--    (value->'attestations') est elle aussi réservée au propriétaire.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-files', 'company-files', false, 10485760, '{application/pdf,image/jpeg,image/png}')
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = '{application/pdf,image/jpeg,image/png}';

drop policy if exists "Fichiers entreprise : lecture par les membres" on storage.objects;
create policy "Fichiers entreprise : lecture par les membres"
on storage.objects for select to authenticated
using (bucket_id = 'company-files' and (storage.foldername(name))[1] in (select public.my_organization_ids()::text));

drop policy if exists "Fichiers entreprise : ajout par le propriétaire" on storage.objects;
create policy "Fichiers entreprise : ajout par le propriétaire"
on storage.objects for insert to authenticated
with check (bucket_id = 'company-files' and array_length(storage.foldername(name), 1) = 2 and (storage.foldername(name))[2] = 'attestations' and (storage.foldername(name))[1] in (select public.my_owned_organization_ids()::text));

drop policy if exists "Fichiers entreprise : suppression par le propriétaire" on storage.objects;
create policy "Fichiers entreprise : suppression par le propriétaire"
on storage.objects for delete to authenticated
using (bucket_id = 'company-files' and (storage.foldername(name))[1] in (select public.my_owned_organization_ids()::text));

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
     or coalesce(old.value->'accountingExport', 'null'::jsonb) is distinct from coalesce(new.value->'accountingExport', 'null'::jsonb)
     or coalesce(old.value->'attestations', 'null'::jsonb) is distinct from coalesce(new.value->'attestations', 'null'::jsonb) then
    raise exception 'IBAN, BIC, export comptable et attestations : modifiables par le propriétaire seulement' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Vérification attendue : le bucket « company-files » privé (10485760,
-- trois types), et trois politiques « Fichiers entreprise : … ».
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'company-files';
select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'Fichiers entreprise%' order by 1;
