// suggest-lines/index.ts
//
// Reçoit la description d'un chantier depuis l'application, appelle
// l'API Gemini (gratuite) avec une clé gardée secrète côté serveur,
// et renvoie une liste de lignes suggérées (désignation, quantité, unité).
// Ne renvoie jamais de prix — l'artisan garde la main sur ses tarifs.
//
// Déploiement : voir le Guide de déploiement, section "IA (Gemini)".

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
// "gemini-flash-latest" est un alias officiel Google qui pointe TOUJOURS
// vers le modèle Flash actuel — il est automatiquement mis à jour par
// Google (avec un préavis de 2 semaines en cas de changement important).
// Plus besoin de changer ce nom à la main quand Google sort un nouveau
// modèle. Voir https://ai.google.dev/gemini-api/docs/models
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    // Vérifie que la requête vient bien d'un utilisateur connecté à
    // l'application (pas d'un script extérieur qui viderait le quota
    // gratuit). On utilise le jeton envoyé par le navigateur.
    const authHeader = req.headers.get("Authorization") || "";
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Non connecté" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { description } = await req.json();
    if (!description || typeof description !== "string") {
      return new Response(JSON.stringify({ error: "Description manquante" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const prompt = `Tu es un assistant pour un artisan du bâtiment français qui rédige un devis. À partir de la description du chantier ci-dessous, propose une liste de lignes de devis structurées et réalistes pour ce métier (6 lignes maximum). Ne propose AUCUN prix : les artisans fixent eux-mêmes leurs prix. Réponds UNIQUEMENT avec un tableau JSON valide et COMPACT (sans retour à la ligne, sans indentation, tout sur une seule ligne), sans texte avant ni après, sans balises markdown, exactement sous cette forme : [{"designation":"...","qty":1,"unit":"forfait"}]. Unités possibles : forfait, heure, jour, m², m³, ml, pièce, kg, lot, ou une chaîne vide.\n\nDescription du chantier : ${description.slice(0, 2000)}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 4096,
            // Force Gemini à renvoyer du JSON pur (fonctionnalité native
            // de l'API), plus fiable que de le demander seulement dans le texte.
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Erreur Gemini (appel) :", errText);
      return new Response(JSON.stringify({ error: "Erreur du service IA" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const geminiData = await geminiRes.json();
    const finishReason = geminiData.candidates?.[0]?.finishReason;
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const clean = text.replace(/^```json\s*|^```\s*|```\s*$/g, "").trim();

    let lines;
    try {
      lines = JSON.parse(clean);
    } catch (parseErr) {
      // On journalise TOUJOURS la réponse brute ici : c'est la seule
      // façon de savoir pourquoi Gemini n'a pas renvoyé un JSON exploitable
      // (prompt bloqué par un filtre de sécurité, texte tronqué, etc.)
      console.error("Erreur Gemini (JSON invalide) — finishReason:", finishReason, "— texte brut reçu :", text);
      lines = [];
    }
    if (Array.isArray(lines) && lines.length === 0) {
      console.error("Gemini a répondu mais sans lignes — finishReason:", finishReason, "— texte brut reçu :", text);
    }

    return new Response(JSON.stringify({ lines }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Erreur serveur" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
