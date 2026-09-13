// @vitest-environment jsdom
// Audit des champs, étape C — avoir : référence et motif obligatoires,
// date de la facture d'origine et règlement facultatifs, champs sans objet
// masqués (validité, acompte demandé), PDF et Excel cohérents.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Editor, PrintDocument, FinalizeButton, newDocument, computeTotals, documentValidationErrors, isDocumentEmpty, emptyCompanyProfile, PLANS } from "./App.jsx";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
  window.scrollTo = () => {};
});

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const siteSettings = { name: "Chantiflow", landingPageVersion: "classique" };
const common = { saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, clients: [], products: [], stockByProduct: {}, companyProfile: emptyCompanyProfile(), onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop };
const line = { id: "l1", type: "line", designation: "Carrelage", details: [], qty: 1, unitPrice: 100, unit: "", tva: 20, discount: 0 };
const fullAvoir = () => ({ ...newDocument("avoir", []), factureOrigineRef: "FAC-014", factureOrigineDate: "2026-08-02", motifAvoir: "Erreur de facturation", modeRemboursement: "Remboursement par virement", client: { ...newDocument("avoir", []).client, name: "Client SAS" }, items: [line] });

async function renderOnce(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  const html = container.innerHTML; const text = container.textContent;
  await act(async () => { root.unmount(); });
  container.remove();
  return { html, text };
}

describe("avoir — modèle et validation", () => {
  it("nouveaux champs présents, pas de validité par défaut", () => {
    const d = newDocument("avoir", []);
    expect(d).toMatchObject({ factureOrigineRef: "", factureOrigineDate: "", motifAvoir: "", modeRemboursement: "", showValidity: false });
  });
  it("un avoir complet passe ; chaque champ obligatoire manquant est nommé", () => {
    expect(documentValidationErrors(fullAvoir())).toEqual([]);
    expect(documentValidationErrors({ ...fullAvoir(), factureOrigineRef: " " })).toEqual(["Facture d'origine (numéro)"]);
    expect(documentValidationErrors({ ...fullAvoir(), motifAvoir: "" })).toEqual(["Motif de l'avoir"]);
    expect(documentValidationErrors({ ...fullAvoir(), client: { name: "" } })).toEqual(["Nom du client"]);
    expect(documentValidationErrors({ ...fullAvoir(), items: [{ ...line, designation: "" }] })).toEqual(["Au moins une ligne avec une désignation"]);
    expect(documentValidationErrors(newDocument("avoir", []))).toHaveLength(4);
  });
  it("un document ancien, sans version de modèle, n'est jamais bloqué", () => {
    expect(documentValidationErrors({ type: "commande", client: { name: "" }, items: [] })).toEqual([]);
    expect(documentValidationErrors({ type: "livraison", client: { name: "" }, items: [] })).toEqual([]);
  });
  it("un avoir rempli seulement avec sa référence et son motif n'est plus considéré vide", () => {
    expect(isDocumentEmpty({ ...newDocument("avoir", []), factureOrigineRef: "FAC-014" })).toBe(false);
    expect(isDocumentEmpty({ ...newDocument("avoir", []), motifAvoir: "Geste commercial" })).toBe(false);
    expect(isDocumentEmpty(newDocument("avoir", []))).toBe(true);
  });
});

describe("avoir — éditeur", () => {
  it("obligatoires marqués *, nouveaux champs présents, validité et acompte demandé masqués, bouton bloqué avec la liste", async () => {
    const { text, html } = await renderOnce(<Editor {...common} doc={newDocument("avoir", [])} />);
    expect(text).toContain("Facture d'origine (numéro) *");
    expect(text).toContain("Motif de l'avoir *");
    expect(text).toContain("Date de la facture d'origine (optionnel)");
    expect(text).toContain("Règlement de l'avoir (optionnel)");
    expect(text).toContain("Imputation sur la prochaine facture");
    expect(text).not.toContain("Validité (jours)");
    expect(text).not.toContain("Acompte demandé (%)");
    expect(html).toContain('data-testid="required-missing"');
    expect(text).toContain("Champs obligatoires manquants : Facture d'origine (numéro), Motif de l'avoir, Nom du client, Au moins une ligne avec une désignation");
    const btn = [...new DOMParser().parseFromString(html, "text/html").querySelectorAll("button")].find((b) => b.textContent.trim() === "Enregistrer");
    expect(btn.hasAttribute("disabled")).toBe(true);
  });
  it("avoir complet : pas de liste, bouton actif ; un devis n'affiche rien de tout ça", async () => {
    const { html } = await renderOnce(<Editor {...common} doc={fullAvoir()} />);
    expect(html).not.toContain('data-testid="required-missing"');
    const btn = [...new DOMParser().parseFromString(html, "text/html").querySelectorAll("button")].find((b) => b.textContent.trim() === "Enregistrer");
    expect(btn.hasAttribute("disabled")).toBe(false);
    const devis = await renderOnce(<Editor {...common} doc={newDocument("devis", [])} />);
    expect(devis.text).toContain("Validité (jours)");
    expect(devis.text).toContain("Acompte demandé (%)");
  });
  it("bouton partagé : sans erreurs, comportement inchangé", () => {
    const html = renderToStaticMarkup(<FinalizeButton doc={{ workStage: "brouillon" }} onFinalize={noop} siteSettings={siteSettings} />);
    expect(html).not.toContain("disabled");
    expect(html).toContain("Enregistrer");
  });
});

describe("avoir — PDF et Excel", () => {
  // Texte rendu (les apostrophes sont échappées dans le HTML statique).
  const pdf = (d) => new DOMParser().parseFromString(renderToStaticMarkup(<PrintDocument doc={d} totals={computeTotals(d)} siteSettings={siteSettings} watermarkEnabled={false} />), "text/html").body.textContent;
  it("PDF : facture d'origine avec sa date, motif, règlement ; ni « Valable jusqu'au » ni acompte demandé (même hérité)", () => {
    const d = { ...fullAvoir(), acompte: 30, showValidity: true }; // valeurs héritées d'un ancien avoir
    const out = pdf(d);
    expect(out).toContain("AVOIR sur la facture N° FAC-014 du 02 août 2026");
    expect(out).toContain("Motif : Erreur de facturation");
    expect(out).toContain("Règlement de l'avoir : Remboursement par virement");
    expect(out).not.toContain("Valable jusqu'au");
    expect(out).not.toContain("Acompte de 30%");
    expect(out).not.toContain("Reste à payer");
  });
  it("PDF : un devis garde sa validité et son acompte demandé", () => {
    const d = { ...newDocument("devis", []), acompte: 30, items: [line] };
    const out = pdf(d);
    expect(out).toContain("Valable jusqu'au");
    expect(out).toContain("Acompte de 30%");
  });
});
