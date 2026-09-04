// cancel-subscription/index.ts
//
// Résilie l'abonnement de la personne qui appelle — elle garde son
// accès jusqu'à la date déjà payée (expires_at), puis son compte
// repasse automatiquement en gratuit (voir
// downgrade_expired_cancelled_subscriptions, appelée quotidiennement).
//
// Stripe et PayPal fonctionnent différemment à l'annulation :
// - Stripe sait nativement "annuler à la fin de la période" — on lui
//   demande ça, et il continue de facturer normalement jusque-là.
// - PayPal annule immédiatement de son côté (pas d'équivalent natif) —
//   c'est notre propre date "expires_at" qui fait patienter l'accès.
//
// Déploiement : voir le Guide de déploiement, même principe que les
// autres fonctions.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const PAYPAL_API = Deno.env.get("PAYPAL_API_BASE") || "https://api-m.sandbox.paypal.com";
const PAYPAL_CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID")!;
const PAYPAL_CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET")!;

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function getPayPalAccessToken() {
  const auth = btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  return data.access_token;
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    // Vérifie que la personne est bien authentifiée — jamais accepter
    // une résiliation "au nom de" quelqu'un d'autre sans preuve.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await dbAdmin.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Non authentifié." }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const { organizationId } = await req.json();
    if (!organizationId) {
      return new Response(JSON.stringify({ error: "organizationId manquant." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // Vérifie que la personne appartient bien à cette organisation
    // (avec un rôle suffisant) — jamais faire confiance à un
    // organizationId envoyé tel quel sans le confronter à la vraie
    // appartenance de la personne.
    const { data: membership } = await dbAdmin
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", userData.user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!membership || !["owner", "editor"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Tu n'as pas les droits pour résilier cet abonnement." }), { status: 403, headers: { "Content-Type": "application/json" } });
    }

    const { data: org } = await dbAdmin
      .from("organizations")
      .select("plan, payment_status, stripe_subscription_id, paypal_subscription_id, expires_at, subscription_cancelled")
      .eq("id", organizationId)
      .maybeSingle();

    if (!org || org.payment_status !== "payé" || org.plan === "gratuit") {
      return new Response(JSON.stringify({ error: "Aucun abonnement payant actif à résilier." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (org.subscription_cancelled) {
      return new Response(JSON.stringify({ error: "Cet abonnement est déjà en cours de résiliation." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    let expiresAt = org.expires_at;

    if (org.stripe_subscription_id) {
      // Stripe gère nativement "annuler à la fin de la période" —
      // continue de facturer et de donner accès jusque-là, puis
      // envoie lui-même customer.subscription.deleted à la vraie
      // date de fin (déjà géré dans stripe-webhook).
      const sub = await stripe.subscriptions.update(org.stripe_subscription_id, { cancel_at_period_end: true });
      expiresAt = new Date(sub.current_period_end * 1000).toISOString();
    } else if (org.paypal_subscription_id) {
      // PayPal n'a pas d'équivalent natif — annule immédiatement de
      // son côté. C'est notre propre "expires_at" (mis à jour à
      // chaque paiement réussi par paypal-webhook) qui fait patienter
      // l'accès jusqu'à la bonne date malgré ça.
      const accessToken = await getPayPalAccessToken();
      const res = await fetch(`${PAYPAL_API}/v1/billing/subscriptions/${org.paypal_subscription_id}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Résiliation demandée par le client" }),
      });
      if (!res.ok && res.status !== 422) {
        // 422 = déjà annulé côté PayPal, pas bloquant pour autant
        const errText = await res.text();
        console.error("Erreur d'annulation PayPal", errText);
        return new Response(JSON.stringify({ error: "Impossible de contacter PayPal pour résilier. Réessaie dans un instant." }), { status: 502, headers: { "Content-Type": "application/json" } });
      }
    } else {
      return new Response(JSON.stringify({ error: "Aucun abonnement Stripe ou PayPal associé à ce compte." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const { error: updateError } = await dbAdmin.from("organizations").update({
      subscription_cancelled: true,
      expires_at: expiresAt,
    }).eq("id", organizationId);
    if (updateError) {
      console.error("Erreur d'enregistrement de la résiliation", updateError);
      return new Response(JSON.stringify({ error: "La résiliation a été transmise, mais son enregistrement a échoué. Préviens-nous." }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, expiresAt }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erreur de résiliation d'abonnement", err);
    return new Response(JSON.stringify({ error: "Une erreur inattendue est survenue." }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
