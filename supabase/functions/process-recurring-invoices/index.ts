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
import { recurringInvoiceCopy, advanceRecurrenceDate } from "../_shared/recurring.ts";
import { updateKvValue } from "../_shared/kv.ts";

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

const advanceDate = advanceRecurrenceDate;

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
        .order("organization_id")
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
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(doc.nextRecurrenceDate))) continue; // date invalide : ignorée plutôt que de faire échouer la tâche
          if (doc.nextRecurrenceDate > today) continue;
          if (doc.recurrenceEndDate && doc.nextRecurrenceDate > doc.recurrenceEndDate) continue;

          // Copie sans paiements ni date de paiement (voir _shared/recurring.ts).
          const copy = recurringInvoiceCopy(doc, nextNumber([...documents, ...newInvoices], "facture"), today, `doc_${crypto.randomUUID()}`);
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
          // Rejoué sur la version fraîche : les nouvelles factures sont
          // ajoutées et les prochaines échéances reportées sur les modèles,
          // sans écraser ce qu'un membre a pu enregistrer entre-temps.
          const nextDates = new Map(documents.filter((d: any) => d.type === "facture" && d.isRecurring !== undefined).map((d: any) => [d.id, { nextRecurrenceDate: d.nextRecurrenceDate, isRecurring: d.isRecurring, updatedAt: Date.now() }]));
          // updatedAt daté : sans cela, une modification locale plus ancienne
          // du même modèle, fusionnée ensuite, l'emportait sur la nouvelle
          // échéance et la facture était recréée le lendemain.
          const result = await updateKvValue<any[]>(dbAdmin, row.organization_id, "documents", (list) => {
            const existingIds = new Set(list.map((d: any) => d.id));
            const fresh = list.map((d: any) => (nextDates.has(d.id) ? { ...d, ...nextDates.get(d.id) } : d));
            return [...newInvoices.filter((inv) => !existingIds.has(inv.id)), ...fresh];
          });
          if (!result.ok) {
            console.error(`Erreur d'écriture pour l'organisation ${row.organization_id}`, result.reason);
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
