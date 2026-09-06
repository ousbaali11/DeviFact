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

    let query = dbAdmin.from("profiles").select("id, email, confirmation_token, confirmed_at, created_at, last_confirmation_sent_at");
    query = userId ? query.eq("id", userId) : query.eq("email", email);
    const { data: profile, error: profileError } = await query.maybeSingle();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Compte introuvable" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (profile.confirmed_at) {
      return new Response(JSON.stringify({ error: "Ce compte est déjà confirmé" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Sécurité : sans ça, n'importe qui pourrait harceler une adresse
    // email avec des envois répétés, ou épuiser le quota d'envoi.
    // Deux cas légitimes seulement : un Admin qui relance quelqu'un
    // (bouton "Relancer"), ou l'inscription toute fraîche de ce compte
    // précis (quelques minutes) — jamais un appel ciblant un compte
    // existant au hasard, sans lien avec l'appelant.
    const authHeader = req.headers.get("Authorization") || "";
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user: caller } } = await authClient.auth.getUser();
    let isAllowed = false;
    if (caller) {
      const { data: callerProfile } = await dbAdmin.from("profiles").select("is_admin").eq("id", caller.id).maybeSingle();
      isAllowed = !!callerProfile?.is_admin;
    }
    if (!isAllowed) {
      const ageMinutes = (Date.now() - new Date(profile.created_at).getTime()) / 60000;
      isAllowed = ageMinutes <= 10;
    }
    if (!isAllowed) {
      return new Response(JSON.stringify({ error: "Non autorisé." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Limite de fréquence — même pour un cas légitime, jamais plus
    // d'un envoi toutes les 60 secondes pour le même compte.
    if (profile.last_confirmation_sent_at) {
      const secondsSinceLast = (Date.now() - new Date(profile.last_confirmation_sent_at).getTime()) / 1000;
      if (secondsSinceLast < 60) {
        return new Response(JSON.stringify({ error: "Un email a déjà été envoyé il y a moins d'une minute — patiente un peu avant de réessayer." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
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
