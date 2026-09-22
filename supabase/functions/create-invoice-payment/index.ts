// create-invoice-payment/index.ts
//
// Crée une session de paiement Stripe pour le montant EXACT d'une
// facture précise — différent de create-checkout-session (qui sert
// aux abonnements) : ici, c'est un paiement unique ("mode: payment"),
// jamais récurrent. Public, sans authentification — accessible via le
// lien envoyé au client.
//
// Stripe Connect (livraison 2) : PAIEMENT DIRECT sur le compte Stripe
// connecté de l'artisan (en-tête Stripe-Account). L'argent arrive chez
// l'artisan, les frais Stripe sont à sa charge, le libellé sur le relevé
// du client est le sien, et c'est stripe-connect-webhook (événements des
// comptes connectés) qui confirme le paiement. Commission de la plateforme
// facultative (site_settings.connect_fee_percent, 0 par défaut).

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=deno";
import { computeDocTotals, round2 } from "../_shared/totals.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

// Commission de la plateforme, en centimes, pour un montant en centimes et
// un pourcentage (0 → pas de commission). Arrondi au centime le plus proche.
function applicationFeeCents(amountCents: number, percent: number): number {
  const p = Number(percent);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return Math.min(amountCents, Math.round((amountCents * p) / 100));
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
    // Garde-fou serveur, même règle que l'affichage du bouton
    // (get-public-document) : sans compte connecté actif, aucune session
    // n'est créée — un appel direct ne peut pas encaisser sur le compte
    // de la plateforme.
    const { data: org } = await dbAdmin.from("organizations").select("stripe_account_id, stripe_charges_enabled").eq("id", link.organization_id).maybeSingle();
    if (!org?.stripe_account_id || org.stripe_charges_enabled !== true) {
      return new Response(JSON.stringify({ error: "Le paiement en ligne n'est pas disponible pour cette facture. Merci de régler par virement (coordonnées bancaires sur la facture)." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    // Montant à régler = total TTC moins l'acompte déjà versé — calcul
    // partagé avec le site (_shared/totals.ts) : sous-détails, remises de
    // ligne, remise globale en % ou en montant, TVA par taux.
    const amount = round2(computeDocTotals(doc).montantARegler);
    if (amount <= 0) {
      return new Response(JSON.stringify({ error: "Montant invalide." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Commission de la plateforme (réglage Admin, 0 par défaut). Si la
    // colonne n'existe pas encore : 0.
    const { data: settingsRow } = await dbAdmin.from("site_settings").select("connect_fee_percent").eq("id", 1).maybeSingle();
    const amountCents = Math.round(amount * 100);
    const feeCents = applicationFeeCents(amountCents, Number(settingsRow?.connect_fee_percent) || 0);

    const origin = req.headers.get("origin") || "https://www.chantiflow.fr";
    // Retour du client sur la page publique de sa facture : « paiement=ok »
    // affiche la confirmation en attendant que le webhook marque la facture
    // payée ; en cas d'abandon, simple retour sur la page.
    const publicPage = `${origin}/?voir-document=${encodeURIComponent(token)}`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: (doc.currency || "EUR").toLowerCase(),
          product_data: { name: `Facture ${doc.docNumber}` },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      ...(feeCents > 0 ? { payment_intent_data: { application_fee_amount: feeCents } } : {}),
      // Repères pour stripe-connect-webhook (kind distingue ce paiement
      // d'un paiement d'abonnement — jamais confondre les deux).
      metadata: { kind: "invoice_payment", linkId: link.id, organizationId: link.organization_id, documentId: link.document_id },
      success_url: `${publicPage}&paiement=ok`,
      cancel_url: publicPage,
    }, {
      // Paiement direct : la session est créée SUR le compte connecté.
      stripeAccount: org.stripe_account_id,
    });

    return new Response(JSON.stringify({ url: session.url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erreur create-invoice-payment", err);
    return new Response(JSON.stringify({ error: "Une erreur inattendue est survenue." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
