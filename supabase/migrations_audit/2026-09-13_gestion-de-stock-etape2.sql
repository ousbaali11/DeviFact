-- ============================================================================
-- Gestion de stock — étape 2 : prix de vente par entrepôt
-- ----------------------------------------------------------------------------
-- Complète le script du 2026-09-13 (étape 1). Une ligne par couple
-- produit / entrepôt quand la case « prix de vente différent selon
-- l'entrepôt » est cochée sur la fiche produit. Rejouable sans risque.
-- Même modèle de droits que products / warehouses.
-- ============================================================================

create table if not exists public.product_warehouse_prices (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  warehouse_id    uuid not null references public.warehouses(id) on delete cascade,
  sale_price_ht   numeric(14, 2) not null default 0 check (sale_price_ht >= 0),
  sale_price_ttc  numeric(14, 2) not null default 0 check (sale_price_ttc >= 0),
  updated_at      timestamptz not null default now(),
  primary key (product_id, warehouse_id)
);
create index if not exists product_warehouse_prices_org_idx on public.product_warehouse_prices (organization_id);

drop trigger if exists product_warehouse_prices_touch_updated_at on public.product_warehouse_prices;
create trigger product_warehouse_prices_touch_updated_at
  before update on public.product_warehouse_prices
  for each row execute function public.touch_updated_at();

alter table public.product_warehouse_prices enable row level security;

drop policy if exists "Prix par entrepôt : lecture par les membres" on public.product_warehouse_prices;
create policy "Prix par entrepôt : lecture par les membres"
  on public.product_warehouse_prices for select to authenticated
  using (organization_id in (select public.my_organization_ids()));

drop policy if exists "Prix par entrepôt : écriture par les éditeurs" on public.product_warehouse_prices;
create policy "Prix par entrepôt : écriture par les éditeurs"
  on public.product_warehouse_prices for all to authenticated
  using (organization_id in (select public.my_editable_organization_ids()))
  with check (organization_id in (select public.my_editable_organization_ids()));

-- Vérification : attendu 1 table avec RLS et 2 règles
select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'product_warehouse_prices';
select policyname, cmd from pg_policies where tablename = 'product_warehouse_prices' order by cmd;

-- Annulation : drop table if exists public.product_warehouse_prices;
