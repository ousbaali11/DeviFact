// @vitest-environment jsdom
// Audit des champs, étape C — planning de chantier : adresse du chantier,
// responsable, avancement par tâche, statut réglable à la main, adresses
// imprimées, notes exportées, couleur de tâche retirée, tâche obligatoire.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanningChantierEditor, PrintPlanning, newPlanningChantierDocument, emptyTachePlanning, computeTacheStatutEffectif, documentValidationErrors, documentSuggestedFields, PLANS } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const siteSettings = { name: "Chantiflow" };
const tache = (extra = {}) => ({ ...emptyTachePlanning(), designation: "Gros œuvre", corpsMetier: "Maçon", dateDebut: "2026-10-01", dateFin: "2026-10-20", ...extra });
const full = (extra = {}) => ({ ...newPlanningChantierDocument([]), docNumber: "PLN-002", issueDate: "2026-09-13", objet: "Extension", adresseChantier: "12 rue des Lilas, Lyon", responsable: "Karim", company: { ...newPlanningChantierDocument([]).company, name: "Bâti Plus", address: "1 rue des Lilas" }, client: { ...newPlanningChantierDocument([]).client, name: "Mme Martin", address: "2 av. du Port" }, taches: [tache(), tache({ designation: "Charpente", corpsMetier: "Charpentier", dateDebut: "2026-10-21", dateFin: "2026-11-05", avancementPct: 40, statut: "en_cours" })], ...extra });
const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent;
const pdf = (d) => renderToStaticMarkup(<PrintPlanning doc={d} siteSettings={siteSettings} watermarkEnabled={false} />);

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
  it("nouveaux champs ; plus de couleur par tâche ; avancement", () => {
    expect(newPlanningChantierDocument([])).toMatchObject({ schemaVersion: 2, adresseChantier: "", responsable: "" });
    expect(emptyTachePlanning()).toMatchObject({ statut: "a_venir", avancementPct: 0 });
    expect(emptyTachePlanning()).not.toHaveProperty("couleur");
  });
  it("statut : automatique selon les dates, ou forcé à la main", () => {
    expect(computeTacheStatutEffectif({ statut: "a_venir", dateDebut: "2099-01-01", dateFin: "2099-01-10" })).toBe("a_venir");
    expect(computeTacheStatutEffectif({ statut: "a_venir", dateDebut: "2000-01-01", dateFin: "2000-01-10" })).toBe("retard");
    expect(computeTacheStatutEffectif({ statut: "en_cours", dateDebut: "2099-01-01", dateFin: "2099-01-10" })).toBe("en_cours");
    expect(computeTacheStatutEffectif({ statut: "retard", dateDebut: "2099-01-01", dateFin: "2099-01-10" })).toBe("retard");
    expect(computeTacheStatutEffectif({ statut: "termine", dateDebut: "2000-01-01", dateFin: "2000-01-10" })).toBe("termine");
  });
  it("obligatoire : une tâche nommée ; ancien planning invité seulement", () => {
    expect(documentValidationErrors(full())).toEqual([]);
    expect(documentValidationErrors({ ...full(), taches: [emptyTachePlanning()] })).toEqual(["Au moins une tâche avec une désignation"]);
    const legacy = { ...full(), taches: [emptyTachePlanning()] }; delete legacy.schemaVersion;
    expect(documentValidationErrors(legacy)).toEqual([]);
    expect(documentSuggestedFields(legacy)).toEqual(["Au moins une tâche avec une désignation"]);
  });
});

describe("PDF", () => {
  it("chantier, responsable, adresses de l'entreprise et du client, avancement et barre en deux tons", () => {
    const html = pdf(full());
    const out = textOf(html);
    expect(out).toContain("Chantier : 12 rue des Lilas, Lyon");
    expect(out).toContain("Responsable : Karim");
    expect(out).toContain("Client : Mme Martin — 2 av. du Port");
    expect(out).toContain("1 rue des Lilas");
    expect(out).toContain("Charpentier · 40 %");
    expect(html).toContain("width:40%");
  });
  it("ancien planning avec couleur de tâche : rendu inchangé", () => {
    const legacy = full(); delete legacy.schemaVersion; delete legacy.adresseChantier; delete legacy.responsable;
    legacy.taches = [{ ...tache(), couleur: "#8AA6C7" }]; delete legacy.taches[0].avancementPct;
    const out = textOf(pdf(legacy));
    expect(out).toContain("Gros œuvre");
    expect(out).not.toContain("Chantier :");
    expect(out).not.toContain("Responsable :");
  });
});

describe("éditeur", () => {
  const props = { saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop };
  it("champs présents : adresse, responsable, statut réglable, avancement ; bouton actif", async () => {
    const { text, html, disabled } = await renderOnce(<PlanningChantierEditor {...props} doc={full()} />);
    for (const l of ["Adresse du chantier (optionnel)", "Responsable / chef de chantier (optionnel)", "Tâches *", "Automatique (selon les dates)", "En retard", "Avancement"]) expect(text, l).toContain(l);
    expect((html.match(/<select/g) || []).length).toBe(2); // un statut par tâche
    expect(disabled).toBe(false);
  });
  it("planning sans tâche nommée : bouton bloqué", async () => {
    const { text, disabled } = await renderOnce(<PlanningChantierEditor {...props} doc={newPlanningChantierDocument([])} />);
    expect(disabled).toBe(true);
    expect(text).toContain("Champs obligatoires manquants : Au moins une tâche avec une désignation");
  });
});
