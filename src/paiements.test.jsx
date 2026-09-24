// @vitest-environment jsdom
// Paiements reçus sur une facture (règlement en plusieurs fois) : totaux,
// bloc de l'éditeur, PDF (liste, montant payé, reste à payer), passage
// automatique à « payée », paiement en ligne ajouté à la liste.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintDocument, PaymentsEditor, Editor, newDocument, computeTotals, paymentsTotalOf, paymentDateLabel, emptyCompanyProfile, PLANS } from "./App.jsx";
import { computeDocTotals, addOnlinePayment } from "../supabase/functions/_shared/totals.ts";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null; });

const profile = { ...emptyCompanyProfile(), name: "Bâti Plus", iban: "FR76 1234", bic: "AGRIFRPP", bankName: "CIC" };
const line = { id: "l1", type: "line", designation: "Pose", details: [], qty: 1, unitPrice: 100, tva: 20, discount: 0 };
const facture = (extra = {}) => ({ ...newDocument("facture", []), docNumber: "F-001", issueDate: "2026-09-21", paymentMethod: "Virement bancaire", company: { ...profile }, client: { type: "entreprise", name: "Client SAS" }, items: [line], ...extra });
const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/[  ]/g, " ");
const pdf = (d) => renderToStaticMarkup(<PrintDocument doc={d} totals={computeTotals(d)} siteSettings={{ name: "Chantiflow" }} watermarkEnabled={false} />);
const pays = [{ id: "p1", date: "2026-09-22", amount: 30, method: "Chèque", note: "n° 12" }, { id: "p2", date: "2026-10-01", amount: 50, method: "Virement bancaire", note: "" }];

describe("totaux", () => {
  it("paiements reçus déduits, avec l'acompte versé ; identiques côté serveur", () => {
    const d = facture({ acompteVerse: 20, payments: pays });
    const t = computeTotals(d);
    expect(t.totalTTC).toBe(120);
    expect(t.paymentsReceived).toBe(80);
    expect(t.totalPaid).toBe(100);
    expect(t.montantARegler).toBe(20);
    const s = computeDocTotals(d);
    expect([s.paymentsReceived, s.totalPaid, s.montantARegler]).toEqual([80, 100, 20]);
    expect(paymentsTotalOf({ payments: [{ amount: "10.5" }, { amount: -3 }, null, { amount: "x" }] })).toBe(10.5);
    expect(paymentDateLabel("2026-09-22")).toBe("22/09/2026");
    expect(computeTotals(facture({ payments: [{ id: "x", amount: 500 }] })).montantARegler).toBe(0); // jamais négatif
    expect(computeTotals({ ...facture({ payments: pays }), type: "devis" }).paymentsReceived).toBe(0); // factures seulement
  });
  it("ancienne facture sans liste de paiements : inchangée", () => {
    const d = facture({ acompteVerse: 20 }); delete d.payments;
    expect(computeTotals(d).montantARegler).toBe(100);
  });
});

describe("PDF", () => {
  it("paiements listés avec date et mode, montant payé cumulé, reste à payer ; ligne « Paiements reçus » dans les totaux", () => {
    const out = textOf(pdf(facture({ acompteVerse: 20, payments: pays })));
    expect(out).toContain("À payer : 20,00 €");
    expect(out).toContain("Montant payé : 100,00 €");
    expect(out).toContain("20,00 € - Acompte versé");
    expect(out).toContain("30,00 € le 22/09/2026 - Chèque · n° 12");
    expect(out).toContain("50,00 € le 01/10/2026 - Virement bancaire");
    expect(out).toContain("Paiements reçus- 80,00 €");
    expect(out).toContain("Montant TTC à régler20,00 €");
  });
  it("payée avec la liste qui couvre tout : tampon, aucune ligne de solde inventée", () => {
    const html = pdf(facture({ status: "payée", paidAt: "2026-10-01T10:00:00.000Z", payments: [{ id: "p", date: "2026-10-01", amount: 120, method: "Virement bancaire" }] }));
    const out = textOf(html);
    expect(html).toContain("print-paid-stamp");
    expect(out).toContain("À payer : 0,00 €");
    expect(out.split("120,00 € le 01/10/2026").length - 1).toBe(1);
  });
  it("payée à la main alors que les paiements listés ne couvrent pas tout : solde présenté à la date de paiement", () => {
    const out = textOf(pdf(facture({ status: "payée", paidAt: "2026-10-05T10:00:00.000Z", payments: [pays[0]] })));
    expect(out).toContain("30,00 € le 22/09/2026 - Chèque · n° 12");
    expect(out).toContain("90,00 € le 05/10/2026 - Virement bancaire");
    expect(out).toContain("Montant payé : 120,00 €");
  });
});

describe("paiement en ligne ajouté à la liste (webhooks)", () => {
  it("partiel puis solde : « payée » seulement quand le total est couvert ; même session = pas de doublon", () => {
    const d = facture({ payments: [pays[0]] });
    const first = addOnlinePayment(d, "cs_1", 5000, "2026-10-02T09:00:00.000Z");
    expect(first.payments).toHaveLength(2);
    expect(first.payments[1]).toMatchObject({ id: "pay_stripe_cs_1", date: "2026-10-02", amount: 50, method: "Carte bancaire (en ligne)", note: "" });
    // Le nom du prestataire n'apparaît ni sur la facture ni dans le PDF.
    expect(textOf(pdf(first))).not.toMatch(/stripe/i);
    expect(first.status).not.toBe("payée");
    const again = addOnlinePayment(first, "cs_1", 5000, "2026-10-02T09:00:00.000Z");
    expect(again.payments).toHaveLength(2);
    const solde = addOnlinePayment(first, "cs_2", 4000, "2026-10-03T09:00:00.000Z");
    expect(solde.status).toBe("payée");
    expect(solde.paidAt).toBe("2026-10-03T09:00:00.000Z");
    expect(computeDocTotals(solde).montantARegler).toBe(0);
  });
});

describe("éditeur", () => {
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
    return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
  }
  const byLabel = (c, label) => [...c.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(label))?.querySelector("input, select");
  const button = (c, text) => [...c.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  it("ajout d'un paiement partiel puis du solde : liste, reste à payer, passage à « payée » au solde", async () => {
    const patches = [];
    let doc = facture({ payments: [] });
    const { container, unmount } = await mount(<PaymentsEditor doc={doc} totals={computeTotals(doc)} onPatch={(p) => patches.push(p)} />);
    expect(container.textContent).toContain("Aucun paiement enregistré");
    expect(container.textContent).toContain("Reste à payer 120,00 €".replace(/ /g, " ").slice(0, 14));
    await act(async () => { setValue(byLabel(container, "Date"), "2026-09-22"); });
    await act(async () => { setValue(byLabel(container, "Montant"), "30"); });
    await act(async () => { setValue(byLabel(container, "Mode"), "Chèque"); });
    await act(async () => { setValue(byLabel(container, "Note"), "n° 12"); });
    await click(button(container, "Ajouter le paiement"));
    expect(patches).toHaveLength(1);
    expect(patches[0].payments).toHaveLength(1);
    expect(patches[0].payments[0]).toMatchObject({ date: "2026-09-22", amount: 30, method: "Chèque", note: "n° 12" });
    expect(patches[0].status).toBeUndefined();
    await unmount();
    doc = facture({ payments: patches[0].payments });
    const second = await mount(<PaymentsEditor doc={doc} totals={computeTotals(doc)} onPatch={(p) => patches.push(p)} />);
    expect(second.container.textContent.replace(/[  ]/g, " ")).toContain("22/09/2026");
    await act(async () => { setValue(byLabel(second.container, "Montant"), "90"); });
    await click(button(second.container, "Ajouter le paiement"));
    expect(patches[1].payments).toHaveLength(2);
    expect(patches[1].status).toBe("payée");
    await second.unmount();
  }, 30000);
  it("montant vide ou nul : refusé avec un message ; retrait d'un paiement", async () => {
    const patches = [];
    const doc = facture({ payments: pays });
    const { container, unmount } = await mount(<PaymentsEditor doc={doc} totals={computeTotals(doc)} onPatch={(p) => patches.push(p)} />);
    await click(button(container, "Ajouter le paiement"));
    expect(patches).toHaveLength(0);
    expect(container.textContent).toContain("Indique un montant supérieur à zéro.");
    await click(container.querySelector('button[title="Retirer ce paiement"]'));
    expect(patches[0].payments.map((p) => p.id)).toEqual(["p2"]);
    await unmount();
  }, 30000);
  it("bloc présent dans l'éditeur de facture, absent sur un devis ; lecture seule sans formulaire", async () => {
    const noop = () => {};
    const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
    const common = { saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow", landingPageVersion: "classique" }, isLocked: false, isViewer: false, onFinalize: noop, onBack: noop, onGoToPricing: noop, clients: [], products: [], stockByProduct: {}, companyProfile: emptyCompanyProfile(), onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop, onChange: noop };
    const f = await mount(<Editor {...common} doc={facture({ payments: [] })} />);
    expect(f.container.querySelector(".print-payments-editor")).toBeTruthy();
    expect(button(f.container, "Ajouter le paiement")).toBeTruthy();
    await f.unmount();
    const ro = await mount(<Editor {...common} isViewer doc={facture({ payments: pays })} />);
    expect(ro.container.querySelector(".print-payments-editor")).toBeTruthy();
    expect(button(ro.container, "Ajouter le paiement")).toBeUndefined();
    await ro.unmount();
    const d = await mount(<Editor {...common} doc={newDocument("devis", [])} />);
    expect(d.container.querySelector(".print-payments-editor")).toBeNull();
    await d.unmount();
  }, 30000);
});

describe("éditeur — paiement en ligne désactivé, règlement par virement", () => {
  async function mount(element) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(element); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
  }
  const noop = () => {};
  const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
  const common = { saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow", landingPageVersion: "classique" }, isLocked: false, isViewer: false, onFinalize: noop, onBack: noop, onGoToPricing: noop, clients: [], products: [], stockByProduct: {}, companyProfile: emptyCompanyProfile(), onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop, onChange: noop };
  it("aucune vérification auprès du serveur à l'ouverture, même si la fonction est fournie ; bloc Paiements reçus intact", async () => {
    const asked = [];
    const doc = facture({ payments: pays });
    const { container, unmount } = await mount(<Editor {...common} doc={doc} onSyncOnlinePayments={async (id) => { asked.push(id); return null; }} />);
    expect(asked).toEqual([]);
    expect(container.querySelector(".print-payments-editor")).toBeTruthy();
    expect(container.textContent.replace(/[\u00A0\u202F]/g, " ")).toContain("22/09/2026");
    expect(container.textContent).not.toContain("paiements en ligne");
    await unmount();
  }, 30000);
  it("IBAN manquant dans Mon entreprise : avertissement sur une facture ; absent quand l'IBAN est renseigné ou sur un devis", async () => {
    const warning = "IBAN manquant dans Mon entreprise";
    const a = await mount(<Editor {...common} doc={facture({ payments: [] })} companyProfile={{ ...emptyCompanyProfile(), iban: "" }} />);
    expect(a.container.textContent).toContain(warning);
    await a.unmount();
    const b = await mount(<Editor {...common} doc={facture({ payments: [] })} companyProfile={{ ...emptyCompanyProfile(), iban: "FR76 1234" }} />);
    expect(b.container.textContent).not.toContain(warning);
    await b.unmount();
    const c = await mount(<Editor {...common} doc={newDocument("devis", [])} companyProfile={{ ...emptyCompanyProfile(), iban: "" }} />);
    expect(c.container.textContent).not.toContain(warning);
    await c.unmount();
  }, 30000);
});
