// generate-facturx/facturx.ts
//
// Cœur de la génération Factur-X — volontairement SANS dépendance à une
// Plateforme Agréée précise : le format (PDF/A-3 + XML CII, profil
// EN 16931) est le même quel que soit le partenaire choisi ensuite.
//
// Deux parties :
//   1. buildInvoiceModel()  — transforme une facture du site (structure
//      "documents" de kv_store) en modèle normalisé, en recalculant
//      TOUS les montants côté serveur (jamais de confiance aux totaux
//      envoyés par le navigateur) et en listant les données manquantes.
//   2. buildCiiXml() / buildFacturXPdf() — produisent le XML CII puis le
//      PDF/A-3 avec le XML embarqué (pièce jointe "factur-x.xml",
//      relation "Alternative", métadonnées XMP Factur-X).
//
// Ce fichier est aussi importé tel quel par le script de test local
// (voir supabase/functions/generate-facturx/README.md).

import { PDFDocument, PDFName, PDFArray, PDFString, PDFHexString, AFRelationship, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import * as fontkitModule from "https://esm.sh/@pdf-lib/fontkit@1.1.1";
// Le module expose l'objet fontkit en export par défaut à l'exécution,
// mais ses types ne le déclarent pas — d'où ce petit détour.
const fontkit = ((fontkitModule as unknown as { default?: unknown }).default ?? fontkitModule) as Parameters<PDFDocument["registerFontkit"]>[0];

// ---------------------------------------------------------------------------
// Types du modèle normalisé
// ---------------------------------------------------------------------------

export interface FxParty {
  name: string;
  siren: string | null;      // 9 chiffres (BT-30 / BT-47, schéma 0002)
  siret: string | null;      // 14 chiffres (BT-29 / BT-46, schéma 0009)
  vatId: string | null;      // FRxx999999999 (BT-31 / BT-48)
  street: string;            // BT-35 / BT-50
  postalCode: string;        // BT-38 / BT-53
  city: string;              // BT-37 / BT-52
  countryCode: string;       // BT-40 / BT-55 (ISO 3166-1 alpha-2)
  email: string | null;
  phone: string | null;
}

export type VatCategory = "S" | "E" | "G" | "K" | "AE";

export interface FxLine {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unitCode: string;          // UN/ECE Rec 20
  netUnitPrice: number;      // BT-146 (4 décimales)
  lineTotal: number;         // BT-131 (2 décimales)
  vatCategory: VatCategory;
  vatRate: number;
}

export interface FxVatBreakdown {
  category: VatCategory;
  rate: number;
  basis: number;
  amount: number;
  exemptionReason: string | null;   // BT-120
  exemptionCode: string | null;     // BT-121 (liste VATEX)
}

// Motifs d'exonération proposés sur la facture pour les lignes à 0 % —
// catégorie de TVA EN 16931 (UNTDID 5305), code VATEX (BT-121) et texte
// imprimé (BT-120). La franchise en base est le défaut.
export const VAT_EXEMPTIONS: Record<string, { category: VatCategory; code: string; text: string }> = {
  franchise: { category: "E", code: "VATEX-FR-FRANCHISE", text: "TVA non applicable, art. 293 B du CGI" },
  export: { category: "G", code: "VATEX-EU-G", text: "Exonération de TVA, art. 262 I du CGI — exportation hors Union européenne" },
  intracom: { category: "K", code: "VATEX-EU-IC", text: "Exonération de TVA, art. 262 ter I du CGI — livraison intracommunautaire" },
  autoliquidation: { category: "AE", code: "VATEX-EU-AE", text: "Autoliquidation — TVA due par le preneur, art. 283 du CGI" },
};

export interface FxInvoiceModel {
  number: string;
  typeCode: "380";
  issueDate: string;         // YYYY-MM-DD
  dueDate: string;           // YYYY-MM-DD
  currency: string;
  businessProcess: string;   // BT-23 — cadre de facturation français (B1 / S1 / M1)
  operationCategory: "biens" | "services" | "mixte";
  vatOnDebits: boolean;
  seller: FxParty;
  buyer: FxParty;
  buyerIsBusiness: boolean;
  treatment: "B2B" | "B2BINT" | "B2C"; // note BAR (cadre de traitement français)
  shipTo: { name: string; street: string; postalCode: string; city: string; countryCode: string } | null;
  deliveryDate: string | null; // BT-72, renseignée seulement quand la norme l'exige (livraison intracommunautaire)
  lines: FxLine[];
  vat: FxVatBreakdown[];
  totals: { lineTotal: number; taxBasis: number; taxTotal: number; grandTotal: number; prepaid: number; duePayable: number };
  payment: { iban: string | null; bic: string | null; termsText: string };
  notes: string[];
  siteName: string;
}

export interface BuildResult {
  model: FxInvoiceModel | null;
  missing: string[];   // données obligatoires absentes — bloquant
  warnings: string[];  // points d'attention non bloquants
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const money = (n: number) => round2(n).toFixed(2);
const price4 = (n: number) => round4(n).toFixed(4);
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

// Retire les marqueurs de mise en forme du site (**gras**, __souligné__, ::couleur::).
export function stripMarkup(text: unknown): string {
  return String(text ?? "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/::(.+?)::/g, "$1");
}

// "🇫🇷 FR" -> "FR" ; "France" -> "" (inconnu) ; "" -> "" .
export function countryCodeOf(entry: unknown): string {
  const m = /([A-Z]{2})\s*$/.exec(String(entry ?? "").trim());
  return m ? m[1] : "";
}

// Unités du site -> codes UN/ECE Rec 20 (liste EN 16931).
const UNIT_CODES: Record<string, string> = {
  "forfait": "LS",   // lump sum
  "heure": "HUR",
  "jour": "DAY",
  "m²": "MTK",
  "m³": "MTQ",
  "ml": "MTR",       // mètre linéaire
  "pièce": "C62",
  "kg": "KGM",
  "lot": "C62",      // pas de code "lot" dans la liste EN 16931 : unité générique
};
export function unitCodeOf(unit: unknown): string {
  return UNIT_CODES[clean(unit)] || "C62";
}

const CATEGORY_TO_PROCESS: Record<string, string> = { biens: "B1", services: "S1", mixte: "M1" };
const CATEGORY_LABEL: Record<string, string> = { biens: "Livraison de biens", services: "Prestation de services", mixte: "Opération mixte (biens et services)" };

function isoDatePlusDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const yyyymmdd = (iso: string) => iso.replace(/-/g, "");
const frDate = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };

// ---------------------------------------------------------------------------
// 1. Modèle normalisé à partir d'une facture du site
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
function buildParty(raw: any, fallback: any, label: string, missing: string[], warnings: string[], requireIds: boolean): FxParty {
  const pick = (k: string) => clean(raw?.[k] || fallback?.[k] || "");
  const siret = digits(pick("siret"));
  const name = pick("name");
  const street = pick("address");
  const postalCode = pick("postalCode");
  const city = pick("city");
  const countryCode = countryCodeOf(pick("country")) || (postalCode ? "FR" : "");
  const vatId = pick("tva").replace(/\s+/g, "").toUpperCase() || null;

  if (!name) missing.push(`${label} : nom`);
  if (!city) missing.push(`${label} : ville (champ "Ville", séparé de l'adresse)`);
  if (!countryCode) missing.push(`${label} : pays`);
  if (!postalCode) warnings.push(`${label} : code postal absent`);
  if (requireIds) {
    if (!siret) missing.push(`${label} : SIRET (14 chiffres) — il donne le SIREN exigé par la réforme`);
    else if (siret.length !== 14 && siret.length !== 9) missing.push(`${label} : SIRET invalide (${siret.length} chiffres au lieu de 14)`);
  } else if (siret && siret.length !== 14 && siret.length !== 9) {
    warnings.push(`${label} : SIRET ignoré car invalide (${siret.length} chiffres)`);
  }
  const validSiret = siret.length === 14 ? siret : null;
  const siren = siret.length === 14 ? siret.slice(0, 9) : siret.length === 9 ? siret : null;
  if (vatId && !/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(vatId)) warnings.push(`${label} : numéro de TVA au format inattendu (${vatId})`);

  return { name, siren, siret: validSiret, vatId, street, postalCode, city, countryCode, email: pick("email") || null, phone: pick("phone") || null };
}

/**
 * Transforme une facture du site en modèle Factur-X. `companyProfile` sert
 * de repli pour les informations de l'entreprise absentes de la copie
 * figée dans le document (code postal, ville, IBAN, option TVA...).
 */
// deno-lint-ignore no-explicit-any
export function buildInvoiceModel(doc: any, companyProfile: any, siteName = "Chantiflow"): BuildResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!doc || doc.type !== "facture") {
    return { model: null, missing: ["Seules les factures (type « facture ») peuvent être exportées en Factur-X pour l'instant."], warnings };
  }
  const number = clean(doc.docNumber);
  if (!number) missing.push("Numéro de facture");
  const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(doc.issueDate || "")) ? doc.issueDate : "";
  if (!issueDate) missing.push("Date d'émission");
  const currency = clean(doc.currency || "EUR").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) missing.push(`Devise invalide (${currency})`);

  const operationCategory = String(doc.operationCategory || "") as FxInvoiceModel["operationCategory"];
  if (!CATEGORY_TO_PROCESS[operationCategory]) {
    missing.push("Catégorie d'opération (livraison de biens / prestation de services / mixte) — bloc « Facturation électronique » de la facture");
  }

  const seller = buildParty(doc.company, companyProfile, "Émetteur", missing, warnings, true);
  const buyerIsBusiness = (doc.client?.type || "entreprise") !== "particulier";
  const buyer = buildParty(doc.client, null, "Client", missing, warnings, false);
  // Le SIREN du client n'est exigé que pour un professionnel établi en
  // France (cadre B2B de la réforme). Un client étranger relève du cadre
  // B2BINT (e-reporting), un particulier du cadre B2C.
  const buyerIsFrench = buyer.countryCode === "FR";
  if (buyerIsBusiness && buyerIsFrench && !buyer.siren) missing.push("Client : SIRET (14 chiffres) — il donne le SIREN exigé par la réforme");
  if (buyerIsBusiness && !buyerIsFrench && !buyer.vatId) warnings.push("Client professionnel étranger sans numéro de TVA : à renseigner si possible");
  if (buyerIsBusiness && !buyerIsFrench) warnings.push("Client établi hors de France : cette vente relève du e-reporting (cadre B2BINT), pas de la facture électronique B2B française");
  if (!buyerIsBusiness) warnings.push("Client particulier : la facture électronique B2B ne s'applique pas (ces ventes relèvent du e-reporting), le fichier est généré à titre indicatif");
  const treatment: "B2B" | "B2BINT" | "B2C" = !buyerIsBusiness ? "B2C" : buyerIsFrench ? "B2B" : "B2BINT";

  // Motif d'exonération choisi sur la facture (lignes à 0 %) — franchise
  // en base si rien n'est choisi (documents créés avant ce champ).
  const exemption = VAT_EXEMPTIONS[String(doc.vatExemptionReason || "franchise")] || VAT_EXEMPTIONS.franchise;

  // Lignes — mêmes formules que computeTotals() côté site, mais chaque
  // ligne est arrondie au centime avant d'être additionnée (règle
  // BR-CO-10 de la norme : le total est la somme des lignes affichées).
  const items: any[] = Array.isArray(doc.items) ? doc.items : [];
  const globalDiscount = Number(doc.globalDiscount) || 0;
  const lines: FxLine[] = [];
  let lineIndex = 0;
  for (const it of items) {
    if (!it || it.type !== "line") continue;
    lineIndex++;
    if (it.marginScheme) {
      missing.push(`Ligne ${lineIndex} : le régime de la TVA sur la marge n'est pas encore pris en charge en Factur-X`);
      continue;
    }
    const qty = Number(it.qty) || 0;
    const detailsSum = (Array.isArray(it.details) ? it.details : []).filter((d: any) => d?.included).reduce((s: number, d: any) => s + (Number(d.price) || 0), 0);
    const base = qty * (Number(it.unitPrice) || 0) + detailsSum;
    const afterLine = base * (1 - (Number(it.discount) || 0) / 100);
    const lineTotal = round2(afterLine * (1 - globalDiscount / 100));
    const rate = Number(it.tva) || 0;
    if (rate < 0 || rate > 100) missing.push(`Ligne ${lineIndex} : taux de TVA invalide (${rate})`);
    // Taux admis par les règles françaises (BR-FR-16) : métropole, DOM,
    // Corse et anciens taux historiques.
    else if (![0, 20, 10, 5.5, 2.1, 13, 8.5, 7, 19.6, 20.6, 1.05, 0.9, 1.75, 9.2, 9.6].includes(rate)) warnings.push(`Ligne ${lineIndex} : taux de TVA ${rate} % inhabituel en France (sera signalé par les contrôles des plateformes)`);
    const descriptionParts = (Array.isArray(it.details) ? it.details : [])
      .filter((d: any) => d?.included && (clean(d.text) || Number(d.price) > 0))
      .map((d: any) => `${"  ".repeat(Math.max(0, (Number(d.level) || 1) - 1))}${d.marker || "-"} ${stripMarkup(d.text)}${Number(d.price) > 0 ? ` (${money(Number(d.price))} ${currency})` : ""}`.trimEnd());
    const name = stripMarkup(clean(it.designation)) || `Ligne ${lineIndex}`;
    lines.push({
      id: String(lineIndex),
      name: name.slice(0, 500),
      description: descriptionParts.length ? descriptionParts.join("\n") : null,
      quantity: qty,
      unitCode: unitCodeOf(it.unit),
      netUnitPrice: qty > 0 ? round4(lineTotal / qty) : 0,
      lineTotal,
      vatCategory: rate > 0 ? "S" : exemption.category,
      vatRate: rate,
    });
    if (qty <= 0 && lineTotal !== 0) warnings.push(`Ligne ${lineIndex} : quantité nulle mais montant non nul (prix unitaire net mis à 0)`);
  }
  if (!lines.length) missing.push("Au moins une ligne de prestation");
  if ((Number(it0(items)?.discount) || 0) < 0) warnings.push("Remise négative détectée");

  // Ventilation TVA par (catégorie, taux) — BG-23.
  const groups = new Map<string, FxVatBreakdown>();
  for (const l of lines) {
    const key = `${l.vatCategory}|${l.vatRate}`;
    const exempt = l.vatCategory !== "S";
    const g = groups.get(key) || { category: l.vatCategory, rate: l.vatRate, basis: 0, amount: 0, exemptionReason: exempt ? exemption.text : null, exemptionCode: exempt ? exemption.code : null };
    g.basis = round2(g.basis + l.lineTotal);
    groups.set(key, g);
  }
  const vat = [...groups.values()].map((g) => ({ ...g, amount: g.category === "S" ? round2(g.basis * g.rate / 100) : 0 }));
  const hasExempt = vat.some((g) => g.category !== "S");
  if (hasExempt) warnings.push(`Lignes à 0 % de TVA exportées avec le motif « ${exemption.text} » (modifiable dans le bloc « Facturation électronique » de la facture)`);
  if (vat.some((g) => g.category === "S") && !seller.vatId) missing.push("Émetteur : numéro de TVA intracommunautaire (obligatoire dès qu'une ligne porte de la TVA)");
  // Règles EN 16931 propres à chaque motif : export (BR-G-2) et
  // intracommunautaire / autoliquidation (BR-IC-2, BR-AE-2) exigent le
  // numéro de TVA du vendeur, les deux derniers aussi celui du client.
  if (hasExempt && exemption.category !== "E" && !seller.vatId) missing.push(`Émetteur : numéro de TVA intracommunautaire (obligatoire pour le motif « ${exemption.text} »)`);
  if (hasExempt && (exemption.category === "K" || exemption.category === "AE") && !buyer.vatId) missing.push(`Client : numéro de TVA intracommunautaire (obligatoire pour le motif « ${exemption.text} »)`);
  // Livraison intracommunautaire : la norme exige une date de livraison
  // (BT-72) ou une période de facturation (BR-IC-11) — la facture du
  // site n'en a pas, on reprend la date d'émission en le signalant.
  const deliveryDate = hasExempt && exemption.category === "K" ? issueDate : null;
  if (deliveryDate) warnings.push("Livraison intracommunautaire : date de livraison supposée égale à la date d'émission (la norme exige une date de livraison)");

  const lineTotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const taxTotal = round2(vat.reduce((s, g) => s + g.amount, 0));
  const grandTotal = round2(lineTotal + taxTotal);
  const acomptePct = Number(doc.acompte) || 0;
  const prepaid = acomptePct > 0 ? round2(grandTotal * acomptePct / 100) : 0;
  const duePayable = round2(grandTotal - prepaid);
  if (grandTotal <= 0) warnings.push("Montant total nul ou négatif");

  const dueDays = Number(doc.dueDays) || 0;
  const dueDate = issueDate ? isoDatePlusDays(issueDate, dueDays) : "";

  const iban = clean(doc.company?.iban || companyProfile?.iban || "").replace(/\s+/g, "").toUpperCase() || null;
  const bic = clean(doc.company?.bic || companyProfile?.bic || "").replace(/\s+/g, "").toUpperCase() || null;
  if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) warnings.push(`IBAN au format inattendu (${iban})`);
  if (!iban) warnings.push("Aucun IBAN renseigné : la facture ne contient pas de coordonnées de paiement (page « Mon entreprise »)");
  const vatOnDebits = !!(doc.company?.vatOnDebits ?? companyProfile?.vatOnDebits);

  // Adresse de livraison (BG-15) : celle saisie sur la facture si elle est
  // différente, sinon l'adresse du client lui-même — la norme exige le
  // pays de livraison dans certains cas (BR-IC-12) et les validateurs
  // signalent un bloc de livraison vide.
  const shipStreet = clean(doc.deliveryAddress), shipCity = clean(doc.deliveryCity), shipPostal = clean(doc.deliveryPostalCode);
  const shipTo = shipStreet || shipCity
    ? { name: buyer.name, street: shipStreet, postalCode: shipPostal, city: shipCity || buyer.city, countryCode: buyer.countryCode || "FR" }
    : { name: buyer.name, street: buyer.street, postalCode: buyer.postalCode, city: buyer.city, countryCode: buyer.countryCode };
  if ((shipStreet || shipCity) && !shipCity) warnings.push("Adresse de livraison : ville absente, ville du client reprise");

  const notes: string[] = [];
  const noteText = stripMarkup(clean(doc.notes));
  if (noteText && noteText.toLowerCase() !== "merci de votre confiance.") notes.push(noteText);
  if (clean(doc.chantier)) notes.push(`Chantier : ${clean(doc.chantier)}`);
  if (vatOnDebits) notes.push("Option pour le paiement de la TVA d'après les débits");

  if (missing.length) return { model: null, missing, warnings };

  return {
    model: {
      number, typeCode: "380", issueDate, dueDate, currency,
      businessProcess: CATEGORY_TO_PROCESS[operationCategory],
      operationCategory, vatOnDebits,
      seller, buyer, buyerIsBusiness, treatment, shipTo, deliveryDate, lines, vat,
      totals: { lineTotal, taxBasis: lineTotal, taxTotal, grandTotal, prepaid, duePayable },
      payment: { iban, bic, termsText: dueDays > 0 ? `Paiement à ${dueDays} jours, soit au plus tard le ${frDate(dueDate)}` : "Paiement à réception" },
      notes,
      siteName,
    },
    missing, warnings,
  };
}
// deno-lint-ignore no-explicit-any
function it0(items: any[]) { return items.find((i) => i?.type === "line"); }

// ---------------------------------------------------------------------------
// 2a. XML CII — profil EN 16931 (Factur-X 1.0.x, syntaxe UN/CEFACT CII D22B)
// ---------------------------------------------------------------------------

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const el = (name: string, content: string, attrs = "") => `<${name}${attrs}>${content}</${name}>`;
const opt = (cond: unknown, xml: string) => (cond ? xml : "");

function partyXml(tag: string, p: FxParty, withContact: boolean): string {
  const contact = withContact && (p.phone || p.email)
    ? el("ram:DefinedTradeContact",
        opt(p.phone, el("ram:TelephoneUniversalCommunication", el("ram:CompleteNumber", esc(p.phone)))) +
        opt(p.email, el("ram:EmailURIUniversalCommunication", el("ram:URIID", esc(p.email)))))
    : "";
  return el(tag,
    opt(p.siret, el("ram:ID", esc(p.siret), ' schemeID="0009"')) +
    el("ram:Name", esc(p.name)) +
    opt(p.siren, el("ram:SpecifiedLegalOrganization", el("ram:ID", esc(p.siren), ' schemeID="0002"'))) +
    contact +
    el("ram:PostalTradeAddress",
      opt(p.postalCode, el("ram:PostcodeCode", esc(p.postalCode))) +
      opt(p.street, el("ram:LineOne", esc(p.street))) +
      el("ram:CityName", esc(p.city)) +
      el("ram:CountryID", esc(p.countryCode))) +
    // Adresse électronique (BT-34 / BT-49) exigée par les règles
    // françaises : le SIREN, avec le schéma 0225 de l'annuaire national
    // (règles BR-FR-12, BR-FR-13 et BR-FR-21 du référentiel XP Z12-012).
    opt(p.siren, el("ram:URIUniversalCommunication", el("ram:URIID", esc(p.siren), ' schemeID="0225"'))) +
    opt(p.vatId, el("ram:SpecifiedTaxRegistration", el("ram:ID", esc(p.vatId), ' schemeID="VA"'))),
  );
}

export function buildCiiXml(m: FxInvoiceModel): string {
  // Code de type de date d'exigibilité de la TVA (BT-8, UNTDID 2005) :
  // 5 = date de facture (option pour les débits), 72 = date d'encaissement
  // (régime de droit commun des prestations de services en France).
  // Pour une livraison de biens sans option, on ne renseigne rien.
  const dueDateTypeCode = m.vatOnDebits ? "5" : m.operationCategory === "biens" ? "" : "72";

  const linesXml = m.lines.map((l) => el("ram:IncludedSupplyChainTradeLineItem",
    el("ram:AssociatedDocumentLineDocument", el("ram:LineID", esc(l.id))) +
    el("ram:SpecifiedTradeProduct", el("ram:Name", esc(l.name)) + opt(l.description, el("ram:Description", esc(l.description)))) +
    el("ram:SpecifiedLineTradeAgreement", el("ram:NetPriceProductTradePrice", el("ram:ChargeAmount", price4(l.netUnitPrice)))) +
    el("ram:SpecifiedLineTradeDelivery", el("ram:BilledQuantity", String(l.quantity), ` unitCode="${l.unitCode}"`)) +
    el("ram:SpecifiedLineTradeSettlement",
      el("ram:ApplicableTradeTax", el("ram:TypeCode", "VAT") + el("ram:CategoryCode", l.vatCategory) + el("ram:RateApplicablePercent", String(l.vatRate))) +
      el("ram:SpecifiedTradeSettlementLineMonetarySummation", el("ram:LineTotalAmount", money(l.lineTotal)))),
  )).join("");

  const vatXml = m.vat.map((g) => el("ram:ApplicableTradeTax",
    el("ram:CalculatedAmount", money(g.amount)) +
    el("ram:TypeCode", "VAT") +
    opt(g.exemptionReason, el("ram:ExemptionReason", esc(g.exemptionReason))) +
    el("ram:BasisAmount", money(g.basis)) +
    el("ram:CategoryCode", g.category) +
    opt(g.exemptionCode, el("ram:ExemptionReasonCode", esc(g.exemptionCode))) +
    opt(g.category === "S" && dueDateTypeCode, el("ram:DueDateTypeCode", dueDateTypeCode)) +
    el("ram:RateApplicablePercent", String(g.rate)),
  )).join("");

  const paymentMeansXml = m.payment.iban
    ? el("ram:SpecifiedTradeSettlementPaymentMeans",
        el("ram:TypeCode", "30") +
        el("ram:Information", "Virement bancaire") +
        el("ram:PayeePartyCreditorFinancialAccount", el("ram:IBANID", esc(m.payment.iban))) +
        opt(m.payment.bic, el("ram:PayeeSpecifiedCreditorFinancialInstitution", el("ram:BICID", esc(m.payment.bic)))))
    : "";

  const shipToXml = el("ram:ApplicableHeaderTradeDelivery",
    (m.shipTo
      ? el("ram:ShipToTradeParty",
          el("ram:Name", esc(m.shipTo.name)) +
          el("ram:PostalTradeAddress",
            opt(m.shipTo.postalCode, el("ram:PostcodeCode", esc(m.shipTo.postalCode))) +
            opt(m.shipTo.street, el("ram:LineOne", esc(m.shipTo.street))) +
            el("ram:CityName", esc(m.shipTo.city)) +
            el("ram:CountryID", esc(m.shipTo.countryCode))))
      : "") +
    opt(m.deliveryDate, el("ram:ActualDeliverySupplyChainEvent", el("ram:OccurrenceDateTime", el("udt:DateTimeString", yyyymmdd(m.deliveryDate || ""), ' format="102"')))));

  // Notes (BG-1). Les règles françaises (BR-FR-05) exigent trois mentions
  // légales codées : pénalités de retard (PMD), indemnité forfaitaire de
  // recouvrement (PMT) et escompte (AAB) — ce sont les mentions du Code
  // de commerce déjà obligatoires sur toute facture entre professionnels.
  // La note BAR indique le cadre de traitement (B2B / B2C).
  const legalNotes: Array<[string, string]> = [
    ["PMD", "Pénalités de retard : trois fois le taux d'intérêt légal, exigibles le jour suivant la date de règlement figurant sur la facture."],
    ["PMT", "Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 € (article D. 441-5 du Code de commerce)."],
    ["AAB", "Pas d'escompte pour paiement anticipé."],
    ["BAR", m.treatment],
  ];
  const notesXml =
    m.notes.map((n) => el("ram:IncludedNote", el("ram:Content", esc(n)))).join("") +
    legalNotes.map(([code, content]) => el("ram:IncludedNote", el("ram:Content", esc(content)) + el("ram:SubjectCode", code))).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">` +
    el("rsm:ExchangedDocumentContext",
      el("ram:BusinessProcessSpecifiedDocumentContextParameter", el("ram:ID", m.businessProcess)) +
      el("ram:GuidelineSpecifiedDocumentContextParameter", el("ram:ID", "urn:cen.eu:en16931:2017"))) +
    el("rsm:ExchangedDocument",
      el("ram:ID", esc(m.number)) +
      el("ram:TypeCode", m.typeCode) +
      el("ram:IssueDateTime", el("udt:DateTimeString", yyyymmdd(m.issueDate), ' format="102"')) +
      notesXml) +
    el("rsm:SupplyChainTradeTransaction",
      linesXml +
      el("ram:ApplicableHeaderTradeAgreement",
        partyXml("ram:SellerTradeParty", m.seller, true) +
        partyXml("ram:BuyerTradeParty", m.buyer, false)) +
      shipToXml +
      el("ram:ApplicableHeaderTradeSettlement",
        el("ram:InvoiceCurrencyCode", m.currency) +
        paymentMeansXml +
        vatXml +
        el("ram:SpecifiedTradePaymentTerms",
          el("ram:Description", esc(m.payment.termsText)) +
          el("ram:DueDateDateTime", el("udt:DateTimeString", yyyymmdd(m.dueDate), ' format="102"'))) +
        el("ram:SpecifiedTradeSettlementHeaderMonetarySummation",
          el("ram:LineTotalAmount", money(m.totals.lineTotal)) +
          el("ram:TaxBasisTotalAmount", money(m.totals.taxBasis)) +
          el("ram:TaxTotalAmount", money(m.totals.taxTotal), ` currencyID="${m.currency}"`) +
          el("ram:GrandTotalAmount", money(m.totals.grandTotal)) +
          opt(m.totals.prepaid > 0, el("ram:TotalPrepaidAmount", money(m.totals.prepaid))) +
          el("ram:DuePayableAmount", money(m.totals.duePayable))))) +
    `</rsm:CrossIndustryInvoice>`;
}

// ---------------------------------------------------------------------------
// 2b. PDF/A-3 lisible + XML embarqué
// ---------------------------------------------------------------------------

export interface PdfAssets {
  regularFont: Uint8Array;   // TrueType (DejaVu Sans)
  boldFont: Uint8Array;
  iccProfile: Uint8Array;    // profil sRGB (ICC v2), pour l'OutputIntent PDF/A
}

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 40;
const INK = rgb(0.106, 0.165, 0.2);
const SOFT = rgb(0.29, 0.357, 0.388);
const LINE = rgb(0.855, 0.882, 0.863);

// deno-lint-ignore no-explicit-any
function wrap(text: string, font: any, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of String(text).split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let line = "";
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue; }
      if (line) out.push(line);
      // Mot plus long que la colonne : coupé caractère par caractère.
      let chunk = "";
      for (const ch of w) {
        if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) { out.push(chunk); chunk = ""; }
        chunk += ch;
      }
      line = chunk;
    }
    if (line) out.push(line);
  }
  return out;
}

function xmpMetadata(opts: { title: string; author: string; created: string; producer: string }): string {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(opts.title)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${esc(opts.author)}</rdf:li></rdf:Seq></dc:creator>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Facture électronique Factur-X (EN 16931)</rdf:li></rdf:Alt></dc:description>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>${esc(opts.producer)}</pdf:Producer>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>${esc(opts.producer)}</xmp:CreatorTool>
      <xmp:CreateDate>${opts.created}</xmp:CreateDate>
      <xmp:ModifyDate>${opts.created}</xmp:ModifyDate>
      <xmp:MetadataDate>${opts.created}</xmp:MetadataDate>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentFileName</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>name of the embedded XML invoice file</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentType</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>INVOICE</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>Version</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The actual version of the Factur-X XML schema</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>ConformanceLevel</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The conformance level of the embedded Factur-X data</pdfaProperty:description>
                </rdf:li>
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(h)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Produit le PDF/A-3 complet (rendu lisible + factur-x.xml embarqué). */
export async function buildFacturXPdf(m: FxInvoiceModel, xml: string, assets: PdfAssets, now = new Date()): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(assets.regularFont, { subset: true });
  const bold = await pdf.embedFont(assets.boldFont, { subset: true });
  void StandardFonts; // jamais utilisées : PDF/A exige des polices embarquées

  const fmt = (n: number) => `${money(n).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ${m.currency === "EUR" ? "€" : m.currency}`;
  const contentW = A4.w - 2 * MARGIN;

  let page = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN;
  const newPage = () => { page = pdf.addPage([A4.w, A4.h]); y = A4.h - MARGIN; };
  const ensure = (h: number) => { if (y - h < MARGIN + 30) newPage(); };
  // deno-lint-ignore no-explicit-any
  const text = (s: string, x: number, size = 9, f: any = font, color = INK) => { page.drawText(s, { x, y, size, font: f, color }); };
  // deno-lint-ignore no-explicit-any
  const paragraph = (s: string, x: number, width: number, size = 9, f: any = font, color = INK) => {
    for (const ln of wrap(s, f, size, width)) { ensure(size + 3); text(ln, x, size, f, color); y -= size + 3; }
  };
  const hr = () => { page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.w - MARGIN, y }, thickness: 0.6, color: LINE }); y -= 10; };

  // En-tête
  text(`FACTURE N° ${m.number}`, MARGIN, 16, bold);
  const right = (s: string, size = 9, f = font, color = INK) => { const w = f.widthOfTextAtSize(s, size); page.drawText(s, { x: A4.w - MARGIN - w, y, size, font: f, color }); };
  right(m.seller.name, 12, bold);
  y -= 16;
  text(`Date d'émission : ${frDate(m.issueDate)}`, MARGIN, 9, font, SOFT);
  y -= 12;
  text(`Échéance : ${frDate(m.dueDate)}`, MARGIN, 9, font, SOFT);
  y -= 12;
  text(`Catégorie d'opération : ${CATEGORY_LABEL[m.operationCategory]}`, MARGIN, 9, font, SOFT);
  y -= 18;
  hr();

  // Émetteur / Client
  const colW = (contentW - 20) / 2;
  const blockTop = y;
  const partyLines = (p: FxParty, title: string) => {
    const out = [title, p.name];
    if (p.street) out.push(p.street);
    out.push([p.postalCode, p.city].filter(Boolean).join(" ") + (p.countryCode && p.countryCode !== "FR" ? ` (${p.countryCode})` : ""));
    if (p.siret) out.push(`SIRET : ${p.siret}`); else if (p.siren) out.push(`SIREN : ${p.siren}`);
    if (p.vatId) out.push(`N° TVA : ${p.vatId}`);
    if (p.email) out.push(p.email);
    if (p.phone) out.push(p.phone);
    return out;
  };
  const drawBlock = (x: number, lines: string[]) => {
    let yy = blockTop;
    lines.forEach((ln, i) => {
      const f = i === 0 ? bold : i === 1 ? bold : font;
      const size = i === 0 ? 8 : 9;
      for (const w of wrap(ln, f, size, colW)) { page.drawText(w, { x, y: yy, size, font: f, color: i === 0 ? SOFT : INK }); yy -= size + 3; }
    });
    return yy;
  };
  const y1 = drawBlock(MARGIN, partyLines(m.seller, "ÉMETTEUR"));
  const y2 = drawBlock(MARGIN + colW + 20, partyLines(m.buyer, "CLIENT"));
  y = Math.min(y1, y2) - 6;
  if (m.shipTo) {
    text("ADRESSE DE LIVRAISON / CHANTIER", MARGIN, 8, bold, SOFT); y -= 11;
    paragraph([m.shipTo.street, [m.shipTo.postalCode, m.shipTo.city].filter(Boolean).join(" ")].filter(Boolean).join(", "), MARGIN, contentW);
    y -= 4;
  }
  hr();

  // Tableau des lignes
  const cols = { desc: MARGIN, qty: MARGIN + contentW * 0.56, unit: MARGIN + contentW * 0.64, pu: MARGIN + contentW * 0.72, tva: MARGIN + contentW * 0.84, total: A4.w - MARGIN };
  const header = () => {
    ensure(20);
    page.drawRectangle({ x: MARGIN, y: y - 4, width: contentW, height: 14, color: INK });
    const hx = (s: string, x: number, alignRight = false) => { const w = alignRight ? font.widthOfTextAtSize(s, 7.5) : 0; page.drawText(s, { x: alignRight ? x - w : x, y, size: 7.5, font: bold, color: rgb(1, 1, 1) }); };
    hx("Désignation", cols.desc + 4); hx("Qté", cols.qty + 20, true); hx("Unité", cols.unit); hx("PU HT", cols.pu + 40, true); hx("TVA", cols.tva + 24, true); hx("Total HT", cols.total - 4, true);
    y -= 18;
  };
  header();
  const UNIT_LABEL: Record<string, string> = { LS: "forfait", HUR: "heure", DAY: "jour", MTK: "m²", MTQ: "m³", MTR: "ml", C62: "u.", KGM: "kg" };
  for (const l of m.lines) {
    const descLines = wrap(l.name, font, 9, contentW * 0.54);
    const detailLines = l.description ? wrap(l.description, font, 7.5, contentW * 0.52) : [];
    const h = descLines.length * 12 + detailLines.length * 10 + 6;
    if (y - h < MARGIN + 30) { newPage(); header(); }
    const rowTop = y;
    descLines.forEach((s) => { page.drawText(s, { x: cols.desc + 4, y, size: 9, font, color: INK }); y -= 12; });
    detailLines.forEach((s) => { page.drawText(s, { x: cols.desc + 10, y, size: 7.5, font, color: SOFT }); y -= 10; });
    const rr = (s: string, x: number) => { const w = font.widthOfTextAtSize(s, 9); page.drawText(s, { x: x - w, y: rowTop, size: 9, font, color: INK }); };
    rr(String(l.quantity), cols.qty + 20);
    page.drawText(UNIT_LABEL[l.unitCode] || l.unitCode, { x: cols.unit, y: rowTop, size: 9, font, color: INK });
    rr(fmt(l.netUnitPrice), cols.pu + 40);
    rr(`${l.vatRate} %`, cols.tva + 24);
    rr(fmt(l.lineTotal), cols.total - 4);
    y -= 4;
    page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: A4.w - MARGIN, y: y + 2 }, thickness: 0.4, color: LINE });
  }
  y -= 8;

  // Totaux
  ensure(90 + m.vat.length * 12);
  const tx = A4.w - MARGIN - 220;
  const totalRow = (label: string, value: string, strong = false) => {
    page.drawText(label, { x: tx, y, size: 9, font: strong ? bold : font, color: INK });
    const w = (strong ? bold : font).widthOfTextAtSize(value, 9);
    page.drawText(value, { x: A4.w - MARGIN - 4 - w, y, size: 9, font: strong ? bold : font, color: INK });
    y -= 13;
  };
  totalRow("Total HT", fmt(m.totals.taxBasis), true);
  for (const g of m.vat) totalRow(g.category === "E" ? `TVA ${g.rate} % (exonérée)` : `TVA ${g.rate} % sur ${fmt(g.basis)}`, fmt(g.amount));
  totalRow("Total TVA", fmt(m.totals.taxTotal));
  totalRow("Total TTC", fmt(m.totals.grandTotal), true);
  if (m.totals.prepaid > 0) { totalRow("Acompte", `- ${fmt(m.totals.prepaid)}`); totalRow("Reste à payer", fmt(m.totals.duePayable), true); }
  y -= 6;
  hr();

  // Paiement, notes, mentions
  paragraph(m.payment.termsText, MARGIN, contentW, 9);
  if (m.payment.iban) paragraph(`Règlement par virement — IBAN : ${m.payment.iban}${m.payment.bic ? ` — BIC : ${m.payment.bic}` : ""}`, MARGIN, contentW, 9);
  for (const g of m.vat) if (g.exemptionReason) paragraph(g.exemptionReason, MARGIN, contentW, 8, font, SOFT);
  if (m.notes.length) { y -= 4; for (const n of m.notes) paragraph(n, MARGIN, contentW, 8.5, font, SOFT); }
  y -= 8;
  paragraph("Facture électronique au format Factur-X (profil EN 16931) : les données structurées de cette facture sont contenues dans le fichier factur-x.xml joint à ce PDF/A-3.", MARGIN, contentW, 7, font, SOFT);

  // ---- PDF/A-3 : pièce jointe, métadonnées, profil couleur, identifiant ----
  const xmlBytes = new TextEncoder().encode(xml);
  await pdf.attach(xmlBytes, "factur-x.xml", {
    mimeType: "application/xml",
    description: "Factur-X invoice (EN 16931)",
    creationDate: now,
    modificationDate: now,
    afRelationship: AFRelationship.Alternative,
  });

  const producer = `${m.siteName} — générateur Factur-X`;
  const title = `Facture ${m.number}`;
  pdf.setTitle(title);
  pdf.setAuthor(m.seller.name);
  pdf.setSubject("Facture électronique Factur-X (EN 16931)");
  pdf.setCreator(producer);
  pdf.setProducer(producer);
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);

  // XMP : les dates doivent être identiques à celles du dictionnaire Info
  // (à la seconde près), sinon les validateurs PDF/A rejettent le fichier.
  const created = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const xmp = new TextEncoder().encode(xmpMetadata({ title, author: m.seller.name, created, producer }));
  const metadataStream = pdf.context.stream(xmp, { Type: "Metadata", Subtype: "XML", Length: xmp.length });
  pdf.catalog.set(PDFName.of("Metadata"), pdf.context.register(metadataStream));

  // OutputIntent sRGB (ISO 19005-3 §6.2.4.3) : obligatoire dès qu'on
  // utilise des couleurs RGB.
  const iccStream = pdf.context.flateStream(assets.iccProfile, { N: 3 });
  const iccRef = pdf.context.register(iccStream);
  const intent = pdf.context.obj({
    Type: "OutputIntent",
    S: "GTS_PDFA1",
    OutputConditionIdentifier: PDFString.of("sRGB IEC61966-2.1"),
    RegistryName: PDFString.of("http://www.color.org"),
    Info: PDFString.of("sRGB IEC61966-2.1"),
    DestOutputProfile: iccRef,
  });
  const intents = PDFArray.withContext(pdf.context);
  intents.push(intent);
  pdf.catalog.set(PDFName.of("OutputIntents"), intents);

  // Identifiant de fichier (/ID dans le trailer) exigé par PDF/A.
  const first = await pdf.save({ useObjectStreams: false });
  const id = PDFHexString.of(await sha256Hex(first));
  pdf.context.trailerInfo.ID = pdf.context.obj([id, id]);
  return await pdf.save({ useObjectStreams: false });
}

/** Nom de fichier sûr pour le téléchargement. */
export function facturXFileName(number: string): string {
  return `Facture-${String(number || "document").replace(/[\\/:*?"<>|]/g, "-")}-facturx.pdf`;
}
