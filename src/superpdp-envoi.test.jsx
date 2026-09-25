// @vitest-environment jsdom
// Super PDP, étape 2 — envoi d'une facture : règles d'éligibilité (chaque
// refus et le cas accepté), identifiants de bac à sable, réémission,
// verrou de contenu, parité site / serveur, entrée « Envoyer via Super PDP »
// du menu Exporter, badge de statut et bandeau de facture figée.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor, newDocument, emptyCompanyProfile, PLANS } from "./App.jsx";
import * as site from "./pdp-rules.js";
import * as server from "../supabase/functions/_shared/superpdp-rules.ts";

const client = (extra = {}) => ({ type: "entreprise", name: "Tricatel", address: "1 rue du Test", postalCode: "75001", city: "Paris", country: "🇫🇷 FR", siret: "0225:315143296_106842", ...extra });
const facture = (extra = {}) => ({ ...newDocument("facture", []), docNumber: "FAC-042", status: "envoyée", client: client(), items: [{ id: "l1", type: "line", designation: "Pose", qty: 1, unit: "u", unitPrice: 100, tva: 20, discount: 0, details: [] }], ...extra });
const ctx = (extra = {}) => ({ connected: true, env: "sandbox", verificationStatus: "verified", companyCountryCode: "FR", allowProduction: false, ...extra });

describe("règles d'éligibilité", () => {
  it("facture émise, client professionnel français avec identifiant, compte connecté en bac à sable : éligible", () => {
    expect(site.pdpEligibility(facture(), ctx())).toEqual({ ok: true, code: null, reason: null });
  });
  it("chaque refus, dans l'ordre des contrôles", () => {
    const codeOf = (doc, c = ctx()) => site.pdpEligibility(doc, c).code;
    expect(codeOf(facture({ type: "devis" }))).toBe("type");
    expect(codeOf({ ...newDocument("situation", []), type: "situation", status: "envoyée" })).toBe("type"); // ne vaut pas facture
    expect(codeOf(facture({ status: "brouillon" }))).toBe("brouillon");
    expect(codeOf(facture({ client: client({ type: "particulier" }) }))).toBe("particulier");
    expect(codeOf(facture({ client: client({ country: "🇧🇪 BE" }) }))).toBe("etranger");
    expect(codeOf(facture(), ctx({ companyCountryCode: "MA" }))).toBe("entreprise-pays");
    expect(codeOf(facture(), ctx({ connected: false }))).toBe("non-connecte");
    expect(codeOf(facture(), ctx({ verificationStatus: "needs_review" }))).toBe("non-verifie");
    expect(codeOf(facture(), ctx({ env: "production" }))).toBe("production");
    expect(codeOf(facture({ client: client({ siret: "" }) }))).toBe("siret");
    expect(codeOf(facture({ client: client({ siret: "12345" }) }))).toBe("siret");
    expect(codeOf(facture({ pdp: { invoiceId: 12, status: "api:uploaded" } }))).toBe("deja-envoyee");
    expect(codeOf(facture({ pdp: { invoiceId: null, status: "api:sending" } }))).toBe("deja-envoyee");
  });
  it("production autorisée : SIRET à 14 chiffres exigé, identifiant de test refusé ; bac à sable : les deux acceptés", () => {
    const prod = ctx({ env: "production", allowProduction: true });
    expect(site.pdpEligibility(facture({ client: client({ siret: "853 322 915 00012" }) }), prod).ok).toBe(true);
    expect(site.pdpEligibility(facture(), prod).code).toBe("siret");
    expect(site.pdpEligibility(facture({ client: client({ siret: "85332291500012" }) }), ctx()).ok).toBe(true);
  });
  it("réémission après un échec (fichier refusé, rejet, refus), jamais pendant un envoi ni après une transmission", () => {
    for (const status of ["api:invalid", "api:rejected", "fr:210", "fr:213", "fr:501", "error"]) {
      expect(site.pdpEligibility(facture({ pdp: { invoiceId: 7, status } }), ctx()).ok).toBe(true);
      expect(site.pdpLocksContent({ invoiceId: 7, status })).toBe(false);
    }
    for (const status of ["api:uploaded", "api:sent", "fr:202", "fr:205", "fr:212"]) {
      expect(site.pdpEligibility(facture({ pdp: { invoiceId: 7, status } }), ctx()).code).toBe("deja-envoyee");
      expect(site.pdpLocksContent({ invoiceId: 7, status })).toBe(true);
    }
    expect(site.pdpLocksContent(null)).toBe(false);
    expect(site.pdpLocksContent({ invoiceId: null, status: "error" })).toBe(false);
  });
  it("identifiants de bac à sable et SIREN ; champs encore modifiables", () => {
    expect(site.sandboxIdentifierOf("0225:315143296_106842")).toEqual({ id: "315143296_106842", siren: "315143296" });
    expect(site.sandboxIdentifierOf(" 315143296_106843 ")).toEqual({ id: "315143296_106843", siren: "315143296" });
    expect(site.sandboxIdentifierOf("85332291500012")).toBeNull();
    expect(site.sirenOfSiret("853 322 915 00012")).toBe("853322915");
    expect(site.pdpBlockedKeys({ status: "payée", payments: [], items: [], notes: "x" })).toEqual(["items", "notes"]);
    expect(site.pdpBlockedKeys({ status: "payée", paidAt: "x", paidTotal: 1, workStage: "termine" })).toEqual([]);
    expect(site.pdpStatusLabel({ status: "fr:205" })).toBe("Approuvée");
    expect(site.pdpStatusLabel({ status: "x:unknown", statusText: "Autre" })).toBe("Autre");
    expect(site.pdpStatusLabel(null)).toBe("");
  });
});

describe("parité site / serveur", () => {
  it("mêmes réponses sur une matrice de cas", () => {
    const docs = [facture(), facture({ type: "acompte" }), facture({ status: "brouillon" }), facture({ client: client({ type: "particulier" }) }), facture({ client: client({ country: "🇧🇪 BE" }) }), facture({ client: client({ siret: "" }) }), facture({ client: client({ siret: "85332291500012" }) }), facture({ pdp: { invoiceId: 3, status: "fr:210" } }), facture({ pdp: { invoiceId: 3, status: "api:sent" } })];
    const ctxs = [ctx(), ctx({ connected: false }), ctx({ env: "production" }), ctx({ env: "production", allowProduction: true }), ctx({ companyCountryCode: "MA" }), ctx({ verificationStatus: "failed" })];
    for (const d of docs) for (const c of ctxs) expect(server.pdpEligibility(d, c)).toEqual(site.pdpEligibility(d, c));
    for (const v of ["0225:315143296_106842", "315143296_1", "853322915", ""]) expect(server.sandboxIdentifierOf(v)).toEqual(site.sandboxIdentifierOf(v));
    for (const pdp of [null, { invoiceId: 1, status: "api:uploaded" }, { invoiceId: 1, status: "fr:213" }, { status: "api:sending" }]) {
      expect(server.pdpCanResend(pdp)).toBe(site.pdpCanResend(pdp));
      expect(server.pdpLocksContent(pdp)).toBe(site.pdpLocksContent(pdp));
    }
    expect(server.PDP_STATUS_LABELS).toEqual(site.PDP_STATUS_LABELS);
    expect(server.PDP_EDITABLE_KEYS).toEqual(site.PDP_EDITABLE_KEYS);
    expect(server.PDP_FINAL_FAILURES).toEqual(site.PDP_FINAL_FAILURES);
  });
});

describe("éditeur de facture", () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
    window.scrollTo = () => {};
  });
  const noop = () => {};
  const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@exemple.fr", memberships: [] };
  const props = { saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, products: [], stockByProduct: {}, clients: [], companyProfile: { ...emptyCompanyProfile(), name: "Bâti Plus", country: "🇫🇷 FR" }, onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop };
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

  it("éligible : entrée « Envoyer via Super PDP », confirmation, appel avec l'identifiant du document, badge « Déposée »", async () => {
    const sent = [];
    const onSendPdp = vi.fn(async (id) => { sent.push(id); return { ok: true, pdp: { invoiceId: 501, status: "api:uploaded", statusText: "Déposée chez Super PDP", sentAt: "2026-09-26T10:00:00.000Z", env: "sandbox" }, warnings: [] }; });
    const doc = facture();
    const { container, unmount } = await mount(<Editor {...props} doc={doc} pdpStatus={connected} onSendPdp={onSendPdp} />);
    await openMenu(container);
    expect(menuItems(container)).toContain("Envoyer via Super PDP");
    const confirms = [];
    window.confirm = (m) => { confirms.push(m); return true; };
    window.alert = () => {};
    await click([...container.querySelectorAll('[data-testid="export-menu"] [role="menuitem"]')].find((b) => b.textContent.includes("Envoyer via Super PDP")));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(confirms[0]).toContain("FAC-042");
    expect(confirms[0]).toContain("Tricatel");
    expect(confirms[0]).toContain("bac à sable");
    expect(sent).toEqual([doc.id]);
    expect(container.querySelector('[data-testid="pdp-badge"]').textContent).toBe("Super PDP : Déposée chez Super PDP");
    expect(container.querySelector('[data-testid="pdp-lock-banner"]')).toBeTruthy();
    await unmount();
  }, 30000);
  it("confirmation refusée : aucun appel ; particulier, non connecté ou lecteur : pas d'entrée", async () => {
    const onSendPdp = vi.fn(async () => ({}));
    const a = await mount(<Editor {...props} doc={facture()} pdpStatus={connected} onSendPdp={onSendPdp} />);
    window.confirm = () => false;
    await openMenu(a.container);
    await click([...a.container.querySelectorAll('[data-testid="export-menu"] [role="menuitem"]')].find((b) => b.textContent.includes("Envoyer via Super PDP")));
    expect(onSendPdp).not.toHaveBeenCalled();
    await a.unmount();
    for (const [doc, status, extra] of [[facture({ client: client({ type: "particulier" }) }), connected, {}], [facture(), { configured: true, connected: false }, {}], [facture(), connected, { isViewer: true }]]) {
      const m = await mount(<Editor {...props} {...extra} doc={doc} pdpStatus={status} onSendPdp={onSendPdp} />);
      await openMenu(m.container);
      expect(menuItems(m.container)).not.toContain("Envoyer via Super PDP");
      await m.unmount();
    }
  }, 30000);
  it("facture transmise : bandeau « contenu figé », badge, pas de nouvel envoi ; après un rejet : réémission possible, contenu libre", async () => {
    const a = await mount(<Editor {...props} doc={facture({ pdp: { invoiceId: 9, status: "fr:202", statusText: "Reçue", sentAt: "2026-09-26T10:00:00.000Z" } })} pdpStatus={connected} onSendPdp={async () => ({})} />);
    expect(a.container.querySelector('[data-testid="pdp-lock-banner"]').textContent).toContain("son contenu est figé");
    expect(a.container.querySelector('[data-testid="pdp-badge"]').textContent).toBe("Super PDP : Reçue");
    await openMenu(a.container);
    expect(menuItems(a.container)).not.toContain("Envoyer via Super PDP");
    await a.unmount();
    const b = await mount(<Editor {...props} doc={facture({ pdp: { invoiceId: 9, status: "fr:213", statusText: "Rejetée" } })} pdpStatus={connected} onSendPdp={async () => ({})} />);
    expect(b.container.querySelector('[data-testid="pdp-lock-banner"]')).toBeNull();
    expect(b.container.querySelector('[data-testid="pdp-badge"]').textContent).toBe("Super PDP : Rejetée");
    await openMenu(b.container);
    expect(menuItems(b.container)).toContain("Envoyer via Super PDP");
    await b.unmount();
  }, 30000);
});
