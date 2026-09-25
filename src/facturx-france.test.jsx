// @vitest-environment jsdom
// Factur-X réservé aux entreprises dont le pays de la fiche Mon entreprise
// est la France : visible avec France, absent avec un autre pays, absent si
// le pays n'est pas renseigné (menu Exporter, bloc de l'éditeur, titre de la
// section de Mon entreprise).
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor, CompanyView, newDocument, emptyCompanyProfile, isFranceCompany, PLANS } from "./App.jsx";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
  window.scrollTo = () => {};
});
const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@exemple.fr", memberships: [] };
const line = { id: "l1", type: "line", designation: "Pose", qty: 1, unit: "u", unitPrice: 100, tva: 20, discount: 0, details: [] };
const props = { saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, products: [], stockByProduct: {}, clients: [], onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop };

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const menuItems = (c) => [...c.querySelectorAll('[data-testid="export-menu"] [role="menuitem"]')].map((b) => b.textContent.trim());
const profileWith = (country) => ({ ...emptyCompanyProfile(), name: "Bâti Plus", country });
const facture = { ...newDocument("facture", []), docNumber: "FAC-1", items: [line], client: { type: "particulier", name: "M. Dupont" } };

describe("isFranceCompany", () => {
  it("France oui ; Maroc, « Autre », pays vide ou fiche absente non", () => {
    expect(isFranceCompany(profileWith("🇫🇷 FR"))).toBe(true);
    expect(isFranceCompany(profileWith("🇲🇦 MA"))).toBe(false);
    expect(isFranceCompany(profileWith("Autre"))).toBe(false);
    expect(isFranceCompany(profileWith(""))).toBe(false);
    expect(isFranceCompany(null)).toBe(false);
  });
});

describe("éditeur de facture", () => {
  it("pays France : Factur-X dans le menu Exporter et bloc Facturation électronique", async () => {
    const { container, unmount } = await mount(<Editor {...props} doc={facture} companyProfile={profileWith("🇫🇷 FR")} />);
    await click(container.querySelector('[data-testid="export-menu"] > button'));
    expect(menuItems(container)).toContain("Factur-X (facture électronique)");
    expect(container.querySelector('[data-testid="facturx-block"]')).toBeTruthy();
    expect(container.textContent).toContain("Facturation électronique (Factur-X)");
    await unmount();
  }, 30000);
  it("pays Maroc : rien de Factur-X, ni dans le menu ni dans l'éditeur", async () => {
    const { container, unmount } = await mount(<Editor {...props} doc={facture} companyProfile={profileWith("🇲🇦 MA")} />);
    await click(container.querySelector('[data-testid="export-menu"] > button'));
    expect(menuItems(container)).toEqual(["PDF", "Excel", "Lien de paiement", "QR code du lien"]);
    expect(container.querySelector('[data-testid="facturx-block"]')).toBeNull();
    expect(container.textContent).not.toContain("Factur-X");
    await unmount();
  }, 30000);
  it("pays non renseigné : même chose, Factur-X absent", async () => {
    const { container, unmount } = await mount(<Editor {...props} doc={facture} companyProfile={profileWith("")} />);
    await click(container.querySelector('[data-testid="export-menu"] > button'));
    expect(menuItems(container)).not.toContain("Factur-X (facture électronique)");
    expect(container.querySelector('[data-testid="facturx-block"]')).toBeNull();
    expect(container.textContent).not.toContain("Factur-X");
    await unmount();
  }, 30000);
});

describe("Mon entreprise", () => {
  const render = async (country) => {
    const mounted = await mount(<CompanyView profile={profileWith(country)} saving={false} onSave={noop} onReset={noop} documentCount={0} clientCount={0} account={account} isLocked={false} isViewer={false} onGoToPricing={noop} />);
    await click([...mounted.container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Modifier")); // la section est dans le formulaire
    return mounted;
  };
  it("France : section « Facturation électronique (Factur-X) » ; autre pays ou pays vide : « Coordonnées de paiement », sans mention Factur-X", async () => {
    const fr = await render("🇫🇷 FR");
    expect(fr.container.textContent).toContain("Facturation électronique (Factur-X)");
    await fr.unmount();
    for (const country of ["🇲🇦 MA", ""]) {
      const other = await render(country);
      expect(other.container.textContent).toContain("Coordonnées de paiement");
      expect(other.container.textContent).not.toContain("Factur-X");
      await other.unmount();
    }
  }, 30000);
});
