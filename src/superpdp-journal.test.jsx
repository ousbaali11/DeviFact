// @vitest-environment jsdom
// Super PDP, étape 4 (30/09/2026), chantier 1 — journal des envois : lignes
// de la table pdp_journal affichées pour une pièce (clic sur le badge de
// l'éditeur) et pour l'organisation (carte de Mon entreprise) ; journal
// indisponible signalé sans casser la page.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const state = { rows: [], fail: false, queries: [] };
const ROWS = [
  { id: 3, document_id: "d1", doc_number: "FAC-026", pdp_invoice_id: 804569, source: "relecture", status_code: "fr:202", status_text: "Reçue", detail: "Événement Super PDP n° 9001 du 2026-09-29T11:52:04Z", actor: null, created_at: "2026-09-29T11:52:04.000Z" },
  { id: 2, document_id: "d1", doc_number: "FAC-026", pdp_invoice_id: 804569, source: "envoi", status_code: "api:uploaded", status_text: "Déposée chez Super PDP", detail: "Dépôt n° 804569 (bac à sable, fichier FAC-026-facturx.pdf)", actor: "u1", created_at: "2026-09-29T11:40:44.000Z" },
  { id: 1, document_id: "d1", doc_number: "FAC-026", pdp_invoice_id: null, source: "erreur", status_code: "api:invalid", status_text: "Fichier refusé", detail: "Le fichier Factur-X est refusé par la validation Super PDP : [BR-CO-09] The Seller VAT identifier…", actor: "u1", created_at: "2026-09-29T11:20:00.000Z" },
  { id: 0, document_id: "d2", doc_number: "AVO-001", pdp_invoice_id: 804800, source: "encaissement", status_code: "fr:212", status_text: "Encaissée", detail: "Encaissement transmis à Super PDP (facture payée en totalité)", actor: "u1", created_at: "2026-09-29T12:00:00.000Z" },
];
function journalBuilder() {
  const filters = {};
  const b = {
    select: () => b,
    eq: (k, v) => { filters[k] = v; return b; },
    order: () => b,
    limit: async (n) => {
      state.queries.push({ ...filters, limit: n });
      if (state.fail) return { data: null, error: { message: 'relation "pdp_journal" does not exist' } };
      return { data: state.rows.filter((r) => !filters.document_id || r.document_id === filters.document_id).slice(0, n), error: null };
    },
  };
  return b;
}
vi.mock("./client.js", () => ({
  db: {
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    functions: { invoke: async (name, opts) => (opts?.body?.action === "status" ? { data: { configured: true, connected: true, env: "sandbox", companyName: "Burger Queen", companyNumber: "000000002", companyNumberScheme: "sandbox", verificationStatus: "verified" }, error: null } : { data: null, error: null }) },
    rpc: async () => ({ data: [{ user_id: "u1", email: "ousbaali11@gmail.com", full_name: "Jamal B" }], error: null }),
    from: (table) => (table === "pdp_journal" ? journalBuilder() : { update: () => ({ eq: async () => ({ data: [], error: null }) }) }),
  },
}));
import { PdpJournal, Editor, SuperPdpCard, newDocument, emptyCompanyProfile, PLANS } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null; });
beforeEach(() => { state.rows = ROWS; state.fail = false; state.queries.length = 0; });

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const rowsOf = (c) => [...c.querySelectorAll('[data-testid="pdp-journal-row"]')];

describe("PdpJournal", () => {
  it("pièce : lignes du document seulement, plus récente en premier, source, statut en français, détail, auteur ou tâche automatique", async () => {
    const { container, unmount } = await mount(<PdpJournal organizationId="org" documentId="d1" />);
    expect(state.queries[0]).toMatchObject({ organization_id: "org", document_id: "d1", limit: 50 });
    const rows = rowsOf(container);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.dataset.source)).toEqual(["relecture", "envoi", "erreur"]);
    expect(rows[0].textContent).toContain("Suivi");
    expect(rows[0].textContent).toContain("Reçue");
    expect(rows[0].textContent).toContain("tâche automatique");
    expect(rows[1].textContent).toContain("Envoi");
    expect(rows[1].textContent).toContain("Déposée chez Super PDP");
    expect(rows[1].textContent).toContain("Dépôt n° 804569");
    expect(rows[1].textContent).toContain("Jamal");
    expect(rows[2].textContent).toContain("Erreur");
    expect(rows[2].textContent).toContain("Fichier refusé");
    expect(rows[2].textContent).toContain("BR-CO-09");
    expect(container.textContent).not.toContain("AVO-001");
    await unmount();
  });
  it("organisation : toutes les pièces avec leur numéro ; table absente : message sans casser la page", async () => {
    const a = await mount(<PdpJournal organizationId="org" limit={20} />);
    expect(state.queries[0]).toMatchObject({ organization_id: "org", limit: 20 });
    expect(state.queries[0].document_id).toBeUndefined();
    expect(rowsOf(a.container)).toHaveLength(4);
    expect(a.container.textContent).toContain("AVO-001");
    expect(a.container.textContent).toContain("Encaissée");
    await a.unmount();
    state.fail = true;
    const b = await mount(<PdpJournal organizationId="org" documentId="d1" />);
    expect(b.container.textContent).toContain("Journal indisponible pour l'instant");
    expect(rowsOf(b.container)).toHaveLength(0);
    await b.unmount();
  });
});

describe("intégration", () => {
  const noop = () => {};
  const account = { id: "u1", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@exemple.fr", memberships: [] };
  const props = { saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, products: [], stockByProduct: {}, clients: [], companyProfile: { ...emptyCompanyProfile(), name: "Bâti Plus", country: "🇫🇷 FR" }, onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop };
  it("éditeur : un clic sur le badge Super PDP ouvre l'historique de la pièce, la croix le ferme", async () => {
    const doc = { ...newDocument("facture", []), id: "d1", docNumber: "FAC-026", status: "envoyée", pdp: { invoiceId: 804569, status: "fr:202", statusText: "Reçue", sentAt: "2026-09-29T11:40:44.000Z" } };
    const { container, unmount } = await mount(<Editor {...props} doc={doc} pdpStatus={{ configured: true, connected: true, env: "sandbox", verificationStatus: "verified" }} onSendPdp={async () => ({})} />);
    const badge = container.querySelector('[data-testid="pdp-badge"]');
    expect(badge.textContent).toBe("Super PDP : Reçue");
    expect(container.querySelector('[data-testid="pdp-journal"]')).toBeNull();
    await click(badge);
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    const journal = container.querySelector('[data-testid="pdp-journal"]');
    expect(journal).toBeTruthy();
    expect(journal.textContent).toContain("Historique Super PDP de FAC-026");
    expect(rowsOf(container)).toHaveLength(3);
    await click(journal.querySelector('[aria-label="Fermer l\'historique"]'));
    expect(container.querySelector('[data-testid="pdp-journal"]')).toBeNull();
    await unmount();
  }, 30000);
  it("carte Mon entreprise : compte connecté → derniers événements de l'organisation", async () => {
    const { container, unmount } = await mount(<SuperPdpCard account={account} profile={{ country: "🇫🇷 FR" }} />);
    expect(container.textContent).toContain("Burger Queen");
    const journal = container.querySelector('[data-testid="pdp-journal"]');
    expect(journal).toBeTruthy();
    expect(journal.textContent).toContain("Derniers événements Super PDP");
    expect(rowsOf(container)).toHaveLength(4);
    expect(state.queries.some((q) => q.limit === 20 && !q.document_id)).toBe(true);
    await unmount();
  }, 30000);
});
