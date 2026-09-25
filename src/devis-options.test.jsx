// @vitest-environment jsdom
// Priorité 9 : devis à options ajustables par le client. Une ligne « en
// option » n'est comptée que si elle est retenue (client sur le lien de
// signature, ou artisan dans l'éditeur) ; même règle site / serveur ;
// PDF avec mentions ; page publique avec cases, total recalculé et
// montant accepté à la signature.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

const publicState = { response: null, invoked: [] };
vi.mock("./client.js", () => ({
  db: {
    functions: { invoke: async (name, opts) => { publicState.invoked.push({ name, body: opts?.body }); if (name === "sign-public-document") return { data: { success: true }, error: null }; return { data: publicState.response, error: null }; } },
    from: () => { throw new Error("pas d'accès base attendu"); },
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
import { Editor, PrintDocument, PublicDocumentView, computeTotals, isCountedLine, optionState, newDocument, emptyCompanyProfile, PLANS } from "./App.jsx";
import { computeDocTotals, isCountedLine as isCountedServer } from "../supabase/functions/_shared/totals.ts";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null; });

const clean = (s) => s.replace(/[  ]/g, " ");
const textOf = (html) => clean(new DOMParser().parseFromString(html, "text/html").body.textContent);
const base = { id: "l1", type: "line", designation: "Pose carrelage", details: [], qty: 1, unitPrice: 1000, tva: 20, discount: 0 };
const option = (extra = {}) => ({ id: "l2", type: "line", designation: "Plinthes assorties", details: [], qty: 1, unitPrice: 200, tva: 20, discount: 0, optional: true, ...extra });
const devis = (extra = {}) => ({ ...newDocument("devis", []), id: "d1", docNumber: "DEV-007", issueDate: "2026-09-21", currency: "EUR", status: "envoyé", company: { ...emptyCompanyProfile(), name: "Bâti Plus" }, client: { type: "particulier", name: "M. Dupont" }, items: [base, option()], ...extra });
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
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("règle de calcul", () => {
  it("option proposée exclue, option retenue comptée ; identique côté serveur ; remise globale en montant sur la base comptée", () => {
    expect(computeTotals(devis()).totalTTC).toBe(1200);
    expect(computeTotals(devis({ items: [base, option({ optionAccepted: true })] })).totalTTC).toBe(1440);
    expect(computeDocTotals(devis()).totalTTC).toBe(1200);
    expect(computeDocTotals(devis({ items: [base, option({ optionAccepted: true })] })).totalTTC).toBe(1440);
    expect(isCountedLine(option())).toBe(false);
    expect(isCountedLine(option({ optionAccepted: true }))).toBe(true);
    expect(isCountedServer(option())).toBe(false);
    expect(optionState(base)).toBe("");
    expect(optionState(option())).toBe("proposee");
    expect(optionState(option({ optionAccepted: true }))).toBe("retenue");
    // Remise globale de 100 € : rapportée aux 1 000 € comptés (10 %), pas aux 1 200 €.
    const remise = devis({ globalDiscount: 100, globalDiscountMode: "amount" });
    expect(computeTotals(remise).globalDiscountPct).toBe(10);
    expect(computeDocTotals(remise).globalDiscountPct).toBe(10);
    // L'acompte demandé suit le total accepté.
    expect(computeTotals(devis({ acompte: 30 })).acompteAmount).toBe(360);
    expect(computeTotals(devis({ acompte: 30, items: [base, option({ optionAccepted: true })] })).acompteAmount).toBe(432);
  });
});

describe("PDF du devis", () => {
  const pdf = (d) => textOf(renderToStaticMarkup(<PrintDocument doc={d} totals={computeTotals(d)} siteSettings={{ name: "Chantiflow" }} watermarkEnabled={false} />));
  it("avant signature : « Option » sur la ligne, hors total, ligne récapitulative ; après : « retenue » ou « non retenue »", () => {
    const out = pdf(devis());
    expect(out).toContain("Plinthes assortiesOption");
    expect(out).toContain("Total TTC1 200,00 €");
    expect(out).toContain("Options proposées, non comprises dans le total : 1");
    const signedYes = pdf(devis({ status: "signé", items: [base, option({ optionAccepted: true })] }));
    expect(signedYes).toContain("Plinthes assortiesOption retenue");
    expect(signedYes).toContain("Total TTC1 440,00 €");
    expect(signedYes).toContain("Options retenues, comprises dans le total : 1");
    const signedNo = pdf(devis({ status: "signé" }));
    expect(signedNo).toContain("Plinthes assortiesOption non retenue");
    expect(signedNo).toContain("Total TTC1 200,00 €");
    expect(signedNo).toContain("Options non retenues, hors total : 1");
    expect(pdf(devis({ items: [base] }))).not.toContain("Options");
  });
});

describe("éditeur", () => {
  const props = { saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onFinalize: noop, onBack: noop, onGoToPricing: noop, products: [], stockByProduct: {}, companyProfile: { ...emptyCompanyProfile(), name: "Bâti Plus" }, onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop, clients: [] };
  it("devis : case « Option » par ligne, « Retenue » quand l'option est cochée, enregistrées ; facture : pas de case", async () => {
    const changes = [];
    const { container, unmount } = await mount(<Editor {...props} doc={devis({ items: [base] })} onChange={(p) => changes.push(p)} />);
    const cell = container.querySelector('[data-testid="line-option"]');
    expect(cell).toBeTruthy();
    expect(cell.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    await click(cell.querySelector('input[type="checkbox"]'));
    expect(container.querySelectorAll('[data-testid="line-option"] input[type="checkbox"]')).toHaveLength(2); // « Retenue » apparaît
    await click(container.querySelectorAll('[data-testid="line-option"] input[type="checkbox"]')[1]);
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(changes[changes.length - 1].items[0]).toMatchObject({ optional: true, optionAccepted: true });
    await unmount();
    const f = await mount(<Editor {...props} doc={{ ...devis({ items: [base] }), type: "facture", docNumber: "FAC-1" }} onChange={noop} />);
    expect(f.container.querySelector('[data-testid="line-option"]')).toBeNull();
    await f.unmount();
  }, 30000);
});

describe("lien de signature", () => {
  async function renderPublic(document) {
    publicState.response = { document, siteName: "Chantiflow", signedAt: null, paidAt: null };
    publicState.invoked = [];
    const container = document_();
    return container;
  }
  async function document_() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<PublicDocumentView token="abc" />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
  }
  it("option décochée par défaut, total 1 200 € ; cochée : 1 440 € et bouton « Signer pour … » ; signature envoyée avec l'option ; ensuite « option retenue »", async () => {
    const { container, unmount } = await renderPublic(devis());
    const box = container.querySelector('[data-testid="public-option"] input[type="checkbox"]');
    expect(box).toBeTruthy();
    expect(box.checked).toBe(false);
    const text = () => clean(container.textContent);
    expect(text()).toContain("1 200,00 €");
    expect(text()).toContain("Coche les options que tu retiens");
    await click(box);
    expect(text()).toContain("1 440,00 €");
    const signButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Signer pour"));
    expect(clean(signButton().textContent)).toContain("Signer pour 1 440,00 € TTC");
    // Nom du signataire puis signature.
    const nameInput = [...container.querySelectorAll("input")].find((i) => i.type === "text" || i.placeholder?.toLowerCase().includes("nom"));
    await act(async () => { setValue(nameInput, "Jean Dupont"); });
    await click(signButton());
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const call = publicState.invoked.find((c) => c.name === "sign-public-document");
    expect(call.body).toMatchObject({ token: "abc", signatureName: "Jean Dupont", acceptedOptionIds: ["l2"] });
    expect(text()).toContain("Devis signé");
    expect(text()).toContain("option retenue");
    expect(container.querySelector('[data-testid="public-option"] input[type="checkbox"]').disabled).toBe(true);
    await unmount();
  }, 30000);
  it("devis sans option : aucune case, bouton habituel ; devis déjà signé : options figées avec leur état", async () => {
    const a = await renderPublic(devis({ items: [base] }));
    expect(a.container.querySelector('[data-testid="public-option"]')).toBeNull();
    expect([...a.container.querySelectorAll("button")].some((b) => b.textContent.trim() === "Signer et accepter le devis")).toBe(true);
    await a.unmount();
    const b = await renderPublic(devis({ status: "signé", items: [base, option({ optionAccepted: false })] }));
    expect(clean(b.container.textContent)).toContain("option non retenue");
    expect(b.container.querySelector('[data-testid="public-option"] input[type="checkbox"]').disabled).toBe(true);
    await b.unmount();
  }, 30000);
});
