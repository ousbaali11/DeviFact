// @vitest-environment jsdom
// Super PDP, étape 4 (30/09/2026), chantier 5 — la carte de Mon entreprise
// affiche si les envois réels sont autorisés sur le site (garde-fou
// SUPERPDP_ALLOW_PRODUCTION lu par l'action « status »), en lecture seule ;
// rien dans le code ne déclenche la production.
import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const state = { allowProduction: false };
vi.mock("./client.js", () => ({
  db: {
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    functions: { invoke: async (name, opts) => (opts?.body?.action === "status"
      ? { data: { configured: true, allowProduction: state.allowProduction, connected: true, env: "sandbox", companyName: "Burger Queen", companyNumber: "000000002", companyNumberScheme: "sandbox", verificationStatus: "verified", needsReconnect: false }, error: null }
      : { data: { error: "?" }, error: null }) },
    rpc: async () => ({ data: [], error: null }),
    from: (table) => (table === "pdp_journal" ? { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) } : { update: () => ({ eq: async () => ({ data: [], error: null }) }) }),
  },
}));
import { SuperPdpCard } from "./App.jsx";

async function mount() {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {};
  const owner = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@exemple.fr", memberships: [] };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<SuperPdpCard account={owner} profile={{ country: "🇫🇷 FR" }} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}

describe("carte Super PDP : autorisation des envois réels sur le site", () => {
  it("garde-fou absent : « non » avec renvoi vers la procédure ; aucun bouton d'action", async () => {
    state.allowProduction = false;
    const { container, unmount } = await mount();
    const line = container.querySelector('[data-testid="superpdp-allow-production"]');
    expect(line.textContent).toContain("Envois réels autorisés sur le site : non");
    expect(line.textContent).toContain("PRODUCTION-SUPER-PDP.md");
    expect(line.querySelector("button")).toBeNull();
    await unmount();
  }, 30000);
  it("garde-fou levé côté serveur : « oui », sans renvoi", async () => {
    state.allowProduction = true;
    const { container, unmount } = await mount();
    const line = container.querySelector('[data-testid="superpdp-allow-production"]');
    expect(line.textContent).toBe("Envois réels autorisés sur le site : oui");
    await unmount();
  }, 30000);
});
