-- Sécurité : écriture des données d'organisation réservée aux éditeurs — 22 septembre 2026
--
-- La table kv_store porte les documents, les clients et le profil de
-- l'entreprise. Ses règles n'exigeaient que l'appartenance à l'organisation
-- pour écrire : un membre « lecteur » ou « expert-comptable » pouvait, hors
-- du site, réécrire tous les documents. Les écritures suivent désormais la
-- même règle que les produits et le stock (my_editable_organization_ids :
-- propriétaires et éditeurs), la lecture reste ouverte à tous les membres.
--
-- À exécuter dans l'éditeur SQL de Supabase (projet ieshjvzmpbxtqielhaii).
-- Script rejouable sans effet de bord.

drop policy if exists kv_store_insert_own_org on public.kv_store;
create policy kv_store_insert_own_org on public.kv_store
  for insert to authenticated
  with check (organization_id in (select public.my_editable_organization_ids()));

drop policy if exists kv_store_update_own_org on public.kv_store;
create policy kv_store_update_own_org on public.kv_store
  for update to authenticated
  using (organization_id in (select public.my_editable_organization_ids()))
  with check (organization_id in (select public.my_editable_organization_ids()));

drop policy if exists kv_store_delete_own_org on public.kv_store;
create policy kv_store_delete_own_org on public.kv_store
  for delete to authenticated
  using (organization_id in (select public.my_editable_organization_ids()));

-- Vérification : attendu quatre règles kv_store_* plus l'accès admin.
select policyname, cmd from pg_policies where tablename = 'kv_store' order by cmd;
