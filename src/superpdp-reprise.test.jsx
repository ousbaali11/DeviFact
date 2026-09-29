// @vitest-environment jsdom
// Super PDP, étape 4 (30/09/2026), chantier 2 — reprise sur erreur : résumé
// d'un échec (titre, motif, tentative), identifiant externe d'une tentative,
// raison transmise avec les événements, bandeau de rejet avec « Renvoyer »
// dans les deux éditeurs, mention de la nouvelle tentative à la confirmation,
// numéro de tentative sur le badge.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor, SituationEditor, newDocument, newSituationDocument, emptyCompanyProfile, PLANS } from "./App.jsx";
import * as site from "./pdp-rules.js";
import * as server from "../supabase/functions/_shared/superpdp-rules.ts";

describe("règles partagées", () => {
  it("résumé d'un échec : titre par statut, motif (message d'envoi ou raison de l'événement), tentative ; rien pour un statut normal", () => {
    expect(site.pdpFailureSummary({ status: "api:invalid", error: "Le fichier Factur-X est refusé : [BR-CO-09] …", attempt: 1 })).toEqual({ status: "api:invalid", title: "Fichier refusé par la validation", reason: "Le fichier Factur-X est refusé : [BR-CO-09] …", attempt: 1 });
    expect(site.pdpFailureSummary({ invoiceId: 5, status: "fr:210", reason: "Refused by buyer: wrong amount", attempt: 2 })).toEqual({ status: "fr:210", title: "Refusée par le client", reason: "Refused by buyer: wrong amount", attempt: 2 });
    expect(site.pdpFailureSummary({ invoiceId: 5, status: "fr:213" })).toEqual({ status: "fr:213", title: "Rejetée", reason: null, attempt: 1 });
    expect(site.pdpFailureSummary({ invoiceId: 5, status: "api:rejected" }).title).toBe("Rejetée par la plateforme du client");
    expect(site.pdpFailureSummary({ invoiceId: 5, status: "fr:501" }).title).toBe("Irrecevable");
    expect(site.pdpFailureSummary({ status: "error", error: "Super PDP a répondu 502" }).title).toBe("Envoi en échec");
    for (const pdp of [null, undefined, {}, { invoiceId: 1, status: "fr:202" }, { status: "api:sending" }, { status: "fr:212" }]) expect(site.pdpFailureSummary(pdp)).toBeNull();
  });
  it("identifiant externe : la pièce seule à la première tentative, suffixé ensuite, jamais plus de 36 caractères", () => {
    expect(site.pdpExternalId("doc_1_1790676588710_754", 1)).toBe("doc_1_1790676588710_754");
    expect(site.pdpExternalId("doc_1_1790676588710_754", undefined)).toBe("doc_1_1790676588710_754");
    expect(site.pdpExternalId("doc_1_1790676588710_754", 2)).toBe("doc_1_1790676588710_754-2");
    const long = "x".repeat(40);
    expect(site.pdpExternalId(long, 1)).toHaveLength(36);
    expect(site.pdpExternalId(long, 12)).toHaveLength(36);
    expect(site.pdpExternalId(long, 12).endsWith("-12")).toBe(true);
  });
  it("événements : la raison transmise par Super PDP est conservée ; parité site / serveur", () => {
    const events = [{ id: 1, invoice_id: 7, status_code: "fr:210", status_text: "Refused: duplicate", created_at: "2026-09-30T08:00:00.000Z" }, { id: 2, invoice_id: 8, status_code: "fr:202", created_at: "2026-09-30T08:01:00.000Z" }];
    const { updates } = site.applyPdpEvents(events);
    expect(updates.find((u) => u.invoiceId === 7).reason).toBe("Refused: duplicate");
    expect(updates.find((u) => u.invoiceId === 8).reason).toBeNull();
    expect(server.applyPdpEvents(events)).toEqual(site.applyPdpEvents(events));
    for (const pdp of [{ status: "api:invalid", error: "e", attempt: 3 }, { invoiceId: 1, status: "fr:210", reason: "r" }, { invoiceId: 1, status: "fr:202" }, null]) expect(server.pdpFailureSummary(pdp)).toEqual(site.pdpFailureSummary(pdp));
    for (const [id, n] of [["doc_1", 1], ["doc_1", 2], ["y".repeat(50), 7]]) expect(server.pdpExternalId(id, n)).toBe(site.pdpExternalId(id, n));
    expect(server.PDP_FAILURE_TITLES).toEqual(site.PDP_FAILURE_TITLES);
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
  const client = { type: "entreprise", name: "Tricatel", address: "1 rue du Test", postalCode: "75001", city: "Paris", country: "🇫🇷 FR", siret: "0225:315143296_106842" };
  const connected = { configured: true, connected: true, env: "sandbox", companyName: "Burger Queen", companyNumber: "000000002", verificationStatus: "verified" };
  const editorProps = { saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, products: [], stockByProduct: {}, clients: [], companyProfile, onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop };
  const situationProps = { documents: [], saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onCreateNext: noop, onGoToPricing: noop, companyProfile };
  const line = { id: "l1", type: "line", designation: "Pose", qty: 1, unit: "u", unitPrice: 100, tva: 20, discount: 0, details: [] };
  const facture = (extra = {}) => ({ ...newDocument("facture", []), docNumber: "FAC-042", status: "envoyée", client, items: [line], ...extra });
  async function mount(element) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(element); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
  }
  const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

  it("facture au fichier refusé : bandeau avec titre et motif, contenu libre, « Renvoyer » confirme en mentionnant la tentative n° 2 puis envoie", async () => {
    const sent = [];
    const onSendPdp = vi.fn(async (id) => { sent.push(id); return { ok: true, pdp: { invoiceId: 900, status: "api:uploaded", statusText: "Déposée chez Super PDP", sentAt: "2026-09-30T10:00:00.000Z", env: "sandbox", attempt: 2 }, warnings: [] }; });
    const doc = facture({ pdp: { invoiceId: null, status: "api:invalid", statusText: "Fichier refusé", error: "Le fichier Factur-X est refusé par la validation Super PDP : [BR-CO-09] The Seller VAT identifier…", attempt: 1 } });
    const { container, unmount } = await mount(<Editor {...editorProps} doc={doc} pdpStatus={connected} onSendPdp={onSendPdp} />);
    const banner = container.querySelector('[data-testid="pdp-reject-banner"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("Super PDP : Fichier refusé par la validation");
    expect(container.querySelector('[data-testid="pdp-reject-reason"]').textContent).toContain("BR-CO-09");
    expect(banner.textContent).toContain("Corrige la pièce puis renvoie-la");
    expect(container.querySelector('[data-testid="pdp-lock-banner"]')).toBeNull();
    const confirms = [];
    window.confirm = (m) => { confirms.push(m); return true; };
    await click(container.querySelector('[data-testid="pdp-resend"]'));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(confirms[0]).toContain("Nouvelle tentative (n° 2) après : fichier refusé par la validation.");
    expect(sent).toEqual([doc.id]);
    expect(container.querySelector('[data-testid="pdp-reject-banner"]')).toBeNull(); // dépôt réussi : plus d'échec
    expect(container.querySelector('[data-testid="pdp-badge"]').textContent).toContain("tentative 2");
    await unmount();
  }, 30000);
  it("statut normal : pas de bandeau ; refus sans motif : bandeau sans ligne de motif ; croix pour masquer", async () => {
    const a = await mount(<Editor {...editorProps} doc={facture({ pdp: { invoiceId: 9, status: "fr:202", statusText: "Reçue", sentAt: "2026-09-30T10:00:00.000Z" } })} pdpStatus={connected} onSendPdp={async () => ({})} />);
    expect(a.container.querySelector('[data-testid="pdp-reject-banner"]')).toBeNull();
    await a.unmount();
    const b = await mount(<Editor {...editorProps} doc={facture({ pdp: { invoiceId: 9, status: "fr:213", statusText: "Rejetée", attempt: 2 } })} pdpStatus={connected} onSendPdp={async () => ({})} />);
    const banner = b.container.querySelector('[data-testid="pdp-reject-banner"]');
    expect(banner.textContent).toContain("Super PDP : Rejetée (tentative 2)");
    expect(b.container.querySelector('[data-testid="pdp-reject-reason"]')).toBeNull();
    await click(banner.querySelector('[aria-label="Masquer ce message"]'));
    expect(b.container.querySelector('[data-testid="pdp-reject-banner"]')).toBeNull();
    await b.unmount();
  }, 30000);
  it("situation valant facture refusée par le client : bandeau avec la raison transmise par Super PDP et « Renvoyer »", async () => {
    const onSendPdp = vi.fn(async () => ({ ok: true, pdp: { invoiceId: 901, status: "api:uploaded", statusText: "Déposée chez Super PDP", attempt: 2 }, warnings: [] }));
    const doc = { ...newSituationDocument([]), docNumber: "SIT-003", status: "envoyée", vautFacture: true, client: { ...newSituationDocument([]).client, ...client }, items: [{ id: "s1", type: "line", designation: "Gros œuvre", qty: 1, unitPrice: 10000, tva: 20, avancementPct: 30, montantCumulePrecedent: 2000 }], pdp: { invoiceId: 88, status: "fr:210", statusText: "Refusée", reason: "Refused by buyer: wrong period", attempt: 1 } };
    const { container, unmount } = await mount(<SituationEditor {...situationProps} doc={doc} pdpStatus={connected} onSendPdp={onSendPdp} />);
    const banner = container.querySelector('[data-testid="pdp-reject-banner"]');
    expect(banner.textContent).toContain("Refusée par le client");
    expect(banner.textContent).toContain("Refused by buyer: wrong period");
    window.confirm = () => true;
    await click(container.querySelector('[data-testid="pdp-resend"]'));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(onSendPdp).toHaveBeenCalledWith(doc.id);
    await unmount();
  }, 30000);
});
