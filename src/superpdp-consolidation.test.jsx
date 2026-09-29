// @vitest-environment jsdom
// Super PDP, étape 4 (30/09/2026), chantier 4 — consolidation : réconciliation
// d'une pièce avec sa ligne de la table des envois (référence serveur),
// connexion « à refaire » (préfixe dans last_error, sans nouvelle colonne) :
// éligibilité, état public, carte Mon entreprise avec « Reconnecter » ;
// parité site / serveur.
import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import * as site from "./pdp-rules.js";
import * as server from "../supabase/functions/_shared/superpdp-rules.ts";
import { publicStatusOf } from "../supabase/functions/_shared/superpdp.ts";

const state = { status: { configured: true, connected: true, env: "sandbox", companyName: "Burger Queen", companyNumber: "000000002", companyNumberScheme: "sandbox", verificationStatus: "verified", needsReconnect: true, lastError: "Super PDP a refusé l'authentification : invalid_grant" }, started: 0 };
vi.mock("./client.js", () => ({
  db: {
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    functions: { invoke: async (name, opts) => {
      const action = opts?.body?.action;
      if (action === "status") return { data: state.status, error: null };
      if (action === "start") { state.started += 1; return { data: { url: "https://api.superpdp.tech/oauth2/authorize?state=st" }, error: null }; }
      return { data: { error: "?" }, error: null };
    } },
    rpc: async () => ({ data: [], error: null }),
    from: (table) => (table === "pdp_journal" ? { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) } : { update: () => ({ eq: async () => ({ data: [], error: null }) }) }),
  },
}));
import { SuperPdpCard } from "./App.jsx";

describe("réconciliation pièce / table des envois", () => {
  const row = (extra = {}) => ({ document_id: "d1", pdp_invoice_id: 804569, env: "sandbox", external_id: "d1", status_code: "fr:202", status_text: "Reçue", sent_at: "2026-09-29T11:40:44Z", paid_event_at: null, last_error: null, ...extra });
  const doc = (pdp) => ({ id: "d1", docNumber: "FAC-026", pdp });
  it("pièce à jour : rien à faire ; envoi encore en cours : rien à faire", () => {
    expect(site.reconcilePdpDoc(doc({ invoiceId: 804569, status: "fr:202", statusText: "Reçue", paidEventAt: null }), row())).toEqual({ action: "none" });
    expect(site.reconcilePdpDoc(doc({ invoiceId: null, status: "api:uploaded" }), row({ status_code: "api:sending", pdp_invoice_id: null })).action).toBe("none");
    expect(site.reconcilePdpDoc({ id: "d1" }, null)).toEqual({ action: "none" });
    expect(site.reconcilePdpDoc(doc({ status: "error", invoiceId: null }), null)).toEqual({ action: "none" });
  });
  it("pièce en retard (statut, encaissement) : réalignée sur la table, champs propres à la pièce conservés", () => {
    const r = site.reconcilePdpDoc(doc({ invoiceId: 804569, status: "api:uploaded", statusText: "Déposée chez Super PDP", attempt: 2, reason: null }), row({ status_code: "fr:212", status_text: "Encaissée", paid_event_at: "2026-09-30T08:00:00Z" }), 1234);
    expect(r.action).toBe("patch");
    expect(r.fields).toEqual(["status", "paidEventAt"]);
    expect(r.patch).toMatchObject({ invoiceId: 804569, status: "fr:212", statusText: "Encaissée", paidEventAt: "2026-09-30T08:00:00Z", attempt: 2, env: "sandbox", externalId: "d1", updatedAt: 1234 });
    const r2 = site.reconcilePdpDoc(doc({ invoiceId: null, status: "error", error: "x" }), row(), 5);
    expect(r2.fields).toEqual(["invoiceId", "status"]);
    expect(r2.patch).toMatchObject({ invoiceId: 804569, status: "fr:202", sentAt: "2026-09-29T11:40:44Z" });
    // Libellé absent dans la table : libellé français du statut.
    expect(site.reconcilePdpDoc(doc({ invoiceId: 804569, status: "api:uploaded" }), row({ status_text: "" }), 1).patch.statusText).toBe("Reçue");
  });
  it("dépôt sur la pièce sans ligne : ligne recréée depuis la pièce", () => {
    const r = site.reconcilePdpDoc(doc({ invoiceId: 804800, env: "sandbox", externalId: "d1-2", status: "api:uploaded", statusText: "Déposée chez Super PDP", sentAt: "2026-09-29T11:58:34Z", paidEventAt: null }), null);
    expect(r.action).toBe("createRow");
    expect(r.row).toEqual({ pdp_invoice_id: 804800, env: "sandbox", external_id: "d1-2", status_code: "api:uploaded", status_text: "Déposée chez Super PDP", sent_at: "2026-09-29T11:58:34Z", paid_event_at: null, last_error: null });
  });
  it("parité site / serveur", () => {
    const cases = [[doc({ invoiceId: 1, status: "fr:202" }), row({ pdp_invoice_id: 1 })], [doc({ invoiceId: 1, status: "api:uploaded" }), row({ pdp_invoice_id: 1 })], [doc({ invoiceId: 2, status: "api:uploaded", sentAt: "s" }), null], [{ id: "d1" }, row()], [doc(null), row({ status_code: "api:sending" })]];
    for (const [d, r] of cases) expect(server.reconcilePdpDoc(d, r, 7)).toEqual(site.reconcilePdpDoc(d, r, 7));
    for (const v of ["RECONNECT: x", "x", "", null]) expect(server.pdpNeedsReconnect(v)).toBe(site.pdpNeedsReconnect(v));
    expect(server.PDP_RECONNECT_MESSAGE).toBe(site.PDP_RECONNECT_MESSAGE);
  });
});

describe("connexion à refaire", () => {
  it("éligibilité : refus « reconnexion » avant la vérification et la production ; état public avec needsReconnect et détail sans préfixe", () => {
    const facture = { type: "facture", status: "envoyée", client: { type: "entreprise", country: "🇫🇷 FR", siret: "0225:315143296_106842" } };
    const ctx = { connected: true, env: "sandbox", verificationStatus: "verified", companyCountryCode: "FR", needsReconnect: true };
    expect(site.pdpEligibility(facture, ctx)).toEqual({ ok: false, code: "reconnexion", reason: site.PDP_RECONNECT_MESSAGE });
    expect(server.pdpEligibility(facture, ctx)).toEqual(site.pdpEligibility(facture, ctx));
    expect(site.pdpEligibility(facture, { ...ctx, needsReconnect: false }).ok).toBe(true);
    const st = publicStatusOf({ env: "sandbox", company_name: "Burger Queen", company_number: "000000002", company_number_scheme: "sandbox", verification_status: "verified", last_error: "RECONNECT: Super PDP a refusé l'authentification : invalid_grant" });
    expect(st.needsReconnect).toBe(true);
    expect(st.lastError).toBe("Super PDP a refusé l'authentification : invalid_grant");
    expect(publicStatusOf({ env: "sandbox", last_error: "Suivi en échec" })).toMatchObject({ needsReconnect: false, lastError: "Suivi en échec" });
  });
  it("carte Mon entreprise : bloc « Connexion à refaire » avec le détail et un bouton Reconnecter qui relance l'autorisation", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {};
    const redirected = [];
    const owner = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@exemple.fr", memberships: [] };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<SuperPdpCard account={owner} profile={{ country: "🇫🇷 FR" }} onRedirect={(u) => redirected.push(u)} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    const block = container.querySelector('[data-testid="superpdp-reconnect"]');
    expect(block).toBeTruthy();
    expect(block.textContent).toContain("Connexion à refaire");
    expect(block.textContent).toContain("invalid_grant");
    const button = [...block.querySelectorAll("button")].find((b) => b.textContent.trim() === "Reconnecter");
    await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(state.started).toBe(1);
    expect(redirected[0]).toContain("oauth2/authorize");
    await act(async () => { root.unmount(); });
    container.remove();
  }, 30000);
});
