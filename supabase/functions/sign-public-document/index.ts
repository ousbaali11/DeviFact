// sign-public-document/index.ts
//
// Reçoit un jeton + une signature (texte ou dessin), marque le
// document correspondant comme signé — jamais réutilisable deux fois
// avec le même lien (une fois signed_at rempli, refuse toute nouvelle
// tentative). Public, sans authentification.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const { token, signatureName, signatureDrawing } = await req.json();
    if (!token || (!signatureName?.trim() && !signatureDrawing)) {
      return new Response(JSON.stringify({ error: "Signature manquante." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: link, error: linkError } = await dbAdmin
      .from("public_document_links")
      .select("id, organization_id, document_id, signed_at")
      .eq("token", token)
      .maybeSingle();

    if (linkError || !link) {
      return new Response(JSON.stringify({ error: "Ce lien n'existe pas ou n'est plus valide." }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (link.signed_at) {
      return new Response(JSON.stringify({ error: "Ce document a déjà été signé." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: docsRow } = await dbAdmin
      .from("kv_store")
      .select("value")
      .eq("organization_id", link.organization_id)
      .eq("key", "documents")
      .eq("shared", false)
      .maybeSingle();

    const documents = Array.isArray(docsRow?.value) ? docsRow.value : [];
    const docIndex = documents.findIndex((d: any) => d.id === link.document_id);
    if (docIndex === -1) {
      return new Response(JSON.stringify({ error: "Ce document n'existe plus." }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const original = documents[docIndex];
    documents[docIndex] = {
      ...original,
      status: "signé",
      signature: { mode: signatureDrawing ? "dessin" : "texte", name: signatureName || "", drawing: signatureDrawing || null, signedRemotely: true },
      updatedAt: Date.now(),
    };

    // Même règle qu'à l'intérieur du site : un devis qui vient de
    // passer à "signé" génère automatiquement sa facture — jamais
    // réappliqué si le document était déjà signé avant (vérifié plus
    // haut, ce cas est déjà écarté).
    if (original.type === "devis") {
      const prefixes: Record<string, string> = { devis: "DEV", proforma: "PRO", commande: "CMD" };
      const nums = documents.filter((d: any) => d.type === "facture").map((d: any) => parseInt((String(d.docNumber).match(/(\d+)$/) || [])[1] || "0", 10));
      const nextNum = (nums.length ? Math.max(...nums) : 0) + 1;
      const invoice = {
        ...documents[docIndex],
        id: `doc_${crypto.randomUUID()}`,
        type: "facture",
        docNumber: `FAC-${String(nextNum).padStart(3, "0")}`,
        issueDate: new Date().toISOString().slice(0, 10),
        status: "brouillon",
        workStage: "brouillon",
        linkedDevisId: documents[docIndex].id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      documents.unshift(invoice);
    }

    const { error: updateError } = await dbAdmin
      .from("kv_store")
      .update({ value: documents, updated_at: new Date().toISOString() })
      .eq("organization_id", link.organization_id)
      .eq("key", "documents")
      .eq("shared", false);

    if (updateError) {
      console.error("Erreur d'enregistrement de la signature", updateError);
      return new Response(JSON.stringify({ error: "Impossible d'enregistrer la signature pour l'instant." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await dbAdmin.from("public_document_links").update({ signed_at: new Date().toISOString() }).eq("id", link.id);

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erreur sign-public-document", err);
    return new Response(JSON.stringify({ error: "Une erreur inattendue est survenue." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
