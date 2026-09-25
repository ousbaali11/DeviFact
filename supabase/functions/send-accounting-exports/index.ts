// send-accounting-exports/index.ts
//
// Export comptable programmé : chaque mois ou chaque trimestre, le fichier
// Excel de l'export comptable (même contenu que l'export manuel de la page
// Comptabilité : feuille « Export comptable », plus « Écritures » pour les
// forfaits Pro et Entreprise) est envoyé par e-mail à l'expert-comptable de
// l'organisation, avec copie à l'artisan.
//
// Deux façons d'appeler :
//   * tâche quotidienne (en-tête x-cron-secret, comme send-payment-reminders) :
//     pour chaque organisation dont le réglage est activé (Mon entreprise →
//     accountingExport dans la fiche entreprise), envoi à partir du 3 du mois
//     de la période précédente, une seule fois par période (état dans la clé
//     kv_store « accounting-export-state », écrite par le serveur seulement) ;
//   * « Envoyer maintenant » depuis Mon entreprise (membre connecté, corps
//     { organizationId }) : envoi immédiat de la période précédente.
// Réglage lu dans la fiche entreprise : { enabled, frequency, email }.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { buildExportSheets, previousPeriod, exportDueToday, type ExportFrequency, type ExportState } from "../_shared/accounting.ts";

const dbAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("CONFIRMATION_FROM_EMAIL") || "noreply@chantiflow.fr";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const STATE_KEY = "accounting-export-state";
const SEND_DAY = 3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(s: string) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function frequencyOf(v: unknown): ExportFrequency {
  return v === "trimestriel" ? "trimestriel" : "mensuel";
}
// Lecture d'une clé ; une erreur est remontée (jamais « aucune donnée » :
// un export vide serait envoyé à l'expert-comptable et la période marquée).
async function readKv(organizationId: string, key: string) {
  const { data, error } = await dbAdmin.from("kv_store").select("value").eq("organization_id", organizationId).eq("key", key).eq("shared", false).maybeSingle();
  if (error) throw new Error(`Lecture de « ${key} » impossible : ${error.message}`);
  return data?.value ?? null;
}
async function writeState(organizationId: string, state: Record<string, unknown>) {
  const previous = (await readKv(organizationId, STATE_KEY)) || {};
  const { error } = await dbAdmin.from("kv_store").upsert(
    { organization_id: organizationId, key: STATE_KEY, shared: false, value: { ...previous, ...state }, updated_at: new Date().toISOString() },
    { onConflict: "organization_id,key,shared" },
  );
  if (error) console.error("État de l'export comptable non enregistré :", error.message, organizationId);
}

// Construit et envoie l'export d'une période. Renvoie { ok, error? } — une
// lecture en échec n'envoie rien (et ne marque pas la période).
async function sendExport(organizationId: string, profile: any, period: ReturnType<typeof previousPeriod>, siteName: string, trigger: "auto" | "manuel", state: ExportState | null = null): Promise<{ ok: boolean; empty?: boolean; error?: string; documentCount?: number; to?: string; cc?: string[]; label?: string; exportedNext?: Record<string, unknown> }> {
  try {
    return await sendExportUnsafe(organizationId, profile, period, siteName, trigger, state);
  } catch (err) {
    console.error("Export comptable non construit :", organizationId, err);
    return { ok: false, error: `Export non envoyé : ${(err as Error)?.message || "lecture des données impossible"}.` };
  }
}
async function sendExportUnsafe(organizationId: string, profile: any, period: ReturnType<typeof previousPeriod>, siteName: string, trigger: "auto" | "manuel", state: ExportState | null) {
  const cfg = profile?.accountingExport || {};
  const to = String(cfg.email || "").trim();
  if (!EMAIL_RE.test(to)) return { ok: false, error: "Adresse de l'expert-comptable manquante ou invalide." };

  const [documents, org] = await Promise.all([
    readKv(organizationId, "documents"),
    dbAdmin.from("organizations").select("name, plan, payment_status").eq("id", organizationId).maybeSingle().then((r) => { if (r.error) throw new Error(`Lecture de l'organisation impossible : ${r.error.message}`); return r.data; }),
  ]);
  // Écritures : forfaits Pro et Entreprise, paiement actif (même règle que hasAccess côté site).
  const includeEntries = ["pro", "entreprise"].includes(org?.plan || "") && org?.payment_status === "payé";
  let products: any[] = [], movements: any[] = [], clients: any[] = [];
  if (includeEntries) {
    const [p, m, c] = await Promise.all([
      dbAdmin.from("products").select("*").eq("organization_id", organizationId),
      dbAdmin.from("stock_movements").select("*").eq("organization_id", organizationId).gte("moved_at", period.from).lte("moved_at", `${period.to}T23:59:59.999Z`),
      readKv(organizationId, "clients"), // rôle des fiches (sous-traitant → compte 604)
    ]);
    if (p.error) throw new Error(`Lecture des produits impossible : ${p.error.message}`);
    if (m.error) throw new Error(`Lecture des mouvements de stock impossible : ${m.error.message}`);
    products = p.data || []; movements = m.data || []; clients = Array.isArray(c) ? c : [];
  }
  const sheets = buildExportSheets(Array.isArray(documents) ? documents : [], period, { includeEntries, products, movements, defaults: profile?.accounting, clients }, state);
  // Rien de nouveau (période déjà envoyée, aucun complément) : pas d'e-mail.
  if (sheets.documentCount === 0) return { ok: false, empty: true, error: `Rien de nouveau à envoyer pour ${period.label} : tout a déjà été transmis.`, exportedNext: sheets.exportedNext };
  period = { ...period, label: sheets.label };

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheets.rows);
  ws["!cols"] = [{ wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 24 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, "Export comptable");
  if (sheets.entryRows) {
    const ws2 = XLSX.utils.aoa_to_sheet(sheets.entryRows);
    ws2["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 16 }, { wch: 36 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws2, "Écritures");
  }
  const content = XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
  const filename = `export-comptable-${period.id}.xlsx`;

  const companyName = String(profile?.name || org?.name || "").trim();
  const artisanEmail = String(profile?.email || "").trim();
  const cc = EMAIL_RE.test(artisanEmail) && artisanEmail.toLowerCase() !== to.toLowerCase() ? [artisanEmail] : [];
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${siteName} <${FROM_EMAIL}>`,
      to: [to],
      ...(cc.length ? { cc } : {}),
      subject: `Export comptable ${period.label}${companyName ? ` — ${companyName}` : ""}`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1B2A33;">
          <p>Bonjour,</p>
          <p>Veuillez trouver ci-joint l'export comptable de <strong>${escapeHtml(companyName || "l'entreprise")}</strong> pour la période <strong>${escapeHtml(period.label)}</strong> (du ${escapeHtml(period.from.split("-").reverse().join("/"))} au ${escapeHtml(period.to.split("-").reverse().join("/"))}) : ${sheets.documentCount} document${sheets.documentCount > 1 ? "s" : ""}${sheets.entryRows ? `, ${sheets.entryRows.length - 1} ligne${sheets.entryRows.length - 1 > 1 ? "s" : ""} d'écritures` : ""}.</p>
          <p>Le fichier Excel contient la feuille « Export comptable » (un document par ligne : type, numéro, date, client, statut, HT, TVA, TTC)${sheets.entryRows ? " et la feuille « Écritures » (ventes et entrées de stock)" : ""}.</p>
          <p style="font-size: 12px; color: #4A5B63;">Envoi ${trigger === "auto" ? "automatique programmé" : "déclenché"} depuis ${escapeHtml(siteName)} par ${escapeHtml(companyName || "l'artisan")}.</p>
        </div>
      `,
      attachments: [{ filename, content }],
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    console.error("Erreur d'envoi de l'export comptable :", resp.status, detail, organizationId);
    return { ok: false, error: `Le service d'envoi a refusé l'e-mail (${resp.status}).` };
  }
  return { ok: true, documentCount: sheets.documentCount, to, cc, label: period.label, exportedNext: sheets.exportedNext };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    if (!RESEND_API_KEY) return json({ error: "Service d'envoi non configuré (RESEND_API_KEY)." }, 500);
    const { data: settingsRow } = await dbAdmin.from("site_settings").select("name").limit(1).maybeSingle();
    const siteName = settingsRow?.name || "Chantiflow";
    const now = new Date();

    // ---- Tâche planifiée : toutes les organisations dont l'export est activé.
    const providedSecret = req.headers.get("x-cron-secret") || "";
    const expectedSecret = Deno.env.get("CRON_SECRET") || "";
    if (providedSecret && expectedSecret && providedSecret === expectedSecret) {
      let sent = 0, failed = 0, checked = 0, page = 0;
      const pageSize = 200;
      while (true) {
        const { data: rows, error } = await dbAdmin.from("kv_store").select("organization_id, value").eq("key", "company-profile").eq("shared", false).order("organization_id").range(page * pageSize, page * pageSize + pageSize - 1);
        if (error) { console.error("Erreur de lecture des fiches entreprise", error); break; }
        if (!rows || rows.length === 0) break;
        for (const row of rows) {
          try { // une organisation en erreur n'interrompt pas les autres
          const cfg = row.value?.accountingExport;
          if (!cfg?.enabled) continue;
          checked += 1;
          const frequency = frequencyOf(cfg.frequency);
          const state = (await readKv(row.organization_id, STATE_KEY)) || {};
          if (!exportDueToday(now, frequency, state.lastSentPeriod, SEND_DAY)) continue;
          const period = previousPeriod(now, frequency);
          const result = await sendExport(row.organization_id, row.value, period, siteName, "auto", state);
          if (result.ok) {
            sent += 1;
            await writeState(row.organization_id, { lastSentPeriod: period.id, lastSentAt: now.toISOString(), lastSentTo: result.to, lastError: null, sentThrough: period.to, exported: result.exportedNext });
          } else if (result.empty) {
            // Tout était déjà parti (changement de fréquence, par exemple) : période close, sans e-mail.
            await writeState(row.organization_id, { lastSentPeriod: period.id, lastError: null, sentThrough: period.to, exported: result.exportedNext });
          } else {
            failed += 1;
            await writeState(row.organization_id, { lastError: result.error, lastErrorAt: now.toISOString() });
          }
          } catch (err) { failed += 1; console.error("Export comptable en échec pour", row.organization_id, err); }
        }
        if (rows.length < pageSize) break;
        page += 1;
      }
      return json({ success: true, checked, sent, failed });
    }

    // ---- « Envoyer maintenant » : membre connecté (propriétaire ou éditeur).
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return json({ error: "Non connecté" }, 401);
    const body = await req.json().catch(() => ({}));
    const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
    if (!organizationId) return json({ error: "Organisation manquante." }, 400);
    const { data: membership } = await dbAdmin.from("organization_members").select("role").eq("user_id", user.id).eq("organization_id", organizationId).eq("status", "active").maybeSingle();
    if (!membership || !["owner", "editor"].includes(membership.role)) return json({ error: "Accès refusé." }, 403);

    // Envoi manuel borné : 10 minutes entre deux envois, cinq par jour (l'état
    // n'est modifiable que par le serveur, voir le trigger kv_store_protect_writes).
    const state = (await readKv(organizationId, STATE_KEY)) || {};
    const nowMs = now.getTime();
    const recentManual = (Array.isArray(state.manualSends) ? state.manualSends : []).map(Number).filter((t: number) => Number.isFinite(t) && nowMs - t < 86400000);
    if (recentManual.some((t: number) => nowMs - t < 10 * 60 * 1000)) return json({ error: "Un export vient d'être envoyé : attends 10 minutes avant d'en renvoyer un." }, 429);
    if (recentManual.length >= 5) return json({ error: "Cinq exports ont déjà été envoyés manuellement aujourd'hui : réessaie demain." }, 429);
    const profile = await readKv(organizationId, "company-profile");
    const cfg = profile?.accountingExport || {};
    const frequency = frequencyOf(cfg.frequency);
    const period = previousPeriod(now, frequency);
    const result = await sendExport(organizationId, profile, period, siteName, "manuel", state);
    if (!result.ok) {
      if (!result.empty) await writeState(organizationId, { lastError: result.error, lastErrorAt: now.toISOString() });
      return json({ error: result.error }, 400);
    }
    await writeState(organizationId, { lastSentPeriod: period.id, lastSentAt: now.toISOString(), lastSentTo: result.to, lastError: null, manualSends: [...recentManual, nowMs], sentThrough: period.to, exported: result.exportedNext });
    return json({ sent: true, period: period.id, label: result.label || period.label, to: result.to, documentCount: result.documentCount });
  } catch (err) {
    console.error("Erreur send-accounting-exports", err);
    return json({ error: "Une erreur inattendue est survenue." }, 500);
  }
});
