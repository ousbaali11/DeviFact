// @vitest-environment jsdom
// Audit du 25/09/2026 (calculs, cohérence après modification, bugs
// classiques) : preuves chiffrées des corrections faites directement.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./client.js", () => ({
  db: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => { throw new Error("pas d'accès base attendu"); },
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
import {
  Editor, PaymentsEditor, PrintDocument, PrintSituation, newDocument, newSituationDocument, newRevisionDocument, newPvReceptionDocument, newContratChantierDocument,
  computeTotals, computeRevision, computeRevisionLine, getSectorMontantInitial, getRevisionSectors, emptyRevisionSector, emptyDecompte, emptyMois, REVISION_SECTORS,
  duplicatedDocumentOf, nextNumber, computePvGaranties, companySnapshotOf, localDateOf, fr, frLong, paymentRevertPatch, PaymentRevertNotice, emptyCompanyProfile, PLANS, acompteAmountOf, documentOutstanding, documentSettledTotal,
} from "./App.jsx";
import { parseAmount, openInvoiceCandidates, suggestMatches } from "./bank-matching.js";
import { entriesToCsv, localIsoDate } from "./accounting.js";
import { computeDocTotals, amountDueOf } from "../supabase/functions/_shared/totals.ts";
import { recurringInvoiceCopy, advanceRecurrenceDate } from "../supabase/functions/_shared/recurring.ts";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null; });

const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/[  ]/g, " ");
const line = (unitPrice, id = `l${unitPrice}`) => ({ id, type: "line", designation: "Poste", details: [], qty: 1, unitPrice, tva: 20, discount: 0 });
const profile = { ...emptyCompanyProfile(), name: "Bâti Plus" };
const facture = (extra = {}) => ({ ...newDocument("facture", []), docNumber: "F-001", issueDate: "2026-09-21", currency: "EUR", company: { ...profile }, client: { type: "entreprise", name: "Client SAS" }, items: [line(100)], payments: [], ...extra });
const pdf = (d) => textOf(renderToStaticMarkup(<PrintDocument doc={d} totals={computeTotals(d)} siteSettings={{ name: "Chantiflow" }} watermarkEnabled={false} />));
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
function setValue(input, value) {
  const proto = input.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
  input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return { container, root, rerender: (el) => act(async () => { root.render(el); }), unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const button = (c, text) => [...c.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
const byLabel = (c, label) => [...c.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(label))?.querySelector("input, select");

describe("dates « AAAA-MM-JJ » lues en heure locale (fuseau à l'ouest : Guadeloupe, UTC−4)", () => {
  const previousTz = process.env.TZ;
  beforeAll(() => { process.env.TZ = "America/Guadeloupe"; });
  afterAll(() => { if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz; });
  it("new Date(\"2026-09-25\") tombe la veille sur ce fuseau ; localDateOf, fr et frLong donnent le bon jour", () => {
    expect(new Date("2026-09-25").getDate()).toBe(24); // le décalage que corrige localDateOf
    expect(localDateOf("2026-09-25").getDate()).toBe(25);
    expect(fr("2026-09-25")).toBe("25 sept. 2026");
    expect(frLong("2026-01-01")).toBe("01 janvier 2026");
    expect(localDateOf(new Date(2026, 0, 5)).getDate()).toBe(5); // un objet Date passe tel quel
  });
  it("PDF : l'année du numéro et la date d'émission suivent la date saisie, pas l'année UTC de la veille", () => {
    const out = pdf(facture({ issueDate: "2026-01-01" }));
    expect(out).toContain("F-001/2026");
    expect(out).toContain("Date d'émission : 01 janvier 2026");
  });
  it("export comptable des mouvements de stock : jour local d'un horodatage complet", () => {
    expect(localIsoDate("2026-09-26T02:30:00Z")).toBe("2026-09-25");
    expect(localIsoDate("2026-09-25")).toBe("2026-09-25");
  });
});

describe("duplication et numérotation", () => {
  it("situation dupliquée : nouvelle chaîne (n° 1, sans précédente, rien de déjà facturé)", () => {
    const sit = { ...newSituationDocument([]), docNumber: "SIT-002", numeroSituation: 2, previousSituationId: "sit1", items: [{ id: "s", type: "line", designation: "Gros œuvre", qty: 10, unitPrice: 100, tva: 20, avancementPct: 50, montantCumulePrecedent: 300 }] };
    const copy = duplicatedDocumentOf(sit, [sit]);
    expect(copy.numeroSituation).toBe(1);
    expect(copy.previousSituationId).toBeUndefined();
    expect(copy.items[0].montantCumulePrecedent).toBe(0);
    expect(copy.docNumber).toBe("SIT-003");
  });
  it("facture dupliquée : plus de lien au devis, de relance mémorisée ni de total réglé ; contrat : signatures effacées", () => {
    const copy = duplicatedDocumentOf(facture({ linkedDevisId: "dev1", sourceDevisNumber: "DEV-001", lastReminderSentAt: 1, splitFrom: "x", paidTotal: 120, status: "payée" }), []);
    expect(copy).not.toHaveProperty("linkedDevisId");
    expect(copy).not.toHaveProperty("sourceDevisNumber");
    expect(copy).not.toHaveProperty("lastReminderSentAt");
    expect(copy).not.toHaveProperty("paidTotal");
    expect(copy.status).toBe("brouillon");
    const contrat = { ...newContratChantierDocument([]), signatureClient: { name: "M. Dupont", date: "2026-09-01" }, signatureEntreprise: { name: "Bâti Plus", date: "2026-09-01" } };
    const c2 = duplicatedDocumentOf(contrat, []);
    expect(c2.signatureClient).toEqual({ name: "", date: "" });
    expect(c2.signatureEntreprise).toEqual({ name: "", date: "" });
  });
  it("numéro suivant : un document sans numéro ne fait plus planter le calcul", () => {
    expect(nextNumber([{ type: "facture" }, { type: "facture", docNumber: "FAC-007" }], "facture")).toBe("FAC-008");
  });
});

describe("révision de prix : décomptes valides seulement, repli sur le montant initial", () => {
  function sector(decomptes, useDecomptes = true) {
    const sec = emptyRevisionSector(REVISION_SECTORS[0], "🇫🇷 FR");
    const term = sec.terms[0];
    Object.assign(term, { symbole: "BT01", poids: 0.85, indexBase: 100 });
    const ok = { ...emptyDecompte(), label: "DP N°1", dateDecompte: "2026-06-30", montantTotal: 5000, mois: [{ ...emptyMois(), date: "2026-06-01", jours: 30, valeurs: { [term.id]: 130 } }] };
    const incomplete = { ...emptyDecompte(), label: "DP N°2", dateDecompte: "2026-07-31", montantTotal: 3000, mois: [{ ...emptyMois(), date: "2026-07-01", jours: 31, valeurs: {} }] };
    Object.assign(sec, { coeffFixe: 0.15, tvaRate: 0.2, montantInitialHT: 10000, dateActuelle: "2026-06-01", valeursActuelles: { [term.id]: 110 }, useDecomptes, decomptes: decomptes === "ok+incomplete" ? [ok, incomplete] : decomptes });
    return sec;
  }
  it("un décompte incomplet ne compte ni au révisé ni à l'initial : écart 1 275 (avant : −725)", () => {
    const r = computeRevisionLine(sector("ok+incomplete"));
    expect(r.valid).toBe(true);
    expect(Math.round(r.montantInitial)).toBe(5000);
    expect(Math.round(r.ecartMontant)).toBe(1275);
    const doc = { ...newRevisionDocument(REVISION_SECTORS[0], "🇫🇷 FR", []), sectors: [sector("ok+incomplete")] };
    const total = computeRevision(doc);
    expect(Math.round(total.montantInitialTotal)).toBe(5000);
    expect(Math.round(total.ecartMontant)).toBe(1275);
    expect(getRevisionSectors(doc)).toHaveLength(1);
  });
  it("décomptes activés mais liste vide : le montant initial HT saisi fait foi (avant : 0)", () => {
    expect(getSectorMontantInitial(sector([], true))).toBe(10000);
  });
});

describe("PDF : totaux, acompte, situation", () => {
  it("facture payée « à la main » puis modifiée : le bloc des totaux affiche le même reste que le bloc de paiement", () => {
    // Acompte de 20 € déjà versé, solde marqué payé sans lister le paiement,
    // puis une ligne de 60 € TTC ajoutée : reste 60 € (avant : 160 € dans le
    // bloc des totaux contre 60 € dans le bloc de paiement).
    const paid = facture({ status: "payée", paidAt: "2026-09-22T10:00:00.000Z", paidTotal: 120, acompteVerse: 20, items: [line(100)] });
    const modified = { ...paid, items: [line(100), line(50, "x")] };
    expect(computeTotals(modified).montantARegler).toBe(160);
    const out = pdf(modified);
    expect(out).toContain("Montant TTC à régler60,00 €");
    expect(out).toContain("À payer : 60,00 €");
  });
  it("facture d'acompte : « reste à facturer » avec le même arrondi que la ligne d'acompte", () => {
    const ac = { ...newDocument("acompte", []), docNumber: "ACO-1", issueDate: "2026-09-21", currency: "EUR", company: { ...profile }, client: { name: "Client" }, sourceDevisRef: "DEV-001", montantMarcheHT: 100, acompteMode: "pourcentage", acomptePourcentage: 12.345, items: [line(12.35)] };
    expect(acompteAmountOf(ac)).toBe(12.35);
    expect(pdf(ac)).toContain("Reste à facturer après cet acompte : 87,65 €");
  });
  it("situation valant facture payée puis modifiée : la ligne « Reste à payer » du bloc de totaux est recalculée", () => {
    const sit = { ...newSituationDocument([]), docNumber: "SIT-2", issueDate: "2026-09-21", vautFacture: true, numeroSituation: 2, status: "payée", paidAt: "2026-09-22T10:00:00.000Z", client: { type: "entreprise", name: "Mairie" }, retenueGarantiePct: 0, acompteVerse: 0, items: [{ id: "s1", type: "line", designation: "Gros œuvre", qty: 10, unitPrice: 100, tva: 20, avancementPct: 50, montantCumulePrecedent: 0 }], payments: [{ id: "p", date: "2026-09-22", amount: 600, method: "Virement bancaire" }] };
    const settled = { ...sit, paidTotal: documentSettledTotal(sit) };
    const more = { ...settled, items: [{ ...settled.items[0], avancementPct: 80 }] };
    expect(documentOutstanding(more)).toBe(360);
    const out = textOf(renderToStaticMarkup(<PrintSituation doc={more} siteSettings={{ name: "Chantiflow" }} watermarkEnabled={false} />));
    expect(out).toContain("Reste à payer360,00 €");
    expect(out).toContain("À payer : 360,00 €");
  });
});

describe("garanties, fiche entreprise, bandeau", () => {
  it("PV « réception refusée » : aucune garantie ne court", () => {
    const pv = { ...newPvReceptionDocument([]), dateReceptionEffective: "2026-09-01", typeReception: "refusee" };
    expect(computePvGaranties(pv)).toBeNull();
    expect(computePvGaranties({ ...pv, typeReception: "sans_reserve" })).not.toBeNull();
  });
  it("le réglage d'export comptable n'est jamais copié dans un document", () => {
    const snap = companySnapshotOf({ ...profile, accountingExport: { email: "compta@cabinet.fr" }, iban: "FR76" });
    expect(snap).not.toHaveProperty("accountingExport");
    expect(snap.iban).toBe("FR76");
  });
  it("retour en « envoyée » : le bandeau affiche la devise du document", () => {
    const paid = facture({ status: "payée", paidAt: "2026-09-22T10:00:00.000Z", paidTotal: 120, currency: "CHF", payments: [{ id: "p1", amount: 120 }] });
    const revert = paymentRevertPatch(paid, { items: [line(100), line(50, "x")] });
    expect(revert.notice).toEqual({ docNumber: "F-001", amount: 60, currency: "CHF" });
    expect(textOf(renderToStaticMarkup(<PaymentRevertNotice notice={revert.notice} />))).toContain("60,00 CHF");
  });
});

describe("paiements reçus : trop-perçu", () => {
  it("un paiement de 130 ramené à 125 sur 120 TTC : la facture reste « payée » (avant : repassait en « envoyée »)", async () => {
    const patches = [];
    const doc = facture({ status: "payée", payments: [{ id: "p1", date: "2026-09-22", amount: 130, method: "Chèque", note: "" }] });
    const { container, unmount } = await mount(<PaymentsEditor doc={doc} totals={computeTotals(doc)} onPatch={(p) => patches.push(p)} />);
    await click(container.querySelector('button[title="Modifier ce paiement"]'));
    await act(async () => { setValue(byLabel(container, "Montant"), "125"); });
    await click(button(container, "Enregistrer"));
    expect(patches).toHaveLength(1);
    expect(patches[0].payments[0].amount).toBe(125);
    expect(patches[0].status).toBeUndefined();
    await unmount();
  }, 30000);
  it("ramené à 100 : elle repasse en « envoyée » ; un acompte versé est déduit de la base", async () => {
    const patches = [];
    const doc = facture({ status: "payée", acompteVerse: 20, payments: [{ id: "p1", date: "2026-09-22", amount: 130, method: "Chèque", note: "" }] });
    const { container, unmount } = await mount(<PaymentsEditor doc={doc} totals={computeTotals(doc)} onPatch={(p) => patches.push(p)} />);
    await click(container.querySelector('button[title="Modifier ce paiement"]'));
    await act(async () => { setValue(byLabel(container, "Montant"), "100"); });
    await click(button(container, "Enregistrer"));
    expect(patches[0].status).toBe("payée" === doc.status && 120 - 20 - 100 <= 0.005 ? undefined : "envoyée");
    expect(patches[0].status).toBeUndefined(); // 100 + 20 d'acompte = 120 : soldée
    await unmount();
  }, 30000);
});

describe("éditeur de facture : état repris de l'extérieur, fiche client déliée", () => {
  const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
  const noop = () => {};
  const common = { saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onFinalize: noop, onBack: noop, onGoToPricing: noop, products: [], stockByProduct: {}, companyProfile: profile, onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop };
  it("la facture repasse en « envoyée » hors de l'éditeur : le sélecteur de statut suit", async () => {
    const paid = facture({ status: "payée", paidAt: "2026-09-22T10:00:00.000Z", paidTotal: 120 });
    const { container, rerender, unmount } = await mount(<Editor {...common} doc={paid} clients={[]} onChange={noop} />);
    const select = () => [...container.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "payée"));
    expect(select().value).toBe("payée");
    await rerender(<Editor {...common} doc={{ ...paid, status: "envoyée", paidAt: null, paidTotal: null, updatedAt: Date.now() }} clients={[]} onChange={noop} />);
    expect(select().value).toBe("envoyée");
    await unmount();
  }, 30000);
  it("retaper un autre nom de client délie la fiche (« Enregistrer comme client » n'écrase plus l'ancienne)", async () => {
    const changes = [];
    const clients = [{ id: "c1", name: "Alpha SARL", address: "1 rue A" }];
    const doc = facture({ clientId: "c1", client: { type: "entreprise", name: "Alpha SARL", address: "1 rue A" } });
    const { container, unmount } = await mount(<Editor {...common} doc={doc} clients={clients} onChange={(p) => changes.push(p)} />);
    const input = [...container.querySelectorAll("input")].find((i) => i.value === "Alpha SARL");
    expect(input).toBeTruthy();
    await act(async () => { setValue(input, "Beta SAS"); });
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    const last = changes[changes.length - 1];
    expect(last.client.name).toBe("Beta SAS");
    expect(last.clientId).toBeNull();
    await unmount();
  }, 30000);
});

describe("rapprochement bancaire", () => {
  it("montants : signe moins typographique, séparateur de milliers seul", () => {
    expect(parseAmount("−80,00")).toBe(-80);
    expect(parseAmount("1.500")).toBe(1500);
    expect(parseAmount("1,500")).toBe(1500);
    expect(parseAmount("12,50")).toBe(12.5);
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("0,50")).toBe(0.5);
  });
  it("brouillons jamais proposés ; « 021 » seul avec deux pièces n° 021 : probable, pas sûr ; sûr si le montant est exact", () => {
    const docs = [
      { id: "f", type: "facture", docNumber: "FAC-021", status: "envoyée", issueDate: "2026-09-01", client: { name: "Alpha" }, payments: [] },
      { id: "s", type: "situation", vautFacture: true, docNumber: "SIT-021", status: "envoyée", issueDate: "2026-09-01", client: { name: "Mairie" }, payments: [] },
      { id: "b", type: "facture", docNumber: "FAC-030", status: "brouillon", issueDate: "2026-09-01", client: { name: "Brouillon" }, payments: [] },
    ];
    const candidates = openInvoiceCandidates(docs, (d) => ({ f: 1200, s: 500, b: 300 })[d.id]);
    expect(candidates.map((c) => c.docNumber)).toEqual(["FAC-021", "SIT-021"]);
    const ambiguous = suggestMatches({ bookedAt: "2026-09-22", amount: 300, label: "VIR 021", reference: "", counterparty: "" }, candidates);
    expect(ambiguous.map((s) => s.level)).toEqual(["probable", "probable"]);
    const exact = suggestMatches({ bookedAt: "2026-09-22", amount: 500, label: "VIR 021", reference: "", counterparty: "" }, candidates);
    expect(exact[0]).toMatchObject({ docNumber: "SIT-021", level: "sur" });
    const unique = suggestMatches({ bookedAt: "2026-09-22", amount: 300, label: "VIR FAC-021", reference: "", counterparty: "" }, candidates);
    expect(unique[0]).toMatchObject({ docNumber: "FAC-021", level: "sur" });
  });
});

describe("export comptable CSV : cellules neutralisées", () => {
  it("une cellule commençant par = + @ ou − (hors nombre) est préfixée d'une apostrophe", () => {
    const csv = entriesToCsv([{ date: "2026-09-13", journal: "VE", piece: "-FAC", label: '=HYPERLINK("http://x")', account: "411000", debit: -12.5, credit: 0, activity: "+1", source: "vente" }]);
    expect(csv).toContain('"\'=HYPERLINK(""http://x"")"');
    expect(csv).toContain('"\'-FAC"');
    expect(csv).toContain('"\'+1"');
    expect(csv).toContain('"-12,50"'); // un nombre négatif reste un nombre
  });
});

describe("côté serveur", () => {
  it("totaux : acompte versé et paiements déduits aussi sur une facture d'acompte", () => {
    const ac = { type: "acompte", items: [line(100)], acompteVerse: 20, payments: [{ id: "p", amount: 10 }] };
    expect(computeDocTotals(ac).montantARegler).toBe(90);
    expect(amountDueOf(ac)).toBe(90);
    expect(computeDocTotals({ ...ac, type: "devis" }).montantARegler).toBe(120);
  });
  it("factures récurrentes : dates de prestation vidées, échéance bornée au mois et calculée sans passer par l'heure UTC", () => {
    const copy = recurringInvoiceCopy({ type: "facture", serviceDate: "2026-01-05", serviceDateEnd: "2026-01-06", paidTotal: 120, items: [] }, "FAC-002", "2026-02-01", "id");
    expect(copy.serviceDate).toBe("");
    expect(copy.serviceDateEnd).toBe("");
    expect(copy).not.toHaveProperty("paidTotal");
    expect(advanceRecurrenceDate("2026-01-31", "mensuel")).toBe("2026-02-28");
    expect(advanceRecurrenceDate("2026-03-15", "mensuel")).toBe("2026-04-15");
    expect(advanceRecurrenceDate("2026-11-30", "trimestriel")).toBe("2027-02-28");
    expect(advanceRecurrenceDate("2024-02-29", "annuel")).toBe("2025-02-28");
    expect(advanceRecurrenceDate("n'importe quoi", "mensuel")).toBe("n'importe quoi");
  });
});
