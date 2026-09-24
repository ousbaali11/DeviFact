// @vitest-environment jsdom
// Session et connexion, application complète avec une base simulée :
//   * quelqu'un de connecté qui rouvre le site ne voit JAMAIS la page
//     d'accueil, même un instant, même si la bibliothèque d'authentification
//     envoie un événement pendant le chargement ;
//   * la connexion depuis le formulaire affiche le compte sans recharger la
//     page, que l'écouteur d'événements se manifeste ou non ;
//   * un démarrage raté (réseau) ne bloque pas la connexion suivante.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const USER = { id: "u1", email: "test@exemple.fr" };
const ORG = "252f0e0f-437c-4c98-bdde-aa2d39672dd7";
const kv = { documents: [], clients: [], "company-profile": { type: "entreprise", name: "Test SARL" } };
// Comportement simulé : session enregistrée ou non, délai/échec du profil,
// écouteur capturé pour pouvoir émettre des événements comme la vraie
// bibliothèque, et si signInWithPassword émet lui-même SIGNED_IN.
const auth = { session: null, listener: null, profileDelayMs: 0, profileFailures: 0, emitOnSignIn: true, signInCalls: 0 };
const fixtures = {
  profiles: () => [{ id: USER.id, email: USER.email, first_name: "Thomas", last_name: "T", is_admin: false, company_name: "" }],
  organization_members: () => [{ role: "owner", organization_id: ORG, organizations: { id: ORG, name: "Test SARL", plan: "pro", billing_cycle: "mensuel", payment_status: "payé", activated_via_free_button: false, expires_at: null, subscription_cancelled: false, stripe_subscription_id: null, paypal_subscription_id: null, stripe_customer_id: null, paid_at: null, price_at_activation: null } }],
  kv_store: (f) => (f.key in kv ? [{ value: kv[f.key] }] : []),
  site_settings: () => [{ id: 1, name: "Chantiflow", landing_page_version: "classique", theme: "classique" }],
};
function builder(table) {
  const filters = {};
  const b = {};
  ["select", "insert", "update", "upsert", "delete", "order", "limit", "range", "in", "neq", "gt", "lt", "gte", "lte", "is", "like", "ilike", "or", "not", "match", "contains"].forEach((m) => { b[m] = () => b; });
  b.eq = (col, val) => { filters[col] = val; return b; };
  const result = async () => {
    if (table === "profiles") {
      if (auth.profileDelayMs) await new Promise((r) => setTimeout(r, auth.profileDelayMs));
      if (auth.profileFailures > 0) { auth.profileFailures -= 1; throw new Error("réseau indisponible (test)"); }
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
const emit = (event, session) => auth.listener && auth.listener(event, session);
vi.mock("./client.js", () => ({
  db: {
    from: (table) => builder(table),
    rpc: async () => ({ data: [], error: null }),
    functions: { invoke: async () => ({ data: { added: 0 }, error: null }) },
    auth: {
      getSession: async () => ({ data: { session: auth.session } }),
      getUser: async () => ({ data: { user: auth.session?.user || null } }),
      onAuthStateChange: (cb) => { auth.listener = cb; return { data: { subscription: { unsubscribe() { if (auth.listener === cb) auth.listener = null; } } } }; },
      signInWithPassword: async () => {
        auth.signInCalls += 1;
        auth.session = { user: USER, access_token: "jeton" };
        if (auth.emitOnSignIn) await emit("SIGNED_IN", auth.session);
        return { data: { user: USER, session: auth.session }, error: null };
      },
      signOut: async () => { auth.session = null; await emit("SIGNED_OUT", null); return { error: null }; },
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
beforeEach(() => {
  localStorage.clear(); document.body.className = "";
  Object.assign(auth, { session: null, listener: null, profileDelayMs: 0, profileFailures: 0, emitOnSignIn: true, signInCalls: 0 });
  localStorage.setItem("devifact_site_settings", JSON.stringify({ landingPageVersion: "classique", theme: "classique", name: "Chantiflow" }));
  localStorage.setItem("devifact_lastView", "dashboard");
});

const buttons = (c) => [...c.querySelectorAll("button")].map((b) => b.textContent.trim());
const isLanding = (c) => buttons(c).includes("Essayer gratuitement") || buttons(c).includes("Connexion");
const isDashboard = (c) => !!c.querySelector('button[title="Menu"]') && !isLanding(c);
const isSpinnerOnly = (c) => !!c.querySelector(".animate-spin") && c.querySelectorAll("button").length === 0;
async function waitFor(check, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (check()) return true; await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); }
  return false;
}
async function openApp() {
  vi.resetModules();
  const { default: App } = await import("./App.jsx");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<App />); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
function setValue(input, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
async function logIn(container) {
  const connexion = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Connexion");
  await click(connexion);
  const inputs = [...container.querySelectorAll("input")];
  await act(async () => { setValue(inputs.find((i) => i.getAttribute("autocomplete") === "email"), USER.email); });
  await act(async () => { setValue(inputs.find((i) => i.type === "password"), "mot-de-passe-long"); });
  const submit = [...container.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Se connecter"));
  await click(submit);
}

describe("réouverture du site par quelqu'un de connecté", () => {
  it("chargement lent du profil et événement SIGNED_IN pendant ce temps : écran d'attente puis tableau de bord, jamais la page d'accueil", async () => {
    auth.session = { user: USER, access_token: "jeton" };
    auth.profileDelayMs = 300;
    const { container, unmount } = await openApp();
    expect(isSpinnerOnly(container)).toBe(true);
    // Comme la vraie bibliothèque dans un nouvel onglet : SIGNED_IN émis
    // pour la session retrouvée, alors que le profil n'est pas encore là.
    await act(async () => { await emit("SIGNED_IN", auth.session); await new Promise((r) => setTimeout(r, 20)); });
    let landingSeen = false;
    const ok = await waitFor(() => { if (isLanding(container)) landingSeen = true; return isDashboard(container); });
    expect(ok).toBe(true);
    expect(landingSeen).toBe(false);
    // Rafraîchissement de jeton ensuite : rien ne bouge.
    await act(async () => { await emit("TOKEN_REFRESHED", auth.session); await new Promise((r) => setTimeout(r, 20)); });
    expect(isDashboard(container)).toBe(true);
    await unmount();
  }, 30000);
});

describe("connexion depuis le formulaire", () => {
  it("l'écouteur émet SIGNED_IN : tableau de bord affiché sans recharger, un seul chargement", async () => {
    const { container, unmount } = await openApp();
    expect(await waitFor(() => isLanding(container))).toBe(true);
    await logIn(container);
    expect(await waitFor(() => isDashboard(container))).toBe(true);
    expect(auth.signInCalls).toBe(1);
    await unmount();
  }, 30000);
  it("l'écouteur ne se manifeste pas : le compte est chargé quand même, tout de suite", async () => {
    auth.emitOnSignIn = false;
    const { container, unmount } = await openApp();
    expect(await waitFor(() => isLanding(container))).toBe(true);
    await logIn(container);
    expect(await waitFor(() => isDashboard(container))).toBe(true);
    await unmount();
  }, 30000);
  it("démarrage raté (profil injoignable) puis connexion : le compte s'affiche sans recharger la page", async () => {
    auth.session = { user: USER, access_token: "jeton" };
    auth.profileFailures = 1; // premier essai en échec, les suivants réussissent
    const { container, unmount } = await openApp();
    expect(await waitFor(() => isLanding(container))).toBe(true);
    await logIn(container);
    expect(await waitFor(() => isDashboard(container))).toBe(true);
    await unmount();
  }, 30000);
  it("compte impossible à charger après la connexion : message clair, formulaire de nouveau utilisable", async () => {
    const { container, unmount } = await openApp();
    expect(await waitFor(() => isLanding(container))).toBe(true);
    auth.profileFailures = 5;
    await logIn(container);
    expect(await waitFor(() => container.textContent.includes("impossible de charger ton espace"))).toBe(true);
    const submit = [...container.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Se connecter"));
    expect(submit).toBeTruthy();
    expect(submit.disabled).toBe(false);
    await unmount();
  }, 30000);
});
