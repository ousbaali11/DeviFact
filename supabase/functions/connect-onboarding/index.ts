// connect-onboarding/index.ts
//
// Stripe Connect, livraison 1 : compte Stripe connecté d'une organisation.
//   - action "status" : état du compte (créé ? paiements actifs ? virements
//     actifs ? informations manquantes ?), relu chez Stripe et recopié en
//     base à chaque appel.
//   - action "start"  : crée le compte connecté s'il n'existe pas encore,
//     puis renvoie un lien d'inscription hébergée par Stripe (identité,
//     SIRET, IBAN…). Sert aussi à reprendre une inscription inachevée.
//
// Réservé au propriétaire de l'organisation — vérifié ici, avec la clé de
// service, jamais dans le navigateur. Les colonnes organizations.stripe_*
// ne sont écrites que par cette fonction (déclencheur SQL de protection).
//
// Configuration validée le 22/09/2026 (ancien compte « Standard ») :
// l'artisan a son propre tableau de bord Stripe complet, paie ses frais
// Stripe, Stripe est responsable des soldes négatifs et collecte lui-même
// les informations. Le type de tableau de bord est immuable : ne pas le
// changer sans recréer les comptes.
//
// Secrets : STRIPE_SECRET_KEY (déjà utilisé par create-checkout-session).

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type OrgRow = {
  id: string;
  name: string | null;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  stripe_details_submitted: boolean;
  stripe_connect_updated_at: string | null;
};

// État renvoyé au navigateur : jamais l'identifiant du compte ni de
// donnée personnelle, seulement ce qu'il faut pour afficher l'écran.
function statusOf(account: Stripe.Account | null) {
  if (!account) return { connected: false };
  return {
    connected: true,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
    requirementsDue: account.requirements?.currently_due?.length ?? 0,
    disabledReason: account.requirements?.disabled_reason ?? null,
  };
}

async function saveAccountState(orgId: string, account: Stripe.Account) {
  const { error } = await dbAdmin.from("organizations").update({
    stripe_account_id: account.id,
    stripe_charges_enabled: account.charges_enabled === true,
    stripe_payouts_enabled: account.payouts_enabled === true,
    stripe_details_submitted: account.details_submitted === true,
    stripe_connect_updated_at: new Date().toISOString(),
  }).eq("id", orgId);
  if (error) console.error("Erreur d'enregistrement de l'état Stripe Connect :", error.message);
}

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
    if (!user) return json({ error: "Non connecté" }, 401);

    const { organizationId, action } = await req.json();
    if (!organizationId) return json({ error: "Organisation manquante" }, 400);
    if (action !== "status" && action !== "start") return json({ error: "Action inconnue" }, 400);

    // Propriétaire PRÉCISÉMENT de cette organisation (une personne peut
    // appartenir à plusieurs organisations avec des rôles différents).
    const { data: membership } = await dbAdmin
      .from("organization_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .maybeSingle();
    if (!membership || membership.role !== "owner") {
      return json({ error: "Seul le propriétaire de l'organisation peut connecter le compte bancaire" }, 403);
    }

    const { data: org, error: orgError } = await dbAdmin
      .from("organizations")
      .select("id, name, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_connect_updated_at")
      .eq("id", organizationId)
      .maybeSingle<OrgRow>();
    if (orgError) {
      // Typiquement : colonnes absentes, script SQL de la livraison 1 pas encore appliqué.
      console.error("Organisation illisible (colonnes Stripe Connect manquantes ?) :", orgError.message);
      return json({ error: "Connexion bancaire pas encore disponible : base de données à préparer (script SQL Stripe Connect)." }, 500);
    }
    if (!org) return json({ error: "Organisation introuvable" }, 404);

    // Compte existant : état relu chez Stripe (source de vérité) et recopié.
    let account: Stripe.Account | null = null;
    if (org.stripe_account_id) {
      try {
        account = await stripe.accounts.retrieve(org.stripe_account_id);
        await saveAccountState(org.id, account);
      } catch (err) {
        console.error("Compte Stripe connecté illisible :", err);
        if (action === "status") {
          return json({ ...statusOf(null), connected: true, chargesEnabled: org.stripe_charges_enabled, payoutsEnabled: org.stripe_payouts_enabled, detailsSubmitted: org.stripe_details_submitted, requirementsDue: 0, disabledReason: null, stale: true });
        }
        return json({ error: "Impossible de relire ton compte Stripe pour l'instant. Réessaie dans un instant." }, 502);
      }
    }

    if (action === "status") return json(statusOf(account));

    // action "start" : création du compte si besoin, puis lien d'inscription.
    if (!account) {
      // Pays fixé à la France (immuable ensuite) : le service s'adresse aux
      // artisans français. Nom de l'entreprise et e-mail pré-remplis, le
      // reste (identité, SIRET, IBAN…) est collecté par Stripe.
      account = await stripe.accounts.create({
        country: "FR",
        email: user.email || undefined,
        business_profile: org.name ? { name: org.name } : undefined,
        controller: {
          fees: { payer: "account" },
          losses: { payments: "stripe" },
          stripe_dashboard: { type: "full" },
          requirement_collection: "stripe",
        },
        metadata: { organizationId: org.id },
      });
      await saveAccountState(org.id, account);
    }

    const origin = req.headers.get("origin") || "https://www.chantiflow.fr";
    const link = await stripe.accountLinks.create({
      account: account.id,
      type: "account_onboarding",
      // Le lien expire vite : Stripe renvoie sur refresh_url pour en
      // demander un nouveau, et sur return_url à la fin (ou à l'abandon).
      refresh_url: `${origin}/?stripe-connect=reprise`,
      return_url: `${origin}/?stripe-connect=retour`,
    });
    return json({ url: link.url });
  } catch (err) {
    console.error("Erreur connect-onboarding", err);
    return json({ error: "Une erreur inattendue est survenue." }, 500);
  }
});
