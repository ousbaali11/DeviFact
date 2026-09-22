// @vitest-environment jsdom
// Couleurs des PDF : le réglage « Bandeaux » (pdfHeaderColor) ne colore que
// les bandeaux et filets ; le texte suit le réglage « Texte » (pdfTextColor),
// sombre par défaut. Avant, une seule couleur servait aux deux.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintDocument, PrintSituation, PrintRevision, PrintContrat, PrintRapportIntervention, PrintPvReception, PrintPlanning, PrintRelance, newDocument, newSituationDocument, newRevisionDocument, newContratChantierDocument, newRapportInterventionDocument, newPvReceptionDocument, newPlanningChantierDocument, newRelanceFormelleDocument, computeTotals, siteSettingsFromRow, DEFAULT_SITE_SETTINGS, REVISION_SECTORS } from "./App.jsx";

const RED = "#FF0000";
const BLUE = "#123456";
const base = { name: "Chantiflow", pdfHeaderColor: RED };
const facture = { ...newDocument("facture", []), docNumber: "F-001", items: [{ id: "l1", type: "line", designation: "Pose", details: [], qty: 1, unitPrice: 100, tva: 20, discount: 0 }] };
const renders = {
  facture: (ss) => renderToStaticMarkup(<PrintDocument doc={facture} totals={computeTotals(facture)} siteSettings={ss} watermarkEnabled={false} />),
  situation: (ss) => renderToStaticMarkup(<PrintSituation doc={newSituationDocument([])} siteSettings={ss} watermarkEnabled={false} />),
  revision: (ss) => renderToStaticMarkup(<PrintRevision doc={newRevisionDocument(REVISION_SECTORS[0].id, "FR", [])} siteSettings={ss} watermarkEnabled={false} />),
  contrat: (ss) => renderToStaticMarkup(<PrintContrat doc={newContratChantierDocument([])} siteSettings={ss} watermarkEnabled={false} />),
  rapport: (ss) => renderToStaticMarkup(<PrintRapportIntervention doc={newRapportInterventionDocument([])} siteSettings={ss} watermarkEnabled={false} />),
  pv: (ss) => renderToStaticMarkup(<PrintPvReception doc={newPvReceptionDocument([])} siteSettings={ss} watermarkEnabled={false} />),
  planning: (ss) => renderToStaticMarkup(<PrintPlanning doc={newPlanningChantierDocument([])} siteSettings={ss} watermarkEnabled={false} />),
  relance: (ss) => renderToStaticMarkup(<PrintRelance doc={newRelanceFormelleDocument([])} siteSettings={ss} watermarkEnabled={false} />),
};

describe("bandeaux et texte séparés", () => {
  for (const [name, render] of Object.entries(renders)) {
    it(`${name} : bandeaux rouges, texte sombre par défaut, texte bleu si réglé`, () => {
      const out = render(base);
      // Révision, planning et relance n'ont ni bandeau ni filet coloré : la
      // couleur des bandeaux n'y apparaît nulle part, et surtout pas sur le texte.
      const hasBand = !["revision", "planning", "relance"].includes(name);
      expect(out.includes(RED), "la couleur des bandeaux n'est utilisée que sur les bandeaux et filets").toBe(hasBand);
      expect(out, "le texte ne prend jamais la couleur des bandeaux").not.toMatch(/(?<![-a-z])color:#FF0000/i);
      expect(out, "le texte reste sombre").toMatch(/(?<![-a-z])color:#1B2A33/);
      const blue = render({ ...base, pdfTextColor: BLUE });
      expect(blue).toMatch(/(?<![-a-z])color:#123456/);
      expect(blue.includes(RED)).toBe(hasBand);
      expect(blue).not.toMatch(/(?<![-a-z])color:#1B2A33/);
    });
  }
});

describe("paramètres du site", () => {
  it("colonne pdf_text_color lue, sombre par défaut", () => {
    expect(siteSettingsFromRow({ id: 1, pdf_header_color: RED }).pdfTextColor).toBe("#1B2A33");
    expect(siteSettingsFromRow({ id: 1, pdf_text_color: BLUE }).pdfTextColor).toBe(BLUE);
    expect(DEFAULT_SITE_SETTINGS.pdfTextColor).toBe("#1B2A33");
  });
});
