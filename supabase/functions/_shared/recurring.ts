// _shared/recurring.ts
//
// Copie mensuelle / trimestrielle / annuelle d'une facture récurrente :
// nouveau numéro, date du jour, brouillon non terminé. Tout ce qui
// appartient à la vie de la facture modèle est laissé derrière — paiements
// reçus, date de paiement, acompte versé, signature — sinon chaque copie
// naissait « déjà payée ». Même règle que la duplication côté site
// (duplicatedDocumentOf dans src/App.jsx).
export function recurringInvoiceCopy(doc: any, docNumber: string, today: string, id: string): any {
  const copy: any = {
    ...doc,
    id,
    docNumber,
    issueDate: today,
    status: "brouillon",
    workStage: "brouillon",
    isRecurring: false,
    nextRecurrenceDate: "",
    payments: [],
    acompteVerse: "",
    // Dates de prestation : propres à chaque période, jamais celles du modèle
    // (mention obligatoire — l'artisan les renseigne sur chaque facture).
    serviceDate: "", serviceDateEnd: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  delete copy.paidAt;
  delete copy.signature;
  delete copy.lastReminderSentAt;
  delete copy.paidTotal;
  return copy;
}

// Prochaine échéance : calcul sur les composantes de la date (jamais via
// l'heure UTC, qui perdait un jour au changement d'heure), borné au dernier
// jour du mois d'arrivée (31 janvier + 1 mois = 28 février, pas le 3 mars).
export function advanceRecurrenceDate(dateStr: string, interval: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!m) return String(dateStr || "");
  const months = interval === "annuel" ? 12 : interval === "trimestriel" ? 3 : 1;
  const y = Number(m[1]), mo = Number(m[2]) - 1 + months, day = Number(m[3]);
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const target = new Date(Date.UTC(y, mo, Math.min(day, lastDay)));
  return target.toISOString().slice(0, 10);
}
