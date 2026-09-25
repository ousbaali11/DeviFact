// @vitest-environment jsdom
// Reproduction de bout en bout du scénario signalé : application complète
// (connexion simulée, chargement des données, navigation restaurée sur
// « Documents de stock ») avec une base Supabase remplacée par des
// fixtures. Le document doit apparaître avec ses lignes (produits,
// quantités) visibles sans aucun clic ; un clic replie le détail.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const USER = { id: "u1", email: "test@exemple.fr" };
const ORG = "252f0e0f-437c-4c98-bdde-aa2d39672dd7";
const P1 = "11111111-2222-4333-8444-555555555555";
const P2 = "22222222-2222-4333-8444-555555555555";

const kv = {
  documents: [],
  clients: [],
  "company-profile": { type: "entreprise", name: "Test SARL", fiscalStartMonth: 1 },
};
const fixtures = {
  profiles: () => [{ id: USER.id, email: USER.email, first_name: "Test", last_name: "T", is_admin: false, company_name: "" }],
  organization_members: () => [{ role: "owner", organization_id: ORG, organizations: { id: ORG, name: "Test SARL", plan: "pro", billing_cycle: "mensuel", payment_status: "payé", activated_via_free_button: false, expires_at: null, subscription_cancelled: false } }],
  site_settings: () => [{ id: 1, name: "Chantiflow", theme: "classique" }],
  kv_store: (f) => (f.key in kv ? [{ value: kv[f.key] }] : []),
  products: () => [
    { id: P1, organization_id: ORG, name: "Carrelage 60x60", reference: "CAR-60", unit: "m²", kind: "produit", is_active: true, quantity_restricted: false, sale_price_ht: 25, sale_vat_rate: 20, sale_price_ttc: 30, purchase_price_ht: 10, purchase_vat_rate: 20, tags: [] },
    { id: P2, organization_id: ORG, name: "Colle", reference: "COL", unit: "sac", kind: "produit", is_active: true, quantity_restricted: false, sale_price_ht: 8, sale_vat_rate: 20, sale_price_ttc: 9.6, purchase_price_ht: 4, purchase_vat_rate: 20, tags: [] },
  ],
  product_stock: () => [{ product_id: P1, warehouse_id: "w1", quantity: "10.000" }, { product_id: P2, warehouse_id: "w1", quantity: "3.000" }],
  warehouses: () => [{ id: "w1", organization_id: ORG, name: "Dépôt principal", address: "", is_default: true }],
  stock_movements: () => [
    { id: "m1", organization_id: ORG, product_id: P1, warehouse_id: "w1", kind: "entree", quantity: "10.000", moved_at: "2026-09-13T08:00:00+00:00", reason: "BL 42", document_ref: "ENT-2026-001", created_by: USER.id, created_at: "2026-09-13T08:00:00+00:00" },
    { id: "m2", organization_id: ORG, product_id: P2, warehouse_id: "w1", kind: "entree", quantity: "3.000", moved_at: "2026-09-13T08:00:00+00:00", reason: "BL 42", document_ref: "ENT-2026-001", created_by: USER.id, created_at: "2026-09-13T08:00:00+00:00" },
  ],
};

function builder(table) {
  const filters = {};
  const b = {};
  ["select", "insert", "update", "upsert", "delete", "order", "limit", "range", "in", "neq", "gt", "lt", "gte", "lte", "is", "like", "ilike", "or", "not", "match", "contains"].forEach((m) => { b[m] = () => b; });
  b.eq = (col, val) => { filters[col] = val; return b; };
  const result = () => { const rows = fixtures[table] ? fixtures[table](filters) : []; return { data: rows, error: null, count: rows.length }; };
  b.then = (res, rej) => Promise.resolve(result()).then(res, rej);
  b.maybeSingle = async () => ({ data: result().data[0] ?? null, error: null });
  b.single = b.maybeSingle;
  return b;
}
const noopChannel = { on() { return noopChannel; }, subscribe() { return noopChannel; }, unsubscribe() {} };
vi.mock("./client.js", () => ({
  db: {
    from: (table) => builder(table),
    rpc: async () => ({ data: [], error: null }),
    auth: {
      getSession: async () => ({ data: { session: { user: USER } } }),
      getUser: async () => ({ data: { user: USER } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }), remove: async () => ({ error: null }), upload: async () => ({ error: null }) }) },
    channel: () => noopChannel,
    removeChannel() {},
  },
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async () => { throw new Error("réseau coupé (test)"); };
  window.scrollTo = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
});

async function waitFor(check, { timeout = 8000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (check()) return true;
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  }
  return false;
}

async function openApp() {
  localStorage.setItem("devifact_lastView", "stock-documents");
  const { default: App } = await import("./App.jsx");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<App />); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}

describe("application complète → Documents de stock", () => {
  {
    it("le document est listé avec ses lignes visibles, un clic les replie", async () => {
      const { container, unmount } = await openApp();
      const listed = await waitFor(() => container.textContent.includes("ENT-2026-001"));
      expect(listed, `document non listé ; écran : ${container.textContent.slice(0, 400)}`).toBe(true);
      // Détail visible sans clic (c'était le bug : replié derrière un chevron)
      expect(container.textContent, `détail absent à l'ouverture ; écran : ${container.textContent.slice(0, 600)}`).toContain("Carrelage 60x60");
      expect(container.textContent).toContain("Colle");
      expect(container.textContent).toContain("+10 m²");
      expect(container.textContent).toContain("+3 sac");
      // Un clic sur l'en-tête replie, un second rouvre
      const row = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("ENT-2026-001"));
      expect(row).toBeTruthy();
      await act(async () => { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(container.textContent).not.toContain("Colle");
      await act(async () => { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(container.textContent).toContain("Colle");
      await unmount();
    }, 30000); // l'application complète met plusieurs secondes à se charger quand toute la suite tourne en parallèle
  }
});
