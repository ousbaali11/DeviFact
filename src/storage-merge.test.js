// @vitest-environment jsdom
// Écritures concurrentes sur kv_store : fusion à trois versions des listes
// (documents, clients) et écriture conditionnelle — le dernier à
// enregistrer n'écrase plus le travail de l'autre.
import { describe, it, expect, beforeEach, vi } from "vitest";

// Base simulée : une ligne kv_store en mémoire, avec updated_at.
const store = { row: null, updateCalls: 0, upsertCalls: 0 };
function builder(kind, payload) {
  const filters = {};
  const b = {};
  ["select", "like"].forEach((m) => { b[m] = () => b; });
  b.eq = (col, val) => { filters[col] = val; return b; };
  b.maybeSingle = async () => ({ data: store.row ? { value: store.row.value, updated_at: store.row.updated_at } : null, error: null });
  b.then = (res, rej) => {
    let out;
    if (kind === "update") {
      store.updateCalls += 1;
      if (store.row && filters.updated_at === store.row.updated_at) {
        store.row = { ...store.row, value: payload.value, updated_at: payload.updated_at };
        out = { data: [{ updated_at: store.row.updated_at }], error: null };
      } else out = { data: [], error: null };
    } else if (kind === "upsert") {
      store.upsertCalls += 1;
      store.row = { value: payload.value, updated_at: payload.updated_at };
      out = { data: [{ updated_at: store.row.updated_at }], error: null };
    } else if (kind === "delete") { store.row = null; out = { data: null, error: null }; }
    else out = { data: [], error: null };
    return Promise.resolve(out).then(res, rej);
  };
  return b;
}
vi.mock("./client.js", () => ({
  db: {
    from: () => ({
      select: () => builder("select"),
      update: (payload) => builder("update", payload),
      upsert: (payload) => builder("upsert", payload),
      delete: () => builder("delete"),
    }),
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  },
}));
import { mergeValues, setActiveOrganization } from "./storage-adapter.js";

const doc = (id, updatedAt, extra = {}) => ({ id, docNumber: `D-${id}`, updatedAt, ...extra });

describe("mergeValues", () => {
  const base = [doc("a", 1), doc("b", 1), doc("c", 1)];
  it("ajouts des deux côtés conservés, suppression d'un côté respectée, modification gagne sur suppression", () => {
    const local = [doc("a", 1), doc("b", 5, { notes: "modifié ici" }), doc("x", 6)]; // c supprimé ici, x ajouté ici
    const remote = [doc("a", 1), doc("c", 7, { notes: "modifié là-bas" }), doc("y", 8)]; // b supprimé là-bas, y ajouté là-bas
    const out = mergeValues(base, local, remote);
    expect(out.map((d) => d.id).sort()).toEqual(["a", "b", "c", "x", "y"]);
    expect(out.find((d) => d.id === "b").notes).toBe("modifié ici"); // supprimé à distance mais modifié ici
    expect(out.find((d) => d.id === "c").notes).toBe("modifié là-bas"); // supprimé ici mais modifié à distance
  });
  it("supprimé d'un côté et inchangé de l'autre : disparaît ; modifié des deux côtés : le plus récent gagne", () => {
    const local = [doc("a", 9, { notes: "local" }), doc("b", 1)]; // c supprimé ici
    const remote = [doc("a", 12, { notes: "distant" }), doc("b", 1)]; // c supprimé là-bas aussi
    const out = mergeValues(base, local, remote);
    expect(out.map((d) => d.id)).toEqual(["a", "b"]);
    expect(out[0].notes).toBe("distant");
    expect(mergeValues(base, [doc("a", 20, { notes: "local" }), doc("b", 1), doc("c", 1)], remote)[0].notes).toBe("local");
  });
  it("sans base connue : union, la version locale gagne ; valeurs non listées : locale", () => {
    expect(mergeValues(null, [doc("a", 1, { n: "L" })], [doc("a", 1, { n: "R" }), doc("z", 1)]).map((d) => d.n || d.id)).toEqual(["L", "z"]);
    expect(mergeValues(null, { name: "moi" }, { name: "autre" })).toEqual({ name: "moi" });
    expect(mergeValues([], [], [doc("k", 1)])).toEqual([doc("k", 1)]);
  });
});

describe("adaptateur : écriture conditionnelle et fusion", () => {
  beforeEach(() => { store.row = null; store.updateCalls = 0; store.upsertCalls = 0; setActiveOrganization("org"); });
  it("lecture puis écriture sans conflit : mise à jour conditionnelle, aucune fusion", async () => {
    store.row = { value: [doc("a", 1)], updated_at: "T1" };
    await window.storage.get("documents");
    const res = await window.storage.set("documents", JSON.stringify([doc("a", 2, { notes: "x" })]));
    expect(res.merged).toBe(false);
    expect(store.updateCalls).toBe(1);
    expect(store.upsertCalls).toBe(0);
    expect(store.row.value[0].notes).toBe("x");
  });
  it("un autre membre a enregistré entre-temps : fusion, puis écriture réussie, valeur fusionnée renvoyée", async () => {
    store.row = { value: [doc("a", 1)], updated_at: "T1" };
    await window.storage.get("documents");
    // L'autre membre ajoute b
    store.row = { value: [doc("a", 1), doc("b", 3)], updated_at: "T2" };
    const res = await window.storage.set("documents", JSON.stringify([doc("a", 1), doc("c", 4)]));
    expect(res.merged).toBe(true);
    const saved = JSON.parse(res.value);
    expect(saved.map((d) => d.id).sort()).toEqual(["a", "b", "c"]);
    expect(store.row.value.map((d) => d.id).sort()).toEqual(["a", "b", "c"]);
    expect(store.upsertCalls).toBe(0);
  });
  it("première écriture de la session alors qu'une ligne existe : union au lieu d'écraser", async () => {
    store.row = { value: [doc("r", 1)], updated_at: "T1" };
    const res = await window.storage.set("clients", JSON.stringify([doc("l", 2)]));
    expect(res.merged).toBe(true);
    expect(JSON.parse(res.value).map((d) => d.id).sort()).toEqual(["l", "r"]);
  });
  it("aucune ligne : création", async () => {
    const res = await window.storage.set("documents", JSON.stringify([doc("a", 1)]));
    expect(res.merged).toBe(false);
    expect(store.upsertCalls).toBe(1);
    expect(store.row.value).toEqual([doc("a", 1)]);
  });
});

describe("mergeValues — paiements reçus", () => {
  const facture = (updatedAt, extra = {}) => ({ id: "f1", type: "facture", status: "envoyée", notes: "", payments: [{ id: "p1", amount: 30 }], updatedAt, ...extra });
  it("paiement en ligne enregistré par le serveur pendant une modification locale : conservé même si la version locale gagne", () => {
    const base = [facture(10)];
    const local = [facture(50, { notes: "note tapée" })];
    const remote = [facture(20, { payments: [{ id: "p1", amount: 30 }, { id: "pay_stripe_cs_9", amount: 9 }] })];
    const out = mergeValues(base, local, remote);
    expect(out[0].notes).toBe("note tapée");
    expect(out[0].payments.map((p) => p.id)).toEqual(["p1", "pay_stripe_cs_9"]);
    expect(out[0].status).toBe("envoyée");
  });
  it("paiement ajouté localement pendant que le serveur soldait la facture : les deux gardés, statut « payée » repris", () => {
    const base = [facture(10)];
    const local = [facture(20, { payments: [{ id: "p1", amount: 30 }, { id: "p2", amount: 10 }] })];
    const remote = [facture(50, { status: "payée", paidAt: "2026-09-22T10:00:00Z", payments: [{ id: "p1", amount: 30 }, { id: "pay_stripe_cs_9", amount: 90 }] })];
    const out = mergeValues(base, local, remote);
    expect(out[0].payments.map((p) => p.id)).toEqual(["p1", "pay_stripe_cs_9", "p2"]);
    expect(out[0].status).toBe("payée");
  });
  it("paiement retiré d'un côté : le retrait du vainqueur est respecté, pas de résurrection", () => {
    const base = [facture(10)];
    const local = [facture(50, { payments: [] })];
    const remote = [facture(20, { notes: "autre" })];
    expect(mergeValues(base, local, remote)[0].payments).toEqual([]);
  });
  it("statut « payée » de l'autre version non repris si ses paiements ne sont pas tous là", () => {
    const base = [facture(10)];
    const local = [facture(50, { payments: [] })];
    const remote = [facture(20, { status: "payée", payments: [{ id: "p1", amount: 30 }, { id: "pay_stripe_cs_9", amount: 90 }] })];
    const out = mergeValues(base, local, remote);
    expect(out[0].payments.map((p) => p.id)).toEqual(["pay_stripe_cs_9"]);
    expect(out[0].status).toBe("envoyée");
  });
});
