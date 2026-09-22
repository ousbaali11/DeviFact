// @vitest-environment jsdom
// Audit des montants avec paiements reçus : duplication et facture
// récurrente sans paiements hérités, correction qui rouvre une facture
// soldée, montants « reste à payer » dans les listes.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PaymentsEditor, duplicatedDocumentOf, atelierDocAmount, newDocument, newSituationDocument, computeTotals } from "./App.jsx";
import { recurringInvoiceCopy } from "../supabase/functions/_shared/recurring.ts";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });

const line = { id: "l1", type: "line", designation: "Pose", details: [], qty: 1, unitPrice: 100, tva: 20, discount: 0 };
const paidInvoice = () => ({ ...newDocument("facture", []), docNumber: "F-001", status: "payée", workStage: "termine", paidAt: "2026-09-22T10:00:00.000Z", acompteVerse: "20", items: [line], payments: [{ id: "p1", date: "2026-09-22", amount: 100, method: "Chèque" }], signature: { mode: "texte", name: "Client" }, photos: [{ id: "ph" }] });

describe("copies d'une facture réglée", () => {
  it("dupliquer : brouillon non terminé, sans paiement, date de paiement, acompte versé, signature ni photo ; lignes conservées", () => {
    const copy = duplicatedDocumentOf(paidInvoice(), []);
    expect(copy).toMatchObject({ type: "facture", status: "brouillon", workStage: "brouillon", payments: [], acompteVerse: "", signature: null, photos: [] });
    expect(copy.paidAt).toBeUndefined();
    expect(copy.items).toEqual([line]);
    expect(copy.docNumber).not.toBe("F-001");
    expect(computeTotals(copy).montantARegler).toBe(120);
  });
  it("facture récurrente : la copie mensuelle repart sans paiement ni acompte", () => {
    const copy = recurringInvoiceCopy({ ...paidInvoice(), isRecurring: true, nextRecurrenceDate: "2026-10-01" }, "F-002", "2026-10-01", "doc_x");
    expect(copy).toMatchObject({ id: "doc_x", docNumber: "F-002", issueDate: "2026-10-01", status: "brouillon", workStage: "brouillon", isRecurring: false, nextRecurrenceDate: "", payments: [], acompteVerse: "" });
    expect(copy.paidAt).toBeUndefined();
    expect(copy.signature).toBeUndefined();
    expect(copy.items).toEqual([line]);
  });
});

describe("montants dans les listes", () => {
  it("facture partiellement réglée : reste à payer ; réglée ou sans paiement : total TTC", () => {
    const partial = { ...newDocument("facture", []), status: "envoyée", items: [line], payments: [{ id: "p", amount: 50 }] };
    expect(atelierDocAmount(partial)).toEqual({ value: 70, note: "reste" });
    expect(atelierDocAmount({ ...partial, payments: [] })).toEqual({ value: 120, note: "TTC" });
    expect(atelierDocAmount({ ...partial, status: "payée" })).toEqual({ value: 120, note: "TTC" });
    const sit = { ...newSituationDocument([]), vautFacture: true, retenueGarantiePct: 0, items: [{ id: "s", type: "line", designation: "GO", qty: 1, unitPrice: 1000, tva: 20, avancementPct: 50, montantCumulePrecedent: 0 }], payments: [{ id: "p", amount: 100 }] };
    expect(atelierDocAmount(sit)).toEqual({ value: 500, note: "reste" });
  });
});

describe("correction d'un paiement sur une facture soldée", () => {
  it("retirer un paiement rouvre la facture (statut « envoyée », date de paiement effacée)", async () => {
    const patches = [];
    const doc = { ...newDocument("facture", []), status: "payée", paidAt: "2026-09-22T10:00:00.000Z", items: [line], payments: [{ id: "p1", date: "2026-09-22", amount: 70, method: "Chèque" }, { id: "p2", date: "2026-09-23", amount: 50, method: "Espèces" }] };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<PaymentsEditor doc={doc} totals={computeTotals(doc)} onPatch={(p) => patches.push(p)} />); });
    const remove = container.querySelectorAll('button[title="Retirer ce paiement"]')[1];
    await act(async () => { remove.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(patches[0].payments.map((p) => p.id)).toEqual(["p1"]);
    expect(patches[0].status).toBe("envoyée");
    expect(patches[0].paidAt).toBeNull();
    await act(async () => { root.unmount(); });
    container.remove();
  }, 30000);
});
