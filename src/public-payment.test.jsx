// @vitest-environment jsdom
// Page publique d'une facture (lien ou QR code) : plus de paiement en ligne.
// Le client voit les coordonnées de virement de l'artisan (nom ou raison
// sociale, IBAN, BIC), le reste à payer et la référence à indiquer. Jamais
// de bouton de paiement, même si un ancien serveur annonçait encore le
// paiement en ligne ; pas de coordonnées → message clair.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PublicDocumentView, PrintDocument, newDocument, computeTotals } from "./App.jsx";
import { renderToStaticMarkup } from "react-dom/server";

const state = { response: null };
vi.mock("./client.js", () => ({
  db: {
    functions: { invoke: async () => { state.calls = (state.calls || 0) + 1; return { data: typeof state.response === "function" ? state.response() : state.response, error: null }; } },
    from: () => { throw new Error("pas d'accès base attendu sur la page publique"); },
  },
}));

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });
const invokeCount = () => state.calls;
state.calls = 0;

const facture = { id: "d1", type: "facture", docNumber: "F-001", status: "envoyée", currency: "EUR", company: { type: "entreprise", name: "Sur le document SARL" }, client: { name: "M. Dupont" }, items: [{ id: "l1", type: "line", designation: "Pose", qty: 1, unitPrice: 100, tva: 20 }] };
const entreprise = { type: "entreprise", name: "Bâti Plus SARL", iban: "FR76 3000 6000 0112 3456 7890 189", bic: "AGRIFRPP" };
const particulier = { type: "particulier", name: "Marie Martin", iban: "FR76 1111 2222 3333", bic: "" };

async function renderPublic(response) {
  state.response = response;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<PublicDocumentView token="abc" />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  const text = container.textContent.replace(/[  ]/g, " ");
  const buttons = [...container.querySelectorAll("button")].map((b) => b.textContent.trim());
  const inputs = container.querySelectorAll("input").length;
  await act(async () => { root.unmount(); });
  container.remove();
  return { text, buttons, inputs };
}

describe("page publique d'une facture : virement", () => {
  it("entreprise : raison sociale, IBAN, BIC, reste à payer et référence ; aucun bouton ni champ de paiement", async () => {
    const { text, buttons, inputs } = await renderPublic({ document: facture, siteName: "Chantiflow", signedAt: null, paidAt: null, onlinePaymentEnabled: false, paymentInfo: entreprise });
    expect(text).toContain("Facture F-001");
    expect(text).toContain("Payer par virement bancaire");
    expect(text).toContain("BénéficiaireBâti Plus SARL");
    expect(text).toContain("IBANFR76 3000 6000 0112 3456 7890 189");
    expect(text).toContain("BICAGRIFRPP");
    expect(text).toContain("Montant120,00 €");
    expect(text).toContain("RéférenceF-001");
    expect(text).toContain("Indique la référence dans le libellé du virement");
    expect(buttons.some((b) => b.startsWith("Payer"))).toBe(false);
    expect(inputs).toBe(0);
    expect(text).not.toMatch(/stripe|carte bancaire|en ligne/i);
  }, 30000);
  it("particulier : prénom et nom, pas de ligne BIC quand il est vide", async () => {
    const { text } = await renderPublic({ document: facture, siteName: "Chantiflow", signedAt: null, paidAt: null, paymentInfo: particulier });
    expect(text).toContain("BénéficiaireMarie Martin");
    expect(text).toContain("IBANFR76 1111 2222 3333");
    expect(text).not.toContain("BIC");
  }, 30000);
  it("ancien serveur annonçant le paiement en ligne : toujours le virement, jamais de bouton", async () => {
    const { text, buttons } = await renderPublic({ document: facture, siteName: "Chantiflow", signedAt: null, paidAt: null, onlinePaymentEnabled: true, paymentInfo: entreprise });
    expect(text).toContain("Payer par virement bancaire");
    expect(buttons.some((b) => b.startsWith("Payer"))).toBe(false);
  }, 30000);
  it("coordonnées absentes : message clair avec le nom de l'émetteur, sans IBAN inventé", async () => {
    const { text } = await renderPublic({ document: facture, siteName: "Chantiflow", signedAt: null, paidAt: null, paymentInfo: { type: "entreprise", name: "Bâti Plus SARL", iban: "", bic: "" } });
    expect(text).toContain("Coordonnées bancaires à demander à Bâti Plus SARL");
    expect(text).not.toContain("IBAN");
    // Serveur sans le champ paymentInfo du tout : nom du document en repli.
    const old = await renderPublic({ document: facture, siteName: "Chantiflow", signedAt: null, paidAt: null });
    expect(old.text).toContain("Coordonnées bancaires à demander à Sur le document SARL");
  }, 30000);
  it("facture déjà payée : ni bloc virement ni bouton, mention « déjà payée »", async () => {
    const { text, buttons } = await renderPublic({ document: facture, siteName: "Chantiflow", signedAt: null, paidAt: "2026-09-01T10:00:00Z", paymentInfo: entreprise });
    expect(buttons.some((b) => b.startsWith("Payer"))).toBe(false);
    expect(text).not.toContain("Payer par virement bancaire");
    expect(text).toContain("Facture déjà payée");
  }, 30000);
  it("acompte déjà versé et sous-détails : le montant du virement est le reste à payer, comme sur le PDF", async () => {
    const withDetails = { ...facture, acompteVerse: "20", items: [{ id: "l1", type: "line", designation: "Socle", qty: 1, unitPrice: 0, tva: 20, details: [{ id: "d", text: "Serveur", price: "100", included: true }] }] };
    const { text } = await renderPublic({ document: withDetails, siteName: "Chantiflow", signedAt: null, paidAt: null, paymentInfo: entreprise });
    expect(text).toContain("100,00 € HT"); // ligne valorisée par ses sous-détails
    expect(text).toContain("Total TTC 120,00 € − déjà payé 20,00 €");
    expect(text).toContain("Montant100,00 €");
  }, 30000);
  it("retour d'une ancienne adresse de paiement (?paiement=ok) : page normale, une seule lecture, aucune attente de confirmation", async () => {
    window.history.replaceState({}, "", "/?voir-document=abc&paiement=ok&session=cs_9");
    try {
      state.calls = 0;
      const { text } = await renderPublic({ document: facture, siteName: "Chantiflow", signedAt: null, paidAt: null, paymentInfo: entreprise });
      expect(text).toContain("Payer par virement bancaire");
      expect(text).not.toContain("Paiement transmis");
      expect(text).not.toContain("Paiement reçu");
      await act(async () => { await new Promise((r) => setTimeout(r, 3100)); });
      expect(invokeCount()).toBe(1);
    } finally { window.history.replaceState({}, "", "/"); }
  }, 30000);
});

describe("QR code du PDF", () => {
  const qr = { url: "https://www.chantiflow.fr/?voir-document=abc", dataUrl: "data:image/png;base64,AAAA" };
  const pdfText = (doc) => new DOMParser().parseFromString(renderToStaticMarkup(<PrintDocument doc={doc} totals={computeTotals(doc)} siteSettings={{ name: "Chantiflow" }} watermarkEnabled={false} publicQr={qr} />), "text/html").body.textContent;
  it("facture et acompte : « informations de paiement » ; devis : « signer » ; jamais de mention de carte", () => {
    const line = { id: "l1", type: "line", designation: "Pose", details: [], qty: 1, unitPrice: 100, tva: 20, discount: 0 };
    const facturePdf = pdfText({ ...newDocument("facture", []), docNumber: "F-1", items: [line] });
    expect(facturePdf).toContain("Scannez pour voir les informations de paiement");
    expect(facturePdf).not.toMatch(/carte|en ligne/i);
    expect(pdfText({ ...newDocument("acompte", []), docNumber: "A-1", items: [line] })).toContain("Scannez pour voir les informations de paiement");
    expect(pdfText({ ...newDocument("devis", []), docNumber: "D-1", items: [line] })).toContain("Scannez pour signer en ligne");
  });
});
