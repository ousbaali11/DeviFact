// @vitest-environment jsdom
// Audit des champs, étape C — facture d'acompte : échéance, ligne facturée
// générée par le bloc acompte (un seul montant), champs sans objet masqués,
// obligatoires marqués et contrôlés, phrase « à déduire de la facture
// définitive », anciens documents à lignes manuelles conservés.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Editor, PrintDocument, newDocument, computeTotals, documentValidationErrors, isDocumentEmpty, acompteLineFor, acompteAmountOf, hasManualAcompteLines, ACOMPTE_LINE_ID, emptyCompanyProfile, PLANS } from "./App.jsx";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
  window.scrollTo = () => {};
});

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const siteSettings = { name: "Chantiflow", landingPageVersion: "classique" };
const common = { saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, clients: [], products: [], stockByProduct: {}, companyProfile: emptyCompanyProfile(), onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop };
const base = () => ({ ...newDocument("acompte", []), sourceDevisRef: "DEV-014", montantMarcheHT: "1000", acomptePourcentage: 30, client: { ...newDocument("acompte", []).client, name: "Client SAS" } });
const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent;

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}

describe("facture d'acompte — modèle, ligne générée, validation", () => {
  it("modèle : TVA de l'acompte et pas de validité", () => {
    expect(newDocument("acompte", [])).toMatchObject({ acompteTva: 20, showValidity: false, dueDays: 30 });
  });
  it("ligne générée : 30 % de 1 000 → 300 HT, TVA du bloc, libellé avec la référence", () => {
    const line = acompteLineFor(base());
    expect(line).toMatchObject({ id: ACOMPTE_LINE_ID, type: "line", designation: "Acompte de 30 % sur le devis / marché DEV-014", qty: 1, unitPrice: 300, tva: 20 });
    expect(acompteLineFor({ ...base(), acompteMode: "montant_fixe", acompteMontantFixe: "250.5", acompteTva: 10 })).toMatchObject({ designation: "Acompte sur le devis / marché DEV-014", unitPrice: 250.5, tva: 10 });
    expect(acompteLineFor({ ...base(), montantMarcheHT: "" })).toBeNull();
    expect(acompteAmountOf({ montantMarcheHT: "999.99", acomptePourcentage: 33.333 })).toBe(333.33);
  });
  it("lignes manuelles détectées seulement si elles portent un contenu", () => {
    expect(hasManualAcompteLines(newDocument("acompte", []))).toBe(false); // ligne vide par défaut
    expect(hasManualAcompteLines({ items: [acompteLineFor(base())] })).toBe(false);
    expect(hasManualAcompteLines({ items: [{ id: "x", type: "line", designation: "Acompte saisi", unitPrice: 300 }] })).toBe(true);
  });
  it("validation : référence, montant du marché, montant de l'acompte, client", () => {
    expect(documentValidationErrors({ ...base(), items: [acompteLineFor(base())] })).toEqual([]);
    expect(documentValidationErrors({ ...base(), sourceDevisRef: "" })).toEqual(["Devis / marché d'origine (référence)"]);
    expect(documentValidationErrors({ ...base(), montantMarcheHT: "0" })).toEqual(["Montant total du marché HT", "Montant de l'acompte (pourcentage ou montant fixe)"]);
    expect(documentValidationErrors({ ...base(), acomptePourcentage: 0 })).toEqual(["Montant de l'acompte (pourcentage ou montant fixe)"]);
    expect(documentValidationErrors({ ...base(), client: { name: "" } })).toEqual(["Nom du client"]);
    // Ancien document : lignes manuelles acceptées à la place du montant calculé
    expect(documentValidationErrors({ ...base(), acomptePourcentage: 0, items: [{ id: "x", type: "line", designation: "Acompte saisi", unitPrice: 300 }] })).toEqual([]);
  });
  it("un acompte rempli seulement avec sa référence n'est pas vide", () => {
    expect(isDocumentEmpty({ ...newDocument("acompte", []), sourceDevisRef: "DEV-1" })).toBe(false);
    expect(isDocumentEmpty(newDocument("acompte", []))).toBe(true);
  });
});

describe("facture d'acompte — éditeur", () => {
  it("nouveau document rempli : ligne générée dans les données et affichée, Prestations masquées, échéance présente, validité et acompte demandé absents", async () => {
    const { container, unmount } = await mount(<Editor {...common} doc={base()} />);
    const text = container.textContent;
    expect(container.querySelector('[data-testid="acompte-generated-line"]')).toBeTruthy();
    expect(text).toContain("Acompte de 30 % sur le devis / marché DEV-014");
    expect(text).toContain("300,00");
    expect(text).toContain("Cet acompte sera déduit de la facture définitive.");
    expect(text).not.toContain("Prestations");
    expect(text).not.toContain("Depuis la bibliothèque");
    expect(text).toContain("Échéance (jours)");
    expect(text).not.toContain("Validité (jours)");
    expect(text).not.toContain("Acompte demandé (%)");
    expect(text).toContain("Devis / marché d'origine (référence) *");
    expect(text).toContain("Montant total du marché HT *");
    expect(text).toContain("Pourcentage d'acompte *");
    expect(text).toContain("TVA de l'acompte (%)");
    // Totaux calculés sur la ligne générée : 300 HT + 60 TVA = 360 TTC
    expect(text).toContain("360,00");
    await unmount();
  });
  it("nouveau document vide : bouton bloqué avec la liste, ligne non générée", async () => {
    const { container, unmount } = await mount(<Editor {...common} doc={newDocument("acompte", [])} />);
    expect(container.textContent).toContain("Champs obligatoires manquants : Devis / marché d'origine (référence), Montant total du marché HT, Montant de l'acompte (pourcentage ou montant fixe), Nom du client");
    expect(container.querySelector('[data-testid="acompte-generated-line"]')).toBeNull();
    expect(container.textContent).toContain("la ligne facturée sera générée automatiquement");
    await unmount();
  });
  it("ancien document à lignes manuelles : lignes conservées, section Prestations visible, avertissement", async () => {
    const legacy = { ...base(), items: [{ id: "x", type: "line", designation: "Acompte saisi à la main", details: [], qty: 1, unit: "", unitPrice: 300, tva: 20, discount: 0 }] };
    let last = null;
    const { container, unmount } = await mount(<Editor {...common} doc={legacy} onChange={(d) => { last = d; }} />);
    const text = container.textContent;
    expect(text).toContain("Prestations");
    expect(text).toContain("lignes saisies à la main");
    expect(container.querySelector('[data-testid="acompte-generated-line"]')).toBeNull();
    expect(last).toBeNull(); // rien n'a été réécrit
    await unmount();
  });
});

describe("facture d'acompte — PDF", () => {
  const pdf = (d) => textOf(renderToStaticMarkup(<PrintDocument doc={d} totals={computeTotals(d)} siteSettings={siteSettings} watermarkEnabled={false} />));
  it("un seul montant : la ligne générée fait le total ; échéance ; phrase de déduction ; pas de « Valable jusqu'au » ni d'acompte demandé hérité", () => {
    const d = { ...base(), items: [acompteLineFor(base())], acompte: 30, showValidity: true };
    const out = pdf(d);
    expect(out).toContain("Échéance :");
    expect(out).not.toContain("Valable jusqu'au");
    expect(out).toContain("Facture d'acompte sur devis / marché DEV-014");
    expect(out).toContain("Reste à facturer après cet acompte : 700,00");
    expect(out).toContain("Cet acompte sera déduit de la facture définitive.");
    expect(out).toContain("Acompte de 30 % sur le devis / marché DEV-014");
    expect(out).toContain("Total TTC360,00");
    expect(out).not.toContain("Acompte de 30%");
    expect(out).not.toContain("Reste à payer");
  });
});
