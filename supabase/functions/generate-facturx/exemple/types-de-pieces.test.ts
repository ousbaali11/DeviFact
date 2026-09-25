// Test Deno des pièces Factur-X autres que la facture simple (points 5 et 6
// du 26/09/2026) : avoir (381, facture d'origine BT-25), facture d'acompte
// (386) et situation de travaux valant facture (380, une ligne par poste au
// montant de cette situation, retenue de garantie en conditions de paiement,
// acompte versé en montant prépayé).
//
//   npx deno test --allow-net supabase/functions/generate-facturx/exemple/types-de-pieces.test.ts
import { PDFPage } from "https://esm.sh/pdf-lib@1.17.1";
import { buildInvoiceModel, buildCiiXml, buildFacturXPdf } from "../facturx.ts";
import { FONT_REGULAR_B64, FONT_BOLD_B64, ICC_PROFILE_B64, decodeBase64 } from "../assets-embarques.ts";

const texts: string[] = [];
const origText = PDFPage.prototype.drawText;
// deno-lint-ignore no-explicit-any
PDFPage.prototype.drawText = function (this: any, s: string, opts: any) { texts.push(s); return origText.call(this, s, opts); };
const assets = { regularFont: decodeBase64(FONT_REGULAR_B64), boldFont: decodeBase64(FONT_BOLD_B64), iccProfile: decodeBase64(ICC_PROFILE_B64) };
const companyProfile = { type: "entreprise", name: "Martin Rénovation SARL", siret: "732 829 320 00074", address: "12 rue des Artisans", postalCode: "69003", city: "Lyon", country: "🇫🇷 FR", email: "contact@martin-renovation.fr", phone: "04 72 00 00 00", tva: "FR 40 732829320", logo: null, iban: "FR76 3000 6000 0112 3456 7890 189", bic: "AGRIFRPP", vatOnDebits: false };
const client = { type: "entreprise", name: "SCI Les Tilleuls", address: "8 avenue de la Gare", postalCode: "69100", city: "Villeurbanne", country: "🇫🇷 FR", email: "", phone: "", siret: "85332291500012", tva: "" };
// deno-lint-ignore no-explicit-any
const base = (extra: any) => ({ id: "doc_test", docNumber: "FAC-TEST", issueDate: "2026-09-26", currency: "EUR", dueDays: 30, company: { ...companyProfile }, client: { ...client }, operationCategory: "services", globalDiscount: 0, acompte: 0, notes: "", signature: null, status: "envoyée", createdAt: 1, updatedAt: 1, ...extra });
const line = { id: "l1", type: "line", designation: "Pose de carrelage", details: [], qty: 2, unit: "m²", unitPrice: 100, tva: 20, discount: 0 };
const assert = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); };
const between = (xml: string, tag: string) => { const m = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`).exec(xml); return m ? m[1] : null; };

Deno.test("avoir : code 381, facture d'origine (numéro + date 102) après la récapitulation, motif en note, en-tête AVOIR", async () => {
  texts.length = 0;
  const doc = base({ type: "avoir", docNumber: "AV-001", factureOrigineRef: "FAC-014", factureOrigineDate: "2026-08-02", motifAvoir: "Erreur de facturation", modeRemboursement: "Remboursement par virement", items: [line] });
  const { model, missing, warnings } = buildInvoiceModel(doc, companyProfile, "Chantiflow");
  assert(model, `modèle refusé : ${missing.join(" ; ")}`);
  assert(model!.typeCode === "381", `typeCode ${model!.typeCode}`);
  assert(model!.originalInvoice?.number === "FAC-014" && model!.originalInvoice?.date === "2026-08-02", "facture d'origine absente du modèle");
  assert(model!.notes.some((n) => n.includes("Motif de l'avoir : Erreur de facturation")), "motif absent des notes");
  assert(model!.payment.termsText.includes("Remboursement par virement"), `conditions : ${model!.payment.termsText}`);
  assert(!warnings.some((w) => w.includes("date de la facture d'origine")), "avertissement de date inattendu");
  const xml = buildCiiXml(model!);
  assert(between(xml, "ram:TypeCode") === "381", "TypeCode XML");
  const ref = /<ram:InvoiceReferencedDocument>\s*<ram:IssuerAssignedID>FAC-014<\/ram:IssuerAssignedID>\s*<ram:FormattedIssueDateTime>\s*<qdt:DateTimeString format="102">20260802<\/qdt:DateTimeString>/.exec(xml);
  assert(ref, "InvoiceReferencedDocument absent ou mal formé");
  assert(xml.indexOf("<ram:SpecifiedTradeSettlementHeaderMonetarySummation>") < xml.indexOf("<ram:InvoiceReferencedDocument>"), "InvoiceReferencedDocument doit suivre la récapitulation monétaire");
  assert(xml.indexOf("<ram:InvoiceReferencedDocument>") < xml.indexOf("</ram:ApplicableHeaderTradeSettlement>"), "InvoiceReferencedDocument doit être dans ApplicableHeaderTradeSettlement");
  assert(xml.includes('xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"'), "espace de noms qdt manquant");
  const pdf = await buildFacturXPdf(model!, xml, assets, new Date("2026-09-26T10:00:00Z"));
  assert(pdf.length > 1000, "PDF vide");
  assert(texts.includes("AVOIR N° AV-001"), "en-tête AVOIR absent");
  assert(texts.some((t) => t.startsWith("Facture d'origine : n° FAC-014 du 02/08/2026")), "ligne « Facture d'origine » absente");
  assert(!texts.some((t) => t.startsWith("Échéance")), "un avoir ne porte pas d'échéance");
});

Deno.test("avoir sans facture d'origine ni motif : refusé, informations manquantes listées", () => {
  const { model, missing } = buildInvoiceModel(base({ type: "avoir", items: [line] }), companyProfile, "Chantiflow");
  assert(model === null, "un avoir sans facture d'origine ne doit pas être exporté");
  assert(missing.some((m) => m.includes("facture d'origine")) && missing.some((m) => m.includes("motif")), `manquants : ${missing.join(" ; ")}`);
});

Deno.test("facture d'acompte : code 386, titre « Facture d'acompte », ligne d'acompte générée reprise", async () => {
  texts.length = 0;
  const doc = base({ type: "acompte", docNumber: "AC-001", items: [{ id: "acompte-line", type: "line", designation: "Acompte de 30 % sur le devis DEV-007", details: [], qty: 1, unit: "forfait", unitPrice: 300, tva: 20, discount: 0 }] });
  const { model, missing } = buildInvoiceModel(doc, companyProfile, "Chantiflow");
  assert(model, `modèle refusé : ${missing.join(" ; ")}`);
  assert(model!.typeCode === "386", `typeCode ${model!.typeCode}`);
  assert(model!.totals.grandTotal === 360 && model!.totals.duePayable === 360, `totaux ${JSON.stringify(model!.totals)}`);
  const xml = buildCiiXml(model!);
  assert(between(xml, "ram:TypeCode") === "386", "TypeCode XML");
  assert(!xml.includes("InvoiceReferencedDocument"), "pas de facture d'origine sur un acompte");
  await buildFacturXPdf(model!, xml, assets, new Date("2026-09-26T10:00:00Z"));
  assert(texts.includes("FACTURE D'ACOMPTE N° AC-001"), "en-tête FACTURE D'ACOMPTE absent");
});

Deno.test("situation valant facture : une ligne par poste au montant de cette situation, retenue de garantie en conditions, acompte versé prépayé, notes", async () => {
  texts.length = 0;
  // Marché 10 000 HT, avancement 30 % (cumul 3 000), déjà facturé 2 000 → cette situation 1 000 HT ; second poste à 0 (ignoré).
  const doc = base({
    type: "situation", docNumber: "SIT-003", vautFacture: true, numeroSituation: 2, periodeDebut: "2026-08-01", periodeFin: "2026-08-31", marcheNumero: "M-2026-1", objet: "Rénovation", retenueGarantiePct: 5, acompteVerse: 100, operationCategory: "",
    items: [
      { id: "s1", type: "line", designation: "Gros œuvre", qty: 1, unitPrice: 10000, tva: 20, avancementPct: 30, montantCumulePrecedent: 2000 },
      { id: "s2", type: "line", designation: "Peinture", qty: 1, unitPrice: 5000, tva: 20, avancementPct: 0, montantCumulePrecedent: 0 },
    ],
  });
  const { model, missing, warnings } = buildInvoiceModel(doc, companyProfile, "Chantiflow");
  assert(model, `modèle refusé : ${missing.join(" ; ")}`);
  assert(model!.typeCode === "380", `typeCode ${model!.typeCode}`);
  assert(model!.operationCategory === "services" && warnings.some((w) => w.includes("prestation de services")), "catégorie par défaut attendue avec avertissement");
  assert(model!.lines.length === 1 && model!.lines[0].name === "Gros œuvre" && model!.lines[0].lineTotal === 1000, `lignes : ${JSON.stringify(model!.lines)}`);
  assert(model!.totals.taxBasis === 1000 && model!.totals.taxTotal === 200 && model!.totals.grandTotal === 1200, `totaux ${JSON.stringify(model!.totals)}`);
  assert(model!.totals.prepaid === 100 && model!.totals.duePayable === 1100, `prépayé/net ${JSON.stringify(model!.totals)}`);
  assert(model!.payment.termsText.includes("retenue de garantie 5 % (60.00 EUR)") && model!.payment.termsText.includes("net à payer sur cette situation : 1040.00 EUR"), `conditions : ${model!.payment.termsText}`);
  assert(model!.notes.some((n) => n.startsWith("Situation de travaux n° 2 (du 01/08/2026 au 31/08/2026) — marché n° M-2026-1")), `notes : ${model!.notes.join(" | ")}`);
  assert(model!.notes.some((n) => n.includes("Montant du marché HT : 15000.00 EUR") && n.includes("déjà facturé avant cette situation : 2000.00 EUR")), `notes : ${model!.notes.join(" | ")}`);
  const xml = buildCiiXml(model!);
  assert(between(xml, "ram:TotalPrepaidAmount") === "100.00" && between(xml, "ram:DuePayableAmount") === "1100.00", "montants prépayé / net à payer XML");
  assert(between(xml, "ram:GrandTotalAmount") === "1200.00", "total TTC XML");
  await buildFacturXPdf(model!, xml, assets, new Date("2026-09-26T10:00:00Z"));
  assert(texts.includes("FACTURE N° SIT-003"), "en-tête FACTURE absent");
});

Deno.test("situation ne valant pas facture, devis : refusés", () => {
  const sit = buildInvoiceModel(base({ type: "situation", vautFacture: false, items: [] }), companyProfile, "Chantiflow");
  assert(sit.model === null && sit.missing.some((m) => m.includes("ne vaut pas facture")), "situation simple acceptée à tort");
  const devis = buildInvoiceModel(base({ type: "devis", items: [line] }), companyProfile, "Chantiflow");
  assert(devis.model === null, "devis accepté à tort");
});
