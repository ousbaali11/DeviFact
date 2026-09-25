-- Factures reçues des fournisseurs et sous-traitants (priorité 6 de la
-- feuille de route, 25/09/2026) — à lancer dans l'éditeur SQL Supabase.
--
-- Bucket privé « purchase-files » pour le scan de chaque facture reçue
-- (PDF, JPG, PNG, 10 Mo maximum), chemin <organisation>/<document>/<fichier>.
-- Politiques : lecture par les membres de l'organisation (liens signés),
-- ajout et suppression par les éditeurs — même modèle que les fichiers
-- produits (my_editable_organization_ids()).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('purchase-files', 'purchase-files', false, 10485760, '{application/pdf,image/jpeg,image/png}')
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = '{application/pdf,image/jpeg,image/png}';

drop policy if exists "Factures reçues : lecture par les membres" on storage.objects;
create policy "Factures reçues : lecture par les membres"
on storage.objects for select to authenticated
using (bucket_id = 'purchase-files' and (storage.foldername(name))[1] in (select public.my_organization_ids()::text));

drop policy if exists "Factures reçues : ajout par les éditeurs" on storage.objects;
create policy "Factures reçues : ajout par les éditeurs"
on storage.objects for insert to authenticated
with check (bucket_id = 'purchase-files' and array_length(storage.foldername(name), 1) = 2 and (storage.foldername(name))[1] in (select public.my_editable_organization_ids()::text));

drop policy if exists "Factures reçues : suppression par les éditeurs" on storage.objects;
create policy "Factures reçues : suppression par les éditeurs"
on storage.objects for delete to authenticated
using (bucket_id = 'purchase-files' and (storage.foldername(name))[1] in (select public.my_editable_organization_ids()::text));

-- Vérification attendue : le bucket « purchase-files » privé (10485760,
-- trois types) et trois politiques « Factures reçues : … ».
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'purchase-files';
select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'Factures reçues%' order by 1;
