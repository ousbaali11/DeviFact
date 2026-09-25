// @vitest-environment jsdom
// Points 5 et 6 (26/09/2026) : avoirs, factures d'acompte et situations
// valant facture transmis via Super PDP — règles d'éligibilité et
// d'encaissement par type (site + serveur), entrées Factur-X / « Envoyer via
// Super PDP » dans l'éditeur de facture (avoir, acompte) et dans l'éditeur de
// situation, badge, bandeau de contenu figé et verrou des modifications.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor, SituationEditor, newDocument, newSituationDocument, emptyCompanyProfile, PLANS } from "./App.jsx";
import * as site from "./pdp-rules.js";
import * as server from "../supabase/functions/_shared/superpdp-rules.ts";

const client = (extra = {}) => ({ type: "entreprise", name: "Tricatel", address: "1 rue du Test", postalCode: "75001", city: "Paris", country: "🇫🇷 FR", siret: "0225:315143296_106842", ...extra });
const line = { id: "l1", type: "line", designation: "Pose", qty: 1, unit: "u", unitPrice: 100, tva: 20, discount: 0, details: [] };
const piece = (type, extra = {}) => ({ ...newDocument(type, []), docNumber: type === "avoir" ? "AV-007" : type === "acompte" ? "AC-003" : "FAC-042", status: "envoyée", client: client(), items: [line], ...extra });
const avoir = (extra = {}) => piece("avoir", { factureOrigineRef: "FAC-014", factureOrigineDate: "2026-08-02", motifAvoir: "Erreur de facturation", modeRemboursement: "Remboursement par virement", ...extra });
const sitLine = { id: "s1", type: "line", designation: "Gros œuvre", qty: 1, unitPrice: 10000, tva: 20, avancementPct: 30, montantCumulePrecedent: 2000 };
const situation = (extra = {}) => ({ ...newSituationDocument([]), docNumber: "SIT-003", issueDate: "2026-09-13", numeroSituation: 2, status: "envoyée", vautFacture: true, client: { ...newSituationDocument([]).client, ...client() }, items: [sitLine], ...extra });
const ctx = (extra = {}) => ({ connected: true, env: "sandbox", verificationStatus: "verified", companyCountryCode: "FR", allowProduction: false, ...extra });

describe("règles par type de pièce", () => {
  it("facture, facture d'acompte, avoir et situation valant facture : éligibles ; situation simple, devis, proforma : refusés (code « type »)", () => {
    for (const doc of [piece("facture"), piece("acompte"), avoir(), situation()]) expect(site.pdpEligibility(doc, ctx())).toEqual({ ok: true, code: null, reason: null });
    const simple = site.pdpEligibility(situation({ vautFacture: false }), ctx());
    expect(simple.code).toBe("type");
    expect(simple.reason).toContain("ne vaut pas facture");
    expect(site.pdpEligibility(piece("devis"), ctx()).code).toBe("type");
    expect(site.pdpEligibility(piece("proforma"), ctx()).code).toBe("type");
    expect(site.pdpTransmissibleType(null)).toBe(false);
  });
  it("les autres contrôles s'appliquent aussi aux avoirs et situations (brouillon, particulier, déjà transmis)", () => {
    expect(site.pdpEligibility(avoir({ status: "brouillon" }), ctx()).code).toBe("brouillon");
    expect(site.pdpEligibility(situation({ client: { ...client(), type: "particulier" } }), ctx()).code).toBe("particulier");
    expect(site.pdpEligibility(avoir({ pdp: { invoiceId: 3, status: "api:sent" } }), ctx()).code).toBe("deja-envoyee");
    expect(site.pdpEligibility(avoir({ pdp: { invoiceId: 3, status: "fr:213" } }), ctx()).ok).toBe(true);
  });
  it("encaissement fr:212 : facture d'acompte et situation valant facture payées en totalité oui ; avoir et situation simple jamais", () => {
    const pdp = { invoiceId: 501, status: "fr:202" };
    expect(site.shouldSendPaidEvent({ ...piece("acompte"), status: "payée", pdp })).toBe(true);
    expect(site.shouldSendPaidEvent({ ...situation(), status: "payée", pdp })).toBe(true);
    expect(site.shouldSendPaidEvent({ ...situation({ vautFacture: false }), status: "payée", pdp })).toBe(false);
    expect(site.shouldSendPaidEvent({ ...avoir(), status: "payée", pdp })).toBe(false);
    expect(site.shouldSendPaidEvent({ ...piece("acompte"), status: "envoyée", pdp })).toBe(false);
    expect(site.shouldSendPaidEvent({ ...piece("acompte"), status: "payée", pdp: { ...pdp, paidEventAt: "x" } })).toBe(false);
  });
  it("parité site / serveur sur ces pièces", () => {
    const pdp = { invoiceId: 501, status: "fr:202" };
    const docs = [piece("facture"), piece("acompte"), avoir(), situation(), situation({ vautFacture: false }), piece("devis"), avoir({ status: "brouillon" }), { ...piece("acompte"), status: "payée", pdp }, { ...situation(), status: "payée", pdp }, { ...avoir(), status: "payée", pdp }];
    for (const d of docs) {
      expect(server.pdpEligibility(d, ctx())).toEqual(site.pdpEligibility(d, ctx()));
      expect(server.shouldSendPaidEvent(d)).toBe(site.shouldSendPaidEvent(d));
      expect(server.pdpTransmissibleType(d)).toBe(site.pdpTransmissibleType(d));
    }
  });
});

describe("éditeurs", () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
    window.scrollTo = () => {};
    window.alert = () => {};
  });
  const noop = () => {};
  const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@exemple.fr", memberships: [] };
  const companyProfile = { ...emptyCompanyProfile(), name: "Bâti Plus", country: "🇫🇷 FR" };
  const editorProps = { saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, products: [], stockByProduct: {}, clients: [], companyProfile, onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop };
  const situationProps = { documents: [], saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onCreateNext: noop, onGoToPricing: noop, companyProfile };
  const connected = { configured: true, connected: true, env: "sandbox", companyName: "Burger Queen", companyNumber: "315143296_106843", verificationStatus: "verified" };
  async function mount(element) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(element); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
  }
  const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  const menuItems = (c) => [...c.querySelectorAll('[data-testid="export-menu"] [role="menuitem"]')].map((b) => b.textContent.trim());
  const openMenu = (c) => click(c.querySelector('[data-testid="export-menu"] > button'));
  const menuItem = (c, label) => [...c.querySelectorAll('[data-testid="export-menu"] [role="menuitem"]')].find((b) => b.textContent.includes(label));

  it("avoir : entrées Factur-X et « Envoyer via Super PDP », bloc Facturation électronique, confirmation « l'avoir », badge après dépôt", async () => {
    const sent = [];
    const onSendPdp = vi.fn(async (id) => { sent.push(id); return { ok: true, pdp: { invoiceId: 77, status: "api:uploaded", statusText: "Déposée chez Super PDP", sentAt: "2026-09-26T10:00:00.000Z", env: "sandbox" }, warnings: [] }; });
    const doc = avoir();
    const { container, unmount } = await mount(<Editor {...editorProps} doc={doc} pdpStatus={connected} onSendPdp={onSendPdp} />);
    expect(container.querySelector('[data-testid="facturx-block"]')).toBeTruthy();
    await openMenu(container);
    expect(menuItems(container)).toContain("Factur-X (facture électronique)");
    expect(menuItems(container)).toContain("Envoyer via Super PDP");
    const confirms = [];
    window.confirm = (m) => { confirms.push(m); return true; };
    await click(menuItem(container, "Envoyer via Super PDP"));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(confirms[0]).toContain("Envoyer l'avoir AV-007");
    expect(sent).toEqual([doc.id]);
    expect(container.querySelector('[data-testid="pdp-badge"]').textContent).toBe("Super PDP : Déposée chez Super PDP");
    expect(container.querySelector('[data-testid="pdp-lock-banner"]').textContent).toContain("Avoir transmis via Super PDP");
    await unmount();
  }, 30000);
  it("facture d'acompte : entrées Factur-X et Super PDP, bloc Facturation électronique ; devis : Factur-X absent du menu", async () => {
    const a = await mount(<Editor {...editorProps} doc={piece("acompte")} pdpStatus={connected} onSendPdp={async () => ({})} />);
    expect(a.container.querySelector('[data-testid="facturx-block"]')).toBeTruthy();
    await openMenu(a.container);
    expect(menuItems(a.container)).toContain("Factur-X (facture électronique)");
    expect(menuItems(a.container)).toContain("Envoyer via Super PDP");
    await a.unmount();
    const b = await mount(<Editor {...editorProps} doc={piece("devis", { status: "envoyé" })} pdpStatus={connected} onSendPdp={async () => ({})} />);
    await openMenu(b.container);
    expect(menuItems(b.container)).not.toContain("Factur-X (facture électronique)");
    expect(menuItems(b.container)).not.toContain("Envoyer via Super PDP");
    await b.unmount();
  }, 30000);
  it("situation valant facture : entrées Factur-X et Super PDP, confirmation, appel, badge et bandeau ; situation simple : aucune des deux", async () => {
    const sent = [];
    const onSendPdp = vi.fn(async (id) => { sent.push(id); return { ok: true, pdp: { invoiceId: 88, status: "api:uploaded", statusText: "Déposée chez Super PDP", sentAt: "2026-09-26T10:00:00.000Z", env: "sandbox" }, warnings: [] }; });
    const doc = situation();
    const on = await mount(<SituationEditor {...situationProps} doc={doc} pdpStatus={connected} onSendPdp={onSendPdp} />);
    await openMenu(on.container);
    expect(menuItems(on.container)).toEqual(["PDF", "Excel", "Factur-X (facture électronique)", "Envoyer via Super PDP"]);
    const confirms = [];
    window.confirm = (m) => { confirms.push(m); return true; };
    await click(menuItem(on.container, "Envoyer via Super PDP"));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(confirms[0]).toContain("Envoyer la situation SIT-003 (valant facture) à Tricatel");
    expect(sent).toEqual([doc.id]);
    expect(on.container.querySelector('[data-testid="pdp-badge"]').textContent).toBe("Super PDP : Déposée chez Super PDP");
    expect(on.container.querySelector('[data-testid="pdp-lock-banner"]').textContent).toContain("Situation transmise via Super PDP");
    await on.unmount();
    const off = await mount(<SituationEditor {...situationProps} doc={situation({ vautFacture: false })} pdpStatus={connected} onSendPdp={onSendPdp} />);
    await openMenu(off.container);
    expect(menuItems(off.container)).toEqual(["PDF", "Excel"]);
    expect(off.container.querySelector('[data-testid="pdp-badge"]')).toBeNull();
    await off.unmount();
  }, 30000);
  it("situation transmise : contenu figé (modification d'un champ ignorée, statut accepté), bouton Actualiser, pas de nouvel envoi", async () => {
    const changes = [];
    const onRefreshPdp = vi.fn(async () => ({ updated: [] }));
    const doc = situation({ pdp: { invoiceId: 88, status: "fr:202", statusText: "Reçue", sentAt: "2026-09-26T10:00:00.000Z" } });
    const { container, unmount } = await mount(<SituationEditor {...situationProps} doc={doc} onChange={(p) => changes.push(p)} pdpStatus={connected} onSendPdp={async () => ({})} onRefreshPdp={onRefreshPdp} />);
    expect(container.querySelector('[data-testid="pdp-lock-banner"]').textContent).toContain("son contenu est figé");
    expect(container.querySelector('[data-testid="pdp-refresh"]')).toBeTruthy();
    await openMenu(container);
    expect(menuItems(container)).not.toContain("Envoyer via Super PDP");
    const target = [...container.querySelectorAll("label")].find((l) => l.textContent.trim() === "Marché N°").parentElement.querySelector("input");
    expect(target).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => { setter.call(target, "Nouveau marché"); target.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(changes.filter((p) => Object.keys(p).some((k) => !site.PDP_EDITABLE_KEYS.includes(k)))).toEqual([]);
    expect(container.querySelector('[data-testid="pdp-lock-banner"]').textContent).toContain("La dernière modification a été ignorée.");
    await click(container.querySelector('[data-testid="pdp-refresh"]'));
    expect(onRefreshPdp).toHaveBeenCalledTimes(1);
    await unmount();
  }, 30000);
});
