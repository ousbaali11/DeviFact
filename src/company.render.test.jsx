// @vitest-environment jsdom
// Audit des champs, étape A : nouveaux champs de « Mon entreprise » (forme
// juridique, capital, RCS/RM, mention EI, assurance décennale, médiateur).
// Vérifie le formulaire, le résumé, les libellés imprimables, et qu'un profil
// existant sans ces champs s'ouvre sans erreur ni perte.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
// Base simulée : la carte « Connecter mon compte bancaire » de Mon
// entreprise interroge le serveur au montage (voir stripe-connect.test.jsx).
vi.mock("./client.js", () => ({ db: { functions: { invoke: async () => ({ data: { connected: false }, error: null }) }, auth: { getSession: async () => ({ data: { session: { access_token: "jeton" } } }) }, rpc: async () => ({ data: [], error: null }) } }));
import { CompanyView, emptyCompanyProfile, companyLegalFormLabel, companyInsuranceLabel } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", role: "owner" };
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const labelsOf = (container) => [...container.querySelectorAll("label")].map((l) => l.textContent.trim());

describe("Mon entreprise — mentions légales (étape A)", () => {
  it("le modèle vide contient les nouveaux champs", () => {
    const p = emptyCompanyProfile();
    expect(p).toMatchObject({ legalForm: "", capital: "", registration: "", entrepreneurIndividuel: false, insuranceName: "", insurancePolicy: "", insuranceZone: "", mediatorName: "", mediatorContact: "" });
  });
  it("libellés imprimables", () => {
    expect(companyLegalFormLabel({ legalForm: "SARL", capital: "5 000 €" })).toBe("SARL au capital de 5 000 €");
    expect(companyLegalFormLabel({ legalForm: "Micro-entreprise", entrepreneurIndividuel: true })).toBe("Micro-entreprise EI");
    expect(companyLegalFormLabel({ legalForm: "Entreprise individuelle (EI)", entrepreneurIndividuel: true })).toBe("Entreprise individuelle (EI)");
    expect(companyLegalFormLabel({})).toBe("");
    expect(companyInsuranceLabel({ insuranceName: "AXA", insurancePolicy: "123", insuranceZone: "France" })).toBe("AXA, contrat n° 123, couverture : France");
    expect(companyInsuranceLabel({})).toBe("");
  });
  it("formulaire : les nouveaux champs sont dans le bloc « Mentions légales », entre N° TVA et Factur-X, pour une entreprise", async () => {
    const profile = { ...emptyCompanyProfile(), name: "", country: "🇫🇷 FR" }; // nom vide → mode édition d'emblée ; France → section Factur-X
    const { container, unmount } = await mount(<CompanyView profile={profile} saving={false} onSave={noop} onReset={noop} documentCount={0} clientCount={0} account={account} isLocked={false} isViewer={false} onGoToPricing={noop} />);
    const text = container.textContent;
    expect(text).toContain("Mentions légales des devis et factures");
    for (const label of ["Forme juridique *", "Capital social (sociétés) *", "Immatriculation RCS ou RM et ville *", "Assureur", "N° de contrat", "Couverture géographique", "Nom du médiateur", "Site ou adresse du médiateur"]) {
      expect(labelsOf(container), label).toContain(label);
    }
    expect(text).toContain("Entrepreneur individuel");
    expect(text).toContain("L243-2");
    expect(text).toContain("L616-1");
    // Ordre : N° TVA, puis mentions légales, puis Factur-X
    const iTva = text.indexOf("N° TVA intracommunautaire");
    const iLegal = text.indexOf("Mentions légales des devis et factures");
    const iFx = text.indexOf("Facturation électronique (Factur-X)");
    expect(iTva).toBeGreaterThan(-1);
    expect(iLegal).toBeGreaterThan(iTva);
    expect(iFx).toBeGreaterThan(iLegal);
    await unmount();
  });
  it("formulaire : bloc masqué pour un particulier", async () => {
    const profile = { ...emptyCompanyProfile(), type: "particulier", name: "" };
    const { container, unmount } = await mount(<CompanyView profile={profile} saving={false} onSave={noop} onReset={noop} documentCount={0} clientCount={0} account={account} isLocked={false} isViewer={false} onGoToPricing={noop} />);
    expect(container.textContent).not.toContain("Mentions légales des devis et factures");
    await unmount();
  });
  it("résumé : affiche forme, RCS, décennale et médiateur quand renseignés", async () => {
    const profile = { ...emptyCompanyProfile(), name: "Bâti Plus", legalForm: "SAS", capital: "10 000 €", registration: "RCS Lyon 123 456 789", insuranceName: "SMABTP", insurancePolicy: "P-42", insuranceZone: "France", mediatorName: "CM2C", mediatorContact: "https://cm2c.net" };
    const { container, unmount } = await mount(<CompanyView profile={profile} saving={false} onSave={noop} onReset={noop} documentCount={0} clientCount={0} account={account} isLocked={false} isViewer={false} onGoToPricing={noop} />);
    const text = container.textContent;
    expect(text).toContain("SAS au capital de 10 000 €");
    expect(text).toContain("RCS Lyon 123 456 789");
    expect(text).toContain("SMABTP, contrat n° P-42, couverture : France");
    expect(text).toContain("CM2C — https://cm2c.net");
    await unmount();
  });
  it("profil existant sans les nouveaux champs : s'ouvre, s'édite, et l'enregistrement conserve les anciens champs", async () => {
    // Profil tel qu'enregistré avant l'étape A (aucune des nouvelles clés).
    const legacy = { type: "entreprise", name: "Ancienne SARL", siret: "123", address: "1 rue", country: "🇫🇷 FR", email: "a@b.fr", phone: "06", tva: "FR1", logo: null, postalCode: "69000", city: "Lyon", iban: "FR76", bic: "BIC", vatOnDebits: true, googleReviewUrl: "", fiscalStartMonth: 4 };
    let saved = null;
    const { container, unmount } = await mount(<CompanyView profile={legacy} saving={false} onSave={(p) => { saved = p; }} onReset={noop} documentCount={0} clientCount={0} account={account} isLocked={false} isViewer={false} onGoToPricing={noop} />);
    expect(container.textContent).toContain("Ancienne SARL");
    const edit = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Modifier"));
    await act(async () => { edit.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(container.textContent).toContain("Mentions légales des devis et factures");
    const save = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Enregistrer"));
    await act(async () => { save.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(saved).toMatchObject(legacy); // rien de perdu
    await unmount();
  });
});
