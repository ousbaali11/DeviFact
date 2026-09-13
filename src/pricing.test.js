import { describe, it, expect } from "vitest";
import { isBelowReferencePrice, priceWarning, priceWarnings, priceWarningMessage } from "./pricing.js";

const product = { id: "p1", name: "Carrelage", sale_price_ht: 25 };

describe("prix saisi S vs prix de référence P", () => {
  it("S < P : avertissement", () => {
    expect(isBelowReferencePrice(20, 25)).toBe(true);
    expect(priceWarning({ productId: "p1", unitPrice: "20" }, product)).toEqual({ unitPrice: 20, referencePrice: 25, productName: "Carrelage" });
  });
  it("S = P : rien", () => {
    expect(isBelowReferencePrice(25, 25)).toBe(false);
    expect(priceWarning({ productId: "p1", unitPrice: 25 }, product)).toBeNull();
  });
  it("S > P : rien", () => {
    expect(isBelowReferencePrice(30, 25)).toBe(false);
    expect(priceWarning({ productId: "p1", unitPrice: 30 }, product)).toBeNull();
  });
  it("ligne sans produit lié, produit inconnu, prix vide ou non numérique : rien", () => {
    expect(priceWarning({ unitPrice: 1 }, product)).toBeNull();
    expect(priceWarning({ productId: "p1", unitPrice: 1 }, undefined)).toBeNull();
    expect(priceWarning({ productId: "p1", unitPrice: "" }, product)).toBeNull();
    expect(priceWarning({ productId: "p1", unitPrice: "abc" }, product)).toBeNull();
    expect(priceWarning({ productId: "p1", unitPrice: 1 }, { ...product, sale_price_ht: null })).toBeNull();
  });
  it("document complet : seules les lignes S < P sont signalées", () => {
    const items = [
      { id: "a", type: "line", productId: "p1", unitPrice: 20 },
      { id: "b", type: "line", productId: "p1", unitPrice: 25 },
      { id: "c", type: "line", unitPrice: 1 },
      { id: "s", type: "section", title: "Lot" },
    ];
    const w = priceWarnings(items, new Map([["p1", product]]));
    expect([...w.keys()]).toEqual(["a"]);
    expect(priceWarningMessage(w.get("a"), (n) => `${n} €`)).toBe("Prix saisi 20 € HT inférieur au prix de référence 25 € HT du produit « Carrelage ».");
  });
});
