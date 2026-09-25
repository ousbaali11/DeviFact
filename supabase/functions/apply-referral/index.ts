// apply-referral/index.ts
//
// Programme de parrainage : juste après l'inscription, enregistre le parrain
// d'un compte tout neuf à partir du code saisi (ou du lien ?parrain=CODE),
// puis avertit le parrain par e-mail — sans jamais lui révéler l'adresse du
// filleul. Pas de récompense automatique.
//
// Sécurité : le compte lui-même doit être connecté (le site appelle cette
// fonction après la mise en place de l'espace, session établie) — personne
// d'autre ne peut poser un parrain sur un compte ; uniquement pour un compte
// créé il y a moins de 10 minutes, sans parrain déjà enregistré, avec un
// code qui existe et qui n'est pas le sien. Un code faux ne bloque jamais
// l'inscription : le site l'affiche simplement.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("CONFIRMATION_FROM_EMAIL") || "noreply@chantiflow.fr";
const FROM_NAME = Deno.env.get("CONFIRMATION_FROM_NAME") || "Chantiflow";
const SITE_URL = Deno.env.get("SITE_URL") || "https://www.chantiflow.fr";

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
    const { userId, code } = await req.json();
    const cleanCode = String(code || "").trim().toUpperCase();
    if (typeof userId !== "string" || !userId || !/^[A-Z0-9]{6,12}$/.test(cleanCode)) {
      return json({ error: "Code de parrainage invalide." }, 400);
    }
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user: caller } } = await authClient.auth.getUser();
    if (!caller || caller.id !== userId) return json({ error: "Session non établie : le code de parrainage n'a pas pu être appliqué." }, 401);

    // Compte tout neuf seulement.
    const { data: targetUser, error: getUserError } = await dbAdmin.auth.admin.getUserById(userId);
    if (getUserError || !targetUser?.user) return json({ error: "Compte introuvable." }, 404);
    const ageMinutes = (Date.now() - new Date(targetUser.user.created_at).getTime()) / 60000;
    if (ageMinutes > 10) {
      console.error(`Parrainage refusé sur un compte trop ancien (${ageMinutes.toFixed(1)} min) : ${userId}`);
      return json({ error: "Le code de parrainage ne peut être appliqué qu'à l'inscription." }, 403);
    }

    const { data: profile } = await dbAdmin.from("profiles").select("id, referred_by, referral_code").eq("id", userId).maybeSingle();
    if (!profile) return json({ error: "Compte introuvable." }, 404);
    if (profile.referred_by) return json({ error: "Un parrain est déjà enregistré pour ce compte." }, 409);

    const { data: sponsor, error: sponsorError } = await dbAdmin.from("profiles").select("id, email, first_name, company_name").eq("referral_code", cleanCode).maybeSingle();
    if (sponsorError) { console.error("Lecture du parrain impossible :", sponsorError.message); return json({ error: "Parrainage impossible pour le moment." }, 500); }
    if (!sponsor) return json({ error: "Code de parrainage inconnu : ton compte est créé sans parrain." }, 400);
    if (sponsor.id === userId) return json({ error: "Tu ne peux pas utiliser ton propre code de parrainage." }, 400);

    const { data: updated, error: updateError } = await dbAdmin.from("profiles").update({ referred_by: sponsor.id, referred_at: new Date().toISOString() }).eq("id", userId).is("referred_by", null).select("id");
    if (updateError) {
      console.error("Parrainage non enregistré :", updateError.message);
      return json({ error: "Parrainage impossible pour le moment." }, 500);
    }
    // Aucune ligne modifiée : un parrain a été posé entre-temps (double envoi) — pas d'e-mail.
    if (!updated || updated.length === 0) return json({ error: "Un parrain est déjà enregistré pour ce compte." }, 409);

    // Le parrain est prévenu par e-mail — jamais l'adresse du filleul.
    if (RESEND_API_KEY && sponsor.email) {
      const greeting = String(sponsor.first_name || "").trim() ? `Bonjour ${escapeHtml(String(sponsor.first_name).trim())},` : "Bonjour,";
      const emailResp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${FROM_NAME} <${FROM_EMAIL}>`,
          to: [sponsor.email],
          subject: `${FROM_NAME} — un nouveau compte s'est inscrit avec ton code de parrainage`,
          html: `
            <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1B2A33; line-height: 1.5;">
              <p>${greeting}</p>
              <p>Bonne nouvelle : une personne vient de s'inscrire sur ${escapeHtml(FROM_NAME)} avec ton code de parrainage <strong>${escapeHtml(cleanCode)}</strong>.</p>
              <p>Tu retrouves tes filleuls dans <a href="${escapeHtml(SITE_URL)}" style="color: #8F5C2E;">Mon compte › Parrainage</a>. Pas de récompense automatique pour l'instant, mais merci de faire connaître ${escapeHtml(FROM_NAME)} !</p>
            </div>
          `,
        }),
      });
      if (!emailResp.ok) console.error("E-mail au parrain non envoyé :", await emailResp.text());
    }

    return json({ success: true });
  } catch (err) {
    console.error("Erreur apply-referral", err);
    return json({ error: "Une erreur inattendue est survenue." }, 500);
  }
});
