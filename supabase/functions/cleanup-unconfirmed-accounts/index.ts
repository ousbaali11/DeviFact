// cleanup-unconfirmed-accounts/index.ts
//
// Supprime les comptes créés il y a plus de 8 semaines et jamais
// confirmés (voir migration_confirmation_8_semaines.sql). Déclenchée
// automatiquement chaque jour (voir migration_cron_confirmation.sql).

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
    const eightWeeksAgo = new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: expired, error: selectError } = await dbAdmin
      .from("profiles")
      .select("id, email")
      .is("confirmed_at", null)
      .lt("created_at", eightWeeksAgo);

    if (selectError) throw selectError;
    if (!expired || !expired.length) {
      return new Response(JSON.stringify({ success: true, deleted: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let deleted = 0;
    const errors: string[] = [];
    for (const profile of expired) {
      // Supprime le compte d'authentification — les tables liées
      // (profils, appartenances, organisations sans autre membre)
      // suivent via les clés étrangères déjà en place.
      const { error: deleteError } = await dbAdmin.auth.admin.deleteUser(profile.id);
      if (deleteError) {
        errors.push(`${profile.email} : ${deleteError.message}`);
      } else {
        deleted++;
      }
    }

    return new Response(JSON.stringify({ success: true, deleted, total: expired.length, errors }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erreur cleanup-unconfirmed-accounts :", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
