// admin-delete-account
//
// Suppression d'un compte par un administrateur du site (01/10/2026), depuis
// Admin → Utilisateurs. Tout est vérifié côté serveur :
//   - l'appelant est un administrateur (profiles.is_admin) ;
//   - jamais soi-même, jamais un autre administrateur ;
//   - les appartenances du compte sont retirées ;
//   - les organisations dont il était le seul membre actif sont supprimées
//     avec leurs données (kv_store puis la ligne d'organisation, le reste
//     suit en cascade) si `deleteData` est vrai, sinon conservées vides ;
//   - une ligne de journal account_deletions est écrite ;
//   - le compte d'authentification est supprimé (profil et sessions suivent
//     par clé étrangère ; l'adresse e-mail redevient utilisable).
// Prérequis : script 2026-10-01_suppression-compte.sql (clés étrangères en
// « mise à null », table account_deletions, delete_account_preview).
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const dbAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  try {
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return json({ error: "Non connecté" }, 401);
    const { data: caller } = await dbAdmin.from("profiles").select("is_admin, email").eq("id", user.id).maybeSingle();
    if (!caller?.is_admin) return json({ error: "Réservé aux administrateurs du site." }, 403);

    const body = await req.json().catch(() => ({}));
    const userId = typeof body?.userId === "string" ? body.userId : "";
    const deleteData = body?.deleteData !== false; // par défaut : supprimer aussi les données des organisations vides
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "Identifiant de compte manquant." }, 400);
    if (userId === user.id) return json({ error: "Tu ne peux pas supprimer ton propre compte depuis l'Admin." }, 400);

    const { data: target, error: targetError } = await dbAdmin.auth.admin.getUserById(userId);
    if (targetError || !target?.user) return json({ error: "Compte introuvable." }, 404);
    const targetEmail = String(target.user.email || "");
    const { data: targetProfile } = await dbAdmin.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
    if (targetProfile?.is_admin) return json({ error: "Un autre administrateur ne peut pas être supprimé depuis l'Admin : retire-lui d'abord ce rôle." }, 400);

    // 1. Appartenances et organisations concernées.
    const { data: membershipsRaw, error: memError } = await dbAdmin.from("organization_members").select("organization_id, role, status, organizations ( id, name )").eq("user_id", userId);
    if (memError) return json({ error: `Lecture des organisations impossible : ${memError.message}` }, 500);
    // deno-lint-ignore no-explicit-any
    const memberships: any[] = (membershipsRaw || []) as any[];
    const orgIds = (memberships || []).map((m: any) => m.organization_id);
    const { data: others } = orgIds.length
      ? await dbAdmin.from("organization_members").select("organization_id").in("organization_id", orgIds).neq("user_id", userId).eq("status", "active")
      : { data: [] };
    const withOthers = new Set((others || []).map((m: any) => m.organization_id));
    const sole = (memberships || []).filter((m: any) => m.status === "active" && !withOthers.has(m.organization_id));
    const shared = (memberships || []).filter((m: any) => withOthers.has(m.organization_id));
    const describe = (m: any) => ({ id: m.organization_id, name: m.organizations?.name || "", role: m.role });

    // Volumes des organisations à supprimer (pour le journal).
    const deleted: any[] = [];
    for (const m of sole) {
      const { data: rows } = await dbAdmin.from("kv_store").select("key, value").eq("organization_id", m.organization_id).in("key", ["documents", "clients"]);
      const count = (key: string) => { const v = (rows || []).find((r: any) => r.key === key)?.value; return Array.isArray(v) ? v.length : 0; };
      deleted.push({ ...describe(m), documents: count("documents"), clients: count("clients") });
    }

    // 2. Appartenances retirées.
    const { error: delMemError } = await dbAdmin.from("organization_members").delete().eq("user_id", userId);
    if (delMemError) return json({ error: `Retrait des appartenances impossible : ${delMemError.message}` }, 500);

    // 3. Organisations vides : supprimées avec leurs données, ou conservées.
    const kept: any[] = [];
    if (deleteData) {
      for (const m of sole) {
        const { error: kvError } = await dbAdmin.from("kv_store").delete().eq("organization_id", m.organization_id);
        if (kvError) return json({ error: `Suppression des données de « ${m.organizations?.name || m.organization_id} » impossible : ${kvError.message}` }, 500);
        const { error: orgError } = await dbAdmin.from("organizations").delete().eq("id", m.organization_id);
        if (orgError) return json({ error: `Suppression de l'organisation « ${m.organizations?.name || m.organization_id} » impossible : ${orgError.message}` }, 500);
      }
    } else {
      kept.push(...sole.map(describe));
    }

    // 4. Journal, puis compte d'authentification.
    const { error: logError } = await dbAdmin.from("account_deletions").insert({ deleted_user_id: userId, deleted_email: targetEmail, deleted_by: user.id, organizations_deleted: deleteData ? deleted : [], organizations_kept: kept, memberships_removed: shared.map(describe) });
    if (logError) console.error("Journal des suppressions non écrit :", logError.message);
    const { error: deleteError } = await dbAdmin.auth.admin.deleteUser(userId);
    if (deleteError) return json({ error: `Compte non supprimé côté authentification : ${deleteError.message}. Ses appartenances ont déjà été retirées.` }, 500);

    return json({ ok: true, email: targetEmail, organizationsDeleted: deleteData ? deleted : [], organizationsKept: kept, membershipsRemoved: shared.map(describe) });
  } catch (err) {
    console.error("Erreur admin-delete-account", err);
    return json({ error: (err as Error)?.message || "Une erreur inattendue est survenue." }, 500);
  }
});
