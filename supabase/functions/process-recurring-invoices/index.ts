// process-recurring-invoices/index.ts
//
// Tâche quotidienne : parcourt les factures marquées "récurrentes"
// dans chaque organisation, et crée automatiquement la prochaine
// occurrence dès que sa date est arrivée — jusqu'à la date de fin
// optionnelle, si renseignée.
//
// Les documents sont stockés comme un seul bloc JSON par organisation
// (table kv_store, clé "documents") — pas une vraie table par
// document — cette fonction lit donc ce bloc, le modifie, et le
// réécrit en entier pour chaque organisation concernée.
//
// Déploiement : voir le Guide de déploiement. Protégée par le même
// principe de secret partagé que cleanup-unconfirmed-accounts —
// jamais déclenchable publiquement depuis internet.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const dbAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };

const PREFIXES: Record<string, string> = {
  devis: "DEV", proforma: "PRO", revision: "REV", acompte: "ACO", avoir: "AVO",
  commande: "CMD", livraison: "BL", situation: "SIT", pv_reception: "PV",
  bpu: "BPU", rapport: "RI", contrat: "CTR", relance: "MED", planning: "PLN",
};

function nextNumber(documents: any[], type: string) {
  const prefix = PREFIXES[type] || "FAC";
  const nums = documents.filter((d) => d.type === type).map((d) => parseInt((String(d.docNumber).match(/(\d+)$/) || [])[1] || "0", 10));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

function advanceDate(dateStr: string, interval: string) {
  const d = new Date(dateStr);
  if (interval === "annuel") d.setFullYear(d.getFullYear() + 1);
  else if (interval === "trimestriel") d.setMonth(d.getMonth() + 3);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const providedSecret = req.headers.get("x-cron-secret") || "";
  const expectedSecret = Deno.env.get("CRON_SECRET") || "";
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Non autorisé" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    let organizationsUpdated = 0;
    let invoicesCreated = 0;
    let page = 0;
    const pageSize = 200;

    // Traite par lots — au cas où il y aurait beaucoup d'organisations,
    // pour ne jamais tout charger en une seule requête démesurée.
    while (true) {
      const { data: rows, error } = await dbAdmin
        .from("kv_store")
        .select("organization_id, value")
        .eq("key", "documents")
        .eq("shared", false)
        .range(page * pageSize, page * pageSize + pageSize - 1);

      if (error) {
        console.error("Erreur de lecture des documents", error);
        break;
      }
      if (!rows || rows.length === 0) break;

      for (const row of rows) {
        const documents = Array.isArray(row.value) ? row.value : [];
        let changed = false;
        const newInvoices: any[] = [];

        for (const doc of documents) {
          if (doc.type !== "facture" || !doc.isRecurring || !doc.nextRecurrenceDate) continue;
          if (doc.nextRecurrenceDate > today) continue;
          if (doc.recurrenceEndDate && doc.nextRecurrenceDate > doc.recurrenceEndDate) continue;

          const copy = {
            ...doc,
            id: `doc_${crypto.randomUUID()}`,
            docNumber: nextNumber([...documents, ...newInvoices], "facture"),
            issueDate: today,
            status: "brouillon",
            workStage: "brouillon",
            isRecurring: false,
            nextRecurrenceDate: "",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          newInvoices.push(copy);
          invoicesCreated++;

          doc.nextRecurrenceDate = advanceDate(doc.nextRecurrenceDate, doc.recurrenceInterval || "mensuel");
          if (doc.recurrenceEndDate && doc.nextRecurrenceDate > doc.recurrenceEndDate) {
            // Dépasse la date de fin — désactive proprement plutôt que
            // de laisser une date de "prochaine facture" fantôme.
            doc.isRecurring = false;
          }
          changed = true;
        }

        if (changed) {
          const merged = [...newInvoices, ...documents];
          const { error: updateError } = await dbAdmin
            .from("kv_store")
            .update({ value: merged, updated_at: new Date().toISOString() })
            .eq("organization_id", row.organization_id)
            .eq("key", "documents")
            .eq("shared", false);
          if (updateError) {
            console.error(`Erreur d'écriture pour l'organisation ${row.organization_id}`, updateError);
          } else {
            organizationsUpdated++;
          }
        }
      }

      if (rows.length < pageSize) break;
      page++;
    }

    return new Response(
      JSON.stringify({ success: true, organizationsUpdated, invoicesCreated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Erreur inattendue lors du traitement des factures récurrentes", err);
    return new Response(JSON.stringify({ error: "Une erreur inattendue est survenue." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
