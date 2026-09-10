-- ============================================================================
-- Photos de chantier — bucket privé « chantier-photos » + règles d'accès
-- ----------------------------------------------------------------------------
-- À exécuter une seule fois dans l'éditeur SQL du projet Supabase
-- (ieshjvzmpbxtqielhaii). Le script est rejouable sans risque : le bucket
-- n'est pas recréé s'il existe, les règles sont remplacées à l'identique.
--
-- Principe :
--   * bucket PRIVÉ : aucune adresse publique ; l'application demande des
--     liens signés (valables 1 h) à l'ouverture d'un document et avant
--     chaque PDF ;
--   * chemin de chaque fichier : <organization_id>/<document_id>/<id>.jpg ;
--   * lecture : tout membre actif de l'organisation (my_organization_ids) ;
--   * ajout / suppression : propriétaires et éditeurs uniquement
--     (my_editable_organization_ids) — les rôles lecteur et
--     expert-comptable consultent sans modifier, comme pour les documents ;
--   * fichiers acceptés : JPEG uniquement (l'application redimensionne
--     chaque photo à ~1600 px et la convertit en JPEG avant l'envoi),
--     5 Mo maximum par fichier ; l'application limite à 20 photos par
--     document.
-- ============================================================================

-- 1. Le bucket (privé)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chantier-photos', 'chantier-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Lecture (nécessaire aussi pour générer un lien signé) : membres actifs
drop policy if exists "Photos de chantier : lecture par les membres" on storage.objects;
create policy "Photos de chantier : lecture par les membres"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'chantier-photos'
    and (storage.foldername(name))[1] in (select my_organization_ids()::text)
  );

-- 3. Ajout : propriétaires et éditeurs, uniquement sous le dossier de leur
--    organisation, avec la structure <organisation>/<document>/<fichier>
drop policy if exists "Photos de chantier : ajout par les éditeurs" on storage.objects;
create policy "Photos de chantier : ajout par les éditeurs"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chantier-photos'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] in (select my_editable_organization_ids()::text)
  );

-- 4. Suppression : mêmes rôles, même périmètre
drop policy if exists "Photos de chantier : suppression par les éditeurs" on storage.objects;
create policy "Photos de chantier : suppression par les éditeurs"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'chantier-photos'
    and (storage.foldername(name))[1] in (select my_editable_organization_ids()::text)
  );

-- (Pas de règle UPDATE : l'application n'écrase jamais un fichier, elle en
--  ajoute ou en supprime. Sans règle, toute modification est refusée.)

-- ============================================================================
-- Vérification (à lancer après) — attendu : 1 bucket privé, 3 règles
-- ============================================================================
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'chantier-photos';

select policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'Photos de chantier%'
order by cmd;

-- ============================================================================
-- Annulation (si besoin) — supprime les règles puis le bucket (qui doit
-- être vide : supprimer d'abord ses fichiers depuis le tableau de bord).
-- ============================================================================
-- drop policy if exists "Photos de chantier : lecture par les membres" on storage.objects;
-- drop policy if exists "Photos de chantier : ajout par les éditeurs" on storage.objects;
-- drop policy if exists "Photos de chantier : suppression par les éditeurs" on storage.objects;
-- delete from storage.buckets where id = 'chantier-photos';
