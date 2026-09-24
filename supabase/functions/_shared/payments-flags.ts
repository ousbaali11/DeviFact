// _shared/payments-flags.ts
//
// Interrupteurs des paiements par carte (Stripe), côté serveur — même
// décision que ONLINE_PAYMENTS_ENABLED dans src/App.jsx (24/09/2026) :
//   * abonnements : PayPal uniquement, le paiement par carte n'est plus
//     proposé (create-checkout-session répond « désactivé ») ;
//   * factures : plus de paiement en ligne, la page publique affiche les
//     coordonnées de virement de l'artisan (create-invoice-payment,
//     connect-onboarding et sync-online-payments répondent « désactivé »,
//     get-public-document ne consulte plus Stripe).
// Le code Stripe et Stripe Connect reste en place (fonctions, webhooks,
// modules partagés) : repasser ces constantes à true le réactive.
export const CARD_SUBSCRIPTIONS_ENABLED = false;
export const INVOICE_ONLINE_PAYMENTS_ENABLED = false;
