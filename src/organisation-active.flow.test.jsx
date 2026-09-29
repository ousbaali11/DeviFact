// @vitest-environment jsdom
// Organisation active après actualisation (même harnais que
// app-stock-documents.flow.test.jsx : connexion simulée, base remplacée par des fixtures).
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
// Point 2 (30/09/2026) : membre invité (éditeur) dans une organisation qui
// n'est pas la sienne ; il s'y place via le sélecteur d'organisation, puis
// actualise la page (F5). Attendu : il reste dans cette organisation. Avant :
// renvoyé dans sa propre organisation (l'organisation choisie n'était pas
// mémorisée et le chargement reprenait toujours celle dont il est
// propriétaire).
// ---------------------------------------------------------------------------
import { getActiveOrganization } from "./storage-adapter.js";

const ORG2 = "9f3c8d21-6b7e-4c55-9a1d-2e4f6a8b0c13";
fixtures.organization_members = () => [
  { role: "owner", organization_id: ORG, organizations: { id: ORG, name: "Ma SARL", plan: "pro", billing_cycle: "mensuel", payment_status: "payé", activated_via_free_button: false, expires_at: null, subscription_cancelled: false, stripe_subscription_id: null, paypal_subscription_id: null } },
  { role: "editor", organization_id: ORG2, organizations: { id: ORG2, name: "Entreprise Invitante", plan: "pro", billing_cycle: "mensuel", payment_status: "payé", activated_via_free_button: false, expires_at: null, subscription_cancelled: false, stripe_subscription_id: null, paypal_subscription_id: null } },
];

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
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const buttonWith = (c, text) => [...c.querySelectorAll("button")].find((b) => b.textContent.includes(text) || b.title === text);

async function openApp() {
  const { default: App } = await import("./App.jsx");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<App />); });
  const ready = await waitFor(() => !!getActiveOrganization() && buttonWith(container, "Menu"));
  expect(ready, `application non chargée ; écran : ${container.textContent.slice(0, 300)}`).toBe(true);
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}

describe("application complète → organisation active après actualisation", () => {
  it("au premier chargement : sa propre organisation ; après passage dans l'organisation invitante puis F5 : toujours l'organisation invitante", async () => {
    localStorage.clear();
    const first = await openApp();
    expect(getActiveOrganization()).toBe(ORG);
    await click(buttonWith(first.container, "Menu"));
    const orgButton = await waitFor(() => buttonWith(first.container, "Entreprise Invitante"));
    expect(orgButton, "sélecteur d'organisation absent du menu").toBe(true);
    await click(buttonWith(first.container, "Entreprise Invitante"));
    expect(await waitFor(() => getActiveOrganization() === ORG2)).toBe(true);
    await first.unmount();
    // F5 : nouveau chargement de l'application, même navigateur (localStorage conservé).
    const second = await openApp();
    expect(await waitFor(() => getActiveOrganization() === ORG2, { timeout: 3000 }), `organisation après actualisation : ${getActiveOrganization()}`).toBe(true);
    await second.unmount();
  }, 40000);
  it("organisation mémorisée dont la personne n'est plus membre : retour à sa propre organisation, sans blocage", async () => {
    localStorage.clear();
    localStorage.setItem(`devifact_lastOrganization_${USER.id}`, "00000000-0000-4000-8000-000000000000");
    const app = await openApp();
    expect(getActiveOrganization()).toBe(ORG);
    await app.unmount();
  }, 40000);
});
