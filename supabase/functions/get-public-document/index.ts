// get-public-document/index.ts
//
// Reçoit un jeton (issu d'un lien public envoyé au client), renvoie
// UNIQUEMENT le document concerné — jamais le reste des documents ou
// données de l'organisation, même si quelqu'un essaie de deviner un
// identifiant différent. Public, sans authentification (c'est tout
// l'intérêt : le client n'a pas de compte).

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

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
      .select("organization_id, document_id, signed_at, paid_at")
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

    const documents = Array.isArray(docsRow?.value) ? docsRow.value : [];
    const doc = documents.find((d: any) => d.id === link.document_id);
    if (!doc) {
      return new Response(JSON.stringify({ error: "Ce document n'existe plus." }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: settingsRow } = await dbAdmin.from("site_settings").select("name, logo_url").limit(1).maybeSingle();

    return new Response(
      JSON.stringify({ document: doc, signedAt: link.signed_at, paidAt: link.paid_at, siteName: settingsRow?.name || "Chantiflow" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Erreur get-public-document", err);
    return new Response(JSON.stringify({ error: "Une erreur inattendue est survenue." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
