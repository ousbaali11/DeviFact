// _shared/stripe.ts
//
// Date de fin de la période payée d'un abonnement Stripe, quelle que soit la
// version de l'API : jusqu'à 2025-02-24 elle est sur l'abonnement
// (current_period_end) ; depuis 2025-03-31 (« basil ») sur chaque ligne
// (items.data[i].current_period_end). Renvoie null si absente — ne jamais
// faire new Date(undefined), qui lève une erreur.
export function subscriptionPeriodEnd(subscription: any): string | null {
  const legacy = subscription?.current_period_end;
  const perItem = (subscription?.items?.data || [])
    .map((item: any) => item?.current_period_end)
    .filter((v: unknown): v is number => typeof v === "number");
  const end = typeof legacy === "number" ? legacy : perItem.length ? Math.max(...perItem) : null;
  return end ? new Date(end * 1000).toISOString() : null;
}

// Origine autorisée pour les adresses de retour (Stripe, Connect) : le site
// et le développement local, jamais une origine arbitraire envoyée par le
// navigateur.
const ALLOWED_ORIGINS = ["https://www.chantiflow.fr", "https://chantiflow.fr"];
export function safeOrigin(origin: string | null | undefined, fallback = "https://www.chantiflow.fr"): string {
  const o = String(origin || "").trim().replace(/\/+$/, "");
  if (ALLOWED_ORIGINS.includes(o)) return o;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return o;
  return fallback;
}
