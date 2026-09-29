// @vitest-environment jsdom
// « Documents de stock » (présentation du 29/09/2026) : une ligne par
// produit mouvementé, visible sans aucun clic, avec type, produit,
// quantité, entrepôt, motif, document et auteur ; regroupement par jour.
// (Le bug d'origine : le détail restait replié derrière un chevron.)
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { StockDocumentsView, emptyProduct } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });

const noop = () => {};
const products = [
  { ...emptyProduct("org_test"), id: "11111111-2222-4333-8444-555555555555", name: "Carrelage 60x60", unit: "m²" },
  { ...emptyProduct("org_test"), id: "22222222-2222-4333-8444-555555555555", name: "Colle", unit: "sac" },
];
const warehouses = [{ id: "w1", name: "Dépôt principal", is_default: true }];
// Lignes telles que renvoyées par Supabase (select * sur stock_movements) :
// quantity numeric → chaîne, moved_at timestamptz → ISO.
const movements = [
  { id: "m1", organization_id: "org_test", product_id: "11111111-2222-4333-8444-555555555555", warehouse_id: "w1", kind: "entree", quantity: "10.000", moved_at: "2026-09-13T08:00:00+00:00", reason: "BL 42", document_ref: "ENT-2026-001", created_by: "u1", created_at: "2026-09-13T08:00:00+00:00" },
  { id: "m2", organization_id: "org_test", product_id: "22222222-2222-4333-8444-555555555555", warehouse_id: "w1", kind: "entree", quantity: "3.000", moved_at: "2026-09-13T08:00:00+00:00", reason: "BL 42", document_ref: "ENT-2026-001", created_by: "u1", created_at: "2026-09-13T08:00:00+00:00" },
  { id: "m3", organization_id: "org_test", product_id: "11111111-2222-4333-8444-555555555555", warehouse_id: "w1", kind: "sortie", quantity: "-4.000", moved_at: "2026-09-12T08:00:00+00:00", reason: "Chantier Dupont", document_ref: "SOR-2026-001", created_by: "u1", created_at: "2026-09-12T08:00:00+00:00" },
];

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const view = () => <StockDocumentsView movements={movements} loading={false} products={products} warehouses={warehouses} account={{ organizationId: "" }} onRefresh={noop} onGoToEntry={noop} onGoToExit={noop} />;

describe("Documents de stock : lignes produit", () => {
  it("produits, quantités, motifs et documents visibles sans aucun clic, une ligne par produit", async () => {
    const { container, unmount } = await mount(view());
    const rows = [...container.querySelectorAll('[data-testid="stock-line"]')];
    expect(rows).toHaveLength(3);
    const text = container.textContent;
    expect(text).toContain("ENT-2026-001");
    expect(text).toContain("Carrelage 60x60");
    expect(text).toContain("Colle");
    expect(text).toContain("+10m²");
    expect(text).toContain("+3sac");
    expect(text).toContain("BL 42");
    expect(text).toContain("SOR-2026-001");
    expect(text).toContain("-4m²");
    expect(text).toContain("Chantier Dupont");
    expect(text).toContain("Dépôt principal");
    // Le type se voit : pastille colorée + libellé sur chaque ligne, liseré de la couleur du type.
    expect(rows.map((r) => r.dataset.kind)).toEqual(["entree", "entree", "sortie"]);
    expect(rows[0].textContent).toContain("Entrée");
    expect(rows[2].textContent).toContain("Sortie");
    expect(rows[0].style.borderLeft).not.toBe(rows[2].style.borderLeft);
    // Deux lignes du même document qui se suivent : le numéro n'est affiché qu'une fois.
    expect(rows[0].textContent).toContain("ENT-2026-001");
    expect(rows[1].textContent).not.toContain("ENT-2026-001");
    await unmount();
  });
  it("regroupement par jour : deux bandeaux (13 puis 12 septembre), plus récent en premier, solde du jour seulement à unité homogène", async () => {
    const { container, unmount } = await mount(view());
    const days = [...container.querySelectorAll('[data-testid="stock-day"]')];
    expect(days).toHaveLength(2);
    expect(days[0].textContent).toContain("13 septembre 2026");
    expect(days[1].textContent).toContain("12 septembre 2026");
    // 13/09 : m² et sacs mélangés → nombre de mouvements seulement ; 12/09 : une sortie de 4 m².
    expect(days[0].querySelector('[data-testid="stock-day-summary"]').textContent).toBe("2 mouvements");
    expect(days[1].querySelector('[data-testid="stock-day-summary"]').textContent).toBe("1 mouvement · -4 m²");
    await unmount();
  });
});
