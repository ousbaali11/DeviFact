// pdp-rules.js — règles d'éligibilité d'une facture à l'envoi via Super PDP,
// statuts et verrou de contenu, côté site. MÊMES règles que
// supabase/functions/_shared/superpdp-rules.ts (test de parité
// src/superpdp-envoi.test.jsx) : le serveur reste juge, le site ne fait
// qu'afficher l'entrée du menu quand elle a un sens.

export const PDP_FINAL_FAILURES = ["api:invalid", "api:rejected", "fr:210", "fr:213", "fr:501", "error"];
export const PDP_EDITABLE_KEYS = ["status", "paidAt", "paidTotal", "payments", "workStage", "lastReminderSentAt", "remindersEnabled", "pdp", "conflict", "updatedAt"];
export const PDP_STATUS_LABELS = {
  "api:sending": "Envoi en cours", "api:uploaded": "Déposée chez Super PDP", "api:validated": "Validée", "api:invalid": "Fichier refusé",
  "api:sent": "Transmise", "api:rejected": "Rejetée par la plateforme du client", "api:received": "Reçue", "api:acknowledged": "Accusé de réception", "api:accepted": "Acceptée",
  "fr:200": "Déposée", "fr:201": "Émise", "fr:202": "Reçue", "fr:203": "Mise à disposition", "fr:204": "Prise en charge", "fr:205": "Approuvée", "fr:206": "Approuvée partiellement",
  "fr:207": "En litige", "fr:208": "Suspendue", "fr:209": "Complétée", "fr:210": "Refusée", "fr:211": "Paiement transmis", "fr:212": "Encaissée", "fr:213": "Rejetée", "fr:501": "Irrecevable",
  error: "Envoi en échec",
};

const countryCode = (v) => { const m = /([A-Za-z]{2})\s*$/.exec(String(v || "")); return m ? m[1].toUpperCase() : null; };
export function sirenOfSiret(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 9 || digits.length === 14 ? digits.slice(0, 9) : null;
}
export function sandboxIdentifierOf(value) {
  const m = /^(?:0225:)?(\d{9})_(\d{1,12})$/.exec(String(value ?? "").trim());
  return m ? { id: `${m[1]}_${m[2]}`, siren: m[1] } : null;
}
export function pdpStatusLabel(pdp) {
  if (!pdp || !pdp.status) return "";
  return PDP_STATUS_LABELS[pdp.status] || pdp.statusText || pdp.status;
}
export function pdpCanResend(pdp) {
  if (!pdp || !pdp.status) return true;
  if (pdp.status === "api:sending") return false;
  return PDP_FINAL_FAILURES.includes(pdp.status);
}
export function pdpLocksContent(pdp) {
  return !!pdp && !!pdp.invoiceId && !PDP_FINAL_FAILURES.includes(String(pdp.status || ""));
}
export function pdpBlockedKeys(patch) {
  return Object.keys(patch || {}).filter((k) => !PDP_EDITABLE_KEYS.includes(k));
}
// Événements Super PDP (identifiants strictement croissants) : dernier
// événement par facture, et plus grand identifiant lu.
export function applyPdpEvents(events) {
  const byInvoice = new Map();
  let lastEventId = 0;
  for (const e of [...(events || [])].sort((a, b) => Number(a.id) - Number(b.id))) {
    const id = Number(e?.id), invoiceId = Number(e?.invoice_id);
    if (!Number.isFinite(id) || !Number.isFinite(invoiceId) || !e?.status_code) continue;
    lastEventId = Math.max(lastEventId, id);
    const status = String(e.status_code);
    byInvoice.set(invoiceId, { invoiceId, status, statusText: PDP_STATUS_LABELS[status] || String(e.status_text || status), reason: e.status_text ? String(e.status_text) : null, lastEventId: id, lastEventAt: e.created_at ? String(e.created_at) : null });
  }
  return { updates: [...byInvoice.values()], lastEventId };
}
// Pièces transmissibles via Super PDP : facture, facture d'acompte, avoir
// (un avoir B2B se transmet comme une facture) et situation de travaux
// valant facture. Un devis, une proforma ou une situation « simple » : non.
export function pdpTransmissibleType(doc) {
  if (!doc) return false;
  if (doc.type === "situation") return doc.vautFacture === true;
  return doc.type === "facture" || doc.type === "acompte" || doc.type === "avoir";
}
// Encaissement (fr:212) : une seule fois, pour une pièce transmise (non en
// échec) passée « payée » en totalité — facture, facture d'acompte ou
// situation valant facture ; jamais pour un avoir ni un paiement partiel.
export function shouldSendPaidEvent(doc) {
  if (!doc || !pdpTransmissibleType(doc) || doc.type === "avoir" || doc.status !== "payée") return false;
  const pdp = doc.pdp;
  if (!pdp || !pdp.invoiceId || pdp.paidEventAt) return false;
  return !PDP_FINAL_FAILURES.includes(String(pdp.status || ""));
}
export function pdpEligibility(doc, ctx) {
  const no = (code, reason) => ({ ok: false, code, reason });
  if (doc && doc.type === "situation" && doc.vautFacture !== true) return no("type", "Cette situation ne vaut pas facture : coche « Vaut facture » pour la transmettre via Super PDP.");
  if (!pdpTransmissibleType(doc)) return no("type", "Seuls les factures, factures d'acompte, avoirs et situations valant facture se transmettent via Super PDP.");
  if (!doc.status || doc.status === "brouillon") return no("brouillon", "Une facture en brouillon ne se transmet pas : passe-la d'abord en « envoyée ».");
  if ((doc.client?.type || "entreprise") === "particulier") return no("particulier", "Client particulier : la facture électronique B2B ne s'applique pas, le PDF classique suffit.");
  if (countryCode(doc.client?.country) !== "FR") return no("etranger", "Client établi hors de France : cette vente relève du e-reporting, pas de la transmission B2B.");
  if ((ctx.companyCountryCode || "").toUpperCase() !== "FR") return no("entreprise-pays", "Réservé aux entreprises dont le pays (Mon entreprise) est la France.");
  if (!ctx.connected) return no("non-connecte", "Aucun compte Super PDP connecté : connecte-le depuis Mon entreprise.");
  if (ctx.verificationStatus && ctx.verificationStatus !== "verified") return no("non-verifie", `Entreprise pas encore vérifiée chez Super PDP (${ctx.verificationStatus}).`);
  if (ctx.env === "production" && !ctx.allowProduction) return no("production", "Compte Super PDP en production : les envois réels ne sont pas encore autorisés dans Chantiflow.");
  const sandbox = ctx.env !== "production";
  if (sandbox ? !sandboxIdentifierOf(doc.client?.siret) && !sirenOfSiret(doc.client?.siret) : !sirenOfSiret(doc.client?.siret)) return no("siret", sandbox ? "Client sans identifiant : en bac à sable, renseigne dans le champ SIRET de la fiche client l'identifiant de test Super PDP (ex. 315143296_106842)." : "Client sans SIRET : renseigne le SIRET (14 chiffres) sur la fiche client.");
  if (!pdpCanResend(doc.pdp)) return no("deja-envoyee", doc.pdp?.status === "api:sending" ? "Envoi déjà en cours." : `Facture déjà transmise via Super PDP (${pdpStatusLabel(doc.pdp)}).`);
  return { ok: true, code: null, reason: null };
}

// Reprise sur erreur (étape 4, 30/09/2026) : résumé d'un échec final pour le
// bandeau de rejet — titre, motif (message d'envoi ou raison transmise par
// Super PDP avec l'événement), numéro de la tentative qui a échoué.
export const PDP_FAILURE_TITLES = { "api:invalid": "Fichier refusé par la validation", "api:rejected": "Rejetée par la plateforme du client", "fr:210": "Refusée par le client", "fr:213": "Rejetée", "fr:501": "Irrecevable", error: "Envoi en échec" };
export function pdpFailureSummary(pdp) {
  if (!pdp || !PDP_FINAL_FAILURES.includes(String(pdp.status || ""))) return null;
  const status = String(pdp.status);
  const reason = String(pdp.error || pdp.reason || "").trim();
  return { status, title: PDP_FAILURE_TITLES[status] || pdpStatusLabel(pdp), reason: reason ? translatePdpMessage(reason) : null, attempt: Number(pdp.attempt) || 1 };
}
// Identifiant externe d'une tentative d'envoi (36 caractères au plus chez
// Super PDP) : identifiant de la pièce, suffixé du numéro à partir de la
// deuxième tentative pour ne jamais confondre deux dépôts.
export function pdpExternalId(documentId, attempt) {
  const n = Number(attempt) || 1;
  const suffix = n > 1 ? `-${n}` : "";
  return `${String(documentId || "").slice(0, 36 - suffix.length)}${suffix}`;
}

// ---------------------------------------------------------------------------
// Messages en français (étape 4, chantier 3, 30/09/2026). Les textes de
// Super PDP (API, événements, page d'autorisation) et les règles de
// validation du fichier arrivent en anglais : traduction des cas connus avec
// la marche à suivre, texte d'origine conservé sinon (préfixé) et toujours
// gardé dans le journal. Le glossaire se complète au fil des retours.
// ---------------------------------------------------------------------------
export const PDP_MESSAGE_TRANSLATIONS = [
  { test: /application environment do(?:es)? not match company environ/i, fr: "L'application Chantiflow et l'entreprise choisie chez Super PDP ne sont pas dans le même environnement (bac à sable ou production). En bac à sable, choisis l'entreprise de test (Burger Queen) sur la page d'autorisation." },
  { test: /liée à cette session ne correspond pas au vendeur/i, fr: "Le vendeur du fichier n'est pas l'entreprise connectée chez Super PDP : déconnecte puis reconnecte le bon compte depuis Mon entreprise." },
  { test: /company_verification_status|company (?:is )?not verified|kyb|verification (?:is )?pending/i, fr: "Entreprise pas encore vérifiée chez Super PDP : l'envoi sera possible une fois la vérification terminée." },
  { test: /invalid_grant|invalid refresh token|refresh token .*(?:revoked|expired)|token (?:has )?(?:been )?(?:revoked|expired)|session .*(?:revoked|expired)|\bunauthorized\b/i, fr: "Session Super PDP expirée ou révoquée : reconnecte le compte depuis Mon entreprise." },
  { test: /not (?:found )?in (?:the )?directory|no directory entry|unknown recipient|recipient .*not found/i, fr: "Le destinataire n'est pas inscrit à l'annuaire de la facturation électronique : il doit d'abord y être inscrit par sa plateforme ou son SIE." },
  { test: /external_id .*(?:already|exists|taken)|duplicate (?:external_id|invoice)/i, fr: "Un dépôt avec le même identifiant existe déjà chez Super PDP : relance l'envoi, une nouvelle tentative reçoit un identifiant différent." },
  { test: /too many requests|rate limit/i, fr: "Trop de demandes en peu de temps chez Super PDP : réessaie dans un instant." },
  { test: /invalid (?:pdf|xml)|not a valid (?:pdf|xml|factur-x)|unable to parse|malformed|could not (?:read|parse)/i, fr: "Fichier illisible pour Super PDP (PDF ou XML invalide) : régénère le fichier Factur-X et réessaie." },
  { test: /refused by (?:the )?buyers*:?s*(.*)/i, fr: (m) => `Refusée par le client${m[1] ? ` : ${m[1].trim()}` : "."}` },
  { test: /rejected by (?:the )?(?:recipient|buyer) platforms*:?s*(.*)/i, fr: (m) => `Rejetée par la plateforme du client${m[1] ? ` : ${m[1].trim()}` : "."}` },
];
// Glossaire des règles de validation EN 16931 / Factur-X / profil français :
// phrase d'action en français. Règles rencontrées ou prévisibles ; à compléter.
export const PDP_RULE_GLOSSARY = {
  "BR-01": "Le fichier doit indiquer la version de la norme (identifiant de spécification).",
  "BR-02": "Numéro de facture manquant.",
  "BR-03": "Date d'émission manquante.",
  "BR-04": "Type de pièce manquant (facture, avoir, acompte).",
  "BR-05": "Devise manquante.",
  "BR-06": "Nom de l'émetteur manquant (Mon entreprise).",
  "BR-07": "Nom du client manquant.",
  "BR-08": "Adresse de l'émetteur manquante.",
  "BR-09": "Pays de l'émetteur manquant (Mon entreprise).",
  "BR-10": "Adresse du client manquante.",
  "BR-11": "Pays du client manquant (fiche client).",
  "BR-16": "La pièce doit contenir au moins une ligne.",
  "BR-21": "Chaque ligne doit avoir un identifiant.",
  "BR-22": "Chaque ligne doit avoir une quantité.",
  "BR-23": "Chaque ligne doit avoir une unité.",
  "BR-24": "Chaque ligne doit avoir un montant HT.",
  "BR-25": "Chaque ligne doit avoir une désignation.",
  "BR-26": "Chaque ligne doit avoir un prix unitaire.",
  "BR-27": "Le prix unitaire d'une ligne ne peut pas être négatif.",
  "BR-28": "Le prix brut d'une ligne ne peut pas être négatif.",
  "BR-29": "La date de fin de période doit suivre la date de début.",
  "BR-53": "La devise de la TVA doit être indiquée quand elle diffère de celle de la facture.",
  "BR-CO-03": "Une date de TVA exigible est requise pour la catégorie de TVA utilisée.",
  "BR-CO-04": "Chaque ligne doit porter une catégorie de TVA.",
  "BR-CO-09": "Le numéro de TVA de l'émetteur ou du client doit commencer par le code pays sur deux lettres (ex. FR12345678901) : à corriger dans Mon entreprise ou sur la fiche client.",
  "BR-CO-10": "Le total HT des lignes doit être égal à la somme des lignes (arrondi au centime).",
  "BR-CO-11": "Le total des remises doit être égal à la somme des remises.",
  "BR-CO-12": "Le total des majorations doit être égal à la somme des majorations.",
  "BR-CO-13": "Le total HT doit être égal au total des lignes moins les remises plus les majorations.",
  "BR-CO-14": "Le total de TVA doit être égal à la somme des TVA par taux.",
  "BR-CO-15": "Le total TTC doit être égal au total HT plus la TVA.",
  "BR-CO-16": "Le net à payer doit être égal au total TTC moins le montant déjà payé (acompte).",
  "BR-CO-17": "Le montant de TVA d'un taux doit être égal à la base multipliée par le taux.",
  "BR-CO-18": "Chaque taux de TVA utilisé doit avoir sa ligne de ventilation.",
  "BR-CO-19": "Une période de facturation doit avoir une date de début ou de fin.",
  "BR-CO-25": "Une facture avec un montant à payer doit indiquer une date d'échéance ou des conditions de paiement.",
  "BR-CO-26": "L'émetteur doit avoir un identifiant : SIRET ou SIREN dans Mon entreprise.",
  "BR-S-01": "Une ligne au taux normal exige la ventilation de TVA correspondante.",
  "BR-S-02": "Une ligne au taux normal exige le numéro de TVA de l'émetteur (Mon entreprise).",
  "BR-S-05": "Une ligne au taux normal doit avoir un taux supérieur à zéro.",
  "BR-S-08": "La base de chaque taux de TVA doit être la somme des lignes à ce taux.",
  "BR-S-09": "Le montant de TVA d'un taux doit être égal à la base multipliée par le taux.",
  "BR-E-02": "Une ligne exonérée exige le numéro de TVA de l'émetteur.",
  "BR-E-10": "Une ligne exonérée exige un motif d'exonération (bloc « Facturation électronique »).",
  "BR-AE-02": "L'autoliquidation exige les numéros de TVA de l'émetteur et du client.",
  "BR-AE-10": "L'autoliquidation exige le motif « Autoliquidation ».",
  "BR-IC-02": "Une livraison intracommunautaire exige les numéros de TVA de l'émetteur et du client.",
  "BR-G-02": "Une exportation exige le numéro de TVA de l'émetteur.",
  "BR-Z-01": "Une ligne à 0 % exige la ventilation de TVA correspondante.",
  "BR-DEC-12": "Les montants HT doivent avoir au plus deux décimales.",
  "BR-DEC-13": "Le total HT doit avoir au plus deux décimales.",
  "BR-DEC-14": "Le total TTC doit avoir au plus deux décimales.",
  "BR-DEC-18": "Le net à payer doit avoir au plus deux décimales.",
  "BR-CL-01": "Le type de pièce doit être un code reconnu (380 facture, 381 avoir, 386 acompte).",
  "BR-CL-03": "La devise doit être un code ISO reconnu (EUR).",
  "BR-CL-10": "L'identifiant de l'émetteur doit utiliser un schéma reconnu (SIREN 0002, SIRET 0009).",
  "BR-CL-14": "Le pays de l'émetteur doit être un code ISO à deux lettres.",
  "BR-CL-15": "Le pays du client doit être un code ISO à deux lettres.",
  "BR-CL-23": "Le code d'unité d'une ligne doit être un code reconnu.",
  "BR-CL-25": "L'adresse électronique de l'émetteur doit utiliser un schéma reconnu (0225 pour la France).",
  "BR-CL-26": "L'adresse électronique du client doit utiliser un schéma reconnu (0225 pour la France).",
  "BR-FR-01": "Le SIREN de l'émetteur est obligatoire pour une entreprise française (Mon entreprise).",
  "BR-FR-02": "Le SIREN du client est obligatoire pour un client professionnel français (fiche client).",
  "BR-FR-03": "L'adresse électronique de l'émetteur est obligatoire pour la France.",
  "BR-FR-04": "L'adresse électronique du client est obligatoire pour la France.",
  "BR-FR-10": "La catégorie d'opération (biens, services, mixte) est obligatoire : bloc « Facturation électronique ».",
  "BR-FR-20": "Une facture d'acompte doit référencer le devis ou la commande.",
  "BR-FR-21": "Un avoir doit référencer la facture d'origine (numéro et date).",
};
// Identifiant de règle dans un message de validation : « [BR-CO-09] … » ou « BR-CO-09 … ».
export function pdpRuleOf(text) {
  const m = /\[?\b(BR-[A-Z]{0,3}-?\d{1,3}|BR-[A-Z]+-\d{1,3})\b\]?/.exec(String(text ?? ""));
  return m ? m[1] : null;
}
// Un échec de validation → phrase française du glossaire (identifiant de la
// règle conservé entre crochets), ou repli explicite quand la règle est inconnue.
export function explainValidationFailure(text) {
  const raw = String(text ?? "").trim();
  const rule = pdpRuleOf(raw);
  if (!rule) return raw;
  const known = PDP_RULE_GLOSSARY[rule];
  if (known) return `[${rule}] ${known}`;
  const rest = raw.replace(new RegExp("^\\[?" + rule + "\\]?\\s*:?\\s*"), "").trim();
  return `[${rule}] Règle non respectée${rest ? ` : ${rest}` : ""}`;
}
// Message de Super PDP (API, événement, autorisation) → phrase française
// connue, sinon règles de validation expliquées, sinon texte d'origine préfixé.
export function translatePdpMessage(raw, status = null) {
  const text = String(raw ?? "").trim();
  for (const t of PDP_MESSAGE_TRANSLATIONS) { const m = t.test.exec(text); if (m) return typeof t.fr === "function" ? t.fr(m) : t.fr; }
  if (status === 429) return "Trop de demandes en peu de temps chez Super PDP : réessaie dans un instant.";
  if (status !== null && status >= 500) return `Panne temporaire chez Super PDP (réponse ${status}) : réessaie dans quelques minutes.`;
  if (status === 401 || status === 403) return "Session Super PDP expirée ou révoquée : reconnecte le compte depuis Mon entreprise.";
  if (!text) return status ? `Super PDP a répondu ${status} sans détail.` : "Super PDP n'a pas donné de détail.";
  if (pdpRuleOf(text)) return text.split(/\s*;\s*/).map((part) => explainValidationFailure(part)).join(" ; ");
  if (/^(?:Super PDP|Le |La |Les |L'|Un |Une |Bac à sable|Entreprise|Client|Émetteur|Session|Trop|Panne|Fichier)/.test(text)) return text; // déjà en français
  return `Super PDP indique : ${text}`;
}
