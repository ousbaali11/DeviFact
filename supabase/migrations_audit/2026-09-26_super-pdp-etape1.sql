-- Super PDP, étape 1 (26/09/2026) : connexion OAuth du compte Super PDP de
-- chaque artisan — à lancer dans l'éditeur SQL Supabase.
--
-- 1. pdp_connections : une ligne par organisation. Les jetons (accès et
--    rafraîchissement) y sont CHIFFRÉS (AES-256-GCM, clé SUPERPDP_TOKEN_KEY
--    connue des seules fonctions serveur). Aucune règle d'accès pour les
--    utilisateurs : seule la clé de service lit et écrit ; le navigateur ne
--    reçoit qu'un état (connecté, nom, SIREN, bac à sable ou production)
--    par la fonction superpdp-oauth.
-- 2. pdp_oauth_states : états anti-usurpation et codes PKCE du flux
--    d'autorisation, valables 10 minutes, effacés après usage.

create table if not exists public.pdp_connections (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  provider text not null default 'superpdp',
  env text not null check (env in ('sandbox', 'production')),
  company_number text,
  company_number_scheme text,
  company_name text,
  vat_regime text,
  has_vat_on_debits boolean,
  verification_status text,
  access_token_enc text not null,
  access_expires_at timestamptz,
  refresh_token_enc text not null,
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz not null default now(),
  last_event_id bigint not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists pdp_connections_touch_updated_at on public.pdp_connections;
create trigger pdp_connections_touch_updated_at
  before update on public.pdp_connections
  for each row execute function public.touch_updated_at();
alter table public.pdp_connections enable row level security;
revoke all on public.pdp_connections from anon, authenticated;

create table if not exists public.pdp_oauth_states (
  state text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  code_verifier text not null,
  redirect_uri text not null,
  created_at timestamptz not null default now()
);
alter table public.pdp_oauth_states enable row level security;
revoke all on public.pdp_oauth_states from anon, authenticated;

-- Vérification attendue : les deux tables avec RLS activée et aucune
-- politique (accès par la clé de service uniquement).
select c.relname as table_name, c.relrowsecurity as rls, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('pdp_connections', 'pdp_oauth_states') order by 1;
