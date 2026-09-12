-- ============================================================================
-- Gestion de stock — étape 1 : produits, entrepôts, mouvements, fichiers
-- ----------------------------------------------------------------------------
-- À exécuter une seule fois dans l'éditeur SQL du projet Supabase
-- (ieshjvzmpbxtqielhaii). Rejouable sans risque : « if not exists »
-- partout, règles remplacées à l'identique.
--
-- Ce script NE TOUCHE PAS à kv_store : la Bibliothèque de prestations
-- (clé « prestations ») reste intacte. La reprise des prestations dans
-- « products » est faite par l'application, de façon rejouable, grâce à
-- la colonne legacy_prestation_id (unique par organisation).
--
-- Accès : lecture pour tout membre actif (my_organization_ids), écriture
-- pour propriétaires et éditeurs (my_editable_organization_ids) — mêmes
-- fonctions que les règles existantes. La limitation aux forfaits Pro et
-- Entreprise est faite dans l'application (comme pour la Bibliothèque).
-- ============================================================================

-- 0. Horodatage de modification (fonction générique)
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. Entrepôts
-- ----------------------------------------------------------------------------
create table if not exists public.warehouses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 200),
  address         text not null default '',
  is_default      boolean not null default false,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists warehouses_org_idx on public.warehouses (organization_id);
-- Un seul entrepôt par défaut par organisation
create unique index if not exists warehouses_one_default_per_org
  on public.warehouses (organization_id) where is_default;

drop trigger if exists warehouses_touch_updated_at on public.warehouses;
create trigger warehouses_touch_updated_at
  before update on public.warehouses
  for each row execute function public.touch_updated_at();

alter table public.warehouses enable row level security;

drop policy if exists "Entrepôts : lecture par les membres" on public.warehouses;
create policy "Entrepôts : lecture par les membres"
  on public.warehouses for select to authenticated
  using (organization_id in (select public.my_organization_ids()));

drop policy if exists "Entrepôts : écriture par les éditeurs" on public.warehouses;
create policy "Entrepôts : écriture par les éditeurs"
  on public.warehouses for all to authenticated
  using (organization_id in (select public.my_editable_organization_ids()))
  with check (organization_id in (select public.my_editable_organization_ids()));

-- ----------------------------------------------------------------------------
-- 2. Produits (fusion de la Bibliothèque de prestations)
-- ----------------------------------------------------------------------------
create table if not exists public.products (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  -- Identité
  name                  text not null check (char_length(name) between 1 and 300),
  reference             text not null default '',          -- référence interne
  supplier_reference    text not null default '',
  description           text not null default '',
  tags                  text[] not null default '{}',
  category              text not null default '',          -- catégorie libre (reprise de la Bibliothèque)
  kind                  text not null default 'produit' check (kind in ('produit', 'service')),           -- Type
  nature                text not null default '' check (nature in ('', 'materiel', 'main_oeuvre', 'sous_traitance', 'frais')), -- Nature
  unit                  text not null default '',
  -- Vente
  sale_price_ht         numeric(14, 2) not null default 0 check (sale_price_ht >= 0),
  sale_vat_rate         numeric(5, 2)  not null default 20 check (sale_vat_rate >= 0 and sale_vat_rate <= 100),
  sale_price_ttc        numeric(14, 2) not null default 0 check (sale_price_ttc >= 0),
  currency              text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  price_per_warehouse   boolean not null default false,
  default_quantity      numeric(14, 3) not null default 1 check (default_quantity > 0),
  -- Achat
  purchase_price_ht     numeric(14, 2) not null default 0 check (purchase_price_ht >= 0),
  purchase_vat_rate     numeric(5, 2)  not null default 20 check (purchase_vat_rate >= 0 and purchase_vat_rate <= 100),
  purchase_price_ttc    numeric(14, 2) not null default 0 check (purchase_price_ttc >= 0),
  -- Stock
  quantity_restricted   boolean not null default false,    -- « en vente si stock positif »
  is_kit                boolean not null default false,    -- lot / kit
  -- Comptabilité
  account_sales         text not null default '',          -- compte comptable produits (vente)
  account_purchases     text not null default '',          -- compte comptable achats
  account_vat_sales     text not null default '',
  account_vat_purchases text not null default '',
  activity_code         text not null default '',
  journal_code          text not null default '',
  -- Divers
  custom_field          text not null default '',
  attachment_path       text,                               -- fichier dans le bucket product-files
  attachment_name       text,
  is_active             boolean not null default true,
  legacy_prestation_id  text,                               -- identifiant de la prestation d'origine (import rejouable)
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists products_org_idx on public.products (organization_id);
create index if not exists products_org_name_idx on public.products (organization_id, lower(name));
create unique index if not exists products_legacy_unique
  on public.products (organization_id, legacy_prestation_id) where legacy_prestation_id is not null;

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

alter table public.products enable row level security;

drop policy if exists "Produits : lecture par les membres" on public.products;
create policy "Produits : lecture par les membres"
  on public.products for select to authenticated
  using (organization_id in (select public.my_organization_ids()));

drop policy if exists "Produits : écriture par les éditeurs" on public.products;
create policy "Produits : écriture par les éditeurs"
  on public.products for all to authenticated
  using (organization_id in (select public.my_editable_organization_ids()))
  with check (organization_id in (select public.my_editable_organization_ids()));

-- ----------------------------------------------------------------------------
-- 3. Mouvements de stock (historique : le stock est toujours la somme)
-- ----------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  warehouse_id    uuid references public.warehouses(id) on delete set null,
  kind            text not null check (kind in ('entree', 'sortie', 'ajustement')),
  quantity        numeric(14, 3) not null check (quantity <> 0),   -- signée : + entrée, - sortie
  moved_at        timestamptz not null default now(),
  reason          text not null default '',                          -- motif / référence (optionnel)
  document_ref    text not null default '',                          -- document de stock rattaché (étape 2)
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists stock_movements_org_idx on public.stock_movements (organization_id, moved_at desc);
create index if not exists stock_movements_product_idx on public.stock_movements (product_id);

alter table public.stock_movements enable row level security;

drop policy if exists "Mouvements : lecture par les membres" on public.stock_movements;
create policy "Mouvements : lecture par les membres"
  on public.stock_movements for select to authenticated
  using (organization_id in (select public.my_organization_ids()));

drop policy if exists "Mouvements : ajout par les éditeurs" on public.stock_movements;
create policy "Mouvements : ajout par les éditeurs"
  on public.stock_movements for insert to authenticated
  with check (organization_id in (select public.my_editable_organization_ids()));

-- Pas de modification d'un mouvement (historique) ; suppression réservée
-- aux propriétaires, pour corriger une erreur de saisie.
drop policy if exists "Mouvements : suppression par le propriétaire" on public.stock_movements;
create policy "Mouvements : suppression par le propriétaire"
  on public.stock_movements for delete to authenticated
  using (organization_id in (select public.my_owned_organization_ids()));

-- ----------------------------------------------------------------------------
-- 4. Stock disponible = somme des mouvements (vue, RLS de l'appelant)
-- ----------------------------------------------------------------------------
create or replace view public.product_stock
with (security_invoker = true) as
  select
    m.organization_id,
    m.product_id,
    m.warehouse_id,
    sum(m.quantity)::numeric(14, 3) as quantity
  from public.stock_movements m
  group by m.organization_id, m.product_id, m.warehouse_id;

-- ----------------------------------------------------------------------------
-- 5. Pièces jointes des produits : bucket privé dédié (le bucket des photos
--    n'accepte que le JPEG). Chemin : <organization_id>/<product_id>/<fichier>
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-files', 'product-files', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Fichiers produits : lecture par les membres" on storage.objects;
create policy "Fichiers produits : lecture par les membres"
  on storage.objects for select to authenticated
  using (bucket_id = 'product-files'
         and (storage.foldername(name))[1] in (select public.my_organization_ids()::text));

drop policy if exists "Fichiers produits : ajout par les éditeurs" on storage.objects;
create policy "Fichiers produits : ajout par les éditeurs"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-files'
              and array_length(storage.foldername(name), 1) = 2
              and (storage.foldername(name))[1] in (select public.my_editable_organization_ids()::text));

drop policy if exists "Fichiers produits : suppression par les éditeurs" on storage.objects;
create policy "Fichiers produits : suppression par les éditeurs"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-files'
         and (storage.foldername(name))[1] in (select public.my_editable_organization_ids()::text));

-- ============================================================================
-- Vérification (à lancer après) — attendu : 3 tables avec RLS, 1 vue,
-- 6 règles sur les tables, 3 règles Storage, 1 bucket privé
-- ============================================================================
select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('products', 'warehouses', 'stock_movements');

select table_name from information_schema.views where table_schema = 'public' and table_name = 'product_stock';

select tablename, policyname, cmd
from pg_policies
where (schemaname = 'public' and tablename in ('products', 'warehouses', 'stock_movements'))
   or (schemaname = 'storage' and policyname like 'Fichiers produits%')
order by tablename, cmd;

select id, public, file_size_limit from storage.buckets where id = 'product-files';

-- ============================================================================
-- Annulation complète (si besoin) — la Bibliothèque (kv_store) n'est pas
-- concernée et reste intacte.
-- ============================================================================
-- drop view if exists public.product_stock;
-- drop table if exists public.stock_movements;
-- drop table if exists public.products;
-- drop table if exists public.warehouses;
-- drop policy if exists "Fichiers produits : lecture par les membres" on storage.objects;
-- drop policy if exists "Fichiers produits : ajout par les éditeurs" on storage.objects;
-- drop policy if exists "Fichiers produits : suppression par les éditeurs" on storage.objects;
-- delete from storage.buckets where id = 'product-files';  -- après avoir vidé le bucket
