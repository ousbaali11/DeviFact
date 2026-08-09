// send-confirmation-email/index.ts
//
// Envoie l'email de confirmation avec notre propre lien (pas celui de
// Supabase, puisque la confirmation obligatoire est désactivée côté
// Supabase — voir migration_confirmation_8_semaines.sql). Utilisée à
// l'inscription, et aussi pour le bouton "Relancer" côté Admin.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("CONFIRMATION_FROM_EMAIL") || "noreply@chantiflow.fr";
const FROM_NAME = Deno.env.get("CONFIRMATION_FROM_NAME") || "Chantiflow";
const SITE_URL = Deno.env.get("SITE_URL") || "https://www.chantiflow.fr";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { userId, email } = await req.json();
    if (!userId && !email) {
      return new Response(JSON.stringify({ error: "userId ou email requis" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let query = dbAdmin.from("profiles").select("id, email, confirmation_token, confirmed_at");
    query = userId ? query.eq("id", userId) : query.eq("email", email);
    const { data: profile, error: profileError } = await query.maybeSingle();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Compte introuvable" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (profile.confirmed_at) {
      return new Response(JSON.stringify({ error: "Ce compte est déjà confirmé" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Génère un nouveau token à chaque envoi — invalide l'ancien lien
    // au passage, ce qui évite qu'un vieux lien traîne indéfiniment.
    const { data: updated, error: updateError } = await dbAdmin
      .from("profiles")
      .update({ confirmation_token: crypto.randomUUID(), last_confirmation_sent_at: new Date().toISOString() })
      .eq("id", profile.id)
      .select("confirmation_token")
      .single();
    if (updateError || !updated) {
      return new Response(JSON.stringify({ error: "Erreur lors de la génération du lien" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const confirmUrl = `${SITE_URL}/?confirm=${updated.confirmation_token}`;

    const emailResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [profile.email],
        subject: "Confirme ton adresse email",
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1B2A33;">
            <h2>Confirme ton adresse email</h2>
            <p>Merci de t'être inscrit sur ${FROM_NAME}. Ton compte est déjà utilisable, mais il te reste à confirmer ton adresse email dans les <strong>8 semaines</strong> — passé ce délai, le compte non confirmé sera automatiquement supprimé.</p>
            <p><a href="${confirmUrl}" style="display: inline-block; background: #1B2A33; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">Confirmer mon email</a></p>
            <p style="font-size: 12px; color: #4A5B63;">Si tu n'es pas à l'origine de cette inscription, ignore simplement cet email.</p>
          </div>
        `,
      }),
    });
    if (!emailResp.ok) {
      const errText = await emailResp.text();
      console.error("Erreur d'envoi Resend :", errText);
      return new Response(JSON.stringify({ error: "Erreur d'envoi de l'email : " + errText }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erreur send-confirmation-email :", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
