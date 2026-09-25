// _shared/totals.ts
//
// Totaux d'un document, côté serveur — MÊME règle que computeTotals() dans
// src/App.jsx (le test src/totals-shared.test.jsx compare les deux sur
// plusieurs documents) :
//   * base HT d'une ligne = quantité × prix unitaire + sous-détails inclus ;
//   * remise de ligne en % ;
//   * remise globale en % (défaut) ou en montant HT (globalDiscountMode =
//     "amount"), répartie au prorata des lignes ;
//   * TVA par taux sur le HT net ; TTC = HT net + TVA ;
//   * facture : acompte déjà versé (TTC) déduit → montant à régler.
// Toute fonction qui a besoin d'un montant (paiement en ligne, relances,
// Factur-X…) passe par ici plutôt que de recalculer à sa façon.

export type DocTotals = {
  subtotalHTBrut: number;
  globalDiscountPct: number;
  globalDiscountAmount: number;
  subtotalHT: number;
  tvaByRate: Record<string, number>;
  totalTVA: number;
  totalTTC: number;
  acompteVerse: number;
  paymentsReceived: number;
  totalPaid: number;
  montantARegler: number;
  lines: Array<{ item: any; baseHT: number; totalHTBrut: number; totalHT: number; rate: number }>;
};

const num = (v: unknown) => (Number(v) || 0);

export function detailsSum(details: unknown): number {
  return (Array.isArray(details) ? details : []).filter((d: any) => d && d.included).reduce((s: number, d: any) => s + num(d.price), 0);
}
export function lineBaseHT(l: any): number {
  return num(l?.qty) * num(l?.unitPrice) + detailsSum(l?.details);
}
export function lineNetHT(l: any): number {
  return lineBaseHT(l) * (1 - num(l?.discount) / 100);
}
export function paymentsTotalOf(doc: any): number {
  return (Array.isArray(doc?.payments) ? doc.payments : []).reduce((s: number, p: any) => s + Math.max(0, num(p?.amount)), 0);
}
// Paiement reçu en ligne (Stripe) ajouté à la liste des paiements de la
// facture ; idempotent (même session = même identifiant). Renvoie la
// facture mise à jour : « payée » si le total est couvert.
export function addOnlinePayment(doc: any, sessionId: string, amountCents: number, dateIso: string): any {
  const payments = Array.isArray(doc?.payments) ? doc.payments : [];
  const id = `pay_stripe_${sessionId}`;
  const amount = Math.round(Math.max(0, num(amountCents))) / 100;
  const next = payments.some((p: any) => p?.id === id) ? payments : [...payments, { id, date: dateIso.slice(0, 10), amount, method: "Carte bancaire (en ligne)", note: "" }];
  const updated = { ...doc, payments: next, updatedAt: Date.now() };
  if (amountDueOf(updated) <= 0.005) { updated.status = "payée"; updated.paidAt = dateIso; updated.paidTotal = settledTotalOf(updated); }
  return updated;
}
// Total « à régler » mémorisé au passage en « payée » (paidTotal) — même
// règle que documentSettledTotal côté site : facture/acompte = TTC,
// situation = net à payer + acompte déjà versé.
export function settledTotalOf(doc: any): number {
  if (doc?.type === "situation") { const s = computeSituationTotals(doc); return round2(s.netAPayer + s.acompteVerse); }
  return round2(computeDocTotals(doc).totalTTC);
}
export function globalDiscountRate(doc: any): number {
  const value = Math.max(0, num(doc?.globalDiscount));
  const items = Array.isArray(doc?.items) ? doc.items : [];
  if (doc?.globalDiscountMode === "amount") {
    const brut = items.filter((i: any) => i && i.type === "line").reduce((s: number, l: any) => s + lineNetHT(l), 0);
    return brut > 0 ? Math.min(1, value / brut) : 0;
  }
  return Math.min(100, value) / 100;
}
export function computeDocTotals(doc: any): DocTotals {
  const items = (Array.isArray(doc?.items) ? doc.items : []).filter((i: any) => i && i.type === "line");
  const rate = globalDiscountRate(doc);
  const lines: DocTotals["lines"] = items.map((item: any) => {
    const baseHT = lineBaseHT(item);
    const totalHTBrut = lineNetHT(item);
    // Règle d'arrondi unique, identique au site (computeTotals) : ligne HT au
    // centime, TVA par taux au centime sur la somme des lignes, TTC = HT + TVA.
    return { item, baseHT, totalHTBrut: round2(totalHTBrut), totalHT: round2(totalHTBrut * (1 - rate)), rate: num(item.tva) };
  });
  const subtotalHTBrut = round2(lines.reduce((s: number, l) => s + l.totalHTBrut, 0));
  const subtotalHT = round2(lines.reduce((s: number, l) => s + l.totalHT, 0));
  const tvaByRate: Record<string, number> = {};
  for (const l of lines) tvaByRate[String(l.rate)] = (tvaByRate[String(l.rate)] || 0) + l.totalHT;
  for (const k of Object.keys(tvaByRate)) tvaByRate[k] = round2((tvaByRate[k] * Number(k)) / 100);
  const totalTVA = round2(Object.values(tvaByRate).reduce((a: number, b: number) => a + b, 0));
  const totalTTC = round2(subtotalHT + totalTVA);
  // Facture ET facture d'acompte, comme sur le site (computeTotals) — sinon
  // le serveur (paiement en ligne, relances) ignorait l'acompte déjà versé et
  // les paiements reçus d'une facture d'acompte.
  const payable = doc?.type === "facture" || doc?.type === "acompte";
  const acompteVerse = payable ? Math.max(0, num(doc.acompteVerse)) : 0;
  // Paiements reçus (partiels ou solde), eux aussi déduits.
  const paymentsReceived = payable ? paymentsTotalOf(doc) : 0;
  const totalPaid = round2(acompteVerse + paymentsReceived);
  return {
    subtotalHTBrut, globalDiscountPct: rate * 100, globalDiscountAmount: round2(subtotalHTBrut - subtotalHT), subtotalHT,
    tvaByRate, totalTVA, totalTTC, acompteVerse, paymentsReceived, totalPaid, montantARegler: Math.max(0, round2(totalTTC - totalPaid)), lines,
  };
}
export const round2 = (n: number) => Math.round(n * 100) / 100;

// Situation de travaux — même règle que computeSituation() côté site :
// montant de cette situation = cumul atteint − déjà facturé, par ligne ;
// retenue de garantie et acompte versé déduits ; paiements reçus déduits
// du net à payer.
export function computeSituationTotals(doc: any) {
  const items = (Array.isArray(doc?.items) ? doc.items : []).filter((l: any) => l && l.type === "line");
  const lines: Array<{ rate: number; montantCetteSituation: number }> = items.map((l: any) => {
    const montantMarche = round2(num(l.qty) * num(l.unitPrice));
    const montantCumuleActuel = round2((montantMarche * num(l.avancementPct)) / 100);
    return { rate: num(l.tva), montantCetteSituation: round2(montantCumuleActuel - round2(num(l.montantCumulePrecedent))) };
  });
  const subtotalHT = round2(lines.reduce((s: number, l) => s + l.montantCetteSituation, 0));
  const tvaByRate: Record<string, number> = {};
  for (const l of lines) tvaByRate[String(l.rate)] = (tvaByRate[String(l.rate)] || 0) + l.montantCetteSituation;
  for (const k of Object.keys(tvaByRate)) tvaByRate[k] = round2((tvaByRate[k] * Number(k)) / 100);
  const totalTVA = round2(Object.values(tvaByRate).reduce((a: number, b: number) => a + b, 0));
  const totalTTCBrut = round2(subtotalHT + totalTVA);
  const retenueGarantie = round2(totalTTCBrut * (num(doc?.retenueGarantiePct) / 100));
  const acompteVerse = round2(num(doc?.acompteVerse));
  const netAPayer = round2(totalTTCBrut - retenueGarantie - acompteVerse);
  const paymentsReceived = round2(paymentsTotalOf(doc));
  return { subtotalHT, tvaByRate, totalTVA, totalTTCBrut, retenueGarantie, acompteVerse, netAPayer, paymentsReceived, totalPaid: round2(acompteVerse + paymentsReceived), montantARegler: Math.max(0, round2(netAPayer - paymentsReceived)) };
}
// Documents que le client règle : facture, facture d'acompte, situation
// valant facture — même règle que isPayableDoc() côté site.
export function isPayableDoc(doc: any): boolean {
  return !!doc && (doc.type === "facture" || doc.type === "acompte" || (doc.type === "situation" && doc.vautFacture === true));
}
// Avoirs rattachés à une facture (factureOrigineId), hors brouillons — même
// règle que creditNotesTotalFor côté site.
export function creditNotesTotalFor(doc: any, documents: any[] | null | undefined): number {
  if (!doc || !Array.isArray(documents)) return 0;
  return round2(documents.reduce((s: number, d: any) => (d && d.type === "avoir" && d.factureOrigineId === doc.id && d.status !== "brouillon" ? s + computeDocTotals(d).totalTTC : s), 0));
}
// Montant restant à régler d'un document à payer (0 si non concerné),
// avoirs rattachés déduits quand la liste des documents est fournie.
export function amountDueOf(doc: any, documents: any[] | null = null): number {
  if (!isPayableDoc(doc)) return 0;
  const due = doc.type === "situation" ? computeSituationTotals(doc).montantARegler : computeDocTotals(doc).montantARegler;
  return Math.max(0, round2(due - creditNotesTotalFor(doc, documents)));
}

// Montant lisible pour un e-mail (texte brut) : « 1 234,56 € », « 1 234,56 DH ».
export function formatAmount(n: number, currency?: string): string {
  const amount = Number.isFinite(n) ? n : 0;
  const text = amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cur = String(currency || "EUR").toUpperCase();
  if (cur === "MAD") return `${text} DH`;
  if (cur === "EUR") return `${text} €`;
  return `${text} ${cur}`;
}
