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
      const organizationId = session.metadata?.organization_id || session.client_reference_id;
      const planId = session.metadata?.plan_id;
      const billingCycle = session.metadata?.billing_cycle;
      if (organizationId && planId) {
        const { error } = await dbAdmin.from("organizations").update({
          plan: planId,
          billing_cycle: billingCycle || "mensuel",
          payment_status: "payé",
          activated_via_free_button: false,
          stripe_subscription_id: session.subscription || null,
          stripe_customer_id: session.customer || null,
        }).eq("id", organizationId);
        if (error) console.error("Erreur d'activation du forfait après paiement Stripe :", error);
      } else {
        console.error("checkout.session.completed sans organization_id/plan_id en métadonnées");
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const { error } = await dbAdmin.from("organizations").update({
        plan: "gratuit", payment_status: "gratuit",
      }).eq("stripe_subscription_id", subscription.id);
      if (error) console.error("Erreur de désactivation après annulation Stripe :", error);
    }

    return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erreur de traitement du webhook Stripe :", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
