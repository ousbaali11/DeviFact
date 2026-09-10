// create-invoice-payment/index.ts
//
// Crée une session de paiement Stripe pour le montant EXACT d'une
// facture précise — différent de create-checkout-session (qui sert
// aux abonnements) : ici, c'est un paiement unique ("mode: payment"),
// jamais récurrent. Public, sans authentification — accessible via le
// lien envoyé au client.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

function computeTotalTTC(doc: any): number {
  const items = Array.isArray(doc.items) ? doc.items : [];
  let totalHT = 0;
  const tvaByRate: Record<string, number> = {};
  for (const it of items) {
    if (it.type !== "line") continue;
    const qty = Number(it.qty) || 0;
    const price = Number(it.unitPrice) || 0;
    const discount = Number(it.discount) || 0;
    const lineHT = qty * price * (1 - discount / 100);
    totalHT += lineHT;
    const rate = String(it.tva ?? 20);
    tvaByRate[rate] = (tvaByRate[rate] || 0) + (lineHT * Number(rate)) / 100;
  }
  const globalDiscount = Number(doc.globalDiscount) || 0;
  const afterGlobal = totalHT * (1 - globalDiscount / 100);
  const totalTVA = Object.values(tvaByRate).reduce((s, v) => s + v, 0) * (1 - globalDiscount / 100);
  return Math.round((afterGlobal + totalTVA) * 100) / 100;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: "Lien invalide." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: link } = await dbAdmin.from("public_document_links").select("id, organization_id, document_id, paid_at, payment_pending_at").eq("token", token).maybeSingle();
    if (!link) {
      return new Response(JSON.stringify({ error: "Ce lien n'existe pas ou n'est plus valide." }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (link.paid_at) {
      return new Response(JSON.stringify({ error: "Cette facture a déjà été payée." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Empêche deux paiements d'être lancés en même temps (par exemple
    // si le client ouvre le lien dans deux onglets) — une mise à jour
    // conditionnelle, qui échoue silencieusement si un paiement vient
    // déjà d'être lancé il y a moins de 15 minutes.
    // Vraiment conditionnelle : la mise à jour ne touche la ligne que si
    // aucun paiement n'a été lancé depuis moins de 15 minutes — vérifié
    // et posé en une seule opération côté base, pour que deux appels
    // strictement simultanés ne puissent pas passer tous les deux.
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const { data: locked } = await dbAdmin
      .from("public_document_links")
      .update({ payment_pending_at: new Date().toISOString() })
      .eq("id", link.id)
      .is("paid_at", null)
      .or(`payment_pending_at.is.null,payment_pending_at.lt.${cutoff}`)
      .select("id");
    if (!locked || locked.length === 0) {
      return new Response(JSON.stringify({ error: "Un paiement est déjà en cours pour cette facture — patiente quelques minutes, ou vérifie l'autre onglet ouvert." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: docsRow } = await dbAdmin.from("kv_store").select("value").eq("organization_id", link.organization_id).eq("key", "documents").eq("shared", false).maybeSingle();
    const documents = Array.isArray(docsRow?.value) ? docsRow.value : [];
    const doc = documents.find((d: any) => d.id === link.document_id);
    if (!doc || doc.type !== "facture") {
      return new Response(JSON.stringify({ error: "Ce document n'est pas une facture valide." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const amount = computeTotalTTC(doc);
    if (amount <= 0) {
      return new Response(JSON.stringify({ error: "Montant invalide." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const origin = req.headers.get("origin") || "https://www.chantiflow.fr";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: (doc.currency || "EUR").toLowerCase(),
          product_data: { name: `Facture ${doc.docNumber}` },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      // Distingue ce paiement (facture) d'un paiement d'abonnement dans
      // le webhook Stripe partagé — jamais confondre les deux.
      metadata: { kind: "invoice_payment", linkId: link.id, organizationId: link.organization_id, documentId: link.document_id },
      success_url: `${origin}/facture-payee?token=${token}`,
      cancel_url: `${origin}/payer?token=${token}`,
    });

    return new Response(JSON.stringify({ url: session.url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erreur create-invoice-payment", err);
    return new Response(JSON.stringify({ error: "Une erreur inattendue est survenue." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
