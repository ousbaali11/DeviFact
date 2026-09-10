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

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("CONFIRMATION_FROM_EMAIL") || "noreply@chantiflow.fr";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };

function computeTotalTTC(doc: any): number {
  const items = Array.isArray(doc.items) ? doc.items : [];
  let totalHT = 0;
  for (const it of items) {
    if (it.type !== "line") continue;
    const qty = Number(it.qty) || 0;
    const price = Number(it.unitPrice) || 0;
    const discount = Number(it.discount) || 0;
    totalHT += qty * price * (1 - discount / 100);
  }
  // Approximation volontairement simple (TVA moyenne à 20%) — cette
  // fonction sert juste à afficher un montant indicatif dans l'email,
  // le vrai montant exact reste celui du PDF/de la facture elle-même.
  return Math.round(totalHT * 1.2 * 100) / 100;
}

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
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
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
        .range(page * pageSize, page * pageSize + pageSize - 1);

      if (error) { console.error("Erreur de lecture", error); break; }
      if (!rows || rows.length === 0) break;

      for (const row of rows) {
        const documents = Array.isArray(row.value) ? row.value : [];
        let changed = false;

        for (const doc of documents) {
          if (doc.type !== "facture" || doc.status === "payée") continue;
          if (doc.remindersEnabled === false) continue; // désactivé explicitement sur cette facture
          if (!doc.client?.email) continue;

          const dueDate = doc.issueDate ? new Date(new Date(doc.issueDate).getTime() + (Number(doc.dueDays) || 30) * 86400000) : null;
          if (!dueDate || dueDate.toISOString().slice(0, 10) > todayStr) continue; // pas encore en retard

          // Jamais plus d'une relance par semaine pour la même facture.
          if (doc.lastReminderSentAt && Date.now() - doc.lastReminderSentAt < 7 * 86400000) continue;

          const amount = computeTotalTTC(doc);
          const emailResp = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: `${siteName} <${FROM_EMAIL}>`,
              to: [doc.client.email],
              subject: `Rappel — Facture ${doc.docNumber} en attente de paiement`,
              html: `
                <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1B2A33;">
                  <p>Bonjour${doc.client.name ? " " + escapeHtml(doc.client.name) : ""},</p>
                  <p>Un petit rappel : la facture <strong>${escapeHtml(doc.docNumber)}</strong>, d'un montant de <strong>${amount.toFixed(2)} €</strong>, est arrivée à échéance et reste en attente de paiement.</p>
                  <p>N'hésite pas à nous contacter si tu as la moindre question à ce sujet.</p>
                  <p>Merci !</p>
                </div>
              `,
            }),
          });

          if (emailResp.ok) {
            doc.lastReminderSentAt = Date.now();
            changed = true;
            remindersSent++;
          } else {
            console.error(`Erreur d'envoi de relance pour ${doc.docNumber}`, await emailResp.text());
          }
        }

        if (changed) {
          await dbAdmin.from("kv_store").update({ value: documents, updated_at: new Date().toISOString() }).eq("organization_id", row.organization_id).eq("key", "documents").eq("shared", false);
        }
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
