// get-public-document/index.ts
//
// Reçoit un jeton (issu d'un lien public envoyé au client), renvoie
// UNIQUEMENT le document concerné — jamais le reste des documents ou
// données de l'organisation, même si quelqu'un essaie de deviner un
// identifiant différent. Public, sans authentification (c'est tout
// l'intérêt : le client n'a pas de compte).

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=deno";
import { isPayableDoc } from "../_shared/totals.ts";
import { syncOnlinePayments } from "../_shared/online-payments.ts";

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
// Rapprochement des paiements en ligne (voir plus bas) — sans clé Stripe,
// la page publique fonctionne quand même, simplement sans rapprochement.
const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
const stripe = stripeKey ? new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() }) : null;
// Un paiement lancé il y a plus de 15 minutes sans être arrivé chez Stripe
// est considéré abandonné : verrou levé (même délai que create-invoice-payment).
const PENDING_LOCK_MS = 15 * 60 * 1000;

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") || (await req.json().catch(() => ({}))).token;
    if (!token) {
      return new Response(JSON.stringify({ error: "Lien invalide." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: link, error: linkError } = await dbAdmin
      .from("public_document_links")
      .select("id, organization_id, document_id, signed_at, paid_at, payment_pending_at")
      .eq("token", token)
      .maybeSingle();

    if (linkError || !link) {
      return new Response(JSON.stringify({ error: "Ce lien n'existe pas ou n'est plus valide." }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: docsRow } = await dbAdmin
      .from("kv_store")
      .select("value")
      .eq("organization_id", link.organization_id)
      .eq("key", "documents")
      .eq("shared", false)
      .maybeSingle();

    let documents: any[] = Array.isArray(docsRow?.value) ? docsRow.value : [];

    // Paiement en ligne : uniquement si l'organisation a un compte Stripe
    // connecté dont les encaissements sont actifs (Stripe Connect). Sinon
    // — y compris si la colonne n'existe pas encore — jamais : l'argent
    // d'une facture ne transite pas par le compte de la plateforme.
    const { data: orgRow } = await dbAdmin.from("organizations").select("stripe_account_id, stripe_charges_enabled").eq("id", link.organization_id).maybeSingle();

    // Un paiement a été lancé sur ce lien (retour du client après Stripe,
    // ou paiement en cours) : on vérifie directement auprès de Stripe s'il
    // est terminé et on l'enregistre sur la facture sans attendre le
    // webhook. Si rien n'est arrivé après 15 minutes, le verrou est levé.
    let paidAt = link.paid_at;
    if (link.payment_pending_at && stripe && orgRow?.stripe_account_id) {
      try {
        const sync = await syncOnlinePayments(dbAdmin, stripe, link.organization_id, orgRow.stripe_account_id, { documentId: link.document_id });
        if (sync.documents) documents = sync.documents;
        if (sync.added > 0) {
          const { data: fresh } = await dbAdmin.from("public_document_links").select("paid_at").eq("id", link.id).maybeSingle();
          paidAt = fresh?.paid_at ?? paidAt;
        } else if (Date.now() - new Date(link.payment_pending_at).getTime() > PENDING_LOCK_MS) {
          await dbAdmin.from("public_document_links").update({ payment_pending_at: null }).eq("id", link.id);
        }
      } catch (err) {
        console.error("Rapprochement des paiements en ligne (page publique) :", err);
      }
    }

    const doc = documents.find((d: any) => d.id === link.document_id);
    if (!doc) {
      return new Response(JSON.stringify({ error: "Ce document n'existe plus." }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Le client reçoit le document sans ce qui ne le concerne pas :
    // photos de chantier, images de signature, suivi interne des relances,
    // réglages de récurrence.
    const { photos: _photos, lastReminderSentAt: _lr, remindersEnabled: _re, isRecurring: _ir, recurrenceInterval: _ri, recurrenceEndDate: _rd, nextRecurrenceDate: _nd, ...publicDoc } = doc;
    if (publicDoc.signature && typeof publicDoc.signature === "object") {
      const { drawing: _drawing, image: _image, ...sig } = publicDoc.signature;
      publicDoc.signature = sig;
    }
    const { data: settingsRow } = await dbAdmin.from("site_settings").select("name, logo_url").limit(1).maybeSingle();

    const onlinePaymentEnabled = isPayableDoc(doc) && !!orgRow?.stripe_account_id && orgRow?.stripe_charges_enabled === true;

    return new Response(
      JSON.stringify({ document: publicDoc, signedAt: link.signed_at, paidAt, siteName: settingsRow?.name || "Chantiflow", onlinePaymentEnabled }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Erreur get-public-document", err);
    return new Response(JSON.stringify({ error: "Une erreur inattendue est survenue." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
