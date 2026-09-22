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
    return { item, baseHT, totalHTBrut, totalHT: totalHTBrut * (1 - rate), rate: num(item.tva) };
  });
  const subtotalHTBrut = lines.reduce((s: number, l) => s + l.totalHTBrut, 0);
  const subtotalHT = lines.reduce((s: number, l) => s + l.totalHT, 0);
  const tvaByRate: Record<string, number> = {};
  for (const l of lines) tvaByRate[String(l.rate)] = (tvaByRate[String(l.rate)] || 0) + (l.totalHT * l.rate) / 100;
  const totalTVA = Object.values(tvaByRate).reduce((a: number, b: number) => a + b, 0);
  const totalTTC = subtotalHT + totalTVA;
  const acompteVerse = doc?.type === "facture" ? Math.max(0, num(doc.acompteVerse)) : 0;
  return {
    subtotalHTBrut, globalDiscountPct: rate * 100, globalDiscountAmount: subtotalHTBrut - subtotalHT, subtotalHT,
    tvaByRate, totalTVA, totalTTC, acompteVerse, montantARegler: Math.max(0, totalTTC - acompteVerse), lines,
  };
}
export const round2 = (n: number) => Math.round(n * 100) / 100;

// Montant lisible pour un e-mail (texte brut) : « 1 234,56 € », « 1 234,56 DH ».
export function formatAmount(n: number, currency?: string): string {
  const amount = Number.isFinite(n) ? n : 0;
  const text = amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cur = String(currency || "EUR").toUpperCase();
  if (cur === "MAD") return `${text} DH`;
  if (cur === "EUR") return `${text} €`;
  return `${text} ${cur}`;
}
