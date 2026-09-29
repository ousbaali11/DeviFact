// @vitest-environment jsdom
// Compte sans ligne de profil (même harnais que session-flow.test.jsx :
// application complète, base et authentification simulées).
import { describe, it, expect, beforeAll, vi } from "vitest";
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
    rpc: async (name) => {
      if (name === "ensure_user_has_profile") { repair.calls += 1; if (repair.fails) return { data: null, error: { message: "function public.ensure_user_has_profile() does not exist" } }; repair.missing = false; return { data: USER.id, error: null }; }
      return { data: [], error: null };
    },
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

const buttons = (c) => [...c.querySelectorAll("button")].map((b) => b.textContent.trim());
const isLanding = (c) => buttons(c).includes("Essayer gratuitement") || buttons(c).includes("Connexion");
const isDashboard = (c) => !!c.querySelector('button[title="Menu"]') && !isLanding(c);

// ---------------------------------------------------------------------------
// Profil manquant (01/10/2026) : compte présent dans auth.users sans ligne de
// profil (ligne supprimée à la main dans l'éditeur de table Supabase, ou
// création interrompue). Avant : « Ton compte est créé, mais ton espace n'est
// pas encore prêt » à chaque connexion, sans issue. Désormais la fonction
// ensure_user_has_profile recrée la ligne et le compte s'ouvre.
// ---------------------------------------------------------------------------
const PROFILE_ROW = { id: USER.id, email: USER.email, first_name: "", last_name: "", is_admin: false, company_name: "" };
const repair = { missing: false, calls: 0, fails: false };
fixtures.profiles = () => (repair.missing ? [] : [PROFILE_ROW]);

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async () => { throw new Error("réseau coupé (test)"); };
  window.scrollTo = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
});

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

describe("compte sans ligne de profil", () => {
  it("profil absent : la fonction de réparation est appelée, le profil relu, le tableau de bord s'affiche (session déjà enregistrée)", async () => {
    auth.session = { user: USER, access_token: "jeton" };
    Object.assign(repair, { missing: true, calls: 0, fails: false });
    const { container, unmount } = await openApp();
    expect(await waitFor(() => isDashboard(container))).toBe(true);
    expect(repair.calls).toBe(1);
    expect(container.textContent).not.toContain("pas encore prêt");
    await unmount();
  }, 30000);
  it("réparation impossible (script non appliqué) : pas de blocage, écran de connexion avec l'explication", async () => {
    auth.session = { user: USER, access_token: "jeton" };
    Object.assign(repair, { missing: true, calls: 0, fails: true });
    const { container, unmount } = await openApp();
    expect(await waitFor(() => isLanding(container) || container.querySelector('input[type="password"]'))).toBe(true);
    expect(isDashboard(container)).toBe(false);
    await unmount();
  }, 30000);
});
