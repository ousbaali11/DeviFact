// @vitest-environment jsdom
// Audit des champs, étape C — PV de réception : début des travaux
// saisissable, lieu du chantier, maître d'œuvre présent, date de levée par
// réserve, référence légale des garanties, photos dans le PDF (y compris
// via l'export groupé), champs obligatoires.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { PvReceptionEditor, PrintPvReception, newPvReceptionDocument, emptyReserve, documentValidationErrors, documentSuggestedFields, PLANS } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const siteSettings = { name: "Chantiflow", landingPageVersion: "classique" };
const full = (extra = {}) => ({ ...newPvReceptionDocument([]), docNumber: "PV-003", issueDate: "2026-09-13", objet: "Rénovation salle de bain", dateReceptionEffective: "2026-09-10", company: { ...newPvReceptionDocument([]).company, name: "Bâti Plus" }, client: { ...newPvReceptionDocument([]).client, name: "Mme Martin" }, ...extra });
const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent;
const pdf = (d, photoUrls = {}) => renderToStaticMarkup(<PrintPvReception doc={d} siteSettings={siteSettings} watermarkEnabled={false} photoUrls={photoUrls} />);

async function renderOnce(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  const text = container.textContent; const html = container.innerHTML;
  const disabled = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Enregistrer")?.hasAttribute("disabled");
  await act(async () => { root.unmount(); });
  container.remove();
  return { text, html, disabled };
}

describe("modèle et règles", () => {
  it("nouveaux champs", () => {
    expect(newPvReceptionDocument([])).toMatchObject({ schemaVersion: 2, lieuChantier: "", maitreOeuvre: "", dateDebutTravaux: "" });
    expect(emptyReserve()).toMatchObject({ levee: false, dateLevee: "" });
  });
  it("obligatoires : entreprise, client, objet, date de réception, réserve si avec réserves ; ancien PV invité seulement", () => {
    expect(documentValidationErrors(full())).toEqual([]);
    expect(documentValidationErrors(full({ objet: "", dateReceptionEffective: "" }))).toEqual(["Objet", "Date de réception effective"]);
    expect(documentValidationErrors(full({ typeReception: "avec_reserves", reserves: [] }))).toEqual(["Au moins une réserve (réception avec réserves)"]);
    expect(documentValidationErrors(full({ typeReception: "avec_reserves", reserves: [{ ...emptyReserve(), description: "Fissure" }] }))).toEqual([]);
    const legacy = full({ objet: "" }); delete legacy.schemaVersion;
    expect(documentValidationErrors(legacy)).toEqual([]);
    expect(documentSuggestedFields(legacy)).toEqual(["Objet"]);
  });
});

describe("PDF", () => {
  it("lieu, début des travaux, maître d'œuvre, réserve levée avec sa date, référence légale des garanties", () => {
    const out = textOf(pdf(full({ lieuChantier: "12 rue des Lilas, Lyon", dateDebutTravaux: "2026-06-01", maitreOeuvre: "Cabinet Archi", typeReception: "avec_reserves", reserves: [{ ...emptyReserve(), description: "Joint à reprendre", localisation: "Douche", levee: true, dateLevee: "2026-09-12" }, { ...emptyReserve(), description: "Rayure porte", localisation: "Entrée" }] })));
    expect(out).toContain("Lieu du chantier : 12 rue des Lilas, Lyon");
    expect(out).toContain("Début des travaux : 01/06/2026");
    expect(out).toContain("Maître d'œuvre présent : Cabinet Archi");
    expect(out).toContain("Levée le 12/09/2026");
    expect(out).toContain("Non levée");
    expect(out).toContain("1792-6 du Code civil");
    expect(out).toContain("Garantie décennale — structure (10 ans)");
  });
  it("photos imprimées quand leurs adresses signées sont fournies (comme le fait désormais l'export groupé)", () => {
    const d = full({ photos: [{ id: "ph1", path: "org/doc/1.jpg", name: "1.jpg" }] });
    expect(pdf(d, {})).not.toContain("Photos de chantier");
    const out = pdf(d, { "org/doc/1.jpg": "https://exemple.test/signed/1.jpg" });
    expect(out).toContain("Photos de chantier");
    expect(out).toContain('src="https://exemple.test/signed/1.jpg"');
  });
});

describe("éditeur", () => {
  const props = { saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop };
  it("champs présents et obligatoires marqués ; date de levée seulement quand la réserve est levée", async () => {
    const { text, html, disabled } = await renderOnce(<PvReceptionEditor {...props} doc={full({ typeReception: "avec_reserves", reserves: [{ ...emptyReserve(), description: "Fissure", levee: true }, { ...emptyReserve(), description: "Rayure" }] })} />);
    for (const l of ["Date de réception effective *", "Début des travaux (optionnel)", "Lieu du chantier (optionnel)", "Objet *", "Entreprise *", "Client *", "Maître d'œuvre présent (optionnel)"]) expect(text, l).toContain(l);
    expect(text).toContain("1792-6");
    expect((html.match(/title="Date effective de levée de la réserve"/g) || []).length).toBe(1);
    expect(disabled).toBe(false);
  });
  it("nouveau PV vide : bouton bloqué avec la liste", async () => {
    const { text, disabled } = await renderOnce(<PvReceptionEditor {...props} doc={{ ...newPvReceptionDocument([]), dateReceptionEffective: "" }} />);
    expect(disabled).toBe(true);
    expect(text).toContain("Champs obligatoires manquants : Nom de l'entreprise, Nom du client, Objet, Date de réception effective");
  });
});
