-- Collaborateurs sans accès (priorité 10 de la feuille de route,
-- 25/09/2026) — à lancer dans l'éditeur SQL Supabase.
--
-- Une fiche « collaborateur sans accès » est une ligne de
-- organization_members au rôle « staff » : un nom obligatoire, un poste et
-- un téléphone facultatifs, JAMAIS de compte (user_id) ni d'e-mail
-- d'invitation — impossible de s'en servir pour se connecter. La fonction
-- get_organization_members_with_profiles la renvoie comme les autres, et
-- la politique « Le propriétaire gère les membres » (ALL) couvre déjà
-- l'ajout, la modification et la suppression par le propriétaire. Les
-- fonctions my_organization_ids / my_editable_organization_ids
-- s'appuient sur user_id = auth.uid() : une fiche sans compte n'ouvre
-- aucun droit.

alter table public.organization_members drop constraint if exists organization_members_role_check;
alter table public.organization_members
  add constraint organization_members_role_check
  check (role = any (array['owner'::text, 'editor'::text, 'viewer'::text, 'comptable'::text, 'staff'::text]));

alter table public.organization_members drop constraint if exists member_identity;
alter table public.organization_members
  add constraint member_identity
  check (
    (role = 'staff' and user_id is null and invited_email is null and length(trim(coalesce(full_name, ''))) > 0)
    or (role <> 'staff' and (user_id is not null or invited_email is not null))
  );

-- Vérification attendue : les deux contraintes avec « staff ».
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.organization_members'::regclass and conname in ('organization_members_role_check', 'member_identity')
order by 1;
