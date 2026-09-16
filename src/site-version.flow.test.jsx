// @vitest-environment jsdom
// Version d'interface au démarrage : jamais une autre version que celle
// configurée, même un instant, même si le serveur ne répond pas au premier
// essai. Application complète avec une base simulée.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const USER = { id: "u1", email: "test@exemple.fr" };
const ORG = "252f0e0f-437c-4c98-bdde-aa2d39672dd7";
// Comportement simulé de la table site_settings : liste de réponses
// successives ("fail" ou "ok"), avec un délai optionnel.
const state = { responses: ["ok"], delayMs: 0, calls: 0 };
const kv = { documents: [], clients: [], "company-profile": { type: "entreprise", name: "Test SARL" } };
const fixtures = {
  profiles: () => [{ id: USER.id, email: USER.email, first_name: "Thomas", last_name: "T", is_admin: false, company_name: "" }],
  organization_members: () => [{ role: "owner", organization_id: ORG, organizations: { id: ORG, name: "Test SARL", plan: "pro", billing_cycle: "mensuel", payment_status: "payé", activated_via_free_button: false, expires_at: null, subscription_cancelled: false } }],
  kv_store: (f) => (f.key in kv ? [{ value: kv[f.key] }] : []),
};
function builder(table) {
  const filters = {};
  const b = {};
  ["select", "insert", "update", "upsert", "delete", "order", "limit", "range", "in", "neq", "gt", "lt", "gte", "lte", "is", "like", "ilike", "or", "not", "match", "contains"].forEach((m) => { b[m] = () => b; });
  b.eq = (col, val) => { filters[col] = val; return b; };
  const result = async () => {
    if (table === "site_settings") {
      const mode = state.responses[Math.min(state.calls, state.responses.length - 1)];
      state.calls += 1;
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      if (mode === "fail") return { data: null, error: { message: "réseau indisponible (test)" } };
      return { data: [{ id: 1, name: "Chantiflow", landing_page_version: "atelier", theme: "classique" }], error: null };
    }
    const rows = fixtures[table] ? fixtures[table](filters) : [];
    return { data: rows, error: null, count: rows.length };
  };
  b.then = (res, rej) => result().then(res, rej);
  b.maybeSingle = async () => { const r = await result(); return { data: r.data?.[0] ?? null, error: r.error }; };
  b.single = b.maybeSingle;
  return b;
}
const noopChannel = { on() { return noopChannel; }, subscribe() { return noopChannel; }, unsubscribe() {} };
vi.mock("./client.js", () => ({
  db: {
    from: (table) => builder(table),
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: { user: USER } } }), getUser: async () => ({ data: { user: USER } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) },
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
beforeEach(() => { localStorage.clear(); document.body.className = ""; state.calls = 0; state.delayMs = 0; state.responses = ["ok"]; localStorage.setItem("devifact_lastView", "dashboard"); });

const isAtelierShown = (c) => document.body.classList.contains("df-atelier") && !!c.querySelector('button[title="Menu"]');
const isClassicShown = (c) => [...c.querySelectorAll("button")].some((b) => b.textContent.trim() === "Tableau de bord") && !document.body.classList.contains("df-atelier");
const isSpinnerOnly = (c) => !!c.querySelector(".animate-spin") && c.querySelectorAll("button").length === 0;
async function waitFor(check, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (check()) return true; await act(async () => { await new Promise((r) => setTimeout(r, 50)); }); }
  return false;
}
async function openApp() {
  vi.resetModules(); // ré-exécute le code de démarrage du module (lecture du cache)
  const { default: App } = await import("./App.jsx");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<App />); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}

describe("démarrage dans la bonne version", () => {
  it("première visite, réponse lente : uniquement l'écran de chargement jusqu'à la réponse, puis Atelier, et la version est mémorisée", async () => {
    state.delayMs = 400;
    const { container, unmount } = await openApp();
    expect(isSpinnerOnly(container)).toBe(true);
    expect(isClassicShown(container)).toBe(false);
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(isSpinnerOnly(container)).toBe(true); // toujours rien d'autre que le chargement
    expect(await waitFor(() => isAtelierShown(container))).toBe(true);
    expect(JSON.parse(localStorage.getItem("devifact_site_settings")).landingPageVersion).toBe("atelier");
    await unmount();
  }, 30000);
  it("version mémorisée « atelier » et serveur qui ne répond pas : Atelier dès le premier rendu, jamais Classique", async () => {
    localStorage.setItem("devifact_site_settings", JSON.stringify({ landingPageVersion: "atelier", theme: "classique", name: "Chantiflow" }));
    state.responses = ["fail", "fail", "fail"];
    const { container, unmount } = await openApp();
    expect(document.body.classList.contains("df-atelier")).toBe(true); // avant même la réponse du serveur
    expect(isClassicShown(container)).toBe(false);
    expect(await waitFor(() => isAtelierShown(container))).toBe(true);
    expect(isClassicShown(container)).toBe(false);
    expect(state.calls).toBe(3); // trois tentatives
    await unmount();
  }, 30000);
  it("premier essai en échec puis réponse : Atelier, sans passage par une autre version", async () => {
    state.responses = ["fail", "ok"];
    const { container, unmount } = await openApp();
    let classicSeen = false;
    const ok = await waitFor(() => { if (isClassicShown(container)) classicSeen = true; return isAtelierShown(container); });
    expect(ok).toBe(true);
    expect(classicSeen).toBe(false);
    expect(state.calls).toBe(2);
    await unmount();
  }, 30000);
});
