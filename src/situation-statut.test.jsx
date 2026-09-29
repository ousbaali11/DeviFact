// @vitest-environment jsdom
// Oubli signalé le 29/09/2026 : l'éditeur de situation n'avait aucun champ
// statut (seule la page Documents permettait de passer une situation en
// « envoyée », condition de l'envoi via Super PDP). Désormais, la barre du
// haut porte la même pastille de statut que l'éditeur principal.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { SituationEditor, newSituationDocument, emptyCompanyProfile, PLANS } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const props = { documents: [], saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onCreateNext: noop, onGoToPricing: noop, companyProfile: { ...emptyCompanyProfile(), name: "Bâti Plus", country: "🇫🇷 FR" } };
const line = { id: "s1", type: "line", designation: "Gros œuvre", qty: 1, unitPrice: 10000, tva: 20, avancementPct: 30, montantCumulePrecedent: 2000 };
const situation = (extra = {}) => ({ ...newSituationDocument([]), docNumber: "SIT-003", items: [line], ...extra });

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const select = (c) => c.querySelector('[data-testid="situation-status"]');
const choose = (el, v) => act(async () => { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("change", { bubbles: true })); });

describe("éditeur de situation : pastille de statut", () => {
  it("présente en haut, avec les statuts d'une facture, brouillon par défaut ; le changement est enregistré", async () => {
    const changes = [];
    const { container, unmount } = await mount(<SituationEditor {...props} doc={situation()} onChange={(p) => changes.push(p)} />);
    const el = select(container);
    expect(el).toBeTruthy();
    expect([...el.options].map((o) => o.value)).toEqual(["brouillon", "envoyée", "payée", "en retard"]);
    expect(el.value).toBe("brouillon");
    await choose(el, "envoyée");
    expect(el.value).toBe("envoyée");
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(changes.some((p) => p.status === "envoyée")).toBe(true);
    await unmount();
  });
  it("situation transmise via Super PDP : le statut reste modifiable malgré le contenu figé", async () => {
    const changes = [];
    const doc = situation({ vautFacture: true, status: "envoyée", pdp: { invoiceId: 88, status: "fr:202", statusText: "Reçue", sentAt: "2026-09-29T10:00:00.000Z" } });
    const { container, unmount } = await mount(<SituationEditor {...props} doc={doc} onChange={(p) => changes.push(p)} />);
    expect(container.querySelector('[data-testid="pdp-lock-banner"]')).toBeTruthy();
    await choose(select(container), "payée");
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(changes.some((p) => p.status === "payée")).toBe(true);
    expect(container.textContent).not.toContain("La dernière modification a été ignorée.");
    await unmount();
  });
});
