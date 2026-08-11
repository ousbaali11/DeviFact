// paypal-webhook/index.ts
//
// Fonction serveur qui reçoit les notifications de PayPal (abonnement
// activé, annulé, paiement échoué...), VÉRIFIE qu'elles viennent bien
// de PayPal (et pas d'un faux appel), puis met à jour le forfait réel
// de l'utilisateur concerné dans la base de données.
//
// C'est la seule source autorisée à faire passer un compte sur un
// forfait payant — jamais le navigateur du client, qui n'est pas fiable.
//
// Déploiement : voir le Guide de déploiement, section "PayPal".

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYPAL_API = Deno.env.get("PAYPAL_API_BASE") || "https://api-m.sandbox.paypal.com"; // remplacer par https://api-m.paypal.com en production
const PAYPAL_CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID")!;
const PAYPAL_CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET")!;
const PAYPAL_WEBHOOK_ID = Deno.env.get("PAYPAL_WEBHOOK_ID")!;

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! // clé secrète, jamais utilisée côté navigateur
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

// Vérifie auprès de PayPal que cette notification est authentique.
async function verifyWebhookSignature(headers: Headers, body: string) {
  const accessToken = await getPayPalAccessToken();
  const verifyRes = await fetch(`${PAYPAL_API}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: PAYPAL_WEBHOOK_ID,
      webhook_event: JSON.parse(body),
    }),
  });
  const result = await verifyRes.json();
  return result.verification_status === "SUCCESS";
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const rawBody = await req.text();

  const isValid = await verifyWebhookSignature(req.headers, rawBody);
  if (!isValid) {
    console.error("Signature de webhook PayPal invalide — requête ignorée.");
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(rawBody);
  const eventType = event.event_type;
  const resource = event.resource;

  console.log("Webhook PayPal reçu :", eventType);

  if (eventType === "BILLING.SUBSCRIPTION.ACTIVATED") {
    const organizationId = resource.custom_id;
    const paypalPlanId = resource.plan_id;
    if (!organizationId) { console.error("custom_id manquant sur l'abonnement"); return new Response("ok"); }

    // Retrouve à quel forfait DeviFact correspond ce plan_id PayPal
    const { data: plan } = await dbAdmin
      .from("plans")
      .select("id, paypal_plan_id_monthly, paypal_plan_id_annual")
      .or(`paypal_plan_id_monthly.eq.${paypalPlanId},paypal_plan_id_annual.eq.${paypalPlanId}`)
      .maybeSingle();

    if (!plan) { console.error("Aucun forfait DeviFact ne correspond au plan PayPal", paypalPlanId); return new Response("ok"); }

    const billingCycle = plan.paypal_plan_id_annual === paypalPlanId ? "annuel" : "mensuel";

    await dbAdmin.from("organizations").update({
      plan: plan.id,
      billing_cycle: billingCycle,
      payment_status: "payé",
      paypal_subscription_id: resource.id,
      // Vrai paiement confirmé par PayPal : retire le marqueur
      // "activation gratuite", même si ce compte avait auparavant
      // utilisé le bouton "Activer (0€)" — il ne doit plus jamais être
      // redemandé de régulariser après ça (voir RegularizationScreen
      // côté site).
      activated_via_free_button: false,
    }).eq("id", organizationId);
  }

  if (eventType === "BILLING.SUBSCRIPTION.CANCELLED" || eventType === "BILLING.SUBSCRIPTION.SUSPENDED") {
    const { error } = await dbAdmin.from("organizations")
      .update({ plan: "gratuit", payment_status: "impayé" })
      .eq("paypal_subscription_id", resource.id);
    if (error) console.error("Erreur lors de la désactivation de l'abonnement", error);
  }

  if (eventType === "PAYMENT.SALE.DENIED" || eventType === "BILLING.SUBSCRIPTION.PAYMENT.FAILED") {
    const { error } = await dbAdmin.from("organizations")
      .update({ payment_status: "impayé" })
      .eq("paypal_subscription_id", resource.billing_agreement_id || resource.id);
    if (error) console.error("Erreur lors du marquage impayé", error);
  }

  return new Response("ok", { status: 200 });
});
