// send-review-request/index.ts
//
// Envoie au client d'une facture payée un email l'invitant à laisser un
// avis Google, avec le lien renseigné dans "Mon entreprise". Déclenché
// uniquement par un clic explicite dans l'application (jamais
// automatiquement). Réservé aux membres actifs de l'organisation.
//
// Rien n'est pris depuis le navigateur à part l'identifiant du document :
// l'adresse du client, le nom de l'entreprise et le lien d'avis sont
// relus en base, pour que la fonction ne puisse pas servir à envoyer un
// email arbitraire à n'importe qui.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("CONFIRMATION_FROM_EMAIL") || "noreply@chantiflow.fr";
const FROM_NAME = Deno.env.get("CONFIRMATION_FROM_NAME") || "Chantiflow";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    // Personne connectée (jeton de session transmis par l'application).
    const authHeader = req.headers.get("Authorization") || "";
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return json({ error: "Connexion requise." }, 401);

    const { organizationId, documentId } = await req.json();
    if (typeof organizationId !== "string" || !organizationId || typeof documentId !== "string" || !documentId) {
      return json({ error: "Document introuvable." }, 400);
    }

    // Membre actif de l'organisation concernée ?
    const { data: membership } = await dbAdmin
      .from("organization_members")
      .select("id, role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!membership) return json({ error: "Accès refusé à cette organisation." }, 403);
    if (membership.role === "viewer" || membership.role === "comptable") return json({ error: "Ton rôle ne permet pas d'envoyer des emails aux clients." }, 403);

    // Données relues en base : facture, client, entreprise, lien d'avis.
    const [{ data: docsRow }, { data: companyRow }] = await Promise.all([
      dbAdmin.from("kv_store").select("value").eq("organization_id", organizationId).eq("key", "documents").eq("shared", false).maybeSingle(),
      dbAdmin.from("kv_store").select("value").eq("organization_id", organizationId).eq("key", "company-profile").eq("shared", false).maybeSingle(),
    ]);
    const documents = Array.isArray(docsRow?.value) ? docsRow.value : [];
    const doc = documents.find((d: any) => d?.id === documentId);
    if (!doc) return json({ error: "Document introuvable." }, 404);
    if (doc.type !== "facture") return json({ error: "Seule une facture peut donner lieu à une demande d'avis." }, 400);
    if (doc.status !== "payée") return json({ error: "La facture doit être au statut « payée »." }, 400);

    const company = (companyRow?.value && typeof companyRow.value === "object") ? companyRow.value as Record<string, any> : {};
    const reviewUrl = String(company.googleReviewUrl || "").trim();
    let parsedUrl: URL | null = null;
    try { parsedUrl = new URL(reviewUrl); } catch { parsedUrl = null; }
    if (!parsedUrl || (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:")) {
      return json({ error: "Le lien d'avis Google renseigné dans Mon entreprise n'est pas une adresse valide." }, 400);
    }

    const clientEmail = String(doc.client?.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) return json({ error: "Le client de cette facture n'a pas d'adresse email valide." }, 400);
    const clientName = String(doc.client?.name || "").trim();
    const companyName = String(company.name || doc.company?.name || "").trim() || FROM_NAME;
    const companyEmail = String(company.email || doc.company?.email || "").trim();
    const replyTo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(companyEmail) ? companyEmail : undefined;

    const greeting = clientName ? `Bonjour ${escapeHtml(clientName)},` : "Bonjour,";
    const html = `
      <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1B2A33; line-height: 1.5;">
        <p>${greeting}</p>
        <p>Merci pour votre confiance et pour le règlement de la facture <strong>${escapeHtml(String(doc.docNumber || ""))}</strong>.</p>
        <p>Si vous êtes satisfait(e) de notre intervention, votre avis nous aiderait beaucoup. Cela ne prend qu'une minute :</p>
        <p style="margin: 24px 0;">
          <a href="${escapeHtml(parsedUrl.href)}" style="display: inline-block; background: #8F5C2E; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 600;">Laisser un avis Google</a>
        </p>
        <p style="font-size: 13px; color: #4A5B63;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>${escapeHtml(parsedUrl.href)}</p>
        <p>Merci encore,<br><strong>${escapeHtml(companyName)}</strong></p>
      </div>
    `;

    const emailResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [clientEmail],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject: `${companyName} — votre avis compte pour nous`,
        html,
      }),
    });

    if (!emailResp.ok) {
      const errText = await emailResp.text();
      console.error("Erreur d'envoi de la demande d'avis", errText);
      return json({ error: "L'envoi de l'email a échoué. Réessaie dans un instant." }, 502);
    }

    return json({ success: true });
  } catch (err) {
    console.error("Erreur send-review-request", err);
    return json({ error: "Une erreur inattendue est survenue." }, 500);
  }
});
