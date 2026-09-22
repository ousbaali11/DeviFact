// @vitest-environment jsdom
// Les totaux calculés côté serveur (supabase/functions/_shared/totals.ts :
// paiement en ligne, relances, Factur-X) doivent être identiques à ceux du
// site (computeTotals dans App.jsx), sur tous les cas : sous-détails,
// remises de ligne, remise globale en % et en montant, TVA par taux,
// acompte déjà versé, devise.
import { describe, it, expect } from "vitest";
import { computeTotals, newDocument } from "./App.jsx";
import { computeDocTotals, formatAmount, globalDiscountRate } from "../supabase/functions/_shared/totals.ts";

const line = (o) => ({ id: Math.random().toString(36).slice(2), type: "line", designation: "x", details: [], qty: 1, unitPrice: 0, tva: 20, discount: 0, ...o });
const cases = {
  simple: { items: [line({ qty: 2, unitPrice: 50 })] },
  "sous-détails avec prix (prix unitaire à zéro)": { items: [line({ unitPrice: 0, details: [{ id: "a", text: "Socle", price: "1500", included: true }, { id: "b", text: "Option", price: "800", included: false }] }), line({ qty: 3, unitPrice: "12.5", tva: "10" })] },
  "remise de ligne et remise globale en %": { items: [line({ qty: 4, unitPrice: 100, discount: 15 }), line({ unitPrice: 200, tva: 5.5 })], globalDiscount: 12 },
  "remise globale en montant": { items: [line({ unitPrice: 2 }), line({ unitPrice: 11 })], globalDiscount: 9, globalDiscountMode: "amount" },
  "remise globale en montant supérieure au total": { items: [line({ unitPrice: 5 })], globalDiscount: 50, globalDiscountMode: "amount" },
  "acompte déjà versé sur une facture": { type: "facture", items: [line({ unitPrice: 100 })], acompteVerse: "20" },
  "acompte versé supérieur au total : jamais négatif": { type: "facture", items: [line({ unitPrice: 100 })], acompteVerse: 500 },
  "paiements reçus en plusieurs fois, avec acompte": { type: "facture", items: [line({ unitPrice: 100 })], acompteVerse: 20, payments: [{ id: "a", date: "2026-09-22", amount: "30.5", method: "Chèque" }, { id: "b", amount: 50 }, { id: "c", amount: -5 }] },
  "section et ligne vide ignorées": { items: [{ id: "s", type: "section", title: "T" }, line({ unitPrice: 0 }), line({ unitPrice: 30, tva: 0 })] },
};

describe("totaux serveur = totaux du site", () => {
  for (const [name, extra] of Object.entries(cases)) {
    it(name, () => {
      const doc = { ...newDocument(extra.type || "facture", []), ...extra };
      const site = computeTotals(doc);
      const server = computeDocTotals(doc);
      for (const k of ["subtotalHTBrut", "globalDiscountPct", "globalDiscountAmount", "subtotalHT", "totalTVA", "totalTTC", "acompteVerse", "paymentsReceived", "totalPaid", "montantARegler"]) {
        expect(server[k], k).toBeCloseTo(site[k], 6);
      }
      expect(server.lines.map((l) => l.totalHT)).toEqual(site.computedLines.map((l) => l.totalHT));
      expect(globalDiscountRate(doc) * 100).toBeCloseTo(site.globalDiscountPct, 6);
    });
  }
});

describe("montant lisible pour les e-mails", () => {
  it("euros, dirhams, autre devise", () => {
    expect(formatAmount(1234.5, "EUR").replace(/[  ]/g, " ")).toBe("1 234,50 €");
    expect(formatAmount(4.8, "MAD")).toBe("4,80 DH");
    expect(formatAmount(10, "CHF")).toBe("10,00 CHF");
    expect(formatAmount(NaN)).toBe("0,00 €");
  });
});
