// @vitest-environment jsdom
// Audit des champs, étape C — révision de prix : trois bugs (décomptes
// encore imprimés et additionnés après retour en « Décompte unique »,
// écart écrit dans la colonne TVA de l'export comptable, note jamais
// enregistrée sans commentaire), date de la note, maître d'ouvrage,
// date des décomptes imprimée, champ isFinal supprimé, obligatoires.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { RevisionEditor, PrintRevision, newRevisionDocument, computeRevision, computeRevisionLine, getRevisionSectors, emptyRevisionSector, emptyDecompte, emptyMois, accountingExportRow, isDocumentEmpty, documentValidationErrors, documentSuggestedFields, REVISION_SECTORS, PLANS } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const siteSettings = { name: "Chantiflow" };
const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/[  ]/g, " ");

// Secteur : partie fixe 0,15, un terme BT01 poids 0,85 base 100.
// Décompte unique : index 110 → coefficient 1,085 → 10 000 révisés à 10 850, écart 850.
// Décompte (si activé) : 5 000 sur un mois à l'index 130 → coefficient 1,255 → écart 1 275.
function revisionDoc(extra = {}, sectorExtra = {}) {
  const sec = emptyRevisionSector(REVISION_SECTORS[0], "🇫🇷 FR");
  const term = sec.terms[0];
  Object.assign(term, { symbole: "BT01", poids: 0.85, indexBase: 100 });
  const mois = { ...emptyMois(), date: "2026-06-01", jours: 30, valeurs: { [term.id]: 130 } };
  const dec = { ...emptyDecompte(), label: "DP N°1", dateDecompte: "2026-06-30", montantTotal: 5000, mois: [mois] };
  Object.assign(sec, { coeffFixe: 0.15, tvaRate: 0.2, montantInitialHT: 10000, dateActuelle: "2026-06-01", valeursActuelles: { [term.id]: 110 }, useDecomptes: false, decomptes: [dec], ...sectorExtra });
  return { ...newRevisionDocument(REVISION_SECTORS[0], "🇫🇷 FR", []), docNumber: "REV-004", issueDate: "2026-09-13", marcheNumero: "TA 23/2026", company: { ...newRevisionDocument(REVISION_SECTORS[0], "🇫🇷 FR", []).company, name: "Bâti Plus" }, client: { name: "Commune de Lyon" }, sectors: [sec], ...extra };
}
const pdf = (d) => textOf(renderToStaticMarkup(<PrintRevision doc={d} siteSettings={siteSettings} watermarkEnabled={false} />));

describe("bugs corrigés", () => {
  it("décompte unique : le calcul vaut 850, et le PDF n'imprime ni n'additionne les décomptes résiduels", () => {
    const d = revisionDoc();
    const r = computeRevisionLine(getRevisionSectors(d)[0]);
    expect(r.valid).toBe(true);
    expect(Math.round(r.ecartMontant)).toBe(850);
    const out = pdf(d);
    expect(out).not.toContain("DP N°1");
    expect(out).toContain("TOTAL DE LA REVISION DES PRIX HTVA850,00 €");
  });
  it("plusieurs décomptes : le PDF imprime le décompte avec sa date et totalise 1 275", () => {
    const out = pdf(revisionDoc({}, { useDecomptes: true }));
    expect(out).toContain("DP N°1 — 30/06/2026");
    expect(out).toContain("TOTAL DE LA REVISION DES PRIX HTVA1 275,00 €");
    expect(Math.round(computeRevision(revisionDoc({}, { useDecomptes: true })).ecartMontant)).toBe(1275);
  });
  it("export comptable : écart HT 850, TVA 170, TTC 1 020 (avant : écart dans la colonne TVA)", () => {
    expect(accountingExportRow(revisionDoc()).slice(5)).toEqual([850, 170, 1020]);
  });
  it("une note sans commentaire mais avec un objet, un marché ou un montant n'est plus considérée vide", () => {
    const empty = newRevisionDocument(REVISION_SECTORS[0], "🇫🇷 FR", []);
    expect(isDocumentEmpty(empty)).toBe(true);
    expect(isDocumentEmpty({ ...empty, marcheNumero: "TA 1" })).toBe(false);
    expect(isDocumentEmpty({ ...empty, objet: "Assainissement" })).toBe(false);
    expect(isDocumentEmpty(revisionDoc({ marcheNumero: "", objet: "" }))).toBe(false); // montant initial renseigné
  });
});

describe("modèle, règles", () => {
  it("version de modèle, plus de champ isFinal sur un décompte", () => {
    expect(newRevisionDocument(REVISION_SECTORS[0], "🇫🇷 FR", []).schemaVersion).toBe(2);
    expect(emptyDecompte()).not.toHaveProperty("isFinal");
  });
  it("obligatoires : marché, entreprise, montant à réviser ; ancienne note seulement invitée", () => {
    expect(documentValidationErrors(revisionDoc())).toEqual([]);
    expect(documentValidationErrors(revisionDoc({ marcheNumero: "", company: { name: "" } }))).toEqual(["Marché N°", "Nom de l'entreprise"]);
    expect(documentValidationErrors(revisionDoc({}, { montantInitialHT: "" }))).toEqual(["Montant à réviser (montant initial ou décompte)"]);
    expect(documentValidationErrors(revisionDoc({}, { montantInitialHT: "", useDecomptes: true }))).toEqual([]); // décompte de 5 000
    const legacy = revisionDoc({ marcheNumero: "" }); delete legacy.schemaVersion;
    expect(documentValidationErrors(legacy)).toEqual([]);
    expect(documentSuggestedFields(legacy)).toEqual(["Marché N°"]);
  });
});

describe("PDF : date de la note et noms sous les signatures", () => {
  it("date de la note, entreprise et maître d'ouvrage", () => {
    const out = pdf(revisionDoc());
    expect(out).toContain("DATE DE LA NOTE :13 sept. 2026");
    expect(out).toContain("ENTREPRISE — BÂTI PLUS");
    expect(out).toContain("SERVICE / MAÎTRE D'OUVRAGE — COMMUNE DE LYON");
  });
});

describe("éditeur", () => {
  const props = { saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, clients: [], onSaveClient: noop };
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
  it("date de la note, maître d'ouvrage, obligatoires marqués ; note complète non bloquée", async () => {
    const { text, disabled } = await renderOnce(<RevisionEditor {...props} doc={revisionDoc()} />);
    expect(text).toContain("Date de la note");
    expect(text).toContain("Maître d'ouvrage (client)");
    expect(text).toContain("Marché N° *");
    expect(text).toContain("Entreprise *");
    expect(disabled).toBe(false);
  });
  it("nouvelle note vide : bouton bloqué avec la liste", async () => {
    const { text, disabled } = await renderOnce(<RevisionEditor {...props} doc={newRevisionDocument(REVISION_SECTORS[0], "🇫🇷 FR", [])} />);
    expect(disabled).toBe(true);
    expect(text).toContain("Champs obligatoires manquants : Marché N°, Nom de l'entreprise, Montant à réviser (montant initial ou décompte)");
  });
});
