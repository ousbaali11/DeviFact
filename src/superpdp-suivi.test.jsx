// @vitest-environment jsdom
// Super PDP, étape 3 — suivi des factures transmises : application des
// événements (dernier par facture, identifiants croissants, pagination),
// règle d'encaissement fr:212 (une seule fois, facture transmise et payée en
// totalité), parité site / serveur, bouton « Actualiser » de l'éditeur.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor, newDocument, emptyCompanyProfile, PLANS } from "./App.jsx";
import * as site from "./pdp-rules.js";
import * as server from "../supabase/functions/_shared/superpdp-rules.ts";

const ev = (id, invoice_id, status_code, extra = {}) => ({ id, invoice_id, status_code, status_text: "x", created_at: `2026-09-26T10:00:0${id % 10}.000Z`, ...extra });

describe("application des événements", () => {
  it("dernier événement par facture, quel que soit l'ordre reçu ; plus grand identifiant lu ; libellés français", () => {
    const { updates, lastEventId } = site.applyPdpEvents([ev(12, 501, "fr:202"), ev(10, 501, "api:uploaded"), ev(11, 777, "api:sent"), ev(13, 777, "fr:210", { status_text: "Refused" })]);
    expect(lastEventId).toBe(13);
    expect(updates).toEqual([
      { invoiceId: 501, status: "fr:202", statusText: "Reçue", lastEventId: 12, lastEventAt: "2026-09-26T10:00:02.000Z" },
      { invoiceId: 777, status: "fr:210", statusText: "Refusée", lastEventId: 13, lastEventAt: "2026-09-26T10:00:03.000Z" },
    ]);
  });
  it("événements incomplets ignorés, statut inconnu : libellé de Super PDP, liste vide → rien", () => {
    const { updates, lastEventId } = site.applyPdpEvents([{ id: 5 }, ev(6, 9, "ppf:something", { status_text: "Déposé sur le PPF" }), { id: "x", invoice_id: 9, status_code: "fr:200" }]);
    expect(updates).toEqual([{ invoiceId: 9, status: "ppf:something", statusText: "Déposé sur le PPF", lastEventId: 6, lastEventAt: "2026-09-26T10:00:06.000Z" }]);
    expect(lastEventId).toBe(6);
    expect(site.applyPdpEvents([])).toEqual({ updates: [], lastEventId: 0 });
  });
});

describe("encaissement fr:212", () => {
  const base = { ...newDocument("facture", []), status: "payée", pdp: { invoiceId: 501, status: "fr:202" } };
  it("une facture transmise passée « payée » : oui, une seule fois", () => {
    expect(site.shouldSendPaidEvent(base)).toBe(true);
    expect(site.shouldSendPaidEvent({ ...base, pdp: { ...base.pdp, paidEventAt: "2026-09-26T10:00:00Z" } })).toBe(false);
  });
  it("jamais : envoyée non payée, acompte, non transmise, facture rejetée ou refusée", () => {
    expect(site.shouldSendPaidEvent({ ...base, status: "envoyée" })).toBe(false);
    expect(site.shouldSendPaidEvent({ ...base, type: "acompte" })).toBe(false);
    expect(site.shouldSendPaidEvent({ ...base, pdp: null })).toBe(false);
    expect(site.shouldSendPaidEvent({ ...base, pdp: { invoiceId: null, status: "error" } })).toBe(false);
    for (const status of ["fr:210", "fr:213", "api:invalid", "api:rejected", "fr:501"]) expect(site.shouldSendPaidEvent({ ...base, pdp: { invoiceId: 501, status } })).toBe(false);
  });
});

describe("parité site / serveur", () => {
  it("mêmes réductions et mêmes règles d'encaissement", () => {
    const events = [ev(3, 1, "fr:205"), ev(1, 1, "api:uploaded"), ev(2, 2, "api:invalid"), { id: 4 }];
    expect(server.applyPdpEvents(events)).toEqual(site.applyPdpEvents(events));
    for (const doc of [{ type: "facture", status: "payée", pdp: { invoiceId: 1, status: "fr:202" } }, { type: "facture", status: "payée", pdp: { invoiceId: 1, status: "fr:213" } }, { type: "acompte", status: "payée", pdp: { invoiceId: 1, status: "fr:202" } }, { type: "facture", status: "envoyée", pdp: { invoiceId: 1, status: "fr:202" } }, { type: "facture", status: "payée", pdp: { invoiceId: 1, status: "fr:202", paidEventAt: "x" } }]) {
      expect(server.shouldSendPaidEvent(doc)).toBe(site.shouldSendPaidEvent(doc));
    }
  });
});

describe("éditeur : bouton Actualiser", () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
    window.scrollTo = () => {};
  });
  const noop = () => {};
  const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "editor", email: "t@exemple.fr", memberships: [] };
  const props = { saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, products: [], stockByProduct: {}, clients: [], companyProfile: { ...emptyCompanyProfile(), name: "Bâti Plus", country: "🇫🇷 FR" }, onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop };
  const connected = { configured: true, connected: true, env: "sandbox", companyName: "Burger Queen", verificationStatus: "verified" };
  async function mount(element) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(element); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
  }
  const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  const doc = { ...newDocument("facture", []), id: "doc_1", docNumber: "FAC-042", status: "envoyée", client: { type: "entreprise", name: "Tricatel", country: "🇫🇷 FR", siret: "0225:315143296_106842", city: "Paris", postalCode: "75001" }, items: [{ id: "l1", type: "line", designation: "Pose", qty: 1, unit: "u", unitPrice: 100, tva: 20, discount: 0, details: [] }], pdp: { invoiceId: 501, status: "api:uploaded", statusText: "Déposée chez Super PDP", sentAt: "2026-09-26T10:00:00.000Z" } };
  it("facture transmise : « Actualiser » relit les événements et met le badge à jour ; facture jamais transmise : pas de bouton", async () => {
    const onRefreshPdp = vi.fn(async () => ({ ok: true, updated: [{ documentId: "doc_1", pdp: { status: "fr:205", statusText: "Approuvée" } }, { documentId: "autre", pdp: { status: "fr:213", statusText: "Rejetée" } }], eventsRead: 2, paidSent: 0 }));
    const { container, unmount } = await mount(<Editor {...props} doc={doc} pdpStatus={connected} onSendPdp={async () => ({})} onRefreshPdp={onRefreshPdp} />);
    expect(container.querySelector('[data-testid="pdp-badge"]').textContent).toBe("Super PDP : Déposée chez Super PDP");
    await click(container.querySelector('[data-testid="pdp-refresh"]'));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(onRefreshPdp).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="pdp-badge"]').textContent).toBe("Super PDP : Approuvée");
    expect(container.querySelector('[data-testid="pdp-lock-banner"]')).toBeTruthy(); // approuvée : contenu toujours figé
    await unmount();
    const b = await mount(<Editor {...props} doc={{ ...doc, pdp: undefined }} pdpStatus={connected} onSendPdp={async () => ({})} onRefreshPdp={onRefreshPdp} />);
    expect(b.container.querySelector('[data-testid="pdp-refresh"]')).toBeNull();
    await b.unmount();
  }, 30000);
  it("encaissement transmis : mention sur le badge ; erreur d'encaissement : dans l'info-bulle", async () => {
    const a = await mount(<Editor {...props} doc={{ ...doc, status: "payée", pdp: { ...doc.pdp, status: "fr:212", paidEventAt: "2026-09-27T09:00:00.000Z" } }} pdpStatus={connected} onSendPdp={async () => ({})} onRefreshPdp={async () => ({ updated: [] })} />);
    expect(a.container.querySelector('[data-testid="pdp-badge"]').textContent).toBe("Super PDP : Encaissée · encaissement transmis");
    await a.unmount();
    const b = await mount(<Editor {...props} doc={{ ...doc, status: "payée", pdp: { ...doc.pdp, paidEventError: "http 500" } }} pdpStatus={connected} onSendPdp={async () => ({})} onRefreshPdp={async () => ({ updated: [] })} />);
    expect(b.container.querySelector('[data-testid="pdp-badge"]').getAttribute("title")).toContain("Encaissement non transmis : http 500");
    await b.unmount();
  }, 30000);
});
