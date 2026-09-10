// Génère un Factur-X de test à partir d'une facture fictive, exactement
// comme la fonction serveur, mais en local (sans Supabase) :
//
//   npx deno run --allow-net --allow-read --allow-write supabase/functions/generate-facturx/exemple/generer-exemple.ts
//
// Résultat dans le sous-dossier out/ (PDF + XML), à faire vérifier par un
// validateur (Mustang, FNFE-MPE...) ou un expert-comptable.
import { buildInvoiceModel, buildCiiXml, buildFacturXPdf } from "../facturx.ts";

const outDir = new URL("./out/", import.meta.url);
await Deno.mkdir(outDir, { recursive: true });

const companyProfile = {
  type: "entreprise", name: "Martin Rénovation SARL", siret: "732 829 320 00074", address: "12 rue des Artisans",
  postalCode: "69003", city: "Lyon", country: "🇫🇷 FR", email: "contact@martin-renovation.fr", phone: "04 72 00 00 00",
  tva: "FR 40 732829320", logo: null, iban: "FR76 3000 6000 0112 3456 7890 189", bic: "AGRIFRPP", vatOnDebits: false,
};

const doc = {
  id: "doc_test", type: "facture", docNumber: "FAC-2026-014", issueDate: "2026-09-10", currency: "EUR",
  validityDays: 30, showValidity: true, dueDays: 30,
  company: { ...companyProfile },
  client: { type: "entreprise", name: "SCI Les Tilleuls", address: "8 avenue de la Gare", postalCode: "69100", city: "Villeurbanne", country: "🇫🇷 FR", email: "gestion@sci-tilleuls.fr", phone: "", siret: "552 032 802 00012", tva: "FR 62 552032802" },
  clientId: "cli_1", chantier: "Rénovation salle de bain — appartement 3B",
  operationCategory: "mixte", deliveryAddress: "8 avenue de la Gare, appartement 3B", deliveryPostalCode: "69100", deliveryCity: "Villeurbanne",
  items: [
    { id: "s1", type: "section", title: "Lot plomberie", subtitle: "" },
    { id: "l1", type: "line", designation: "Dépose ancienne baignoire et évacuation", details: [{ id: "d1", level: 1, text: "Protection des sols et **évacuation** en déchetterie", price: "", included: true, marker: "▪" }], qty: 1, unit: "forfait", unitPrice: 320, tva: 10, discount: 0 },
    { id: "l2", type: "line", designation: "Fourniture et pose receveur de douche extra-plat 90×120", details: [{ id: "d2", level: 1, text: "Receveur résine blanc", price: "410", included: true, marker: "▪" }, { id: "d3", level: 2, text: "Bonde extra-plate", price: "45", included: true, marker: "–" }], qty: 1, unit: "pièce", unitPrice: 380, tva: 10, discount: 5 },
    { id: "l3", type: "line", designation: "Faïence murale 30×60, pose droite", details: [], qty: 14.5, unit: "m²", unitPrice: 68, tva: 10, discount: 0 },
    { id: "l4", type: "line", designation: "Mitigeur thermostatique de douche (fourniture)", details: [], qty: 1, unit: "pièce", unitPrice: 245, tva: 20, discount: 0 },
    { id: "l5", type: "line", designation: "Main d'œuvre complémentaire", details: [], qty: 6, unit: "heure", unitPrice: 52, tva: 20, discount: 0 },
  ],
  globalDiscount: 2, acompte: 30, notes: "Merci de votre confiance.\nTravaux réalisés du 1er au 8 septembre 2026.",
  marginLegalMention: "", signature: { mode: "texte", name: "", image: null, drawing: null }, proforma: null,
  status: "envoyée", createdAt: Date.now(), updatedAt: Date.now(), isRecurring: false, remindersEnabled: true,
};

const { model, missing, warnings } = buildInvoiceModel(doc, companyProfile, "Chantiflow");
console.log("missing:", missing);
console.log("warnings:", warnings);
if (!model) Deno.exit(1);
console.log("totals:", model.totals);

const xml = buildCiiXml(model);
await Deno.writeTextFile(new URL("factur-x.xml", outDir), xml);
const pdf = await buildFacturXPdf(model, xml, {
  regularFont: await Deno.readFile(new URL("../assets/DejaVuSans.ttf", import.meta.url)),
  boldFont: await Deno.readFile(new URL("../assets/DejaVuSans-Bold.ttf", import.meta.url)),
  iccProfile: await Deno.readFile(new URL("../assets/sRGB-v2-micro.icc", import.meta.url)),
}, new Date("2026-09-10T18:00:00Z"));
await Deno.writeFile(new URL("Facture-FAC-2026-014-facturx.pdf", outDir), pdf);
console.log("PDF écrit :", pdf.length, "octets");
