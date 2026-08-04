// manage-api-key/index.ts
//
// Crée ou révoque une clé API pour une organisation, uniquement pour
// son propriétaire, uniquement si l'organisation est sur le forfait
// Entreprise. La clé en clair n'est renvoyée qu'une seule fois, à sa
// création — seule son empreinte (hash) est conservée en base.

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function generateApiKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return "dfk_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashKey(key: string) {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return jsonResponse({ error: "Non connecté" }, 401);

    const { action, organizationId, name, keyId } = await req.json();
    if (!organizationId) return jsonResponse({ error: "Organisation manquante" }, 400);

    // Vérifie que l'appelant est bien propriétaire de CETTE organisation précisément.
    const { data: membership } = await dbAdmin
      .from("organization_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .maybeSingle();
    if (!membership || membership.role !== "owner") {
      return jsonResponse({ error: "Seul le propriétaire peut gérer les clés API" }, 403);
    }

    // Vérifie que l'organisation est bien sur le forfait Entreprise.
    const { data: org } = await dbAdmin.from("organizations").select("plan").eq("id", organizationId).maybeSingle();
    if (org?.plan !== "entreprise") {
      return jsonResponse({ error: "L'accès API est réservé au forfait Entreprise" }, 403);
    }

    if (action === "create") {
      const plainKey = generateApiKey();
      const keyHash = await hashKey(plainKey);
      const keyPrefix = plainKey.slice(0, 12) + "…";
      const { data: created, error } = await dbAdmin.from("api_keys").insert({
        organization_id: organizationId,
        name: (name || "Clé API").trim().slice(0, 60),
        key_hash: keyHash,
        key_prefix: keyPrefix,
        created_by: user.id,
      }).select("id, name, key_prefix, created_at").single();
      if (error) return jsonResponse({ error: "Erreur de création : " + error.message }, 500);
      // La clé en clair n'apparaît qu'ici, une seule fois — impossible
      // de la récupérer à nouveau après cette réponse.
      return jsonResponse({ ...created, key: plainKey });
    }

    if (action === "revoke") {
      if (!keyId) return jsonResponse({ error: "Clé manquante" }, 400);
      const { error } = await dbAdmin.from("api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", keyId).eq("organization_id", organizationId);
      if (error) return jsonResponse({ error: "Erreur de révocation : " + error.message }, 500);
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Action inconnue" }, 400);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Erreur serveur" }, 500);
  }
});
