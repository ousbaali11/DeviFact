// @vitest-environment jsdom
// Audit des champs, étape C — BPU et proforma.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Editor, PrintDocument, newDocument, computeTotals, documentValidationErrors, emptyCompanyProfile, PLANS } from "./App.jsx";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
  window.scrollTo = () => {};
});

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const siteSettings = { name: "Chantiflow", landingPageVersion: "classique" };
const common = { saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, clients: [], products: [], stockByProduct: {}, companyProfile: emptyCompanyProfile(), onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop };
const line = (extra = {}) => ({ id: "l1", type: "line", designation: "Carrelage 60x60 posé", details: [], qty: 100, unitPrice: 45, unit: "m²", tva: 20, discount: 0, ...extra });
const doc = (type, extra = {}) => ({ ...newDocument(type, []), docNumber: `${type.toUpperCase()}-002`, client: { ...newDocument(type, []).client, name: "Commune de Lyon" }, items: [line()], ...extra });
const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/[  ]/g, " ");
const pdf = (d) => textOf(renderToStaticMarkup(<PrintDocument doc={d} totals={computeTotals(d)} siteSettings={siteSettings} watermarkEnabled={false} />));

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

describe("bordereau de prix unitaires", () => {
  it("modèle : référence du marché, plus de dureeValidite ; règles", () => {
    const d = newDocument("bpu", []);
    expect(d).toMatchObject({ marcheRef: "", referenceRevision: "", schemaVersion: 2 });
    expect(d).not.toHaveProperty("dureeValidite");
    expect(documentValidationErrors(doc("bpu"))).toEqual([]);
    expect(documentValidationErrors(doc("bpu", { client: { name: "" }, items: [] }))).toEqual(["Nom du client", "Au moins une ligne avec une désignation"]);
  });
  it("PDF : n° de prix devant la désignation, référence du marché, quantités estimatives, ni acompte ni ancienne durée de validité", () => {
    const out = pdf(doc("bpu", { marcheRef: "marché 2026-07, lot 3", acompte: 30, dureeValidite: "12 mois", items: [line({ productRef: "P-101" }), line({ id: "l2", designation: "Plinthes", productRef: "" })] }));
    expect(out).toContain("N° prix / Désignation");
    expect(out).toContain("P-101 — Carrelage 60x60 posé");
    expect(out).toContain("Plinthes");
    expect(out).toContain("Référence du marché / de l'affaire : marché 2026-07, lot 3");
    expect(out).toContain("Qté estim.");
    expect(out).toContain("Montant total estimatif");
    expect(out).not.toContain("Acompte de 30%");
    expect(out).not.toContain("Durée de validité des prix");
    expect(out).toContain("Valable jusqu'au"); // la validité de l'en-tête reste
  });
  it("éditeur : n° de prix par ligne, référence du marché, pas d'acompte demandé", async () => {
    const { text, disabled } = await renderOnce(<Editor {...common} doc={doc("bpu")} />);
    expect(text).toContain("Référence du marché / de l'affaire (optionnel)");
    expect(text).not.toContain("Durée de validité des prix");
    expect(text).not.toContain("Acompte demandé (%)");
    expect(text).toContain("Validité (jours)");
    expect(disabled).toBe(false);
    const empty = await renderOnce(<Editor {...common} doc={newDocument("bpu", [])} />);
    expect(empty.disabled).toBe(true);
    // un devis n'a pas le champ n° de prix
    expect((await renderOnce(<Editor {...common} doc={doc("devis")} />)).text).not.toContain("N° prix");
  });
});

describe("facture proforma", () => {
  it("modèle : plus de doublon de devise ; règles", () => {
    const d = newDocument("proforma", []);
    expect(d.proforma).not.toHaveProperty("currency");
    expect(typeof d.currency).toBe("string");
    expect(documentValidationErrors(doc("proforma"))).toEqual([]);
    expect(documentValidationErrors(doc("proforma", { client: { name: "" } }))).toEqual(["Nom du client"]);
  });
  it("PDF : mention « ne vaut pas facture » ; la devise du document sert aux montants, l'ancienne devise libre n'est plus imprimée", () => {
    const out = pdf(doc("proforma", { currency: "USD", proforma: { ...newDocument("proforma", []).proforma, currency: "DOLLARS", incoterm: "FOB", incotermPlace: "Marseille" } }));
    expect(out).toContain("Facture pro forma : ce document ne vaut pas facture et n'a pas de valeur comptable.");
    expect(out).toContain("IncotermFOB — Marseille");
    expect(out).not.toContain("DOLLARS");
    expect(out).toContain("$");
    expect(pdf(doc("devis"))).not.toContain("ne vaut pas facture");
  });
  it("éditeur : plus de champ « Devise » libre dans le bloc international", async () => {
    const { text, disabled } = await renderOnce(<Editor {...common} doc={doc("proforma")} />);
    expect(text).toContain("Informations proforma (international)");
    expect(text).toContain("Incoterm");
    expect(text).not.toContain("EUR, USD...");
    expect(disabled).toBe(false);
  });
});
