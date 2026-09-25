// _shared/pdp-flags.ts
//
// Interrupteur de la Plateforme Agréée (Super PDP). Tant que
// SUPERPDP_ENABLED est vrai, la connexion OAuth des comptes artisans est
// proposée ; le passage en production reste un acte séparé (variable
// d'environnement SUPERPDP_ALLOW_PRODUCTION, voir _shared/superpdp.ts).
export const SUPERPDP_ENABLED = true;
