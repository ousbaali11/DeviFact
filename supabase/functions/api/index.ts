// api/index.ts
//
// API publique de lecture pour le forfait Entreprise. Authentification
// par clé API (pas par session utilisateur) — pensée pour être
// appelée depuis un logiciel externe (comptabilité, CRM...).
//
// Utilisation :
//   GET https://<projet>.supabase.co/functions/v1/api?resource=documents
//   GET https://<projet>.supabase.co/functions/v1/api?resource=documents&id=xxx
//   GET https://<projet>.supabase.co/functions/v1/api?resource=clients
//   Header : Authorization: Bearer dfk_...

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

const RATE_LIMIT_PER_MINUTE = 60;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function hashKey(key: string) {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return jsonResponse({ error: "Seules les requêtes GET sont acceptées" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const key = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!key) return jsonResponse({ error: "Clé API manquante (en-tête Authorization: Bearer ...)" }, 401);

    const keyHash = await hashKey(key);
    const { data: apiKey } = await dbAdmin
      .from("api_keys")
      .select("id, organization_id, revoked_at, organizations ( plan )")
      .eq("key_hash", keyHash)
      .maybeSingle();

    if (!apiKey || apiKey.revoked_at) return jsonResponse({ error: "Clé API invalide ou révoquée" }, 401);
    if (apiKey.organizations?.plan !== "entreprise") {
      return jsonResponse({ error: "Cette organisation n'est plus sur le forfait Entreprise — l'accès API est désactivé" }, 403);
    }

    // Limite de débit : compte les requêtes de la minute en cours.
    const minuteBucket = new Date();
    minuteBucket.setSeconds(0, 0);
    const bucketIso = minuteBucket.toISOString();
    const { data: usage } = await dbAdmin
      .from("api_key_usage")
      .select("request_count")
      .eq("key_id", apiKey.id)
      .eq("minute_bucket", bucketIso)
      .maybeSingle();
    if (usage && usage.request_count >= RATE_LIMIT_PER_MINUTE) {
      return jsonResponse({ error: `Limite de ${RATE_LIMIT_PER_MINUTE} requêtes par minute dépassée. Réessaie dans un instant.` }, 429);
    }
    await dbAdmin.from("api_key_usage").upsert(
      { key_id: apiKey.id, minute_bucket: bucketIso, request_count: (usage?.request_count || 0) + 1 },
      { onConflict: "key_id,minute_bucket" }
    );
    dbAdmin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", apiKey.id).then(() => {});

    const url = new URL(req.url);
    const resource = url.searchParams.get("resource");
    const id = url.searchParams.get("id");
    const kvKey = resource === "documents" ? "documents" : resource === "clients" ? "clients" : null;
    if (!kvKey) {
      return jsonResponse({ error: 'Paramètre "resource" invalide — utilise "documents" ou "clients".' }, 400);
    }

    const { data, error } = await dbAdmin
      .from("kv_store")
      .select("value")
      .eq("organization_id", apiKey.organization_id)
      .eq("key", kvKey)
      .eq("shared", false)
      .maybeSingle();
    if (error) return jsonResponse({ error: "Erreur de lecture des données" }, 500);

    let items = Array.isArray(data?.value) ? data.value : [];
    if (id) {
      const found = items.find((it: { id?: string }) => it.id === id);
      return found ? jsonResponse(found) : jsonResponse({ error: "Introuvable" }, 404);
    }
    return jsonResponse({ data: items, count: items.length });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Erreur serveur" }, 500);
  }
});
