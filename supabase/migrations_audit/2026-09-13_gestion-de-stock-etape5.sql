-- Gestion de stock — étape 5 : marqueur « prix saisi inférieur au prix de
-- référence » posé côté serveur.
--
-- À chaque enregistrement du blob « documents » d'une organisation
-- (kv_store, key = 'documents', shared = false), chaque ligne d'article
-- liée à un produit (items[].productId) est comparée au prix de vente HT
-- de référence du produit (products.sale_price_ht) :
--   * prix saisi S < P  → items[].belowReferencePrice = true
--   * sinon             → le marqueur est retiré de la ligne
-- Le trigger ne refuse JAMAIS l'enregistrement : c'est un avertissement,
-- pas un blocage (règle métier validée). Il ne touche à rien d'autre
-- dans le document. Les blobs d'une autre clé sont ignorés.
--
-- Idempotent : peut être rejoué sans effet de bord.

create or replace function public.mark_below_reference_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_docs jsonb;
begin
  if new.key <> 'documents' or jsonb_typeof(new.value) <> 'array' then
    return new;
  end if;

  select coalesce(jsonb_agg(
    case
      when jsonb_typeof(d -> 'items') = 'array' then
        d || jsonb_build_object('items', (
          select coalesce(jsonb_agg(
            case
              when (i ->> 'productId') is not null
                   and p.sale_price_ht is not null
                   and (i ->> 'unitPrice') ~ '^-?[0-9]+([.,][0-9]+)?$'
                   and replace(i ->> 'unitPrice', ',', '.')::numeric < p.sale_price_ht
                then (i - 'belowReferencePrice') || '{"belowReferencePrice": true}'::jsonb
              else i - 'belowReferencePrice'
            end
            order by it.ord), '[]'::jsonb)
          from jsonb_array_elements(d -> 'items') with ordinality as it(i, ord)
          left join public.products p
            on p.organization_id = new.organization_id
           and (it.i ->> 'productId') ~ '^[0-9a-fA-F-]{36}$'
           and p.id = (it.i ->> 'productId')::uuid
        ))
      else d
    end
    order by dd.ord), '[]'::jsonb)
  into v_docs
  from jsonb_array_elements(new.value) with ordinality as dd(d, ord);

  new.value := v_docs;
  return new;
exception
  when others then
    -- Jamais bloquant : en cas d'imprévu, le document est enregistré tel quel.
    raise warning 'mark_below_reference_price ignoré : %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists kv_store_mark_below_reference_price on public.kv_store;
create trigger kv_store_mark_below_reference_price
  before insert or update of value on public.kv_store
  for each row
  when (new.key = 'documents')
  execute function public.mark_below_reference_price();

comment on function public.mark_below_reference_price() is
  'Gestion de stock étape 5 : pose items[].belowReferencePrice = true quand le prix unitaire saisi est inférieur au prix de vente HT du produit lié ; ne refuse jamais l''enregistrement.';
