import { describe, it, expect } from "vitest";
import { computeSalesKpis, kpiPeriods, fiscalYearStart, saleDateOf, isSale } from "./kpis.js";

// Facture payée fictive ; montant HT fourni tel quel par amountOf.
const paid = (paidAt, amount, extra = {}) => ({ type: "facture", status: "payée", paidAt, amount, ...extra });
const amountOf = (d) => d.amount;

describe("définition d'une vente", () => {
  it("ne compte que les factures payées", () => {
    expect(isSale({ type: "facture", status: "payée" })).toBe(true);
    expect(isSale({ type: "facture", status: "envoyée" })).toBe(false);
    expect(isSale({ type: "facture", status: "en retard" })).toBe(false);
    expect(isSale({ type: "facture", status: "brouillon" })).toBe(false);
    expect(isSale({ type: "devis", status: "signé" })).toBe(false);
    expect(isSale({ type: "acompte", status: "payée" })).toBe(false);
  });
  it("date de vente = paiement, sinon émission ; date seule lue en heure locale", () => {
    expect(saleDateOf({ paidAt: "2026-09-13T10:00:00", issueDate: "2026-09-01" }).getDate()).toBe(13);
    const d = saleDateOf({ issueDate: "2026-09-01" });
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 9, 1]);
    expect(saleDateOf({})).toBeNull();
    expect(saleDateOf({ issueDate: "pas une date" })).toBeNull();
  });
});

describe("bornes des périodes", () => {
  it("aujourd'hui couvre la journée locale complète", () => {
    const now = new Date(2026, 8, 13, 15, 30); // 13 septembre 2026, 15 h 30 locales
    const p = kpiPeriods(now, 1);
    expect(p.today.start.getHours()).toBe(0);
    expect(p.today.start.getDate()).toBe(13);
    expect(p.today.end.getHours()).toBe(23);
    expect(p.today.end.getMilliseconds()).toBe(999);
  });
  it("7 derniers jours = fenêtre glissante, aujourd'hui inclus (J-6)", () => {
    const now = new Date(2026, 8, 13, 15, 30);
    const p = kpiPeriods(now, 1);
    expect([p.last7.start.getMonth() + 1, p.last7.start.getDate()]).toEqual([9, 7]);
  });
  it("7 derniers jours traverse un changement de mois et d'année", () => {
    const p = kpiPeriods(new Date(2027, 0, 2, 9, 0), 1); // 2 janvier 2027
    expect([p.last7.start.getFullYear(), p.last7.start.getMonth() + 1, p.last7.start.getDate()]).toEqual([2026, 12, 27]);
  });
  it("mois en cours commence le 1er, même le 1er du mois", () => {
    const p = kpiPeriods(new Date(2026, 9, 1, 8, 0), 1); // 1er octobre
    expect([p.month.start.getMonth() + 1, p.month.start.getDate()]).toEqual([10, 1]);
    expect(p.month.start <= p.month.end).toBe(true);
  });
});

describe("exercice comptable", () => {
  it("année civile par défaut", () => {
    expect(fiscalYearStart(new Date(2026, 8, 13)).getTime()).toBe(new Date(2026, 0, 1).getTime());
  });
  it("exercice commençant en avril : avant avril, l'exercice a commencé l'année précédente", () => {
    expect(fiscalYearStart(new Date(2026, 1, 15), 4).getTime()).toBe(new Date(2025, 3, 1).getTime());
    expect(fiscalYearStart(new Date(2026, 3, 1), 4).getTime()).toBe(new Date(2026, 3, 1).getTime());
    expect(fiscalYearStart(new Date(2026, 10, 30), 4).getTime()).toBe(new Date(2026, 3, 1).getTime());
  });
  it("mois de début invalide → janvier", () => {
    expect(fiscalYearStart(new Date(2026, 5, 1), 13).getMonth()).toBe(0);
    expect(fiscalYearStart(new Date(2026, 5, 1), "abc").getMonth()).toBe(0);
  });
});

describe("computeSalesKpis", () => {
  const now = new Date(2026, 8, 13, 15, 30); // samedi 13 septembre 2026
  const docs = [
    paid("2026-09-13T09:00:00", 100), // aujourd'hui
    paid("2026-09-13T23:59:59", 50), // aujourd'hui, dernière seconde
    paid("2026-09-07T00:00:00", 200), // J-6 : dans les 7 jours
    paid("2026-09-06T23:59:59", 999), // J-7 : hors 7 jours, dans le mois
    paid("2026-09-01T00:00:00", 300), // 1er du mois
    paid("2026-08-31T23:59:59", 400), // mois précédent, dans l'exercice civil
    paid("2026-01-01T00:00:00", 10), // 1er janvier : dans l'exercice
    paid("2025-12-31T23:59:59", 5000), // exercice précédent (civil)
    { type: "facture", status: "envoyée", paidAt: "2026-09-13T10:00:00", amount: 777 }, // pas une vente
    { type: "facture", status: "payée", issueDate: "2026-09-13", amount: 20 }, // sans paidAt : date d'émission
    { type: "devis", status: "signé", paidAt: "2026-09-13T10:00:00", amount: 888 }, // pas une facture
  ];
  it("calcule montants et nombres pour les 4 périodes (exercice civil)", () => {
    const k = computeSalesKpis(docs, { now, fiscalStartMonth: 1, amountOf });
    expect(k.today).toEqual({ amount: 170, count: 3 });
    expect(k.last7).toEqual({ amount: 370, count: 4 });
    expect(k.month).toEqual({ amount: 1669, count: 6 });
    expect(k.fiscalYear).toEqual({ amount: 2079, count: 8 });
  });
  it("exercice commençant en septembre : seules les ventes depuis le 1er septembre comptent", () => {
    const k = computeSalesKpis(docs, { now, fiscalStartMonth: 9, amountOf });
    expect(k.fiscalYear).toEqual({ amount: 1669, count: 6 });
  });
  it("changement d'année : le 1er janvier, l'exercice civil ne contient que ce jour", () => {
    const jan1 = new Date(2027, 0, 1, 12, 0);
    const k = computeSalesKpis([paid("2027-01-01T08:00:00", 10), paid("2026-12-31T23:00:00", 20)], { now: jan1, fiscalStartMonth: 1, amountOf });
    expect(k.fiscalYear).toEqual({ amount: 10, count: 1 });
    expect(k.month).toEqual({ amount: 10, count: 1 });
    expect(k.last7).toEqual({ amount: 30, count: 2 });
  });
  it("fuseau horaire : une date ISO en UTC est replacée dans la journée locale", () => {
    // 13 septembre 2026 à 23:30 UTC — selon le fuseau local, c'est encore le 13 ou déjà le 14.
    const utc = new Date("2026-09-13T23:30:00Z");
    const localDay = utc.getDate();
    const nowLocal = new Date(utc.getFullYear(), utc.getMonth(), localDay, 12, 0);
    const k = computeSalesKpis([paid("2026-09-13T23:30:00Z", 42)], { now: nowLocal, fiscalStartMonth: 1, amountOf });
    expect(k.today).toEqual({ amount: 42, count: 1 });
  });
  it("sans amountOf ni documents : zéros partout, jamais d'erreur", () => {
    const k = computeSalesKpis(undefined, { now });
    expect(k.today).toEqual({ amount: 0, count: 0 });
    expect(computeSalesKpis([paid("2026-09-13T09:00:00", 100)], { now }).today).toEqual({ amount: 0, count: 1 });
  });
});
