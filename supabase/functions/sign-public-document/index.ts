// sign-public-document/index.ts
//
// Reçoit un jeton + une signature (texte ou dessin), marque le
// document correspondant comme signé — jamais réutilisable deux fois
// avec le même lien (une fois signed_at rempli, refuse toute nouvelle
// tentative). Public, sans authentification.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { updateKvValue } from "../_shared/kv.ts";

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const { token, signatureName, signatureDrawing, secondSignatureName } = await req.json();
    if (!token || (!signatureName?.trim() && !signatureDrawing)) {
      return new Response(JSON.stringify({ error: "Signature manquante." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Dessin à main levée : une image PNG produite par le canvas de la
    // page publique, de taille raisonnable — jamais une chaîne arbitraire
    // stockée telle quelle depuis un point d'entrée public.
    if (signatureDrawing !== undefined && signatureDrawing !== null) {
      if (typeof signatureDrawing !== "string" || !signatureDrawing.startsWith("data:image/png;base64,") || signatureDrawing.length > 200_000) {
        return new Response(JSON.stringify({ error: "Signature dessinée invalide." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    // Second signataire (optionnel) : un nom en plus, signé en une seule
    // étape avec le premier — stocké tel quel sur le document.
    const secondName = typeof secondSignatureName === "string" ? secondSignatureName.trim().slice(0, 120) : "";
    // Nom borné : point d'entrée public, jamais une chaîne arbitraire.
    const signerName = typeof signatureName === "string" ? signatureName.trim().slice(0, 120) : "";

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
    // Seul un devis se signe. Un lien de facture (paiement, consultation)
    // ne doit jamais permettre de changer le statut du document.
    {
      const { data: docsRow } = await dbAdmin.from("kv_store").select("value").eq("organization_id", link.organization_id).eq("key", "documents").eq("shared", false).maybeSingle();
      const target = (Array.isArray(docsRow?.value) ? docsRow.value : []).find((d: any) => d.id === link.document_id);
      if (!target) return new Response(JSON.stringify({ error: "Ce document n'existe plus." }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (target.type !== "devis") return new Response(JSON.stringify({ error: "Ce document ne se signe pas en ligne." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (["signé", "refusé", "expiré"].includes(String(target.status || ""))) return new Response(JSON.stringify({ error: "Ce devis ne peut plus être signé." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Prise de signature atomique : le lien est marqué signé AVANT la
    // modification, en une seule opération conditionnelle — deux envois
    // simultanés ne peuvent pas signer deux fois ni créer deux factures.
    const { data: claimed } = await dbAdmin.from("public_document_links").update({ signed_at: new Date().toISOString() }).eq("id", link.id).is("signed_at", null).select("id");
    if (!claimed || claimed.length === 0) {
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

    // La modification est rejouée sur la version fraîche de la liste
    // (écriture conditionnelle, voir _shared/kv.ts) : un artisan qui
    // enregistre au même moment ne perd rien, et inversement.
    const applySignature = (list: any[]) => {
      const idx = list.findIndex((d: any) => d.id === link.document_id);
      if (idx === -1) return null;
      const original = list[idx];
      if (original.type !== "devis" || ["signé", "refusé", "expiré"].includes(String(original.status || ""))) return null;
      list[idx] = {
        ...original,
        status: "signé",
        signature: { mode: signatureDrawing ? "dessin" : "texte", name: signerName, drawing: signatureDrawing || null, ...(secondName ? { secondName } : {}) },
        updatedAt: Date.now(),
      };
      // Même règle qu'à l'intérieur du site : un devis qui vient de
      // passer à "signé" génère automatiquement sa facture — jamais
      // réappliqué si le document était déjà signé avant (vérifié plus
      // haut, ce cas est déjà écarté).
      if (original.type === "devis") {
        const nums = list.filter((d: any) => d.type === "facture").map((d: any) => parseInt((String(d.docNumber).match(/(\d+)$/) || [])[1] || "0", 10));
        const nextNum = (nums.length ? Math.max(...nums) : 0) + 1;
        list.unshift({
          ...list[idx],
          id: `doc_${crypto.randomUUID()}`,
          type: "facture",
          docNumber: `FAC-${String(nextNum).padStart(3, "0")}`,
          issueDate: new Date().toISOString().slice(0, 10),
          status: "brouillon",
          workStage: "brouillon",
          linkedDevisId: list[idx].id,
          sourceDevisNumber: list[idx].docNumber || "",
          // Même modèle que la conversion côté site : version courante des
          // champs, acompte demandé (notion de devis) remis à zéro, aucun
          // paiement ni signature hérités.
          schemaVersion: 2,
          acompte: 0,
          serviceDate: "", serviceDateEnd: "", paymentMethod: "",
          payments: [], acompteVerse: "", signature: null, paidAt: undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      return list;
    };
    const result = await updateKvValue<any[]>(dbAdmin, link.organization_id, "documents", applySignature);
    const updateError = result.ok ? null : { message: result.reason };

    if (updateError) {
      console.error("Erreur d'enregistrement de la signature", updateError);
      // Le lien est libéré pour permettre un nouvel essai.
      await dbAdmin.from("public_document_links").update({ signed_at: null }).eq("id", link.id);
      return new Response(JSON.stringify({ error: "Impossible d'enregistrer la signature pour l'instant." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erreur sign-public-document", err);
    return new Response(JSON.stringify({ error: "Une erreur inattendue est survenue." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
