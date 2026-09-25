-- Super PDP, étape 2 (26/09/2026) : envoi d'une facture — à lancer dans
-- l'éditeur SQL Supabase, après le script de l'étape 1.
--
-- pdp_invoices : une ligne par facture transmise (ou en cours d'envoi) :
-- identifiant Super PDP, environnement, règle de traitement, dernier statut,
-- dernier événement lu (étape 3), dernière erreur. Écrite par les fonctions
-- serveur seulement (clé de service) ; lecture par les membres de
-- l'organisation.

create table if not exists public.pdp_invoices (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id text not null,
  pdp_invoice_id bigint,
  env text not null check (env in ('sandbox', 'production')),
  processing_rule text,
  external_id text,
  status_code text not null default 'api:sending',
  status_text text,
  sent_at timestamptz,
  last_event_id bigint not null default 0,
  last_event_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, document_id)
);
create index if not exists pdp_invoices_pdp_invoice_id_idx on public.pdp_invoices (pdp_invoice_id);
drop trigger if exists pdp_invoices_touch_updated_at on public.pdp_invoices;
create trigger pdp_invoices_touch_updated_at
  before update on public.pdp_invoices
  for each row execute function public.touch_updated_at();
alter table public.pdp_invoices enable row level security;
drop policy if exists "Factures Super PDP : lecture par les membres" on public.pdp_invoices;
create policy "Factures Super PDP : lecture par les membres"
  on public.pdp_invoices for select
  using (organization_id in (select public.my_organization_ids()));
revoke insert, update, delete on public.pdp_invoices from anon, authenticated;

-- Vérification attendue : la table avec RLS et une seule politique (SELECT).
select c.relname as table_name, c.relrowsecurity as rls, (select string_agg(p.policyname || ' (' || p.cmd || ')', ', ') from pg_policies p where p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'pdp_invoices';
