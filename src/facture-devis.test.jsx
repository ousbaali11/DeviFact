// @vitest-environment jsdom
// Audit des champs, étape C — facture et devis : nouveaux champs (date de
// prestation, début et durée des travaux, modalités et mode de règlement,
// pays du client, devis gratuit), mentions imprimées, règles obligatoires
// strictes pour les documents créés à partir de maintenant et simple
// invitation pour les documents plus anciens.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Editor, PrintDocument, newDocument, computeTotals, documentValidationErrors, documentSuggestedFields, documentFieldGaps, DOCUMENT_SCHEMA_VERSION, legalMentionLines, emptyCompanyProfile, PLANS } from "./App.jsx";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
  window.scrollTo = () => {};
});

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const siteSettings = { name: "Chantiflow", landingPageVersion: "classique" };
const common = { saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, clients: [], products: [], stockByProduct: {}, companyProfile: emptyCompanyProfile(), onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop };
const company = { ...emptyCompanyProfile(), name: "Bâti Plus", siret: "12345678900012", tva: "FR12345678900", iban: "FR76 1234 5678 9012", bic: "AGRIFRPP" };
const line = { id: "l1", type: "line", designation: "Carrelage", details: [], qty: 1, unitPrice: 100, unit: "", tva: 20, discount: 0 };
const client = { type: "entreprise", name: "Client SAS", address: "2 av. du Port", postalCode: "13000", city: "Marseille", country: "🇫🇷 FR", email: "", phone: "" };
const fullFacture = () => ({ ...newDocument("facture", []), docNumber: "FAC-001", company: { ...company }, client: { ...client }, items: [line], serviceDate: "2026-09-01" });
const fullDevis = () => ({ ...newDocument("devis", []), docNumber: "DEV-001", company: { ...company }, client: { ...client }, items: [line], worksStartDate: "2026-10-01", worksDuration: "3 semaines" });
const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent;
const pdf = (d) => textOf(renderToStaticMarkup(<PrintDocument doc={d} totals={computeTotals(d)} siteSettings={siteSettings} watermarkEnabled={false} />));

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
  it("nouveaux documents : version de modèle et nouveaux champs", () => {
    expect(newDocument("facture", [])).toMatchObject({ schemaVersion: DOCUMENT_SCHEMA_VERSION, serviceDate: "", serviceDateEnd: "", paymentMethod: "", sourceDevisNumber: "" });
    expect(newDocument("devis", [])).toMatchObject({ schemaVersion: DOCUMENT_SCHEMA_VERSION, worksStartDate: "", worksDuration: "", paymentTerms: "", freeQuote: true });
  });
  it("facture complète : aucune erreur ; chaque manque est nommé", () => {
    expect(documentValidationErrors(fullFacture())).toEqual([]);
    expect(documentValidationErrors({ ...fullFacture(), serviceDate: "" })).toEqual(["Date de la prestation"]);
    expect(documentValidationErrors({ ...fullFacture(), client: { ...client, city: "", country: "" } })).toEqual(["Ville du client", "Pays du client"]);
    expect(documentValidationErrors({ ...fullFacture(), company: { ...company, siret: "", tva: "" } })).toEqual(["SIRET de l'émetteur", "N° de TVA de l'émetteur (une ligne porte de la TVA)"]);
    expect(documentValidationErrors({ ...fullFacture(), company: { ...company, tva: "" }, items: [{ ...line, tva: 0 }] })).toEqual([]); // sans TVA, pas de n° exigé
    expect(documentValidationErrors({ ...fullFacture(), company: { ...company, type: "particulier", siret: "", tva: "" } })).toEqual([]);
  });
  it("devis complet : aucune erreur ; début, durée, validité, client, ligne", () => {
    expect(documentValidationErrors(fullDevis())).toEqual([]);
    expect(documentValidationErrors({ ...fullDevis(), worksStartDate: "", worksDuration: " " })).toEqual(["Début des travaux", "Durée estimée des travaux"]);
    expect(documentValidationErrors({ ...fullDevis(), validityDays: 0 })).toEqual(["Validité (jours)"]);
  });
  it("document ancien (sans version de modèle) : jamais bloquant, seulement une invitation", () => {
    const legacy = { type: "devis", docNumber: "DEV-000", issueDate: "2026-01-10", validityDays: 30, client: { name: "Ancien client" }, items: [line] };
    expect(documentValidationErrors(legacy)).toEqual([]);
    expect(documentSuggestedFields(legacy)).toEqual(["Début des travaux", "Durée estimée des travaux"]);
    expect(documentFieldGaps(legacy)).toEqual(["Début des travaux", "Durée estimée des travaux"]);
    const legacyAvoir = { type: "avoir", client: { name: "" }, items: [] };
    expect(documentValidationErrors(legacyAvoir)).toEqual([]);
    expect(documentSuggestedFields(legacyAvoir)).toHaveLength(4);
    // Document récent : strict
    expect(documentSuggestedFields(newDocument("devis", []))).toEqual([]);
    expect(documentValidationErrors(newDocument("devis", []))).toHaveLength(4); // la validité par défaut (30 jours) est déjà valide
  });
});

describe("éditeur", () => {
  it("facture : date de prestation *, période, pays du client, mode de règlement, titre « Client * »", async () => {
    const { text, html, disabled } = await renderOnce(<Editor {...common} doc={fullFacture()} />);
    expect(text).toContain("Prestation réalisée le *");
    expect(text).toContain("jusqu'au (si période)");
    expect(text).toContain("Mode de règlement");
    expect(text).toContain("Virement bancaire");
    expect(html).toContain("Pays du client (obligatoire sur la facture et pour Factur-X)"); // sélecteur de pays présent
    expect(text).toContain("🇫🇷 FR"); // valeur du client affichée
    expect(text).toContain("Client *");
    expect(html).not.toContain('data-testid="required-missing"');
    expect(disabled).toBe(false);
  });
  it("devis : début et durée *, devis gratuit, modalités de paiement, Factur-X annoncé comme préparé pour la facture", async () => {
    const { text, html } = await renderOnce(<Editor {...common} doc={fullDevis()} />);
    expect(text).toContain("Début des travaux *");
    expect(text).toContain("Durée estimée *");
    expect(text).toContain("Mentionner « Devis gratuit » sur le document");
    expect(text).toContain("Modalités de paiement");
    expect(text).toContain("Préparé pour la facture");
    expect(html).not.toContain('data-testid="required-missing"');
  });
  it("nouveau devis vide : bouton bloqué avec la liste ; ancien devis incomplet : bouton actif avec invitation", async () => {
    const fresh = await renderOnce(<Editor {...common} doc={newDocument("devis", [])} />);
    expect(fresh.disabled).toBe(true);
    expect(fresh.text).toContain("Champs obligatoires manquants : Nom du client, Au moins une ligne avec une désignation, Début des travaux, Durée estimée des travaux");
    const legacy = { ...newDocument("devis", []), schemaVersion: undefined, worksStartDate: undefined, worksDuration: undefined, freeQuote: undefined, client: { ...client }, items: [line] };
    delete legacy.schemaVersion;
    const old = await renderOnce(<Editor {...common} doc={legacy} />);
    expect(old.disabled).toBe(false);
    expect(old.html).toContain('data-testid="required-hints"');
    expect(old.text).toContain("À compléter si possible : Début des travaux, Durée estimée des travaux");
    expect(old.html).not.toContain('data-testid="required-missing"');
  });
});

describe("PDF et mentions", () => {
  it("facture : prestation, période, devis d'origine, chantier, règlement avec IBAN", () => {
    const d = { ...fullFacture(), serviceDateEnd: "2026-09-05", sourceDevisNumber: "DEV-014", deliveryAddress: "5 rue du Chantier", deliveryPostalCode: "13001", deliveryCity: "Marseille", paymentMethod: "Virement bancaire" };
    const out = pdf(d);
    expect(out).toContain("Prestation réalisée du 01 septembre 2026 au 05 septembre 2026");
    expect(out).toContain("D'après le devis N° DEV-014");
    expect(out).toContain("Chantier : 5 rue du Chantier, 13001 Marseille");
    // Mode de règlement et IBAN : dans le bloc de paiement, plus dans les mentions légales
    expect(out).toContain("Mode de règlement : Virement bancaire");
    expect(out).toContain("IBAN : FR76 1234 5678 9012");
    expect(out).toContain("BIC : AGRIFRPP");
    expect(out).not.toContain("Règlement : Virement bancaire");
    expect(pdf({ ...fullFacture() })).toContain("Prestation réalisée le 01 septembre 2026");
    expect(legalMentionLines({ ...fullFacture(), company: { ...company, iban: "" } }).join(" ")).not.toContain("Règlement");
  });
  it("devis : début et durée, modalités de paiement, « Devis gratuit » selon la case", () => {
    const d = { ...fullDevis(), paymentTerms: "30 % à la commande, solde à réception" };
    const out = pdf(d);
    expect(out).toContain("Début des travaux : 01 octobre 2026 — Durée estimée : 3 semaines");
    expect(out).toContain("Modalités de paiement : 30 % à la commande, solde à réception");
    expect(out).toContain("Devis gratuit.");
    expect(pdf({ ...fullDevis(), freeQuote: false })).not.toContain("Devis gratuit.");
    // Ancien devis sans la case : rien d'ajouté
    expect(pdf({ ...fullDevis(), freeQuote: undefined })).not.toContain("Devis gratuit.");
  });
});
