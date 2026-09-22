// @vitest-environment jsdom
// Page publique d'une facture : le bouton « Payer en ligne » n'apparaît
// que si le serveur annonce que le paiement en ligne est disponible
// (compte Stripe connecté et actif) ; sinon, renvoi vers le virement.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PublicDocumentView } from "./App.jsx";

const state = { response: null };
vi.mock("./client.js", () => ({
  db: {
    functions: { invoke: async () => { state.calls = (state.calls || 0) + 1; return { data: typeof state.response === "function" ? state.response() : state.response, error: null }; } },
    from: () => { throw new Error("pas d'accès base attendu sur la page publique"); },
  },
}));

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });
const invokeCount = () => state.calls;
state.calls = 0;

const facture = { id: "d1", type: "facture", docNumber: "F-001", status: "envoyée", currency: "EUR", client: { name: "M. Dupont" }, items: [{ id: "l1", type: "line", designation: "Pose", qty: 1, unitPrice: 100, tva: 20 }] };

async function renderPublic(response) {
  state.response = response;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<PublicDocumentView token="abc" />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  const text = container.textContent;
  const buttons = [...container.querySelectorAll("button")].map((b) => b.textContent.trim());
  await act(async () => { root.unmount(); });
  container.remove();
  return { text, buttons };
}

describe("page publique d'une facture", () => {
  it("sans indication du serveur : pas de bouton de paiement, renvoi vers le virement", async () => {
    const { text, buttons } = await renderPublic({ document: facture, siteName: "Chantiflow", signedAt: null, paidAt: null });
    expect(text).toContain("Facture F-001");
    expect(buttons.some((b) => b.startsWith("Payer"))).toBe(false);
    expect(text).toContain("Règlement par virement bancaire");
    expect(text).toContain("Le paiement en ligne n'est pas disponible pour cette facture.");
  }, 30000);
  it("paiement en ligne annoncé indisponible : idem", async () => {
    const { buttons } = await renderPublic({ document: facture, siteName: "Chantiflow", signedAt: null, paidAt: null, onlinePaymentEnabled: false });
    expect(buttons.some((b) => b.startsWith("Payer"))).toBe(false);
  }, 30000);
  it("paiement en ligne disponible : bouton « Payer … en ligne », pas de note virement", async () => {
    const { text, buttons } = await renderPublic({ document: facture, siteName: "Chantiflow", signedAt: null, paidAt: null, onlinePaymentEnabled: true });
    expect(buttons.some((b) => /^Payer .*en ligne$/.test(b))).toBe(true);
    expect(text).not.toContain("Règlement par virement bancaire");
  }, 30000);
  it("facture déjà payée : ni bouton ni note, mention « déjà payée »", async () => {
    const { text, buttons } = await renderPublic({ document: facture, siteName: "Chantiflow", signedAt: null, paidAt: "2026-09-01T10:00:00Z", onlinePaymentEnabled: true });
    expect(buttons.some((b) => b.startsWith("Payer"))).toBe(false);
    expect(text).not.toContain("Règlement par virement bancaire");
    expect(text).toContain("Facture déjà payée");
  }, 30000);
  it("retour de Stripe (?paiement=ok) : confirmation affichée, ni bouton ni note virement, relecture jusqu'à la confirmation", async () => {
    window.history.replaceState({}, "", "/?voir-document=abc&paiement=ok");
    try {
      let reads = 0;
      state.calls = 0;
      state.response = () => { reads += 1; return { document: facture, siteName: "Chantiflow", signedAt: null, paidAt: reads >= 2 ? "2026-09-22T10:00:00Z" : null, onlinePaymentEnabled: true }; };
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => { root.render(<PublicDocumentView token="abc" />); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(container.textContent).toContain("Paiement transmis, merci !");
      expect([...container.querySelectorAll("button")].some((b) => b.textContent.startsWith("Payer"))).toBe(false);
      expect(container.textContent).not.toContain("Règlement par virement bancaire");
      // Deuxième lecture après 3 s : la facture est confirmée payée
      await act(async () => { await new Promise((r) => setTimeout(r, 3100)); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(container.textContent).toContain("Facture déjà payée");
      expect(container.textContent).not.toContain("Paiement transmis");
      expect(invokeCount()).toBe(2);
      await act(async () => { root.unmount(); });
      container.remove();
    } finally { window.history.replaceState({}, "", "/"); }
  }, 30000);
});
