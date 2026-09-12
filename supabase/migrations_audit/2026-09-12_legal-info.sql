-- ============================================================================
-- Informations légales modifiables depuis Admin → Informations légales
-- ----------------------------------------------------------------------------
-- Une seule colonne JSON sur la ligne unique de site_settings : chaque clé
-- correspond à un champ du formulaire Admin (SIRET, adresse, hébergeur,
-- paragraphes validés par un professionnel…). Lecture publique déjà
-- couverte par la règle existante « Les paramètres du site sont publics en
-- lecture » ; écriture réservée aux admins par la règle existante.
-- Rejouable sans risque.
-- ============================================================================

alter table public.site_settings
  add column if not exists legal_info jsonb not null default '{}'::jsonb;

-- Vérification
select id, legal_info from public.site_settings;
