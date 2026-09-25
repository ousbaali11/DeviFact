// @vitest-environment jsdom
// Enregistrements concurrents : file d'attente des écritures (une à la fois,
// demandes fondues), fusion champ par champ des documents et des clients
// (lignes par identifiant, même champ modifié des deux côtés = version la
// plus récente + note de conflit), scénario complet à deux clients sur une
// base simulée, bandeaux de conflit et de présence, resynchronisation
// générique de l'éditeur.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

// ---- Base simulée (table kv_store) partagée par toutes les instances de l'adaptateur.
const shared = (globalThis.__kvTest ||= { rows: new Map(), user: "user-A", writes: 0, delayMs: 0, seq: 0 });
const rowKey = (f) => `${f.organization_id}|${f.key}|${f.shared}`;
const nextStamp = () => `2026-09-26T10:00:00.${String(++shared.seq).padStart(3, "0")}Z`;
function builder() {
  const st = { op: "select", filters: {}, patch: null, upsertRow: null };
  const b = {
    select() { if (st.op === "select") return b; return b; },
    eq(col, val) { st.filters[col] = val; return b; },
    update(patch) { st.op = "update"; st.patch = patch; return b; },
    upsert(row) { st.op = "upsert"; st.upsertRow = row; return b; },
    delete() { st.op = "delete"; return b; },
    async maybeSingle() { const r = await run(); return { data: r.data?.[0] ?? null, error: null }; },
    then(res, rej) { return run().then(res, rej); },
  };
  async function run() {
    if (shared.delayMs) await new Promise((r) => setTimeout(r, shared.delayMs));
    const matches = [...shared.rows.values()].filter((row) => Object.entries(st.filters).every(([c, v]) => String(row[c]) === String(v)));
    if (st.op === "select") return { data: matches.map((r) => ({ ...r })), error: null };
    if (st.op === "update") {
      shared.writes += 1;
      const out = [];
      for (const row of matches) { Object.assign(row, st.patch, { updated_at: nextStamp() }); out.push({ updated_at: row.updated_at }); }
      return { data: out, error: null };
    }
    if (st.op === "upsert") {
      shared.writes += 1;
      const row = { ...st.upsertRow, updated_at: nextStamp() };
      shared.rows.set(rowKey(row), row);
      return { data: [{ updated_at: row.updated_at }], error: null };
    }
    if (st.op === "delete") { for (const row of matches) shared.rows.delete(rowKey(row)); return { data: [], error: null }; }
    return { data: [], error: null };
  }
  return b;
}
vi.mock("./client.js", () => ({
  db: {
    from: () => builder(),
    auth: { getUser: async () => ({ data: { user: { id: globalThis.__kvTest.user } } }), getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    rpc: async () => ({ data: [], error: null }),
    functions: { invoke: async () => ({ data: {}, error: null }) },
  },
}));

// Une instance de l'adaptateur = un onglet ou un membre (base de fusion propre).
async function client(user) {
  vi.resetModules();
  shared.user = user;
  const mod = await import("./storage-adapter.js");
  mod.setActiveOrganization("org");
  const storage = window.storage;
  return { storage, mod, as: async (fn) => { shared.user = user; return fn(); } };
}
const seed = (value) => { shared.rows.clear(); shared.rows.set("org|documents|false", { organization_id: "org", key: "documents", shared: false, value, updated_at: nextStamp(), created_by: "seed" }); };
const facture = (extra = {}) => ({ id: "d1", type: "facture", docNumber: "FAC-1", status: "envoyée", notes: "n0", chantier: "", client: { name: "Client", email: "a@b.fr", phone: "01" }, items: [{ id: "l1", designation: "Pose", qty: 1, unitPrice: 100 }, { id: "l2", designation: "Fourniture", qty: 2, unitPrice: 50 }], payments: [], updatedAt: 100, ...extra });

beforeEach(() => { shared.rows.clear(); shared.writes = 0; shared.delayMs = 0; });

describe("file d'attente des écritures", () => {
  it("trois enregistrements lancés d'un coup : deux écritures seulement (la dernière valeur absorbe l'intermédiaire), même résultat pour les appelants fondus, valeur finale = la dernière", async () => {
    seed([facture()]);
    const A = await client("user-A");
    await A.storage.get("documents");
    shared.delayMs = 15;
    const v1 = [facture({ notes: "v1" })], v2 = [facture({ notes: "v2" })], v3 = [facture({ notes: "v3" })];
    const [r1, r2, r3] = await Promise.all([A.storage.set("documents", JSON.stringify(v1)), A.storage.set("documents", JSON.stringify(v2)), A.storage.set("documents", JSON.stringify(v3))]);
    expect(shared.writes).toBe(2);
    expect(JSON.parse(r1.value)[0].notes).toBe("v1");
    expect(r2).toBe(r3);
    expect(JSON.parse(r3.value)[0].notes).toBe("v3");
    expect(shared.rows.get("org|documents|false").value[0].notes).toBe("v3");
    expect(A.mod.pendingWrites()).toBe(0);
  });
  it("une écriture en échec ne bloque pas les suivantes", async () => {
    seed([facture()]);
    const A = await client("user-A");
    await A.storage.get("documents");
    const original = shared.rows.get("org|documents|false");
    shared.rows.delete("org|documents|false");
    shared.rows.set("org|documents|false", { ...original, value: "casse" });
    // Première écriture : la ligne a changé (valeur cassée) → fusion impossible → l'adaptateur relit et réécrit quand même
    await A.storage.set("documents", JSON.stringify([facture({ notes: "après" })]));
    expect(shared.rows.get("org|documents|false").value[0].notes).toBe("après");
    expect(A.mod.pendingWrites()).toBe(0);
  });
});

describe("fusion champ par champ", () => {
  let mergeValues;
  beforeAll(async () => { ({ mergeValues } = await import("./storage-adapter.js")); });
  const base = facture();
  it("champs modifiés d'un côté chacun : les deux sont gardés, sans conflit", () => {
    const local = facture({ notes: "local", updatedAt: 200 });
    const remote = facture({ chantier: "Villa", updatedAt: 150 });
    const [m] = mergeValues([base], [local], [remote]);
    expect(m.notes).toBe("local");
    expect(m.chantier).toBe("Villa");
    expect(m.updatedAt).toBe(200);
    expect(m.conflict).toBeUndefined();
  });
  it("même champ modifié des deux côtés : la version la plus récente gagne et le conflit est noté (auteur de l'autre version)", () => {
    const local = facture({ notes: "local", updatedAt: 200 });
    const remote = facture({ notes: "remote", updatedAt: 300 });
    const [m] = mergeValues([base], [local], [remote], "user-B");
    expect(m.notes).toBe("remote");
    expect(m.conflict).toMatchObject({ fields: ["notes"], kept: "remote", otherUpdatedAt: 200, otherWriter: null });
    const [m2] = mergeValues([base], [facture({ notes: "local", updatedAt: 400 })], [remote], "user-B");
    expect(m2.notes).toBe("local");
    expect(m2.conflict).toMatchObject({ fields: ["notes"], kept: "local", otherWriter: "user-B" });
  });
  it("lignes : ajoutée par chacun → les deux ; supprimée ici et modifiée là-bas → la modification gagne ; même ligne modifiée des deux côtés → la plus récente, avec note", () => {
    const local = facture({ updatedAt: 200, items: [...base.items, { id: "l3", designation: "Ajout A", qty: 1, unitPrice: 10 }] });
    const remote = facture({ updatedAt: 150, items: [...base.items, { id: "l4", designation: "Ajout B", qty: 1, unitPrice: 20 }] });
    const [m] = mergeValues([base], [local], [remote]);
    expect(m.items.map((l) => l.id)).toEqual(["l1", "l2", "l3", "l4"]);
    expect(m.conflict).toBeUndefined();
    const del = facture({ updatedAt: 200, items: [base.items[0]] }); // l2 supprimée ici
    const mod = facture({ updatedAt: 150, items: [base.items[0], { ...base.items[1], qty: 5 }] }); // l2 modifiée là-bas
    const [m2] = mergeValues([base], [del], [mod]);
    expect(m2.items.map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(m2.items[1].qty).toBe(5);
    const a = facture({ updatedAt: 200, items: [base.items[0], { ...base.items[1], qty: 7 }] });
    const b = facture({ updatedAt: 300, items: [base.items[0], { ...base.items[1], qty: 9 }] });
    const [m3] = mergeValues([base], [a], [b]);
    expect(m3.items[1].qty).toBe(9);
    expect(m3.conflict.fields).toEqual(["ligne Fourniture"]);
  });
  it("paiement ajouté ailleurs pendant une modification ici : jamais perdu ; note de conflit précédente conservée tant qu'elle n'est pas fermée", () => {
    const local = facture({ notes: "local", updatedAt: 200, conflict: { at: 1, fields: ["chantier"], kept: "local" } });
    const remote = facture({ updatedAt: 150, payments: [{ id: "p1", amount: 50, date: "2026-09-26" }] });
    const [m] = mergeValues([base], [local], [remote]);
    expect(m.notes).toBe("local");
    expect(m.payments).toEqual([{ id: "p1", amount: 50, date: "2026-09-26" }]);
    expect(m.conflict).toEqual({ at: 1, fields: ["chantier"], kept: "local" });
  });
  it("clients : téléphone changé ici, e-mail changé là-bas → les deux ; pas de note de conflit sur une fiche client", () => {
    const cb = { id: "c1", name: "Dupont", email: "a@b.fr", phone: "01", updatedAt: 10 };
    const [m] = mergeValues([cb], [{ ...cb, phone: "06", updatedAt: 20 }], [{ ...cb, email: "z@b.fr", updatedAt: 15 }]);
    expect(m).toMatchObject({ phone: "06", email: "z@b.fr", updatedAt: 20 });
    const [m2] = mergeValues([cb], [{ ...cb, email: "x@b.fr", updatedAt: 20 }], [{ ...cb, email: "y@b.fr", updatedAt: 30 }]);
    expect(m2.email).toBe("y@b.fr");
    expect(m2.conflict).toBeUndefined();
  });
});

describe("scénario à deux clients", () => {
  it("A change les notes, B change l'e-mail du client : les deux changements sont enregistrés ; puis les deux changent les notes : la plus récente gagne, conflit noté avec l'auteur", async () => {
    seed([facture()]);
    const A = await client("user-A");
    const B = await client("user-B");
    await A.as(() => A.storage.get("documents"));
    await B.as(() => B.storage.get("documents"));
    const resA = await A.as(() => A.storage.set("documents", JSON.stringify([facture({ notes: "de A", updatedAt: 200 })])));
    expect(resA.merged).toBe(false);
    const resB = await B.as(() => B.storage.set("documents", JSON.stringify([facture({ client: { name: "Client", email: "nouveau@b.fr", phone: "01" }, updatedAt: 210 })])));
    expect(resB.merged).toBe(true);
    const stored = shared.rows.get("org|documents|false").value[0];
    expect(stored.notes).toBe("de A");
    expect(stored.client.email).toBe("nouveau@b.fr");
    expect(stored.conflict).toBeUndefined();
    // Second tour : A (base périmée) et B modifient les notes.
    const resA2 = await A.as(() => A.storage.set("documents", JSON.stringify([facture({ notes: "A encore", updatedAt: 300 })])));
    expect(resA2.merged).toBe(true); // A ne connaissait pas l'e-mail de B : repris
    expect(JSON.parse(resA2.value)[0].client.email).toBe("nouveau@b.fr");
    const resB2 = await B.as(() => B.storage.set("documents", JSON.stringify([{ ...JSON.parse(resB.value)[0], notes: "B encore", updatedAt: 400 }])));
    const final = JSON.parse(resB2.value)[0];
    expect(final.notes).toBe("B encore");
    expect(final.conflict).toMatchObject({ fields: ["notes"], kept: "local", otherWriter: "user-A" });
    expect(shared.rows.get("org|documents|false").value[0].notes).toBe("B encore");
  });
});

describe("éditeur", () => {
  let Editor, newDocument, emptyCompanyProfile, PLANS;
  beforeAll(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
    window.scrollTo = () => {};
    ({ Editor, newDocument, emptyCompanyProfile, PLANS } = await import("./App.jsx"));
  });
  const noop = () => {};
  const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@exemple.fr", memberships: [] };
  const props = () => ({ saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, products: [], stockByProduct: {}, clients: [], companyProfile: emptyCompanyProfile(), onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop });
  async function mount(element) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(element); });
    return { container, root, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
  }
  const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  it("note de conflit : bandeau avec l'auteur, la date et les champs ; « Vu » l'efface (enregistré)", async () => {
    const changes = [];
    const doc = { ...newDocument("devis", []), conflict: { at: Date.parse("2026-09-26T09:30:00Z"), fields: ["notes", "ligne Pose"], kept: "remote", otherUpdatedAt: 1, otherWriter: "user-B" } };
    const { container, unmount } = await mount(<Editor {...props()} doc={doc} onChange={(p) => changes.push(p)} memberLabelOf={(id) => (id === "user-B" ? "Marie Dupont" : "")} />);
    const banner = container.querySelector('[data-testid="conflict-banner"]');
    expect(banner.textContent).toContain("Modifié en même temps par Marie Dupont");
    expect(banner.textContent).toContain("notes, ligne Pose");
    expect(banner.textContent).toContain("(la sienne)");
    await click(container.querySelector('[data-testid="conflict-dismiss"]'));
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(changes.at(-1)).toEqual({ conflict: null });
    expect(container.querySelector('[data-testid="conflict-banner"]')).toBeNull();
    await unmount();
  }, 30000);
  it("présence : « X modifie aussi ce document », accord au pluriel ; rien sans présence", async () => {
    const a = await mount(<Editor {...props()} doc={newDocument("facture", [])} presence={[{ userId: "b", name: "Marie", docId: "x" }]} />);
    expect(a.container.querySelector('[data-testid="presence-banner"]').textContent).toContain("Marie modifie aussi ce document");
    await a.unmount();
    const b = await mount(<Editor {...props()} doc={newDocument("facture", [])} presence={[{ userId: "b", name: "Marie", docId: "x" }, { userId: "c", name: "Paul", docId: "x" }]} />);
    expect(b.container.querySelector('[data-testid="presence-banner"]').textContent).toContain("Marie, Paul modifient aussi");
    await b.unmount();
    const c = await mount(<Editor {...props()} doc={newDocument("facture", [])} />);
    expect(c.container.querySelector('[data-testid="presence-banner"]')).toBeNull();
    await c.unmount();
  }, 30000);
  it("resynchronisation générique : un champ changé ailleurs (chantier) est repris par l'éditeur ouvert", async () => {
    const doc = { ...newDocument("facture", []), chantier: "Avant" };
    const p = props();
    const { container, root, unmount } = await mount(<Editor {...p} doc={doc} />);
    const input = () => container.querySelector('input[placeholder="Ex : Rénovation cuisine Dupont"]');
    expect(input().value).toBe("Avant");
    await act(async () => { root.render(<Editor {...p} doc={{ ...doc, chantier: "Après fusion", updatedAt: Date.now() }} />); });
    expect(input().value).toBe("Après fusion");
    await unmount();
  }, 30000);
});
