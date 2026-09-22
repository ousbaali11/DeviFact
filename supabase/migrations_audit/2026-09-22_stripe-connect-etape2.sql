-- Stripe Connect, livraison 2 : paiement direct et commission — 22 septembre 2026
--
-- Commission de la plateforme sur les paiements en ligne des factures,
-- réglable depuis Admin (Identité du site). 0 % au départ, décision du
-- 22/09/2026 : aucune commission tant que ce réglage reste à zéro. Quand il
-- est positif, create-invoice-payment prélève ce pourcentage du montant
-- payé (application_fee_amount) sur chaque paiement direct.
--
-- Prérequis : script 2026-09-22_stripe-connect-etape1.sql déjà appliqué.
-- À exécuter dans l'éditeur SQL de Supabase (projet ieshjvzmpbxtqielhaii).
-- Script rejouable sans effet de bord.

alter table public.site_settings
  add column if not exists connect_fee_percent numeric(5,2) not null default 0;

alter table public.site_settings
  drop constraint if exists site_settings_connect_fee_percent_check;
alter table public.site_settings
  add constraint site_settings_connect_fee_percent_check
  check (connect_fee_percent >= 0 and connect_fee_percent <= 20);

-- Vérification : attendu une ligne connect_fee_percent, valeur 0.
select column_name, data_type, column_default from information_schema.columns
where table_name = 'site_settings' and column_name = 'connect_fee_percent';
select connect_fee_percent from public.site_settings where id = 1;
