// create-checkout-session/index.ts
//
// Crée une session Stripe Checkout (page de paiement séparée, hébergée
// par Stripe) pour l'abonnement à un forfait — et renvoie son URL, sur
// laquelle le navigateur redirige ensuite.
//
// Vérifie que l'appelant est bien connecté et propriétaire de
// l'organisation pour laquelle il paie — comme pour invite-member,
// c'est cette fonction, pas le navigateur, qui décide.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { CARD_SUBSCRIPTIONS_ENABLED } from "../_shared/payments-flags.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=deno";
import { safeOrigin } from "../_shared/stripe.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  // Désactivé (voir _shared/payments-flags.ts) : abonnements par PayPal uniquement.
  if (!CARD_SUBSCRIPTIONS_ENABLED) return new Response(JSON.stringify({ error: "Le paiement par carte n'est plus proposé : utilise PayPal." }), { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Non connecté" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { planId, billingCycle, organizationId } = await req.json();
    if (!planId || !billingCycle || !organizationId) {
      return new Response(JSON.stringify({ error: "Paramètres manquants" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Vérifie que l'appelant est bien propriétaire de CETTE organisation
    // précise — jamais de confiance aveugle dans ce qu'envoie le client.
    const { data: membership } = await dbAdmin
      .from("organization_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .maybeSingle();
    if (!membership || membership.role !== "owner") {
      return new Response(JSON.stringify({ error: "Seul le propriétaire de cette organisation peut souscrire un forfait" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Un abonnement Stripe déjà actif : jamais un second en parallèle (le
    // premier continuerait d'être facturé sans moyen de le résilier ici).
    const { data: currentOrg } = await dbAdmin.from("organizations").select("stripe_subscription_id, payment_status, subscription_cancelled").eq("id", organizationId).maybeSingle();
    if (currentOrg?.stripe_subscription_id && currentOrg.payment_status === "payé" && !currentOrg.subscription_cancelled) {
      return new Response(JSON.stringify({ error: "Un abonnement est déjà actif pour cette organisation. Résilie-le d'abord pour en changer." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: plan, error: planError } = await dbAdmin.from("plans").select("*").eq("id", planId).maybeSingle();
    if (planError || !plan) {
      return new Response(JSON.stringify({ error: "Forfait introuvable" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const priceId = billingCycle === "annuel" ? plan.stripe_price_id_annual : plan.stripe_price_id_monthly;
    if (!priceId) {
      return new Response(JSON.stringify({ error: "Le paiement par carte n'est pas encore configuré pour ce forfait" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Adresses de retour construites ici, sur une origine connue : jamais
    // une adresse arbitraire envoyée par le navigateur.
    const origin = safeOrigin(req.headers.get("origin"));
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?paiement=succes`,
      cancel_url: `${origin}/?paiement=annule`,
      client_reference_id: organizationId,
      metadata: { organization_id: organizationId, plan_id: planId, billing_cycle: billingCycle },
      customer_email: user.email,
    });

    return new Response(JSON.stringify({ url: session.url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erreur de création de session Stripe :", err);
    return new Response(JSON.stringify({ error: "Erreur serveur. Réessaie dans un instant." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
