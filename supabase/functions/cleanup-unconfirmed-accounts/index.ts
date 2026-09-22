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

  // Sécurité : cette fonction ne doit être déclenchée que par la
  // tâche automatique quotidienne, jamais par un appel public direct
  // depuis internet — même si l'impact réel serait limité (elle ne
  // supprime que des comptes déjà censés l'être), un appel répété
  // sans raison reste inutile à autoriser.
  const providedSecret = req.headers.get("x-cron-secret") || "";
  const expectedSecret = Deno.env.get("CRON_SECRET") || "";
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Non autorisé" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const eightWeeksAgo = new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: candidates, error: selectError } = await dbAdmin
      .from("profiles")
      .select("id, email")
      .is("confirmed_at", null)
      .lt("created_at", eightWeeksAgo);

    if (selectError) throw selectError;
    // Un membre invité dans une organisation (éditeur, lecteur, comptable,
    // ou propriétaire de plusieurs espaces) n'a jamais reçu notre e-mail de
    // confirmation : il travaille, il n'est pas « non confirmé ». Seuls les
    // comptes qui n'ont que leur propre espace, jamais confirmés, sont retirés.
    const ids = (candidates || []).map((p: any) => p.id);
    const { data: memberships } = ids.length
      ? await dbAdmin.from("organization_members").select("user_id, role").in("user_id", ids).eq("status", "active")
      : { data: [] as any[] };
    const keep = new Set<string>();
    const count = new Map<string, number>();
    for (const m of memberships || []) {
      if (m.role !== "owner") keep.add(m.user_id);
      count.set(m.user_id, (count.get(m.user_id) || 0) + 1);
      if ((count.get(m.user_id) || 0) > 1) keep.add(m.user_id);
    }
    const expired = (candidates || []).filter((p: any) => !keep.has(p.id));
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
    return new Response(JSON.stringify({ error: "Erreur serveur" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
