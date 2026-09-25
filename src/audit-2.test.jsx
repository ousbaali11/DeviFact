// @vitest-environment jsdom
// Second audit (25/09/2026) : preuves chiffrées des corrections directes —
// reste à payer net des avoirs (référence « payée »), échéances en calendrier
// local, duplication (options, facture reçue), fusion signature / fiche
// entreprise, relevés bancaires (date valeur, dates impossibles), CSV
// neutralisé, jour de Paris et arrondis côté serveur, éditeur sans signature.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  Editor, newDocument, emptyCompanyProfile, PLANS, documentOutstanding, paymentRevertPatch, duplicatedDocumentOf,
  addDaysLocal, fr, frLong, localDateOf, EMPTY_SIGNATURE,
} from "./App.jsx";
import { mergeValues } from "./storage-adapter.js";
import { parseDate, parseCsv } from "./bank-matching.js";
import { csvCell, entriesToCsv } from "./accounting.js";
import { previousPeriod, exportDueToday, accountingLinesOf } from "../supabase/functions/_shared/accounting.ts";
import { parisTodayIso, parisDateParts } from "../supabase/functions/_shared/dates.ts";
import { addOnlinePayment, amountDueOf } from "../supabase/functions/_shared/totals.ts";
import { validAttestations } from "../supabase/functions/_shared/attestations.ts";

const line = (id, ht, tva = 0) => ({ id, type: "line", designation: `Poste ${id}`, qty: 1, unit: "u", unitPrice: ht, tva, discount: 0, details: [] });
const facture = (items, extra = {}) => ({ ...newDocument("facture", []), id: "f1", docNumber: "FAC-001", status: "envoyée", items, payments: [], acompteVerse: "", ...extra });
const avoir = (ht) => ({ ...newDocument("avoir", []), id: "a1", status: "envoyée", factureOrigineId: "f1", items: [line("l-a", ht)] });

describe("reste à payer : référence « payée » nette des avoirs (C2/C8, C9)", () => {
  const docs = (f) => [f, avoir(200)];
  it("facture 1 000, avoir 200, 800 reçus : rien à payer ; passée en « payée » avec paidTotal net (800) puis portée à 1 100 → 100 dus", () => {
    const f = facture([line("l1", 1000)], { payments: [{ id: "p1", date: "2026-09-01", amount: 800 }] });
    expect(documentOutstanding(f, docs(f))).toBe(0);
    const payee = { ...f, status: "payée", paidTotal: 800 }; // ce que updateDoc mémorise désormais : total réglé − avoirs rattachés
    expect(documentOutstanding(payee, docs(payee))).toBe(0);
    const modifiee = { ...payee, items: [line("l1", 1100)] };
    expect(documentOutstanding(modifiee, docs(modifiee))).toBe(100);
    // Avec l'ancienne référence brute (1 000), la hausse de 100 passait inaperçue.
    expect(documentOutstanding({ ...modifiee, paidTotal: 1000 }, docs(modifiee))).toBe(0);
  });
  it("paymentRevertPatch sans paidTotal mémorisé : la référence déduit les avoirs → 100 dus, retour en « envoyée »", () => {
    const original = facture([line("l1", 1000)], { status: "payée", payments: [{ id: "p1", date: "2026-09-01", amount: 800 }] });
    const revert = paymentRevertPatch(original, { items: [line("l1", 1100)] }, docs(original));
    expect(revert.patch).toEqual({ status: "envoyée", paidAt: null, paidTotal: null });
    expect(revert.notice.amount).toBe(100);
    // Sans hausse : rien ne change.
    expect(paymentRevertPatch(original, { notes: "ok" }, docs(original))).toBeNull();
  });
  it("avoir créé après une facture réglée en totalité : toujours rien à payer, même après une petite hausse", () => {
    const f = facture([line("l1", 1000)], { status: "payée", paidTotal: 1000, payments: [{ id: "p1", date: "2026-09-01", amount: 1000 }] });
    expect(documentOutstanding(f, docs(f))).toBe(0);
    expect(documentOutstanding({ ...f, items: [line("l1", 1100)] }, docs(f))).toBe(0); // 1 100 − 200 d'avoir − 1 000 reçus < 0
  });
});

describe("paiement en ligne : avoirs déduits (C13)", () => {
  it("facture 1 000 avec avoir 200 : 800 reçus par carte → « payée », paidTotal 800", () => {
    const f = facture([line("l1", 1000)]);
    const list = [f, avoir(200)];
    expect(amountDueOf(f, list)).toBe(800);
    const updated = addOnlinePayment(f, "cs_1", 80000, "2026-09-25T10:00:00.000Z", list);
    expect(updated.status).toBe("payée");
    expect(updated.paidTotal).toBe(800);
    // Sans la liste (ancien appel) : 200 semblaient encore dus.
    expect(addOnlinePayment(f, "cs_1", 80000, "2026-09-25T10:00:00.000Z").status).toBe("envoyée");
  });
});

describe("échéances en calendrier local (B2, B29, B9, B10)", () => {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  it("10/10/2026 + 30 jours = 09/11/2026 malgré le passage à l'heure d'hiver ; 31/01 + 30 = 02/03", () => {
    expect(iso(addDaysLocal("2026-10-10", 30))).toBe("2026-11-09");
    expect(iso(addDaysLocal("2026-01-31", 30))).toBe("2026-03-02");
    expect(iso(addDaysLocal("2026-03-28", 2))).toBe("2026-03-30"); // heure d'été
    expect(iso(addDaysLocal(localDateOf("2026-09-25"), 0))).toBe("2026-09-25");
    expect(isNaN(addDaysLocal("", 30).getTime())).toBe(true);
  });
  it("fr / frLong : « — » pour une date absente ou invalide", () => {
    expect(fr("")).toBe("—");
    expect(frLong(undefined)).toBe("—");
    expect(fr("2026-09-25").replace(/ | /g, " ")).toBe("25 sept. 2026");
  });
});

describe("duplication (C7, C12)", () => {
  it("devis à options : la copie repart avec les options non cochées", () => {
    const devis = { ...newDocument("devis", []), id: "d1", status: "signé", items: [line("l1", 100), { ...line("l2", 50), optional: true, optionAccepted: true }] };
    const copy = duplicatedDocumentOf(devis, [devis]);
    expect(copy.status).toBe("brouillon");
    expect(copy.items[1].optional).toBe(true);
    expect(copy.items[1].optionAccepted).toBe(false);
    expect(devis.items[1].optionAccepted).toBe(true); // l'original n'est pas touché
  });
  it("facture reçue payée avec scan : la copie est « à payer », sans scan ni date de paiement", () => {
    const recue = { id: "r1", type: "facture_recue", docNumber: "FR-001", status: "payée", paidAt: "2026-09-01T00:00:00.000Z", attachment: { path: "org/x.pdf", fileName: "x.pdf" }, client: { name: "Fournisseur" }, ht: 100, tva: 20, createdAt: 1, updatedAt: 1 };
    const copy = duplicatedDocumentOf(recue, [recue]);
    expect(copy.status).toBe("à payer");
    expect(copy.attachment).toBeNull();
    expect(copy.paidAt).toBeUndefined();
    expect(copy.id).not.toBe("r1");
  });
});

describe("fusion à trois versions (cohérence C2, C3, C13)", () => {
  it("devis signé par le client pendant que l'artisan le retouchait : signature, statut et options retenues gardés", () => {
    const base = { id: "d1", type: "devis", status: "envoyé", title: "A", updatedAt: 100, items: [{ id: "l2", type: "line", optional: true, optionAccepted: false }] };
    const local = { ...base, title: "B", updatedAt: 300 }; // l'artisan gagne (plus récent)
    const remote = { ...base, status: "signé", signature: { mode: "texte", name: "Client", acceptedOptionIds: ["l2"], acceptedTotalTTC: 150 }, updatedAt: 200, items: [{ id: "l2", type: "line", optional: true, optionAccepted: true }], lastReminderSentAt: 5 };
    const [merged] = mergeValues([base], [local], [remote]);
    expect(merged.title).toBe("B");
    expect(merged.status).toBe("signé");
    expect(merged.signature.name).toBe("Client");
    expect(merged.items[0].optionAccepted).toBe(true);
    expect(merged.lastReminderSentAt).toBe(5);
  });
  it("fiche entreprise : champ par champ — le téléphone changé ici, l'IBAN saisi ailleurs, les deux gardés", () => {
    const base = { name: "Bâti", phone: "01", iban: "", attestations: [{ id: "a1", kind: "decennale" }] };
    const local = { ...base, phone: "02" };
    const remote = { ...base, iban: "FR76 0000", attestations: [{ id: "a1", kind: "decennale" }, { id: "a2", kind: "rc_pro" }] };
    const merged = mergeValues(base, local, remote);
    expect(merged).toEqual({ name: "Bâti", phone: "02", iban: "FR76 0000", attestations: [{ id: "a1", kind: "decennale" }, { id: "a2", kind: "rc_pro" }] });
    // Sans base connue : la version locale gagne (comportement inchangé).
    expect(mergeValues(null, local, remote)).toEqual(local);
  });
});

describe("relevés bancaires (B33, B34)", () => {
  it("31/02/2026 refusé, 29/02/2028 accepté", () => {
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("29/02/2028")).toBe("2028-02-29");
    expect(parseDate("31/04/2026")).toBeNull();
  });
  it("colonne « Date valeur » (sans colonne Montant) : jamais prise pour le montant, le crédit est lu", () => {
    const csv = "Date valeur;Libellé;Débit;Crédit\n20260926;VIR FAC-001;;150,00\n";
    const { transactions } = parseCsv(csv);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].amount).toBe(150); // avant : 20 260 926
    expect(transactions[0].bookedAt).toBe("2026-09-26");
  });
});

describe("CSV neutralisé (S8)", () => {
  it("une cellule qui commence par = + @ ou - est précédée d'une apostrophe, les nombres négatifs restent", () => {
    expect(csvCell("=SUM(A1)")).toBe(`"'=SUM(A1)"`);
    expect(csvCell("-12,50")).toBe(`"-12,50"`);
    expect(csvCell("-cmd")).toBe(`"'-cmd"`);
    expect(entriesToCsv([{ date: "2026-09-01", journal: "VE", piece: "FAC-1", label: "@x", account: "706", debit: 0, credit: 1, source: "vente" }])).toContain(`"'@x"`);
  });
});

describe("serveur : jour de Paris et arrondis (B32, C6/B31)", () => {
  it("le 1er octobre à 0 h 30 (Paris) : période précédente = septembre, envoi dû dès le 3 à Paris", () => {
    expect(parisTodayIso(new Date("2026-09-30T22:30:00Z"))).toBe("2026-10-01");
    expect(parisDateParts(new Date("2026-01-01T12:00:00Z"))).toEqual({ year: 2026, month: 1, day: 1, iso: "2026-01-01" });
    expect(previousPeriod(new Date("2026-09-30T22:30:00Z"), "mensuel").id).toBe("2026-09");
    expect(previousPeriod(new Date("2026-09-30T22:30:00Z"), "trimestriel").id).toBe("2026-T3");
    expect(exportDueToday(new Date("2026-10-02T22:30:00Z"), "mensuel", null, 3)).toBe(true); // 3 octobre à Paris
    expect(exportDueToday(new Date("2026-10-02T12:00:00Z"), "mensuel", null, 3)).toBe(false);
  });
  it("attestation valable jusqu'au 30/09 : encore jointe le 30/09 à 23 h (Paris), plus le 1er", () => {
    const profile = { attestations: [{ id: "a1", kind: "decennale", path: "org/x.pdf", expiresAt: "2026-09-30" }] };
    expect(validAttestations(profile, new Date("2026-09-30T21:30:00Z"))).toHaveLength(1);
    expect(validAttestations(profile, new Date("2026-09-30T22:30:00Z"))).toHaveLength(0);
  });
  it("situation : montants arrondis à chaque étape comme sur le site (3 × 33,333 à 33 %)", () => {
    const situation = { type: "situation", items: [{ id: "s1", type: "line", qty: 3, unitPrice: 33.333, avancementPct: 33, montantCumulePrecedent: 0, tva: 20 }] };
    expect(accountingLinesOf(situation)[0].totalHT).toBe(33); // 99,999 → 100,00 ; × 33 % = 33,00 (avant : 32,99967)
  });
});

describe("éditeur sans signature (B1)", () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
    window.scrollTo = () => {};
  });
  it("facture issue d'un devis (signature: null) sur un forfait Pro : le bloc signature s'affiche vide, sans erreur", async () => {
    const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@exemple.fr", memberships: [] };
    const noop = () => {};
    const doc = { ...newDocument("facture", []), signature: null, linkedDevisId: "d1" };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let failure = null;
    const onError = (e) => { failure = e.error || e; };
    window.addEventListener("error", onError);
    await act(async () => {
      root.render(<Editor doc={doc} saving={false} account={account} plans={PLANS} siteSettings={{ name: "Chantiflow" }} isLocked={false} isViewer={false} onChange={noop} onFinalize={noop} onBack={noop} onGoToPricing={noop} clients={[]} products={[]} stockByProduct={{}} companyProfile={emptyCompanyProfile()} onConvert={null} onSaveClient={noop} onSaveProduct={noop} onSplit={noop} splitNotice={null} onOpenSplitDoc={noop} onDismissSplitNotice={noop} />);
    });
    window.removeEventListener("error", onError);
    expect(failure).toBeNull();
    expect(container.textContent).toContain("Signature du client");
    expect(container.querySelector('input[placeholder="Tapez votre nom pour signer"]')).toBeTruthy(); // mode « texte » par défaut
    expect(EMPTY_SIGNATURE.mode).toBe("texte");
    await act(async () => { root.unmount(); });
    container.remove();
  }, 30000);
});
