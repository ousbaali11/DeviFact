// send-contact-message/index.ts
//
// Reçoit les messages du formulaire "Nous contacter" (public, pas
// besoin d'être connecté) — envoie un email à l'adresse configurée
// dans Admin → Identité du site, et garde une trace en base au cas où
// l'email se perdrait (spam, panne...).
//
// Déploiement : voir le Guide de déploiement, même principe que les
// autres fonctions.

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

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const { nom, prenom, telephone, email, objet, message } = await req.json();

    // Validation côté serveur — jamais faire confiance uniquement à
    // celle du navigateur, qui peut toujours être contournée.
    if (!nom?.trim() || !prenom?.trim() || !email?.trim() || !objet?.trim() || !message?.trim()) {
      return new Response(JSON.stringify({ error: "Merci de remplir tous les champs obligatoires." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: "Adresse email invalide." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Récupère l'adresse de réception configurée dans Admin — jamais
    // codée en dur, pour que le site continue de fonctionner même si
    // cette adresse change un jour.
    const { data: settings } = await dbAdmin.from("site_settings").select("contact_email").limit(1).maybeSingle();
    const toEmail = settings?.contact_email || "contact@chantiflow.fr";

    const { error: insertError } = await dbAdmin.from("contact_messages").insert({
      nom: nom.trim(), prenom: prenom.trim(), telephone: telephone?.trim() || null, email: email.trim(), objet: objet.trim(), message: message.trim(),
    });
    if (insertError) console.error("Erreur d'enregistrement du message de contact", insertError);

    const emailResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [toEmail],
        reply_to: email,
        subject: `[Contact] ${objet}`,
        html: `
          <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1B2A33;">
            <h2>Nouveau message via "Nous contacter"</h2>
            <p><strong>De :</strong> ${escapeHtml(prenom)} ${escapeHtml(nom)}</p>
            <p><strong>Email :</strong> ${escapeHtml(email)}</p>
            ${telephone ? `<p><strong>Téléphone :</strong> ${escapeHtml(telephone)}</p>` : ""}
            <p><strong>Objet :</strong> ${escapeHtml(objet)}</p>
            <p><strong>Message :</strong></p>
            <p style="white-space: pre-wrap; background: #F1F0EA; padding: 12px; border-radius: 8px;">${escapeHtml(message)}</p>
          </div>
        `,
      }),
    });

    if (!emailResp.ok) {
      const errText = await emailResp.text();
      console.error("Erreur d'envoi de l'email de contact", errText);
      // Le message est déjà enregistré en base à ce stade — on informe
      // quand même honnêtement que l'email a pu échouer, plutôt que de
      // prétendre que tout s'est bien passé.
      return new Response(JSON.stringify({ error: "Message enregistré, mais l'envoi de l'email a échoué. Nous le verrons quand même." }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erreur du formulaire de contact", err);
    return new Response(JSON.stringify({ error: "Une erreur inattendue est survenue. Réessaie dans un instant." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
