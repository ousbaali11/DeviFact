// supabase/functions/suggest-lines/index.ts
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
const GEMINI_MODEL = "gemini-2.5-flash"; // rapide et gratuit ; ajustable si Google fait évoluer les noms de modèles

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
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Non connecté" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { description } = await req.json();
    if (!description || typeof description !== "string") {
      return new Response(JSON.stringify({ error: "Description manquante" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const prompt = `Tu es un assistant pour un artisan du bâtiment français qui rédige un devis. À partir de la description du chantier ci-dessous, propose une liste de lignes de devis structurées et réalistes pour ce métier (10 lignes maximum). Ne propose AUCUN prix : les artisans fixent eux-mêmes leurs prix. Réponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ni après, sans balises markdown, exactement sous cette forme : [{"designation":"...", "qty":1, "unit":"forfait"}]. Unités possibles : forfait, heure, jour, m², m³, ml, pièce, kg, lot, ou une chaîne vide.\n\nDescription du chantier : ${description.slice(0, 2000)}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1000 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Erreur Gemini :", errText);
      return new Response(JSON.stringify({ error: "Erreur du service IA" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const geminiData = await geminiRes.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const clean = text.replace(/^```json\s*|^```\s*|```\s*$/g, "").trim();

    let lines;
    try {
      lines = JSON.parse(clean);
    } catch {
      lines = [];
    }

    return new Response(JSON.stringify({ lines }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Erreur serveur" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
