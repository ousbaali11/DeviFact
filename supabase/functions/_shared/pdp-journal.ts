// _shared/pdp-journal.ts
//
// Journal des envois Super PDP (étape 4, 30/09/2026) : une ligne par
// événement dans la table pdp_journal (script 2026-09-30_super-pdp-etape4.sql),
// écrite avec la clé de service. N'échoue jamais : un journal indisponible
// (table absente, base injoignable) est signalé dans les logs sans bloquer
// l'envoi ni la relecture.

export type JournalSource = "envoi" | "relecture" | "encaissement" | "erreur";
export type JournalEntry = {
  organizationId: string;
  documentId: string;
  docNumber?: string | null;
  pdpInvoiceId?: number | null;
  source: JournalSource;
  statusCode?: string | null;
  statusText?: string | null;
  detail?: string | null;
  actor?: string | null; // membre à l'origine ; null = tâche planifiée
};

// deno-lint-ignore no-explicit-any
export async function journal(dbAdmin: any, entry: JournalEntry): Promise<void> {
  try {
    const { error } = await dbAdmin.from("pdp_journal").insert({
      organization_id: entry.organizationId,
      document_id: entry.documentId,
      doc_number: String(entry.docNumber || "").slice(0, 60),
      pdp_invoice_id: Number.isFinite(Number(entry.pdpInvoiceId)) && entry.pdpInvoiceId != null ? Number(entry.pdpInvoiceId) : null,
      source: entry.source,
      status_code: String(entry.statusCode || "").slice(0, 40),
      status_text: String(entry.statusText || "").slice(0, 200),
      detail: String(entry.detail || "").slice(0, 2000),
      actor: entry.actor || null,
    });
    if (error) console.error("Journal Super PDP non écrit :", error.message);
  } catch (err) {
    console.error("Journal Super PDP non écrit :", (err as Error)?.message || err);
  }
}
