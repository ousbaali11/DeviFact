// @vitest-environment jsdom
// Facture (PDF) : bloc de paiement en bas à gauche (À payer, montant payé,
// échéance, mode, banque, BIC, IBAN, paiements reçus), tampon PAYÉ une fois
// réglée, pied de page avec l'identité de l'entreprise ; remise globale en
// % ou en montant HT.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintDocument, newDocument, computeTotals, globalDiscountRate, globalDiscountLabel, legalMentionLines, emptyCompanyProfile } from "./App.jsx";

const profile = { ...emptyCompanyProfile(), name: "AM2S Distribution", legalForm: "SASU", capital: "10 000 €", registration: "RCS Créteil 951 102 102", siret: "95110210200012", tva: "FR05951102102", address: "36 rue Louise Michel", postalCode: "94460", city: "Valenton", iban: "FR76 3006 6103 4000 0204 9500 264", bic: "CMCIFRPP", bankName: "CIC Valenton", naf: "4532Z" };
const line = (unitPrice, extra = {}) => ({ id: `l${unitPrice}`, type: "line", designation: "Pièce", details: [], qty: 1, unitPrice, tva: 20, discount: 0, ...extra });
const facture = (extra = {}) => ({ ...newDocument("facture", []), docNumber: "F-042", issueDate: "2026-09-21", dueDays: 0, paymentMethod: "Carte bancaire", company: { ...profile }, client: { type: "particulier", name: "M. Dupont", address: "", email: "", phone: "" }, items: [line(443.89)], ...extra });
const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/[  ]/g, " ");
const pdf = (d) => renderToStaticMarkup(<PrintDocument doc={d} totals={computeTotals(d)} siteSettings={{ name: "Chantiflow" }} watermarkEnabled={false} />);

describe("remise globale en % ou en montant", () => {
  const items = [line(100), line(100)];
  it("pourcentage (ancien comportement, sans mode) et montant HT réparti au prorata", () => {
    const pct = { ...newDocument("devis", []), items, globalDiscount: 10 };
    delete pct.globalDiscountMode;
    expect(globalDiscountRate(pct)).toBeCloseTo(0.1);
    expect(computeTotals(pct).subtotalHT).toBeCloseTo(180);
    expect(globalDiscountLabel(pct, computeTotals(pct).globalDiscountPct)).toBe("Remise (10 %)");
    const amount = { ...newDocument("devis", []), items, globalDiscount: 50, globalDiscountMode: "amount" };
    const t = computeTotals(amount);
    expect(globalDiscountRate(amount)).toBeCloseTo(0.25);
    expect(t.globalDiscountAmount).toBeCloseTo(50);
    expect(t.subtotalHT).toBeCloseTo(150);
    expect(t.totalTVA).toBeCloseTo(30);
    expect(t.computedLines.map((l) => l.totalHT)).toEqual([75, 75]);
    expect(globalDiscountLabel(amount, t.globalDiscountPct)).toBe("Remise globale");
  });
  it("montant supérieur au total : plafonné ; document sans ligne : zéro", () => {
    expect(globalDiscountRate({ items, globalDiscount: 999, globalDiscountMode: "amount" })).toBe(1);
    expect(globalDiscountRate({ items: [], globalDiscount: 50, globalDiscountMode: "amount" })).toBe(0);
    expect(globalDiscountRate({ items, globalDiscount: 150 })).toBe(1);
  });
  it("PDF : libellé selon le mode", () => {
    expect(textOf(pdf(facture({ items, globalDiscount: 10 })))).toContain("Remise (10 %)");
    expect(textOf(pdf(facture({ items, globalDiscount: 50, globalDiscountMode: "amount" })))).toContain("Remise globale");
  });
});

describe("PDF de facture : bloc de paiement", () => {
  it("non réglée : à payer, montant payé 0, échéance à réception, mode, banque, BIC, IBAN, aucun paiement ; pas de tampon", () => {
    const html = pdf(facture());
    const out = textOf(html);
    expect(out).toContain("À payer : 532,67 €");
    expect(out).toContain("Montant payé : 0,00 €");
    expect(out).toContain("Date limite de règlement : À réception");
    expect(out).toContain("Mode de règlement : Carte bancaire");
    expect(out).toContain("Banque : CIC Valenton");
    expect(out).toContain("BIC : CMCIFRPP");
    expect(out).toContain("IBAN : FR76 3006 6103 4000 0204 9500 264");
    expect(out).toContain("Paiements reçus");
    expect(out).toContain("Aucun paiement reçu à ce jour.");
    expect(html).not.toContain("print-paid-stamp");
    expect(html).not.toContain("PAYÉ");
    // La ligne de règlement des mentions légales n'est plus répétée
    expect(out).not.toContain("Règlement : Carte bancaire");
  });
  it("échéance à 30 jours : date en toutes lettres", () => {
    expect(textOf(pdf(facture({ dueDays: 30 })))).toContain("Date limite de règlement : 21 octobre 2026");
  });
  it("réglée : tampon PAYÉ daté, à payer 0, montant payé = total, paiement listé avec date et mode", () => {
    const html = pdf(facture({ status: "payée", paidAt: "2026-09-21T10:00:00.000Z" }));
    const out = textOf(html);
    expect(html).toContain("print-paid-stamp");
    // Tampon = image SVG autonome (cadre + texte + date dessinés ensemble)
    const src = decodeURIComponent(html.match(/class="print-paid-stamp" src="([^"]+)"/)[1]);
    expect(src).toContain("<svg");
    expect(src).toContain(">PAYÉ<");
    expect(src).toContain("le 21/09/2026");
    expect(html).toContain('alt="PAYÉ le 21/09/2026"');
    expect(out).toContain("À payer : 0,00 €");
    expect(out).toContain("Montant payé : 532,67 €");
    expect(out).toContain("532,67 € le 21/09/2026 - Carte bancaire");
  });
  it("acompte déjà versé : listé, à payer = reste ; réglée ensuite : solde listé en plus", () => {
    const partial = textOf(pdf(facture({ acompteVerse: 100 })));
    expect(partial).toContain("À payer : 432,67 €");
    expect(partial).toContain("Montant payé : 100,00 €");
    expect(partial).toContain("100,00 € - Acompte versé");
    const paid = textOf(pdf(facture({ acompteVerse: 100, status: "payée", paidAt: "2026-09-22T08:00:00.000Z" })));
    expect(paid).toContain("100,00 € - Acompte versé");
    expect(paid).toContain("432,67 € le 22/09/2026 - Carte bancaire");
    expect(paid).toContain("Montant payé : 532,67 €");
  });
  it("facture d'acompte : bloc présent ; devis et avoir : aucun bloc ni tampon", () => {
    const acompte = { ...newDocument("acompte", []), docNumber: "FA-001", issueDate: "2026-09-21", company: { ...profile }, client: { type: "entreprise", name: "Client SAS" }, items: [line(100)] };
    expect(textOf(pdf(acompte))).toContain("À payer : 120,00 €");
    for (const type of ["devis", "avoir"]) {
      const d = { ...newDocument(type, []), docNumber: "X-1", issueDate: "2026-09-21", company: { ...profile }, client: { type: "entreprise", name: "Client SAS" }, items: [line(100)], status: "payée" };
      const html = pdf(d);
      expect(textOf(html)).not.toContain("À payer :");
      expect(html).not.toContain("print-paid-stamp");
    }
  });
  it("banque, BIC, IBAN et NAF repris du profil courant pour un ancien document sans ces champs", () => {
    const legacyCompany = { type: "entreprise", name: "AM2S Distribution", siret: "95110210200012", address: "36 rue Louise Michel", country: "", email: "", phone: "", tva: "FR05951102102", logo: null };
    const d = facture({ company: legacyCompany });
    const out = textOf(renderToStaticMarkup(<PrintDocument doc={d} totals={computeTotals(d)} siteSettings={{ name: "Chantiflow" }} watermarkEnabled={false} companyProfile={profile} />));
    expect(out).toContain("Banque : CIC Valenton");
    expect(out).toContain("IBAN : FR76 3006 6103 4000 0204 9500 264");
    expect(out).toContain("NAF : 4532Z");
  });
});

describe("PDF : pied de page", () => {
  it("entreprise : nom, adresse, forme et capital, RCS, NAF, SIRET, TVA en une ligne centrée ; plus de doublon dans les mentions légales", () => {
    const html = pdf(facture());
    const out = textOf(html);
    expect(html).toContain("print-footer");
    expect(out).toContain("AM2S Distribution · 36 rue Louise Michel, 94460 Valenton · SASU au capital de 10 000 € — RCS Créteil 951 102 102 · NAF : 4532Z · SIRET : 95110210200012 · TVA : FR05951102102");
    expect(out.split("SASU au capital de 10 000 €").length - 1).toBe(1);
    // La fonction pure garde la ligne d'identité pour les autres usages
    expect(legalMentionLines(facture())[0]).toBe("SASU au capital de 10 000 € — RCS Créteil 951 102 102");
  });
  it("particulier émetteur : pas de pied de page, identité laissée aux mentions légales", () => {
    const d = facture({ company: { ...profile, type: "particulier", legalForm: "", capital: "", registration: "" } });
    expect(pdf(d)).not.toContain("print-footer");
  });
});
