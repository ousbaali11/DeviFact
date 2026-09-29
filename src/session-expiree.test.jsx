// @vitest-environment jsdom
// Bug du 29/09/2026 : jeton de session refusé par le serveur (« Non
// connecté », 401) alors que l'écran restait « connecté » — la carte Super
// PDP affichait « État indisponible » sans issue et il fallait se
// déconnecter puis se reconnecter à la main. Désormais : renouvellement de
// la session puis rejeu de l'appel ; si le renouvellement échoue, la session
// est déclarée morte (écouteur onDeadSession) et l'appel échoue avec un
// message clair ; la carte propose « Réessayer ».
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const calls = [];
const mock = { token: "ancien", refreshed: "nouveau", refreshFails: false, refuse: (bearer) => bearer !== "Bearer nouveau", refreshAvailable: true };
const unauthorized = () => ({ data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: { status: 401, json: async () => ({ error: "Non connecté" }) } } });
vi.mock("./client.js", () => ({
  db: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: mock.token } } }),
      get refreshSession() { return mock.refreshAvailable ? async () => (mock.refreshFails ? { data: { session: null }, error: { message: "Invalid Refresh Token" } } : { data: { session: { access_token: mock.refreshed } } }) : undefined; },
    },
    functions: { invoke: async (name, opts) => {
      const bearer = opts?.headers?.Authorization;
      calls.push({ name, bearer, body: opts?.body });
      if (mock.refuse(bearer)) return unauthorized();
      return { data: { ok: true, configured: true, connected: true, env: "sandbox", companyName: "Burger Queen", companyNumber: "315143296_106843", companyNumberScheme: "sandbox", verificationStatus: "verified" }, error: null };
    } },
    rpc: async () => ({ data: [], error: null }),
    from: () => ({ update: () => ({ eq: async () => ({ data: [], error: null }) }) }),
  },
}));
import { invokeFunction, onDeadSession, SESSION_EXPIRED_MESSAGE, SuperPdpCard } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });
beforeEach(() => { calls.length = 0; mock.refreshFails = false; mock.refreshAvailable = true; mock.refuse = (bearer) => bearer !== "Bearer nouveau"; });

describe("invokeFunction", () => {
  it("jeton refusé : la session est renouvelée et l'appel rejoué avec le nouveau jeton, sans rien signaler", async () => {
    const dead = vi.fn();
    const off = onDeadSession(dead);
    const res = await invokeFunction("superpdp-oauth", { organizationId: "org", action: "status" });
    off();
    expect(res.data.ok).toBe(true);
    expect(calls.map((c) => c.bearer)).toEqual(["Bearer ancien", "Bearer nouveau"]);
    expect(calls[1].body).toEqual({ organizationId: "org", action: "status" });
    expect(dead).not.toHaveBeenCalled();
  });
  it("renouvellement impossible : session déclarée morte (écouteur prévenu) et erreur explicite", async () => {
    mock.refreshFails = true;
    const dead = vi.fn();
    const off = onDeadSession(dead);
    await expect(invokeFunction("superpdp-oauth", { action: "status" })).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    off();
    expect(dead).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1); // pas de rejeu sans nouveau jeton
  });
  it("jeton accepté : un seul appel ; autre erreur (non 401) : renvoyée telle quelle sans renouvellement", async () => {
    mock.refuse = () => false;
    const res = await invokeFunction("generate-facturx", { document: {} });
    expect(res.data.ok).toBe(true);
    expect(calls).toHaveLength(1);
    // Erreur 400 côté serveur : pas un problème de session.
    const dead = vi.fn();
    const off = onDeadSession(dead);
    const { db } = await import("./client.js");
    const invoke = db.functions.invoke;
    db.functions.invoke = async () => ({ data: null, error: { context: { status: 400 } } });
    const bad = await invokeFunction("generate-facturx", {});
    db.functions.invoke = invoke;
    off();
    expect(bad.error.context.status).toBe(400);
    expect(dead).not.toHaveBeenCalled();
  });
  it("client sans renouvellement de session (base simulée) : pas de plantage, session déclarée morte", async () => {
    mock.refreshAvailable = false;
    await expect(invokeFunction("superpdp-oauth", {})).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    expect(calls).toHaveLength(1);
  });
});

describe("carte Super PDP", () => {
  const owner = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@exemple.fr", memberships: [] };
  const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  async function mount(element) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(element); });
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
  }
  it("jeton refusé puis renouvelé : la carte affiche directement l'état connecté", async () => {
    const { container, unmount } = await mount(<SuperPdpCard account={owner} profile={{ country: "🇫🇷 FR", siret: "73282932000074" }} />);
    expect(container.textContent).toContain("Burger Queen");
    expect(container.textContent).not.toContain("État indisponible");
    await unmount();
  });
  it("session morte : « État indisponible » avec un bouton Réessayer qui relit l'état une fois la session rétablie", async () => {
    mock.refreshFails = true;
    const { container, unmount } = await mount(<SuperPdpCard account={owner} profile={{ country: "🇫🇷 FR" }} />);
    expect(container.textContent).toContain("État indisponible pour l'instant.");
    expect(container.textContent).toContain(SESSION_EXPIRED_MESSAGE);
    const retry = container.querySelector('[data-testid="superpdp-retry"]');
    expect(retry).toBeTruthy();
    mock.refreshFails = false;
    await click(retry);
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(container.textContent).toContain("Burger Queen");
    expect(container.querySelector('[data-testid="superpdp-retry"]')).toBeNull();
    await unmount();
  });
});
