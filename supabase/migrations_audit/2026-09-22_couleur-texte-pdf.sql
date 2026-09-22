-- Couleur du texte des PDF, séparée de la couleur des bandeaux — 22 septembre 2026
--
-- Jusqu'ici, le réglage Admin « En-tête de tableau » (pdf_header_color)
-- colorait à la fois les bandeaux (en-tête du tableau, totaux, filets) et
-- tout le texte des PDF. Nouveau réglage « Texte » (pdf_text_color),
-- indépendant ; sombre par défaut, comme avant.
--
-- À exécuter dans l'éditeur SQL de Supabase (projet ieshjvzmpbxtqielhaii).
-- Sans ce script, l'enregistrement de la page Admin > Identité du site
-- échoue (colonne absente). Script rejouable sans effet de bord.

alter table public.site_settings
  add column if not exists pdf_text_color text not null default '#1B2A33';

-- Vérification : attendu une ligne pdf_text_color, valeur par défaut '#1B2A33'.
select column_name, data_type, column_default from information_schema.columns
where table_name = 'site_settings' and column_name = 'pdf_text_color';
