-- Profil manquant (01/10/2026) : un compte peut exister dans auth.users sans
-- ligne dans public.profiles (ligne supprimée à la main dans l'éditeur de
-- table, ou création de compte interrompue). Le site affichait alors
-- « Ton compte est créé, mais ton espace n'est pas encore prêt » à chaque
-- connexion. Cette fonction recrée la ligne pour la personne connectée, à
-- partir de auth.users, sans toucher à une ligne existante.
--
-- À lancer dans l'éditeur SQL Supabase. Idempotente.
--
-- Rappel : pour supprimer un compte, passer par Authentication → Users (ou
-- la fonction cleanup-unconfirmed-accounts) ; supprimer seulement la ligne
-- de profiles laisse le compte et ses organisations en place.

create or replace function public.ensure_user_has_profile()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  user_email text;
  user_confirmed timestamptz;
begin
  if uid is null then
    raise exception 'Non connecté' using errcode = '42501';
  end if;
  select email, email_confirmed_at into user_email, user_confirmed from auth.users where id = uid;
  if user_email is null then
    raise exception 'Compte introuvable' using errcode = 'P0002';
  end if;
  -- Compte déjà confirmé côté authentification : le profil recréé est marqué
  -- confirmé, sinon la tâche de nettoyage des comptes non confirmés le
  -- supprimerait après 8 semaines.
  insert into public.profiles (id, email, confirmation_token, referral_code, confirmed_at)
  values (uid, user_email, gen_random_uuid(), public.generate_referral_code(), case when user_confirmed is not null then now() else null end)
  on conflict (id) do nothing;
  return uid;
end;
$$;

revoke all on function public.ensure_user_has_profile() from public;
grant execute on function public.ensure_user_has_profile() to authenticated;

-- Réparation immédiate des comptes existants sans profil (mêmes règles).
insert into public.profiles (id, email, confirmation_token, referral_code, confirmed_at)
select u.id, u.email, gen_random_uuid(), public.generate_referral_code(), case when u.email_confirmed_at is not null then now() else null end
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;
