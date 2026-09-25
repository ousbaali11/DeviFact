-- Interface unique (25/09/2026) : la colonne site_settings.landing_page_version
-- n'est plus lue ni écrite par le site. Suppression définitive (décision du
-- 26/09/2026) — à lancer dans l'éditeur SQL Supabase.
alter table public.site_settings drop column if exists landing_page_version;

-- Vérification attendue : la colonne n'apparaît plus.
select column_name from information_schema.columns where table_schema = 'public' and table_name = 'site_settings' order by 1;
