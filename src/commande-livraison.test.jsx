// @vitest-environment jsdom
// Audit des champs, étape C — bon de commande et bon de livraison.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Editor, PrintDocument, newDocument, computeTotals, documentValidationErrors, documentSuggestedFields, emptyCompanyProfile, PLANS } from "./App.jsx";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
  window.scrollTo = () => {};
});

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const siteSettings = { name: "Chantiflow", landingPageVersion: "classique" };
const common = { saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, clients: [], products: [], stockByProduct: {}, companyProfile: emptyCompanyProfile(), onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop };
const line = (extra = {}) => ({ id: "l1", type: "line", designation: "Sacs de ciment", details: [], qty: 8, unitPrice: 12, unit: "sac", tva: 20, discount: 0, ...extra });
const commande = (extra = {}) => ({ ...newDocument("commande", []), docNumber: "CMD-004", client: { ...newDocument("commande", []).client, name: "Point P" }, items: [line()], ...extra });
const livraison = (extra = {}) => ({ ...newDocument("livraison", []), docNumber: "BL-004", client: { ...newDocument("livraison", []).client, name: "Mme Martin" }, items: [line()], ...extra });
const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/[  ]/g, " ");
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

describe("bon de commande", () => {
  it("modèle et règles", () => {
    expect(newDocument("commande", [])).toMatchObject({ offreFournisseurRef: "", schemaVersion: 2, showValidity: true });
    expect(documentValidationErrors(commande())).toEqual([]);
    expect(documentValidationErrors(commande({ client: { name: "" }, items: [] }))).toEqual(["Nom du fournisseur", "Au moins une ligne avec une désignation"]);
    const legacy = commande({ client: { name: "" } }); delete legacy.schemaVersion;
    expect(documentValidationErrors(legacy)).toEqual([]);
    expect(documentSuggestedFields(legacy)).toEqual(["Nom du fournisseur"]);
  });
  it("PDF : bloc « Fournisseur », référence de l'offre, validité conservée, mention « Validation de l'acheteur » avec une signature", () => {
    const out = pdf(commande({ offreFournisseurRef: "offre 2026-118", signature: { mode: "texte", name: "Jean Dupont" } }));
    expect(out).toContain("FournisseurPoint P");
    expect(out).toContain("Référence de l'offre fournisseur : offre 2026-118");
    expect(out).toContain("Valable jusqu'au");
    expect(out).toContain("Validation de l'acheteurJean Dupont");
  });
  it("éditeur : titre « Fournisseur * », référence de l'offre, validité visible, signature relibellée", async () => {
    const { text, disabled } = await renderOnce(<Editor {...common} doc={commande()} />);
    expect(text).toContain("Fournisseur *");
    expect(text).toContain("Référence de l'offre ou du devis fournisseur (optionnel)");
    expect(text).toContain("Validité (jours)");
    expect(text).toContain("Validation de l'acheteur (optionnelle)");
    expect(disabled).toBe(false);
    const empty = await renderOnce(<Editor {...common} doc={newDocument("commande", [])} />);
    expect(empty.disabled).toBe(true);
    expect(empty.text).toContain("Champs obligatoires manquants : Nom du fournisseur, Au moins une ligne avec une désignation");
  });
});

describe("bon de livraison", () => {
  it("modèle et règles, réserves obligatoires si non conforme", () => {
    expect(newDocument("livraison", [])).toMatchObject({ transporteur: "", showValidity: false, showPrices: false });
    expect(documentValidationErrors(livraison())).toEqual([]);
    expect(documentValidationErrors(livraison({ etatLivraison: "reserves", reservesLivraison: "" }))).toEqual(["Détail des réserves (livraison non conforme)"]);
    expect(documentValidationErrors(livraison({ etatLivraison: "incomplete", reservesLivraison: "2 sacs manquants" }))).toEqual([]);
    expect(documentValidationErrors(livraison({ client: { name: "" } }))).toEqual(["Nom du destinataire"]);
  });
  it("PDF : ni validité ni acompte (même hérités), bloc « Livré à », transporteur, quantités commandées et reste, réception par le client", () => {
    const out = pdf(livraison({ showValidity: true, acompte: 30, transporteur: "Geodis, colis 12", items: [line({ qtyCommandee: 10 }), line({ id: "l2", designation: "Mortier", qty: 5 })], signature: { mode: "texte", name: "Mme Martin" } }));
    expect(out).not.toContain("Valable jusqu'au");
    expect(out).not.toContain("Acompte de 30%");
    expect(out).toContain("Livré àMme Martin");
    expect(out).toContain("Transporteur : Geodis, colis 12");
    expect(out).toContain("Qté cmd.");
    expect(out).toContain("Reste");
    expect(out).toContain("Sacs de ciment1082sac"); // commandé 10, livré 8, reste 2
    expect(out).toContain("Mortier5sac"); // pas de quantité commandée : cellules vides
    expect(out).toContain("Réception par le clientMme Martin");
    // Sans quantité commandée, pas de colonnes supplémentaires
    expect(pdf(livraison())).not.toContain("Qté cmd.");
  });
  it("éditeur : « Destinataire * », « Qté cmd. » et « Livré », transporteur, pas de validité ni d'acompte, signature relibellée, blocage si réserves manquantes", async () => {
    const ok = await renderOnce(<Editor {...common} doc={livraison()} />);
    for (const l of ["Destinataire *", "Qté cmd.", "Livré", "Transporteur (optionnel)", "Réception par le client (nom, date)"]) expect(ok.text, l).toContain(l);
    expect(ok.text).not.toContain("Validité (jours)");
    expect(ok.text).not.toContain("Acompte demandé (%)");
    expect(ok.disabled).toBe(false);
    const ko = await renderOnce(<Editor {...common} doc={livraison({ etatLivraison: "reserves" })} />);
    expect(ko.text).toContain("Détail des réserves *");
    expect(ko.disabled).toBe(true);
    expect(ko.text).toContain("Champs obligatoires manquants : Détail des réserves (livraison non conforme)");
  });
  it("les autres types gardent Qté, validité et acompte", async () => {
    const { text } = await renderOnce(<Editor {...common} doc={newDocument("devis", [])} />);
    expect(text).not.toContain("Qté cmd.");
    expect(text).toContain("Validité (jours)");
    expect(text).toContain("Signature du client (optionnelle)");
  });
});
