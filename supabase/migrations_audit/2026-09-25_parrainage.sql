-- Programme de parrainage (priorité 11 de la feuille de route, 25/09/2026)
-- — à lancer dans l'éditeur SQL Supabase.
--
-- 1. Deux colonnes sur profiles : referral_code (code unique du compte,
--    8 caractères sans ambiguïté : ni 0, O, 1, I) et referred_by /
--    referred_at (le parrain et la date). Code généré à la création du
--    profil (déclencheur handle_new_user) et rempli pour les comptes
--    existants.
-- 2. Ces colonnes sont gérées par le serveur seulement : un utilisateur qui
--    modifie son profil ne peut pas les changer (trigger).
-- 3. my_referrals() : les filleuls du compte connecté (entreprise ou
--    prénom, date d'inscription), jamais leur e-mail.

alter table public.profiles add column if not exists referral_code text;
alter table public.profiles add column if not exists referred_by uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists referred_at timestamptz;
create unique index if not exists profiles_referral_code_key on public.profiles (referral_code);

create or replace function public.generate_referral_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  bytes bytea;
  i int;
begin
  loop
    bytes := gen_random_bytes(8);
    code := '';
    for i in 0..7 loop
      code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where referral_code = code);
  end loop;
  return code;
end;
$$;
revoke execute on function public.generate_referral_code() from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, confirmation_token, referral_code)
  values (new.id, new.email, gen_random_uuid(), public.generate_referral_code())
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Comptes existants : un code chacun, ligne par ligne (unicité vérifiée à
-- chaque tirage).
do $$
declare r record;
begin
  for r in select id from public.profiles where referral_code is null loop
    update public.profiles set referral_code = public.generate_referral_code() where id = r.id;
  end loop;
end;
$$;

create or replace function public.protect_referral_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
     and (old.referral_code is distinct from new.referral_code
          or old.referred_by is distinct from new.referred_by
          or old.referred_at is distinct from new.referred_at) then
    raise exception 'Parrainage : ces informations sont gérées par le serveur.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_protect_referral on public.profiles;
create trigger profiles_protect_referral
before update on public.profiles
for each row execute function public.protect_referral_columns();

create or replace function public.my_referrals()
returns table(label text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(trim(p.company_name), ''), nullif(trim(p.first_name), ''), 'Un nouvel artisan') as label, p.created_at
  from public.profiles p
  where p.referred_by = auth.uid()
  order by p.created_at desc;
$$;
revoke execute on function public.my_referrals() from public, anon;
grant execute on function public.my_referrals() to authenticated, service_role;

-- Vérification attendue : aucun profil sans code, tous les codes distincts,
-- le trigger profiles_protect_referral présent.
select count(*) as profils, count(referral_code) as avec_code, count(distinct referral_code) as codes_distincts from public.profiles;
select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal order by 1;
