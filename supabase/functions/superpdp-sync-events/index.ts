// superpdp-sync-events/index.ts
//
// Super PDP, étape 3 : suivi des factures transmises.
//   - Tâche planifiée quotidienne (en-tête x-cron-secret) : pour chaque compte
//     connecté (bac à sable tant que la production n'est pas autorisée),
//     lecture des événements depuis le dernier identifiant lu
//     (GET /invoice_events?starting_after_id, pagination has_after), mise à
//     jour de pdp_invoices et du champ « pdp » des documents (une seule
//     écriture conditionnelle par organisation), puis rattrapage des
//     encaissements (fr:212) restés à envoyer.
//   - Membre connecté : action "sync" (tout membre actif : lecture) pour une
//     organisation, ou action "paid" (propriétaire, éditeur) quand une facture
//     transmise passe « payée » : POST /invoice_events { fr:212 } — une seule
//     fois (pdp.paidEventAt), jamais pour un acompte ni un paiement partiel.
// Une organisation en erreur n'interrompt pas les autres.
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPERPDP_ENABLED } from "../_shared/pdp-flags.ts";
import { updateKvValue } from "../_shared/kv.ts";
import { superpdpConfigured, superpdpAllowProduction, readConnection, superpdpFetch, apiErrorMessage, type PdpConnection } from "../_shared/superpdp.ts";
import { applyPdpEvents, shouldSendPaidEvent, PDP_STATUS_LABELS, type PdpEvent } from "../_shared/superpdp-rules.ts";

const dbAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const PAGE = 1000;
const MAX_PAGES = 20;

type DocPatch = { documentId: string; pdp: Record<string, unknown> };

async function readDocuments(organizationId: string): Promise<any[]> {
  const { data, error } = await dbAdmin.from("kv_store").select("value").eq("organization_id", organizationId).eq("key", "documents").eq("shared", false).maybeSingle();
  if (error) throw new Error(`Lecture des documents impossible : ${error.message}`);
  return Array.isArray(data?.value) ? data.value : [];
}
// Champs « pdp » de plusieurs documents, en une seule écriture conditionnelle.
async function writeDocPatches(organizationId: string, patches: DocPatch[]) {
  if (!patches.length) return;
  const byId = new Map(patches.map((p) => [p.documentId, p.pdp]));
  const result = await updateKvValue<any[]>(dbAdmin, organizationId, "documents", (list) => (Array.isArray(list) ? list.map((d: any) => (d && byId.has(d.id) ? { ...d, pdp: { ...(d.pdp || {}), ...byId.get(d.id)! }, updatedAt: Date.now() } : d)) : list));
  if (!result.ok) console.error(`Champs pdp non enregistrés pour ${organizationId} : ${result.reason}`);
}
function connectionAllowed(conn: PdpConnection | null): conn is PdpConnection {
  return !!conn && (conn.env !== "production" || superpdpAllowProduction());
}

// Lecture des événements depuis le dernier identifiant lu ; renvoie les
// documents mis à jour (pour l'écran) et le nombre d'événements lus.
async function syncOrganization(organizationId: string, conn: PdpConnection): Promise<{ updated: DocPatch[]; eventsRead: number; paidSent: number }> {
  const events: PdpEvent[] = [];
  let after = Number(conn.last_event_id) || 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const resp = await superpdpFetch(dbAdmin, organizationId, `/v1.beta/invoice_events?starting_after_id=${after}&limit=${PAGE}`);
    if (!resp.ok) throw new Error(await apiErrorMessage(resp));
    const body = await resp.json();
    const data: PdpEvent[] = Array.isArray(body?.data) ? body.data : [];
    events.push(...data);
    if (!body?.has_after || !data.length) break;
    after = Math.max(after, ...data.map((e) => Number(e.id) || 0));
  }
  const { updates, lastEventId } = applyPdpEvents(events);
  const patches: DocPatch[] = [];
  if (updates.length) {
    const ids = updates.map((u) => u.invoiceId);
    const { data: rows, error } = await dbAdmin.from("pdp_invoices").select("document_id, pdp_invoice_id, status_code").eq("organization_id", organizationId).in("pdp_invoice_id", ids);
    if (error) throw new Error(`Lecture de pdp_invoices impossible : ${error.message}`);
    const rowByInvoice = new Map((rows || []).map((r: any) => [Number(r.pdp_invoice_id), r]));
    for (const u of updates) {
      const row = rowByInvoice.get(u.invoiceId);
      if (!row) continue; // facture inconnue de Chantiflow (envoyée par un autre outil) : ignorée
      await dbAdmin.from("pdp_invoices").update({ status_code: u.status, status_text: u.statusText, last_event_id: u.lastEventId, last_event_at: u.lastEventAt, last_error: null }).eq("organization_id", organizationId).eq("document_id", row.document_id);
      patches.push({ documentId: row.document_id, pdp: { status: u.status, statusText: u.statusText, lastEventAt: u.lastEventAt, updatedAt: Date.now() } });
    }
    await writeDocPatches(organizationId, patches);
  }
  if (lastEventId > (Number(conn.last_event_id) || 0)) {
    await dbAdmin.from("pdp_connections").update({ last_event_id: lastEventId, last_error: null }).eq("organization_id", organizationId);
  }
  // Rattrapage des encaissements : factures payées transmises sans fr:212.
  let paidSent = 0;
  const documents = await readDocuments(organizationId);
  for (const doc of documents) {
    if (!shouldSendPaidEvent(doc)) continue;
    const r = await sendPaidEvent(organizationId, doc);
    if (r.ok) { paidSent += 1; patches.push({ documentId: doc.id, pdp: r.pdp }); }
  }
  return { updated: patches, eventsRead: events.length, paidSent };
}

// Encaissement d'une facture transmise : événement fr:212 (montant total repris
// par Super PDP), noté sur le document ; en cas d'échec, l'erreur est notée et la
// tâche quotidienne réessaie.
async function sendPaidEvent(organizationId: string, doc: any): Promise<{ ok: boolean; pdp: Record<string, unknown>; error?: string }> {
  const invoiceId = Number(doc?.pdp?.invoiceId);
  const resp = await superpdpFetch(dbAdmin, organizationId, "/v1.beta/invoice_events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoice_id: invoiceId, status_code: "fr:212" }) });
  if (!resp.ok) {
    const message = await apiErrorMessage(resp);
    const pdp = { paidEventError: message.slice(0, 300), updatedAt: Date.now() };
    await writeDocPatches(organizationId, [{ documentId: doc.id, pdp }]);
    await dbAdmin.from("pdp_invoices").update({ last_error: `Encaissement non transmis : ${message}`.slice(0, 1000) }).eq("organization_id", organizationId).eq("document_id", doc.id);
    return { ok: false, pdp, error: message };
  }
  const paidEventAt = new Date().toISOString();
  const pdp = { paidEventAt, paidEventError: null, status: "fr:212", statusText: PDP_STATUS_LABELS["fr:212"], updatedAt: Date.now() };
  await writeDocPatches(organizationId, [{ documentId: doc.id, pdp }]);
  await dbAdmin.from("pdp_invoices").update({ paid_event_at: paidEventAt, status_code: "fr:212", status_text: PDP_STATUS_LABELS["fr:212"], last_error: null }).eq("organization_id", organizationId).eq("document_id", doc.id);
  return { ok: true, pdp };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  if (!SUPERPDP_ENABLED) return json({ error: "Le suivi Super PDP est désactivé." }, 503);
  if (!superpdpConfigured()) return json({ error: "Connexion Super PDP pas encore configurée (secrets SUPERPDP_* absents)." }, 503);

  try {
    // ---- Tâche planifiée : toutes les organisations connectées.
    const providedSecret = req.headers.get("x-cron-secret") || "";
    const expectedSecret = Deno.env.get("CRON_SECRET") || "";
    if (providedSecret && expectedSecret && providedSecret === expectedSecret) {
      let checked = 0, failed = 0, eventsRead = 0, paidSent = 0;
      const { data: conns, error } = await dbAdmin.from("pdp_connections").select("*");
      if (error) return json({ error: `Connexions illisibles : ${error.message}` }, 500);
      for (const conn of (conns || []) as PdpConnection[]) {
        if (!connectionAllowed(conn)) continue;
        checked += 1;
        try {
          const r = await syncOrganization(conn.organization_id, conn);
          eventsRead += r.eventsRead; paidSent += r.paidSent;
        } catch (err) {
          failed += 1;
          console.error("Suivi Super PDP en échec pour", conn.organization_id, err);
          await dbAdmin.from("pdp_connections").update({ last_error: String((err as Error)?.message || err).slice(0, 500) }).eq("organization_id", conn.organization_id);
        }
      }
      return json({ success: true, checked, failed, eventsRead, paidSent });
    }

    // ---- Membre connecté.
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return json({ error: "Non connecté" }, 401);
    const body = await req.json().catch(() => ({}));
    const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
    const action = String(body?.action || "sync");
    if (!organizationId) return json({ error: "Organisation manquante." }, 400);
    const { data: membership } = await dbAdmin.from("organization_members").select("role").eq("user_id", user.id).eq("organization_id", organizationId).eq("status", "active").maybeSingle();
    if (!membership) return json({ error: "Accès refusé." }, 403);
    const conn = await readConnection(dbAdmin, organizationId);
    if (!conn) return json({ error: "Aucun compte Super PDP connecté." }, 400);
    if (!connectionAllowed(conn)) return json({ error: "Compte Super PDP en production : le suivi n'est pas encore autorisé dans Chantiflow." }, 403);

    if (action === "sync") {
      const r = await syncOrganization(organizationId, conn);
      return json({ ok: true, ...r });
    }
    if (action === "paid") {
      if (!["owner", "editor"].includes(membership.role)) return json({ error: "Seuls le propriétaire et les éditeurs peuvent signaler un encaissement." }, 403);
      const documentId = typeof body?.documentId === "string" ? body.documentId : "";
      const doc = (await readDocuments(organizationId)).find((d: any) => d?.id === documentId);
      if (!doc) return json({ error: "Facture introuvable." }, 404);
      if (!shouldSendPaidEvent(doc)) return json({ ok: true, skipped: true, reason: doc?.pdp?.paidEventAt ? "Encaissement déjà transmis." : "Facture non transmise via Super PDP, ou pas encore payée en totalité." });
      const r = await sendPaidEvent(organizationId, doc);
      return r.ok ? json({ ok: true, pdp: r.pdp }) : json({ error: `Encaissement non transmis (la tâche quotidienne réessaiera). ${r.error}`, pdp: r.pdp }, 502);
    }
    return json({ error: "Action inconnue" }, 400);
  } catch (err) {
    console.error("Erreur superpdp-sync-events", err);
    return json({ error: (err as Error)?.message || "Une erreur inattendue est survenue." }, 500);
  }
});
