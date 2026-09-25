// superpdp-send-invoice/index.ts
//
// Super PDP, étape 2 : transmission d'une facture (Factur-X) au client
// professionnel via la Plateforme Agréée — propriétaire ou éditeur.
// Tout est relu côté serveur (facture et fiche entreprise dans kv_store),
// jamais depuis ce que le navigateur envoie. Enchaînement :
//   1. éligibilité (_shared/superpdp-rules.ts) et compte connecté, vérifié,
//      en bac à sable tant que la production n'est pas autorisée ;
//   2. verrou « envoi en cours » (ligne pdp_invoices) ;
//   3. Factur-X produit par la fonction generate-facturx déjà déployée
//      (mêmes montants recalculés côté serveur) ;
//   4. validation par POST /validation_reports : rien n'est envoyé si le
//      rapport signale une erreur ;
//   5. annuaire : GET /french_directory/entries (bloquant en production,
//      simple avertissement en bac à sable, où l'annuaire est celui de Peppol) ;
//   6. POST /invoices avec processing_rule=B2B et external_id = document ;
//   7. enregistrement : ligne pdp_invoices + champ « pdp » du document.
// En bac à sable, les identifiants d'entreprise Super PDP (315143296_XXXXXX)
// remplacent le SIREN dans les adresses électroniques du XML (émetteur :
// entreprise connectée ; destinataire : champ SIRET de la fiche client).
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPERPDP_ENABLED } from "../_shared/pdp-flags.ts";
import { updateKvValue } from "../_shared/kv.ts";
import { superpdpConfigured, superpdpAllowProduction, superpdpApiBase, readConnection, superpdpFetch, apiErrorMessage } from "../_shared/superpdp.ts";
import { pdpEligibility, pdpCanResend, sandboxIdentifierOf, sirenOfSiret, PDP_STATUS_LABELS } from "../_shared/superpdp-rules.ts";

const dbAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const countryCode = (v: unknown): string | null => { const m = /([A-Za-z]{2})\s*$/.exec(String(v || "")); return m ? m[1].toUpperCase() : null; };

class SendError extends Error { status: number; extra: Record<string, unknown>; constructor(message: string, status = 400, extra: Record<string, unknown> = {}) { super(message); this.status = status; this.extra = extra; } }

async function readKv(organizationId: string, key: string) {
  const { data, error } = await dbAdmin.from("kv_store").select("value").eq("organization_id", organizationId).eq("key", key).eq("shared", false).maybeSingle();
  if (error) throw new SendError(`Lecture de « ${key} » impossible : ${error.message}`, 500);
  return data?.value ?? null;
}
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// Champ « pdp » du document, repris tel quel par le site (badge, verrou).
type PdpField = { invoiceId: number | null; externalId: string; env: string; status: string; statusText: string; sentAt: string | null; updatedAt: number; error?: string | null };
async function writeDocPdp(organizationId: string, documentId: string, pdp: PdpField) {
  const result = await updateKvValue<any[]>(dbAdmin, organizationId, "documents", (list) => (Array.isArray(list) ? list.map((d: any) => (d?.id === documentId ? { ...d, pdp, updatedAt: Date.now() } : d)) : list));
  if (!result.ok) console.error(`Champ pdp non enregistré sur ${documentId} : ${result.reason}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  if (!SUPERPDP_ENABLED) return json({ error: "La transmission via la Plateforme Agréée est désactivée." }, 503);

  let organizationId = "", documentId = "", marked = false;
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return json({ error: "Non connecté" }, 401);
    const body = await req.json().catch(() => ({}));
    organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
    documentId = typeof body?.documentId === "string" ? body.documentId : "";
    if (!organizationId || !documentId) return json({ error: "Organisation ou document manquant." }, 400);
    const { data: membership } = await dbAdmin.from("organization_members").select("role").eq("user_id", user.id).eq("organization_id", organizationId).eq("status", "active").maybeSingle();
    if (!membership || !["owner", "editor"].includes(membership.role)) return json({ error: "Seuls le propriétaire et les éditeurs peuvent transmettre une facture." }, 403);
    if (!superpdpConfigured()) return json({ error: "Connexion Super PDP pas encore configurée (secrets SUPERPDP_* absents)." }, 503);

    // 1. Compte connecté et facture éligible.
    const conn = await readConnection(dbAdmin, organizationId);
    if (!conn) return json({ error: "Aucun compte Super PDP connecté : connecte-le depuis Mon entreprise." }, 400);
    if (conn.verification_status && conn.verification_status !== "verified") return json({ error: `Entreprise pas encore vérifiée chez Super PDP (${conn.verification_status}).` }, 400);
    if (conn.env === "production" && !superpdpAllowProduction()) return json({ error: "Compte Super PDP en production : les envois réels ne sont pas encore autorisés dans Chantiflow." }, 403);
    const [documents, profile] = await Promise.all([readKv(organizationId, "documents"), readKv(organizationId, "company-profile")]);
    const doc = (Array.isArray(documents) ? documents : []).find((d: any) => d?.id === documentId);
    if (!doc) return json({ error: "Facture introuvable." }, 404);
    const eligibility = pdpEligibility(doc, { connected: true, env: conn.env, verificationStatus: conn.verification_status, companyCountryCode: countryCode(profile?.country), allowProduction: superpdpAllowProduction() });
    if (!eligibility.ok) return json({ error: eligibility.reason, code: eligibility.code }, 400);
    const sandbox = conn.env !== "production";
    const sandboxIds = sandbox ? { seller: sandboxIdentifierOf(conn.company_number)?.id || null, buyer: sandboxIdentifierOf(doc.client?.siret)?.id || null } : null;
    if (sandbox && !sandboxIds?.seller) return json({ error: `Bac à sable : l'entreprise connectée n'a pas d'identifiant de test reconnu (${conn.company_number || "vide"}).` }, 400);
    if (sandbox && !sandboxIds?.buyer && !sirenOfSiret(doc.client?.siret)) return json({ error: "Bac à sable : renseigne l'identifiant de test Super PDP du client (ex. 315143296_106842) dans le champ SIRET de sa fiche." }, 400);

    // 2. Verrou « envoi en cours » (une seule transmission à la fois, réémission après échec seulement).
    const { data: existing } = await dbAdmin.from("pdp_invoices").select("pdp_invoice_id, status_code").eq("organization_id", organizationId).eq("document_id", documentId).maybeSingle();
    if (existing && !pdpCanResend({ invoiceId: existing.pdp_invoice_id, status: existing.status_code })) {
      return json({ error: existing.status_code === "api:sending" ? "Envoi déjà en cours." : `Facture déjà transmise via Super PDP (${PDP_STATUS_LABELS[existing.status_code] || existing.status_code}).` }, 409);
    }
    const { error: markError } = await dbAdmin.from("pdp_invoices").upsert({ organization_id: organizationId, document_id: documentId, env: conn.env, status_code: "api:sending", status_text: "Envoi en cours", pdp_invoice_id: null, sent_at: null, last_error: null }, { onConflict: "organization_id,document_id" });
    if (markError) { console.error("Verrou d'envoi non posé :", markError.message); return json({ error: "Envoi impossible pour le moment (base de données à préparer : script Super PDP étape 2 ?)." }, 500); }
    marked = true;
    const warnings: string[] = [];

    // 3. Factur-X, par la fonction déjà déployée (mêmes règles que le téléchargement).
    const gen = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-facturx`, {
      method: "POST",
      headers: { Authorization: authHeader, apikey: Deno.env.get("SUPABASE_ANON_KEY") || "", "Content-Type": "application/json" },
      body: JSON.stringify({ document: doc, companyProfile: profile, siteName: "Chantiflow", sandboxIds }),
    });
    const genBody = await gen.json().catch(() => null);
    if (!gen.ok || !genBody?.pdfBase64) {
      const missing = Array.isArray(genBody?.missing) ? genBody.missing : [];
      throw new SendError(`${genBody?.error || "Impossible de produire le fichier Factur-X."}${missing.length ? ` À compléter : ${missing.join(" ; ")}` : ""}`, 400, { missing });
    }
    if (Array.isArray(genBody.warnings)) warnings.push(...genBody.warnings);
    const pdf = fromBase64(genBody.pdfBase64);
    const fileName = String(genBody.fileName || `${doc.docNumber || "facture"}-facturx.pdf`);

    // 4. Validation chez Super PDP avant tout envoi.
    const form = new FormData();
    form.append("file", new Blob([pdf], { type: "application/pdf" }), fileName);
    const validation = await superpdpFetch(dbAdmin, organizationId, "/v1.beta/validation_reports", { method: "POST", body: form });
    if (!validation.ok) throw new SendError(`Validation impossible. ${await apiErrorMessage(validation)}`, 502);
    const report = (await validation.json().catch(() => null))?.data?.[0];
    if (!report) throw new SendError("Rapport de validation illisible.", 502);
    if (report.is_valid !== true) {
      const failures: string[] = [];
      for (const sub of report.subreports || []) for (const f of sub.failures || []) failures.push(String(f?.message || f?.text || f?.description || JSON.stringify(f)).slice(0, 300));
      if (report.error) failures.push(String(report.error));
      throw new SendError(`Le fichier Factur-X est refusé par la validation Super PDP : ${failures.slice(0, 5).join(" ; ") || "erreur non détaillée"}.`, 400, { failures });
    }

    // 5. Le client peut-il recevoir ? (annuaire ; bloquant hors bac à sable)
    const receiver = sandbox ? sandboxIds!.buyer || sirenOfSiret(doc.client?.siret)! : sirenOfSiret(doc.client?.siret)!;
    const dir = await superpdpFetch(dbAdmin, organizationId, `/v1.beta/french_directory/entries?number=${encodeURIComponent(receiver)}`);
    const entries = dir.ok ? ((await dir.json().catch(() => null))?.data || []) : null;
    const canReceive = Array.isArray(entries) && entries.some((e: any) => e?.is_active !== false);
    if (!canReceive) {
      const message = `Le client (${receiver}) n'est pas dans l'annuaire de la facturation électronique${dir.ok ? "" : ` (${await apiErrorMessage(dir)})`}.`;
      if (!sandbox) throw new SendError(`${message} Il doit d'abord y être inscrit (par sa plateforme ou son SIE).`, 400);
      warnings.push(`${message} En bac à sable, l'envoi est tenté quand même.`);
    }

    // 6. Envoi.
    const sent = await superpdpFetch(dbAdmin, organizationId, `/v1.beta/invoices?external_id=${encodeURIComponent(String(doc.id).slice(0, 36))}&processing_rule=B2B`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: pdf });
    if (!sent.ok) throw new SendError(`Super PDP a refusé la facture. ${await apiErrorMessage(sent)}`, 502);
    const invoice = await sent.json();
    const invoiceId = Number(invoice?.id);
    if (!Number.isFinite(invoiceId)) throw new SendError("Réponse de Super PDP sans identifiant de facture.", 502);
    const lastEvent = Array.isArray(invoice?.events) && invoice.events.length ? invoice.events[invoice.events.length - 1] : null;
    const statusCode = String(lastEvent?.status_code || "api:uploaded");
    const statusText = PDP_STATUS_LABELS[statusCode] || String(lastEvent?.status_text || "Déposée chez Super PDP");
    const sentAt = new Date().toISOString();

    // 7. Enregistrement.
    await dbAdmin.from("pdp_invoices").update({ pdp_invoice_id: invoiceId, env: conn.env, processing_rule: String(invoice?.processing_rule || "B2B"), external_id: String(doc.id).slice(0, 36), status_code: statusCode, status_text: statusText, sent_at: sentAt, last_event_id: Number(lastEvent?.id) || 0, last_event_at: lastEvent ? sentAt : null, last_error: null }).eq("organization_id", organizationId).eq("document_id", documentId);
    const pdp: PdpField = { invoiceId, externalId: String(doc.id).slice(0, 36), env: conn.env, status: statusCode, statusText, sentAt, updatedAt: Date.now(), error: null };
    await writeDocPdp(organizationId, documentId, pdp);
    return json({ ok: true, pdp, warnings, fileName });
  } catch (err) {
    const e = err as SendError;
    const message = e?.message || "Une erreur inattendue est survenue.";
    console.error("Erreur superpdp-send-invoice", err);
    if (marked) {
      await dbAdmin.from("pdp_invoices").update({ status_code: "error", status_text: "Envoi en échec", last_error: message.slice(0, 1000) }).eq("organization_id", organizationId).eq("document_id", documentId).eq("status_code", "api:sending");
      await writeDocPdp(organizationId, documentId, { invoiceId: null, externalId: documentId.slice(0, 36), env: "", status: "error", statusText: "Envoi en échec", sentAt: null, updatedAt: Date.now(), error: message.slice(0, 500) });
    }
    return json({ error: message, ...(e?.extra || {}) }, e?.status && e.status >= 400 ? e.status : 500);
  }
});
