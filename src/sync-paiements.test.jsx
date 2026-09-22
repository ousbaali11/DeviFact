// @vitest-environment node
// Rapprochement des paiements en ligne auprès de Stripe, sans dépendre du
// webhook (supabase/functions/_shared/online-payments.ts) : les sessions
// payées du compte connecté sont enregistrées sur les factures (même
// identifiant que le webhook, donc jamais de doublon), le verrou du lien
// public est levé, le lien est clôturé quand la facture est soldée.
import { describe, it, expect } from "vitest";
import { syncOnlinePayments, isPaidInvoiceSession } from "../supabase/functions/_shared/online-payments.ts";

// Base simulée : une ligne kv_store (documents) avec écriture conditionnelle
// sur updated_at, et la trace des mises à jour de public_document_links.
function makeDb(docs) {
  const state = { kv: { value: docs, updated_at: "t1" }, links: [], writes: 0 };
  const db = {
    state,
    from(table) {
      const q = { op: "select", payload: null, filters: {}, isNull: {} };
      const run = () => {
        if (table === "kv_store") {
          if (q.op === "select") return { value: structuredClone(state.kv.value), updated_at: state.kv.updated_at };
          state.writes += 1;
          if (q.filters.updated_at !== state.kv.updated_at) return [];
          state.kv = { value: q.payload.value, updated_at: q.payload.updated_at };
          return [{ updated_at: state.kv.updated_at }];
        }
        if (table === "public_document_links") { state.links.push({ payload: q.payload, filters: { ...q.filters }, isNull: { ...q.isNull } }); return []; }
        return null;
      };
      const b = {
        select() { return b; },
        update(payload) { q.op = "update"; q.payload = payload; return b; },
        eq(col, val) { q.filters[col] = val; return b; },
        is(col, val) { q.isNull[col] = val; return b; },
        async maybeSingle() { return { data: run(), error: null }; },
        then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
      };
      return b;
    },
  };
  return db;
}
function makeStripe(sessions) {
  const calls = [];
  return { calls, checkout: { sessions: { list: async (params, opts) => { calls.push({ params, opts }); return { data: sessions }; } } } };
}
const line = { id: "l1", type: "line", designation: "Pose", details: [], qty: 1, unitPrice: 1000, tva: 20, discount: 0 };
const facture = (extra = {}) => ({ id: "d1", type: "facture", docNumber: "F-001", status: "envoyée", currency: "EUR", items: [line], payments: [], updatedAt: 1, ...extra });
const session = (extra = {}) => ({ id: "cs_9", status: "complete", payment_status: "paid", created: 1790092517, amount_total: 900, metadata: { kind: "invoice_payment", organizationId: "org", documentId: "d1", linkId: "L1" }, ...extra });

describe("isPaidInvoiceSession", () => {
  it("session payée d'une facture de cette organisation seulement", () => {
    expect(isPaidInvoiceSession(session(), "org")).toBe(true);
    expect(isPaidInvoiceSession(session(), "org", "d1")).toBe(true);
    expect(isPaidInvoiceSession(session(), "org", "autre")).toBe(false);
    expect(isPaidInvoiceSession(session(), "org2")).toBe(false);
    expect(isPaidInvoiceSession(session({ payment_status: "unpaid" }), "org")).toBe(false);
    expect(isPaidInvoiceSession(session({ metadata: { kind: "subscription", organizationId: "org" } }), "org")).toBe(false);
    expect(isPaidInvoiceSession(null, "org")).toBe(false);
  });
});

describe("syncOnlinePayments", () => {
  it("paiement partiel de 9 € manquant : enregistré à la date de la session, verrou du lien levé, facture pas soldée", async () => {
    const db = makeDb([facture(), { id: "d2", type: "devis", items: [], payments: [] }]);
    const stripe = makeStripe([session()]);
    const res = await syncOnlinePayments(db, stripe, "org", "acct_1", { documentId: "d1" });
    expect(stripe.calls[0].opts).toEqual({ stripeAccount: "acct_1" });
    expect(stripe.calls[0].params).toMatchObject({ limit: 100, status: "complete" });
    expect(res).toMatchObject({ checked: 1, added: 1, documentIds: ["d1"] });
    const doc = db.state.kv.value.find((d) => d.id === "d1");
    expect(doc.payments).toHaveLength(1);
    expect(doc.payments[0]).toMatchObject({ id: "pay_stripe_cs_9", amount: 9, date: "2026-09-22", method: "Carte bancaire (en ligne)" });
    expect(doc.status).toBe("envoyée");
    expect(res.documents.find((d) => d.id === "d1").payments).toHaveLength(1);
    // Verrou levé, lien pas clôturé (il reste à payer).
    expect(db.state.links).toHaveLength(1);
    expect(db.state.links[0]).toMatchObject({ payload: { payment_pending_at: null }, filters: { id: "L1" } });
  });
  it("déjà enregistré (par le webhook ou un rapprochement précédent) : rien d'écrit, pas de doublon", async () => {
    const db = makeDb([facture({ payments: [{ id: "pay_stripe_cs_9", date: "2026-09-22", amount: 9, method: "Carte bancaire (en ligne)" }] })]);
    const res = await syncOnlinePayments(db, makeStripe([session()]), "org", "acct_1");
    expect(res).toMatchObject({ checked: 1, added: 0, documentIds: [] });
    expect(db.state.writes).toBe(0);
    expect(db.state.links).toHaveLength(0);
    expect(db.state.kv.value[0].payments).toHaveLength(1);
  });
  it("sessions d'une autre organisation, impayées, d'abonnement ou d'un autre document : ignorées", async () => {
    const db = makeDb([facture()]);
    const stripe = makeStripe([
      session({ id: "cs_a", metadata: { ...session().metadata, organizationId: "org2" } }),
      session({ id: "cs_b", payment_status: "unpaid" }),
      session({ id: "cs_c", metadata: { kind: "subscription" } }),
      session({ id: "cs_d", metadata: { ...session().metadata, documentId: "inconnu" } }),
    ]);
    const res = await syncOnlinePayments(db, stripe, "org", "acct_1", { documentId: "d1" });
    expect(res).toMatchObject({ checked: 0, added: 0 });
    expect(db.state.writes).toBe(0);
    expect(db.state.kv.value[0].payments).toHaveLength(0);
  });
  it("solde payé en ligne : facture « payée » avec la date de la session, lien clôturé (paid_at seulement s'il est vide)", async () => {
    const db = makeDb([facture({ payments: [{ id: "p1", amount: 200 }] })]);
    const res = await syncOnlinePayments(db, makeStripe([session({ amount_total: 100000 })]), "org", "acct_1");
    expect(res.added).toBe(1);
    const doc = db.state.kv.value[0];
    expect(doc.status).toBe("payée");
    expect(doc.paidAt).toBe("2026-09-22T15:55:17.000Z");
    expect(db.state.links).toHaveLength(2);
    expect(db.state.links[1]).toMatchObject({ filters: { id: "L1" }, isNull: { paid_at: null } });
    expect(typeof db.state.links[1].payload.paid_at).toBe("string");
  });
  it("plusieurs sessions sur le même lien : verrou levé une seule fois ; document introuvable : ignoré", async () => {
    const db = makeDb([facture()]);
    const stripe = makeStripe([session(), session({ id: "cs_10", amount_total: 500 }), session({ id: "cs_11", metadata: { ...session().metadata, documentId: "disparu" } })]);
    const res = await syncOnlinePayments(db, stripe, "org", "acct_1");
    expect(res.added).toBe(2);
    expect(db.state.kv.value[0].payments.map((p) => p.amount)).toEqual([9, 5]);
    expect(db.state.links.filter((l) => l.payload.payment_pending_at === null)).toHaveLength(1);
  });
  it("écriture concurrente : rejouée sur la version fraîche", async () => {
    const db = makeDb([facture()]);
    let bumped = false;
    const original = db.from.bind(db);
    db.from = (table) => {
      const b = original(table);
      if (table === "kv_store" && !bumped) {
        const ms = b.maybeSingle;
        b.maybeSingle = async () => { const r = await ms(); bumped = true; db.state.kv = { value: [facture({ notes: "modifiée entre-temps" })], updated_at: "t2" }; return r; };
      }
      return b;
    };
    const res = await syncOnlinePayments(db, makeStripe([session()]), "org", "acct_1");
    expect(res.added).toBe(1);
    expect(db.state.kv.value[0].notes).toBe("modifiée entre-temps");
    expect(db.state.kv.value[0].payments).toHaveLength(1);
    expect(db.state.kv.updated_at).not.toBe("t2");
  });
});
