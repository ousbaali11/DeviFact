// @vitest-environment jsdom
// Audit des champs, étape C — contrat de chantier : lieu des travaux,
// devise, devis de référence, assurance et médiateur repris du profil,
// clause réception et garanties, droit de rétractation (particulier hors
// établissement), lieu de signature, retenue de garantie, obligatoires.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ContratChantierEditor, PrintContrat, newContratChantierDocument, CONTRAT_CLAUSE_RECEPTION, CONTRAT_CLAUSE_RETRACTATION, accountingExportRow, documentValidationErrors, documentSuggestedFields, emptyCompanyProfile, PLANS } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const siteSettings = { name: "Chantiflow", landingPageVersion: "classique" };
const profile = { ...emptyCompanyProfile(), name: "Bâti Plus", insuranceName: "SMABTP", insurancePolicy: "P-42", insuranceZone: "France", mediatorName: "CM2C", mediatorContact: "https://cm2c.net" };
const full = (extra = {}) => ({ ...newContratChantierDocument([]), docNumber: "CTR-002", issueDate: "2026-09-13", objetTravaux: "Rénovation de la toiture", lieuTravaux: "12 rue des Lilas, 69000 Lyon", montantTotalHT: "20000", company: { ...newContratChantierDocument([]).company, name: "Bâti Plus", siret: "123" }, client: { ...newContratChantierDocument([]).client, name: "M. Martin" }, signatureClient: { name: "", date: "2026-09-13" }, ...extra });
const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/[  ]/g, " ");
const pdf = (d, companyProfile = profile) => textOf(renderToStaticMarkup(<PrintContrat doc={d} siteSettings={siteSettings} watermarkEnabled={false} companyProfile={companyProfile} />));

async function renderOnce(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  const text = container.textContent;
  const disabled = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Enregistrer")?.hasAttribute("disabled");
  await act(async () => { root.unmount(); });
  container.remove();
  return { text, disabled };
}

describe("modèle et règles", () => {
  it("nouveaux champs et devise", () => {
    const d = newContratChantierDocument([]);
    expect(d).toMatchObject({ schemaVersion: 2, lieuTravaux: "", devisRef: "", retenueGarantiePct: "", horsEtablissement: false, lieuSignature: "", clauseReception: CONTRAT_CLAUSE_RECEPTION, clauseRetractation: CONTRAT_CLAUSE_RETRACTATION });
    expect(typeof d.currency).toBe("string");
    expect(CONTRAT_CLAUSE_RECEPTION).toContain("1792");
    expect(CONTRAT_CLAUSE_RETRACTATION).toContain("L221-18");
  });
  it("obligatoires : entreprise, maître d'ouvrage, objet, lieu, montant ; ancien contrat invité seulement", () => {
    expect(documentValidationErrors(full())).toEqual([]);
    expect(documentValidationErrors(full({ lieuTravaux: "", montantTotalHT: "0" }))).toEqual(["Lieu des travaux", "Montant total HT"]);
    const legacy = full({ lieuTravaux: "" }); delete legacy.schemaVersion;
    expect(documentValidationErrors(legacy)).toEqual([]);
    expect(documentSuggestedFields(legacy)).toEqual(["Lieu des travaux"]);
  });
  it("export comptable inchangé pour le contrat", () => {
    expect(accountingExportRow(full()).slice(5)).toEqual([20000, 4000, 24000]);
  });
});

describe("PDF", () => {
  it("lieu, devis de référence, retenue, assurance du profil, article 8, lieu de signature ; pas de rétractation ni de médiateur pour un professionnel", () => {
    const out = pdf(full({ devisRef: "DEV-014", retenueGarantiePct: "5", lieuSignature: "Lyon" }));
    expect(out).toContain("Lieu des travaux : 12 rue des Lilas, 69000 Lyon");
    expect(out).toContain("Documents contractuels : le présent contrat et le devis n° DEV-014");
    expect(out).toContain("Retenue de garantie : 5 % du montant des travaux");
    expect(out).toContain("loi n° 71-584");
    expect(out).toContain("Assurance décennale et responsabilité civile professionnelle : SMABTP, contrat n° P-42, couverture : France.");
    expect(out).toContain("Article 8 — Réception et garanties");
    expect(out).toContain("articles 1792 et suivants du Code civil");
    expect(out).toContain("Fait à Lyon, le 13/09/2026, en deux exemplaires originaux.");
    expect(out).not.toContain("Article 9");
    expect(out).not.toContain("Médiateur");
    expect(out).toContain("Montant total HT20 000,00 €");
  });
  it("particulier hors établissement : article 9 et médiateur ; particulier en établissement : médiateur seul", () => {
    const hors = pdf(full({ client: { type: "particulier", name: "M. Martin", address: "" }, horsEtablissement: true }));
    expect(hors).toContain("Article 9 — Droit de rétractation");
    expect(hors).toContain("quatorze jours");
    expect(hors).toContain("Médiateur de la consommation : CM2C — https://cm2c.net (art. L616-1 du Code de la consommation).");
    const dedans = pdf(full({ client: { type: "particulier", name: "M. Martin", address: "" }, horsEtablissement: false }));
    expect(dedans).not.toContain("Article 9");
    expect(dedans).toContain("Médiateur de la consommation");
  });
  it("ancien contrat sans les nouveaux champs ni profil : rendu inchangé, montants en euros", () => {
    const legacy = full(); for (const k of ["schemaVersion", "currency", "lieuTravaux", "devisRef", "retenueGarantiePct", "clauseReception", "horsEtablissement", "clauseRetractation", "lieuSignature"]) delete legacy[k];
    const out = pdf(legacy, null);
    expect(out).toContain("Montant total HT20 000,00 €");
    expect(out).not.toContain("Lieu des travaux");
    expect(out).not.toContain("Article 8");
    expect(out).not.toContain("Assurance décennale et responsabilité");
  });
  it("devise du contrat respectée", () => {
    expect(pdf(full({ currency: "MAD" }))).toContain("Montant total HT20 000,00 DH");
  });
});

describe("éditeur", () => {
  const props = { saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, companyProfile: profile };
  it("champs présents, obligatoires marqués, bouton actif sur un contrat complet", async () => {
    const { text, disabled } = await renderOnce(<ContratChantierEditor {...props} doc={full()} />);
    for (const l of ["Entreprise *", "Maître d'ouvrage (client) *", "Article 1 — Objet des travaux *", "Lieu des travaux *", "Devis de référence (optionnel)", "Retenue de garantie (%, optionnel)", "Article 8 — Réception et garanties", "Lieu de signature (optionnel)", "Professionnel", "Particulier"]) expect(text, l).toContain(l);
    expect(text).toContain("Montant total HT (");
    expect(text).not.toContain("Article 9");
    expect(disabled).toBe(false);
  });
  it("particulier : case hors établissement, puis article 9 quand elle est cochée", async () => {
    const part = await renderOnce(<ContratChantierEditor {...props} doc={full({ client: { type: "particulier", name: "M. Martin", address: "" } })} />);
    expect(part.text).toContain("Contrat conclu hors établissement");
    expect(part.text).not.toContain("Article 9");
    const hors = await renderOnce(<ContratChantierEditor {...props} doc={full({ client: { type: "particulier", name: "M. Martin", address: "" }, horsEtablissement: true })} />);
    expect(hors.text).toContain("Article 9 — Droit de rétractation");
  });
  it("nouveau contrat vide : bouton bloqué avec la liste", async () => {
    const { text, disabled } = await renderOnce(<ContratChantierEditor {...props} doc={newContratChantierDocument([])} />);
    expect(disabled).toBe(true);
    // Le nom de l'entreprise est repris de Mon entreprise (props.companyProfile) : plus réclamé.
    expect(text).toContain("Champs obligatoires manquants : Nom du maître d'ouvrage, Objet des travaux, Lieu des travaux, Montant total HT");
  });
});
