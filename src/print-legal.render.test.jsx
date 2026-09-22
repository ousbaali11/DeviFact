// @vitest-environment jsdom
// Audit des champs, étape B : bloc de mentions légales imprimé sur le PDF
// classique des devis, factures, factures d'acompte et avoirs.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintDocument, legalMentionLines, computeTotals, newDocument, emptyCompanyProfile } from "./App.jsx";

const profile = { ...emptyCompanyProfile(), name: "Bâti Plus", siret: "12345678900012", address: "1 rue des Lilas", postalCode: "69000", city: "Lyon", tva: "FR12345678900", legalForm: "SARL", capital: "5 000 €", registration: "RCS Lyon 123 456 789", insuranceName: "SMABTP", insurancePolicy: "P-42", insuranceZone: "France métropolitaine", mediatorName: "CM2C", mediatorContact: "https://cm2c.net" };
const line = (tva = 20) => ({ id: "l1", type: "line", designation: "Carrelage", details: [], qty: 10, unitPrice: 25, unit: "m²", tva, discount: 0 });
function doc(type, extra = {}, company = profile) {
  return { ...newDocument(type, []), docNumber: `${type.toUpperCase()}-001`, company: { ...company }, client: { type: "entreprise", name: "Client SAS", address: "2 av. du Port", postalCode: "13000", city: "Marseille", email: "", phone: "" }, items: [line()], ...extra };
}
const html = (d, companyProfile = null) => renderToStaticMarkup(<PrintDocument doc={d} totals={computeTotals(d)} siteSettings={{ name: "Chantiflow" }} watermarkEnabled={false} companyProfile={companyProfile} />);
const PENALITES = "Pénalités de retard : trois fois le taux d'intérêt légal";
const INDEMNITE = "Indemnité forfaitaire pour frais de recouvrement : 40 €";

describe("mentions légales sur le PDF (étape B)", () => {
  it("facture à un professionnel : forme, RCS, décennale ; jamais de phrase automatique sur les pénalités, les 40 € ou l'escompte ; pas de médiateur", () => {
    const lines = legalMentionLines(doc("facture"));
    expect(lines[0]).toBe("SARL au capital de 5 000 € — RCS Lyon 123 456 789");
    expect(lines[1]).toBe("Assurance décennale et responsabilité civile professionnelle : SMABTP, contrat n° P-42, couverture : France métropolitaine.");
    expect(lines.join(" ")).not.toContain(PENALITES);
    expect(lines.join(" ")).not.toContain(INDEMNITE);
    expect(lines.join(" ")).not.toContain("escompte");
    expect(lines.join(" ")).not.toContain("Médiateur");
    const out = html(doc("facture"));
    expect(out).toContain('class="print-legal"');
    expect(out).toContain("RCS Lyon 123 456 789");
    expect(out).not.toContain(INDEMNITE);
  });
  it("facture à un particulier : pas de pénalités ni de 40 € (art. L441-10 : professionnels seulement), médiateur imprimé", () => {
    const d = doc("facture"); d.client.type = "particulier";
    const lines = legalMentionLines(d);
    expect(lines.join(" ")).not.toContain(INDEMNITE);
    expect(lines.join(" ")).not.toContain(PENALITES);
    expect(lines.join(" ")).toContain("Médiateur de la consommation : CM2C — https://cm2c.net (art. L616-1 du Code de la consommation).");
  });
  it("facture d'acompte : mêmes mentions qu'une facture, sans phrase automatique de paiement ; avoir : identité et assurance seulement", () => {
    expect(legalMentionLines(doc("acompte")).join(" ")).not.toContain(INDEMNITE);
    expect(legalMentionLines(doc("acompte"))).toEqual(legalMentionLines(doc("facture")));
    const avoir = legalMentionLines(doc("avoir"));
    expect(avoir).toHaveLength(2);
    expect(avoir.join(" ")).not.toContain(PENALITES);
  });
  it("devis : identité, assurance et « Devis gratuit », pas de mentions de paiement ; médiateur si particulier", () => {
    const pro = legalMentionLines(doc("devis"));
    expect(pro).toHaveLength(3);
    expect(pro[2]).toBe("Devis gratuit.");
    const d = doc("devis"); d.client.type = "particulier";
    expect(legalMentionLines(d).join(" ")).toContain("Médiateur");
  });
  it("TVA : mention d'exonération si une ligne est à 0 % selon le motif choisi ; option débits sur facture", () => {
    expect(legalMentionLines(doc("facture", { items: [line(0)], vatExemptionReason: "franchise" })).join(" ")).toContain("TVA non applicable, art. 293 B du CGI.");
    expect(legalMentionLines(doc("facture", { items: [line(0)], vatExemptionReason: "autoliquidation" })).join(" ")).toContain("art. 283 du CGI");
    expect(legalMentionLines(doc("facture", { items: [line(20)], vatExemptionReason: "franchise" })).join(" ")).not.toContain("293 B");
    expect(legalMentionLines(doc("facture", {}, { ...profile, vatOnDebits: true })).join(" ")).toContain("TVA acquittée d'après les débits.");
    expect(legalMentionLines(doc("devis", {}, { ...profile, vatOnDebits: true })).join(" ")).not.toContain("débits");
  });
  it("document créé avant l'étape A (copie du profil sans les nouveaux champs) : reprise depuis le profil courant", () => {
    const legacyCompany = { type: "entreprise", name: "Bâti Plus", siret: "123", address: "1 rue", country: "", email: "", phone: "", tva: "", logo: null };
    const d = doc("facture", {}, legacyCompany);
    expect(legalMentionLines(d, null)).toEqual([]); // sans profil ni mention : rien
    const withProfile = legalMentionLines(d, profile);
    expect(withProfile[0]).toBe("SARL au capital de 5 000 € — RCS Lyon 123 456 789");
    expect(withProfile[1]).toContain("SMABTP");
  });
  it("mention EI accolée au nom, dans l'en-tête et le bloc émetteur, sans doublon", () => {
    const out = html(doc("devis", {}, { ...profile, name: "Jean Dupont", legalForm: "Micro-entreprise", capital: "", registration: "RM 69 123 456 789", entrepreneurIndividuel: true }));
    expect(out.split("Jean Dupont EI").length - 1).toBe(2);
    expect(out).toContain("Micro-entreprise EI — RM 69 123 456 789");
    const already = html(doc("devis", {}, { ...profile, name: "Jean Dupont EI", entrepreneurIndividuel: true }));
    expect(already).not.toContain("Jean Dupont EI EI");
  });
  it("rien n'est imprimé sur les autres types, ni sans aucune donnée légale et client particulier", () => {
    expect(legalMentionLines(doc("commande"))).toEqual([]);
    expect(legalMentionLines(doc("livraison"))).toEqual([]);
    const d = doc("devis", { freeQuote: false }, { type: "entreprise", name: "X" }); d.client.type = "particulier";
    expect(legalMentionLines(d)).toEqual([]);
    expect(html(d)).not.toContain('class="print-legal"');
  });
  it("profil « particulier » : pas de forme ni d'assurance", () => {
    const d = doc("facture", {}, { ...profile, type: "particulier" });
    expect(legalMentionLines(d).join(" ")).not.toContain("SARL");
  });
});
