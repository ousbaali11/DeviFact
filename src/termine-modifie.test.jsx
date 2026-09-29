// @vitest-environment jsdom
// Point 1 (30/09/2026) : un document marqué « Terminé » puis modifié
// (contenu ou statut) redevient à enregistrer — l'étape repasse
// « brouillon » et le bouton principal affiche « Enregistrer ». Les champs
// posés automatiquement (suivi Super PDP, fusion, relances, signature en
// ligne) ne comptent pas.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { touchWorkStage, Editor, PvReceptionEditor, newDocument, newPvReceptionDocument, emptyCompanyProfile, PLANS } from "./App.jsx";

describe("touchWorkStage", () => {
  it("document terminé + modification de contenu ou de statut → brouillon ; sinon inchangé", () => {
    const done = { workStage: "termine" };
    expect(touchWorkStage(done, { notes: "x" })).toEqual({ notes: "x", workStage: "brouillon" });
    expect(touchWorkStage(done, { status: "payée" })).toEqual({ status: "payée", workStage: "brouillon" });
    expect(touchWorkStage(done, { items: [] })).toEqual({ items: [], workStage: "brouillon" });
    for (const auto of [{ pdp: { status: "fr:202" } }, { conflict: null }, { lastReminderSentAt: "x" }, { updatedAt: 1 }, { signature: { mode: "texte", name: "C" } }, { workStage: "termine" }]) expect(touchWorkStage(done, auto)).toBe(auto);
    const draft = { workStage: "brouillon" };
    const p = { notes: "x" };
    expect(touchWorkStage(draft, p)).toBe(p);
    expect(touchWorkStage(null, p)).toBe(p);
    expect(touchWorkStage(done, null)).toBeNull();
  });
});

describe("éditeurs", () => {
  beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null; });
  const noop = () => {};
  const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
  const siteSettings = { name: "Chantiflow" };
  async function mount(element) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(element); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
  }
  const mainButton = (c) => [...c.querySelectorAll("button")].find((b) => ["Terminé", "Enregistrer"].includes(b.textContent.trim()));
  const type = (input, value) => act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });

  it("facture terminée : bouton « Terminé » ; un champ modifié → « Enregistrer » aussitôt, et l'enregistrement porte l'étape « brouillon »", async () => {
    const changes = [];
    const props = { saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onChange: (p) => changes.push(p), onFinalize: noop, onBack: noop, onGoToPricing: noop, products: [], stockByProduct: {}, clients: [], companyProfile: emptyCompanyProfile(), onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop };
    const doc = { ...newDocument("facture", []), docNumber: "FAC-001", workStage: "termine", status: "envoyée", chantier: "Villa" };
    const { container, unmount } = await mount(<Editor {...props} doc={doc} />);
    expect(mainButton(container).textContent.trim()).toBe("Terminé");
    const chantier = [...container.querySelectorAll("input")].find((i) => i.value === "Villa");
    expect(chantier).toBeTruthy();
    await type(chantier, "Villa Dupont");
    expect(mainButton(container).textContent.trim()).toBe("Enregistrer");
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(changes.at(-1)).toMatchObject({ chantier: "Villa Dupont", workStage: "brouillon" });
    await unmount();
  }, 30000);
  it("PV de réception terminé : même comportement", async () => {
    const changes = [];
    const props = { documents: [], saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onChange: (p) => changes.push(p), onFinalize: noop, onBack: noop, onGoToPricing: noop, companyProfile: emptyCompanyProfile(), clients: [] };
    const doc = { ...newPvReceptionDocument([]), docNumber: "PV-001", workStage: "termine", chantier: "Maison" };
    const { container, unmount } = await mount(<PvReceptionEditor {...props} doc={doc} />);
    expect(mainButton(container).textContent.trim()).toBe("Terminé");
    const chantier = [...container.querySelectorAll("input")].find((i) => i.value === "Maison");
    expect(chantier).toBeTruthy();
    await type(chantier, "Maison Martin");
    expect(mainButton(container).textContent.trim()).toBe("Enregistrer");
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(changes.at(-1)).toMatchObject({ chantier: "Maison Martin", workStage: "brouillon" });
    await unmount();
  }, 30000);
});
