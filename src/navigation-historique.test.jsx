// @vitest-environment jsdom
// Flèches arrière / avant du navigateur (29/09/2026) sur l'application
// complète (connexion simulée, base remplacée par des fixtures — même harnais
// que app-stock-documents.flow.test.jsx).
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
  site_settings: () => [{ id: 1, name: "Chantiflow" }],
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


// ---------------------------------------------------------------------------
// Flèches arrière / avant du navigateur (29/09/2026) : une entrée d'historique
// par page visitée ; le retour et l'avance remettent la page (et le document)
// sans rien rajouter ; document supprimé → tableau de bord.
// ---------------------------------------------------------------------------
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async () => { throw new Error("réseau coupé (test)"); };
  window.scrollTo = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
});

const DOC_ID = "doc_nav_1";
async function waitFor(check, { timeout = 8000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (check()) return true;
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  }
  return false;
}
// Page affichée par l'application, telle qu'elle la mémorise elle-même
// (devifact_lastView absent = tableau de bord).
const currentView = () => localStorage.getItem("devifact_lastView") || "dashboard";
const currentDoc = () => localStorage.getItem("devifact_lastActiveId");
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const navButton = (c, label) => [...c.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
const back = () => act(async () => { window.history.back(); await new Promise((r) => setTimeout(r, 60)); });
const forward = () => act(async () => { window.history.forward(); await new Promise((r) => setTimeout(r, 60)); });

async function openApp() {
  localStorage.removeItem("devifact_lastView");
  localStorage.removeItem("devifact_lastActiveId");
  const { default: App, newDocument } = await import("./App.jsx");
  kv.documents = [{ ...newDocument("facture", []), id: DOC_ID, docNumber: "FAC-777", status: "envoyée", issueDate: "2026-09-29", client: { ...newDocument("facture", []).client, name: "Client Navigation" }, createdAt: 1, updatedAt: 1 }];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<App />); });
  const ready = await waitFor(() => navButton(container, "Clients") && navButton(container, "Chantiers"));
  expect(ready, `menu absent ; écran : ${container.textContent.slice(0, 300)}`).toBe(true);
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}

describe("application complète → flèches du navigateur", () => {
  it("pages visitées : arrière deux fois puis avant, chaque étape remet la bonne page sans entrée en plus", async () => {
    const { container, unmount } = await openApp();
    const startLength = window.history.length;
    expect(window.history.state?.chantiflow).toBe(true);
    expect(window.history.state.view).toBe("dashboard");
    await click(navButton(container, "Clients"));
    expect(await waitFor(() => currentView() === "clients")).toBe(true);
    expect(window.history.state.view).toBe("clients");
    await click(navButton(container, "Chantiers"));
    expect(await waitFor(() => currentView() === "chantiers")).toBe(true);
    expect(window.history.length).toBe(startLength + 2);
    await back();
    expect(await waitFor(() => currentView() === "clients")).toBe(true);
    await back();
    expect(await waitFor(() => currentView() === "dashboard")).toBe(true);
    await forward();
    expect(await waitFor(() => currentView() === "clients")).toBe(true);
    expect(window.history.length).toBe(startLength + 2); // retours et avances : aucune entrée ajoutée
    await unmount();
  }, 30000);
  it("document ouvert : la flèche arrière revient à la liste, la flèche avant rouvre le document ; document supprimé → tableau de bord", async () => {
    const { container, unmount } = await openApp();
    await click(navButton(container, "Documents"));
    expect(await waitFor(() => currentView() === "atelier-documents" && container.textContent.includes("FAC-777"))).toBe(true);
    const row = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("FAC-777"));
    expect(row).toBeTruthy();
    await click(row);
    expect(await waitFor(() => currentView() === "editor" && currentDoc() === DOC_ID)).toBe(true);
    expect(window.history.state).toMatchObject({ view: "editor", activeId: DOC_ID });
    await back();
    expect(await waitFor(() => currentView() === "atelier-documents" && !currentDoc())).toBe(true);
    await forward();
    expect(await waitFor(() => currentView() === "editor" && currentDoc() === DOC_ID)).toBe(true);
    // Entrée vers un document qui n'existe plus, puis retour dessus : tableau de bord.
    await act(async () => { window.history.pushState({ chantiflow: true, view: "editor", activeId: "doc_supprime" }, "", window.location.href); window.history.pushState({ chantiflow: true, view: "clients", activeId: null }, "", window.location.href); });
    await back();
    expect(await waitFor(() => currentView() === "dashboard" && !currentDoc())).toBe(true);
    await unmount();
  }, 30000);
});
