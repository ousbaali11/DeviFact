// @vitest-environment jsdom
// Audit du 25/09/2026, second lot (décisions validées) : avoirs rattachés à
// la facture d'origine, suggestion d'acompte à confirmer, factures « en
// retard » relancées, export comptable (ventes seules, avoirs négatifs),
// budget chantier, pièces émises non supprimables, situations chaînées,
// champs réservés au propriétaire, règle d'arrondi unique, relance liée.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("./client.js", () => ({
  db: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => { throw new Error("pas d'accès base attendu"); },
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
import {
  Editor, SituationEditor, RelanceFormelleEditor, CompanyView, PaymentsEditor, AcompteSuggestionNotice,
  newDocument, newSituationDocument, newRelanceFormelleDocument, computeTotals, computeSituation, documentOutstanding, documentAmountDue, creditNotesTotalFor,
  isIssuedAccountingDocument, acompteSuggestionFor, resyncSituationFromPrevious, atelierChantierStats, accountingExportRow, emptyCompanyProfile, PLANS,
} from "./App.jsx";
import { isSale } from "./kpis.js";
import { computeDocTotals, computeSituationTotals, amountDueOf, creditNotesTotalFor as creditNotesServer } from "../supabase/functions/_shared/totals.ts";
import * as shared from "../supabase/functions/_shared/accounting.ts";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null; });

const line = (unitPrice, id = `l${unitPrice}`, extra = {}) => ({ id, type: "line", designation: "Poste", details: [], qty: 1, unitPrice, tva: 20, discount: 0, ...extra });
const profile = { ...emptyCompanyProfile(), name: "Bâti Plus" };
const facture = (extra = {}) => ({ ...newDocument("facture", []), id: "f1", docNumber: "F-001", issueDate: "2026-09-01", dueDays: 30, currency: "EUR", status: "envoyée", company: { ...profile }, client: { type: "entreprise", name: "Client SAS" }, clientId: "c1", items: [line(1000)], payments: [], ...extra });
const avoir = (extra = {}) => ({ ...newDocument("avoir", []), id: "a1", docNumber: "AV-001", issueDate: "2026-09-10", currency: "EUR", status: "envoyée", client: { type: "entreprise", name: "Client SAS" }, items: [line(100, "x")], factureOrigineId: "f1", factureOrigineRef: "F-001", ...extra });
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
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 500)); });
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const noop = () => {};
const editorProps = { saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onFinalize: noop, onBack: noop, onGoToPricing: noop, products: [], stockByProduct: {}, companyProfile: profile, onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop, clients: [] };

describe("avoir rattaché à la facture d'origine", () => {
  it("1 200 € facturés, 1 000 € payés, avoir de 120 € rattaché : il reste 80 € (site et serveur)", () => {
    const f = facture({ payments: [{ id: "p", amount: 1000 }] });
    const docs = [f, avoir()];
    expect(computeTotals(f).totalTTC).toBe(1200);
    expect(creditNotesTotalFor(f, docs)).toBe(120);
    expect(documentOutstanding(f)).toBe(200); // sans la liste : ancien calcul
    expect(documentOutstanding(f, docs)).toBe(80);
    expect(documentAmountDue(f, docs)).toBe(80);
    expect(creditNotesServer(f, docs)).toBe(120);
    expect(amountDueOf(f, docs)).toBe(80);
    expect(amountDueOf(f)).toBe(200);
  });
  it("avoir brouillon ou rattaché à une autre facture : ignoré ; facture payée puis avoir : reste 0", () => {
    const f = facture();
    expect(documentOutstanding(f, [f, avoir({ status: "brouillon" })])).toBe(1200);
    expect(documentOutstanding(f, [f, avoir({ factureOrigineId: "autre" })])).toBe(1200);
    const paid = facture({ status: "payée", paidTotal: 1200, payments: [{ id: "p", amount: 1200 }] });
    expect(documentOutstanding(paid, [paid, avoir()])).toBe(0);
    // Payée, lignes ajoutées (+240 €) puis avoir de 120 € : il reste 120 €.
    const more = { ...paid, items: [line(1000), line(200, "y")] };
    expect(documentOutstanding(more, [more, avoir()])).toBe(120);
  });
  it("éditeur : la liste des factures rattache l'avoir (identifiant, numéro, date)", async () => {
    const changes = [];
    const f = facture();
    const av = { ...avoir({ factureOrigineId: null, factureOrigineRef: "", factureOrigineDate: "" }), id: "a2" };
    const { container, unmount } = await mount(<Editor {...editorProps} doc={av} linkableInvoices={[f]} onChange={(p) => changes.push(p)} />);
    const select = container.querySelector('select[aria-label="Facture corrigée"]');
    expect(select).toBeTruthy();
    expect(select.textContent.replace(/[  ]/g, " ")).toContain("F-001 · Client SAS · 1 200,00 €");
    await act(async () => { setValue(select, "f1"); });
    await flush();
    expect(changes[changes.length - 1]).toMatchObject({ factureOrigineId: "f1", factureOrigineRef: "F-001", factureOrigineDate: "2026-09-01" });
    await unmount();
  }, 30000);
  it("paiements reçus : l'avoir rattaché compte dans le passage à « payée »", async () => {
    const patches = [];
    const f = facture({ items: [line(100)] }); // 120 € TTC, avoir de 20 €
    const { container, unmount } = await mount(<PaymentsEditor doc={f} totals={computeTotals(f)} creditTotal={20} onPatch={(p) => patches.push(p)} />);
    const amount = container.querySelector('input[type="number"]');
    expect(amount).toBeTruthy();
    await act(async () => { setValue(amount, "100"); });
    await click([...container.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Ajouter")));
    expect(patches[0].status).toBe("payée");
    await unmount();
  }, 30000);
  it("indicateurs : un avoir émis est une vente négative", () => {
    expect(isSale(avoir())).toBe(true);
    expect(isSale(avoir({ status: "brouillon" }))).toBe(false);
  });
});

describe("suggestion d'acompte à la conversion (à confirmer, jamais pré-remplie)", () => {
  const devis = { ...newDocument("devis", []), id: "d1", docNumber: "DEV-007", status: "signé", items: [line(1000)] };
  const acompte = { ...newDocument("acompte", []), id: "ac1", docNumber: "ACO-003", status: "payée", sourceDevisRef: "DEV-007", items: [line(300)] };
  const invoice = facture({ id: "f9", linkedDevisId: "d1", acompteVerse: "" });
  it("facture née du devis, acompte payé : suggestion de 360 € ; rien sans acompte payé, déjà déduit ou ignorée", () => {
    expect(acompteSuggestionFor(invoice, [devis, acompte, invoice])).toEqual({ devisNumber: "DEV-007", docNumbers: ["ACO-003"], amount: 360 });
    expect(invoice.acompteVerse).toBe(""); // jamais pré-rempli
    expect(acompteSuggestionFor(invoice, [devis, { ...acompte, status: "envoyée" }, invoice])).toBeNull();
    expect(acompteSuggestionFor({ ...invoice, acompteVerse: 360 }, [devis, acompte, invoice])).toBeNull();
    expect(acompteSuggestionFor({ ...invoice, acompteSuggestionDismissed: true }, [devis, acompte, invoice])).toBeNull();
    expect(acompteSuggestionFor(facture(), [devis, acompte])).toBeNull();
  });
  it("éditeur : « Déduire » renseigne l'acompte versé, « Ignorer » mémorise le refus", async () => {
    const changes = [];
    const suggestion = { devisNumber: "DEV-007", docNumbers: ["ACO-003"], amount: 360 };
    const { container, unmount } = await mount(<Editor {...editorProps} doc={invoice} acompteSuggestion={suggestion} onChange={(p) => changes.push(p)} />);
    const notice = container.querySelector('[data-testid="acompte-suggestion"]');
    expect(notice.textContent).toContain("ACO-003");
    expect(notice.textContent.replace(/[  ]/g, " ")).toContain("360,00 €");
    await click([...notice.querySelectorAll("button")].find((b) => b.textContent.startsWith("Déduire")));
    await flush();
    expect(changes[changes.length - 1]).toMatchObject({ acompteVerse: 360 });
    await click([...container.querySelectorAll('[data-testid="acompte-suggestion"] button')].find((b) => b.textContent === "Ignorer"));
    await flush();
    expect(changes[changes.length - 1]).toMatchObject({ acompteSuggestionDismissed: true });
    await unmount();
  }, 30000);
  it("bandeau absent sans suggestion", async () => {
    const { container, unmount } = await mount(<AcompteSuggestionNotice suggestion={null} currency="EUR" onApply={noop} onDismiss={noop} />);
    expect(container.querySelector('[data-testid="acompte-suggestion"]')).toBeNull();
    await unmount();
  });
});

describe("export comptable : ventes émises seulement, avoirs en négatif", () => {
  const docs = [facture(), avoir(), { ...newDocument("devis", []), docNumber: "DEV-1", issueDate: "2026-09-02", status: "envoyé", items: [line(50)] }, facture({ id: "fb", docNumber: "F-BROUILLON", status: "brouillon" }), { ...newDocument("commande", []), docNumber: "CMD-1", issueDate: "2026-09-03", status: "envoyée", items: [line(70)] }];
  it("ligne d'un avoir : HT, TVA et TTC négatifs, identiques côté serveur", () => {
    expect(accountingExportRow(avoir()).slice(5)).toEqual([-100, -20, -120]);
    expect(shared.accountingExportRow(avoir()).slice(5)).toEqual([-100, -20, -120]);
  });
  it("export programmé : devis, brouillons et bons de commande exclus", () => {
    const sheets = shared.buildExportSheets(docs, { from: "2026-09-01", to: "2026-09-30", label: "septembre 2026" }, { includeEntries: false });
    expect(sheets.rows.slice(1).map((r) => r[1])).toEqual(["F-001", "AV-001"]);
  });
});

describe("budget chantier", () => {
  it("prévu : devis vivants seulement ; facturé : factures, acomptes, situations, avoirs déduits ; nom insensible à la casse", () => {
    const d = (type, status, extra = {}) => ({ ...newDocument(type, []), chantier: "Maison Dupont", status, issueDate: "2026-09-01", items: [line(1000)], ...extra });
    const docs = [
      d("devis", "signé"), d("devis", "refusé"), d("devis", "brouillon"), d("devis", "expiré"),
      d("facture", "envoyée", { chantier: "maison dupont" }), d("facture", "brouillon"), d("acompte", "payée", { items: [line(300)] }),
      { ...newSituationDocument([]), chantier: "MAISON DUPONT", status: "envoyée", vautFacture: true, items: [{ id: "s", type: "line", designation: "GO", qty: 10, unitPrice: 100, tva: 20, avancementPct: 50, montantCumulePrecedent: 0 }] },
      d("avoir", "envoyée", { items: [line(100)] }),
    ];
    const stats = atelierChantierStats(docs, []);
    expect(stats).toHaveLength(1);
    expect(stats[0].nom).toBe("Maison Dupont");
    // Montants HT depuis la priorité 6 (marge) : devis 1 000, facture 1 000,
    // acompte 300, situation 500, avoir −100.
    expect(stats[0].devisTotal).toBe(1000);
    expect(stats[0].factureTotal).toBe(1000 + 300 + 500 - 100);
  });
});

describe("pièces comptables émises : jamais supprimées", () => {
  it("facture, acompte, situation valant facture et avoir émis ; brouillons et devis restent supprimables", () => {
    expect(isIssuedAccountingDocument(facture())).toBe(true);
    expect(isIssuedAccountingDocument(facture({ status: "brouillon" }))).toBe(false);
    expect(isIssuedAccountingDocument(avoir())).toBe(true);
    expect(isIssuedAccountingDocument({ ...newSituationDocument([]), status: "envoyée", vautFacture: true })).toBe(true);
    expect(isIssuedAccountingDocument({ ...newSituationDocument([]), status: "envoyée", vautFacture: false })).toBe(false);
    expect(isIssuedAccountingDocument({ ...newDocument("devis", []), status: "signé" })).toBe(false);
  });
});

describe("situations chaînées : déjà facturé resynchronisé", () => {
  const sit1 = { ...newSituationDocument([]), id: "s1", docNumber: "SIT-001", numeroSituation: 1, status: "envoyée", vautFacture: true, items: [{ id: "a", type: "line", designation: "Gros œuvre", qty: 1, unitPrice: 10000, tva: 20, avancementPct: 40, montantCumulePrecedent: 0 }, { id: "b", type: "line", designation: "Toiture", qty: 1, unitPrice: 5000, tva: 20, avancementPct: 20, montantCumulePrecedent: 0 }] };
  const sit2 = { ...newSituationDocument([]), id: "s2", docNumber: "SIT-002", numeroSituation: 2, previousSituationId: "s1", status: "brouillon", vautFacture: true, items: [{ id: "c", type: "line", designation: "Gros œuvre", qty: 1, unitPrice: 10000, tva: 20, avancementPct: 60, montantCumulePrecedent: 3000 }] };
  it("situation 1 corrigée de 30 % à 40 % : le déjà facturé passe de 3 000 à 4 000, le poste absent est ajouté à son avancement", () => {
    const fix = resyncSituationFromPrevious(sit2, sit1);
    expect(fix.items[0].montantCumulePrecedent).toBe(4000);
    expect(fix.items[1]).toMatchObject({ designation: "Toiture", avancementPct: 20, montantCumulePrecedent: 1000 });
    expect(computeSituation({ ...sit2, ...fix }).subtotalHT).toBe(2000); // 6 000 − 4 000, toiture à 0
    expect(resyncSituationFromPrevious({ ...sit2, ...fix }, sit1)).toBeNull(); // plus rien à corriger
  });
  it("éditeur : bandeau et bouton « Mettre à jour » sur la suivante, avertissement sur la précédente", async () => {
    const changes = [];
    const props = { documents: [sit1, sit2], saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onFinalize: noop, onBack: noop, onCreateNext: noop, onGoToPricing: noop, companyProfile: profile, clients: [] };
    const a = await mount(<SituationEditor {...props} doc={sit2} onChange={(p) => changes.push(p)} />);
    const banner = a.container.querySelector('[data-testid="situation-resync"]');
    expect(banner.textContent).toContain("SIT-001");
    await click([...banner.querySelectorAll("button")][0]);
    await flush();
    expect(changes[changes.length - 1].items[0].montantCumulePrecedent).toBe(4000);
    await a.unmount();
    const b = await mount(<SituationEditor {...props} doc={sit1} onChange={noop} />);
    expect(b.container.querySelector('[data-testid="situation-has-next"]').textContent).toContain("SIT-002");
    expect(b.container.querySelector('[data-testid="situation-resync"]')).toBeNull();
    await b.unmount();
  }, 30000);
});

describe("relance formelle liée à une facture", () => {
  it("la liste propose les factures non soldées du client et pré-remplit référence, dates et montant dû (avoir déduit)", async () => {
    const changes = [];
    const f = facture({ payments: [{ id: "p", amount: 200 }] });
    const docs = [f, avoir(), facture({ id: "f2", docNumber: "F-002", client: { name: "Autre" }, clientId: "c2" }), facture({ id: "f3", docNumber: "F-003", status: "payée" })];
    const doc = { ...newRelanceFormelleDocument([]), client: { type: "entreprise", name: "Client SAS", address: "" }, clientId: "c1" };
    const { container, unmount } = await mount(<RelanceFormelleEditor doc={doc} documents={docs} saving={false} account={account} plans={PLANS} siteSettings={{ name: "Chantiflow" }} isLocked={false} isViewer={false} onChange={(p) => changes.push(p)} onFinalize={noop} onBack={noop} onGoToPricing={noop} companyProfile={profile} clients={[]} />);
    const select = container.querySelector('select[aria-label="Facture à relancer"]');
    const options = [...select.options].map((o) => o.textContent.replace(/[  ]/g, " "));
    expect(options).toEqual(["— Saisie libre —", "F-001 · Client SAS · reste 880,00 €"]);
    await act(async () => { setValue(select, "f1"); });
    await flush();
    expect(changes[changes.length - 1]).toMatchObject({ factureId: "f1", factureRef: "F-001", factureDate: "2026-09-01", dateEcheanceOrigine: "2026-10-01", montantDu: 880 });
    await unmount();
  }, 30000);
});

describe("Mon entreprise : IBAN et BIC réservés au propriétaire", () => {
  // Nom vide : le formulaire s'ouvre directement (sinon fiche résumée d'abord).
  const render = (role) => mount(<CompanyView profile={{ ...profile, name: "", iban: "FR76 1234", bic: "AGRIFRPP" }} saving={false} onSave={noop} onReset={noop} documentCount={0} clientCount={0} account={{ ...account, role }} isLocked={false} isViewer={false} onGoToPricing={noop} />);
  it("éditeur : champs grisés et mention ; propriétaire : modifiables", async () => {
    const a = await render("editor");
    const iban = [...a.container.querySelectorAll("input")].find((i) => i.value === "FR76 1234");
    expect(iban.disabled).toBe(true);
    expect(a.container.textContent).toContain("propriétaire seulement");
    await a.unmount();
    const b = await render("owner");
    expect([...b.container.querySelectorAll("input")].find((i) => i.value === "FR76 1234").disabled).toBe(false);
    await b.unmount();
  }, 30000);
});

describe("règle d'arrondi unique", () => {
  it("3 × 10,333 € : ligne 31,00, TVA 6,20, TTC 37,20 — identique côté serveur ; TVA par taux calculée sur la somme des lignes", () => {
    const doc = { type: "facture", items: [line(10.333, "a", { qty: 3 }), line(0.333, "b"), line(0.333, "c")] };
    const t = computeTotals(doc);
    expect(t.computedLines.map((l) => l.totalHT)).toEqual([31, 0.33, 0.33]);
    expect(t.subtotalHT).toBe(31.66);
    expect(t.tvaGroups[20]).toBe(6.33); // 31,66 × 20 % = 6,332 → 6,33 (et non 6,2 + 0,07 + 0,07)
    expect(t.totalTTC).toBe(37.99);
    const s = computeDocTotals(doc);
    expect([s.subtotalHT, s.totalTVA, s.totalTTC]).toEqual([31.66, 6.33, 37.99]);
    expect(s.tvaByRate["20"]).toBe(6.33);
  });
  it("situation : montants au centime, net à payer identique côté serveur", () => {
    const sit = { ...newSituationDocument([]), vautFacture: true, retenueGarantiePct: 5, acompteVerse: 10.005, items: [{ id: "s", type: "line", designation: "GO", qty: 3, unitPrice: 33.333, tva: 20, avancementPct: 33.3, montantCumulePrecedent: 0 }] };
    const a = computeSituation(sit), b = computeSituationTotals(sit);
    expect(a.subtotalHT).toBe(33.3);
    expect([a.totalTVA, a.totalTTCBrut, a.retenueGarantie, a.netAPayer]).toEqual([b.totalTVA, b.totalTTCBrut, b.retenueGarantie, b.netAPayer]);
    expect(a.netAPayer).toBe(Math.round(a.netAPayer * 100) / 100);
  });
});
