// bank-matching.js — Rapprochement bancaire, livraison 1.
//
// Fonctions pures, sans React ni base de données (testées seules dans
// src/bank-matching.test.js) :
//   * lecture d'un relevé bancaire : CSV (exports des banques françaises,
//     séparateur ; ou , ou tabulation, virgule décimale, colonnes Débit /
//     Crédit ou Montant), OFX (SGML ou XML) et CAMT.053 (XML ISO 20022) ;
//   * empreinte anti-doublon d'une opération (le même relevé importé deux
//     fois n'ajoute rien) ;
//   * propositions de correspondance entre une opération au crédit et les
//     factures à encaisser : numéro de facture dans le libellé, montant égal
//     au reste à payer, nom du client, date ;
//   * écriture (et annulation) du paiement sur la facture, avec la même
//     règle que le bloc « Paiements reçus » : « payée » dès que le reste à
//     payer tombe à zéro.
// La source des opérations (fichier aujourd'hui, Qonto puis agrégateur DSP2
// ensuite) n'a aucune importance ici : tout arrive au même format.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Texte comparable : minuscules, sans accent, lettres et chiffres seulement.
export function normalizeText(s) {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// « 1 234,56 », « 1.234,56 », « 1,234.56 », « -12,00 € », « (12,00) », « 12,00-».
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(/[  \s]/g, "").replace(/(EUR|€|\$|£|CHF)/gi, "").replace(/\u2212/g, "-").trim(); // U+2212 : signe moins typographique
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { negative = true; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  if (s.endsWith("-")) { negative = true; s = s.slice(0, -1); }
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Les deux présents : le dernier est le séparateur décimal.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Virgule seule : décimale, sauf « 1,234,567 » (plusieurs virgules) ou
    // « 1,500 » (exactement trois chiffres après : milliers — un relevé a
    // toujours deux décimales).
    const commas = (s.match(/,/g) || []).length;
    s = commas > 1 || /^\d{1,3},\d{3}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0 && ((s.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(s))) {
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const value = round2(Number(s));
  return negative ? -value : value;
}

// Date au format ISO (AAAA-MM-JJ) depuis les formats courants des relevés.
export function parseDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return valid(m[3], m[2], m[1]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/);
  if (m) return valid(`20${m[3]}`, m[2], m[1]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})/); // OFX : 20260922120000[+1:CET]
  if (m) return valid(m[1], m[2], m[3]);
  return null;
  function valid(y, mo, d) {
    const year = Number(y), month = Number(mo), day = Number(d);
    if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
}

// ---------------------------------------------------------------- CSV
function detectDelimiter(line) {
  const counts = [";", ",", "\t", "|"].map((d) => [d, (line.match(new RegExp(d === "|" ? "\\|" : d, "g")) || []).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ";";
}
function splitCsvLine(line, delim) {
  const cells = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (c === delim && !quoted) { cells.push(cur); cur = ""; }
    else cur += c;
  }
  cells.push(cur);
  return cells.map((v) => v.trim());
}
const HEADER_KEYS = {
  date: ["date operation", "date d operation", "date de l operation", "date valeur", "date", "booking date", "transaction date"],
  label: ["libelle", "libelle operation", "libelle simplifie", "intitule", "description", "label", "details", "nature", "objet", "designation", "motif"],
  amount: ["montant", "amount", "montant eur", "montant euros", "valeur"],
  debit: ["debit", "debit eur", "debit euros", "sortie", "depense"],
  credit: ["credit", "credit eur", "credit euros", "entree", "recette"],
  counterparty: ["tiers", "contrepartie", "beneficiaire", "emetteur", "counterparty", "name", "payee", "nom"],
  reference: ["reference", "ref", "numero", "id", "identifiant", "fitid", "transaction id"],
};
function findColumn(headers, keys) {
  for (const key of keys) {
    const exact = headers.findIndex((h) => h === key);
    if (exact >= 0) return exact;
  }
  for (const key of keys) {
    const partial = headers.findIndex((h) => h.includes(key));
    if (partial >= 0) return partial;
  }
  return -1;
}
export function parseCsv(text) {
  const warnings = [];
  const lines = String(text || "").split(/\r?\n/).map((l) => l.replace(/^﻿/, "")).filter((l) => l.trim());
  if (!lines.length) return { transactions: [], warnings: ["Fichier vide."] };
  // En-tête : première ligne (parmi les quinze premières) qui contient une
  // colonne de date et une colonne de montant, débit ou crédit.
  let headerIndex = -1, delim = ";", cols = null;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const d = detectDelimiter(lines[i]);
    const headers = splitCsvLine(lines[i], d).map(normalizeText);
    const date = findColumn(headers, HEADER_KEYS.date);
    const amount = findColumn(headers, HEADER_KEYS.amount);
    const debit = findColumn(headers, HEADER_KEYS.debit);
    const credit = findColumn(headers, HEADER_KEYS.credit);
    if (date >= 0 && (amount >= 0 || debit >= 0 || credit >= 0)) {
      headerIndex = i; delim = d;
      cols = { date, amount: amount >= 0 && amount !== debit && amount !== credit ? amount : -1, debit, credit, label: findColumn(headers, HEADER_KEYS.label), counterparty: findColumn(headers, HEADER_KEYS.counterparty), reference: findColumn(headers, HEADER_KEYS.reference) };
      if (cols.label === cols.date || cols.label === cols.amount) cols.label = -1;
      break;
    }
  }
  const transactions = [];
  if (headerIndex < 0) {
    // Sans en-tête reconnu : on cherche sur chaque ligne une date, un montant
    // (dernière cellule numérique) et un libellé (cellule la plus longue).
    warnings.push("En-tête de colonnes non reconnu : lecture approximative (date, montant, libellé).");
    delim = detectDelimiter(lines[0]);
    for (const line of lines) {
      const cells = splitCsvLine(line, delim);
      const dateCell = cells.find((c) => parseDate(c));
      const numeric = cells.map((c, i) => [i, c]).filter(([, c]) => c && parseAmount(c) !== null && !parseDate(c));
      if (!dateCell || !numeric.length) continue;
      const [amountIdx, amountCell] = numeric[numeric.length - 1];
      const label = cells.filter((c, i) => i !== amountIdx && c !== dateCell).sort((a, b) => b.length - a.length)[0] || "";
      transactions.push({ bookedAt: parseDate(dateCell), amount: parseAmount(amountCell), label, counterparty: "", reference: "" });
    }
    return { transactions, warnings };
  }
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = splitCsvLine(line, delim);
    const bookedAt = parseDate(cells[cols.date]);
    if (!bookedAt) continue;
    let amount = null;
    if (cols.amount >= 0) amount = parseAmount(cells[cols.amount]);
    if (amount === null && (cols.debit >= 0 || cols.credit >= 0)) {
      const debit = cols.debit >= 0 ? parseAmount(cells[cols.debit]) : null;
      const credit = cols.credit >= 0 ? parseAmount(cells[cols.credit]) : null;
      if (credit !== null && credit !== 0) amount = Math.abs(credit);
      else if (debit !== null && debit !== 0) amount = -Math.abs(debit);
      else if (credit === 0 || debit === 0) amount = 0;
    }
    if (amount === null) continue;
    transactions.push({
      bookedAt,
      amount,
      label: cols.label >= 0 ? cells[cols.label] || "" : "",
      counterparty: cols.counterparty >= 0 ? cells[cols.counterparty] || "" : "",
      reference: cols.reference >= 0 ? cells[cols.reference] || "" : "",
    });
  }
  return { transactions, warnings };
}

// ---------------------------------------------------------------- OFX
const ofxField = (block, tag) => { const m = block.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, "i")); return m ? m[1].trim() : ""; };
export function parseOfx(text) {
  const src = String(text || "");
  const currency = ofxField(src, "CURDEF") || "EUR";
  const blocks = src.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]);
  const transactions = [];
  for (const b of blocks) {
    const bookedAt = parseDate(ofxField(b, "DTPOSTED"));
    const amount = parseAmount(ofxField(b, "TRNAMT"));
    if (!bookedAt || amount === null) continue;
    const name = ofxField(b, "NAME"), memo = ofxField(b, "MEMO");
    transactions.push({ bookedAt, amount, currency, label: [name, memo].filter(Boolean).join(" "), counterparty: name, reference: ofxField(b, "FITID") || ofxField(b, "REFNUM") || ofxField(b, "CHECKNUM") });
  }
  return { transactions, warnings: blocks.length ? [] : ["Aucune opération trouvée dans ce fichier OFX."] };
}

// ------------------------------------------------------------ CAMT.053
const xmlValue = (block, path) => { const m = block.match(new RegExp(`<${path}>\\s*([^<]*)`, "i")); return m ? m[1].trim() : ""; };
export function parseCamt(text) {
  const src = String(text || "");
  const entries = [...src.matchAll(/<Ntry>([\s\S]*?)<\/Ntry>/g)].map((m) => m[1]);
  const transactions = [];
  for (const e of entries) {
    if (/<Sts>\s*PDNG/i.test(e)) continue; // en attente : pas encore comptabilisée
    const amt = e.match(/<Amt[^>]*?(?:Ccy="([^"]*)")?[^>]*>\s*([^<]*)<\/Amt>/i);
    const amount = amt ? parseAmount(amt[2]) : null;
    const isCredit = /<CdtDbtInd>\s*CRDT/i.test(e);
    const bookedAt = parseDate(xmlValue(e, "BookgDt>\\s*<Dt") || xmlValue(e, "BookgDt>\\s*<DtTm") || xmlValue(e, "ValDt>\\s*<Dt"));
    if (!bookedAt || amount === null) continue;
    const ustrd = [...e.matchAll(/<Ustrd>([^<]*)<\/Ustrd>/g)].map((m) => m[1].trim()).filter(Boolean).join(" ");
    const addtl = xmlValue(e, "AddtlEntryInf") || xmlValue(e, "AddtlNtryInf") || xmlValue(e, "AddtlTxInf");
    const name = xmlValue(e, isCredit ? "Dbtr>\\s*<Nm" : "Cdtr>\\s*<Nm") || xmlValue(e, "UltmtDbtr>\\s*<Nm");
    transactions.push({
      bookedAt,
      amount: isCredit ? Math.abs(amount) : -Math.abs(amount),
      currency: (amt && amt[1]) || "EUR",
      label: [ustrd || addtl, name && !(ustrd || addtl).includes(name) ? name : ""].filter(Boolean).join(" ").trim(),
      counterparty: name,
      reference: xmlValue(e, "AcctSvcrRef") || xmlValue(e, "EndToEndId") || xmlValue(e, "TxId"),
    });
  }
  return { transactions, warnings: entries.length ? [] : ["Aucune opération trouvée dans ce fichier CAMT."] };
}

// ------------------------------------------------------- point d'entrée
export function detectStatementFormat(text, filename = "") {
  const head = String(text || "").slice(0, 4000);
  const ext = String(filename).toLowerCase().split(".").pop();
  if (/<STMTTRN>/i.test(head) || /OFXHEADER|<OFX>/i.test(head) || ext === "ofx" || ext === "qfx") return "ofx";
  if (/<Ntry>|BkToCstmrStmt|BkToCstmrAcctRpt/i.test(head) || (ext === "xml" && /<Document/i.test(head))) return "camt";
  return "csv";
}
export function parseStatement(text, filename = "") {
  const format = detectStatementFormat(text, filename);
  const parsed = format === "ofx" ? parseOfx(text) : format === "camt" ? parseCamt(text) : parseCsv(text);
  const transactions = parsed.transactions.map((t) => ({
    bookedAt: t.bookedAt,
    amount: round2(t.amount),
    currency: (t.currency || "EUR").toUpperCase(),
    label: String(t.label || "").replace(/\s+/g, " ").trim(),
    counterparty: String(t.counterparty || "").replace(/\s+/g, " ").trim(),
    reference: String(t.reference || "").trim(),
  })).filter((t) => t.bookedAt && Number.isFinite(t.amount));
  const warnings = [...parsed.warnings];
  if (!transactions.length && !warnings.length) warnings.push("Aucune opération lisible dans ce fichier.");
  return { format, transactions, warnings };
}

// Empreinte stable d'une opération : date, montant, libellé et référence.
// Deux imports du même relevé donnent la même empreinte (pas de doublon) ;
// deux virements identiques le même jour se distinguent par la référence
// bancaire quand le fichier en fournit une.
export function transactionFingerprint(t) {
  const base = [t.bookedAt, round2(t.amount).toFixed(2), normalizeText(t.label).slice(0, 80), normalizeText(t.reference)].join("|");
  let h = 5381;
  for (let i = 0; i < base.length; i++) h = ((h * 33) ^ base.charCodeAt(i)) >>> 0;
  return `${t.bookedAt}-${h.toString(16).padStart(8, "0")}-${base.length.toString(36)}`;
}

// -------------------------------------------------------- correspondances
const isPayable = (d) => !!d && (d.type === "facture" || d.type === "acompte" || (d.type === "situation" && d.vautFacture === true));
const STOP_WORDS = new Set(["sarl", "sas", "sasu", "eurl", "sci", "sa", "snc", "ets", "cie", "societe", "entreprise", "monsieur", "madame", "mme", "mr", "the", "les", "des", "and", "communaute", "agglomeration", "mairie", "ville"]);

// Factures à encaisser : reste à payer strictement positif, pas encore
// « payée ». amountDueOf(doc) est fourni par l'application (totaux).
export function openInvoiceCandidates(documents, amountDueOf) {
  return (documents || [])
    .filter((d) => isPayable(d) && d.status !== "brouillon" && d.status !== "payée" && d.status !== "annulée")
    .map((doc) => ({ doc, due: round2(amountDueOf(doc)), docNumber: String(doc.docNumber || ""), clientName: String(doc.client?.name || ""), issueDate: doc.issueDate || null }))
    .filter((c) => c.due > 0.005);
}

// "full" : numéro complet (FAC-021, FAC021) dans le libellé ; "digits" : les
// seuls chiffres (021), qui désignent aussi bien FAC-021 que SIT-021.
function numberMatches(docNumber, haystack, haystackCompact) {
  const n = normalizeText(docNumber);
  if (!n) return false;
  const compact = n.replace(/\s+/g, "");
  if (compact.length >= 4 && haystackCompact.includes(compact)) return "full";
  if (haystack.includes(n)) return "full";
  const digits = docNumber.replace(/\D+/g, "");
  if (digits.length >= 3) {
    const tokens = haystack.split(" ");
    const stripped = digits.replace(/^0+/, "");
    if (tokens.includes(digits) || (stripped.length >= 3 && tokens.includes(stripped))) return "digits";
  }
  return false;
}
function clientFraction(clientName, haystack) {
  const tokens = normalizeText(clientName).split(" ").filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
  if (!tokens.length) return 0;
  const hay = ` ${haystack} `;
  const hit = tokens.filter((t) => hay.includes(` ${t} `) || haystack.includes(t)).length;
  return hit / tokens.length;
}

// Propositions pour une opération au crédit, les meilleures d'abord :
//   * « sur » : numéro de facture dans le libellé (montant cohérent), ou
//     montant exactement égal au reste à payer d'une seule facture avec le
//     nom du client reconnu ;
//   * « probable » : montant exact seul, ou numéro avec montant supérieur…
export function suggestMatches(tx, candidates) {
  if (!tx || !(Number(tx.amount) > 0) || !candidates?.length) return [];
  const amount = round2(tx.amount);
  const haystack = normalizeText(`${tx.label} ${tx.reference} ${tx.counterparty}`);
  const haystackCompact = haystack.replace(/\s+/g, "");
  const scored = candidates.map((c) => {
    const reasons = [];
    let score = 0;
    const number = numberMatches(c.docNumber, haystack, haystackCompact);
    if (number) { score += 60; reasons.push("numéro de facture dans le libellé"); }
    const diff = amount - c.due;
    const amountExact = Math.abs(diff) <= 0.005;
    const amountPartial = !amountExact && diff < 0;
    const amountOver = diff > 0.005;
    if (amountExact) { score += 40; reasons.push("montant égal au reste à payer"); }
    else if (amountPartial) { score += 15; reasons.push("paiement partiel"); }
    else if (amountOver) { score += 5; reasons.push("montant supérieur au reste à payer"); }
    const fraction = clientFraction(c.clientName, haystack);
    if (fraction > 0) { score += Math.round(25 * fraction); reasons.push(fraction >= 0.99 ? "nom du client dans le libellé" : "nom du client en partie"); }
    const dateBefore = !!c.issueDate && tx.bookedAt < c.issueDate;
    if (dateBefore) { score -= 30; reasons.push("virement antérieur à la facture"); }
    return { id: c.doc.id, docNumber: c.docNumber, clientName: c.clientName, due: c.due, score, reasons, number, amountExact, amountOver, fraction, dateBefore };
  });
  const exactCount = scored.filter((s) => s.amountExact).length;
  const numberCount = scored.filter((s) => s.number).length;
  const out = scored.map((s) => {
    let level = null;
    if (s.number && !s.amountOver && !s.dateBefore && (s.number === "full" || numberCount === 1 || s.amountExact)) level = "sur";
    else if (s.amountExact && s.fraction >= 0.5 && exactCount === 1 && !s.dateBefore) level = "sur";
    else if (s.score >= 40 && !s.dateBefore) level = "probable";
    return { id: s.id, docNumber: s.docNumber, clientName: s.clientName, due: s.due, score: s.score, level, reasons: s.reasons };
  }).filter((s) => s.level).sort((a, b) => b.score - a.score || a.docNumber.localeCompare(b.docNumber));
  return out.slice(0, 3);
}

// Paiement enregistré sur la facture depuis une opération bancaire — même
// règle que le bloc « Paiements reçus » : « payée » dès que le reste à payer
// tombe à zéro. Renvoie le patch à appliquer au document, ou null si ce
// paiement y figure déjà.
export function applyBankPayment(doc, tx, due) {
  const id = `pay_bank_${tx.id}`;
  const payments = Array.isArray(doc?.payments) ? doc.payments : [];
  if (payments.some((p) => p?.id === id)) return null;
  const amount = round2(tx.amount);
  const payment = { id, date: tx.bookedAt, amount, method: "Virement bancaire", note: String(tx.label || "").slice(0, 80) };
  const patch = { payments: [...payments, payment] };
  if (round2(due) - amount <= 0.005 && doc.status !== "payée") {
    patch.status = "payée";
    patch.paidAt = new Date(`${tx.bookedAt}T12:00:00.000Z`).toISOString();
  }
  return patch;
}
// Annulation : le paiement est retiré ; si la facture était « payée » et ne
// l'est plus, elle repasse en « envoyée » (dueNow = reste à payer actuel).
export function revertBankPayment(doc, txId, dueNow = 0) {
  const id = `pay_bank_${txId}`;
  const payments = Array.isArray(doc?.payments) ? doc.payments : [];
  const removed = payments.find((p) => p?.id === id);
  if (!removed) return null;
  const patch = { payments: payments.filter((p) => p?.id !== id) };
  if (doc.status === "payée" && round2(dueNow) + round2(removed.amount) > 0.005) { patch.status = "envoyée"; patch.paidAt = null; }
  return patch;
}
