import { describe, it, expect } from "vitest";
import { buildSalesEntries, buildStockEntries, valuedStockMovements, accountsOverview, filterEntries, entriesTotals, entriesToCsv, accountingDefaults, isSalesDocument } from "./accounting.js";

const products = new Map([
  ["p1", { id: "p1", name: "Carrelage", account_sales: "707100", account_vat_sales: "445711", account_purchases: "607100", account_vat_purchases: "445661", journal_code: "VT", activity_code: "SOLS", purchase_price_ht: 10, purchase_vat_rate: 20 }],
  ["p2", { id: "p2", name: "Main d'œuvre", purchase_price_ht: 0 }],
]);
const computeLines = (doc) => doc.items;

describe("écritures de vente", () => {
  it("facture : débit client TTC, crédit produits HT et TVA, comptes du produit lié sinon défauts", () => {
    const doc = { id: "d1", type: "facture", status: "envoyée", issueDate: "2026-09-13", docNumber: "FAC-001", client: { name: "Dupont" }, items: [{ productId: "p1", totalHT: 100, tva: 20 }, { totalHT: 50, tva: 10 }] };
    const e = buildSalesEntries([doc], { productById: products, computeLines });
    const total = entriesTotals(e);
    expect(total.debit).toBe(total.credit); // équilibre débit / crédit
    expect(e.find((x) => x.account === "411000")).toMatchObject({ debit: 175, credit: 0, journal: "VT", piece: "FAC-001" });
    expect(e.find((x) => x.account === "707100")).toMatchObject({ credit: 100, activity: "SOLS" });
    expect(e.find((x) => x.account === "706000")).toMatchObject({ credit: 50, activity: "" });
    expect(e.find((x) => x.account === "445711")).toMatchObject({ credit: 20 });
    expect(e.find((x) => x.account === "445710")).toMatchObject({ credit: 5 });
  });
  it("avoir : sens inversés ; brouillons et devis ignorés", () => {
    const avoir = { id: "a1", type: "avoir", status: "envoyée", issueDate: "2026-09-13", docNumber: "AVO-001", client: {}, items: [{ totalHT: 100, tva: 20 }] };
    const e = buildSalesEntries([avoir, { ...avoir, id: "b", status: "brouillon" }, { ...avoir, id: "c", type: "devis" }], { productById: products, computeLines });
    expect(e).toHaveLength(3);
    expect(e.find((x) => x.account === "411000")).toMatchObject({ debit: 0, credit: 120 });
    expect(e.find((x) => x.account === "706000")).toMatchObject({ debit: 100, credit: 0 });
    expect(isSalesDocument({ type: "facture", status: "brouillon" })).toBe(false);
    expect(isSalesDocument({ type: "acompte", status: "payée" })).toBe(true);
  });
  it("comptes par défaut personnalisables", () => {
    const d = accountingDefaults({ sales: "707000", journalSales: "" });
    expect(d.sales).toBe("707000");
    expect(d.journalSales).toBe("VE");
  });
});

describe("écritures d'achat (entrées de stock)", () => {
  const movements = [
    { id: "m1", kind: "entree", product_id: "p1", quantity: 10, moved_at: "2026-09-10T08:00:00Z", document_ref: "ENT-2026-001", reason: "BL 42" },
    { id: "m2", kind: "entree", product_id: "p2", quantity: 3, moved_at: "2026-09-10T08:00:00Z", document_ref: "ENT-2026-001" },
    { id: "m3", kind: "sortie", product_id: "p1", quantity: -4, moved_at: "2026-09-11T08:00:00Z", document_ref: "SOR-2026-001", reason: "Chantier" },
  ];
  it("une entrée valorisée au prix d'achat, équilibrée, produits sans prix signalés", () => {
    const { entries, unpriced } = buildStockEntries(movements, { productById: products });
    const total = entriesTotals(entries);
    expect(total.debit).toBe(total.credit);
    expect(entries.find((x) => x.account === "607100")).toMatchObject({ debit: 100, journal: "VT", activity: "SOLS", piece: "ENT-2026-001", date: "2026-09-10" });
    expect(entries.find((x) => x.account === "445661")).toMatchObject({ debit: 20 });
    expect(entries.find((x) => x.account === "401000")).toMatchObject({ credit: 120 });
    expect(unpriced).toEqual([{ ref: "ENT-2026-001", productId: "p2", name: "Main d'œuvre" }]);
  });
  it("sorties valorisées à part, sans écriture", () => {
    const v = valuedStockMovements(movements, { productById: products });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: "sortie", quantity: -4, unitCost: 10, value: 40, account: "607100" });
  });
});

describe("vue d'ensemble, filtres, export", () => {
  it("comptes utilisés sur les produits, par type", () => {
    const o = accountsOverview([...products.values()]);
    expect(o).toEqual([
      { code: "607100", kind: "achats", count: 1, products: ["Carrelage"] },
      { code: "707100", kind: "produits", count: 1, products: ["Carrelage"] },
      { code: "445661", kind: "tva_achat", count: 1, products: ["Carrelage"] },
      { code: "445711", kind: "tva_vente", count: 1, products: ["Carrelage"] },
    ]);
  });
  it("filtre par période, journal, activité et source", () => {
    const entries = [
      { date: "2026-09-01", journal: "VE", activity: "", source: "vente", debit: 1, credit: 0 },
      { date: "2026-09-15", journal: "VT", activity: "SOLS", source: "vente", debit: 1, credit: 0 },
      { date: "2026-10-01", journal: "AC", activity: "SOLS", source: "stock", debit: 1, credit: 0 },
    ];
    expect(filterEntries(entries, { from: "2026-09-01", to: "2026-09-30" })).toHaveLength(2);
    expect(filterEntries(entries, { journal: "VT" })).toHaveLength(1);
    expect(filterEntries(entries, { activity: "SOLS" })).toHaveLength(2);
    expect(filterEntries(entries, { source: "stock" })).toHaveLength(1);
  });
  it("CSV : point-virgule, virgule décimale, BOM, guillemets échappés", () => {
    const csv = entriesToCsv([{ date: "2026-09-13", journal: "VE", piece: "FAC-1", label: 'Facture "test"', account: "411000", debit: 120.5, credit: 0, activity: "", source: "vente" }]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\r\n")[1]).toBe('"2026-09-13";"VE";"FAC-1";"Facture ""test""";"411000";"120,50";"0,00";"";"vente"');
  });
});
