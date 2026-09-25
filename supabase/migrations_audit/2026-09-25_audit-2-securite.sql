-- Second audit (25/09/2026, chantiers livrés depuis le premier audit) —
-- corrections côté base, à lancer dans l'éditeur SQL Supabase.
--
-- 1. Fiche entreprise (kv_store, clé company-profile) : le verrou
--    « propriétaire seulement » (IBAN, BIC, export comptable, attestations)
--    ne portait que sur la MODIFICATION. Un éditeur pouvait supprimer la
--    ligne puis la réinsérer avec ses propres coordonnées bancaires (les
--    clients auraient alors viré sur son compte) ou une autre adresse
--    d'expert-comptable. Désormais : suppression réservée au propriétaire,
--    insertion par un non-propriétaire refusée dès qu'elle porte l'un de ces
--    champs.
-- 2. Clés d'état écrites par le serveur (review-request-state,
--    accounting-export-state) : plus aucune écriture depuis une session
--    utilisateur (les limites d'envoi ne se contournent plus).
-- 3. Code de parrainage : l'octet 6 d'un UUID v4 porte le numéro de version
--    (16 valeurs au lieu de 32) ; on prend les octets 0-5, 7 et 8.

create or replace function public.protect_kv_store_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k text := coalesce(new.key, old.key);
  org uuid := coalesce(new.organization_id, old.organization_id);
  caller_is_owner boolean;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    return coalesce(new, old);
  end if;
  if k in ('review-request-state', 'accounting-export-state') then
    raise exception 'Cette information est gérée par le serveur.' using errcode = '42501';
  end if;
  if k = 'company-profile' and tg_op in ('INSERT', 'DELETE') then
    select exists (
      select 1 from public.organization_members
      where organization_id = org and user_id = auth.uid() and role = 'owner' and status = 'active'
    ) into caller_is_owner;
    if not caller_is_owner then
      if tg_op = 'DELETE' then
        raise exception 'La fiche entreprise ne peut être supprimée que par le propriétaire.' using errcode = '42501';
      end if;
      if coalesce(new.value->>'iban', '') <> ''
         or coalesce(new.value->>'bic', '') <> ''
         or (new.value ? 'accountingExport' and coalesce(new.value->'accountingExport', '{}'::jsonb) <> '{}'::jsonb)
         or (jsonb_typeof(new.value->'attestations') = 'array' and jsonb_array_length(new.value->'attestations') > 0) then
        raise exception 'IBAN, BIC, export comptable et attestations : modifiables par le propriétaire seulement' using errcode = '42501';
      end if;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists kv_store_protect_writes on public.kv_store;
create trigger kv_store_protect_writes
before insert or update or delete on public.kv_store
for each row execute function public.protect_kv_store_writes();

create or replace function public.generate_referral_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  positions constant int[] := array[0, 1, 2, 3, 4, 5, 7, 8]; -- l'octet 6 porte la version de l'UUID
  code text;
  bytes bytea;
  i int;
begin
  loop
    bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    code := '';
    foreach i in array positions loop
      code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where referral_code = code);
  end loop;
  return code;
end;
$$;
revoke execute on function public.generate_referral_code() from public, anon, authenticated;

-- Vérification attendue : les triggers kv_store_protect_writes et
-- kv_store_protect_owner_only_company_fields présents sur kv_store.
select tgname from pg_trigger where tgrelid = 'public.kv_store'::regclass and not tgisinternal order by 1;
