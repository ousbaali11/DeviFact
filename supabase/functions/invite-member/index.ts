// invite-member/index.ts
//
// Invite un membre dans l'organisation de la personne connectée.
// Vérifie que l'appelant est bien propriétaire avant toute action —
// c'est cette fonction, pas le navigateur, qui décide qui a le droit
// d'inviter, en utilisant la clé secrète (jamais exposée au client).

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
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    // Identifie l'appelant à partir de son jeton de session.
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

    const { email, role } = await req.json();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanRole = ["owner", "editor", "viewer"].includes(role) ? role : "editor";
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return new Response(JSON.stringify({ error: "Email invalide" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Vérifie que l'appelant est bien propriétaire d'une organisation.
    const { data: membership } = await dbAdmin
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!membership || membership.role !== "owner") {
      return new Response(JSON.stringify({ error: "Seul le propriétaire peut inviter des membres" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const organizationId = membership.organization_id;

    // Cherche si un compte existe déjà pour cet email.
    const { data: existingProfile } = await dbAdmin
      .from("profiles")
      .select("id")
      .ilike("email", cleanEmail)
      .maybeSingle();

    let memberUserId = existingProfile?.id;

    // Sinon, crée le compte et lui envoie un email d'invitation.
    if (!memberUserId) {
      const { data: invited, error: inviteError } = await dbAdmin.auth.admin.inviteUserByEmail(cleanEmail, {
        redirectTo: req.headers.get("origin") || undefined,
      });
      if (inviteError) {
        console.error("Erreur d'invitation :", inviteError.message);
        return new Response(JSON.stringify({ error: "Impossible d'envoyer l'invitation : " + inviteError.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      memberUserId = invited.user.id;
      // Le profil correspondant est créé automatiquement par le
      // déclencheur existant sur auth.users (voir schema.sql).
      await dbAdmin.from("profiles").upsert({ id: memberUserId, email: cleanEmail }, { onConflict: "id" });
    }

    // Empêche d'inviter deux fois la même personne dans la même organisation.
    const { data: alreadyMember } = await dbAdmin
      .from("organization_members")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("user_id", memberUserId)
      .maybeSingle();
    if (alreadyMember) {
      return new Response(JSON.stringify({ error: "Cette personne fait déjà partie de l'organisation" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { error: insertError } = await dbAdmin.from("organization_members").insert({
      organization_id: organizationId,
      user_id: memberUserId,
      role: cleanRole,
      status: "active",
    });
    if (insertError) {
      console.error("Erreur d'ajout du membre :", insertError.message);
      return new Response(JSON.stringify({ error: "Impossible d'ajouter ce membre : " + insertError.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Erreur serveur" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
