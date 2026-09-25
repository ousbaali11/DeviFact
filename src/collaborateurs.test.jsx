// @vitest-environment jsdom
// Priorité 10 : collaborateur sans accès (rôle « staff » dans la table des
// membres : nom, poste, téléphone, ni compte ni e-mail). Page Équipe
// (bloc dédié, propriétaire seul, « Inviter avec un accès »), mêmes listes
// déroulantes que les membres avec compte (clé « staff:<fiche> »).
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const calls = { rpc: [], invoke: [], inserts: [], deletes: [] };
const state = { members: [] };
vi.mock("./client.js", () => ({
  db: {
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      if (name === "get_organization_members_with_profiles") return { data: state.members, error: null };
      if (name === "update_member_profile") return { data: true, error: null };
      return { data: null, error: { message: `rpc inconnue ${name}` } };
    },
    functions: { invoke: async (name, opts) => { calls.invoke.push({ name, body: opts?.body }); return { data: { success: true }, error: null }; } },
    auth: { getSession: async () => ({ data: { session: { access_token: "jeton" } } }) },
    from: () => ({
      insert: (row) => ({ select: async () => { calls.inserts.push(row); const created = { id: `m${state.members.length + 1}`, user_id: null, email: null, company_name: "", ...row }; state.members = [...state.members, created]; return { data: [created], error: null }; } }),
      update: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }),
      delete: () => ({ eq: (_c, id) => ({ select: async () => { calls.deletes.push(id); state.members = state.members.filter((m) => m.id !== id); return { data: [{ id }], error: null }; } }) }),
    }),
  },
}));
import { TeamView, TeamMemberField, memberKey, STAFF_ROLE, RapportInterventionEditor, newRapportInterventionDocument, PLANS } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; window.confirm = () => true; });
beforeEach(() => { calls.rpc = []; calls.invoke = []; calls.inserts = []; calls.deletes = []; state.members = [
  { id: "m1", user_id: "u1", role: "owner", status: "active", email: "patron@exemple.fr", company_name: "", full_name: "", job_title: "", phone: "" },
  { id: "m2", user_id: "u2", role: "editor", status: "active", email: "karim@exemple.fr", company_name: "", full_name: "Karim Benali", job_title: "Plombier", phone: "" },
  { id: "m9", user_id: null, role: "staff", status: "active", email: null, company_name: "", full_name: "Lucas Petit", job_title: "Apprenti électricien", phone: "06 00 00 00 00" },
]; });

const noop = () => {};
const owner = { id: "u1", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "patron@exemple.fr", memberships: [] };
const editorAccount = { ...owner, id: "u2", role: "editor", email: "karim@exemple.fr" };
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
function setValue(input, value) {
  const proto = input.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
  input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
const buttonByText = (c, text) => [...c.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
const staffRows = (c) => [...c.querySelectorAll('[data-testid="staff-row"]')];

describe("clé de membre", () => {
  it("compte : identifiant du compte ; fiche sans accès : « staff:<fiche> »", () => {
    expect(memberKey({ id: "m2", user_id: "u2" })).toBe("u2");
    expect(memberKey({ id: "m9", user_id: null, role: STAFF_ROLE })).toBe("staff:m9");
  });
});

describe("page Équipe", () => {
  it("propriétaire : bloc dédié, fiche avec badge « Sans accès », absente de la liste des membres ; ajout enregistré au rôle staff", async () => {
    const { container, unmount } = await mount(<TeamView account={owner} />);
    const block = container.querySelector('[data-testid="staff-block"]');
    expect(block).toBeTruthy();
    expect(staffRows(container)).toHaveLength(1);
    expect(staffRows(container)[0].textContent).toContain("Lucas Petit");
    expect(staffRows(container)[0].textContent).toContain("Apprenti électricien · 06 00 00 00 00");
    expect(staffRows(container)[0].textContent).toContain("Sans accès");
    // La liste des membres avec compte ne contient pas la fiche.
    const memberSelects = [...container.querySelectorAll("select")].filter((s) => [...s.options].some((o) => o.value === "comptable"));
    expect(memberSelects.length).toBe(2); // rôle de l'invitation + rôle de Karim (jamais celui du propriétaire ni de la fiche)
    // Ajout.
    await click(buttonByText(container, "Ajouter"));
    expect(block.textContent).toContain("Indique le nom du collaborateur.");
    await act(async () => { setValue(container.querySelector('input[aria-label="Nom du collaborateur"]'), "Inès Roux"); });
    await act(async () => { setValue(container.querySelector('input[aria-label="Poste du collaborateur"]'), "Intérimaire"); });
    await click(buttonByText(container, "Ajouter"));
    await settle();
    expect(calls.inserts).toEqual([{ organization_id: "org", role: "staff", status: "active", full_name: "Inès Roux", job_title: "Intérimaire", phone: null }]);
    expect(staffRows(container)).toHaveLength(2);
    // Suppression.
    await click(staffRows(container)[1].querySelector('button[title="Supprimer la fiche"]'));
    await settle();
    expect(calls.deletes).toEqual(["m4"]);
    await unmount();
  }, 30000);
  it("éditeur : fiche visible en lecture seule, ni formulaire ni boutons, mention explicite", async () => {
    const { container, unmount } = await mount(<TeamView account={editorAccount} />);
    const block = container.querySelector('[data-testid="staff-block"]');
    expect(block.textContent).toContain("Lucas Petit");
    expect(block.textContent).toContain("Gestion réservée au propriétaire.");
    expect(block.querySelector('input[aria-label="Nom du collaborateur"]')).toBeNull();
    expect(block.querySelector("button")).toBeNull();
    await unmount();
  }, 30000);
  it("« Inviter avec un accès » : invitation pré-remplie, puis la fiche est supprimée après l'envoi", async () => {
    const { container, unmount } = await mount(<TeamView account={owner} />);
    await click(buttonByText(container, "Inviter avec un accès"));
    expect(container.querySelector('[data-testid="converting-staff"]').textContent).toContain("Lucas Petit");
    const emailInput = [...container.querySelectorAll("input")].find((i) => i.placeholder?.startsWith("collegue@"));
    await act(async () => { setValue(emailInput, "lucas@exemple.fr"); });
    await click(buttonByText(container, "Inviter"));
    await settle();
    const invite = calls.invoke.find((c) => c.name === "invite-member");
    expect(invite.body).toMatchObject({ email: "lucas@exemple.fr", role: "editor", fullName: "Lucas Petit", jobTitle: "Apprenti électricien", phone: "06 00 00 00 00" });
    expect(calls.deletes).toEqual(["m9"]);
    expect(container.querySelector('[data-testid="converting-staff"]')).toBeNull();
    await unmount();
  }, 30000);
});

describe("listes déroulantes", () => {
  it("technicien du rapport d'intervention : le collaborateur sans accès est proposé avec son poste, et enregistré par sa clé", async () => {
    const changes = [];
    const doc = { ...newRapportInterventionDocument([]), docNumber: "RI-1" };
    const { container, unmount } = await mount(<RapportInterventionEditor doc={doc} saving={false} account={owner} plans={PLANS} siteSettings={{ name: "Chantiflow" }} isLocked={false} isViewer={false} onChange={(p) => changes.push(p)} onFinalize={noop} onBack={noop} onGoToPricing={noop} clients={[]} />);
    const select = [...container.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "staff:m9"));
    expect(select).toBeTruthy();
    expect([...select.options].find((o) => o.value === "staff:m9").textContent).toBe("Lucas Petit — Apprenti électricien");
    expect([...select.options].some((o) => o.value === "u2")).toBe(true);
    await act(async () => { setValue(select, "staff:m9"); });
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    const last = changes[changes.length - 1];
    expect(last.technicien).toBe("Lucas Petit");
    expect(last.technicienMemberId).toBe("staff:m9");
    await unmount();
  }, 30000);
  it("TeamMemberField : sélection par clé, nom en texte", async () => {
    const out = [];
    const members = [{ userId: "u2", label: "Karim Benali", jobTitle: "Plombier" }, { userId: "staff:m9", label: "Lucas Petit", jobTitle: "Apprenti" }];
    const { container, unmount } = await mount(<TeamMemberField members={members} value="" memberId={null} onChange={(v) => out.push(v)} />);
    await act(async () => { setValue(container.querySelector("select"), "staff:m9"); });
    expect(out[out.length - 1]).toEqual({ value: "Lucas Petit", memberId: "staff:m9" });
    await unmount();
  }, 30000);
});
