// @vitest-environment jsdom
// Régression du 30/09/2026 : le correctif « document terminé modifié →
// Enregistrer » avait inséré touchWorkStage(localDoc, p) dans TOUTES les
// fonctions patch, y compris trois formulaires sans localDoc (Mon entreprise,
// Contact, réglages Admin) : chaque frappe y levait une erreur et rien n'était
// pris en compte. Ces trois formulaires doivent accepter une saisie.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { CompanyView, ContactView, SiteIdentitySettings, emptyCompanyProfile } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });
const noop = () => {};
const setValue = (input, value) => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); };
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const errors = [];
  const onError = (e) => { errors.push(e.message || String(e)); e.preventDefault(); };
  window.addEventListener("error", onError);
  await act(async () => { root.render(element); });
  return { container, errors, unmount: async () => { window.removeEventListener("error", onError); await act(async () => { root.unmount(); }); container.remove(); } };
}
const typeInto = (container, predicate, value) => act(async () => { const input = [...container.querySelectorAll("input")].find(predicate); expect(input, "champ introuvable").toBeTruthy(); setValue(input, value); });

describe("formulaires sans document (pas de localDoc)", () => {
  it("Mon entreprise : une frappe dans le nom est prise en compte, sans erreur", async () => {
    const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
    const profile = { ...emptyCompanyProfile(), name: "", country: "🇫🇷 FR" }; // sans nom : formulaire ouvert en saisie
    const { container, errors, unmount } = await mount(<CompanyView profile={profile} saving={false} onSave={noop} onReset={noop} documentCount={0} clientCount={0} account={account} isLocked={false} isViewer={false} onGoToPricing={noop} />);
    await typeInto(container, (i) => (i.type === "text" || !i.getAttribute("type")) && !i.readOnly, "Bâti Plus SARL");
    expect([...container.querySelectorAll("input")].some((i) => i.value === "Bâti Plus SARL")).toBe(true);
    expect(errors).toEqual([]);
    await unmount();
  });
  it("Contact : une frappe dans l'e-mail est prise en compte, sans erreur", async () => {
    const { container, errors, unmount } = await mount(<ContactView siteSettings={{ name: "Chantiflow" }} onBack={noop} onLegal={noop} />);
    await typeInto(container, (i) => i.type === "email", "contact@exemple.fr");
    expect([...container.querySelectorAll("input")].some((i) => i.value === "contact@exemple.fr")).toBe(true);
    expect(errors).toEqual([]);
    await unmount();
  });
  it("Admin, identité du site : une frappe dans le nom est prise en compte, sans erreur", async () => {
    const onSave = vi.fn();
    const { container, errors, unmount } = await mount(<SiteIdentitySettings siteSettings={{ name: "Chantiflow", logo: null, logoWidth: 36, logoHeight: 36, pdfBackground: "#ffffff", pdfHeaderColor: "#bababa", pdfTextColor: "#000000", pdfBlockColor: "#F1F0EA" }} saving={false} onSave={onSave} />);
    await typeInto(container, (i) => i.value === "Chantiflow", "Chantiflow Pro");
    expect([...container.querySelectorAll("input")].some((i) => i.value === "Chantiflow Pro")).toBe(true);
    expect(errors).toEqual([]);
    await unmount();
  });
});
