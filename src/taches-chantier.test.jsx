// @vitest-environment jsdom
// Priorité 8 : liste de tâches par chantier (pense-bête : texte libre, case
// fait / à faire, échéance optionnelle), onglet « Tâches » de la fiche
// chantier, ligne sur la carte du chantier, stockage partagé de
// l'organisation (clé kv « chantier-tasks »).
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("./client.js", () => ({
  db: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => { throw new Error("pas d'accès base attendu"); },
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
import { AtelierChantierView, AtelierChantiersView, chantierTasksOf, chantierTaskCounts, taskIsOverdue, newDocument } from "./App.jsx";

const store = {};
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {};
  window.storage = {
    get: async (key) => { if (!(key in store)) { const e = new Error("absent"); e.code = "KEY_NOT_FOUND"; throw e; } return { value: JSON.stringify(store[key]) }; },
    set: async (key, value) => { store[key] = JSON.parse(value); return {}; },
  };
});
beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const inDays = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return iso(d); };
const today = iso(new Date());
const task = (id, extra = {}) => ({ id, chantier: "Maison Dupont", text: `Tâche ${id}`, done: false, dueDate: "", createdAt: Number(id.replace(/\D/g, "")) || 0, updatedAt: 0, doneAt: null, ...extra });
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const noop = () => {};
const docs = [{ ...newDocument("devis", []), id: "d1", docNumber: "DEV-1", chantier: "Maison Dupont", status: "signé", items: [{ id: "l", type: "line", designation: "Pose", qty: 1, unitPrice: 100, tva: 20 }] }];
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
function setValue(input, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const tabButton = (c, label) => [...c.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(label));

describe("tri, compteurs, retard", () => {
  it("à faire d'abord (échéance la plus proche puis création), faites ensuite ; nom insensible à la casse ; compteurs", () => {
    const tasks = [
      task("t3"), // sans échéance, créée en 3e
      task("t1", { dueDate: inDays(5) }),
      task("t2", { dueDate: inDays(-2) }), // en retard
      task("t4", { done: true, doneAt: 10 }),
      task("t5", { done: true, doneAt: 20 }),
      task("t6", { chantier: "maison dupont", dueDate: inDays(1) }),
      task("t7", { chantier: "Autre" }),
    ];
    expect(chantierTasksOf(tasks, "MAISON DUPONT").map((t) => t.id)).toEqual(["t2", "t6", "t1", "t3", "t5", "t4"]);
    expect(chantierTaskCounts(tasks, "Maison Dupont", today)).toEqual({ open: 4, overdue: 1, done: 2 });
    expect(taskIsOverdue(task("x", { dueDate: today }), today)).toBe(false); // le jour même n'est pas en retard
    expect(taskIsOverdue(task("x", { dueDate: inDays(-1), done: true }), today)).toBe(false);
    expect(chantierTasksOf(tasks, "")).toEqual([]);
  });
});

describe("fiche chantier : onglet Tâches", () => {
  const props = { name: "Maison Dupont", documents: docs, account, darkMode: false, isLocked: false, isViewer: false, onBack: noop, onOpenDoc: noop, onCreateForChantier: noop };
  it("ajout, cochage, modification et suppression, enregistrés dans la clé partagée", async () => {
    store["chantier-tasks"] = [task("t1", { dueDate: inDays(-3) }), task("t2", { chantier: "Autre" })];
    window.confirm = () => true;
    const { container, unmount } = await mount(<AtelierChantierView {...props} />);
    await click(tabButton(container, "Tâches (1)"));
    const rows = () => [...container.querySelectorAll('[data-testid="chantier-task"]')];
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("en retard");
    // Ajout avec échéance.
    await act(async () => { setValue(container.querySelector('input[aria-label="Nouvelle tâche"]'), "Commander les tuiles"); });
    await act(async () => { setValue(container.querySelector('input[aria-label="Échéance de la nouvelle tâche"]'), inDays(3)); });
    await click([...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Ajouter"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(store["chantier-tasks"]).toHaveLength(3);
    expect(store["chantier-tasks"][2]).toMatchObject({ chantier: "Maison Dupont", text: "Commander les tuiles", done: false, dueDate: inDays(3) });
    expect(rows()).toHaveLength(2);
    expect(tabButton(container, "Tâches (2)")).toBeTruthy();
    // Cochage : passe en fait, en bas de liste, barrée.
    await click(container.querySelector('input[aria-label="Terminer : Tâche t1"]'));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(store["chantier-tasks"].find((t) => t.id === "t1")).toMatchObject({ done: true });
    expect(rows()[1].getAttribute("data-done")).toBe("1");
    expect(rows()[1].textContent).toContain("Fait le");
    expect(tabButton(container, "Tâches (1)")).toBeTruthy();
    // Modification du texte de la tâche restante.
    await click([...rows()[0].querySelectorAll("button")].find((b) => b.title === "Modifier"));
    await act(async () => { setValue(container.querySelector('input[aria-label="Texte de la tâche"]'), "Commander les tuiles rouges"); });
    await click([...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "OK"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(store["chantier-tasks"].find((t) => t.text === "Commander les tuiles rouges")).toBeTruthy();
    // Suppression.
    await click(container.querySelector('button[aria-label="Supprimer : Commander les tuiles rouges"]'));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(store["chantier-tasks"].map((t) => t.id)).toEqual(["t1", "t2"]);
    await unmount();
  }, 30000);
  it("lecteur : liste visible, aucun formulaire, cases inactives ; chantier sans tâche : message", async () => {
    store["chantier-tasks"] = [task("t1")];
    const a = await mount(<AtelierChantierView {...props} isViewer />);
    await click(tabButton(a.container, "Tâches (1)"));
    expect(a.container.querySelector('input[aria-label="Nouvelle tâche"]')).toBeNull();
    expect(a.container.querySelector('[data-testid="chantier-task"] input[type="checkbox"]').disabled).toBe(true);
    expect(a.container.querySelector('button[aria-label^="Supprimer :"]')).toBeNull();
    await a.unmount();
    const b = await mount(<AtelierChantierView {...props} name="Vide" />);
    await click(tabButton(b.container, "Tâches (0)"));
    expect(b.container.querySelector('[data-testid="chantier-tasks-empty"]')).toBeTruthy();
    await b.unmount();
  }, 30000);
});

describe("liste des chantiers", () => {
  it("ligne « N tâches à faire, dont N en retard » sur la carte, rien quand tout est fait", async () => {
    store["chantier-tasks"] = [task("t1", { dueDate: inDays(-1) }), task("t2"), task("t3", { done: true, doneAt: 1 }), task("t4", { chantier: "Garage", done: true, doneAt: 1 })];
    const documents = [...docs, { ...docs[0], id: "d2", docNumber: "DEV-2", chantier: "Garage" }];
    const { container, unmount } = await mount(<AtelierChantiersView documents={documents} account={account} siteSettings={{ name: "Chantiflow" }} darkMode={false} isLocked={false} isViewer={false} onOpenChantier={noop} onNewChantier={noop} />);
    const lines = [...container.querySelectorAll('[data-testid="chantier-tasks-line"]')].map((l) => l.textContent.trim());
    expect(lines).toEqual(["2 tâches à faire, dont 1 en retard"]);
    await unmount();
  }, 30000);
});
