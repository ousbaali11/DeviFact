// stripe-connect-webhook/index.ts
//
// Événements Stripe des COMPTES CONNECTÉS (Stripe Connect) — distinct de
// stripe-webhook, qui ne reçoit que les événements du compte de la
// plateforme (abonnements Chantiflow). Avec les paiements directs, la
// session de paiement d'une facture vit sur le compte Stripe de l'artisan :
// c'est donc ici que Stripe confirme le paiement, jamais le navigateur.
//
// À configurer dans le dashboard Stripe : Développeurs → Webhooks →
// Ajouter un point de terminaison → « Écouter les événements des comptes
// connectés » → URL de cette fonction, événements :
//   - checkout.session.completed  (facture payée)
//   - account.updated             (compte de l'artisan activé / restreint)
// Secret de signature de CE point de terminaison dans
// STRIPE_CONNECT_WEBHOOK_SECRET (différent de STRIPE_WEBHOOK_SECRET).
// Comme stripe-webhook, la fonction vérifie elle-même la signature :
// verify_jwt = false dans config.toml.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=deno";
import { addOnlinePayment } from "../_shared/totals.ts";
import { updateKvValue } from "../_shared/kv.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const webhookSecret = Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET")!;

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Marque la facture payée (même règle que le paiement sur le compte de la
// plateforme dans stripe-webhook : statut « payée », paidAt = date de la
// vente pour les indicateurs, lien public clôturé).
async function markInvoicePaid(organizationId: string, documentId: string, linkId: string | undefined, sessionId: string, amountCents: number) {
  // Paiement ajouté à la liste des paiements reçus de la facture ;
  // « payée » (avec paidAt) quand le total est couvert. Écriture rejouée
  // sur la version fraîche de la liste (voir _shared/kv.ts).
  let fullyPaid = false;
  const result = await updateKvValue<any[]>(dbAdmin, organizationId, "documents", (list) => {
    const idx = list.findIndex((d: any) => d.id === documentId);
    if (idx === -1) return null;
    list[idx] = addOnlinePayment(list[idx], sessionId, amountCents, new Date().toISOString());
    fullyPaid = list[idx].status === "payée";
    return list;
  });
  if (!result.ok) console.error("Facture payée non enregistrée :", result.reason, organizationId, documentId);
  // Lien public clôturé seulement une fois tout réglé ; verrou levé pour
  // permettre un paiement suivant (règlement en plusieurs fois).
  if (linkId) await dbAdmin.from("public_document_links").update({ payment_pending_at: null, ...(fullyPaid ? { paid_at: new Date().toISOString() } : {}) }).eq("id", linkId);
}

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret);
  } catch (err) {
    console.error("Signature Stripe (Connect) invalide :", err);
    return new Response("Signature invalide", { status: 400 });
  }

  try {
    // Identifiant du compte connecté d'où vient l'événement.
    const connectedAccountId = (event as unknown as { account?: string }).account || null;

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.kind === "invoice_payment" && session.payment_status === "paid") {
        const { organizationId, documentId, linkId } = session.metadata;
        // Cohérence : la session doit venir du compte connecté de CETTE
        // organisation — jamais marquer une facture payée sur la foi d'un
        // autre compte.
        const { data: org } = await dbAdmin.from("organizations").select("stripe_account_id").eq("id", organizationId).maybeSingle();
        if (!org || !connectedAccountId || org.stripe_account_id !== connectedAccountId) {
          console.error("Session de paiement reçue d'un compte inattendu :", connectedAccountId, "pour l'organisation", organizationId);
          return new Response(JSON.stringify({ received: true, ignored: true }), { headers: { "Content-Type": "application/json" } });
        }
        await markInvoicePaid(organizationId, documentId, linkId, session.id, Number(session.amount_total) || 0);
      }
    }

    // Compte de l'artisan activé, restreint ou complété : on recopie les
    // drapeaux qui décident si « Payer en ligne » est proposé à ses clients.
    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      const { error } = await dbAdmin.from("organizations").update({
        stripe_charges_enabled: account.charges_enabled === true,
        stripe_payouts_enabled: account.payouts_enabled === true,
        stripe_details_submitted: account.details_submitted === true,
        stripe_connect_updated_at: new Date().toISOString(),
      }).eq("stripe_account_id", account.id);
      if (error) console.error("Erreur de mise à jour de l'état du compte connecté :", error.message);
    }

    return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erreur de traitement du webhook Stripe Connect :", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
