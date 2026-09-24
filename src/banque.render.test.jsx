// @vitest-environment jsdom
// Page « Banque » (rapprochement bancaire, livraison 1) : import d'un relevé,
// opérations enregistrées sans doublon, correspondances sûres écrites tout de
// suite comme paiements sur les factures, correspondances probables et choix
// manuel, ignorer / rétablir / annuler, lecture seule, menus des trois versions.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";

// Base simulée : table bank_transactions en mémoire (empreinte unique par organisation).
const store = { rows: [], calls: [] };
function builder(table) {
  const q = { op: "select", payload: null, filters: {}, opts: null };
  const b = {};
  ["order", "limit"].forEach((m) => { b[m] = () => b; });
  b.select = () => { if (q.op === "upsert") q.returning = true; return b; };
  b.eq = (col, val) => { q.filters[col] = val; return b; };
  b.upsert = (rows, opts) => { q.op = "upsert"; q.payload = rows; q.opts = opts; return b; };
  b.update = (payload) => { q.op = "update"; q.payload = payload; return b; };
  b.then = (res, rej) => {
    store.calls.push({ table, op: q.op, filters: { ...q.filters } });
    if (table !== "bank_transactions") return Promise.resolve({ data: [], error: null }).then(res, rej);
    let data = null;
    if (q.op === "select") data = store.rows.filter((r) => r.organization_id === q.filters.organization_id);
    else if (q.op === "upsert") {
      data = [];
      for (const r of q.payload) {
        if (store.rows.some((x) => x.organization_id === r.organization_id && x.fingerprint === r.fingerprint)) continue;
        const row = { id: `tx${store.rows.length + 1}`, status: "a_traiter", document_id: null, payment_id: null, matched_by: null, created_at: new Date().toISOString(), ...r };
        store.rows.push(row);
        data.push(row);
      }
    } else if (q.op === "update") {
      const row = store.rows.find((r) => r.id === q.filters.id);
      if (row) Object.assign(row, q.payload);
      data = row ? [row] : [];
    }
    return Promise.resolve({ data, error: null }).then(res, rej);
  };
  return b;
}
vi.mock("./client.js", () => ({ db: { from: (table) => builder(table), functions: { invoke: async () => ({ data: null, error: null }) }, auth: { getSession: async () => ({ data: { session: null } }) } } }));

import { BankView, AtelierShell, ServicesVisibilitySettings, bankModuleVisible, BANK_MODULE_ID, newDocument, documentAmountDue, computeTotals } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
beforeEach(() => { store.rows = []; store.calls = []; });

const account = { id: "u1", organizationId: "org", plan: "gratuit", role: "owner", email: "t@e.fr", memberships: [{ organizationId: "org", role: "owner", name: "Org" }] };
const line = (unitPrice) => ({ id: `l${unitPrice}`, type: "line", designation: "Pose", details: [], qty: 1, unitPrice, tva: 20, discount: 0 });
const facture = (id, docNumber, clientName, unitPrice, extra = {}) => ({ ...newDocument("facture", []), id, docNumber, status: "envoyée", issueDate: "2026-09-10", client: { type: "entreprise", name: clientName }, items: [line(unitPrice)], payments: [], ...extra });
const initialDocs = () => [
  facture("f21", "FAC-021", "Communauté d'agglomération de Forbach", 1000), // 1 200 € TTC
  facture("f22", "FAC-022", "M. Dupont", 500), // 600 € TTC
  facture("f23", "FAC-023", "Martin Rénovation", 400), // 480 € TTC
];
const CSV = "Date;Libellé;Débit euros;Crédit euros\n22/09/2026;VIR SEPA COMMUNAUTE AGGLO FORBACH FAC-021;;1 200,00\n23/09/2026;PRLV SEPA EDF;80,00;\n24/09/2026;VIR SEPA DUPONT;;600,00\n25/09/2026;VIR INCONNU;;150,00\n";

// Harnais : les documents vivent dans un état, comme dans l'application
// (onPatchDocument = updateDoc), pour que la page voie les paiements écrits.
const harness = { patches: [], setDocs: null, docs: null };
function Harness({ isViewer = false }) {
  const [docs, setDocs] = useState(initialDocs);
  harness.setDocs = setDocs; harness.docs = docs;
  const onPatchDocument = (id, patch) => { harness.patches.push({ id, patch }); setDocs((list) => list.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d))); };
  return <BankView documents={docs} account={account} isLocked={false} isViewer={isViewer} onPatchDocument={onPatchDocument} />;
}
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });
const buttons = (c) => [...c.querySelectorAll("button")];
const byText = (c, text) => buttons(c).find((b) => b.textContent.replace(/[  ]/g, " ").trim().startsWith(text));
const text = (c) => c.textContent.replace(/[  ]/g, " ");
async function importCsv(container, content, name = "releve.csv") {
  const input = container.querySelector('input[type="file"]');
  const file = new File([content], name, { type: "text/csv" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle(); await settle();
}

describe("import et rapprochement automatique", () => {
  it("relevé CSV : opérations enregistrées, correspondances sûres payées automatiquement, le reste à traiter", async () => {
    harness.patches = [];
    const { container, unmount } = await mount(<Harness />);
    expect(text(container)).toContain("Aucune opération pour l'instant");
    await importCsv(container, CSV);
    expect(store.rows).toHaveLength(4);
    expect(text(container)).toContain("Import terminé : 4 opérations ajoutées, 2 paiements enregistrés automatiquement, 1 à vérifier.");
    // FAC-021 : numéro dans le libellé → payée ; FAC-022 : montant exact + nom du client, unique → payée.
    const f21 = harness.docs.find((d) => d.id === "f21"), f22 = harness.docs.find((d) => d.id === "f22");
    expect(f21.status).toBe("payée");
    expect(f21.payments).toEqual([{ id: "pay_bank_tx1", date: "2026-09-22", amount: 1200, method: "Virement bancaire", note: "VIR SEPA COMMUNAUTE AGGLO FORBACH FAC-021" }]);
    expect(f22.status).toBe("payée");
    expect(documentAmountDue(f22)).toBe(0);
    expect(harness.docs.find((d) => d.id === "f23").status).toBe("envoyée");
    expect(store.rows.map((r) => [r.status, r.matched_by])).toEqual([["rapproche", "auto"], ["a_traiter", null], ["rapproche", "auto"], ["a_traiter", null]]);
    // Onglets et liste « À traiter » : le débit EDF et le virement inconnu.
    expect(byText(container, "À traiter (2)")).toBeTruthy();
    expect(byText(container, "Rapprochées (2)")).toBeTruthy();
    expect(text(container)).toContain("PRLV SEPA EDF");
    expect(text(container)).toContain("Débit : pas un encaissement de facture.");
    expect(text(container)).toContain("Aucune facture correspondante trouvée.");
    // Le même relevé une seconde fois : rien de nouveau.
    await importCsv(container, CSV);
    expect(store.rows).toHaveLength(4);
    expect(text(container)).toContain("Import terminé : 0 opération ajoutée, 4 déjà connues, 0 paiement enregistré automatiquement, 0 à vérifier.");
    await unmount();
  }, 30000);
  it("correspondance probable : proposée, confirmée d'un clic ; choix manuel d'une autre facture ; ignorer et rétablir", async () => {
    harness.patches = [];
    const { container, unmount } = await mount(<Harness />);
    // 600 € sans nom reconnu : montant exact seul → probable, à confirmer.
    await importCsv(container, "Date;Libellé;Montant\n24/09/2026;VIREMENT;600,00\n25/09/2026;CB CARBURANT;-40,00\n");
    expect(text(container)).toContain("1 à vérifier");
    const propose = byText(container, "Rapprocher avec FAC-022");
    expect(propose).toBeTruthy();
    expect(propose.textContent).toContain("probable");
    // Choix manuel de FAC-023 à la place.
    const select = container.querySelector('select[aria-label="Autre facture"]');
    expect([...select.options].map((o) => o.textContent.replace(/[  ]/g, " "))).toEqual(["Autre facture…", "FAC-021 · Communauté d'agglomération de Forbach · reste 1 200,00 €", "FAC-022 · M. Dupont · reste 600,00 €", "FAC-023 · Martin Rénovation · reste 480,00 €"]);
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(select, "f23"); select.dispatchEvent(new Event("change", { bubbles: true })); });
    await click(byText(container, "Rapprocher") && buttons(container).find((b) => b.textContent.trim() === "Rapprocher"));
    await settle();
    expect(harness.docs.find((d) => d.id === "f23").status).toBe("payée");
    expect(store.rows[0]).toMatchObject({ status: "rapproche", document_id: "f23", matched_by: "manuel", payment_id: "pay_bank_tx1" });
    // Le débit : ignoré puis rétabli.
    await click(byText(container, "Ignorer"));
    await settle();
    expect(store.rows[1].status).toBe("ignore");
    expect(byText(container, "Ignorées (1)")).toBeTruthy();
    await click(byText(container, "Ignorées (1)"));
    await click(byText(container, "Rétablir"));
    await settle();
    expect(store.rows[1].status).toBe("a_traiter");
    await unmount();
  }, 30000);
  it("annuler un rapprochement : paiement retiré de la facture, qui repasse en « envoyée », opération de nouveau à traiter", async () => {
    harness.patches = [];
    const { container, unmount } = await mount(<Harness />);
    await importCsv(container, "Date;Libellé;Montant\n22/09/2026;VIR FAC-021;1200,00\n");
    expect(harness.docs.find((d) => d.id === "f21").status).toBe("payée");
    await click(byText(container, "Rapprochées (1)"));
    expect(text(container)).toContain("Facture FAC-021 · rapprochée automatiquement");
    await click(byText(container, "Annuler"));
    await settle();
    const f21 = harness.docs.find((d) => d.id === "f21");
    expect(f21.status).toBe("envoyée");
    expect(f21.payments).toEqual([]);
    expect(f21.paidAt).toBeNull();
    expect(store.rows[0]).toMatchObject({ status: "a_traiter", document_id: null, payment_id: null });
    await unmount();
  }, 30000);
  it("lecture seule (viewer) : pas d'import ni d'action, opérations visibles", async () => {
    store.rows = [{ id: "tx9", organization_id: "org", status: "rapproche", document_id: "f21", matched_by: "auto", booked_at: "2026-09-22", amount: 1200, currency: "EUR", label: "VIR FAC-021", counterparty: "", reference: "", fingerprint: "x" }];
    const { container, unmount } = await mount(<Harness isViewer />);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    await click(byText(container, "Rapprochées (1)"));
    expect(text(container)).toContain("VIR FAC-021");
    expect(text(container)).toContain("Facture FAC-021");
    expect(byText(container, "Annuler")).toBeUndefined();
    await unmount();
  }, 30000);
  it("reste à payer d'une facture : totaux habituels", () => {
    const f = facture("x", "F", "C", 100, { payments: [{ id: "p", amount: 20 }] });
    expect(computeTotals(f).totalTTC).toBe(120);
    expect(documentAmountDue(f)).toBe(100);
  });
});

describe("module Banque : masqué par défaut, activé depuis Admin › Services", () => {
  const noop = () => {};
  const shell = (siteSettings, setView) => (
    <AtelierShell view="dashboard" setView={setView} account={account} siteSettings={siteSettings} darkMode={false} setDarkMode={noop} onLogout={noop} onSwitchOrganization={noop} onCreateOwnOrg={noop} creatingOwnOrg={false} onOpenCreate={noop} commandPaletteOpen={false} setCommandPaletteOpen={noop} paletteCommands={[]}>
      <div>page</div>
    </AtelierShell>
  );
  it("masqué par défaut (réglage absent ou sans « banque ») : aucune entrée dans le menu Plus", async () => {
    expect(bankModuleVisible({ name: "Chantiflow" })).toBe(false);
    expect(bankModuleVisible({ visibleServices: ["devis", "facture"] })).toBe(false);
    expect(bankModuleVisible({ visibleServices: ["devis", BANK_MODULE_ID] })).toBe(true);
    for (const siteSettings of [{ name: "Chantiflow" }, { name: "Chantiflow", visibleServices: ["devis", "facture"] }]) {
      const { container, unmount } = await mount(shell(siteSettings, noop));
      await click(buttons(container).find((b) => b.getAttribute("title") === "Menu"));
      expect(buttons(container).find((b) => b.textContent.trim() === "Banque")).toBeUndefined();
      await unmount();
    }
  }, 30000);
  it("activé : entrée « Banque » dans le menu Plus", async () => {
    const views = [];
    const { container, unmount } = await mount(shell({ name: "Chantiflow", visibleServices: ["devis", "facture", BANK_MODULE_ID] }, (v) => views.push(v)));
    await click(buttons(container).find((b) => b.getAttribute("title") === "Menu"));
    const banque = buttons(container).find((b) => b.textContent.trim() === "Banque");
    expect(banque).toBeTruthy();
    await click(banque);
    expect(views).toEqual(["banque"]);
    await unmount();
  }, 30000);
  it("Admin › Services : interrupteur « Banque » sous les services, enregistré dans la liste des services visibles", async () => {
    const saved = [];
    const { container, unmount } = await mount(<ServicesVisibilitySettings siteSettings={{ name: "Chantiflow" }} saving={false} onSave={(s) => saved.push(s)} />);
    expect(text(container)).toContain("Banque (rapprochement bancaire)");
    const toggle = container.querySelector('button[aria-label="Module Banque"]');
    expect(toggle.getAttribute("title")).toBe("Masqué");
    await click(toggle);
    expect(saved).toHaveLength(1);
    expect(saved[0].visibleServices).toContain(BANK_MODULE_ID);
    expect(saved[0].visibleServices).toContain("facture"); // les services visibles par défaut sont conservés
    await unmount();
    const on = await mount(<ServicesVisibilitySettings siteSettings={{ visibleServices: ["devis", BANK_MODULE_ID] }} saving={false} onSave={(s) => saved.push(s)} />);
    expect(on.container.querySelector('button[aria-label="Module Banque"]').getAttribute("title")).toBe("Visible pour tout le monde");
    await click(on.container.querySelector('button[aria-label="Module Banque"]'));
    expect(saved[1].visibleServices).toEqual(["devis"]);
    await on.unmount();
  }, 30000);
});
