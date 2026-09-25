// @vitest-environment jsdom
// Priorité 4 de la feuille de route : garanties légales après PV de
// réception (parfait achèvement 1 an, biennale 2 ans, décennale 10 ans
// depuis la date de réception), affichées sur la fiche chantier, alerte à
// 30 jours sur le tableau de bord (tous forfaits) et badge sur la liste des
// chantiers ; champ « Chantier » du PV.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./client.js", () => ({
  db: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => { throw new Error("pas d'accès base attendu"); },
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
import { pvWarrantiesOf, chantierWarranties, warrantyAlerts, WARRANTY_ALERT_DAYS, computePvGaranties, newPvReceptionDocument, AtelierHome, AtelierChantiersView, AtelierChantierView, PvReceptionEditor, PrintPvReception, PLANS } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null; });

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const clean = (s) => s.replace(/[  ]/g, " ");
// Réception « il y a un an moins N jours » : le parfait achèvement expire dans N jours.
function receptionDaysBeforeYear(daysLeft) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() + daysLeft);
  return iso(d);
}
const pv = (extra = {}) => ({ ...newPvReceptionDocument([]), id: "pv1", docNumber: "PV-003", workStage: "termine", status: "envoyé", chantier: "Maison Dupont", dateReceptionEffective: "2025-10-20", typeReception: "sans_reserves", client: { type: "particulier", name: "M. Dupont" }, ...extra });
const today = new Date(2026, 8, 25); // 25 septembre 2026
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const noop = () => {};
const account = { id: "u", organizationId: null, plan: "gratuit", paymentStatus: "gratuit", role: "owner", email: "t@e.fr", memberships: [] };

describe("calcul des garanties", () => {
  it("réception le 20/10/2025, le 25/09/2026 : parfait achèvement expire dans 25 j (alerte), biennale et décennale en cours", () => {
    const w = pvWarrantiesOf(pv(), today);
    expect(w).toMatchObject({ docId: "pv1", docNumber: "PV-003", chantier: "Maison Dupont", dateReception: "2025-10-20" });
    expect(w.items.map((i) => [i.key, i.endIso, i.daysLeft, i.state])).toEqual([
      ["parfaitAchevement", "2026-10-20", 25, "expire_bientot"],
      ["biennale", "2027-10-20", 390, "en_cours"],
      ["decennale", "2035-10-20", 3312, "en_cours"],
    ]);
    expect(WARRANTY_ALERT_DAYS).toBe(30);
  });
  it("PV non enregistré, réception refusée ou sans date : aucune garantie ; garantie passée : expirée", () => {
    expect(pvWarrantiesOf(pv({ workStage: "brouillon" }), today)).toBeNull();
    expect(pvWarrantiesOf(pv({ typeReception: "refusee" }), today)).toBeNull();
    expect(pvWarrantiesOf(pv({ dateReceptionEffective: "" }), today)).toBeNull();
    expect(pvWarrantiesOf({ type: "facture", workStage: "termine" }, today)).toBeNull();
    const old = pvWarrantiesOf(pv({ dateReceptionEffective: "2024-09-01" }), today);
    expect(old.items[0]).toMatchObject({ state: "expiree", endIso: "2025-09-01" });
    expect(old.items[1]).toMatchObject({ state: "expiree", endIso: "2026-09-01" }); // biennale passée depuis 24 jours
    expect(old.items[2]).toMatchObject({ state: "en_cours", endIso: "2034-09-01" });
  });
  it("date de réception lue en heure locale (pas de décalage d'un jour)", () => {
    const g = computePvGaranties(pv({ dateReceptionEffective: "2026-01-01" }));
    expect(iso(g.parfaitAchevement)).toBe("2027-01-01");
    expect(iso(g.decennale)).toBe("2036-01-01");
  });
  it("garanties d'un chantier : PV rattachés (nom insensible à la casse), réception la plus ancienne d'abord", () => {
    const docs = [pv({ id: "b", docNumber: "PV-004", chantier: "maison dupont", dateReceptionEffective: "2026-03-01" }), pv(), pv({ id: "c", chantier: "Autre" }), pv({ id: "d", workStage: "brouillon" })];
    expect(chantierWarranties(docs, "MAISON DUPONT", today).map((w) => w.docNumber)).toEqual(["PV-003", "PV-004"]);
    expect(chantierWarranties(docs, "", today)).toEqual([]);
  });
  it("alertes : garanties à 30 jours ou moins, les plus proches d'abord, PV sans chantier inclus, expirées exclues", () => {
    const docs = [
      pv(), // parfait achèvement dans 25 j
      pv({ id: "p0", docNumber: "PV-010", chantier: "", dateReceptionEffective: "2025-09-25" }), // expire aujourd'hui
      pv({ id: "p2", docNumber: "PV-011", chantier: "Garage", dateReceptionEffective: "2024-10-05" }), // biennale dans 10 j, parfait achèvement expiré
      pv({ id: "p3", docNumber: "PV-012", chantier: "Loin", dateReceptionEffective: "2026-06-01" }), // rien avant 2027
    ];
    const alerts = warrantyAlerts(docs, today);
    expect(alerts.map((a) => [a.docNumber, a.key, a.daysLeft, a.chantier])).toEqual([
      ["PV-010", "parfaitAchevement", 0, ""],
      ["PV-011", "biennale", 10, "Garage"],
      ["PV-003", "parfaitAchevement", 25, "Maison Dupont"],
    ]);
  });
});

describe("fiche et liste des chantiers", () => {
  const live = pv({ dateReceptionEffective: receptionDaysBeforeYear(25) });
  it("onglet « Garanties » : les trois garanties du PV avec leur date de fin et leur état", async () => {
    const opened = [];
    const { container, unmount } = await mount(<AtelierChantierView name="Maison Dupont" documents={[live]} account={account} darkMode={false} isLocked={false} isViewer={false} onBack={noop} onOpenDoc={(id) => opened.push(id)} onCreateForChantier={noop} />);
    const tab = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Garanties (1)");
    expect(tab).toBeTruthy();
    await click(tab);
    const block = container.querySelector('[data-testid="warranties"]');
    const text = clean(block.textContent);
    expect(text).toContain("PV de réception PV-003");
    expect(text).toContain("Parfait achèvement (1 an)");
    expect(text).toContain("Expire dans 25 j");
    expect(text).toContain("Biennale (2 ans)");
    expect(text).toContain("Décennale (10 ans)");
    expect((text.match(/En cours/g) || []).length).toBe(2);
    await click(block.querySelector("button"));
    expect(opened).toEqual(["pv1"]);
    await unmount();
  }, 30000);
  it("sans PV rattaché : message d'explication", async () => {
    const { container, unmount } = await mount(<AtelierChantierView name="Vide" documents={[live]} account={account} darkMode={false} isLocked={false} isViewer={false} onBack={noop} onOpenDoc={noop} onCreateForChantier={noop} />);
    await click([...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Garanties (0)"));
    expect(container.querySelector('[data-testid="warranties-empty"]').textContent).toContain("champ « Chantier » du PV");
    await unmount();
  }, 30000);
  it("liste des chantiers : badge sur la carte dont une garantie expire dans 30 jours", async () => {
    const { container, unmount } = await mount(<AtelierChantiersView documents={[live, { ...live, id: "f", type: "facture", chantier: "Sans garantie", items: [] }]} account={account} siteSettings={{ name: "Chantiflow" }} darkMode={false} isLocked={false} isViewer={false} onOpenChantier={noop} onNewChantier={noop} />);
    const badges = [...container.querySelectorAll('[data-testid="chantier-warranty-badge"]')];
    expect(badges).toHaveLength(1);
    expect(clean(badges[0].textContent)).toContain("Garantie de parfait achèvement : expire dans 25 j");
    await unmount();
  }, 30000);
});

describe("tableau de bord : alerte à 30 jours, tous forfaits", () => {
  const live = pv({ dateReceptionEffective: receptionDaysBeforeYear(12) });
  const props = { documents: [live, { ...live, id: "p0", docNumber: "PV-020", chantier: "" }], darkMode: false, isLocked: false, isViewer: false, freeLimit: 10, freeLimitReached: false, offlineMode: false, visibleServices: ["devis", "facture", "pv_reception"], reminders: [], reminderMailto: () => "#", onCreate: noop, onOpenCreate: noop, onGoToDocuments: noop, onGoToPricing: noop, autoFactureNotice: null, onOpenAutoFacture: noop, onDismissAutoFacture: noop, reviewNotice: null, onSendReview: noop, onDismissReview: noop };
  it("forfait Gratuit : l'alerte s'affiche malgré le verrou des relances ; clic vers la fiche chantier, ou vers le PV sans chantier", async () => {
    const chantiers = [], docs = [];
    const { container, unmount } = await mount(<AtelierHome {...props} account={account} onOpenDoc={(id) => docs.push(id)} onOpenChantier={(n) => chantiers.push(n)} />);
    const block = container.querySelector('[data-testid="warranty-alerts"]');
    expect(block).toBeTruthy();
    const text = clean(block.textContent);
    expect(text).toContain("Garantie de parfait achèvement · Maison Dupont");
    expect(text).toContain("Expire dans 12 j");
    expect(text).toContain("PV PV-020 (chantier non renseigné)");
    expect(container.textContent).toContain("réservées aux forfaits Pro et Entreprise"); // le verrou des relances reste
    const buttons = [...block.querySelectorAll("button")];
    await click(buttons[0]);
    await click(buttons[1]);
    expect(chantiers).toEqual(["Maison Dupont"]);
    expect(docs).toEqual(["p0"]);
    await unmount();
  }, 30000);
  it("aucune garantie proche : pas de bloc", async () => {
    const { container, unmount } = await mount(<AtelierHome {...props} documents={[pv({ dateReceptionEffective: iso(new Date()) })]} account={{ ...account, plan: "pro", paymentStatus: "payé" }} onOpenDoc={noop} />);
    expect(container.querySelector('[data-testid="warranty-alerts"]')).toBeNull();
    await unmount();
  }, 30000);
});

describe("PV de réception : champ Chantier", () => {
  it("l'éditeur propose les chantiers existants et enregistre le chantier ; il est imprimé sur le PV", async () => {
    const changes = [];
    const doc = { ...newPvReceptionDocument([]), docNumber: "PV-005" };
    const { container, unmount } = await mount(<PvReceptionEditor doc={doc} saving={false} account={account} plans={PLANS} siteSettings={{ name: "Chantiflow" }} isLocked={false} isViewer={false} onChange={(p) => changes.push(p)} onFinalize={noop} onBack={noop} onGoToPricing={noop} clients={[]} chantierNames={["Garage", "Maison Dupont"]} />);
    const input = container.querySelector('input[aria-label="Chantier"]');
    expect(input).toBeTruthy();
    expect([...container.querySelectorAll(`datalist#${input.getAttribute("list")} option`)].map((o) => o.value)).toEqual(["Garage", "Maison Dupont"]);
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "Maison Dupont");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(changes[changes.length - 1]).toMatchObject({ chantier: "Maison Dupont" });
    await unmount();
    const html = renderToStaticMarkup(<PrintPvReception doc={pv({ chantier: "Maison Dupont", lieuChantier: "12 rue des Lilas" })} siteSettings={{ name: "Chantiflow" }} watermarkEnabled={false} photoUrls={{}} />);
    const text = new DOMParser().parseFromString(html, "text/html").body.textContent;
    expect(text).toContain("Chantier : Maison Dupont");
    expect(text).toContain("Lieu du chantier : 12 rue des Lilas");
  }, 30000);
});
