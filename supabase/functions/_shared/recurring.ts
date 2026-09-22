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
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  delete copy.paidAt;
  delete copy.signature;
  delete copy.lastReminderSentAt;
  return copy;
}
