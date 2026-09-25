// Test Deno de la mise en page du PDF Factur-X : aucun trait horizontal ne
// doit traverser un texte (bug du 26/09/2026 : le séparateur de chaque ligne
// du tableau était dessiné 2 points au-dessus de la ligne de base de la ligne
// suivante, qui apparaissait barrée sur toute facture à plusieurs lignes).
//
//   npx deno test --allow-net supabase/functions/generate-facturx/exemple/mise-en-page.test.ts
//
// Méthode : on enregistre chaque texte et chaque trait horizontal dessinés
// par pdf-lib, puis on vérifie qu'aucun trait ne passe entre la ligne de base
// d'un texte et le haut de ses lettres.
import { PDFPage } from "https://esm.sh/pdf-lib@1.17.1";
import { buildInvoiceModel, buildCiiXml, buildFacturXPdf } from "../facturx.ts";
import { FONT_REGULAR_B64, FONT_BOLD_B64, ICC_PROFILE_B64, decodeBase64 } from "../assets-embarques.ts";

type Drawn = { kind: "text" | "line"; page: number; y: number; size?: number; s?: string };
const drawn: Drawn[] = [];
let pageNo = 0;
const pages = new WeakMap<object, number>();
const pageOf = (p: object) => { if (!pages.has(p)) pages.set(p, ++pageNo); return pages.get(p)!; };
const origText = PDFPage.prototype.drawText;
const origLine = PDFPage.prototype.drawLine;
// deno-lint-ignore no-explicit-any
PDFPage.prototype.drawText = function (this: any, s: string, opts: any) { drawn.push({ kind: "text", page: pageOf(this), y: opts?.y ?? 0, size: opts?.size ?? 12, s }); return origText.call(this, s, opts); };
// deno-lint-ignore no-explicit-any
PDFPage.prototype.drawLine = function (this: any, opts: any) { if (opts.start.y === opts.end.y) drawn.push({ kind: "line", page: pageOf(this), y: opts.start.y }); return origLine.call(this, opts); };

const companyProfile = { type: "entreprise", name: "Martin Rénovation SARL", siret: "732 829 320 00074", address: "12 rue des Artisans", postalCode: "69003", city: "Lyon", country: "🇫🇷 FR", email: "contact@martin-renovation.fr", phone: "04 72 00 00 00", tva: "FR 40 732829320", logo: null, iban: "FR76 3000 6000 0112 3456 7890 189", bic: "AGRIFRPP", vatOnDebits: false };
// deno-lint-ignore no-explicit-any
const line = (id: string, designation: string, extra: any = {}) => ({ id, type: "line", designation, details: [], qty: 1, unit: "u", unitPrice: 100, tva: 20, discount: 0, ...extra });
// deno-lint-ignore no-explicit-any
const scenarios: Record<string, any[]> = {
  "4 produits courts": [line("l1", "Carrelage 60x60"), line("l2", "Colle flex"), line("l3", "Joint gris"), line("l4", "Plinthes")],
  "4 produits, une désignation longue": [line("l1", "Carrelage 60x60"), line("l2", "Fourniture et pose de carrelage grès cérame rectifié 60x60 finition mate, coloris gris anthracite, pose droite avec joints de 2 mm"), line("l3", "Joint gris"), line("l4", "Plinthes")],
  "4 produits avec sous-détails": [line("l1", "Carrelage 60x60", { details: [{ id: "d1", level: 1, text: "Grès cérame", price: "", included: true, marker: "▪" }] }), line("l2", "Colle flex", { details: [{ id: "d2", level: 1, text: "Sac 25 kg", price: "12", included: true }] }), line("l3", "Joint gris"), line("l4", "Plinthes")],
  "4 produits, quantités et unités variées": [line("l1", "Carrelage 60x60", { qty: 24.5, unit: "m²" }), line("l2", "Colle flex", { qty: 6, unit: "sac" }), line("l3", "Main d'œuvre", { qty: 12, unit: "heure", unitPrice: 45 }), line("l4", "Plinthes", { qty: 30, unit: "ml", unitPrice: 8.5 })],
  "30 lignes (changement de page)": Array.from({ length: 30 }, (_, i) => line(`l${i}`, `Poste ${i + 1}`, { unitPrice: 10 + i })),
};
const assets = { regularFont: decodeBase64(FONT_REGULAR_B64), boldFont: decodeBase64(FONT_BOLD_B64), iccProfile: decodeBase64(ICC_PROFILE_B64) };

for (const [name, items] of Object.entries(scenarios)) {
  Deno.test(`aucun texte barré — ${name}`, async () => {
    drawn.length = 0; pageNo = 0;
    const doc = { id: "doc_test", type: "facture", docNumber: "FAC-TEST", issueDate: "2026-09-26", currency: "EUR", dueDays: 30, company: { ...companyProfile }, client: { type: "entreprise", name: "SCI Les Tilleuls", address: "8 avenue de la Gare", postalCode: "69100", city: "Villeurbanne", country: "🇫🇷 FR", email: "", phone: "", siret: "85332291500012", tva: "" }, operationCategory: "biens", items, globalDiscount: 0, acompte: 0, notes: "", signature: null, status: "envoyée", createdAt: 1, updatedAt: 1 };
    const { model, missing } = buildInvoiceModel(doc, companyProfile, "Chantiflow");
    if (!model) throw new Error(`modèle refusé : ${missing.join(" ; ")}`);
    await buildFacturXPdf(model, buildCiiXml(model), assets, new Date("2026-09-26T10:00:00Z"));
    const texts = drawn.filter((d) => d.kind === "text");
    const lines = drawn.filter((d) => d.kind === "line");
    const hits: string[] = [];
    for (const ln of lines) for (const t of texts) {
      if (t.page !== ln.page) continue;
      if (ln.y > t.y + 0.5 && ln.y < t.y + (t.size || 9) * 0.7) hits.push(`page ${t.page} : trait à y=${ln.y.toFixed(1)} traverse « ${t.s} » (base y=${t.y.toFixed(1)})`);
    }
    if (hits.length) throw new Error(`${hits.length} texte(s) barré(s) :\n${hits.slice(0, 6).join("\n")}`);
    if (!texts.some((t) => t.s === "Plinthes" || t.s === "Poste 30")) throw new Error("la dernière ligne n'a pas été dessinée");
  });
}
