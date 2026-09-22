// @vitest-environment jsdom
// Audit des champs, étape C — situation de travaux : export comptable au net
// à payer (correction d'un montant erroné), case « Cette situation vaut
// facture », période couverte, échéance et conditions, visa du maître
// d'œuvre, chantier et date modifiables, champ unité supprimé.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { SituationEditor, PrintSituation, newSituationDocument, computeSituation, createNextSituation, accountingExportRow, accountingLinesOf, newDocument, documentValidationErrors, documentSuggestedFields, legalMentionLines, emptyCompanyProfile, PLANS } from "./App.jsx";
import { isSale } from "./kpis.js";
import { isSalesDocument, buildSalesEntries } from "./accounting.js";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const siteSettings = { name: "Chantiflow", landingPageVersion: "classique" };
const profile = { ...emptyCompanyProfile(), name: "Bâti Plus", legalForm: "SARL", capital: "5 000 €", registration: "RCS Lyon 1", iban: "FR76 1234" };
const line = { id: "s1", type: "line", designation: "Gros œuvre", qty: 1, unitPrice: 10000, tva: 20, avancementPct: 30, montantCumulePrecedent: 2000 }; // marché 10 000, cumul 3 000, déjà 2 000 → cette situation 1 000 HT
const full = (extra = {}) => ({ ...newSituationDocument([]), docNumber: "SIT-003", issueDate: "2026-09-13", numeroSituation: 2, marcheNumero: "M-2026-1", periodeDebut: "2026-08-01", periodeFin: "2026-08-31", company: { ...newSituationDocument([]).company, name: "Bâti Plus" }, client: { ...newSituationDocument([]).client, name: "Client SAS" }, items: [line], retenueGarantiePct: 5, acompteVerse: 100, status: "envoyée", ...extra });
const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/[  ]/g, " ");
const pdf = (d) => textOf(renderToStaticMarkup(<PrintSituation doc={d} siteSettings={siteSettings} watermarkEnabled={false} companyProfile={profile} />));

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

describe("export comptable — bug du TTC brut", () => {
  it("situation : 1 000 HT, 200 TVA, retenue 5 % de 1 200 = 60, acompte 100 → TTC exporté = net à payer 1 040 (avant : 1 200)", () => {
    const sit = computeSituation(full());
    expect(sit.subtotalHT).toBe(1000);
    expect(sit.totalTTCBrut).toBe(1200);
    expect(sit.netAPayer).toBe(1040);
    const row = accountingExportRow(full());
    expect(row.slice(0, 5)).toEqual(["Situation de travaux", "SIT-003", "13 sept. 2026", "Client SAS", "envoyée"]);
    expect(row.slice(5)).toEqual([1000, 200, 1040]);
  });
  it("les autres types gardent leurs colonnes", () => {
    const f = { ...newDocument("facture", []), docNumber: "FAC-1", issueDate: "2026-09-13", client: { name: "C" }, status: "payée", items: [{ id: "l", type: "line", designation: "x", details: [], qty: 2, unitPrice: 50, tva: 20, discount: 0 }] };
    expect(accountingExportRow(f).slice(5)).toEqual([100, 20, 120]);
    expect(accountingExportRow({ type: "relance", docNumber: "MED-1", issueDate: "2026-09-13", client: { name: "C" }, status: "brouillon", montantDu: "42" }).slice(5)).toEqual(["", "", 42]);
    expect(accountingExportRow({ type: "contrat", docNumber: "CTR-1", issueDate: "2026-09-13", client: { name: "C" }, status: "brouillon", montantTotalHT: "1000", tva: 10 }).slice(5)).toEqual([1000, 100, 1100]);
  });
});

describe("« vaut facture » : comptabilité et indicateurs", () => {
  it("écritures et ventes : seulement quand la case est cochée ; lignes au montant de la situation", () => {
    expect(isSalesDocument(full())).toBe(false);
    expect(isSalesDocument(full({ vautFacture: true }))).toBe(true);
    expect(isSalesDocument(full({ vautFacture: true, status: "brouillon" }))).toBe(false);
    expect(isSale(full({ vautFacture: true, status: "payée" }))).toBe(true);
    expect(isSale(full({ status: "payée" }))).toBe(false);
    expect(accountingLinesOf(full())).toEqual([{ productId: undefined, totalHT: 1000, tva: 20 }]);
    const entries = buildSalesEntries([full({ vautFacture: true })], { computeLines: accountingLinesOf });
    expect(entries.find((e) => e.account === "411000")).toMatchObject({ debit: 1200, label: "Facture de situation SIT-003 - Client SAS" });
    expect(entries.find((e) => e.account === "706000")).toMatchObject({ credit: 1000 });
  });
});

describe("modèle, règles, chaînage", () => {
  it("nouveaux champs, plus de champ unité sur les lignes", () => {
    const d = newSituationDocument([]);
    expect(d).toMatchObject({ schemaVersion: 2, periodeDebut: "", periodeFin: "", vautFacture: false, dueDays: 30, paymentTerms: "", visaMaitreOeuvre: "" });
    expect(d.items[0]).not.toHaveProperty("unit");
  });
  it("obligatoires : client, poste, période ; ancienne situation seulement invitée", () => {
    expect(documentValidationErrors(full())).toEqual([]);
    expect(documentValidationErrors(full({ periodeDebut: "", periodeFin: "" }))).toEqual(["Période couverte (du)", "Période couverte (au)"]);
    const legacy = { type: "situation", client: { name: "C" }, items: [line] };
    expect(documentValidationErrors(legacy)).toEqual([]);
    expect(documentSuggestedFields(legacy)).toEqual(["Période couverte (du)", "Période couverte (au)"]);
  });
  it("situation suivante : chantier et réglages de facturation repris, période remise à zéro, cumul repris", () => {
    const next = createNextSituation(full({ chantier: "Villa Martin", vautFacture: true, paymentTerms: "30 jours", visaMaitreOeuvre: "Cabinet X" }), []);
    expect(next).toMatchObject({ numeroSituation: 3, chantier: "Villa Martin", vautFacture: true, paymentTerms: "30 jours", visaMaitreOeuvre: "Cabinet X", periodeDebut: "", periodeFin: "" });
    expect(next.items[0]).toMatchObject({ montantCumulePrecedent: 3000 });
    expect(next.items[0]).not.toHaveProperty("unit");
  });
});

describe("PDF", () => {
  it("document d'avancement : période, chantier, début des travaux, visa ; ni échéance ni mentions de facture", () => {
    const out = pdf(full({ chantier: "Villa Martin", dateDebut: "2026-06-01", visaMaitreOeuvre: "Cabinet X", paymentTerms: "30 jours fin de mois" }));
    expect(out).toContain("SITUATION DE TRAVAUX N° 2");
    expect(out).toContain("Période : du 01/08/2026 au 31/08/2026");
    expect(out).toContain("Chantier : Villa Martin");
    expect(out).toContain("Début des travaux : 01/06/2026");
    expect(out).toContain("Conditions de paiement : 30 jours fin de mois");
    expect(out).toContain("Visa du maître d'œuvreCabinet X");
    expect(out).not.toContain("Échéance");
    expect(out).not.toContain("Pénalités de retard");
    expect(out).toContain("Net à payer1 040,00 €");
  });
  it("vaut facture : titre, échéance, bloc de mentions légales de facture", () => {
    const out = pdf(full({ vautFacture: true, dueDays: 30 }));
    expect(out).toContain("FACTURE DE SITUATION N° 2");
    expect(out).toContain("Échéance : 13/10/2026");
    expect(out).toContain("SARL au capital de 5 000 € — RCS Lyon 1");
    expect(out).not.toContain("Pénalités de retard"); // aucune phrase automatique de paiement
    expect(out).toContain("IBAN FR76 1234");
    expect(legalMentionLines({ ...full({ vautFacture: true }), type: "facture" }, profile).length).toBeGreaterThan(1);
  });
});

describe("éditeur", () => {
  const props = { documents: [], saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onCreateNext: noop, onGoToPricing: noop, companyProfile: profile };
  it("champs présents : date, chantier, période *, case vaut facture, conditions, visa, client * ; échéance seulement si la case est cochée", async () => {
    const off = await renderOnce(<SituationEditor {...props} doc={full()} />);
    expect(off.text).toContain("Période couverte : du *");
    expect(off.text).toContain("Chantier (regroupement)");
    expect(off.text).toContain("Cette situation vaut facture");
    expect(off.text).toContain("Conditions de paiement (optionnel)");
    expect(off.text).toContain("Visa du maître d'œuvre (optionnel)");
    expect(off.text).toContain("Client *");
    expect(off.text).not.toContain("Échéance de paiement (jours)");
    expect(off.disabled).toBe(false);
    const on = await renderOnce(<SituationEditor {...props} doc={full({ vautFacture: true })} />);
    expect(on.text).toContain("Échéance de paiement (jours)");
  });
  it("nouvelle situation vide : bouton bloqué ; ancienne : invitation seulement", async () => {
    const fresh = await renderOnce(<SituationEditor {...props} doc={newSituationDocument([])} />);
    expect(fresh.disabled).toBe(true);
    expect(fresh.text).toContain("Champs obligatoires manquants : Nom du client, Au moins un poste avec une désignation, Période couverte (du), Période couverte (au)");
    const legacy = full(); delete legacy.schemaVersion; legacy.periodeDebut = ""; legacy.periodeFin = "";
    const old = await renderOnce(<SituationEditor {...props} doc={legacy} />);
    expect(old.disabled).toBe(false);
    expect(old.text).toContain("À compléter si possible : Période couverte (du), Période couverte (au)");
  });
});
