// auto-confirm-user/index.ts
//
// Force le compte à être marqué "confirmé" côté Supabase (le
// mécanisme natif de Supabase, séparé du nôtre) immédiatement à
// l'inscription — pour que la connexion ne soit JAMAIS bloquée,
// peu importe l'état du réglage "Confirm email" dans le tableau de
// bord (qui peut être mal réglé, oublié, ou changer un jour sans
// qu'on s'en aperçoive).
//
// La vraie confirmation (avec le délai de 8 semaines, visible dans
// Admin → Utilisateurs) reste entièrement gérée par notre propre
// système (confirmation_token / confirmed_at dans "profiles"),
// totalement indépendant de celui-ci.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { userId } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: "userId requis" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Sécurité : n'autorise cette action que pour un compte créé très
    // récemment (quelques minutes) — jamais pour cibler un compte
    // existant au hasard. Pas de vérification par session ici
    // volontairement : au moment précis de l'appel, juste après
    // l'inscription, la session peut ne pas encore être pleinement
    // établie (c'est justement pour contourner ce genre de souci de
    // timing que cette fonction existe) — une fenêtre de temps courte
    // est une protection fiable qui ne dépend de rien d'autre.
    const { data: targetUser, error: getUserError } = await dbAdmin.auth.admin.getUserById(userId);
    if (getUserError || !targetUser?.user) {
      return new Response(JSON.stringify({ error: "Compte introuvable." }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const createdAt = new Date(targetUser.user.created_at).getTime();
    const ageMinutes = (Date.now() - createdAt) / 60000;
    if (ageMinutes > 10) {
      console.error(`Tentative de confirmation forcée sur un compte trop ancien (${ageMinutes.toFixed(1)} min) : ${userId}`);
      return new Response(JSON.stringify({ error: "Cette action n'est disponible que juste après l'inscription." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { error } = await dbAdmin.auth.admin.updateUserById(userId, { email_confirm: true });
    if (error) {
      console.error("Erreur de confirmation forcée :", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erreur auto-confirm-user :", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
