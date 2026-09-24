// @vitest-environment node
// Rapprochement bancaire, livraison 1 : lecture des relevés (CSV des banques
// françaises, OFX, CAMT.053), empreinte anti-doublon, propositions de
// correspondance avec les factures à encaisser, écriture et annulation du
// paiement sur la facture.
import { describe, it, expect } from "vitest";
import { parseAmount, parseDate, parseStatement, parseCsv, transactionFingerprint, openInvoiceCandidates, suggestMatches, applyBankPayment, revertBankPayment, normalizeText, detectStatementFormat } from "./bank-matching.js";

describe("montants et dates", () => {
  it("formats français et anglais, signes, parenthèses, devise", () => {
    expect(parseAmount("1 234,56")).toBe(1234.56);
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("-12,00 €")).toBe(-12);
    expect(parseAmount("(12,00)")).toBe(-12);
    expect(parseAmount("12,00-")).toBe(-12);
    expect(parseAmount("+9")).toBe(9);
    expect(parseAmount("1 000")).toBe(1000);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("22/09/2026")).toBeNull();
  });
  it("dates : jj/mm/aaaa, aaaa-mm-jj, jj-mm-aa, OFX", () => {
    expect(parseDate("22/09/2026")).toBe("2026-09-22");
    expect(parseDate("2026-09-22")).toBe("2026-09-22");
    expect(parseDate("22-09-26")).toBe("2026-09-22");
    expect(parseDate("22.09.2026")).toBe("2026-09-22");
    expect(parseDate("20260922120000[+1:CET]")).toBe("2026-09-22");
    expect(parseDate("32/13/2026")).toBeNull();
    expect(parseDate("libellé")).toBeNull();
  });
});

const CSV_CA = "﻿Date;Libellé;Débit euros;Crédit euros;\n22/09/2026;VIR SEPA COMMUNAUTE AGGLO FAC-021;;1 200,00;\n23/09/2026;PRLV SEPA EDF;80,00;;\n24/09/2026;\"VIR DUPONT ; ACOMPTE\";;500,00;\n";
const CSV_MONTANT = "Date opération,Date valeur,Libellé,Montant,Référence\n2026-09-22,2026-09-22,Virement de Dupont,\"500.00\",TRX-1\n2026-09-23,2026-09-23,Carte restaurant,\"-24.90\",TRX-2\n";
const CSV_SANS_ENTETE = "22/09/2026;VIR CLIENT MARTIN;150,00\n23/09/2026;CB SUPERMARCHE;-40,00\n";
const OFX = `OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKTRANLIST>\n<STMTTRN>\n<TRNTYPE>CREDIT\n<DTPOSTED>20260922120000[+1:CET]\n<TRNAMT>1200.00\n<FITID>2026092200123\n<NAME>COMMUNAUTE AGGLO\n<MEMO>VIR SEPA FAC-021\n</STMTTRN>\n<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>20260923\n<TRNAMT>-80.00\n<FITID>2026092300124\n<NAME>EDF\n</STMTTRN>\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
const CAMT = `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Ntry><Amt Ccy="EUR">1200.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-09-22</Dt></BookgDt><AcctSvcrRef>REF-A1</AcctSvcrRef><NtryDtls><TxDtls><RltdPties><Dbtr><Nm>COMMUNAUTE AGGLO</Nm></Dbtr></RltdPties><RmtInf><Ustrd>FAC-021</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry><Ntry><Amt Ccy="EUR">80.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-09-23</Dt></BookgDt><AddtlNtryInf>PRLV EDF</AddtlNtryInf></Ntry><Ntry><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-09-24</Dt></BookgDt></Ntry></Stmt></BkToCstmrStmt></Document>`;

describe("lecture des relevés", () => {
  it("CSV banque française : BOM, point-virgule, colonnes Débit/Crédit, virgule décimale, guillemets", () => {
    const { format, transactions, warnings } = parseStatement(CSV_CA, "releve.csv");
    expect(format).toBe("csv");
    expect(warnings).toEqual([]);
    expect(transactions).toEqual([
      { bookedAt: "2026-09-22", amount: 1200, currency: "EUR", label: "VIR SEPA COMMUNAUTE AGGLO FAC-021", counterparty: "", reference: "" },
      { bookedAt: "2026-09-23", amount: -80, currency: "EUR", label: "PRLV SEPA EDF", counterparty: "", reference: "" },
      { bookedAt: "2026-09-24", amount: 500, currency: "EUR", label: "VIR DUPONT ; ACOMPTE", counterparty: "", reference: "" },
    ]);
  });
  it("CSV virgule, colonne Montant signée, référence", () => {
    const { transactions } = parseStatement(CSV_MONTANT);
    expect(transactions.map((t) => [t.bookedAt, t.amount, t.label, t.reference])).toEqual([
      ["2026-09-22", 500, "Virement de Dupont", "TRX-1"],
      ["2026-09-23", -24.9, "Carte restaurant", "TRX-2"],
    ]);
  });
  it("CSV sans en-tête : lecture approximative annoncée", () => {
    const { transactions, warnings } = parseCsv(CSV_SANS_ENTETE);
    expect(warnings[0]).toContain("En-tête de colonnes non reconnu");
    expect(transactions).toEqual([
      { bookedAt: "2026-09-22", amount: 150, label: "VIR CLIENT MARTIN", counterparty: "", reference: "" },
      { bookedAt: "2026-09-23", amount: -40, label: "CB SUPERMARCHE", counterparty: "", reference: "" },
    ]);
  });
  it("OFX (SGML sans balises fermantes) : date, montant, nom + mémo, FITID", () => {
    const { format, transactions } = parseStatement(OFX, "export.ofx");
    expect(format).toBe("ofx");
    expect(transactions).toEqual([
      { bookedAt: "2026-09-22", amount: 1200, currency: "EUR", label: "COMMUNAUTE AGGLO VIR SEPA FAC-021", counterparty: "COMMUNAUTE AGGLO", reference: "2026092200123" },
      { bookedAt: "2026-09-23", amount: -80, currency: "EUR", label: "EDF", counterparty: "EDF", reference: "2026092300124" },
    ]);
  });
  it("CAMT.053 : crédit/débit, libellé non structuré, nom du débiteur, référence ; opération en attente ignorée", () => {
    const { format, transactions } = parseStatement(CAMT, "releve.xml");
    expect(format).toBe("camt");
    expect(transactions).toEqual([
      { bookedAt: "2026-09-22", amount: 1200, currency: "EUR", label: "FAC-021 COMMUNAUTE AGGLO", counterparty: "COMMUNAUTE AGGLO", reference: "REF-A1" },
      { bookedAt: "2026-09-23", amount: -80, currency: "EUR", label: "PRLV EDF", counterparty: "", reference: "" },
    ]);
  });
  it("fichier vide ou illisible : avertissement, aucune opération", () => {
    expect(parseStatement("").warnings.length).toBeGreaterThan(0);
    expect(parseStatement("bonjour\nmonde").transactions).toEqual([]);
    expect(detectStatementFormat("x", "releve.qfx")).toBe("ofx");
  });
});

describe("empreinte anti-doublon", () => {
  const t = { bookedAt: "2026-09-22", amount: 1200, label: "VIR SEPA  Communauté AGGLO FAC-021", reference: "" };
  it("stable pour la même opération, insensible à la casse et aux espaces ; différente si la référence diffère", () => {
    expect(transactionFingerprint(t)).toBe(transactionFingerprint({ ...t, label: "vir sepa communaute agglo fac-021" }));
    expect(transactionFingerprint(t)).not.toBe(transactionFingerprint({ ...t, amount: 1200.5 }));
    expect(transactionFingerprint(t)).not.toBe(transactionFingerprint({ ...t, reference: "A" }));
    expect(transactionFingerprint(t)).toMatch(/^2026-09-22-[0-9a-f]{8}-/);
  });
});

const facture = (id, docNumber, clientName, extra = {}) => ({ id, type: "facture", docNumber, status: "envoyée", issueDate: "2026-09-10", client: { name: clientName }, payments: [], ...extra });
const dues = { f21: 1200, f22: 500, f23: 500, s1: 242 };
const amountDueOf = (d) => dues[d.id] ?? 0;
const docs = [
  facture("f21", "FAC-021", "Communauté d'agglomération de Forbach"),
  facture("f22", "FAC-022", "M. Dupont"),
  facture("f23", "FAC-023", "SARL Martin Rénovation"),
  { id: "s1", type: "situation", vautFacture: true, docNumber: "SIT-004", status: "envoyée", issueDate: "2026-09-01", client: { name: "Mairie de Stiring" }, payments: [] },
  { id: "s2", type: "situation", vautFacture: false, docNumber: "SIT-005", status: "envoyée", client: { name: "X" } },
  facture("f24", "FAC-024", "Payée", { status: "payée" }),
  { id: "d1", type: "devis", docNumber: "DEV-001", status: "envoyé", client: { name: "Dupont" } },
];

describe("factures à encaisser et propositions", () => {
  const candidates = openInvoiceCandidates(docs, amountDueOf);
  it("factures, acomptes et situations valant facture non soldés seulement", () => {
    expect(candidates.map((c) => c.docNumber)).toEqual(["FAC-021", "FAC-022", "FAC-023", "SIT-004"]);
    expect(candidates[0]).toMatchObject({ due: 1200, clientName: "Communauté d'agglomération de Forbach", issueDate: "2026-09-10" });
  });
  it("numéro de facture dans le libellé : sûr, même avec un montant partiel", () => {
    const [best] = suggestMatches({ bookedAt: "2026-09-22", amount: 1200, label: "VIR SEPA COMMUNAUTE AGGLO FAC-021", reference: "", counterparty: "" }, candidates);
    expect(best).toMatchObject({ docNumber: "FAC-021", level: "sur" });
    expect(best.reasons).toContain("numéro de facture dans le libellé");
    const [partial] = suggestMatches({ bookedAt: "2026-09-22", amount: 300, label: "Acompte facture FAC021", reference: "", counterparty: "" }, candidates);
    expect(partial).toMatchObject({ docNumber: "FAC-021", level: "sur" });
    expect(partial.reasons).toContain("paiement partiel");
  });
  it("montant exact et nom du client, sans numéro : sûr si une seule facture a ce montant", () => {
    const out = suggestMatches({ bookedAt: "2026-09-22", amount: 242, label: "VIR MAIRIE DE STIRING", reference: "", counterparty: "" }, candidates);
    expect(out[0]).toMatchObject({ docNumber: "SIT-004", level: "sur" });
  });
  it("montant exact seul : probable ; deux factures au même montant : probable pour les deux, le client reconnu d'abord", () => {
    const out = suggestMatches({ bookedAt: "2026-09-22", amount: 500, label: "VIR SEPA M DUPONT", reference: "", counterparty: "" }, candidates);
    expect(out.map((s) => [s.docNumber, s.level])).toEqual([["FAC-022", "probable"], ["FAC-023", "probable"]]);
    const anon = suggestMatches({ bookedAt: "2026-09-22", amount: 1200, label: "VIREMENT", reference: "", counterparty: "" }, candidates);
    expect(anon.map((s) => [s.docNumber, s.level])).toEqual([["FAC-021", "probable"]]);
  });
  it("débit, montant sans rapport, ou virement antérieur à la facture : aucune proposition", () => {
    expect(suggestMatches({ bookedAt: "2026-09-22", amount: -80, label: "PRLV EDF FAC-021" }, candidates)).toEqual([]);
    expect(suggestMatches({ bookedAt: "2026-09-22", amount: 77, label: "VIR INCONNU" }, candidates)).toEqual([]);
    expect(suggestMatches({ bookedAt: "2026-09-01", amount: 1200, label: "VIR FAC-021" }, candidates)).toEqual([]);
  });
  it("numéro trop court pour être sûr : « 21 » seul ne suffit pas, « FAC 21 » non plus sans le bon numéro", () => {
    expect(suggestMatches({ bookedAt: "2026-09-22", amount: 10, label: "VIR 21 09" }, candidates)).toEqual([]);
    expect(normalizeText("Éléphant & Co.")).toBe("elephant co");
  });
});

describe("écriture du paiement sur la facture", () => {
  const tx = { id: "tx1", bookedAt: "2026-09-22", amount: 1200, label: "VIR SEPA COMMUNAUTE AGGLO FAC-021" };
  it("solde : paiement ajouté, « payée » avec la date du virement ; idempotent", () => {
    const doc = facture("f21", "FAC-021", "Agglo");
    const patch = applyBankPayment(doc, tx, 1200);
    expect(patch.payments).toEqual([{ id: "pay_bank_tx1", date: "2026-09-22", amount: 1200, method: "Virement bancaire", note: "VIR SEPA COMMUNAUTE AGGLO FAC-021" }]);
    expect(patch.status).toBe("payée");
    expect(patch.paidAt).toBe("2026-09-22T12:00:00.000Z");
    expect(applyBankPayment({ ...doc, ...patch }, tx, 0)).toBeNull();
  });
  it("partiel : paiement ajouté, statut inchangé", () => {
    const patch = applyBankPayment(facture("f21", "FAC-021", "Agglo"), { ...tx, amount: 300 }, 1200);
    expect(patch.payments).toHaveLength(1);
    expect(patch.status).toBeUndefined();
  });
  it("annulation : paiement retiré, « payée » redevient « envoyée » seulement si la facture n'est plus soldée", () => {
    const paid = { ...facture("f21", "FAC-021", "Agglo"), status: "payée", paidAt: "x", payments: [{ id: "pay_bank_tx1", amount: 1200 }, { id: "p_autre", amount: 5 }] };
    expect(revertBankPayment(paid, "tx1", 0)).toEqual({ payments: [{ id: "p_autre", amount: 5 }], status: "envoyée", paidAt: null });
    const over = { ...paid, payments: [{ id: "pay_bank_tx1", amount: 1200 }, { id: "p_autre", amount: 1200 }] };
    // Encore couverte par l'autre paiement : reste « payée » (dueNow négatif)
    expect(revertBankPayment(over, "tx1", -1200)).toEqual({ payments: [{ id: "p_autre", amount: 1200 }] });
    expect(revertBankPayment(paid, "inconnu", 0)).toBeNull();
  });
});
