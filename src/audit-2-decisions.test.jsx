// @vitest-environment jsdom
// Décisions du second audit (26/09/2026) : preuves chiffrées — acompte compté
// une seule fois (budget, feuille export, écritures 4191), situation en TTC
// brut, remise en montant exacte, avoir sur le PDF, CA avec situations,
// garanties d'un 29 février, montant accepté à la signature, rappel des
// options, facture d'origine réévaluée quand un avoir change, export
// programmé sans doublon (fenêtre, compléments, corrections), jour de Paris
// pour les entrées de stock.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  newDocument, newSituationDocument, emptyCompanyProfile, computeTotals, computeSituation, accountingExportRow, accountingExportRows, accountingLinesOf,
  acompteDeduitSplit, atelierChantierStats, computePvGaranties, stampAcceptedTotal, confirmSignedOptions, reevaluateInvoicesAfterCreditChange,
  PrintDocument, RevenueChart, localDateOf, isDocumentEmpty,
} from "./App.jsx";
import { buildSalesEntries, acompteSplitOf, DEFAULT_ACCOUNTS } from "./accounting.js";
import * as shared from "../supabase/functions/_shared/accounting.ts";
import { computeDocTotals } from "../supabase/functions/_shared/totals.ts";

const line = (id, ht, tva = 20, extra = {}) => ({ id, type: "line", designation: `Poste ${id}`, qty: 1, unit: "u", unitPrice: ht, tva, discount: 0, details: [], ...extra });
const doc = (type, extra = {}) => ({ ...newDocument(type, []), issueDate: "2026-08-12", status: "envoyée", client: { type: "entreprise", name: "Client SAS" }, ...extra });
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const clean = (s) => String(s).replace(/[  ]/g, " ");
const text = (html) => clean(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));

const acompteDoc = doc("acompte", { id: "aco", docNumber: "ACO-001", chantier: "Villa", items: [line("a", 3000)] });
const finalDoc = doc("facture", { id: "fac", docNumber: "FAC-010", chantier: "Villa", issueDate: "2026-08-20", acompteVerse: 3600, items: [line("f", 10000)] });

describe("1. acompte facturé puis déduit : compté une seule fois (RÈGLE À CONFIRMER PAR L'EXPERT-COMPTABLE)", () => {
  it("part HT/TVA de l'acompte déduit : 3 600 TTC sur une facture à 20 % → 3 000 HT + 600 TVA", () => {
    expect(acompteDeduitSplit(computeTotals(finalDoc))).toEqual({ ttc: 3600, ht: 3000, tva: 600 });
    expect(acompteSplitOf(finalDoc, 10000, 2000)).toEqual({ ttc: 3600, ht: 3000, tva: 600 });
    expect(shared.acompteSplitOf(finalDoc, 10000, 2000)).toEqual({ ttc: 3600, ht: 3000, tva: 600 });
    expect(acompteDeduitSplit(computeTotals(acompteDoc))).toEqual({ ttc: 0, ht: 0, tva: 0 }); // seule une facture déduit un acompte
  });
  it("budget chantier : acompte 3 000 HT + facture finale 10 000 HT (acompte déduit) = 10 000 facturés, plus 13 000", () => {
    const [villa] = atelierChantierStats([acompteDoc, finalDoc], []);
    expect(villa.factureTotal).toBe(10000);
    expect(atelierChantierStats([acompteDoc], [])[0].factureTotal).toBe(3000); // facture finale pas encore émise
    expect(atelierChantierStats([finalDoc], [])[0].factureTotal).toBe(10000); // acompte reçu sans facture d'acompte
  });
  it("feuille export : la facture porte une seconde ligne « Acompte déduit » négative (site et serveur)", () => {
    const rows = accountingExportRows(finalDoc);
    expect(rows).toHaveLength(2);
    expect(rows[0].slice(5)).toEqual([10000, 2000, 12000]);
    expect(rows[1][0]).toBe("Acompte déduit");
    expect(rows[1].slice(5)).toEqual([-3000, -600, -3600]);
    expect(shared.accountingExportRows(finalDoc).map((r) => r.slice(5))).toEqual(rows.map((r) => r.slice(5)));
    expect(accountingExportRows(acompteDoc)).toHaveLength(1);
  });
  it("écritures : acompte en 4191 (pas en produits), reprise sur la facture finale ; équilibrées ; identiques site / serveur", () => {
    const site = buildSalesEntries([acompteDoc, finalDoc], { computeLines: accountingLinesOf });
    const server = shared.buildSalesEntries([acompteDoc, finalDoc], {});
    expect(server).toEqual(site);
    expect(DEFAULT_ACCOUNTS.advances).toBe("419100");
    const aco = site.filter((e) => e.piece === "ACO-001");
    expect(aco.map((e) => [e.account, e.debit, e.credit])).toEqual([["411000", 3600, 0], ["419100", 0, 3000], ["445710", 0, 600]]);
    const fac = site.filter((e) => e.piece === "FAC-010");
    expect(fac.map((e) => [e.account, e.debit, e.credit])).toEqual([["411000", 12000, 0], ["706000", 0, 10000], ["445710", 0, 2000], ["419100", 3000, 0], ["445710", 600, 0], ["411000", 0, 3600]]);
    expect(fac.filter((e) => e.label.startsWith("Reprise de l'acompte"))).toHaveLength(3);
    const sum = (k) => Math.round(site.reduce((s, e) => s + e[k], 0) * 100) / 100;
    expect(sum("debit")).toBe(sum("credit"));
    // Produits nets : 10 000 (et non 13 000) ; client net : 12 000 dus − 3 600 déjà réglés
    expect(site.filter((e) => e.account === "706000").reduce((s, e) => s + e.credit, 0)).toBe(10000);
  });
});

describe("2. situation dans l'export : TTC brut = HT + TVA", () => {
  const sit = { ...newSituationDocument([]), docNumber: "SIT-002", issueDate: "2026-08-20", status: "envoyée", vautFacture: true, client: { name: "Mairie" }, retenueGarantiePct: 5, acompteVerse: 1000, items: [{ id: "s", type: "line", designation: "Gros œuvre", qty: 1, unitPrice: 10000, avancementPct: 100, montantCumulePrecedent: 0, tva: 20 }] };
  it("10 000 HT, TVA 2 000, retenue 600, acompte 1 000 → colonne TTC 12 000 (avant : 10 400)", () => {
    expect(computeSituation(sit).netAPayer).toBe(10400);
    expect(accountingExportRow(sit).slice(5)).toEqual([10000, 2000, 12000]);
    expect(shared.accountingExportRow(sit).slice(5)).toEqual([10000, 2000, 12000]);
  });
});

describe("3. remise globale en montant : la remise imprimée est celle saisie", () => {
  it("3 × 333,33 − 50 → HT 949,99 et remise 50,00 (avant : 949,98 et 50,01) ; 7 × 100,01 − 10 → remise 10,00", () => {
    const d = doc("devis", { items: [line("a", 333.33, 0), line("b", 333.33, 0), line("c", 333.33, 0)], globalDiscountMode: "amount", globalDiscount: 50 });
    const t = computeTotals(d);
    expect(t.subtotalHTBrut).toBe(999.99);
    expect(t.subtotalHT).toBe(949.99);
    expect(t.globalDiscountAmount).toBe(50);
    expect(t.computedLines.map((l) => l.totalHT)).toEqual([316.66, 316.66, 316.67]);
    const s = computeDocTotals(d);
    expect([s.subtotalHT, s.globalDiscountAmount]).toEqual([949.99, 50]);
    const d2 = doc("devis", { items: Array.from({ length: 7 }, (_, i) => line(`l${i}`, 100.01, 0)), globalDiscountMode: "amount", globalDiscount: 10 });
    expect(computeTotals(d2).globalDiscountAmount).toBe(10);
    expect(computeDocTotals(d2).globalDiscountAmount).toBe(10);
    // Remise en % : rien ne change
    const d3 = doc("devis", { items: [line("a", 333.33, 0)], globalDiscount: 10 });
    expect(computeTotals(d3).subtotalHT).toBe(300);
  });
});

describe("5. PDF de facture : avoir rattaché déduit et nommé", () => {
  it("facture 1 200, avoir AV-001 de 120 : « Avoir AV-001 − 120,00 » et « À payer : 1 080,00 »", () => {
    const f = doc("facture", { docNumber: "FAC-020", items: [line("a", 1200, 0)] });
    const html = renderToStaticMarkup(<PrintDocument doc={f} totals={computeTotals(f)} siteSettings={{ name: "Chantiflow" }} companyProfile={emptyCompanyProfile()} creditTotal={120} creditNotes={["AV-001"]} />);
    const t = text(html);
    expect(t).toContain("Avoir AV-001");
    expect(t).toMatch(/À payer : 1 080,00/);
    const sans = text(renderToStaticMarkup(<PrintDocument doc={f} totals={computeTotals(f)} siteSettings={{ name: "Chantiflow" }} companyProfile={emptyCompanyProfile()} />));
    expect(sans).toMatch(/À payer : 1 200,00/);
    expect(sans).not.toContain("Avoir");
  });
});

describe("6. graphique du chiffre d'affaires : situations valant facture incluses", () => {
  it("une situation émise de 1 000 HT ce mois-ci apparaît dans le total", () => {
    const today = iso(new Date());
    const sit = { ...newSituationDocument([]), docNumber: "SIT-001", issueDate: today, status: "envoyée", vautFacture: true, client: { name: "Mairie" }, items: [{ id: "s", type: "line", designation: "Poste", qty: 1, unitPrice: 1000, avancementPct: 100, montantCumulePrecedent: 0, tva: 20 }] };
    const html = text(renderToStaticMarkup(<RevenueChart documents={[sit]} />));
    expect(html).toMatch(/1 000/);
    const brouillon = text(renderToStaticMarkup(<RevenueChart documents={[{ ...sit, status: "brouillon" }]} />));
    expect(brouillon).not.toMatch(/1 000/);
  });
});

describe("7. garanties : réception un 29 février", () => {
  it("29/02/2028 → 28/02/2029, 28/02/2030, 28/02/2038 (avant : 1er mars) ; une date ordinaire est inchangée", () => {
    const g = computePvGaranties({ dateReceptionEffective: "2028-02-29", typeReception: "sans_reserve" });
    expect([iso(g.parfaitAchevement), iso(g.biennale), iso(g.decennale)]).toEqual(["2029-02-28", "2030-02-28", "2038-02-28"]);
    const n = computePvGaranties({ dateReceptionEffective: "2026-09-25", typeReception: "sans_reserve" });
    expect([iso(n.parfaitAchevement), iso(n.decennale)]).toEqual(["2027-09-25", "2036-09-25"]);
    expect(iso(computePvGaranties({ dateReceptionEffective: "2026-01-31", typeReception: "sans_reserve" }).parfaitAchevement)).toBe("2027-01-31");
  });
});

describe("8. entrées de stock : jour de Paris côté serveur", () => {
  it("entrée du 30/09 à 22 h 30 UTC → écriture datée du 1er octobre (comme le jour local du site)", () => {
    const productById = new Map([["p1", { id: "p1", name: "Sable", purchase_price_ht: 10, purchase_vat_rate: 20 }]]);
    const { entries } = shared.buildStockEntries([{ id: "m1", kind: "entree", product_id: "p1", quantity: 2, moved_at: "2026-09-30T22:30:00Z", document_ref: "BL-9" }], { productById });
    expect(entries[0].date).toBe("2026-10-01");
  });
});

describe("10/11. devis signé : montant accepté, rappel des options", () => {
  const devis = doc("devis", { docNumber: "DEV-001", status: "envoyé", items: [line("l1", 100, 0), line("l2", 50, 0, { optional: true, optionAccepted: true }), line("l3", 30, 0, { optional: true, optionAccepted: false })] });
  it("stampAcceptedTotal fige 150 TTC et l'option retenue ; ne modifie pas un devis déjà estampillé", () => {
    const stamped = stampAcceptedTotal({ ...devis, status: "signé" });
    expect(stamped.signature.acceptedTotalTTC).toBe(150);
    expect(stamped.signature.acceptedOptionIds).toEqual(["l2"]);
    expect(stamped.signature.mode).toBe("texte");
    const again = stampAcceptedTotal({ ...stamped, items: [line("l1", 999, 0)] });
    expect(again.signature.acceptedTotalTTC).toBe(150);
    const f = doc("facture");
    expect(stampAcceptedTotal(f)).toBe(f); // seuls les devis sont estampillés
  });
  it("le PDF d'un devis signé rappelle le montant accepté et signale un total qui a changé", () => {
    const signed = { ...stampAcceptedTotal({ ...devis, status: "signé" }), signature: { mode: "texte", name: "Client", acceptedTotalTTC: 150 } };
    const same = text(renderToStaticMarkup(<PrintDocument doc={signed} totals={computeTotals(signed)} siteSettings={{ name: "Chantiflow" }} companyProfile={emptyCompanyProfile()} />));
    expect(same).toContain("Montant accepté à la signature");
    expect(same).not.toContain("a changé depuis");
    const changed = { ...signed, items: [...signed.items, line("l4", 20, 0)] };
    const diff = text(renderToStaticMarkup(<PrintDocument doc={changed} totals={computeTotals(changed)} siteSettings={{ name: "Chantiflow" }} companyProfile={emptyCompanyProfile()} />));
    expect(diff).toContain("a changé depuis");
    expect(diff).toMatch(/Montant accepté à la signature[^0-9]*150,00/);
  });
  it("confirmSignedOptions : rappel seulement s'il reste des options non retenues ; « Annuler » bloque", () => {
    const confirm = vi.fn(() => false);
    window.confirm = confirm;
    expect(confirmSignedOptions(devis, "signé")).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain("1 option de ce devis n'a pas été cochée « Retenue »");
    window.confirm = vi.fn(() => true);
    expect(confirmSignedOptions(devis, "signé")).toBe(true);
    const spy = vi.fn(() => false);
    window.confirm = spy;
    expect(confirmSignedOptions({ ...devis, items: [line("l1", 100, 0)] }, "signé")).toBe(true); // aucune option : pas de question
    expect(confirmSignedOptions(devis, "envoyé")).toBe(true);
    expect(confirmSignedOptions({ ...devis, status: "signé" }, "signé")).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("12/13. avoir modifié : la facture d'origine suit", () => {
  const facture = (extra) => doc("facture", { id: "f1", docNumber: "FAC-020", items: [line("a", 1000, 0)], ...extra });
  const avoir = (ht) => doc("avoir", { id: "av", docNumber: "AV-003", factureOrigineId: "f1", items: [line("x", ht, 0)] });
  it("payée (800 reçus + avoir 200) puis avoir ramené à 100 → « envoyée », 100 restent dus", () => {
    const f = facture({ status: "payée", paidTotal: 800, payments: [{ id: "p", date: "2026-09-01", amount: 800 }] });
    const { list, notices } = reevaluateInvoicesAfterCreditChange([f, avoir(100)], ["f1"]);
    expect(list.find((d) => d.id === "f1").status).toBe("envoyée");
    expect(list.find((d) => d.id === "f1").paidTotal).toBeNull();
    expect(notices[0].amount).toBe(100);
    expect(notices[0].text).toContain("repasse en « envoyée »");
  });
  it("envoyée (880 reçus) puis avoir de 120 émis → « payée », paidTotal 880", () => {
    const f = facture({ payments: [{ id: "p", date: "2026-09-01", amount: 880 }] });
    const { list, notices } = reevaluateInvoicesAfterCreditChange([f, avoir(120)], ["f1"]);
    const nf = list.find((d) => d.id === "f1");
    expect(nf.status).toBe("payée");
    expect(nf.paidTotal).toBe(880);
    expect(nf.paidAt).toBeTruthy();
    expect(notices[0].text).toContain("passe en « payée »");
  });
  it("rien ne change quand la facture n'est pas soldée, ni pour un brouillon ou un identifiant inconnu", () => {
    const f = facture({});
    expect(reevaluateInvoicesAfterCreditChange([f, avoir(120)], ["f1"]).notices).toEqual([]);
    expect(reevaluateInvoicesAfterCreditChange([{ ...f, status: "brouillon" }, avoir(1000)], ["f1"]).notices).toEqual([]);
    expect(reevaluateInvoicesAfterCreditChange([f], ["zzz"]).list).toEqual([f]);
  });
});

describe("17. export programmé : fenêtre, compléments et corrections, jamais de doublon", () => {
  const facA = doc("facture", { id: "A", docNumber: "FAC-A", issueDate: "2026-08-10", items: [line("a", 100)] });
  const facB = doc("facture", { id: "B", docNumber: "FAC-B", issueDate: "2026-08-20", items: [line("b", 200)] });
  const aout = shared.previousPeriod(new Date("2026-09-05T12:00:00Z"), "mensuel");
  const sept = shared.previousPeriod(new Date("2026-10-05T12:00:00Z"), "mensuel");
  it("premier envoi d'août : deux documents, empreintes mémorisées", () => {
    const r = shared.buildExportSheets([facA, facB], aout, { includeEntries: false }, null);
    expect(r.documentCount).toBe(2);
    expect(r.rows).toHaveLength(3);
    expect(Object.keys(r.exportedNext).sort()).toEqual(["A", "B"]);
    expect(r.window).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(r.label).toBe("août 2026");
  });
  it("septembre : document d'août apparu après l'envoi → complément ; montant d'août modifié → annulation puis correction", () => {
    const state = { lastSentPeriod: "2026-08", sentThrough: "2026-08-31", exported: shared.buildExportSheets([facA, facB], aout, { includeEntries: false }, null).exportedNext };
    const facC = doc("facture", { id: "C", docNumber: "FAC-C", issueDate: "2026-08-25", items: [line("c", 50)] });
    const facD = doc("facture", { id: "D", docNumber: "FAC-D", issueDate: "2026-09-03", items: [line("d", 300)] });
    const facA2 = { ...facA, items: [line("a", 150)] };
    const r = shared.buildExportSheets([facA2, facB, facC, facD], sept, { includeEntries: false }, state);
    expect(r.documentCount).toBe(3);
    expect(r.complementCount).toBe(1);
    expect(r.correctionCount).toBe(1);
    const rows = r.rows.slice(1);
    expect(rows[0][1]).toBe("FAC-D");
    expect(rows[1][0]).toBe("Complément (période déjà envoyée) : Facture");
    expect(rows[1].slice(5)).toEqual([50, 10, 60]);
    expect(rows[2][0]).toBe("Annulation (ligne envoyée précédemment) : Facture");
    expect(rows[2].slice(5)).toEqual([-100, -20, -120]);
    expect(rows[3][0]).toBe("Correction : Facture");
    expect(rows[3].slice(5)).toEqual([150, 30, 180]);
    expect(r.label).toContain("2 compléments/corrections");
    expect(Object.keys(r.exportedNext).sort()).toEqual(["A", "B", "C", "D"]);
    // Envoi suivant avec ces empreintes : plus rien à rattraper.
    const again = shared.buildExportSheets([facA2, facB, facC, facD], sept, { includeEntries: false }, { ...state, sentThrough: "2026-09-30", exported: r.exportedNext });
    expect(again.documentCount).toBe(0);
    expect(again.window).toBeNull();
  });
  it("passage mensuel → trimestriel : seul septembre part, juillet et août déjà envoyés ; ancien état sans empreintes : pas de complément", () => {
    const t3 = shared.previousPeriod(new Date("2026-10-05T12:00:00Z"), "trimestriel");
    const facJ = doc("facture", { id: "J", docNumber: "FAC-J", issueDate: "2026-07-10", items: [line("j", 10)] });
    const facS = doc("facture", { id: "S", docNumber: "FAC-S", issueDate: "2026-09-10", items: [line("s", 20)] });
    const r = shared.buildExportSheets([facJ, facA, facS], t3, { includeEntries: false }, { lastSentPeriod: "2026-08", sentThrough: "2026-08-31", exported: { J: shared.documentMark(facJ), A: shared.documentMark(facA) } });
    expect(r.window).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(r.rows.slice(1).map((x) => x[1])).toEqual(["FAC-S"]);
    expect(r.label).toBe("3e trimestre 2026 (du 01/09/2026 au 30/09/2026, le reste déjà envoyé)");
    const legacy = shared.buildExportSheets([facJ, facA, facS], t3, { includeEntries: false }, { lastSentPeriod: "2026-08" });
    expect(legacy.rows.slice(1).map((x) => x[1])).toEqual(["FAC-S"]); // J et A : pas d'empreinte → rien à rattraper, rien en double
    expect(shared.periodEndOf("2026-T3")).toBe("2026-09-30");
    expect(shared.periodEndOf("2026-02")).toBe("2026-02-28");
    expect(shared.exportWindow(aout, { sentThrough: "2026-08-31" })).toBeNull();
    expect(shared.exportWindow(aout, null)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });
});

describe("N2. facture reçue « en attente » avec un scan : un vrai contenu", () => {
  it("le document est conservé dès qu'un scan est joint, comme avec une photo", () => {
    const vide = { ...newDocument("facture_recue", []), client: { name: "" }, items: [] };
    expect(isDocumentEmpty(vide)).toBe(true);
    expect(isDocumentEmpty({ ...vide, attachment: { path: "org/doc/scan.pdf", fileName: "scan.pdf" } })).toBe(false);
    expect(isDocumentEmpty({ ...vide, attachment: null })).toBe(true);
  });
});

describe("dates locales", () => {
  it("localDateOf garde le jour pour les vérifications ci-dessus", () => {
    expect(iso(localDateOf("2028-02-29"))).toBe("2028-02-29");
  });
});
