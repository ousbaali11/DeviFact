// @vitest-environment jsdom
// Test de rendu de l'onglet Comptabilité (Gestion de stock — étape 4) :
// la page doit s'afficher dans les trois versions d'interface, vide et
// avec des données, et produire des écritures équilibrées.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ComptabiliteView, newDocument, emptyCompanyProfile, emptyProduct } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });

async function renderOnce(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  const html = container.innerHTML;
  const text = container.textContent;
  await act(async () => { root.unmount(); });
  container.remove();
  return { html, text };
}

const noop = () => {};
const products = [
  { ...emptyProduct("org_test"), id: "p1", name: "Carrelage 60x60", kind: "produit", account_sales: "707100", account_purchases: "607100", account_vat_sales: "445711", account_vat_purchases: "445661", journal_code: "VT", activity_code: "SOLS", purchase_price_ht: 10, purchase_vat_rate: 20 },
  { ...emptyProduct("org_test"), id: "p2", name: "Pose", kind: "service" },
];
const facture = { ...newDocument("facture", []), id: "d1", docNumber: "FAC-2026-001", status: "envoyée", issueDate: "2026-09-10", client: { name: "Dupont" }, items: [
  { id: "l1", type: "line", productId: "p1", description: "Carrelage", qty: 10, unitPrice: 25, tva: 20 },
  { id: "l2", type: "line", description: "Pose", qty: 1, unitPrice: 100, tva: 10 },
] };
const movements = [
  { id: "m1", kind: "entree", product_id: "p1", quantity: 10, moved_at: "2026-09-05T08:00:00Z", document_ref: "ENT-2026-001", reason: "BL 42" },
  { id: "m2", kind: "sortie", product_id: "p1", quantity: -4, moved_at: "2026-09-06T08:00:00Z", document_ref: "SOR-2026-001" },
];
const base = { movementsLoading: false, companyProfile: { ...emptyCompanyProfile(), fiscalStartMonth: 1 }, canEdit: true, darkMode: false, onRefreshMovements: noop, onSaveDefaults: noop, onExportXlsx: noop };

describe("onglet Comptabilité", () => {
  for (const version of ["classique", "avancee", "atelier"]) {
    it(`s'affiche vide en version ${version}`, async () => {
      const { text } = await renderOnce(<ComptabiliteView {...base} documents={[]} products={[]} movements={[]} siteSettings={{ landingPageVersion: version }} />);
      expect(text).toContain("Comptabilité");
      expect(text).toContain("Aucune écriture sur cette période");
      expect(text).toContain("Aucun compte renseigné");
    });
  }
  it("affiche les comptes utilisés, les écritures de vente et de stock, équilibrées", async () => {
    const { text, html } = await renderOnce(<ComptabiliteView {...base} documents={[facture]} products={products} movements={movements} siteSettings={{ landingPageVersion: "classique" }} />);
    expect(text).toContain("707100");
    expect(text).toContain("1 sans compte : compte par défaut utilisé"); // Pose sans compte de produits
    expect(text).toContain("FAC-2026-001");
    expect(text).toContain("ENT-2026-001");
    // Facture : 250 HT (20 %) + 100 HT (10 %) = 350 HT, 60 TVA, 410 TTC ; entrée : 100 HT + 20 TVA = 120 TTC
    expect(text).toContain("Débit 530,00 · Crédit 530,00");
    expect(text).not.toContain("déséquilibre");
    // Sortie valorisée au prix d'achat (4 × 10)
    expect(text).toContain("Sorties et ajustements de stock valorisés");
    expect(text).toContain("SOR-2026-001");
    expect(html).toContain("40,00");
  });
  it("brouillons ignorés", async () => {
    const { text } = await renderOnce(<ComptabiliteView {...base} documents={[{ ...facture, status: "brouillon" }]} products={products} movements={[]} siteSettings={{ landingPageVersion: "classique" }} />);
    expect(text).toContain("Aucune écriture sur cette période");
  });
});
