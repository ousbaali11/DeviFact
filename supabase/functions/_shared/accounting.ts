// _shared/accounting.ts
//
// Export comptable côté serveur — MÊME règle que l'export manuel de la page
// Comptabilité (accountingExportRow / accountingLinesOf dans src/App.jsx) et
// que src/accounting.js (écritures de vente et d'entrée de stock). Le test
// src/accounting-shared.test.js compare les deux sur plusieurs documents.
// Utilisé par send-accounting-exports (envoi programmé à l'expert-comptable).

import { computeDocTotals, computeSituationTotals } from "./totals.ts";

const num = (v: unknown) => (Number(v) || 0);
const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const nonEmpty = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
const fixed2 = (n: number) => Number(n.toFixed(2));

export const DEFAULT_ACCOUNTS = {
  sales: "706000",
  purchases: "607000",
  vatSales: "445710",
  vatPurchases: "445660",
  customer: "411000",
  supplier: "401000",
  journalSales: "VE",
  journalPurchases: "AC",
};
export function accountingDefaults(custom: any) {
  const out: Record<string, string> = { ...DEFAULT_ACCOUNTS };
  Object.keys(DEFAULT_ACCOUNTS).forEach((k) => { if (nonEmpty(custom?.[k])) out[k] = custom[k].trim(); });
  return out;
}
export function isSalesDocument(doc: any): boolean {
  if (!doc || doc.status === "brouillon") return false;
  return ["facture", "acompte", "avoir"].includes(doc.type) || (doc.type === "situation" && doc.vautFacture === true);
}
export function docTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    devis: "Devis", proforma: "Proforma", revision: "Revision-prix", avoir: "Avoir", acompte: "Facture d'acompte",
    commande: "Bon de commande", livraison: "Bon de livraison", situation: "Situation de travaux", pv_reception: "PV de réception",
    bpu: "Bordereau de prix unitaires", rapport: "Rapport d'intervention", contrat: "Contrat de chantier", relance: "Mise en demeure", planning: "Planning de chantier",
  };
  return labels[type] || "Facture";
}
// Même format que fr() côté site : « 22 sept. 2026 ».
export function frDate(d: unknown): string {
  return new Date(d as string).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

// ------------------------------------------------ révision de prix (port)
function getSectorMontantInitial(line: any): number {
  if (line?.useDecomptes && Array.isArray(line.decomptes)) return line.decomptes.reduce((s: number, d: any) => s + num(d.montantTotal), 0);
  return num(line?.montantInitialHT);
}
function computeCoefficientOnly(sector: any, valeurs: any) {
  const terms = Array.isArray(sector?.terms) ? sector.terms : [];
  if (!terms.length) return { valid: false, coefficient: 0 };
  const a = num(sector.coeffFixe);
  let variable = 0;
  for (const t of terms) {
    const base = Number(t.indexBase), val = Number(valeurs?.[t.id]);
    if (!base || !val) return { valid: false, coefficient: 0 };
    variable += num(t.poids) * (val / base);
  }
  return { valid: true, coefficient: a + variable };
}
function computeRevisionAmount(sector: any, montantHT: unknown, valeurs: any) {
  const c0 = num(montantHT);
  const terms = Array.isArray(sector?.terms) ? sector.terms : [];
  if (!c0 || !terms.length) return { valid: false, montantRevise: 0, ecartMontant: 0, coefficient: 0 };
  const a = num(sector.coeffFixe);
  let variable = 0;
  for (const t of terms) {
    const base = Number(t.indexBase);
    const val = Number(valeurs?.[t.id]);
    if (!base || !val) return { valid: false, montantRevise: 0, ecartMontant: 0, coefficient: 0 };
    variable += num(t.poids) * (val / base);
  }
  const coefficient = a + variable;
  const montantRevise = c0 * coefficient;
  return { valid: true, montantRevise, ecartMontant: montantRevise - c0, coefficient };
}
function computeDecompteRevision(sector: any, decompte: any) {
  const montantTotal = num(decompte?.montantTotal);
  const moisList = Array.isArray(decompte?.mois) ? decompte.mois : [];
  if (!montantTotal || !moisList.length) return { valid: false, montantRevise: 0, ecartMontant: 0 };
  const totalJours = moisList.reduce((s: number, m: any) => s + num(m.jours), 0);
  if (!totalJours) return { valid: false, montantRevise: 0, ecartMontant: 0 };
  let ecartTotal = 0;
  let allValid = true;
  for (const m of moisList) {
    const c = computeCoefficientOnly(sector, m.valeurs);
    if (!c.valid) { allValid = false; continue; }
    ecartTotal += montantTotal * (c.coefficient - 1) * (num(m.jours) / totalJours);
  }
  if (!allValid) return { valid: false, montantRevise: 0, ecartMontant: 0 };
  return { valid: true, montantRevise: montantTotal + ecartTotal, ecartMontant: ecartTotal };
}
function computeRevisionLine(line: any) {
  if (line?.useDecomptes && Array.isArray(line.decomptes) && line.decomptes.length) {
    const results = line.decomptes.map((d: any) => computeDecompteRevision(line, d));
    const validResults = results.filter((r: any) => r.valid);
    if (!validResults.length) return { valid: false, montantRevise: 0, ecartMontant: 0 };
    const montantInitial = getSectorMontantInitial(line);
    const montantRevise = validResults.reduce((s: number, r: any) => s + r.montantRevise, 0);
    return { valid: true, montantRevise, ecartMontant: montantRevise - montantInitial };
  }
  return computeRevisionAmount(line, line?.montantInitialHT, line?.valeursActuelles);
}
export function getRevisionSectors(doc: any): any[] {
  if (Array.isArray(doc.sectors)) {
    return doc.sectors.map((s: any) => {
      if (Array.isArray(s.terms)) return s;
      const legacyTermId = "legacy-term";
      return {
        ...s,
        terms: [{ id: legacyTermId, symbole: s.indexName || "", poids: s.coeffVariable, indexBase: s.indexInitial }],
        dateBase: s.dateInitiale || doc.issueDate,
        valeursActuelles: { [legacyTermId]: s.indexActuel },
        decomptes: (s.decomptes || []).map((d: any) => ({ ...d, valeurs: { [legacyTermId]: d.indexValeur } })),
      };
    });
  }
  if (doc.sector !== undefined) {
    const legacyTermId = "legacy-term";
    return [{
      id: "legacy", sector: doc.sector, montantInitialHT: doc.montantInitialHT, coeffFixe: doc.coeffFixe,
      terms: [{ id: legacyTermId, symbole: doc.indexName || "", poids: doc.coeffVariable, indexBase: doc.indexInitial }],
      dateBase: doc.dateInitiale || doc.issueDate, dateActuelle: doc.dateActuelle || doc.issueDate,
      valeursActuelles: { [legacyTermId]: doc.indexActuel }, useDecomptes: false, decomptes: [],
    }];
  }
  return [];
}

// ------------------------------------------------------- feuille « Export »
// Une ligne par document : type, numéro, date, client, statut, HT, TVA, TTC.
export function accountingExportRow(d: any): Array<string | number> {
  const head = [docTypeLabel(d.type), d.docNumber, frDate(d.issueDate), d.client?.name || "", d.status];
  if (d.type === "revision") {
    let ht = 0, tva = 0;
    for (const sec of getRevisionSectors(d)) {
      const r = computeRevisionLine(sec);
      if (r.valid) { ht += r.ecartMontant; tva += r.ecartMontant * Number(sec.tvaRate ?? 0.2); }
    }
    return [...head, fixed2(ht), fixed2(tva), fixed2(ht + tva)];
  }
  if (d.type === "situation") {
    const sit = computeSituationTotals(d);
    return [...head, fixed2(sit.subtotalHT), fixed2(sit.totalTVA), fixed2(sit.netAPayer)];
  }
  if (d.type === "contrat") {
    const ht = num(d.montantTotalHT);
    const tva = ht * num(d.tva) / 100;
    return [...head, fixed2(ht), fixed2(tva), fixed2(ht + tva)];
  }
  if (d.type === "relance") return [...head, "", "", fixed2(num(d.montantDu))];
  const t = computeDocTotals(d);
  return [...head, fixed2(t.subtotalHT), fixed2(t.totalTVA), fixed2(t.totalTTC)];
}
export const EXPORT_HEADER = ["Type", "Numéro", "Date d'émission", "Client", "Statut", "Montant HT", "Montant TVA", "Montant TTC"];
export const ENTRIES_HEADER = ["Date", "Journal", "Pièce", "Libellé", "Compte", "Débit", "Crédit", "Code activité", "Source"];

// Lignes { productId, totalHT, tva } servant aux écritures (même règle que
// accountingLinesOf côté site : montant de cette situation par poste).
export function accountingLinesOf(d: any): Array<{ productId?: string; totalHT: number; tva: number }> {
  if (d.type === "situation") {
    return (Array.isArray(d.items) ? d.items : []).filter((l: any) => l && l.type === "line").map((l: any) => {
      const montantMarche = num(l.qty) * num(l.unitPrice);
      const montantCumuleActuel = (montantMarche * num(l.avancementPct)) / 100;
      return { productId: l.productId, totalHT: montantCumuleActuel - num(l.montantCumulePrecedent), tva: num(l.tva) };
    });
  }
  return computeDocTotals(d).lines.map((l) => ({ productId: l.item?.productId, totalHT: l.totalHT, tva: l.rate }));
}

// ------------------------------------------------------------- écritures
export type Entry = { date: string; journal: string; piece: string; label: string; account: string; debit: number; credit: number; activity?: string; source: string; documentId?: string };
const entry = (base: any, account: string, debit: number, credit: number): Entry => ({ ...base, account, debit: r2(debit), credit: r2(credit) });

export function buildSalesEntries(documents: any[], { productById = new Map<string, any>(), defaults = null as any } = {}): Entry[] {
  const acc = accountingDefaults(defaults);
  const entries: Entry[] = [];
  for (const doc of documents || []) {
    if (!isSalesDocument(doc)) continue;
    const lines = accountingLinesOf(doc);
    const sign = doc.type === "avoir" ? -1 : 1;
    const byAccount = new Map<string, { account: string; activity: string; amount: number }>();
    const vatByAccount = new Map<string, { account: string; activity: string; amount: number }>();
    let totalHT = 0, totalTVA = 0;
    let journal = acc.journalSales;
    for (const l of lines) {
      const ht = r2(l.totalHT);
      const rate = num(l.tva);
      const tva = r2((ht * rate) / 100);
      const product = l.productId ? productById.get(l.productId) : null;
      const salesAccount = nonEmpty(product?.account_sales) || acc.sales;
      const vatAccount = nonEmpty(product?.account_vat_sales) || acc.vatSales;
      const activity = nonEmpty(product?.activity_code);
      if (nonEmpty(product?.journal_code)) journal = product.journal_code.trim();
      const key = `${salesAccount}|${activity}`;
      byAccount.set(key, { account: salesAccount, activity, amount: (byAccount.get(key)?.amount || 0) + ht });
      const vkey = `${vatAccount}|${activity}`;
      vatByAccount.set(vkey, { account: vatAccount, activity, amount: (vatByAccount.get(vkey)?.amount || 0) + tva });
      totalHT += ht; totalTVA += tva;
    }
    if (lines.length === 0) continue;
    const base = { date: doc.issueDate, journal, piece: doc.docNumber, label: `${doc.type === "avoir" ? "Avoir" : doc.type === "situation" ? "Facture de situation" : "Facture"} ${doc.docNumber}${doc.client?.name ? ` - ${doc.client.name}` : ""}`, source: "vente", documentId: doc.id, activity: "" };
    const ttc = r2(totalHT + totalTVA);
    entries.push(entry(base, acc.customer, sign > 0 ? ttc : 0, sign > 0 ? 0 : ttc));
    for (const { account, activity, amount } of byAccount.values()) {
      if (r2(amount) === 0) continue;
      entries.push(entry({ ...base, activity }, account, sign > 0 ? 0 : amount, sign > 0 ? amount : 0));
    }
    for (const { account, activity, amount } of vatByAccount.values()) {
      if (r2(amount) === 0) continue;
      entries.push(entry({ ...base, activity }, account, sign > 0 ? 0 : amount, sign > 0 ? amount : 0));
    }
  }
  return entries;
}

export function buildStockEntries(movements: any[], { productById = new Map<string, any>(), defaults = null as any } = {}): { entries: Entry[]; unpriced: any[] } {
  const acc = accountingDefaults(defaults);
  const docs = new Map<string, { ref: string; date: string; lines: any[] }>();
  for (const m of movements || []) {
    if (m.kind !== "entree") continue;
    const key = m.document_ref || m.id;
    if (!docs.has(key)) docs.set(key, { ref: m.document_ref || "", date: m.moved_at, lines: [] });
    docs.get(key)!.lines.push(m);
  }
  const entries: Entry[] = [];
  const unpriced: any[] = [];
  for (const d of docs.values()) {
    const byAccount = new Map<string, { account: string; activity: string; amount: number }>();
    const vatByAccount = new Map<string, { account: string; activity: string; amount: number }>();
    let journal = acc.journalPurchases;
    let totalHT = 0, totalTVA = 0;
    for (const m of d.lines) {
      const product = productById.get(m.product_id);
      const qty = Math.abs(num(m.quantity));
      const unit = num(product?.purchase_price_ht);
      if (!product || unit <= 0) { unpriced.push({ ref: d.ref, productId: m.product_id, name: product?.name || "Produit supprimé" }); continue; }
      const ht = r2(qty * unit);
      const tva = r2((ht * num(product.purchase_vat_rate)) / 100);
      const account = nonEmpty(product.account_purchases) || acc.purchases;
      const vatAccount = nonEmpty(product.account_vat_purchases) || acc.vatPurchases;
      const activity = nonEmpty(product.activity_code);
      if (nonEmpty(product.journal_code)) journal = product.journal_code.trim();
      const key = `${account}|${activity}`;
      byAccount.set(key, { account, activity, amount: (byAccount.get(key)?.amount || 0) + ht });
      const vkey = `${vatAccount}|${activity}`;
      vatByAccount.set(vkey, { account: vatAccount, activity, amount: (vatByAccount.get(vkey)?.amount || 0) + tva });
      totalHT += ht; totalTVA += tva;
    }
    if (r2(totalHT) === 0) continue;
    const base = { date: String(d.date).slice(0, 10), journal, piece: d.ref, label: `Entrée de stock ${d.ref}${d.lines[0]?.reason ? ` - ${d.lines[0].reason}` : ""}`, source: "stock", documentId: d.ref, activity: "" };
    for (const { account, activity, amount } of byAccount.values()) entries.push(entry({ ...base, activity }, account, amount, 0));
    for (const { account, activity, amount } of vatByAccount.values()) if (r2(amount) !== 0) entries.push(entry({ ...base, activity }, account, amount, 0));
    entries.push(entry(base, acc.supplier, 0, r2(totalHT + totalTVA)));
  }
  return { entries, unpriced };
}

// ---------------------------------------------------------------- périodes
export type ExportFrequency = "mensuel" | "trimestriel";
export type ExportPeriod = { id: string; label: string; from: string; to: string };
const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m : 1-12

// Période précédente (mois ou trimestre civil) par rapport à une date.
export function previousPeriod(now: Date, frequency: ExportFrequency): ExportPeriod {
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1; // 1-12
  if (frequency === "trimestriel") {
    const currentQuarter = Math.ceil(m / 3);
    const q = currentQuarter === 1 ? 4 : currentQuarter - 1;
    const qy = currentQuarter === 1 ? y - 1 : y;
    const firstMonth = (q - 1) * 3 + 1;
    return { id: `${qy}-T${q}`, label: `${q}${q === 1 ? "er" : "e"} trimestre ${qy}`, from: iso(qy, firstMonth, 1), to: iso(qy, firstMonth + 2, lastDay(qy, firstMonth + 2)) };
  }
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return { id: iso(py, pm, 1).slice(0, 7), label: `${MONTHS_FR[pm - 1]} ${py}`, from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)) };
}
// Envoi dû : à partir du jour choisi du mois (3 par défaut), une seule fois
// par période.
export function exportDueToday(now: Date, frequency: ExportFrequency, lastSentPeriod: string | null | undefined, sendDay = 3): boolean {
  if (now.getUTCDate() < sendDay) return false;
  return previousPeriod(now, frequency).id !== (lastSentPeriod || "");
}
export function documentsInPeriod(documents: any[], period: { from: string; to: string }): any[] {
  return (documents || []).filter((d) => {
    const day = String(d?.issueDate || "").slice(0, 10);
    return day >= period.from && day <= period.to;
  }).sort((a, b) => (String(a.issueDate) < String(b.issueDate) ? -1 : String(a.issueDate) > String(b.issueDate) ? 1 : 0));
}
export function entriesInPeriod(entries: Entry[], period: { from: string; to: string }): Entry[] {
  return entries.filter((e) => e.date >= period.from && e.date <= period.to).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Feuilles de l'export d'une période : lignes de la feuille « Export
// comptable » et, si demandé (forfaits Pro/Entreprise), de la feuille
// « Écritures » (ventes + entrées de stock de la période).
export function buildExportSheets(documents: any[], period: ExportPeriod, opts: { includeEntries: boolean; products?: any[]; movements?: any[]; defaults?: any }) {
  const docs = documentsInPeriod(documents, period);
  const rows: Array<Array<string | number>> = [EXPORT_HEADER, ...docs.map(accountingExportRow)];
  let entryRows: Array<Array<string | number>> | null = null;
  if (opts.includeEntries) {
    const productById = new Map((opts.products || []).map((p: any) => [p.id, p]));
    const defaults = accountingDefaults(opts.defaults);
    const entries = entriesInPeriod([
      ...buildSalesEntries(documents, { productById, defaults }),
      ...buildStockEntries(opts.movements || [], { productById, defaults }).entries,
    ], period);
    entryRows = [ENTRIES_HEADER, ...entries.map((e) => [e.date, e.journal, e.piece, e.label, e.account, e.debit, e.credit, e.activity || "", e.source])];
  }
  return { rows, entryRows, documentCount: docs.length };
}
