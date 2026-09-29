// @vitest-environment jsdom
// « Documents de stock », présentation du 29/09/2026 : regroupement par
// jour (fonction pure), filtre de période avec bascule automatique sur
// « tout » quand les 30 derniers jours sont vides, clic sur un numéro de
// document qui isole ses lignes, export CSV limité à ce qui est affiché.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { StockDocumentsView, groupStockLinesByDay, emptyProduct } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });

describe("groupStockLinesByDay", () => {
  const at = (iso, quantity, unit = "m²") => ({ movedAt: iso, quantity, unit });
  it("un bandeau par jour civil, ordre des lignes conservé, libellé en français", () => {
    const days = groupStockLinesByDay([at("2026-09-13T22:30:00", 10), at("2026-09-13T06:00:00", -4), at("2026-09-12T10:00:00", 3)]);
    expect(days.map((d) => d.key)).toEqual(["2026-09-13", "2026-09-12"]);
    expect(days[0].label).toBe("Dimanche 13 septembre 2026");
    expect(days[0].lines).toHaveLength(2);
    expect(days[1].lines).toHaveLength(1);
  });
  it("solde du jour : entrées et sorties séparées quand l'unité est homogène, rien sinon", () => {
    const [homogene] = groupStockLinesByDay([at("2026-09-13T08:00:00", 10), at("2026-09-13T09:00:00", -4), at("2026-09-13T10:00:00", 2.5)]);
    expect(homogene.summary).toEqual({ plus: 12.5, minus: -4, unit: "m²" });
    const [mixte] = groupStockLinesByDay([at("2026-09-13T08:00:00", 10, "m²"), at("2026-09-13T09:00:00", 3, "sac")]);
    expect(mixte.summary).toBeNull();
    const [sansUnite] = groupStockLinesByDay([at("2026-09-13T08:00:00", 1, ""), at("2026-09-13T09:00:00", 2, "")]);
    expect(sansUnite.summary).toEqual({ plus: 3, minus: 0, unit: "" });
    expect(groupStockLinesByDay([])).toEqual([]);
  });
});

describe("période et recherche", () => {
  const noop = () => {};
  const P1 = "11111111-2222-4333-8444-555555555555";
  const products = [{ ...emptyProduct("org_test"), id: P1, name: "Carrelage 60x60", unit: "m²" }];
  const warehouses = [{ id: "w1", name: "Dépôt principal", is_default: true }];
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const mvt = (id, ago, quantity, ref, reason = "") => ({ id, organization_id: "org_test", product_id: P1, warehouse_id: "w1", kind: quantity < 0 ? "sortie" : "entree", quantity: String(quantity), moved_at: daysAgo(ago), reason, document_ref: ref, created_by: "u1", created_at: daysAgo(ago) });
  async function mount(movements) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<StockDocumentsView movements={movements} loading={false} products={products} warehouses={warehouses} account={{ organizationId: "" }} onRefresh={noop} onGoToEntry={noop} onGoToExit={noop} />); });
    return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
  }
  const refs = (c) => [...c.querySelectorAll('[data-testid="stock-line"]')].map((r) => r.dataset.kind + ":" + r.textContent.match(/(ENT|SOR)-\d{4}-\d{3}/)?.[0]);
  const period = (c) => c.querySelector('[data-testid="stock-period"]');
  const setPeriod = (c, v) => act(async () => { const el = period(c); Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("change", { bubbles: true })); });

  it("30 derniers jours par défaut ; les mouvements plus anciens n'apparaissent qu'en élargissant la période", async () => {
    const { container, unmount } = await mount([mvt("a", 2, 10, "ENT-2026-002"), mvt("b", 45, -4, "SOR-2026-001"), mvt("c", 200, 5, "ENT-2026-001")]);
    expect(period(container).value).toBe("30");
    expect(refs(container)).toEqual(["entree:ENT-2026-002"]);
    await setPeriod(container, "90");
    expect(refs(container)).toEqual(["entree:ENT-2026-002", "sortie:SOR-2026-001"]);
    await setPeriod(container, "");
    expect(refs(container)).toEqual(["entree:ENT-2026-002", "sortie:SOR-2026-001", "entree:ENT-2026-001"]);
    await unmount();
  });
  it("aucun mouvement sur 30 jours mais un historique plus ancien : bascule automatique sur « tout l'historique »", async () => {
    const { container, unmount } = await mount([mvt("c", 200, 5, "ENT-2026-001")]);
    expect(period(container).value).toBe("");
    expect(refs(container)).toEqual(["entree:ENT-2026-001"]);
    expect(container.textContent).not.toContain("Aucun");
    await unmount();
  });
  it("période choisie vide : message « Aucun mouvement pour ces filtres », pas le message d'historique vide", async () => {
    const { container, unmount } = await mount([mvt("c", 200, 5, "ENT-2026-001")]);
    await setPeriod(container, "7");
    expect(container.textContent).toContain("Aucun mouvement pour ces filtres");
    expect(refs(container)).toEqual([]);
    await unmount();
  });
  it("clic sur un numéro de document : seules ses lignes restent ; la croix efface la recherche ; le CSV n'exporte que l'affiché", async () => {
    const blobs = [];
    const origBlob = globalThis.Blob;
    globalThis.Blob = class extends origBlob { constructor(parts, opts) { super(parts, opts); blobs.push(String(parts[0])); } };
    globalThis.URL.createObjectURL = () => "blob:x";
    globalThis.URL.revokeObjectURL = () => {};
    const { container, unmount } = await mount([mvt("a", 1, 10, "ENT-2026-002", "BL 7"), mvt("b", 2, -4, "SOR-2026-001", "Chantier Dupont")]);
    expect(refs(container)).toEqual(["entree:ENT-2026-002", "sortie:SOR-2026-001"]);
    const refButton = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "SOR-2026-001");
    await act(async () => { refButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(refs(container)).toEqual(["sortie:SOR-2026-001"]);
    const csvButton = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "CSV");
    await act(async () => { csvButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(blobs.at(-1)).toContain("SOR-2026-001");
    expect(blobs.at(-1)).not.toContain("ENT-2026-002");
    await act(async () => { container.querySelector('[data-testid="stock-search-clear"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(refs(container)).toEqual(["entree:ENT-2026-002", "sortie:SOR-2026-001"]);
    globalThis.Blob = origBlob;
    await unmount();
  });
});
