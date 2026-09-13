// @vitest-environment jsdom
// Audit des champs, étape C — rapport d'intervention : signature du
// technicien, prix unitaire optionnel du matériel avec total à reporter,
// adresse de l'entreprise et téléphone / e-mail du client imprimés,
// prochaine intervention exportée, champs obligatoires.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { RapportInterventionEditor, PrintRapportIntervention, newRapportInterventionDocument, emptyMaterielUtilise, computeMaterielTotal, documentValidationErrors, documentSuggestedFields, PLANS } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const siteSettings = { name: "Chantiflow", landingPageVersion: "classique" };
const full = (extra = {}) => ({ ...newRapportInterventionDocument([]), docNumber: "RI-005", issueDate: "2026-09-13", technicien: "Karim", motifAppel: "Fuite sous évier", company: { ...newRapportInterventionDocument([]).company, name: "Bâti Plus", address: "1 rue des Lilas", phone: "04 00", email: "contact@batiplus.fr" }, client: { ...newRapportInterventionDocument([]).client, name: "Mme Martin", address: "2 av. du Port", phone: "06 11", email: "m@exemple.fr" }, ...extra });
const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/[  ]/g, " ");
const pdf = (d) => textOf(renderToStaticMarkup(<PrintRapportIntervention doc={d} siteSettings={siteSettings} watermarkEnabled={false} />));

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
  it("nouveaux champs, total des fournitures", () => {
    const d = newRapportInterventionDocument([]);
    expect(d).toMatchObject({ schemaVersion: 2, signatureTechnicien: { name: "" } });
    expect(typeof d.currency).toBe("string");
    expect(emptyMaterielUtilise()).toMatchObject({ quantite: 1, prixUnitaireHT: "" });
    expect(computeMaterielTotal({ materielsUtilises: [{ quantite: 2, prixUnitaireHT: "12.5" }, { quantite: 3, prixUnitaireHT: "" }, { quantite: 1, prixUnitaireHT: "0" }] })).toBe(25);
  });
  it("obligatoires : client, technicien, motif ou travaux ; ancien rapport invité seulement", () => {
    expect(documentValidationErrors(full())).toEqual([]);
    expect(documentValidationErrors(full({ motifAppel: "", travauxRealises: "Remplacement du joint" }))).toEqual([]);
    expect(documentValidationErrors(full({ technicien: "", motifAppel: "" }))).toEqual(["Technicien", "Motif de l'appel ou travaux réalisés"]);
    const legacy = full({ technicien: "" }); delete legacy.schemaVersion;
    expect(documentValidationErrors(legacy)).toEqual([]);
    expect(documentSuggestedFields(legacy)).toEqual(["Technicien"]);
  });
});

describe("PDF", () => {
  it("adresse et e-mail de l'entreprise, téléphone et e-mail du client, signature du technicien", () => {
    const out = pdf(full({ signatureTechnicien: { name: "Karim B.", date: "2026-09-13" } }));
    expect(out).toContain("1 rue des Lilas");
    expect(out).toContain("contact@batiplus.fr");
    expect(out).toContain("06 11 · m@exemple.fr");
    expect(out).toContain("Le technicien");
    expect(out).toContain("Karim B.");
    expect(pdf(full())).not.toContain("Le technicien");
  });
  it("matériel : sans prix, tableau inchangé ; avec prix, colonnes et total à reporter", () => {
    const sans = pdf(full({ materielsUtilises: [{ ...emptyMaterielUtilise(), designation: "Joint", quantite: 2 }] }));
    expect(sans).toContain("Matériel utilisé");
    expect(sans).not.toContain("fournitures à facturer");
    const avec = pdf(full({ materielsUtilises: [{ ...emptyMaterielUtilise(), designation: "Joint", quantite: 2, prixUnitaireHT: "12.5" }, { ...emptyMaterielUtilise(), designation: "Main-d'œuvre incluse", quantite: 1 }] }));
    expect(avec).toContain("Matériel utilisé et fournitures à facturer");
    expect(avec).toContain("Total fournitures HT (à reporter sur la facture)25,00 €");
  });
});

describe("éditeur", () => {
  const props = { saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop };
  it("champs présents, obligatoires marqués, total des fournitures", async () => {
    const { text, disabled } = await renderOnce(<RapportInterventionEditor {...props} doc={full({ materielsUtilises: [{ ...emptyMaterielUtilise(), designation: "Joint", quantite: 2, prixUnitaireHT: "12.5" }] })} />);
    for (const l of ["Technicien *", "Client *", "Signature du technicien (optionnel)", "Total fournitures HT (à reporter sur la facture)"]) expect(text, l).toContain(l);
    expect(disabled).toBe(false);
  });
  it("nouveau rapport vide : bouton bloqué avec la liste", async () => {
    const { text, disabled } = await renderOnce(<RapportInterventionEditor {...props} doc={newRapportInterventionDocument([])} />);
    expect(disabled).toBe(true);
    expect(text).toContain("Champs obligatoires manquants : Nom du client, Technicien, Motif de l'appel ou travaux réalisés");
  });
});
