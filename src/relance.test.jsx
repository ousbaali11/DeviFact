// @vitest-environment jsdom
// Audit des champs, étape C — relance formelle : professionnel / particulier
// (indemnité de 40 € réservée aux professionnels, art. L441-10 C. com.),
// niveau du courrier, référence imprimée, signataire, IBAN, devise,
// champs obligatoires (stricts pour les nouveaux courriers seulement).
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { RelanceFormelleEditor, PrintRelance, newRelanceFormelleDocument, RELANCE_NIVEAUX, documentValidationErrors, documentSuggestedFields, emptyCompanyProfile, PLANS } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const siteSettings = { name: "Chantiflow", landingPageVersion: "classique" };
const profile = { ...emptyCompanyProfile(), name: "Bâti Plus", iban: "FR76 1234", bic: "AGRIFRPP" };
const full = (extra = {}) => ({ ...newRelanceFormelleDocument([]), docNumber: "MED-007", issueDate: "2026-09-13", factureRef: "FAC-014", factureDate: "2026-07-01", montantDu: "1200", dateEcheanceOrigine: "2026-08-01", company: { ...newRelanceFormelleDocument([]).company, name: "Bâti Plus", address: "1 rue des Lilas" }, client: { ...newRelanceFormelleDocument([]).client, name: "Client SAS", address: "2 av. du Port" }, ...extra });
// Texte rendu, espaces insécables (formatage des montants) ramenées à des espaces simples.
const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/[  ]/g, " ");
const pdf = (d, companyProfile = null) => textOf(renderToStaticMarkup(<PrintRelance doc={d} siteSettings={siteSettings} watermarkEnabled={false} companyProfile={companyProfile} />));

async function renderOnce(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  const html = container.innerHTML; const text = container.textContent;
  const disabled = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Enregistrer")?.hasAttribute("disabled");
  await act(async () => { root.unmount(); });
  container.remove();
  return { html, text, disabled };
}

describe("modèle et règles", () => {
  it("nouveau courrier : niveau mise en demeure, signataire, devise, version de modèle", () => {
    const d = newRelanceFormelleDocument([]);
    expect(d).toMatchObject({ niveau: "mise_en_demeure", signataire: "", schemaVersion: 2 });
    expect(typeof d.currency).toBe("string");
    expect(d.currency.length).toBe(3);
    expect(RELANCE_NIVEAUX.map(([id]) => id)).toEqual(["relance1", "relance2", "mise_en_demeure"]);
  });
  it("obligatoires : facture, montant, débiteur, entreprise, date ; ancien courrier non bloqué", () => {
    expect(documentValidationErrors(full())).toEqual([]);
    expect(documentValidationErrors(full({ factureRef: "", montantDu: "0" }))).toEqual(["Facture concernée (référence)", "Montant dû"]);
    expect(documentValidationErrors(full({ client: { name: "" }, company: { name: "" } }))).toEqual(["Nom du client débiteur", "Nom de l'entreprise"]);
    const legacy = { type: "relance", factureRef: "", montantDu: "", client: { name: "" }, company: { name: "Bâti Plus" }, issueDate: "2026-01-01" };
    expect(documentValidationErrors(legacy)).toEqual([]);
    expect(documentSuggestedFields(legacy)).toEqual(["Facture concernée (référence)", "Montant dû", "Nom du client débiteur"]);
  });
});

describe("PDF", () => {
  it("professionnel : mise en demeure avec art. 1344, pénalités L441-10, indemnité 40 € D441-5, LRAR, référence, IBAN du profil", () => {
    const out = pdf(full({ signataire: "Jean Dupont, gérant" }), profile);
    expect(out).toContain("Réf. MED-007");
    expect(out).toContain("Envoyé par lettre recommandée avec accusé de réception");
    expect(out).toContain("MISE EN DEMEURE DE PAYER");
    expect(out).toContain("mettons en demeure (art. 1344 du Code civil)");
    expect(out).toContain("(art. L441-10 du Code de commerce)");
    expect(out).toContain("indemnité forfaitaire pour frais de recouvrement de 40,00 € (art. D441-5 du Code de commerce)");
    expect(out).toContain("Règlement par virement bancaire : IBAN FR76 1234 — BIC AGRIFRPP.");
    expect(out).toContain("Jean Dupont, gérant");
  });
  it("particulier : ni indemnité de 40 € ni Code de commerce, intérêts au taux légal (art. 1231-6 et 1344 C. civ.)", () => {
    const out = pdf(full({ client: { type: "particulier", name: "Mme Martin", address: "" } }));
    expect(out).not.toContain("40,00 €");
    expect(out).not.toContain("Code de commerce");
    expect(out).toContain("intérêts de retard au taux de 3 fois le taux d'intérêt légal courront à compter de la présente mise en demeure (art. 1231-6 et 1344 du Code civil)");
  });
  it("première et deuxième relance : titre, formule amiable, pas de LRAR ni de mise en demeure", () => {
    const r1 = pdf(full({ niveau: "relance1" }));
    expect(r1).toContain("PREMIÈRE RELANCE — FACTURE IMPAYÉE");
    expect(r1).toContain("Sauf erreur ou omission de notre part");
    expect(r1).toContain("Nous vous remercions de bien vouloir régler cette somme");
    expect(r1).toContain("nous serions contraints de vous adresser une mise en demeure");
    expect(r1).not.toContain("lettre recommandée");
    expect(r1).not.toContain("mettons en demeure");
    const r2 = pdf(full({ niveau: "relance2" }));
    expect(r2).toContain("DEUXIÈME RELANCE — FACTURE IMPAYÉE");
    expect(r2).toContain("Malgré notre première relance");
  });
  it("ancien courrier sans niveau ni devise : mise en demeure en euros, comme avant", () => {
    const legacy = full(); delete legacy.niveau; delete legacy.currency; delete legacy.signataire;
    const out = pdf(legacy);
    expect(out).toContain("MISE EN DEMEURE DE PAYER");
    expect(out).toContain("1 200,00 €");
    expect(out).not.toContain("IBAN");
  });
});

describe("éditeur", () => {
  const props = { saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, companyProfile: profile };
  it("niveau, professionnel / particulier, signataire, obligatoires marqués, référence affichée, devise dans le libellé", async () => {
    const { text, disabled } = await renderOnce(<RelanceFormelleEditor {...props} doc={full()} />);
    expect(text).toContain("Niveau du courrier");
    expect(text).toContain("Professionnel");
    expect(text).toContain("Particulier");
    expect(text).toContain("Facture concernée (référence) *");
    expect(text).toContain("Montant dû (");
    expect(text).toContain("Client débiteur *");
    expect(text).toContain("Entreprise *");
    expect(text).toContain("Référence du courrier : MED-007");
    expect(disabled).toBe(false);
  });
  it("particulier : le champ indemnité est remplacé par une explication", async () => {
    const { html } = await renderOnce(<RelanceFormelleEditor {...props} doc={full({ client: { type: "particulier", name: "Mme Martin", address: "" } })} />);
    expect(html).toContain('data-testid="indemnite-sans-objet"');
  });
  it("nouveau courrier vide : bouton bloqué avec la liste ; titre selon le niveau", async () => {
    const fresh = await renderOnce(<RelanceFormelleEditor {...props} doc={newRelanceFormelleDocument([])} />);
    expect(fresh.disabled).toBe(true);
    expect(fresh.text).toContain("Champs obligatoires manquants : Facture concernée (référence), Montant dû, Nom du client débiteur, Nom de l'entreprise");
    expect(fresh.text).toContain("Mise en demeure de payer");
    const r1 = await renderOnce(<RelanceFormelleEditor {...props} doc={full({ niveau: "relance1" })} />);
    expect(r1.text).toContain("Première relance de paiement");
  });
});
