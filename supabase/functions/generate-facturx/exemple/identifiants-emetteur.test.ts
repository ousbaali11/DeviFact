// Test Deno du correctif du 29/09/2026 (refus BR-CO-09 chez Super PDP) :
// les identifiants légaux de l'émetteur (SIRET, numéro de TVA) viennent de
// Mon entreprise quand elle les renseigne, la copie figée sur le document ne
// servant que de secours ; un numéro de TVA sans préfixe pays est bloquant,
// émetteur comme client, avec l'endroit où corriger.
//
//   npx deno test --allow-net supabase/functions/generate-facturx/exemple/identifiants-emetteur.test.ts
import { buildInvoiceModel, buildCiiXml } from "../facturx.ts";

const assert = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); };
const profile = { type: "entreprise", name: "Stratos consulting", siret: "99059749400014", address: "16 rue d'Arras", postalCode: "57600", city: "Forbach", country: "🇫🇷 FR", email: "", phone: "", tva: "FR324324523532523", logo: null, iban: "", bic: "", vatOnDebits: false };
// Identifiants de bac à sable (le client porte une adresse de test, pas un SIRET).
const opts = { sandboxIds: { seller: "315143296_106843", buyer: "315143296_106842" } };
const line = { id: "l1", type: "line", designation: "Pose", details: [], qty: 1, unit: "u", unitPrice: 100, tva: 20, discount: 0 };
// deno-lint-ignore no-explicit-any
const doc = (companyCopy: any, clientTva: string) => ({
  id: "doc_test", type: "facture", docNumber: "FAC-026", issueDate: "2026-09-29", currency: "EUR", dueDays: 30, operationCategory: "services", status: "envoyée", globalDiscount: 0, acompte: 0, notes: "", signature: null, createdAt: 1, updatedAt: 1, items: [line],
  company: { ...profile, ...companyCopy },
  client: { type: "entreprise", name: "Tricatel", address: "1 rue du Test", postalCode: "75001", city: "Paris", country: "🇫🇷 FR", email: "", phone: "", siret: "0225:315143296_106842", tva: clientTva },
});

Deno.test("copie périmée sur la facture (TVA sans FR) : Mon entreprise à jour l'emporte, avertissement, XML avec FR", () => {
  const { model, missing, warnings } = buildInvoiceModel(doc({ tva: "324324523532523" }, "FR12345678901"), profile, "Chantiflow", opts);
  assert(model, `modèle refusé : ${missing.join(" ; ")}`);
  assert(model!.seller.vatId === "FR324324523532523", `TVA émetteur : ${model!.seller.vatId}`);
  assert(warnings.some((w) => w.includes("numéro de TVA de la fiche à jour retenu (FR324324523532523)") && w.includes("(324324523532523)")), `avertissements : ${warnings.join(" | ")}`);
  const xml = buildCiiXml(model!);
  const seller = /<ram:SellerTradeParty>[\s\S]*?<\/ram:SellerTradeParty>/.exec(xml)![0];
  assert(seller.includes('<ram:ID schemeID="VA">FR324324523532523</ram:ID>'), "XML vendeur sans le numéro à jour");
  assert(!xml.includes("TaxRepresentative"), "aucun représentant fiscal attendu");
});

Deno.test("SIRET : idem, la fiche à jour l'emporte sur la copie ; copie identique à des espaces près : aucun avertissement", () => {
  const a = buildInvoiceModel(doc({ siret: "73282932000074" }, "FR12345678901"), profile, "Chantiflow", opts);
  assert(a.model, `modèle refusé : ${a.missing.join(" ; ")}`); // en bac à sable, aucun SIRET réel dans le modèle (voir applySandboxId)
  assert(a.warnings.some((w) => w.includes("SIRET de la fiche à jour retenu")), "avertissement SIRET attendu");
  const b = buildInvoiceModel(doc({ tva: "fr 324 324 523 532 523", siret: "990 597 494 00014" }, "FR12345678901"), profile, "Chantiflow", opts);
  assert(!b.warnings.some((w) => w.includes("fiche à jour retenu")), `avertissement inattendu : ${b.warnings.join(" | ")}`);
});

Deno.test("numéro de TVA sans préfixe pays : bloquant, émetteur (Mon entreprise) comme client (facture)", () => {
  const seller = buildInvoiceModel(doc({ tva: "324324523532523" }, "FR12345678901"), { ...profile, tva: "324324523532523" }, "Chantiflow", opts);
  assert(seller.model === null, "émetteur sans préfixe accepté à tort");
  assert(seller.missing.some((m) => m.startsWith("Émetteur : numéro de TVA sans préfixe pays") && m.includes("à corriger dans Mon entreprise")), `manquants : ${seller.missing.join(" ; ")}`);
  const buyer = buildInvoiceModel(doc({}, "12345678901"), profile, "Chantiflow", opts);
  assert(buyer.model === null, "client sans préfixe accepté à tort");
  assert(buyer.missing.some((m) => m.startsWith("Client : numéro de TVA sans préfixe pays") && m.includes("champ TVA du client")), `manquants : ${buyer.missing.join(" ; ")}`);
  // Sans fiche à jour (profil vide) : la copie du document sert de secours.
  const fallback = buildInvoiceModel(doc({ tva: "FR324324523532523" }, "FR12345678901"), null, "Chantiflow", opts);
  assert(fallback.model?.seller.vatId === "FR324324523532523", "copie du document non reprise en secours");
});

Deno.test("bac à sable : identifiant légal = numéro d'entreprise de test, adresse électronique = entrée d'annuaire, aucun SIRET réel", () => {
  const { model, missing } = buildInvoiceModel(doc({}, "FR12345678901"), profile, "Chantiflow", { sandboxIds: { seller: "315143296_106843", sellerNumber: "000000002", buyer: "315143296_106842", buyerNumber: "000000001" } });
  assert(model, `modèle refusé : ${missing.join(" ; ")}`);
  assert(model!.seller.siren === "000000002" && model!.seller.siret === null && model!.seller.electronicId === "315143296_106843", `vendeur : ${JSON.stringify({ siren: model!.seller.siren, siret: model!.seller.siret, electronicId: model!.seller.electronicId })}`);
  assert(model!.buyer.siren === "000000001" && model!.buyer.electronicId === "315143296_106842", "client : numéro de test attendu");
  const xml = buildCiiXml(model!);
  const seller = /<ram:SellerTradeParty>[\s\S]*?<\/ram:SellerTradeParty>/.exec(xml)![0];
  assert(seller.includes('<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">000000002</ram:ID>'), "BT-30 du vendeur");
  assert(seller.includes('<ram:URIID schemeID="0225">315143296_106843</ram:URIID>'), "adresse électronique du vendeur");
  assert(!seller.includes('schemeID="0009"'), "SIRET réel présent dans le XML de bac à sable");
  // Sans numéro connu : le préfixe de l'adresse reste utilisé (comportement d'avant).
  const sans = buildInvoiceModel(doc({}, "FR12345678901"), profile, "Chantiflow", opts);
  assert(sans.model?.seller.siren === "315143296" && sans.model?.buyer.siren === "315143296", "repli sur le préfixe attendu");
});
