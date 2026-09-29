// @vitest-environment jsdom
// Inscription puis connexion immédiate (même harnais que session-flow.test.jsx :
// application complète, base et authentification simulées).
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
  site_settings: () => [{ id: 1, name: "Chantiflow" }],
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
      signUp: async () => {
        auth.signUpCalls = (auth.signUpCalls || 0) + 1;
        auth.session = { user: USER, access_token: "jeton" };
        if (auth.emitOnSignIn) await emit("SIGNED_IN", auth.session);
        return { data: { user: { ...USER, identities: [{ id: "i" }] }, session: auth.session }, error: null };
      },
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
  Object.assign(auth, { session: null, listener: null, profileDelayMs: 0, profileFailures: 0, emitOnSignIn: true, signInCalls: 0, signUpCalls: 0, profileMissing: 0 });
  localStorage.setItem("devifact_site_settings", JSON.stringify({ name: "Chantiflow" }));
  localStorage.setItem("devifact_lastView", "dashboard");
});

const buttons = (c) => [...c.querySelectorAll("button")].map((b) => b.textContent.trim());
const isLanding = (c) => buttons(c).includes("Essayer gratuitement") || buttons(c).includes("Connexion");
const isDashboard = (c) => !!c.querySelector('button[title="Menu"]') && !isLanding(c);
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


// ---------------------------------------------------------------------------
// Bug du 30/09/2026 : compte créé, puis connexion immédiate impossible sans
// actualiser la page. Cause : juste après l'inscription, la première lecture
// du profil peut revenir vide (ligne pas encore visible) ; le chargement
// marquait quand même la personne comme « chargée » sans compte affiché, et
// toute connexion suivante (formulaire ou événement SIGNED_IN) était ignorée
// comme « même personne ». Attendu : le profil est relu quelques instants
// plus tard ; et si le compte n'a pas pu être affiché, une connexion depuis
// le formulaire l'ouvre sans actualiser.
// ---------------------------------------------------------------------------
const PROFILE_ROW = { id: USER.id, email: USER.email, first_name: "", last_name: "", is_admin: false, company_name: "" };
fixtures.profiles = () => { if (auth.profileMissing > 0) { auth.profileMissing -= 1; return []; } return [PROFILE_ROW]; };
const buttonWith = (c, text) => [...c.querySelectorAll("button")].find((b) => b.textContent.includes(text));
const isAuthScreen = (c) => !!c.querySelector('input[type="password"]');

async function signUp(container) {
  await click(buttonWith(container, "Créer mon compte"));
  expect(await waitFor(() => isAuthScreen(container))).toBe(true);
  const inputs = [...container.querySelectorAll("input")];
  await act(async () => { setValue(inputs.find((i) => i.getAttribute("autocomplete") === "email"), USER.email); });
  await act(async () => { setValue(inputs.find((i) => i.type === "password"), "motdepasse-solide-12"); });
  const countryButtons = () => [...container.querySelectorAll('[data-testid="signup-country"] button')];
  await click(countryButtons().find((b) => b.textContent.includes("Choisir le pays")));
  await click(countryButtons().find((b) => b.textContent.trim() === "🇫🇷 FR"));
  await click([...container.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Créer mon compte")));
}
async function logInFromForm(container) {
  const inputs = [...container.querySelectorAll("input")];
  await act(async () => { setValue(inputs.find((i) => i.getAttribute("autocomplete") === "email"), USER.email); });
  await act(async () => { setValue(inputs.find((i) => i.type === "password"), "motdepasse-solide-12"); });
  await click([...container.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Se connecter")));
}

describe("inscription puis connexion immédiate", () => {
  it("profil pas encore visible à la première lecture : relu quelques instants plus tard, le compte s'ouvre directement après l'inscription", async () => {
    auth.profileMissing = 1;
    const { container, unmount } = await openApp();
    expect(await waitFor(() => isLanding(container))).toBe(true);
    await signUp(container);
    expect(await waitFor(() => isDashboard(container), 8000), "tableau de bord attendu après l'inscription").toBe(true);
    expect(auth.signUpCalls).toBe(1);
    await unmount();
  }, 40000);
  it("compte non affiché après l'inscription (profil durablement illisible) : « Se connecter » ouvre le compte sans actualiser la page", async () => {
    auth.profileMissing = 20; // au-delà des relectures (et de la réparation du profil) : le premier chargement n'affiche pas le compte
    const { container, unmount } = await openApp();
    expect(await waitFor(() => isLanding(container))).toBe(true);
    await signUp(container);
    const freed = await waitFor(() => isAuthScreen(container) && container.textContent.includes("pas encore prêt") && !![...container.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Se connecter") && !b.disabled), 8000);
    expect(freed, "formulaire de connexion libéré avec une explication").toBe(true);
    expect(isDashboard(container)).toBe(false);
    auth.profileMissing = 0; // le profil est maintenant lisible (comme après quelques secondes en vrai)
    await logInFromForm(container);
    expect(await waitFor(() => isDashboard(container), 8000), "le compte doit s'ouvrir depuis le formulaire, sans actualiser").toBe(true);
    expect(auth.signInCalls).toBe(1);
    await unmount();
  }, 40000);
});
