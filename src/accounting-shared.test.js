// @vitest-environment jsdom
// Export comptable côté serveur (supabase/functions/_shared/accounting.ts) :
// mêmes lignes et mêmes écritures que l'export manuel de la page
// Comptabilité (accountingExportRow / accountingLinesOf dans App.jsx et
// src/accounting.js), sur tous les types de documents ; périodes (mois ou
// trimestre précédent), envoi dû une seule fois par période.
import { describe, it, expect } from "vitest";
import { accountingExportRow, accountingLinesOf, newDocument, newSituationDocument } from "./App.jsx";
import { buildSalesEntries, buildStockEntries } from "./accounting.js";
import * as shared from "../supabase/functions/_shared/accounting.ts";

const line = (o) => ({ id: Math.random().toString(36).slice(2), type: "line", designation: "Poste", details: [], qty: 1, unitPrice: 0, tva: 20, discount: 0, ...o });
const base = (type, extra = {}) => ({ ...newDocument(type, []), issueDate: "2026-08-12", status: "envoyée", client: { type: "entreprise", name: "Client SAS" }, ...extra });
const docs = [
  base("facture", { docNumber: "FAC-001", items: [line({ unitPrice: 100, productId: "p1" }), line({ unitPrice: 50, tva: 10, discount: 10, details: [{ id: "d", text: "Option", price: "20", included: true }] })], globalDiscount: 5 }),
  base("facture", { docNumber: "FAC-002", issueDate: "2026-09-01", items: [line({ unitPrice: 200 })], globalDiscount: 30, globalDiscountMode: "amount", acompteVerse: 40 }),
  base("avoir", { docNumber: "AV-001", items: [line({ unitPrice: 80, productId: "p1" })] }),
  base("acompte", { docNumber: "ACO-001", items: [line({ unitPrice: 300 })] }),
  base("facture", { docNumber: "FAC-BROUILLON", status: "brouillon", items: [line({ unitPrice: 10 })] }),
  base("devis", { docNumber: "DEV-001", items: [line({ unitPrice: 1000 })] }),
  base("proforma", { docNumber: "PRO-001", items: [line({ unitPrice: 15.5 })] }),
  { ...newSituationDocument([]), docNumber: "SIT-002", issueDate: "2026-08-20", status: "envoyée", vautFacture: true, numeroSituation: 2, client: { name: "Mairie" }, retenueGarantiePct: 5, acompteVerse: 10, items: [{ id: "s1", type: "line", designation: "Gros œuvre", qty: 10, unitPrice: 100, tva: 20, avancementPct: 60, montantCumulePrecedent: 300, productId: "p2" }, { id: "s2", type: "line", designation: "Second œuvre", qty: 2, unitPrice: 50, tva: 10, avancementPct: 50, montantCumulePrecedent: 0 }] },
  { ...newDocument("contrat", []), docNumber: "CT-001", issueDate: "2026-08-03", status: "signé", client: { name: "Dupont" }, montantTotalHT: 1234.5, tva: 20 },
  { ...newDocument("relance", []), docNumber: "REL-001", issueDate: "2026-08-30", status: "envoyée", client: { name: "Mauvais payeur" }, montantDu: "410.25" },
  { ...newDocument("revision", []), docNumber: "REV-001", issueDate: "2026-08-15", status: "envoyée", client: { name: "OPH" }, sectors: [
    { id: "a", sector: "Gros œuvre", montantInitialHT: 10000, coeffFixe: 0.15, tvaRate: 0.2, terms: [{ id: "t1", symbole: "BT01", poids: 0.85, indexBase: 120 }], valeursActuelles: { t1: 126 } },
    { id: "b", sector: "Électricité", montantInitialHT: 0, coeffFixe: 0.15, tvaRate: 0.1, useDecomptes: true, terms: [{ id: "t2", symbole: "BT47", poids: 0.85, indexBase: 100 }], decomptes: [{ id: "d1", montantTotal: 5000, mois: [{ id: "m1", jours: 10, valeurs: { t2: 104 } }, { id: "m2", jours: 20, valeurs: { t2: 110 } }] }] },
    { id: "c", sector: "Invalide", montantInitialHT: 500, coeffFixe: 0.15, terms: [{ id: "t3", poids: 0.85, indexBase: 0 }], valeursActuelles: {} },
  ] },
  { ...newDocument("revision", []), docNumber: "REV-OLD", issueDate: "2026-08-16", status: "envoyée", client: { name: "Ancien" }, sector: "Plomberie", montantInitialHT: 2000, coeffFixe: 0.125, coeffVariable: 0.875, indexName: "BT01", indexInitial: 100, indexActuel: 108 },
  base("pv_reception", { docNumber: "PV-001", items: [] }),
];
const products = [
  { id: "p1", name: "Carrelage", account_sales: "707000", account_vat_sales: "445711", activity_code: "CAR", journal_code: "VT", purchase_price_ht: 12.5, purchase_vat_rate: 20, account_purchases: "607100", account_vat_purchases: "445661" },
  { id: "p2", name: "Béton", purchase_price_ht: 80, purchase_vat_rate: 10 },
];
const productById = new Map(products.map((p) => [p.id, p]));
const defaults = { sales: "706100", journalSales: "VE2", customer: "411100" };
const movements = [
  { id: "m1", kind: "entree", product_id: "p1", quantity: 10, moved_at: "2026-08-05T10:00:00Z", document_ref: "BL-1", reason: "Livraison" },
  { id: "m2", kind: "entree", product_id: "p2", quantity: 3, moved_at: "2026-08-05T10:00:00Z", document_ref: "BL-1" },
  { id: "m3", kind: "entree", product_id: "inconnu", quantity: 1, moved_at: "2026-08-06T10:00:00Z", document_ref: "BL-2" },
  { id: "m4", kind: "sortie", product_id: "p1", quantity: -2, moved_at: "2026-08-07T10:00:00Z", document_ref: "" },
  { id: "m5", kind: "entree", product_id: "p1", quantity: 1, moved_at: "2026-09-02T10:00:00Z", document_ref: "BL-3" },
];

describe("parité avec l'export manuel du site", () => {
  it("feuille « Export comptable » : une ligne identique par document, tous types confondus", () => {
    for (const d of docs) expect(shared.accountingExportRow(d), d.docNumber).toEqual(accountingExportRow(d));
    const rev = shared.accountingExportRow(docs.find((d) => d.docNumber === "REV-001"));
    expect(rev[5]).toBeCloseTo(10000 * (0.15 + 0.85 * 1.05) - 10000 + 5000 * (0.85 * (0.04 * 10 + 0.1 * 20) / 30), 2);
    expect(rev[0]).toBe("Revision-prix");
    expect(shared.accountingExportRow(docs.find((d) => d.docNumber === "REL-001")).slice(5)).toEqual(["", "", 410.25]);
  });
  it("lignes des écritures : mêmes produits, montants HT et taux", () => {
    for (const d of docs) {
      const a = accountingLinesOf(d).map((l) => [l.productId, Number(l.totalHT.toFixed(6)), Number(l.tva)]);
      const b = shared.accountingLinesOf(d).map((l) => [l.productId, Number(l.totalHT.toFixed(6)), Number(l.tva)]);
      expect(b, d.docNumber).toEqual(a);
    }
  });
  it("écritures de vente et d'entrée de stock identiques (comptes par produit, journaux, activité, sens des avoirs)", () => {
    const front = buildSalesEntries(docs, { productById, defaults, computeLines: accountingLinesOf });
    const server = shared.buildSalesEntries(docs, { productById, defaults });
    expect(server).toEqual(front);
    expect(front.some((e) => e.account === "707000" && e.journal === "VT" && e.activity === "CAR")).toBe(true);
    expect(front.filter((e) => e.piece === "AV-001").map((e) => [e.debit, e.credit])).toEqual([[0, 96], [80, 0], [16, 0]]);
    expect(front.some((e) => e.piece === "FAC-BROUILLON" || e.piece === "DEV-001")).toBe(false);
    const stockFront = buildStockEntries(movements, { productById, defaults });
    const stockServer = shared.buildStockEntries(movements, { productById, defaults });
    expect(stockServer).toEqual(stockFront);
    expect(stockFront.unpriced).toEqual([{ ref: "BL-2", productId: "inconnu", name: "Produit supprimé" }]);
  });
});

describe("périodes et envoi programmé", () => {
  const at = (s) => new Date(`${s}T09:00:00Z`);
  it("période précédente : mois ou trimestre civil, avec passage d'année", () => {
    expect(shared.previousPeriod(at("2026-09-25"), "mensuel")).toEqual({ id: "2026-08", label: "août 2026", from: "2026-08-01", to: "2026-08-31" });
    expect(shared.previousPeriod(at("2026-01-02"), "mensuel")).toEqual({ id: "2025-12", label: "décembre 2025", from: "2025-12-01", to: "2025-12-31" });
    expect(shared.previousPeriod(at("2026-03-03"), "mensuel")).toEqual({ id: "2026-02", label: "février 2026", from: "2026-02-01", to: "2026-02-28" });
    expect(shared.previousPeriod(at("2026-09-25"), "trimestriel")).toEqual({ id: "2026-T2", label: "2e trimestre 2026", from: "2026-04-01", to: "2026-06-30" });
    expect(shared.previousPeriod(at("2026-01-15"), "trimestriel")).toEqual({ id: "2025-T4", label: "4e trimestre 2025", from: "2025-10-01", to: "2025-12-31" });
    expect(shared.previousPeriod(at("2026-04-03"), "trimestriel")).toEqual({ id: "2026-T1", label: "1er trimestre 2026", from: "2026-01-01", to: "2026-03-31" });
  });
  it("envoi dû à partir du 3 du mois, une seule fois par période", () => {
    expect(shared.exportDueToday(at("2026-09-02"), "mensuel", null)).toBe(false);
    expect(shared.exportDueToday(at("2026-09-03"), "mensuel", null)).toBe(true);
    expect(shared.exportDueToday(at("2026-09-10"), "mensuel", "2026-07")).toBe(true);
    expect(shared.exportDueToday(at("2026-09-10"), "mensuel", "2026-08")).toBe(false);
    expect(shared.exportDueToday(at("2026-09-10"), "trimestriel", "2026-T2")).toBe(false);
    expect(shared.exportDueToday(at("2026-10-03"), "trimestriel", "2026-T2")).toBe(true);
  });
  it("feuilles d'une période : documents et écritures de la période seulement, écritures uniquement si demandées", () => {
    const period = shared.previousPeriod(at("2026-09-25"), "mensuel");
    const withEntries = shared.buildExportSheets(docs, period, { includeEntries: true, products, movements, defaults });
    expect(withEntries.documentCount).toBe(docs.length - 1); // FAC-002 est en septembre
    expect(withEntries.rows[0]).toEqual(shared.EXPORT_HEADER);
    expect(withEntries.rows.map((r) => r[1])).not.toContain("FAC-002");
    expect(withEntries.rows[1][1]).toBe("CT-001"); // triées par date
    expect(withEntries.entryRows[0]).toEqual(shared.ENTRIES_HEADER);
    const pieces = new Set(withEntries.entryRows.slice(1).map((r) => r[2]));
    expect(pieces.has("BL-1")).toBe(true);
    expect(pieces.has("BL-3")).toBe(false); // entrée de septembre
    expect(pieces.has("FAC-002")).toBe(false);
    const without = shared.buildExportSheets(docs, period, { includeEntries: false });
    expect(without.entryRows).toBeNull();
    expect(without.rows).toEqual(withEntries.rows);
  });
});
