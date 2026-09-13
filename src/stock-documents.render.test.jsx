// @vitest-environment jsdom
// Bug signalé : dans « Documents de stock », le document apparaissait mais
// le détail des lignes (produits, quantités) restait invisible, replié
// derrière un chevron. Désormais le détail est visible d'emblée, et un
// clic sur l'en-tête le replie / le déplie.
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
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const rowOf = (container, ref) => [...container.querySelectorAll("button")].find((b) => b.textContent.includes(ref));

describe("Documents de stock : détail des lignes", () => {
  for (const version of ["classique", "avancee", "atelier"]) {
    it(`version ${version} : produits et quantités visibles sans aucun clic`, async () => {
      const { container, unmount } = await mount(
        <StockDocumentsView movements={movements} loading={false} products={products} warehouses={warehouses} account={{ organizationId: "" }} siteSettings={{ landingPageVersion: version }} darkMode={false} onRefresh={noop} onGoToEntry={noop} onGoToExit={noop} />,
      );
      const text = container.textContent;
      expect(text).toContain("ENT-2026-001");
      expect(text).toContain("2 lignes");
      expect(text).toContain("Carrelage 60x60");
      expect(text).toContain("Colle");
      expect(text).toContain("+10 m²");
      expect(text).toContain("+3 sac");
      expect(text).toContain("Motif / référence : BL 42");
      // La sortie aussi, avec sa quantité négative
      expect(text).toContain("SOR-2026-001");
      expect(text).toContain("-4 m²");
      expect(text).toContain("Motif / référence : Chantier Dupont");
      await unmount();
    });
  }
  it("un clic sur l'en-tête replie le détail de ce document seulement, un second clic le rouvre", async () => {
    const { container, unmount } = await mount(
      <StockDocumentsView movements={movements} loading={false} products={products} warehouses={warehouses} account={{ organizationId: "" }} siteSettings={{ landingPageVersion: "classique" }} darkMode={false} onRefresh={noop} onGoToEntry={noop} onGoToExit={noop} />,
    );
    await click(rowOf(container, "ENT-2026-001"));
    expect(container.textContent).not.toContain("Colle");
    expect(container.textContent).not.toContain("BL 42");
    expect(container.textContent).toContain("Chantier Dupont"); // l'autre document reste déplié
    await click(rowOf(container, "ENT-2026-001"));
    expect(container.textContent).toContain("Colle");
    await unmount();
  });
});
