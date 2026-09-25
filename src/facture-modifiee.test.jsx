// @vitest-environment jsdom
// Facture « payée » puis modifiée (lignes ajoutées, total qui augmente) :
// le reste à payer est TOUJOURS recalculé depuis les lignes et les
// paiements reçus, jamais déduit du seul statut. Au moment de la
// modification, la facture repasse en « envoyée » et l'éditeur l'annonce.
// Même règle pour l'acompte, la situation valant facture, le PDF, le
// tableau de bord Atelier et le paiement en ligne côté serveur.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintDocument, PrintSituation, newDocument, newSituationDocument, computeTotals, computeSituation, documentOutstanding, documentSettledTotal, paymentRevertPatch, atelierDocAmount, PaymentRevertNotice } from "./App.jsx";
import { addOnlinePayment, settledTotalOf, amountDueOf } from "../supabase/functions/_shared/totals.ts";

const line = (unitPrice, id = `l${unitPrice}`) => ({ id, type: "line", designation: "Poste", details: [], qty: 1, unitPrice, tva: 20, discount: 0 });
const facture = (extra = {}) => ({ ...newDocument("facture", []), docNumber: "FAC-021", issueDate: "2026-09-21", company: { type: "entreprise", name: "Bâti Plus" }, client: { type: "entreprise", name: "Communauté d'agglomération" }, items: [line(2500)], payments: [], ...extra });
const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/[  ]/g, " ");
const pdf = (d) => renderToStaticMarkup(<PrintDocument doc={d} totals={computeTotals(d)} siteSettings={{ name: "Chantiflow" }} watermarkEnabled={false} />);
const pdfSit = (d) => renderToStaticMarkup(<PrintSituation doc={d} siteSettings={{ name: "Chantiflow" }} watermarkEnabled={false} />);

// Le cas signalé : facture de 3 000 € TTC réglée (1 500 + 1 500), puis une
// ligne ajoutée : total 3 600 €.
const paid = facture({ status: "payée", paidAt: "2026-09-22T10:00:00.000Z", paidTotal: 3000, payments: [{ id: "p1", date: "2026-09-22", amount: 1500, method: "Chèque" }, { id: "p2", date: "2026-09-22", amount: 1500, method: "Virement bancaire" }] });
const modified = { ...paid, items: [...paid.items, line(500, "l-ajout")] };

describe("reste à payer réel", () => {
  it("facture payée puis modifiée : reste = nouveau total − payé, pas 0", () => {
    expect(computeTotals(paid).totalTTC).toBe(3000);
    expect(documentOutstanding(paid)).toBe(0);
    expect(computeTotals(modified).totalTTC).toBe(3600);
    expect(documentOutstanding(modified)).toBe(600);
    expect(documentSettledTotal(modified)).toBe(3600);
  });
  it("payée « à la main » sans lister les paiements : soldée tant que le total ne bouge pas, puis reste réel après modification", () => {
    const manual = facture({ status: "payée", paidAt: "2026-09-22T10:00:00.000Z", paidTotal: 3000, payments: [] });
    expect(documentOutstanding(manual)).toBe(0);
    expect(documentOutstanding({ ...manual, items: [...manual.items, line(100, "x")] })).toBe(120);
    // Ancien document sans référence mémorisée : le total du moment fait foi.
    expect(documentOutstanding({ ...manual, paidTotal: undefined })).toBe(0);
  });
  it("non payée : total − acompte − paiements, jamais négatif", () => {
    expect(documentOutstanding(facture({ acompteVerse: 500, payments: [{ id: "p", amount: 1000 }] }))).toBe(1500);
    expect(documentOutstanding(facture({ payments: [{ id: "p", amount: 9999 }] }))).toBe(0);
    expect(documentOutstanding({ ...newDocument("devis", []), items: [line(100)] })).toBe(0); // pas un document à encaisser
  });
});

describe("retour automatique en « envoyée »", () => {
  it("ligne ajoutée sur une facture payée : statut, date et référence effacés, message avec le reste", () => {
    const revert = paymentRevertPatch(paid, { items: modified.items });
    expect(revert.patch).toEqual({ status: "envoyée", paidAt: null, paidTotal: null });
    expect(revert.notice).toEqual({ docNumber: "FAC-021", amount: 600, currency: paid.currency });
    // Sans référence mémorisée (ancienne facture) : le total d'avant modification fait foi.
    expect(paymentRevertPatch({ ...paid, paidTotal: undefined }, { items: modified.items }).notice.amount).toBe(600);
  });
  it("modification qui ne change pas le montant dû, retrait d'une ligne, changement de statut explicite, devis : rien", () => {
    expect(paymentRevertPatch(paid, { notes: "merci" })).toBeNull();
    expect(paymentRevertPatch(paid, { items: [line(2000)] })).toBeNull(); // total en baisse : reste 0
    expect(paymentRevertPatch(paid, { items: modified.items, status: "payée" })).toBeNull(); // statut posé explicitement : on ne s'en mêle pas
    expect(paymentRevertPatch({ ...paid, status: "envoyée" }, { items: modified.items })).toBeNull();
    expect(paymentRevertPatch({ ...newDocument("devis", []), status: "payée", items: [line(1)] }, { items: [line(2)] })).toBeNull();
  });
  it("bandeau de l'éditeur : reste, statut, rappel de l'avoir", () => {
    const html = renderToStaticMarkup(<PaymentRevertNotice notice={{ docNumber: "FAC-021", amount: 600 }} onDismiss={() => {}} />);
    const text = textOf(html);
    expect(text).toContain("FAC-021");
    expect(text).toContain("600,00 €");
    expect(text).toContain("repasse en « envoyée »");
    expect(text).toContain("avoir");
    expect(renderToStaticMarkup(<PaymentRevertNotice notice={null} />)).toBe("");
  });
});

describe("PDF et tableau de bord", () => {
  it("PDF facture payée puis modifiée : « À payer » = 600, montant payé 3 000, plus de tampon ; intacte : 0 et tampon", () => {
    const intact = pdf(paid);
    expect(textOf(intact)).toContain("À payer : 0,00 €");
    expect(textOf(intact)).toContain("Montant payé : 3 000,00 €");
    expect(intact).toContain("print-paid-stamp");
    const html = pdf(modified);
    const text = textOf(html);
    expect(text).toContain("À payer : 600,00 €");
    expect(text).toContain("Montant payé : 3 000,00 €");
    expect(html).not.toContain("print-paid-stamp");
    expect(text).toContain("Montant TTC à régler600,00 €");
  });
  it("PDF facture d'acompte : même règle", () => {
    const acompte = { ...facture({ status: "payée", paidAt: "2026-09-22T10:00:00.000Z", paidTotal: 600, items: [line(500)], payments: [{ id: "p", date: "2026-09-22", amount: 600, method: "Virement bancaire" }] }), type: "acompte", docNumber: "ACO-1" };
    expect(textOf(pdf(acompte))).toContain("À payer : 0,00 €");
    const plus = { ...acompte, items: [line(500), line(100, "x")] };
    expect(textOf(pdf(plus))).toContain("À payer : 120,00 €");
    expect(pdf(plus)).not.toContain("print-paid-stamp");
  });
  it("PDF situation valant facture payée puis modifiée : reste recalculé, tampon retiré", () => {
    const sit = { ...newSituationDocument([]), docNumber: "SIT-2", issueDate: "2026-09-21", vautFacture: true, numeroSituation: 2, status: "payée", paidAt: "2026-09-22T10:00:00.000Z", client: { type: "entreprise", name: "Mairie" }, retenueGarantiePct: 0, acompteVerse: 0, items: [{ id: "s1", type: "line", designation: "Gros œuvre", qty: 10, unitPrice: 100, tva: 20, avancementPct: 50, montantCumulePrecedent: 0 }], payments: [{ id: "p", date: "2026-09-22", amount: 600, method: "Virement bancaire" }] };
    const s = computeSituation(sit);
    expect(s.netAPayer).toBe(600);
    const settled = { ...sit, paidTotal: documentSettledTotal(sit) };
    expect(settled.paidTotal).toBe(600);
    expect(textOf(pdfSit(settled))).toContain("À payer : 0,00 €");
    expect(pdfSit(settled)).toContain("print-paid-stamp");
    const more = { ...settled, items: [{ ...settled.items[0], avancementPct: 80 }] }; // 960 € net
    expect(documentOutstanding(more)).toBe(360);
    const html = pdfSit(more);
    expect(textOf(html)).toContain("À payer : 360,00 €");
    expect(textOf(html)).toContain("Montant payé : 600,00 €");
    expect(html).not.toContain("print-paid-stamp");
  });
  it("tableau de bord Atelier : reste réel pour une facture payée puis modifiée", () => {
    expect(atelierDocAmount(paid)).toEqual({ value: 3000, note: "TTC" });
    expect(atelierDocAmount(modified)).toEqual({ value: 600, note: "reste" });
    expect(atelierDocAmount(facture({ payments: [{ id: "p", amount: 1000 }] }))).toEqual({ value: 2000, note: "reste" });
  });
});

describe("paiement en ligne côté serveur : même référence", () => {
  it("le solde par virement mémorise le total réglé ; le site voit ensuite un reste si le total change", () => {
    const doc = facture({ payments: [{ id: "p1", amount: 1500 }] });
    const settled = addOnlinePayment(doc, "cs_1", 150000, "2026-09-22T10:00:00.000Z");
    expect(settled.status).toBe("payée");
    expect(settled.paidTotal).toBe(3000);
    expect(settledTotalOf(settled)).toBe(3000);
    expect(amountDueOf(settled)).toBe(0);
    expect(documentOutstanding({ ...settled, items: [...settled.items, line(500, "x")] })).toBe(600);
    expect(addOnlinePayment(doc, "cs_2", 10000, "2026-09-22T10:00:00.000Z").paidTotal).toBeUndefined(); // partiel : pas de passage en payée
  });
});
