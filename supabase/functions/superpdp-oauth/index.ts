// superpdp-oauth/index.ts
//
// Super PDP, étape 1 : connexion du compte Super PDP de l'artisan (flux
// OAuth 2.1 Authorization Code + PKCE), propriétaire de l'organisation
// seulement. Actions :
//   - "start"      : prépare l'état et le code PKCE (10 minutes), renvoie
//                    l'adresse d'autorisation pré-remplie (e-mail, SIREN) ;
//   - "callback"   : échange le code contre les jetons (client_secret côté
//                    serveur uniquement), lit l'entreprise connectée, refuse
//                    la production tant qu'elle n'est pas autorisée, chiffre
//                    et enregistre ;
//   - "status"     : état sans aucun jeton ;
//   - "disconnect" : révocation puis suppression.
//
// Secrets : SUPERPDP_CLIENT_ID, SUPERPDP_CLIENT_SECRET, SUPERPDP_TOKEN_KEY,
// SUPERPDP_API_BASE (facultatif), SITE_URL ; SUPERPDP_ALLOW_PRODUCTION="true"
// pour autoriser un jour les entreprises en production.
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPERPDP_ENABLED } from "../_shared/pdp-flags.ts";
import { safeOrigin } from "../_shared/stripe.ts";
import {
  superpdpConfigured, superpdpAllowProduction, superpdpApiBase, superpdpClientId, superpdpTokenKey,
  sirenOf, pkcePair, randomToken, buildAuthorizeUrl, exchangeCode, revokeToken, encryptSecret, decryptSecret,
  readConnection, publicStatusOf, apiErrorMessage,
} from "../_shared/superpdp.ts";

const dbAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  if (!SUPERPDP_ENABLED) return json({ error: "La connexion à la Plateforme Agréée est désactivée." }, 503);

  try {
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return json({ error: "Non connecté" }, 401);

    const body = await req.json().catch(() => ({}));
    const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
    const action = String(body?.action || "");
    if (!organizationId) return json({ error: "Organisation manquante" }, 400);
    if (!["start", "callback", "status", "disconnect"].includes(action)) return json({ error: "Action inconnue" }, 400);

    // Membre actif de cette organisation ; propriétaire pour tout sauf
    // l'état (qui ne contient aucun jeton et sert aux éditeurs pour l'envoi).
    const { data: membership } = await dbAdmin.from("organization_members").select("role").eq("user_id", user.id).eq("organization_id", organizationId).eq("status", "active").maybeSingle();
    if (!membership) return json({ error: "Accès refusé." }, 403);
    if (action !== "status" && membership.role !== "owner") return json({ error: "Seul le propriétaire de l'organisation peut connecter le compte Super PDP." }, 403);

    if (action === "status") {
      const conn = await readConnection(dbAdmin, organizationId);
      return json({ configured: superpdpConfigured(), ...publicStatusOf(conn) });
    }
    if (!superpdpConfigured()) return json({ error: "Connexion Super PDP pas encore configurée (secrets SUPERPDP_* absents)." }, 503);

    if (action === "start") {
      const origin = safeOrigin(req.headers.get("origin"), (Deno.env.get("SITE_URL") || "https://www.chantiflow.fr").replace(/\/+$/, ""));
      const redirectUri = `${origin}/?superpdp=retour`;
      // Pré-remplissage de l'inscription chez Super PDP : e-mail et SIREN de
      // la fiche Mon entreprise (le SIREN est déduit du SIRET).
      const { data: profileRow } = await dbAdmin.from("kv_store").select("value").eq("organization_id", organizationId).eq("key", "company-profile").eq("shared", false).maybeSingle();
      const profile: any = profileRow?.value && typeof profileRow.value === "object" ? profileRow.value : {};
      const loginHint = String(profile.email || user.email || "").trim();
      const siren = sirenOf(profile.siret);
      const { verifier, challenge } = await pkcePair();
      const state = randomToken(24);
      // Un seul état en attente par organisation et par personne.
      await dbAdmin.from("pdp_oauth_states").delete().eq("organization_id", organizationId).eq("user_id", user.id);
      const { error: insertError } = await dbAdmin.from("pdp_oauth_states").insert({ state, organization_id: organizationId, user_id: user.id, code_verifier: verifier, redirect_uri: redirectUri });
      if (insertError) { console.error("État OAuth non enregistré :", insertError.message); return json({ error: "Connexion impossible pour le moment (base de données à préparer : script Super PDP étape 1 ?)." }, 500); }
      return json({ url: buildAuthorizeUrl(superpdpApiBase(), { clientId: superpdpClientId(), redirectUri, state, codeChallenge: challenge, loginHint, siren }), prefilled: { email: !!loginHint, siren: !!siren } });
    }

    if (action === "callback") {
      const code = typeof body?.code === "string" ? body.code : "";
      const state = typeof body?.state === "string" ? body.state : "";
      if (!code || !state) return json({ error: "Retour d'autorisation incomplet (code ou état manquant)." }, 400);
      const { data: st } = await dbAdmin.from("pdp_oauth_states").select("*").eq("state", state).maybeSingle();
      // L'état est à usage unique, quoi qu'il arrive ensuite.
      if (st) await dbAdmin.from("pdp_oauth_states").delete().eq("state", state);
      if (!st || st.organization_id !== organizationId || st.user_id !== user.id) return json({ error: "Retour d'autorisation non reconnu : recommence la connexion." }, 400);
      if (Date.now() - new Date(st.created_at).getTime() > STATE_MAX_AGE_MS) return json({ error: "Autorisation expirée (plus de 10 minutes) : recommence la connexion." }, 400);

      const tokens = await exchangeCode(code, st.redirect_uri, st.code_verifier);
      const headers = { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" };
      const [meResp, sessionResp] = await Promise.all([
        fetch(`${superpdpApiBase()}/v1.beta/companies/me`, { headers }),
        fetch(`${superpdpApiBase()}/v1.beta/oauth2_sessions/me`, { headers }),
      ]);
      const session = sessionResp.ok ? await sessionResp.json().catch(() => null) : null;
      if (!meResp.ok) {
        const detail = await apiErrorMessage(meResp);
        await revokeToken(tokens.refresh_token || tokens.access_token);
        const verification = session?.company_verification_status && session.company_verification_status !== "verified" ? ` L'entreprise n'est pas encore vérifiée chez Super PDP (${session.company_verification_status}).` : "";
        return json({ error: `Impossible de lire l'entreprise connectée. ${detail}.${verification}` }, 502);
      }
      const company = await meResp.json();
      // Bac à sable seulement tant que la production n'est pas autorisée.
      if (company?.env !== "sandbox" && !superpdpAllowProduction()) {
        await revokeToken(tokens.refresh_token || tokens.access_token);
        return json({ error: "Ce compte Super PDP est en production. Chantiflow n'accepte pour l'instant que des entreprises en bac à sable (Burger Queen, Tricatel) : connexion refusée, aucun jeton conservé." }, 403);
      }
      const key = superpdpTokenKey();
      const row = {
        organization_id: organizationId,
        provider: "superpdp",
        env: company.env === "production" ? "production" : "sandbox",
        company_number: String(company.number || ""),
        company_number_scheme: String(company.number_scheme || ""),
        company_name: String(company.formal_name || company.trade_name || ""),
        vat_regime: String(company.vat_regime || ""),
        has_vat_on_debits: company.has_vat_on_debits === true,
        verification_status: String(session?.company_verification_status || ""),
        access_token_enc: await encryptSecret(tokens.access_token, key),
        refresh_token_enc: await encryptSecret(tokens.refresh_token || "", key),
        access_expires_at: new Date(Date.now() + Math.max(60, Number(tokens.expires_in) || 1800) * 1000).toISOString(),
        connected_by: user.id,
        connected_at: new Date().toISOString(),
        last_error: null,
      };
      if (!tokens.refresh_token) console.error("Super PDP : pas de jeton de rafraîchissement dans la réponse ; la connexion expirera avec le jeton d'accès.");
      const { error: upsertError } = await dbAdmin.from("pdp_connections").upsert(row, { onConflict: "organization_id" });
      if (upsertError) { console.error("Connexion Super PDP non enregistrée :", upsertError.message); await revokeToken(tokens.refresh_token || tokens.access_token); return json({ error: "Connexion impossible pour le moment (enregistrement refusé)." }, 500); }
      return json({ configured: true, ...publicStatusOf(row as any) });
    }

    if (action === "disconnect") {
      const conn = await readConnection(dbAdmin, organizationId);
      if (conn) {
        try { await revokeToken(await decryptSecret(conn.refresh_token_enc, superpdpTokenKey())); } catch (err) { console.error("Jeton Super PDP non révoqué", err); }
        const { error: delError } = await dbAdmin.from("pdp_connections").delete().eq("organization_id", organizationId);
        if (delError) return json({ error: "Déconnexion impossible pour le moment." }, 500);
      }
      return json({ configured: superpdpConfigured(), connected: false });
    }
    return json({ error: "Action inconnue" }, 400);
  } catch (err) {
    console.error("Erreur superpdp-oauth", err);
    return json({ error: (err as Error)?.message || "Une erreur inattendue est survenue." }, 500);
  }
});
