// send-payment-reminders/index.ts
//
// Tâche quotidienne : cherche les factures dont l'échéance est
// dépassée et pas encore payées, envoie une relance par email au
// client — jamais plus d'une fois par semaine pour la même facture,
// pour ne jamais harceler personne.
//
// Déploiement : voir le Guide de déploiement. Protégée par le même
// secret partagé que les autres tâches automatiques.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { amountDueOf, formatAmount } from "../_shared/totals.ts";
import { parisTodayIso } from "../_shared/dates.ts";
import { updateKvValue } from "../_shared/kv.ts";

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("CONFIRMATION_FROM_EMAIL") || "noreply@chantiflow.fr";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };

function escapeHtml(s: string) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const providedSecret = req.headers.get("x-cron-secret") || "";
  const expectedSecret = Deno.env.get("CRON_SECRET") || "";
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Non autorisé" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    if (!RESEND_API_KEY) return new Response(JSON.stringify({ error: "Service d'envoi non configuré (RESEND_API_KEY)." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const todayStr = parisTodayIso(); // jour en heure de Paris, comme le tableau de bord
    let remindersSent = 0;
    let page = 0;
    const pageSize = 200;

    const { data: settingsRow } = await dbAdmin.from("site_settings").select("name").limit(1).maybeSingle();
    const siteName = settingsRow?.name || "Chantiflow";

    while (true) {
      const { data: rows, error } = await dbAdmin
        .from("kv_store")
        .select("organization_id, value")
        .eq("key", "documents")
        .eq("shared", false)
        .order("organization_id")
        .range(page * pageSize, page * pageSize + pageSize - 1);

      if (error) { console.error("Erreur de lecture", error); break; }
      if (!rows || rows.length === 0) break;

      for (const row of rows) {
        try { // une organisation en erreur n'empêche pas les suivantes
        const documents = Array.isArray(row.value) ? row.value : [];
        let changed = false;

        for (const doc of documents) {
          // Exactement la même règle que la liste des relances du tableau de
          // bord : factures « envoyée » ou « en retard » (statut posé à la
          // main) — jamais un brouillon (jamais transmis au client), ni une
          // facture déjà payée.
          if (doc.type !== "facture" || (doc.status !== "envoyée" && doc.status !== "en retard")) continue;
          if (doc.remindersEnabled === false) continue; // désactivé explicitement sur cette facture
          if (!doc.client?.email) continue;

          // Échéance : dueDays vide ou 0 = à réception, comme sur le site (avant : 30 jours par défaut).
          const dueDate = doc.issueDate ? new Date(new Date(doc.issueDate).getTime() + (Number(doc.dueDays) || 0) * 86400000) : null;
          if (!dueDate || Number.isNaN(dueDate.getTime()) || dueDate.toISOString().slice(0, 10) > todayStr) continue; // pas encore en retard, ou date invalide

          // Jamais plus d'une relance par semaine pour la même facture.
          if (doc.lastReminderSentAt && Date.now() - doc.lastReminderSentAt < 7 * 86400000) continue;

          // Montant restant à régler, même calcul que la facture (_shared/totals.ts) ;
          // plus rien à relancer si les paiements reçus couvrent le total.
          const due = amountDueOf(doc, documents); // acompte, paiements et avoirs rattachés déduits
          if (due <= 0.005) continue;
          const amount = formatAmount(due, doc.currency);
          let emailResp: Response;
          try {
          emailResp = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: `${siteName} <${FROM_EMAIL}>`,
              to: [doc.client.email],
              subject: `Rappel — Facture ${doc.docNumber} en attente de paiement`,
              html: `
                <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1B2A33;">
                  <p>Bonjour${doc.client.name ? " " + escapeHtml(doc.client.name) : ""},</p>
                  <p>Un petit rappel : la facture <strong>${escapeHtml(doc.docNumber)}</strong>, d'un montant de <strong>${escapeHtml(amount)}</strong>, est arrivée à échéance et reste en attente de paiement.</p>
                  <p>N'hésite pas à nous contacter si tu as la moindre question à ce sujet.</p>
                  <p>Merci !</p>
                </div>
              `,
            }),
          });
          } catch (err) { console.error(`Relance non envoyée pour ${doc.docNumber} (réseau)`, err); continue; } // les relances déjà parties restent enregistrées

          if (emailResp.ok) {
            doc.lastReminderSentAt = Date.now();
            changed = true;
            remindersSent++;
          } else {
            console.error(`Erreur d'envoi de relance pour ${doc.docNumber}`, await emailResp.text());
          }
        }

        if (changed) {
          // Seules les dates de relance sont reportées sur la version fraîche
          // de la liste : rien d'autre n'est écrasé.
          const sentAt = new Map(documents.filter((d: any) => d.lastReminderSentAt).map((d: any) => [d.id, d.lastReminderSentAt]));
          const result = await updateKvValue<any[]>(dbAdmin, row.organization_id, "documents", (list) => list.map((d: any) => (sentAt.has(d.id) ? { ...d, lastReminderSentAt: sentAt.get(d.id), updatedAt: Date.now() } : d)));
          if (!result.ok) console.error(`Dates de relance non enregistrées pour ${row.organization_id} : ${result.reason}`);
        }
        } catch (err) { console.error("Relances en échec pour", row.organization_id, err); }
      }

      if (rows.length < pageSize) break;
      page++;
    }

    return new Response(JSON.stringify({ success: true, remindersSent }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erreur inattendue", err);
    return new Response(JSON.stringify({ error: "Une erreur inattendue est survenue." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
