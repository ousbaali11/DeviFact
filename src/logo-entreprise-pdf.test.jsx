// @vitest-environment jsdom
// Logo de l'entreprise en tête des PDF (01/10/2026) : le logo importé dans
// Mon entreprise apparaît au-dessus du nom, complet (object-fit contain),
// 1,5 cm de haut, aussi large que le nom (largeur 100 % d'un bloc calé sur le
// nom) ; le logo de la fiche à jour l'emporte sur la copie du document ; sans
// logo, rien ne change ; présent sur facture, situation, PV, rapport, contrat,
// relance et planning.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintCompanyIdentity, PrintDocument, PrintSituation, PrintPvReception, PrintRapportIntervention, PrintContrat, PrintRelance, PrintPlanning, newDocument, newSituationDocument, newPvReceptionDocument, newRapportInterventionDocument, newContratChantierDocument, newRelanceFormelleDocument, newPlanningChantierDocument, computeTotals, emptyCompanyProfile } from "./App.jsx";

const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const profile = { ...emptyCompanyProfile(), name: "Stratos consulting EI", logo: LOGO };
const logoImgs = (markup) => [...markup.matchAll(/<img src="data:image\/png[^"]*" alt="Logo" class="print-company-logo" style="([^"]*)"/g)].map((m) => m[1]);
const siteSettings = { name: "Chantiflow" };

describe("PrintCompanyIdentity", () => {
  it("logo complet, 1,5 cm de haut, largeur du bloc = celle du nom (max-content), nom dessous", () => {
    const markup = renderToStaticMarkup(<PrintCompanyIdentity logo={LOGO} name="Stratos consulting EI" nameStyle={{ fontWeight: 700 }} />);
    const [style] = logoImgs(markup);
    expect(style).toContain("height:1.5cm");
    expect(style).toContain("object-fit:contain");
    expect(style).toContain("width:100%");
    expect(markup).toContain("width:max-content");
    expect(markup.indexOf("print-company-logo")).toBeLessThan(markup.indexOf("Stratos consulting EI"));
    expect(renderToStaticMarkup(<PrintCompanyIdentity logo={null} name="Sans logo" />)).not.toContain("<img");
    expect(renderToStaticMarkup(<PrintCompanyIdentity logo={LOGO} name="" />)).toContain("width:4cm"); // sans nom : largeur fixe
    expect(renderToStaticMarkup(<PrintCompanyIdentity logo={null} name="" />)).toBe("");
  });
});

describe("en-têtes des PDF", () => {
  it("facture : logo de Mon entreprise au-dessus du nom, même si la copie du document n'en a pas ; sans logo nulle part : aucun", () => {
    const doc = { ...newDocument("facture", []), docNumber: "FAC-1", items: [], company: { ...newDocument("facture", []).company, name: "Stratos consulting EI", logo: "" } };
    const withProfile = renderToStaticMarkup(<PrintDocument doc={doc} totals={computeTotals(doc)} siteSettings={siteSettings} watermarkEnabled={false} companyProfile={profile} />);
    expect(logoImgs(withProfile)).toHaveLength(1);
    expect(withProfile.indexOf("print-company-logo")).toBeLessThan(withProfile.indexOf("Stratos consulting EI"));
    const copyOnly = renderToStaticMarkup(<PrintDocument doc={{ ...doc, company: { ...doc.company, logo: LOGO } }} totals={computeTotals(doc)} siteSettings={siteSettings} watermarkEnabled={false} companyProfile={null} />);
    expect(logoImgs(copyOnly)).toHaveLength(1); // copie du document en secours
    const none = renderToStaticMarkup(<PrintDocument doc={doc} totals={computeTotals(doc)} siteSettings={siteSettings} watermarkEnabled={false} companyProfile={{ ...profile, logo: null }} />);
    expect(logoImgs(none)).toHaveLength(0);
    expect(none).toContain("Stratos consulting EI");
  });
  it("situation, PV, rapport, contrat, relance, planning : logo au-dessus du nom", () => {
    const company = { ...newDocument("facture", []).company, name: "Stratos consulting EI", logo: "" };
    const cases = [
      ["situation", () => <PrintSituation doc={{ ...newSituationDocument([]), docNumber: "SIT-1", company }} siteSettings={siteSettings} watermarkEnabled={false} companyProfile={profile} />],
      ["pv", () => <PrintPvReception doc={{ ...newPvReceptionDocument([]), docNumber: "PV-1", company }} siteSettings={siteSettings} watermarkEnabled={false} companyProfile={profile} />],
      ["rapport", () => <PrintRapportIntervention doc={{ ...newRapportInterventionDocument([]), docNumber: "RAP-1", company }} siteSettings={siteSettings} watermarkEnabled={false} companyProfile={profile} />],
      ["contrat", () => <PrintContrat doc={{ ...newContratChantierDocument([]), docNumber: "CTR-1", company }} siteSettings={siteSettings} watermarkEnabled={false} companyProfile={profile} />],
      ["relance", () => <PrintRelance doc={{ ...newRelanceFormelleDocument([]), docNumber: "REL-1", company }} siteSettings={siteSettings} watermarkEnabled={false} companyProfile={profile} />],
      ["planning", () => <PrintPlanning doc={{ ...newPlanningChantierDocument([]), docNumber: "PLN-1", company }} siteSettings={siteSettings} watermarkEnabled={false} companyProfile={profile} />],
    ];
    for (const [label, element] of cases) {
      const markup = renderToStaticMarkup(element());
      expect(logoImgs(markup), label).toHaveLength(1);
      expect(markup.indexOf("print-company-logo"), label).toBeLessThan(markup.indexOf("Stratos consulting EI"));
      expect(logoImgs(markup)[0], label).toContain("height:1.5cm");
    }
  });
});
