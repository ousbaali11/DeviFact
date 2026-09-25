// @vitest-environment jsdom
// Super PDP, étape 1 — carte « Connecter mon compte Super PDP » de Mon
// entreprise : propriétaire seulement, entreprise en France seulement ;
// démarrage (redirection vers l'adresse renvoyée par le serveur), retour
// d'autorisation (?superpdp=retour&code&state → callback), refus, état
// connecté avec badge Bac à sable, déconnexion.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const calls = [];
const state = { status: { configured: true, connected: false }, callback: null };
vi.mock("./client.js", () => ({
  db: {
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    functions: { invoke: async (name, opts) => {
      calls.push({ name, body: opts?.body });
      const action = opts?.body?.action;
      if (action === "status") return { data: state.status, error: null };
      if (action === "start") return { data: { url: "https://api.superpdp.tech/oauth2/authorize?state=st" }, error: null };
      if (action === "callback") return state.callback?.error ? { data: { error: state.callback.error }, error: null } : { data: state.callback, error: null };
      if (action === "disconnect") return { data: { configured: true, connected: false }, error: null };
      return { data: { error: "?" }, error: null };
    } },
    rpc: async () => ({ data: [], error: null }),
    from: () => ({ update: () => ({ eq: async () => ({ data: [], error: null }) }) }),
  },
}));
import { SuperPdpCard, CompanyView, emptyCompanyProfile } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });
beforeEach(() => { calls.length = 0; state.status = { configured: true, connected: false }; state.callback = null; window.history.replaceState({}, "", "/"); });

const owner = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@exemple.fr", memberships: [] };
const noop = () => {};
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const button = (c, text) => [...c.querySelectorAll("button")].find((b) => b.textContent.includes(text));
const connected = { configured: true, connected: true, env: "sandbox", companyName: "Burger Queen", companyNumber: "315143296_001", companyNumberScheme: "sandbox", vatRegime: "monthly", verificationStatus: "verified", connectedAt: "2026-09-26T10:00:00Z", lastError: null };

describe("carte Super PDP", () => {
  it("non connecté : bouton de connexion, démarrage → redirection vers l'adresse du serveur", async () => {
    const redirects = [];
    const { container, unmount } = await mount(<SuperPdpCard account={owner} profile={{ ...emptyCompanyProfile(), siret: "853 322 915 00012" }} onRedirect={(u) => redirects.push(u)} />);
    expect(container.textContent).toContain("Connecter mon compte Super PDP");
    expect(container.textContent).toContain("et ton SIREN");
    await click(button(container, "Connecter mon compte Super PDP"));
    expect(calls.map((c) => c.body.action)).toEqual(["status", "start"]);
    expect(calls[1].body.organizationId).toBe("org");
    expect(redirects).toEqual(["https://api.superpdp.tech/oauth2/authorize?state=st"]);
    await unmount();
  }, 30000);
  it("retour d'autorisation : callback avec code et état, adresse nettoyée, badge Bac à sable, déconnexion", async () => {
    window.history.replaceState({}, "", "/?superpdp=retour&code=abc&state=st&onglet=x");
    state.callback = connected;
    const { container, unmount } = await mount(<SuperPdpCard account={owner} profile={emptyCompanyProfile()} />);
    expect(calls[0].body).toMatchObject({ action: "callback", code: "abc", state: "st", organizationId: "org" });
    expect(window.location.search).toBe("?onglet=x");
    expect(container.textContent).toContain("Compte Super PDP connecté");
    expect(container.textContent).toContain("Burger Queen");
    expect(container.querySelector('[data-testid="superpdp-env"]').textContent).toBe("Bac à sable");
    expect(container.textContent).not.toMatch(/token/i);
    window.confirm = () => true;
    await click(button(container, "Déconnecter"));
    expect(calls.at(-1).body.action).toBe("disconnect");
    expect(container.textContent).toContain("Connecter mon compte Super PDP");
    await unmount();
  }, 30000);
  it("retour refusé ou refus serveur (production) : message, retour à l'état non connecté", async () => {
    window.history.replaceState({}, "", "/?superpdp=retour&error=access_denied&state=st");
    const a = await mount(<SuperPdpCard account={owner} profile={emptyCompanyProfile()} />);
    expect(a.container.textContent).toContain("Connexion annulée chez Super PDP.");
    expect(calls.some((c) => c.body.action === "callback")).toBe(false);
    expect(a.container.textContent).toContain("Connecter mon compte Super PDP");
    await a.unmount();
    calls.length = 0;
    window.history.replaceState({}, "", "/?superpdp=retour&code=abc&state=st");
    state.callback = { error: "Ce compte Super PDP est en production. Chantiflow n'accepte pour l'instant que des entreprises en bac à sable (Burger Queen, Tricatel) : connexion refusée, aucun jeton conservé." };
    const b = await mount(<SuperPdpCard account={owner} profile={emptyCompanyProfile()} />);
    expect(b.container.textContent).toContain("en production");
    expect(b.container.textContent).toContain("Connecter mon compte Super PDP");
    await b.unmount();
  }, 30000);
  it("non configuré côté serveur : message ; éditeur : rien", async () => {
    state.status = { configured: false, connected: false };
    const a = await mount(<SuperPdpCard account={owner} profile={emptyCompanyProfile()} />);
    expect(a.container.textContent).toContain("pas encore activée par l'administrateur");
    await a.unmount();
    const b = await mount(<SuperPdpCard account={{ ...owner, role: "editor" }} profile={emptyCompanyProfile()} />);
    expect(b.container.querySelector('[data-testid="superpdp-card"]')).toBeNull();
    await b.unmount();
  }, 30000);
});

describe("Mon entreprise", () => {
  const render = (country) => mount(<CompanyView profile={{ ...emptyCompanyProfile(), name: "Bâti Plus", country }} saving={false} onSave={noop} onReset={noop} documentCount={0} clientCount={0} account={owner} isLocked={false} isViewer={false} onGoToPricing={noop} />);
  it("carte présente pour une entreprise en France, absente pour le Maroc ou sans pays", async () => {
    const fr = await render("🇫🇷 FR");
    expect(fr.container.querySelector('[data-testid="superpdp-card"]')).toBeTruthy();
    await fr.unmount();
    for (const c of ["🇲🇦 MA", ""]) {
      const other = await render(c);
      expect(other.container.querySelector('[data-testid="superpdp-card"]')).toBeNull();
      await other.unmount();
    }
  }, 30000);
});
