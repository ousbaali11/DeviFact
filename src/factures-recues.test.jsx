// @vitest-environment jsdom
// Priorité 6 : sous-traitants et fournisseurs. Rôle sur la fiche (client,
// fournisseur, sous-traitant), document « Facture reçue » (dépense d'un
// chantier, sans PDF généré, scan en pièce jointe), budget chantier en HT
// avec dépenses et marge, carte et alerte d'échéance sur le tableau de
// bord, écritures d'achat (604 sous-traitance / 607 achats) identiques sur
// le site et le serveur, hors limite de documents du forfait Gratuit.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("./client.js", () => ({
  db: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => { throw new Error("pas d'accès base attendu"); },
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed.test/f.pdf" }, error: null }) }) },
  },
}));
import { factureRecueTotals, buildPurchaseEntries, isSalesDocument, accountingDefaults } from "./accounting.js";
import * as shared from "../supabase/functions/_shared/accounting.ts";
import { FactureRecueEditor, ClientsView, AtelierHome, newFactureRecueDocument, newDocument, countedDocumentsLength, atelierChantierStats, documentValidationErrors, rankSupplier, CLIENT_ROLES, FACTURE_RECUE_STATUSES, emptyCompanyProfile, PLANS } from "./App.jsx";
import { isSale } from "./kpis.js";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });

const clean = (s) => s.replace(/[  ]/g, " ");
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const inDays = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return iso(d); };
const clients = [
  { id: "c1", type: "entreprise", role: "client", name: "Mairie de Stiring" },
  { id: "s1", type: "entreprise", role: "sous_traitant", name: "Charpente Martin" },
  { id: "f1", type: "entreprise", role: "fournisseur", name: "Point P" },
  { id: "c2", type: "particulier", name: "M. Dupont" }, // fiche ancienne, sans rôle : client
];
const recue = (extra = {}) => ({ ...newFactureRecueDocument([]), id: "fr1", docNumber: "FR-001", issueDate: "2026-09-10", dueDate: "2026-10-10", chantier: "Maison Dupont", objet: "Charpente lot 3", montantHT: "2500", tvaRate: 20, client: { type: "entreprise", name: "Charpente Martin" }, clientId: "s1", ...extra });
const line = (unitPrice) => ({ id: `l${unitPrice}`, type: "line", designation: "Poste", details: [], qty: 1, unitPrice, tva: 20, discount: 0 });
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const noop = () => {};
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
function setValue(input, value) {
  const proto = input.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
  input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 500)); });

describe("montants et écritures d'achat", () => {
  it("HT saisi, TVA au taux, TTC au centime — identique côté serveur", () => {
    const t = factureRecueTotals({ montantHT: "1234.567", tvaRate: 20 });
    expect(t).toEqual({ ht: 1234.57, rate: 20, tva: 246.91, ttc: 1481.48 });
    expect(shared.factureRecueTotals({ montantHT: "1234.567", tvaRate: 20 })).toEqual(t);
    expect(factureRecueTotals({ montantHT: "", tvaRate: 10 })).toEqual({ ht: 0, rate: 10, tva: 0, ttc: 0 });
  });
  it("sous-traitant → 604, fournisseur → 607, TVA déductible 445660, fournisseur 401000 ; débits = crédits ; parité serveur", () => {
    const docs = [
      recue(),
      recue({ id: "fr2", docNumber: "FR-002", client: { name: "Point P" }, clientId: null, montantHT: "100", tvaRate: 10, supplierInvoiceNumber: "PP-77", objet: "" }), // liée par le nom
      recue({ id: "fr3", docNumber: "FR-003", montantHT: "" }), // sans montant : ignorée
      { ...newDocument("facture", []), docNumber: "FAC-1", status: "envoyée", items: [line(100)] }, // pas un achat
    ];
    const entries = buildPurchaseEntries(docs, { clients, defaults: null });
    expect(entries.map((e) => [e.piece, e.account, e.debit, e.credit])).toEqual([
      ["FR-001", "604000", 2500, 0], ["FR-001", "445660", 500, 0], ["FR-001", "401000", 0, 3000],
      ["PP-77", "607000", 100, 0], ["PP-77", "445660", 10, 0], ["PP-77", "401000", 0, 110],
    ]);
    expect(entries[0]).toMatchObject({ journal: "AC", source: "achat", label: "Facture reçue Charpente Martin - Charpente lot 3", date: "2026-09-10" });
    const debit = entries.reduce((s, e) => s + e.debit, 0), credit = entries.reduce((s, e) => s + e.credit, 0);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
    expect(shared.buildPurchaseEntries(docs, { clients, defaults: null })).toEqual(entries);
    expect(buildPurchaseEntries(docs, { clients, defaults: { subcontracting: "604100" } })[0].account).toBe("604100");
    expect(accountingDefaults(null).subcontracting).toBe("604000");
  });
  it("export programmé : écritures d'achat de la période dans la feuille Écritures, jamais dans la feuille des ventes", () => {
    const docs = [recue(), recue({ id: "fr9", docNumber: "FR-009", issueDate: "2026-08-02" })];
    const sheets = shared.buildExportSheets(docs, { from: "2026-09-01", to: "2026-09-30", label: "septembre 2026", id: "2026-09" }, { includeEntries: true, clients });
    expect(sheets.rows).toHaveLength(1); // seulement l'en-tête : pas un document de vente
    expect(sheets.entryRows.slice(1).map((r) => [r[2], r[4], r[8]])).toEqual([["FR-001", "604000", "achat"], ["FR-001", "445660", "achat"], ["FR-001", "401000", "achat"]]);
    expect(isSalesDocument(recue())).toBe(false);
    expect(isSale(recue({ status: "payée" }))).toBe(false);
  });
});

describe("document, limite du forfait, budget chantier", () => {
  it("nouvelle facture reçue : FR-001, à payer, champs obligatoires clairs", () => {
    const d = newFactureRecueDocument([recue()]);
    expect(d.docNumber).toBe("FR-002");
    expect(d.status).toBe("à payer");
    expect(FACTURE_RECUE_STATUSES).toEqual(["à payer", "payée"]);
    expect(documentValidationErrors(d)).toEqual(["Nom du fournisseur ou du sous-traitant", "Montant HT"]);
    expect(documentValidationErrors(recue())).toEqual([]);
  });
  it("les factures reçues ne comptent pas dans la limite de documents du forfait Gratuit", () => {
    expect(countedDocumentsLength([recue(), recue({ id: "b" }), newDocument("devis", [])])).toBe(1);
    expect(countedDocumentsLength([])).toBe(0);
  });
  it("budget chantier en HT : prévu, facturé, dépenses des factures reçues, marge", () => {
    const docs = [
      { ...newDocument("devis", []), chantier: "Maison Dupont", status: "signé", issueDate: "2026-09-01", items: [line(10000)] },
      { ...newDocument("facture", []), chantier: "Maison Dupont", status: "envoyée", issueDate: "2026-09-01", items: [line(6000)] },
      recue(), // 2 500 HT
      recue({ id: "fr2", docNumber: "FR-002", client: { name: "Point P" }, clientId: "f1", montantHT: "800", chantier: "maison dupont" }),
      recue({ id: "fr3", docNumber: "FR-003", chantier: "Autre" }),
    ];
    const stats = atelierChantierStats(docs, []);
    const dupont = stats.find((c) => c.nom === "Maison Dupont");
    expect(dupont).toMatchObject({ devisTotal: 10000, factureTotal: 6000, depensesTotal: 3300, marge: 2700 });
    expect(stats.find((c) => c.nom === "Autre")).toMatchObject({ devisTotal: 0, factureTotal: 0, depensesTotal: 2500, marge: -2500 });
  });
  it("fournisseurs et sous-traitants d'abord dans les listes", () => {
    expect([...clients].sort((a, b) => rankSupplier(b) - rankSupplier(a)).map((c) => c.id)).toEqual(["s1", "f1", "c1", "c2"]);
    expect(CLIENT_ROLES.map(([id]) => id)).toEqual(["client", "fournisseur", "sous_traitant"]);
  });
});

describe("éditeur de facture reçue", () => {
  const props = { documents: [{ ...newDocument("commande", []), id: "cmd1", docNumber: "CMD-004", client: { name: "Charpente Martin" }, items: [line(2000)] }, { ...newDocument("devis", []), chantier: "Maison Dupont", items: [line(1)] }], clients, companyProfile: { ...emptyCompanyProfile(), name: "Bâti Plus" }, saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onFinalize: noop, onBack: noop, onGoToPricing: noop };
  it("fiches proposées (sous-traitants d'abord), chantiers, bon de commande du fournisseur, totaux recalculés, statut payé daté", async () => {
    const changes = [];
    const { container, unmount } = await mount(<FactureRecueEditor {...props} doc={recue()} onChange={(p) => changes.push(p)} />);
    const supplierInput = container.querySelector('input[aria-label="Fournisseur"]');
    const options = [...container.querySelectorAll(`datalist#${supplierInput.getAttribute("list")} option`)].map((o) => o.value);
    expect(options.slice(0, 2)).toEqual(["Charpente Martin", "Point P"]);
    expect(container.textContent).toContain("Fiche liée : Sous-traitant (compte 604 en comptabilité)");
    expect([...container.querySelectorAll('input[aria-label="Chantier"] ~ datalist option')].map((o) => o.value)).toEqual(["Maison Dupont"]);
    expect(clean(container.querySelector('select[aria-label="Bon de commande lié"]').textContent)).toContain("CMD-004 · Charpente Martin · 2 400,00 €");
    expect(clean(container.querySelector('[data-testid="facture-recue-totals"]').textContent)).toContain("Total TTC3 000,00 €");
    await act(async () => { setValue(container.querySelector('input[aria-label="Montant HT"]'), "1000"); });
    expect(clean(container.querySelector('[data-testid="facture-recue-totals"]').textContent)).toContain("Total TTC1 200,00 €");
    await act(async () => { setValue(container.querySelector('select[aria-label="Statut"]'), "payée"); });
    await flush();
    const last = changes[changes.length - 1];
    expect(last.montantHT).toBe("1000");
    expect(last.status).toBe("payée");
    expect(last.paidAt).toBe(iso(new Date()));
    expect(container.querySelector('input[aria-label="Payée le"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Scan de la facture"]')).toBeTruthy();
    await unmount();
  }, 30000);
  it("document vide : champs obligatoires signalés, bouton Enregistrer bloqué", async () => {
    const { container, unmount } = await mount(<FactureRecueEditor {...props} doc={newFactureRecueDocument([])} onChange={noop} />);
    expect(container.textContent).toContain("Champs obligatoires manquants");
    expect(container.textContent).toContain("Montant HT");
    await unmount();
  }, 30000);
});

describe("page Clients : rôle", () => {
  it("filtre par rôle et badge sur les fiches fournisseurs et sous-traitants ; formulaire avec le choix du rôle", async () => {
    const { container, unmount } = await mount(<ClientsView clients={clients} documents={[]} saving={false} onSave={noop} onDelete={noop} isLocked={false} isViewer={false} onGoToPricing={noop} />);
    const chips = [...container.querySelectorAll('[data-testid="client-role-filter"] button')].map((b) => b.textContent);
    expect(chips).toEqual(["Tous", "Clients", "Fournisseurs", "Sous-traitants"]);
    expect(container.textContent).toContain("Charpente MartinSous-traitant");
    expect(container.textContent).toContain("Point PFournisseur");
    await click([...container.querySelectorAll('[data-testid="client-role-filter"] button')][3]);
    expect(container.textContent).toContain("Charpente Martin");
    expect(container.textContent).not.toContain("Point P");
    expect(container.textContent).not.toContain("Mairie de Stiring");
    await unmount();
  }, 30000);
});

describe("tableau de bord", () => {
  const props = { darkMode: false, isLocked: false, isViewer: false, freeLimit: 10, freeLimitReached: false, offlineMode: false, visibleServices: ["devis", "facture_recue"], reminders: [], reminderMailto: () => "#", onCreate: noop, onOpenCreate: noop, onGoToDocuments: noop, onGoToPricing: noop, autoFactureNotice: null, onOpenAutoFacture: noop, onDismissAutoFacture: noop, reviewNotice: null, onSendReview: noop, onDismissReview: noop };
  it("carte « Factures reçues à payer » et alerte d'échéance dépassée qui ouvre la facture", async () => {
    const opened = [];
    const docs = [recue({ dueDate: inDays(-4) }), recue({ id: "fr2", docNumber: "FR-002", montantHT: "100", dueDate: inDays(10) }), recue({ id: "fr3", docNumber: "FR-003", status: "payée", dueDate: inDays(-30) })];
    const { container, unmount } = await mount(<AtelierHome {...props} account={{ ...account, organizationId: null, plan: "gratuit", paymentStatus: "gratuit" }} documents={docs} onOpenDoc={(id) => opened.push(id)} />);
    const text = clean(container.textContent);
    expect(text).toContain("Factures reçues à payer");
    expect(text).toContain("3 120,00 €"); // 3 000 + 120 TTC à payer
    expect(text).toContain("Forfait Gratuit : 0/10");
    const alerts = [...container.querySelectorAll('[data-testid="purchase-alert"]')];
    expect(alerts).toHaveLength(1);
    expect(clean(alerts[0].textContent)).toContain("FR-001 · Charpente Martin");
    expect(alerts[0].textContent).toContain("Échéance dépassée depuis 4 j");
    await click(alerts[0]);
    expect(opened).toEqual(["fr1"]);
    await unmount();
  }, 30000);
});
