// @vitest-environment jsdom
// Harnais de mesure (étape B) : écrit dans le dossier de travail temporaire
// une page HTML statique contenant le PDF d'une facture longue, avec et sans
// le bloc de mentions légales, pour mesurer la hauteur réelle dans un vrai
// navigateur (jsdom ne calcule pas les hauteurs). Ne fait échouer aucun test.
import { it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import { PrintDocument, computeTotals, newDocument, emptyCompanyProfile } from "./App.jsx";

it("génère le harnais de mesure", () => {
  const outDir = process.env.DF_MEASURE_DIR;
  if (!outDir) return;
  const profile = { ...emptyCompanyProfile(), name: "Bâti Plus", siret: "12345678900012", address: "1 rue des Lilas", postalCode: "69000", city: "Lyon", phone: "04 00 00 00 00", email: "contact@batiplus.fr", tva: "FR12345678900", legalForm: "SARL", capital: "5 000 €", registration: "RCS Lyon 123 456 789", insuranceName: "SMABTP", insurancePolicy: "P-42", insuranceZone: "France métropolitaine", mediatorName: "CM2C", mediatorContact: "https://cm2c.net" };
  const details = (n) => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, level: 1, text: `Sous-détail ${i + 1} : fourniture et pose`, price: 0, included: true, marker: "" }));
  // Forme du document réel le plus long en production : 5 lignes, 13 sous-détails.
  const realistic = (type) => ({ ...newDocument(type, []), docNumber: `${type.toUpperCase()}-011`, company: { ...profile }, client: { type: "particulier", name: "Mme Martin", address: "2 avenue du Port", postalCode: "13000", city: "Marseille", email: "m@exemple.fr", phone: "06" }, notes: "Merci de votre confiance.", signature: { mode: "texte", name: "Mme Martin" },
    items: [0, 1, 2, 3, 4].map((i) => ({ id: `l${i}`, type: "line", designation: `Poste ${i + 1} — carrelage et faïence`, details: details(i < 3 ? 3 : 2), qty: 10, unit: "m²", unitPrice: 45, tva: 10, discount: 0 })) });
  // Document synthétique long : 14 lignes avec 2 sous-détails chacune.
  const long = (type) => ({ ...realistic(type), docNumber: `${type.toUpperCase()}-LONG`, client: { ...realistic(type).client, type: "entreprise" }, items: Array.from({ length: 14 }, (_, i) => ({ id: `l${i}`, type: "line", designation: `Poste ${i + 1}`, details: details(2), qty: 1, unit: "forfait", unitPrice: 100, tva: 20, discount: 0 })) });
  const cases = [["facture-reelle", realistic("facture")], ["devis-reel", realistic("devis")], ["facture-longue", long("facture")], ["acompte-long", long("acompte")]];
  const blocks = cases.map(([name, d]) => `<h2>${name}</h2><div class="wrap" data-name="${name}">${renderToStaticMarkup(<PrintDocument doc={d} totals={computeTotals(d)} siteSettings={{ name: "Chantiflow" }} watermarkEnabled={false} companyProfile={profile} />)}</div>`).join("\n");
  const page = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Space+Grotesk:wght@700&family=IBM+Plex+Mono&display=swap"><style>body{margin:16px;background:#ddd;font-family:Inter,sans-serif} .wrap{margin-bottom:24px} h2{font:14px sans-serif}</style></head><body>${blocks}</body></html>`;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/mesure-mentions-legales.html`, page);
});
