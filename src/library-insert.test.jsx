// @vitest-environment jsdom
// Bibliothèque de produits dans l'éditeur : recherche par nom ou référence,
// et insertion dans la première ligne vide plutôt qu'en dessous.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor, newDocument, isBlankLine, insertProductLine, emptyProduct, emptyCompanyProfile, PLANS } from "./App.jsx";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
  window.scrollTo = () => {};
});

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const siteSettings = { name: "Chantiflow" };
const products = [
  { ...emptyProduct("org"), id: "p1", name: "Carrelage 60x60", reference: "CAR-60", sale_price_ht: 25, sale_vat_rate: 20, is_active: true, quantity_restricted: false, default_quantity: 2, unit: "m²" },
  { ...emptyProduct("org"), id: "p2", name: "Colle flex", reference: "COL-FLX", sale_price_ht: 8, sale_vat_rate: 20, is_active: true, quantity_restricted: false },
];
const common = { saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onFinalize: noop, onBack: noop, onGoToPricing: noop, clients: [], products, stockByProduct: { p1: 10, p2: 10 }, companyProfile: emptyCompanyProfile(), onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop };
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
function setValue(input, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const libraryButton = (c) => [...c.querySelectorAll("button")].find((b) => b.textContent.includes("Depuis la bibliothèque"));
const productButtons = (c) => [...c.querySelectorAll("button")].filter((b) => /Carrelage 60x60|Colle flex/.test(b.textContent));
const lastPatch = async (patches) => { await act(async () => { await new Promise((r) => setTimeout(r, 500)); }); return patches.at(-1); };

describe("helpers", () => {
  it("ligne vide : ni désignation, ni prix, ni sous-détail avec contenu", () => {
    expect(isBlankLine({ type: "line", designation: "", details: [], qty: 1, unitPrice: 0 })).toBe(true);
    expect(isBlankLine({ type: "line", designation: " x", details: [], unitPrice: 0 })).toBe(false);
    expect(isBlankLine({ type: "line", designation: "", details: [], unitPrice: 5 })).toBe(false);
    expect(isBlankLine({ type: "line", designation: "", details: [{ text: "détail", included: true }], unitPrice: 0 })).toBe(false);
    expect(isBlankLine({ type: "section", title: "" })).toBe(false);
  });
  it("insertion : remplace la première ligne vide en gardant son identifiant, sinon ajoute à la fin", () => {
    const blank = { id: "l1", type: "line", designation: "", details: [], qty: 1, unitPrice: 0 };
    const line = { id: "new", type: "line", designation: "Carrelage", unitPrice: 25 };
    expect(insertProductLine([blank], line)).toEqual([{ ...line, id: "l1" }]);
    const filled = { id: "l0", type: "line", designation: "Existant", details: [], unitPrice: 10 };
    expect(insertProductLine([filled, blank], line)).toEqual([filled, { ...line, id: "l1" }]);
    expect(insertProductLine([filled], line)).toEqual([filled, line]);
    expect(insertProductLine([], line)).toEqual([line]);
  });
});

describe("éditeur : recherche par nom ou référence", () => {
  it("taper une référence ne laisse que le produit correspondant ; le nom marche toujours", async () => {
    const { container, unmount } = await mount(<Editor {...common} doc={newDocument("devis", [])} onChange={noop} />);
    await click(libraryButton(container));
    const search = container.querySelector('input[placeholder="Rechercher par nom ou référence…"]');
    expect(search).toBeTruthy();
    expect(productButtons(container)).toHaveLength(2);
    await act(async () => { setValue(search, "col-flx"); });
    expect(productButtons(container).map((b) => b.textContent)).toEqual([expect.stringContaining("Colle flex")]);
    await act(async () => { setValue(search, "carrelage"); });
    expect(productButtons(container).map((b) => b.textContent)).toEqual([expect.stringContaining("Carrelage 60x60")]);
    await unmount();
  });
});

describe("éditeur : insertion dans la ligne 1 vide, pour chaque type concerné", () => {
  for (const type of ["devis", "facture", "proforma", "commande", "livraison", "bpu", "avoir"]) {
    it(`${type} : le produit remplit la ligne vide du document neuf, puis s'ajoute en dessous d'une ligne remplie`, async () => {
      const patches = [];
      const doc = newDocument(type, []);
      expect(doc.items).toHaveLength(1);
      const { container, unmount } = await mount(<Editor {...common} doc={doc} onChange={(p) => patches.push(p)} />);
      await click(libraryButton(container));
      await click(productButtons(container)[0]);
      let p = await lastPatch(patches);
      expect(p.items).toHaveLength(1);
      expect(p.items[0]).toMatchObject({ id: doc.items[0].id, designation: "Carrelage 60x60", productId: "p1", productRef: "CAR-60", qty: 2, unitPrice: 25 });
      // Deuxième insertion : la ligne 1 est remplie, la nouvelle va en dessous
      await click(libraryButton(container));
      await click(productButtons(container)[1]);
      p = await lastPatch(patches);
      expect(p.items.map((it) => it.designation)).toEqual(["Carrelage 60x60", "Colle flex"]);
      await unmount();
    }, 20000);
  }
  it("facture d'acompte : pas de section Prestations (ligne générée par le bloc acompte), donc pas de bouton", async () => {
    const { container, unmount } = await mount(<Editor {...common} doc={newDocument("acompte", [])} onChange={noop} />);
    expect(libraryButton(container)).toBeUndefined();
    await unmount();
  });
});
