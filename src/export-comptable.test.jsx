// @vitest-environment jsdom
// Mon entreprise → « Export comptable automatique » : réglage (activé,
// fréquence, e-mail de l'expert-comptable) enregistré dans la fiche
// entreprise, « Envoyer maintenant » qui appelle la fonction serveur,
// dernier envoi affiché, lecture seule pour un lecteur.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";

const calls = { invoked: [], response: null, state: null };
vi.mock("./client.js", () => ({
  db: {
    functions: { invoke: async (name, opts) => { calls.invoked.push({ name, body: opts?.body }); return typeof calls.response === "function" ? calls.response() : calls.response; } },
    from: () => { throw new Error("pas d'accès base attendu"); },
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async (name, args) => { calls.invoked.push({ name, body: args }); return { data: calls.members || [], error: null }; },
  },
}));

import { AccountingExportCard, CompanyView, accountingExportPeriodLabel, emptyCompanyProfile } from "./App.jsx";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  window.storage = { get: async () => { if (calls.state) return { key: "accounting-export-state", value: JSON.stringify(calls.state), shared: false }; const e = new Error("Clé introuvable"); e.code = "KEY_NOT_FOUND"; throw e; }, set: async () => ({}) };
});
beforeEach(() => { calls.invoked = []; calls.response = { data: { sent: true, period: "2026-08", label: "août 2026", to: "cabinet@ec.fr", documentCount: 3 }, error: null }; calls.state = null; });

const account = { id: "u1", organizationId: "org", plan: "pro", role: "owner", email: "artisan@exemple.fr", memberships: [] };
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
function setValue(input, value) {
  const proto = input.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
  input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}
const button = (c, text) => [...c.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
const byLabel = (c, label) => [...c.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(label))?.querySelector("input, select");

// Harnais : la fiche entreprise vit dans un état, comme dans l'application.
const saved = [];
function Harness({ initial, isViewer = false }) {
  const [profile, setProfile] = useState(initial);
  return <AccountingExportCard profile={profile} account={account} isLocked={false} isViewer={isViewer} saving={false} onSave={(cfg) => { saved.push(cfg); setProfile((p) => ({ ...p, accountingExport: cfg })); }} />;
}

describe("réglage et envoi", () => {
  it("activer, choisir le trimestre, saisir l'e-mail, enregistrer ; puis « Envoyer maintenant » appelle la fonction et affiche le résultat", async () => {
    saved.length = 0;
    const { container, unmount } = await mount(<Harness initial={{ ...emptyCompanyProfile(), name: "Bâti Plus" }} />);
    expect(container.textContent).toContain("Export comptable automatique");
    expect(button(container, "Enregistrer").disabled).toBe(true); // rien à enregistrer
    expect(button(container, "Envoyer maintenant").disabled).toBe(true); // pas d'e-mail
    await act(async () => { byLabel(container, "Envoi automatique").click(); });
    await act(async () => { setValue(byLabel(container, "Fréquence"), "trimestriel"); });
    await click(button(container, "Enregistrer"));
    expect(container.textContent).toContain("Indique une adresse e-mail valide");
    expect(saved).toHaveLength(0);
    await act(async () => { setValue(byLabel(container, "E-mail de l'expert-comptable"), "cabinet@ec.fr"); });
    // Pas encore enregistré : l'envoi immédiat le rappelle.
    await click(button(container, "Envoyer maintenant"));
    expect(container.textContent).toContain("Enregistre d'abord le réglage");
    const sends = () => calls.invoked.filter((c) => c.name === "send-accounting-exports");
    expect(sends()).toHaveLength(0);
    await click(button(container, "Enregistrer"));
    expect(saved).toEqual([{ enabled: true, frequency: "trimestriel", email: "cabinet@ec.fr" }]);
    expect(button(container, "Enregistrer").disabled).toBe(true);
    await click(button(container, "Envoyer maintenant"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(sends()).toEqual([{ name: "send-accounting-exports", body: { organizationId: "org" } }]);
    expect(container.textContent).toContain("Export août 2026 envoyé à cabinet@ec.fr (3 documents).");
    await unmount();
  }, 30000);
  it("refus du serveur : la vraie raison est affichée", async () => {
    calls.response = { data: null, error: { message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify({ error: "Adresse de l'expert-comptable manquante ou invalide." }), { status: 400 }) } };
    const { container, unmount } = await mount(<Harness initial={{ ...emptyCompanyProfile(), accountingExport: { enabled: true, frequency: "mensuel", email: "cabinet@ec.fr" } }} />);
    await click(button(container, "Envoyer maintenant"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(container.textContent).toContain("Adresse de l'expert-comptable manquante ou invalide.");
    expect(container.textContent).not.toContain("non-2xx");
    await unmount();
  }, 30000);
  it("dernier envoi et dernier échec affichés depuis l'état écrit par le serveur", async () => {
    calls.state = { lastSentPeriod: "2026-T2", lastSentAt: "2026-07-03T06:00:00.000Z", lastSentTo: "cabinet@ec.fr", lastError: "Le service d'envoi a refusé l'e-mail (403).", lastErrorAt: "2026-08-03T06:00:00.000Z" };
    const { container, unmount } = await mount(<Harness initial={{ ...emptyCompanyProfile(), accountingExport: { enabled: true, frequency: "trimestriel", email: "cabinet@ec.fr" } }} />);
    expect(container.textContent).toContain("Dernier envoi : 2e trimestre 2026, le 03/07/2026, à cabinet@ec.fr.");
    expect(container.textContent).toContain("Dernier essai en échec : Le service d'envoi a refusé l'e-mail (403).");
    await unmount();
    expect(accountingExportPeriodLabel("2026-08")).toBe("août 2026");
    expect(accountingExportPeriodLabel("2026-T1")).toBe("1er trimestre 2026");
  }, 30000);
  it("e-mail pré-rempli avec le membre de rôle Expert-comptable ; jamais par-dessus une adresse enregistrée", async () => {
    calls.members = [{ user_id: "a", role: "owner", status: "active", email: "patron@exemple.fr" }, { user_id: "b", role: "comptable", status: "active", email: "cabinet@ec.fr" }, { user_id: "c", role: "comptable", status: "invited", email: "autre@ec.fr" }];
    const { container, unmount } = await mount(<Harness initial={{ ...emptyCompanyProfile(), name: "Bâti Plus" }} />);
    expect(byLabel(container, "E-mail de l'expert-comptable").value).toBe("cabinet@ec.fr");
    expect(button(container, "Envoyer maintenant").disabled).toBe(false);
    expect(button(container, "Enregistrer").disabled).toBe(false); // adresse à enregistrer
    await unmount();
    const saved2 = await mount(<Harness initial={{ ...emptyCompanyProfile(), accountingExport: { enabled: true, frequency: "mensuel", email: "deja@ec.fr" } }} />);
    expect(byLabel(saved2.container, "E-mail de l'expert-comptable").value).toBe("deja@ec.fr");
    expect(calls.invoked.filter((c) => c.name === "get_organization_members_with_profiles")).toHaveLength(1); // pas de lecture quand une adresse est enregistrée
    await saved2.unmount();
  }, 30000);
  it("lecteur : résumé seulement, ni champ ni bouton", async () => {
    const { container, unmount } = await mount(<Harness initial={{ ...emptyCompanyProfile(), accountingExport: { enabled: true, frequency: "mensuel", email: "cabinet@ec.fr" } }} isViewer />);
    expect(container.textContent).toContain("Activé (chaque mois) vers cabinet@ec.fr.");
    expect(container.querySelector("input")).toBeNull();
    expect(button(container, "Envoyer maintenant")).toBeUndefined();
    await unmount();
  }, 30000);
  it("Mon entreprise affiche la carte, avant la zone de test", async () => {
    const noop = () => {};
    const { container, unmount } = await mount(<CompanyView profile={{ ...emptyCompanyProfile(), name: "Bâti Plus" }} saving={false} onSave={noop} onReset={noop} documentCount={0} clientCount={0} account={account} isLocked={false} isViewer={false} onGoToPricing={noop} />);
    const text = container.textContent;
    expect(text.indexOf("Export comptable automatique")).toBeGreaterThan(-1);
    expect(text.indexOf("Export comptable automatique")).toBeLessThan(text.indexOf("Zone de test"));
    await unmount();
  }, 30000);
});
