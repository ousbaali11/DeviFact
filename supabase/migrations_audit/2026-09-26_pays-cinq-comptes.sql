-- Pays de la fiche Mon entreprise pour cinq comptes (26/09/2026) — à lancer
-- dans l'éditeur SQL Supabase après vérification des comptes listés.
--
-- Constat en base (lecture du 26/09) : seul ousbaali11@gmail.com a une fiche
-- entreprise enregistrée (pays déjà 🇫🇷 FR, rien à changer). Les quatre
-- autres n'ont jamais enregistré Mon entreprise : aucune ligne
-- company-profile. Le script crée alors une fiche minimale (type entreprise,
-- nom vide, pays), que l'utilisateur complétera ; une fiche existante n'est
-- modifiée que sur le pays, et seulement s'il diffère.
--
-- Valeur du pays : le même format que le sélecteur du site (drapeau + code).

with cibles(email, pays) as (
  values
    ('ousbaali11@gmail.com',        '🇫🇷 FR'),
    ('hassan.simou1993@gmail.com',  '🇫🇷 FR'),
    ('ouderrou.d@gmail.com',        '🇲🇦 MA'),
    ('oulaarabi.b@hotmail.com',     '🇲🇦 MA'),
    ('rachidbaaly@gmail.com',       '🇲🇦 MA')
),
orgs as (
  select distinct m.organization_id, c.pays
  from cibles c
  join public.profiles p on lower(p.email) = c.email
  join public.organization_members m on m.user_id = p.id and m.role = 'owner' and m.status = 'active'
)
insert into public.kv_store (organization_id, key, shared, value, created_by, updated_at)
select organization_id, 'company-profile', false,
       jsonb_build_object('type', 'entreprise', 'name', '', 'country', pays),
       null, now()
from orgs
on conflict (organization_id, key, shared) do update
  set value = kv_store.value || jsonb_build_object('country', excluded.value->>'country'),
      updated_at = now()
  where coalesce(kv_store.value->>'country', '') <> excluded.value->>'country';

-- Vérification attendue : les cinq comptes avec le pays voulu.
select p.email, o.name as organisation, kv.value->>'name' as entreprise, kv.value->>'country' as pays
from public.profiles p
join public.organization_members m on m.user_id = p.id and m.role = 'owner'
left join public.organizations o on o.id = m.organization_id
left join public.kv_store kv on kv.organization_id = m.organization_id and kv.key = 'company-profile' and kv.shared = false
where lower(p.email) in ('ousbaali11@gmail.com', 'hassan.simou1993@gmail.com', 'ouderrou.d@gmail.com', 'oulaarabi.b@hotmail.com', 'rachidbaaly@gmail.com')
order by p.email;
