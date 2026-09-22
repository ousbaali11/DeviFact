// @vitest-environment jsdom
// Règlement en plusieurs fois, suite : documents à payer (facture, facture
// d'acompte, situation valant facture), correction d'un paiement par le
// gestionnaire, paiement partiel en ligne (page publique, fonction
// serveur), mise à jour automatique au retour de Stripe.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

const publicState = { response: null, invoked: [] };
vi.mock("./client.js", () => ({
  db: {
    functions: { invoke: async (name, opts) => { publicState.invoked.push({ name, body: opts?.body }); if (name === "create-invoice-payment") return { data: { url: "https://checkout.stripe.test/s" }, error: null }; return { data: typeof publicState.response === "function" ? publicState.response() : publicState.response, error: null }; } },
    from: () => { throw new Error("pas d'accès base attendu"); },
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
import { PublicDocumentView, PaymentsEditor, PrintSituation, SituationEditor, isPayableDoc, documentPaidTotal, computeSituation, computeTotals, newDocument, newSituationDocument, emptyCompanyProfile, PLANS } from "./App.jsx";
import { isPayableDoc as isPayableServer, amountDueOf, computeSituationTotals, addOnlinePayment } from "../supabase/functions/_shared/totals.ts";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null; });

const profile = { ...emptyCompanyProfile(), name: "Bâti Plus" };
const line = { id: "l1", type: "line", designation: "Pose", details: [], qty: 1, unitPrice: 100, tva: 20, discount: 0 };
const facture = (extra = {}) => ({ ...newDocument("facture", []), docNumber: "F-001", issueDate: "2026-09-21", company: { ...profile }, client: { type: "entreprise", name: "Client SAS" }, items: [line], ...extra });
const situation = (extra = {}) => ({ ...newSituationDocument([]), docNumber: "SIT-001", numeroSituation: 2, issueDate: "2026-09-21", vautFacture: true, company: { ...profile }, client: { type: "entreprise", name: "Client SAS" }, items: [{ id: "s1", type: "line", designation: "Gros œuvre", qty: 1, unitPrice: 1000, tva: 20, avancementPct: 50, montantCumulePrecedent: 200 }], ...extra });
const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/[  ]/g, " ");
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
const button = (c, text) => [...c.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
const byLabel = (c, label) => [...c.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(label))?.querySelector("input, select");

describe("documents à payer", () => {
  it("facture, facture d'acompte, situation valant facture ; pas un devis ni une situation simple", () => {
    for (const fn of [isPayableDoc, isPayableServer]) {
      expect(fn(facture())).toBe(true);
      expect(fn({ ...newDocument("acompte", []) })).toBe(true);
      expect(fn(situation())).toBe(true);
      expect(fn(situation({ vautFacture: false }))).toBe(false);
      expect(fn(newDocument("devis", []))).toBe(false);
      expect(fn(null)).toBe(false);
    }
  });
  it("facture d'acompte : paiements déduits ; situation : net à payer moins paiements, identique côté serveur", () => {
    const ac = { ...newDocument("acompte", []), items: [line], payments: [{ id: "p", amount: 50 }] };
    expect(computeTotals(ac).montantARegler).toBe(70);
    const sit = situation({ retenueGarantiePct: 5, acompteVerse: 10, payments: [{ id: "p", amount: 100 }] });
    const s = computeSituation(sit);
    // cette situation : 500 − 200 = 300 HT, 360 TTC, retenue 18, acompte 10 → net 332, moins 100 payés → 232
    expect(s.netAPayer).toBeCloseTo(332);
    expect(s.paymentsReceived).toBe(100);
    expect(s.totalPaid).toBe(110);
    expect(s.montantARegler).toBeCloseTo(232);
    const srv = computeSituationTotals(sit);
    expect(srv.netAPayer).toBeCloseTo(s.netAPayer);
    expect(srv.montantARegler).toBeCloseTo(s.montantARegler);
    expect(amountDueOf(sit)).toBeCloseTo(232);
    expect(amountDueOf(facture({ payments: [{ id: "p", amount: 20 }] }))).toBe(100);
    expect(amountDueOf(newDocument("devis", []))).toBe(0);
    expect(documentPaidTotal(sit)).toBe(110);
    expect(documentPaidTotal(facture({ acompteVerse: 5, payments: [{ id: "p", amount: 20 }] }))).toBe(25);
  });
  it("paiement en ligne sur une situation : ajouté à la liste, « payée » quand le net est couvert", () => {
    const paid = addOnlinePayment(situation(), "cs_9", 36000, "2026-10-01T10:00:00.000Z");
    expect(paid.payments).toHaveLength(1);
    expect(paid.status).toBe("payée");
    expect(addOnlinePayment(situation(), "cs_8", 10000, "2026-10-01T10:00:00.000Z").status).not.toBe("payée");
  });
});

describe("PDF et éditeur de situation valant facture", () => {
  it("PDF : paiements listés, reste à payer, tampon une fois réglée", () => {
    const d = situation({ payments: [{ id: "p", date: "2026-09-25", amount: 100, method: "Chèque" }] });
    const html = renderToStaticMarkup(<PrintSituation doc={d} siteSettings={{ name: "Chantiflow" }} watermarkEnabled={false} />);
    const out = textOf(html);
    expect(out).toContain("Paiements reçus-100,00 €");
    expect(out).toContain("Reste à payer242,00 €"); // 360 TTC − 18 de retenue (5 %) − 100 payés
    expect(out).toContain("À payer : 242,00 €");
    expect(out).toContain("100,00 € le 25/09/2026 - Chèque");
    expect(html).not.toContain("print-paid-stamp");
    const paid = renderToStaticMarkup(<PrintSituation doc={{ ...d, status: "payée", paidAt: "2026-10-01T10:00:00.000Z" }} siteSettings={{ name: "Chantiflow" }} watermarkEnabled={false} />);
    expect(paid).toContain("print-paid-stamp");
    expect(textOf(paid)).toContain("À payer : 0,00 €");
    // Situation simple (ne vaut pas facture) : rien de tout cela
    const simple = renderToStaticMarkup(<PrintSituation doc={{ ...d, vautFacture: false }} siteSettings={{ name: "Chantiflow" }} watermarkEnabled={false} />);
    expect(textOf(simple)).not.toContain("À payer :");
  });
  it("éditeur : bloc « Paiements reçus » seulement quand la situation vaut facture", async () => {
    const noop = () => {};
    const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
    const props = { documents: [], saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow", landingPageVersion: "classique" }, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onCreateNext: noop, onGoToPricing: noop, clients: [] };
    const a = await mount(<SituationEditor {...props} doc={situation()} />);
    expect(a.container.querySelector(".print-payments-editor")).toBeTruthy();
    await a.unmount();
    const b = await mount(<SituationEditor {...props} doc={situation({ vautFacture: false })} />);
    expect(b.container.querySelector(".print-payments-editor")).toBeNull();
    await b.unmount();
  }, 30000);
});

describe("correction d'un paiement par le gestionnaire", () => {
  it("modifier montant, date et mode ; passage à « payée » si la correction couvre le total", async () => {
    const patches = [];
    const doc = facture({ payments: [{ id: "p1", date: "2026-09-22", amount: 30, method: "Chèque", note: "" }] });
    const { container, unmount } = await mount(<PaymentsEditor doc={doc} totals={computeTotals(doc)} onPatch={(p) => patches.push(p)} />);
    await click(container.querySelector('button[title="Modifier ce paiement"]'));
    const editRow = container.querySelector('button[title="Modifier ce paiement"]') ? null : container;
    expect(editRow).toBeTruthy();
    await act(async () => { setValue(byLabel(container, "Montant"), "120"); });
    await act(async () => { setValue(byLabel(container, "Date"), "2026-09-23"); });
    await act(async () => { setValue(byLabel(container, "Mode"), "Espèces"); });
    await click(button(container, "Enregistrer"));
    expect(patches).toHaveLength(1);
    expect(patches[0].payments).toEqual([{ id: "p1", date: "2026-09-23", amount: 120, method: "Espèces", note: "" }]);
    expect(patches[0].status).toBe("payée");
    await unmount();
  }, 30000);
  it("un paiement en ligne (Stripe) reste modifiable comme les autres", async () => {
    const patches = [];
    const doc = facture({ payments: [{ id: "pay_stripe_cs_1", date: "2026-09-22", amount: 50, method: "Carte bancaire (en ligne)", note: "Stripe" }] });
    const { container, unmount } = await mount(<PaymentsEditor doc={doc} totals={computeTotals(doc)} onPatch={(p) => patches.push(p)} />);
    await click(container.querySelector('button[title="Modifier ce paiement"]'));
    expect(byLabel(container, "Mode").value).toBe("Carte bancaire (en ligne)");
    await act(async () => { setValue(byLabel(container, "Montant"), "45"); });
    await click(button(container, "Enregistrer"));
    expect(patches[0].payments[0]).toMatchObject({ id: "pay_stripe_cs_1", amount: 45, method: "Carte bancaire (en ligne)" });
    expect(patches[0].status).toBeUndefined();
    await unmount();
  }, 30000);
});

describe("page publique : paiement partiel et mise à jour automatique", () => {
  const base = { siteName: "Chantiflow", signedAt: null, paidAt: null, onlinePaymentEnabled: true };
  it("le client choisit un montant partiel : bouton et appel serveur avec ce montant ; vide = tout le reste", async () => {
    publicState.invoked.length = 0;
    publicState.response = { ...base, document: facture({ payments: [{ id: "p", amount: 20 }] }) };
    const { container, unmount } = await mount(<PublicDocumentView token="abc" />);
    const text = () => container.textContent.replace(/[  ]/g, " ");
    expect(text()).toContain("reste à régler 100,00 €");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent.replace(/[  ]/g, " ").trim() === "Payer 100,00 € en ligne")).toBe(true);
    // Un montant supérieur au reste est ramené au reste
    await act(async () => { setValue(byLabel(container, "Montant à payer maintenant"), "500"); });
    expect([...container.querySelectorAll("button")].some((b) => b.textContent.replace(/[  ]/g, " ").trim() === "Payer 100,00 € en ligne")).toBe(true);
    await act(async () => { setValue(byLabel(container, "Montant à payer maintenant"), "40"); });
    const pay = [...container.querySelectorAll("button")].find((b) => b.textContent.replace(/[  ]/g, " ").trim() === "Payer 40,00 € en ligne");
    expect(pay).toBeTruthy();
    await click(pay);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(publicState.invoked.find((c) => c.name === "create-invoice-payment").body).toEqual({ token: "abc", amount: 40 });
    await unmount();
  }, 30000);
  it("retour de Stripe après un paiement partiel : confirmation dès que le paiement apparaît, puis nouveau bouton pour le reste", async () => {
    window.history.replaceState({}, "", "/?voir-document=abc&paiement=ok");
    try {
      let reads = 0;
      publicState.response = () => { reads += 1; return { ...base, document: facture({ payments: reads >= 2 ? [{ id: "pay_stripe_cs_1", date: "2026-09-22", amount: 40, method: "Carte bancaire (en ligne)" }] : [] }) }; };
      const { container, unmount } = await mount(<PublicDocumentView token="abc" />);
      const text = () => container.textContent.replace(/[  ]/g, " ");
      expect(text()).toContain("Paiement transmis, merci !");
      await act(async () => { await new Promise((r) => setTimeout(r, 3100)); });
      await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
      expect(text()).toContain("Paiement reçu, merci ! Il reste 80,00 € à régler.");
      expect(text()).not.toContain("Paiement transmis");
      expect([...container.querySelectorAll("button")].some((b) => b.textContent.replace(/[  ]/g, " ").trim() === "Payer 80,00 € en ligne")).toBe(true);
      await unmount();
    } finally { window.history.replaceState({}, "", "/"); }
  }, 30000);
  it("situation valant facture sur la page publique : montant de la situation et reste à régler", async () => {
    publicState.response = { ...base, document: situation({ payments: [{ id: "p", amount: 100 }] }) };
    const { container, unmount } = await mount(<PublicDocumentView token="abc" />);
    const text = container.textContent.replace(/[  ]/g, " ");
    expect(text).toContain("Gros œuvre");
    expect(text).toContain("300,00 € HT");
    expect(text).toContain("Net à payer 342,00 € − déjà payé 100,00 €"); // retenue de garantie 5 % déduite
    expect([...container.querySelectorAll("button")].some((b) => b.textContent.replace(/[  ]/g, " ").trim() === "Payer 242,00 € en ligne")).toBe(true);
    await unmount();
  }, 30000);
});
