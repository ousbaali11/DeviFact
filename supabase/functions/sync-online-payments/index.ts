// sync-online-payments/index.ts
//
// Appelée par l'application (membre connecté) à l'ouverture et quand une
// facture est ouverte : vérifie directement auprès de Stripe les paiements
// en ligne terminés sur le compte connecté de l'organisation et enregistre
// ceux qui manquent sur les factures (voir _shared/online-payments.ts).
// Ne dépend pas du webhook Stripe Connect : si celui-ci est en retard ou
// mal configuré, la facture est quand même à jour dès qu'on l'ouvre.
//
// Corps : { organizationId, documentId? }. Réponse : { checked, added,
// documentIds }. Jamais de détail Stripe renvoyé au navigateur.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=deno";
import { syncOnlinePayments } from "../_shared/online-payments.ts";

const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
const stripe = stripeKey ? new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() }) : null;
const dbAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return json({ error: "Non connecté" }, 401);

    const body = await req.json().catch(() => ({}));
    const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
    const documentId = typeof body?.documentId === "string" && body.documentId ? body.documentId : null;
    if (!organizationId) return json({ error: "Organisation manquante." }, 400);

    // Membre actif de CETTE organisation uniquement.
    const { data: membership } = await dbAdmin.from("organization_members").select("organization_id")
      .eq("user_id", user.id).eq("organization_id", organizationId).eq("status", "active").maybeSingle();
    if (!membership) return json({ error: "Accès refusé." }, 403);

    const { data: org } = await dbAdmin.from("organizations").select("stripe_account_id").eq("id", organizationId).maybeSingle();
    if (!stripe || !org?.stripe_account_id) return json({ checked: 0, added: 0, documentIds: [] });

    const result = await syncOnlinePayments(dbAdmin, stripe, organizationId, org.stripe_account_id, { documentId });
    if (result.error) console.error("Rapprochement des paiements en ligne :", result.error, organizationId);
    return json({ checked: result.checked, added: result.added, documentIds: result.documentIds });
  } catch (err) {
    console.error("Erreur sync-online-payments", err);
    return json({ error: "Une erreur inattendue est survenue." }, 500);
  }
});
