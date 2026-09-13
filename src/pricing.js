// pricing.js — règle métier « prix saisi inférieur au prix de référence »
// (Gestion de stock, étape 5). Fonctions pures, testées unitairement.
//
// Une ligne de document liée à un produit (productId) dont le prix
// unitaire HT saisi S est strictement inférieur au prix de vente HT de
// référence P du produit reçoit un avertissement NON bloquant : l'auteur
// garde le droit de vendre en dessous du prix catalogue (remise
// négociée, geste commercial), il est seulement prévenu. Le même calcul
// est refait côté serveur (trigger sur kv_store) qui pose le marqueur
// `belowReferencePrice` sur la ligne, sans jamais refuser l'enregistrement.

const toNumber = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// true si S < P (les deux numériques), false sinon (égal, supérieur, absent).
export function isBelowReferencePrice(unitPrice, referencePrice) {
  const s = toNumber(unitPrice);
  const p = toNumber(referencePrice);
  if (s === null || p === null) return false;
  return s < p;
}

// Avertissement pour une ligne : null si rien à signaler, sinon
// { unitPrice, referencePrice, productName }.
export function priceWarning(line, product) {
  if (!line || !product || !line.productId) return null;
  if (!isBelowReferencePrice(line.unitPrice, product.sale_price_ht)) return null;
  return { unitPrice: toNumber(line.unitPrice), referencePrice: toNumber(product.sale_price_ht), productName: product.name || "" };
}

// Avertissements de toutes les lignes d'un document : Map id de ligne → avertissement.
export function priceWarnings(items, productById) {
  const out = new Map();
  for (const it of items || []) {
    if (!it || it.type !== "line" || !it.productId) continue;
    const w = priceWarning(it, productById?.get ? productById.get(it.productId) : productById?.[it.productId]);
    if (w) out.set(it.id, w);
  }
  return out;
}

export function priceWarningMessage(w, formatMoney = (n) => `${Number(n).toFixed(2)}`) {
  return `Prix saisi ${formatMoney(w.unitPrice)} HT inférieur au prix de référence ${formatMoney(w.referencePrice)} HT du produit${w.productName ? ` « ${w.productName} »` : ""}.`;
}
