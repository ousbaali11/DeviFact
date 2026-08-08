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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=deno";

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

    const { planId, billingCycle, organizationId, successUrl, cancelUrl } = await req.json();
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

    const { data: plan, error: planError } = await dbAdmin.from("plans").select("*").eq("id", planId).maybeSingle();
    if (planError || !plan) {
      return new Response(JSON.stringify({ error: "Forfait introuvable" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const priceId = billingCycle === "annuel" ? plan.stripe_price_id_annual : plan.stripe_price_id_monthly;
    if (!priceId) {
      return new Response(JSON.stringify({ error: "Le paiement par carte n'est pas encore configuré pour ce forfait" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const origin = req.headers.get("origin") || "";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl || `${origin}/?paiement=succes`,
      cancel_url: cancelUrl || `${origin}/?paiement=annule`,
      client_reference_id: organizationId,
      metadata: { organization_id: organizationId, plan_id: planId, billing_cycle: billingCycle },
      customer_email: user.email,
    });

    return new Response(JSON.stringify({ url: session.url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erreur de création de session Stripe :", err);
    return new Response(JSON.stringify({ error: "Erreur serveur : " + String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
