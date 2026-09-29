-- Super PDP, étape 4 (30/09/2026) : journal des envois — à lancer dans
-- l'éditeur SQL Supabase, après les scripts des étapes 1 à 3.
--
-- Une ligne par événement : dépôt d'une pièce, échec ou refus, événement
-- relu chez Super PDP, encaissement transmis. Écrit uniquement par les
-- fonctions serveur (clé de service), lu par tous les membres actifs de
-- l'organisation. Jamais purgé : il sert de preuve.

create table if not exists public.pdp_journal (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id     text not null,
  doc_number      text not null default '',
  pdp_invoice_id  bigint,
  source          text not null check (source in ('envoi', 'relecture', 'encaissement', 'erreur')),
  status_code     text not null default '',
  status_text     text not null default '',
  detail          text not null default '',
  actor           uuid references auth.users(id) on delete set null,   -- membre à l'origine ; null = tâche planifiée
  created_at      timestamptz not null default now()
);
create index if not exists pdp_journal_org_idx on public.pdp_journal (organization_id, created_at desc);
create index if not exists pdp_journal_doc_idx on public.pdp_journal (organization_id, document_id, created_at desc);

alter table public.pdp_journal enable row level security;
drop policy if exists "pdp_journal_select_members" on public.pdp_journal;
create policy "pdp_journal_select_members"
  on public.pdp_journal for select
  using (organization_id in (select public.my_organization_ids()));
-- Aucune politique d'écriture : seules les fonctions serveur (clé de service) écrivent.
