// accounting.js — écritures comptables générées à partir des ventes et des
// mouvements de stock (fonctions pures, testées unitairement).
//
// Principes retenus (à valider avec un expert-comptable) :
//   * Ventes : une écriture par facture, facture d'acompte ou avoir émis
//     (hors brouillon), datée du jour d'émission, au journal des ventes :
//       débit  411 client            = TTC
//       crédit compte de produits    = HT (par compte : celui du produit
//                                        lié à la ligne, sinon compte par défaut)
//       crédit compte de TVA vente   = TVA (par taux, compte du produit lié
//                                        sinon compte par défaut)
//     Un avoir inverse les sens. Les montants négatifs ne sont pas produits.
//   * Entrées de stock : une écriture par document d'entrée, valorisée au
//     prix d'achat HT du produit, au journal des achats :
//       débit  compte d'achats       = HT
//       débit  compte de TVA achat   = TVA (taux d'achat du produit)
//       crédit 401 fournisseur       = TTC
//     Sans prix d'achat renseigné, la ligne est signalée (montant 0).
//   * Sorties et ajustements de stock : pas d'écriture (consommation non
//     comptabilisée ici), mais exportés à part, valorisés au prix d'achat.
//   * Journal : code journal du produit lié, sinon journal par défaut
//     (VE ventes, AC achats). Code activité : celui du produit lié.

export const DEFAULT_ACCOUNTS = {
  sales: "706000",        // produits (prestations de services)
  purchases: "607000",    // achats de marchandises
  vatSales: "445710",     // TVA collectée
  vatPurchases: "445660", // TVA déductible sur biens et services
  customer: "411000",     // clients
  supplier: "401000",     // fournisseurs
  journalSales: "VE",
  journalPurchases: "AC",
};

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const nonEmpty = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");

export function accountingDefaults(custom) {
  const out = { ...DEFAULT_ACCOUNTS };
  Object.keys(DEFAULT_ACCOUNTS).forEach((k) => { if (nonEmpty(custom?.[k])) out[k] = custom[k].trim(); });
  return out;
}

// Documents de vente pris en compte : factures, factures d'acompte, avoirs
// émis (tout statut sauf brouillon).
// Documents de vente pris en compte : factures, factures d'acompte, avoirs
// émis (tout statut sauf brouillon), et situations de travaux « vaut facture ».
export function isSalesDocument(doc) {
  if (!doc || doc.status === "brouillon") return false;
  return ["facture", "acompte", "avoir"].includes(doc.type) || (doc.type === "situation" && doc.vautFacture === true);
}

function entry(base, account, debit, credit) {
  return { ...base, account, debit: r2(debit), credit: r2(credit) };
}

// Écritures de vente. `computeLines(doc)` renvoie les lignes calculées
// { productId?, totalHT, tva } (fourni par l'application, qui connaît
// les règles de remise) ; `productById` : Map id → produit.
export function buildSalesEntries(documents, { productById = new Map(), defaults, computeLines } = {}) {
  const acc = accountingDefaults(defaults);
  const entries = [];
  for (const doc of documents || []) {
    if (!isSalesDocument(doc)) continue;
    const lines = typeof computeLines === "function" ? computeLines(doc) : [];
    const sign = doc.type === "avoir" ? -1 : 1;
    // Regroupement par compte de produits / journal / activité, et TVA par compte.
    const byAccount = new Map();
    const vatByAccount = new Map();
    let totalHT = 0, totalTVA = 0;
    let journal = acc.journalSales;
    for (const l of lines) {
      const ht = r2(l.totalHT);
      const rate = Number(l.tva) || 0;
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
    // Client : débit TTC (crédit pour un avoir)
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

// Écritures d'achat à partir des entrées de stock (une par document).
// `movements` : lignes de stock_movements ; seules les entrées comptent.
export function buildStockEntries(movements, { productById = new Map(), defaults } = {}) {
  const acc = accountingDefaults(defaults);
  const docs = new Map();
  for (const m of movements || []) {
    if (m.kind !== "entree") continue;
    const key = m.document_ref || m.id;
    if (!docs.has(key)) docs.set(key, { ref: m.document_ref || "", date: m.moved_at, lines: [] });
    docs.get(key).lines.push(m);
  }
  const entries = [];
  const unpriced = [];
  for (const d of docs.values()) {
    const byAccount = new Map();
    const vatByAccount = new Map();
    let journal = acc.journalPurchases;
    let totalHT = 0, totalTVA = 0;
    for (const m of d.lines) {
      const product = productById.get(m.product_id);
      const qty = Math.abs(Number(m.quantity) || 0);
      const unit = Number(product?.purchase_price_ht) || 0;
      if (!product || unit <= 0) { unpriced.push({ ref: d.ref, productId: m.product_id, name: product?.name || "Produit supprimé" }); continue; }
      const ht = r2(qty * unit);
      const tva = r2((ht * (Number(product.purchase_vat_rate) || 0)) / 100);
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
    const base = { date: localIsoDate(d.date), journal, piece: d.ref, label: `Entrée de stock ${d.ref}${d.lines[0]?.reason ? ` - ${d.lines[0].reason}` : ""}`, source: "stock", documentId: d.ref, activity: "" };
    for (const { account, activity, amount } of byAccount.values()) entries.push(entry({ ...base, activity }, account, amount, 0));
    for (const { account, activity, amount } of vatByAccount.values()) if (r2(amount) !== 0) entries.push(entry({ ...base, activity }, account, amount, 0));
    entries.push(entry(base, acc.supplier, 0, r2(totalHT + totalTVA)));
  }
  return { entries, unpriced };
}

// Sorties et ajustements valorisés au prix d'achat (information, hors écritures).
export function valuedStockMovements(movements, { productById = new Map() } = {}) {
  return (movements || [])
    .filter((m) => m.kind !== "entree")
    .map((m) => {
      const product = productById.get(m.product_id);
      const unit = Number(product?.purchase_price_ht) || 0;
      return { id: m.id, date: localIsoDate(m.moved_at), ref: m.document_ref || "", kind: m.kind, productName: product?.name || "Produit supprimé", quantity: Number(m.quantity) || 0, unitCost: unit, value: r2(Math.abs(Number(m.quantity) || 0) * unit), account: nonEmpty(product?.account_purchases), journal: nonEmpty(product?.journal_code), activity: nonEmpty(product?.activity_code), reason: m.reason || "" };
    });
}

// Comptes comptables déclarés sur les produits : { code, kind, count }.
export function accountsOverview(products) {
  const kinds = [["account_sales", "produits"], ["account_purchases", "achats"], ["account_vat_sales", "tva_vente"], ["account_vat_purchases", "tva_achat"]];
  const map = new Map();
  for (const p of products || []) {
    for (const [field, kind] of kinds) {
      const code = nonEmpty(p[field]);
      if (!code) continue;
      const key = `${kind}|${code}`;
      const cur = map.get(key) || { code, kind, count: 0, products: [] };
      cur.count += 1; cur.products.push(p.name);
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.code.localeCompare(b.code));
}

// Filtre commun des écritures : période (AAAA-MM-JJ inclus), journal,
// code activité, source.
export function filterEntries(entries, { from, to, journal, activity, source } = {}) {
  return (entries || []).filter((e) =>
    (!from || e.date >= from) && (!to || e.date <= to)
    && (!journal || e.journal === journal)
    && (!activity || e.activity === activity)
    && (!source || e.source === source));
}

export function entriesTotals(entries) {
  return (entries || []).reduce((t, e) => ({ debit: r2(t.debit + e.debit), credit: r2(t.credit + e.credit) }), { debit: 0, credit: 0 });
}

// Jour local d'une date : une date seule (« AAAA-MM-JJ ») est gardée telle
// quelle, un horodatage complet est lu dans le fuseau de l'utilisateur.
export function localIsoDate(value) {
  const s = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Export CSV (séparateur point-virgule, décimales à la virgule, BOM pour Excel).
export function entriesToCsv(entries) {
  const fmt = (n) => (Number(n) || 0).toFixed(2).replace(".", ",");
  // Une cellule qui commence par = + @ (ou - suivi d'autre chose qu'un
  // nombre) serait exécutée comme formule par un tableur : neutralisée par
  // une apostrophe, comme le font les tableurs eux-mêmes.
  const esc = (v) => {
    let s = String(v ?? "");
    if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-?\d[\d\s.,]*$/.test(s))) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = [["Date", "Journal", "Pièce", "Libellé", "Compte", "Débit", "Crédit", "Code activité", "Source"]];
  for (const e of entries || []) rows.push([e.date, e.journal, e.piece, e.label, e.account, fmt(e.debit), fmt(e.credit), e.activity || "", e.source]);
  return "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n");
}
