// stripe-webhook/index.ts
//
// Écoute les événements envoyés par Stripe et active/désactive le
// forfait de l'organisation correspondante — c'est Stripe qui
// confirme réellement le paiement, jamais le navigateur (même
// principe que functions/paypal-webhook).
//
// À configurer dans le dashboard Stripe : Developers → Webhooks →
// Add endpoint → URL de cette fonction, événements à écouter :
//   - checkout.session.completed
//   - customer.subscription.deleted
//   - customer.subscription.updated

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Date de fin de la période payée d'un abonnement, quelle que soit la
// version de l'API Stripe qui a produit l'objet : jusqu'à la version
// 2025-02-24, elle est sur l'abonnement lui-même
// (subscription.current_period_end) ; à partir de la version
// 2025-03-31 ("basil"), Stripe l'a déplacée sur chaque ligne de
// l'abonnement (subscription.items.data[i].current_period_end). Les
// notifications (webhooks) suivent la version configurée dans le
// dashboard Stripe, d'où la nécessité de gérer les deux formes — sinon
// new Date(undefined) provoquait une erreur et Stripe rejouait
// l'événement en boucle. Renvoie null si aucune des deux n'est présente.
function subscriptionPeriodEnd(subscription: Stripe.Subscription): string | null {
  const legacy = (subscription as unknown as { current_period_end?: number }).current_period_end;
  const perItem = subscription.items?.data
    ?.map((item) => (item as unknown as { current_period_end?: number }).current_period_end)
    .filter((v): v is number => typeof v === "number");
  const end = typeof legacy === "number" ? legacy : perItem && perItem.length ? Math.max(...perItem) : null;
  return end ? new Date(end * 1000).toISOString() : null;
}

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret);
  } catch (err) {
    console.error("Signature Stripe invalide :", err);
    return new Response("Signature invalide", { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      // Paiement d'une facture précise via le lien public envoyé au
      // client — complètement séparé de la logique d'abonnement
      // juste en dessous, jamais mélangé.
      if (session.metadata?.kind === "invoice_payment") {
        const { organizationId, documentId, linkId } = session.metadata;
        const { data: docsRow } = await dbAdmin.from("kv_store").select("value").eq("organization_id", organizationId).eq("key", "documents").eq("shared", false).maybeSingle();
        const documents = Array.isArray(docsRow?.value) ? docsRow.value : [];
        const docIndex = documents.findIndex((d: any) => d.id === documentId);
        if (docIndex !== -1) {
          documents[docIndex] = { ...documents[docIndex], status: "payée", updatedAt: Date.now() };
          await dbAdmin.from("kv_store").update({ value: documents, updated_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("key", "documents").eq("shared", false);
        }
        if (linkId) await dbAdmin.from("public_document_links").update({ paid_at: new Date().toISOString() }).eq("id", linkId);
        return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
      }

      const organizationId = session.metadata?.organization_id || session.client_reference_id;
      const planId = session.metadata?.plan_id;
      const billingCycle = session.metadata?.billing_cycle;
      if (organizationId && planId) {
        // Récupère la vraie date de fin de période payée directement
        // depuis Stripe plutôt que de la calculer nous-mêmes — Stripe
        // est la seule source fiable (essais gratuits, prorata...).
        let expiresAt = null;
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          expiresAt = subscriptionPeriodEnd(sub);
        }
        const { error } = await dbAdmin.from("organizations").update({
          plan: planId,
          billing_cycle: billingCycle || "mensuel",
          payment_status: "payé",
          activated_via_free_button: false,
          stripe_subscription_id: session.subscription || null,
          stripe_customer_id: session.customer || null,
          expires_at: expiresAt,
          subscription_cancelled: false,
        }).eq("id", organizationId);
        if (error) console.error("Erreur d'activation du forfait après paiement Stripe :", error);
      } else {
        console.error("checkout.session.completed sans organization_id/plan_id en métadonnées");
      }
    }

    // Renouvellement automatique (paiement mensuel/annuel suivant) —
    // repousse expires_at à la nouvelle date, pour que l'accès
    // continue normalement.
    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;
      const periodEnd = subscriptionPeriodEnd(subscription);
      const { error } = await dbAdmin.from("organizations").update({
        // Si la date est absente (forme d'objet inattendue), on ne
        // touche pas à expires_at plutôt que de l'effacer.
        ...(periodEnd ? { expires_at: periodEnd } : {}),
        subscription_cancelled: subscription.cancel_at_period_end === true,
      }).eq("stripe_subscription_id", subscription.id);
      if (error) console.error("Erreur de mise à jour de la date d'expiration Stripe :", error);
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const { error } = await dbAdmin.from("organizations").update({
        plan: "gratuit", payment_status: "gratuit", subscription_cancelled: false,
      }).eq("stripe_subscription_id", subscription.id);
      if (error) console.error("Erreur de désactivation après annulation Stripe :", error);
    }

    return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erreur de traitement du webhook Stripe :", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
