// @vitest-environment jsdom
// Stripe Connect, livraison 1 : carte « Connecter mon compte bancaire »
// dans Mon entreprise — états (non connecté, à terminer, actif, erreur),
// démarrage de l'inscription, retour de Stripe, réservé au propriétaire.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const calls = [];
const state = { status: { connected: false }, startUrl: "https://connect.stripe.com/setup/s/test", fail: null };
vi.mock("./client.js", () => ({
  db: {
    functions: {
      invoke: async (name, opts) => {
        calls.push({ name, body: opts?.body, auth: opts?.headers?.Authorization });
        if (state.fail) return { data: { error: state.fail }, error: null };
        if (opts?.body?.action === "status") return { data: state.status, error: null };
        if (opts?.body?.action === "start") return { data: { url: state.startUrl }, error: null };
        if (opts?.body?.action === "reset") return { data: { connected: false, reset: true }, error: null };
        return { data: { error: "action inconnue" }, error: null };
      },
    },
    auth: { getSession: async () => ({ data: { session: { access_token: "jeton" } } }) },
    rpc: async () => ({ data: [], error: null }),
  },
}));
import { StripeConnectCard, CompanyView, SiteIdentitySettings, emptyCompanyProfile } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });
beforeEach(() => { calls.length = 0; state.status = { connected: false }; state.fail = null; window.history.replaceState({}, "", "/"); });

const owner = { id: "u1", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "patron@exemple.fr", memberships: [] };
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const buttonByText = (c, text) => [...c.querySelectorAll("button")].find((b) => b.textContent.trim() === text);

describe("carte Connecter mon compte bancaire", () => {
  it("non connecté : explication, frais, bouton « Connecter mon compte de paiement » ; état demandé au serveur avec le jeton ; le nom du prestataire n'apparaît jamais", async () => {
    const { container, unmount } = await mount(<StripeConnectCard account={owner} />);
    const text = container.textContent;
    expect(text).toContain("Connecter mon compte bancaire");
    expect(text).toContain("il ne te reste que la date de naissance, l'acceptation de ses conditions");
    expect(text).not.toMatch(/stripe/i);
    expect(text).toContain("Aucune commission de la plateforme.");
    expect(text).toContain("le bouton « Payer en ligne » apparaît sur la page de tes factures");
    expect(buttonByText(container, "Connecter mon compte de paiement")).toBeTruthy();
    expect(calls).toEqual([{ name: "connect-onboarding", body: { organizationId: "org", action: "status" }, auth: "Bearer jeton" }]);
    await unmount();
  }, 30000);
  it("clic sur Connecter : action start, puis redirection vers le lien Stripe", async () => {
    const redirects = [];
    const { container, unmount } = await mount(<StripeConnectCard account={owner} onRedirect={(u) => redirects.push(u)} />);
    await click(buttonByText(container, "Connecter mon compte de paiement"));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(calls.at(-1)).toMatchObject({ body: { organizationId: "org", action: "start" } });
    expect(redirects).toEqual(["https://connect.stripe.com/setup/s/test"]);
    await unmount();
  }, 30000);
  it("configuration à terminer : badge orange, informations attendues, bouton Reprendre ; jamais de bouton Connecter", async () => {
    state.status = { connected: true, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, requirementsDue: 3, disabledReason: "requirements.past_due" };
    const { container, unmount } = await mount(<StripeConnectCard account={owner} />);
    const text = container.textContent;
    expect(text).toContain("Configuration à terminer auprès du prestataire de paiement");
    expect(text).toContain("3 informations attendues par le prestataire de paiement.");
    expect(text).toContain("Le prestataire de paiement attend des informations ou une vérification.");
    expect(text).not.toMatch(/stripe/i);
    expect(buttonByText(container, "Reprendre la configuration")).toBeTruthy();
    expect(buttonByText(container, "Connecter mon compte de paiement")).toBeUndefined();
    expect(container.querySelector('a[href="https://dashboard.stripe.com"]')).toBeTruthy();
    await unmount();
  }, 30000);
  it("paiements actifs mais virements en attente : badge dédié et bouton Reprendre", async () => {
    state.status = { connected: true, chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true, requirementsDue: 1, disabledReason: null };
    const { container, unmount } = await mount(<StripeConnectCard account={owner} />);
    expect(container.textContent).toContain("Paiements actifs, virements en attente");
    expect(buttonByText(container, "Reprendre la configuration")).toBeTruthy();
    await unmount();
  }, 30000);
  it("compte actif : badge vert, tableau de bord, Actualiser (nouvelle lecture de l'état), pas de bouton Reprendre", async () => {
    state.status = { connected: true, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, requirementsDue: 0, disabledReason: null };
    const { container, unmount } = await mount(<StripeConnectCard account={owner} />);
    expect(container.textContent).toContain("Compte connecté : paiements en ligne actifs");
    expect(container.textContent).toContain("Tes clients peuvent payer tes factures en ligne par carte");
    expect(buttonByText(container, "Reprendre la configuration")).toBeUndefined();
    await click(buttonByText(container, "Actualiser"));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(calls.filter((c) => c.body.action === "status")).toHaveLength(2);
    await unmount();
  }, 30000);
  it("erreur du serveur (ex. script SQL non appliqué) : message et bouton Réessayer", async () => {
    state.fail = "Connexion bancaire pas encore disponible : base de données à préparer (script SQL Stripe Connect).";
    const { container, unmount } = await mount(<StripeConnectCard account={owner} />);
    expect(container.textContent).toContain("base de données à préparer");
    expect(buttonByText(container, "Réessayer")).toBeTruthy();
    expect(buttonByText(container, "Connecter mon compte de paiement")).toBeUndefined();
    await unmount();
  }, 30000);
  it("retour de Stripe (?stripe-connect=retour) : adresse nettoyée, mention affichée, état relu", async () => {
    window.history.replaceState({}, "", "/?stripe-connect=retour&autre=1");
    state.status = { connected: true, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, requirementsDue: 0, disabledReason: null };
    const { container, unmount } = await mount(<StripeConnectCard account={owner} />);
    expect(container.textContent).toContain("De retour du prestataire de paiement : état du compte actualisé.");
    expect(window.location.search).toBe("?autre=1");
    expect(calls).toHaveLength(1);
    await unmount();
  }, 30000);
  it("membre non propriétaire : note seulement, aucun appel au serveur", async () => {
    const { container, unmount } = await mount(<StripeConnectCard account={{ ...owner, role: "editor" }} />);
    expect(container.textContent).toContain("Seul le propriétaire de l'organisation peut connecter le compte bancaire.");
    expect(calls).toHaveLength(0);
    await unmount();
  }, 30000);
  it("paiement en ligne désactivé : Mon entreprise n'affiche plus la carte (composant conservé), la zone de test reste", async () => {
    const noop = () => {};
    const { container, unmount } = await mount(<CompanyView profile={{ ...emptyCompanyProfile(), name: "Bâti Plus" }} saving={false} onSave={noop} onReset={noop} documentCount={0} clientCount={0} account={owner} isLocked={false} isViewer={false} onGoToPricing={noop} />);
    const text = container.textContent;
    expect(text).not.toContain("Connecter mon compte bancaire");
    expect(text).not.toMatch(/stripe|paiement en ligne/i);
    expect(text).toContain("Zone de test");
    await unmount();
  }, 30000);
  it("commission réglée dans Admin : annoncée sur la carte", async () => {
    const { container, unmount } = await mount(<StripeConnectCard account={owner} siteSettings={{ connectFeePercent: 2.5 }} />);
    expect(container.textContent).toContain("Commission de la plateforme : 2,5 % du montant payé, prélevée automatiquement.");
    expect(container.textContent).not.toContain("Aucune commission");
    await unmount();
  }, 30000);
  it("paiement en ligne désactivé : Admin, Identité du site n'affiche plus le champ commission", async () => {
    const { container, unmount } = await mount(<SiteIdentitySettings siteSettings={{ name: "Chantiflow", contactEmail: "c@e.fr", connectFeePercent: 0 }} saving={false} onSave={() => {}} />);
    expect(container.querySelector('input[type="number"][max="20"]')).toBeNull();
    expect(container.textContent).not.toContain("Commission sur les paiements en ligne");
    await unmount();
  }, 30000);
  it("compte inachevé : « Recommencer à zéro » détache le compte (après confirmation) et relit l'état ; absent quand les paiements sont actifs", async () => {
    state.status = { connected: true, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, requirementsDue: 6, disabledReason: "requirements.past_due" };
    const { container, unmount } = await mount(<StripeConnectCard account={owner} />);
    expect(buttonByText(container, "Recommencer à zéro")).toBeTruthy();
    expect(container.textContent).toContain("Corrige-la dans Mon entreprise, puis « Recommencer à zéro »");
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => false);
    await click(buttonByText(container, "Recommencer à zéro"));
    expect(calls.filter((c) => c.body.action === "reset")).toHaveLength(0); // refus : rien ne part
    confirmSpy.mockImplementation(() => true);
    state.status = { connected: false };
    await click(buttonByText(container, "Recommencer à zéro"));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(calls.map((c) => c.body.action)).toEqual(["status", "reset", "status"]);
    expect(buttonByText(container, "Connecter mon compte de paiement")).toBeTruthy(); // repart de zéro
    confirmSpy.mockRestore();
    await unmount();
    state.status = { connected: true, chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true, requirementsDue: 1, disabledReason: null };
    const active = await mount(<StripeConnectCard account={owner} />);
    expect(buttonByText(active.container, "Recommencer à zéro")).toBeUndefined();
    await active.unmount();
  }, 30000);
});
