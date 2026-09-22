// _shared/online-payments.ts
//
// Rapprochement des paiements en ligne (Stripe Connect) SANS dépendre du
// webhook : on demande directement à Stripe les sessions de paiement
// terminées du compte connecté de l'artisan et on enregistre celles qui
// manquent sur les factures — même règle et même identifiant que le webhook
// (pay_stripe_<session>), donc jamais de doublon quand les deux passent.
// Utilisé par get-public-document (retour du client après paiement) et par
// sync-online-payments (ouverture de l'application ou d'une facture).

import { addOnlinePayment } from "./totals.ts";
import { updateKvValue } from "./kv.ts";

export type SyncResult = {
  checked: number;          // sessions payées trouvées chez Stripe
  added: number;            // paiements qui manquaient et ont été enregistrés
  documentIds: string[];    // documents mis à jour
  documents: any[] | null;  // liste des documents après écriture (si écriture)
  error?: string;
};

// Session Stripe correspondant au paiement d'une facture de CETTE
// organisation, effectivement payée (jamais une session abandonnée ni un
// paiement d'abonnement, ni celle d'une autre organisation).
export function isPaidInvoiceSession(session: any, organizationId: string, documentId?: string | null): boolean {
  if (!session || session.payment_status !== "paid") return false;
  const meta = session.metadata || {};
  if (meta.kind !== "invoice_payment" || meta.organizationId !== organizationId) return false;
  return !documentId || meta.documentId === documentId;
}

const paymentsCount = (doc: any) => (Array.isArray(doc?.payments) ? doc.payments.length : 0);

export async function syncOnlinePayments(
  dbAdmin: any,
  stripe: any,
  organizationId: string,
  stripeAccountId: string,
  opts: { documentId?: string | null; sinceDays?: number } = {},
): Promise<SyncResult> {
  const since = Math.floor(Date.now() / 1000) - (opts.sinceDays ?? 60) * 86400;
  // Sessions terminées du compte connecté (les plus récentes d'abord).
  const page = await stripe.checkout.sessions.list(
    { limit: 100, status: "complete", created: { gte: since } },
    { stripeAccount: stripeAccountId },
  );
  const sessions = (page?.data || []).filter((s: any) => isPaidInvoiceSession(s, organizationId, opts.documentId));
  if (sessions.length === 0) return { checked: 0, added: 0, documentIds: [], documents: null };

  let added = 0;
  const documentIds = new Set<string>();
  const settledLinks = new Set<string>();
  const result = await updateKvValue<any[]>(dbAdmin, organizationId, "documents", (docs) => {
    // Rejoué sur la version fraîche en cas d'écriture concurrente.
    added = 0; documentIds.clear(); settledLinks.clear();
    for (const s of sessions) {
      const idx = docs.findIndex((d: any) => d?.id === s.metadata.documentId);
      if (idx === -1) continue;
      const before = paymentsCount(docs[idx]);
      // Date du paiement = date de la session Stripe, pas celle du rapprochement.
      const paidAt = new Date((Number(s.created) || Date.now() / 1000) * 1000).toISOString();
      const next = addOnlinePayment(docs[idx], s.id, Number(s.amount_total) || 0, paidAt);
      if (paymentsCount(next) > before) {
        docs[idx] = next;
        added++;
        documentIds.add(next.id);
        if (next.status === "payée" && s.metadata.linkId) settledLinks.add(s.metadata.linkId);
      }
    }
    return added > 0 ? docs : null;
  });
  if (!result.ok) {
    if (result.reason === "unchanged") return { checked: sessions.length, added: 0, documentIds: [], documents: null };
    return { checked: sessions.length, added: 0, documentIds: [], documents: null, error: result.reason };
  }

  // Liens publics : verrou de paiement levé (un règlement suivant redevient
  // possible tout de suite) ; lien clôturé quand la facture est soldée.
  const now = new Date().toISOString();
  const seenLinks = new Set<string>();
  for (const s of sessions) {
    const linkId = s.metadata?.linkId;
    if (!linkId || seenLinks.has(linkId)) continue;
    seenLinks.add(linkId);
    await dbAdmin.from("public_document_links").update({ payment_pending_at: null }).eq("id", linkId);
    if (settledLinks.has(linkId)) await dbAdmin.from("public_document_links").update({ paid_at: now }).eq("id", linkId).is("paid_at", null);
  }
  return { checked: sessions.length, added, documentIds: [...documentIds], documents: result.value };
}
