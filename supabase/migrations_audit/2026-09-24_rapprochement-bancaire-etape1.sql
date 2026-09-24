-- Rapprochement bancaire, livraison 1 (24/09/2026) : opérations bancaires
-- importées depuis un relevé (CSV, OFX, CAMT.053), rapprochées avec les
-- factures. Disponible pour tous les forfaits, Gratuit compris.
--
-- Une ligne par opération et par organisation ; l'empreinte (date, montant,
-- libellé, référence) évite les doublons quand le même relevé est importé
-- deux fois. Les sources suivantes (Qonto, agrégateur DSP2) écriront dans la
-- même table avec une autre valeur de « source ».
--
-- À lancer dans l'éditeur SQL Supabase. Réutilise my_organization_ids() et
-- my_editable_organization_ids() (voir 2026-09-13_gestion-de-stock.sql) et
-- touch_updated_at().

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source text not null default 'import',            -- import | qonto | aggregator
  fingerprint text not null,
  booked_at date not null,
  amount numeric(12, 2) not null,                    -- positif = crédit (encaissement)
  currency text not null default 'EUR',
  label text not null default '',
  counterparty text not null default '',
  reference text not null default '',
  status text not null default 'a_traiter'
    check (status in ('a_traiter', 'rapproche', 'ignore')),
  document_id text,                                  -- facture rapprochée (identifiant JSON)
  payment_id text,                                   -- paiement ajouté sur la facture
  matched_by text check (matched_by is null or matched_by in ('auto', 'manuel')),
  import_batch text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists bank_transactions_org_fingerprint_key
  on public.bank_transactions (organization_id, fingerprint);
create index if not exists bank_transactions_org_status_idx
  on public.bank_transactions (organization_id, status, booked_at desc);
create index if not exists bank_transactions_document_idx
  on public.bank_transactions (organization_id, document_id);

drop trigger if exists bank_transactions_touch_updated_at on public.bank_transactions;
create trigger bank_transactions_touch_updated_at
  before update on public.bank_transactions
  for each row execute function public.touch_updated_at();

alter table public.bank_transactions enable row level security;

drop policy if exists "Opérations bancaires : lecture par les membres" on public.bank_transactions;
create policy "Opérations bancaires : lecture par les membres"
  on public.bank_transactions for select
  using (organization_id in (select public.my_organization_ids()));

drop policy if exists "Opérations bancaires : écriture par les éditeurs" on public.bank_transactions;
create policy "Opérations bancaires : écriture par les éditeurs"
  on public.bank_transactions for all
  using (organization_id in (select public.my_editable_organization_ids()))
  with check (organization_id in (select public.my_editable_organization_ids()));

-- Vérification attendue : deux politiques (select, all) et trois index.
select policyname, cmd from pg_policies where tablename = 'bank_transactions' order by cmd;
select indexname from pg_indexes where tablename = 'bank_transactions' order by indexname;
