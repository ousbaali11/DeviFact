-- Réinitialisation de la connexion Stripe Connect d'UNE organisation (test).
-- Contexte (24/09/2026) : le compte connecté acct_1UIUSx7rGHqF4jgm a été créé
-- sous un ancien compte Stripe ; la clé secrète actuelle ne le connaît pas.
-- Mode test, aucune donnée réelle : on efface l'identifiant et les
-- indicateurs pour refaire l'inscription depuis le site (carte « Connecter
-- mon compte de paiement » dans Mon entreprise), qui créera un nouveau
-- compte connecté sous le bon compte Stripe.
--
-- À lancer depuis l'éditeur SQL Supabase (auth.role() y est null, le
-- déclencheur de protection des colonnes laisse passer). Uniquement cette
-- organisation : la clause WHERE porte sur son identifiant ET sur l'ancien
-- compte, pour ne jamais toucher une autre ligne par erreur.

update public.organizations
set stripe_account_id = null,
    stripe_charges_enabled = false,
    stripe_payouts_enabled = false,
    stripe_details_submitted = false,
    stripe_connect_updated_at = now()
where id = '42900b3a-fa43-400a-8552-6703237c0317'
  and stripe_account_id = 'acct_1UIUSx7rGHqF4jgm';

-- Vérification attendue : une ligne, stripe_account_id vide, les trois
-- indicateurs à false.
select id, name, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_connect_updated_at
from public.organizations
where id = '42900b3a-fa43-400a-8552-6703237c0317';
