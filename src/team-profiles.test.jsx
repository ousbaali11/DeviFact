// @vitest-environment jsdom
// Profils des employés : nom complet, poste, téléphone sur la page Équipe
// (invitation et modification), et choix d'un membre comme technicien
// (rapport d'intervention) ou responsable (planning de chantier), avec
// « Autre… » en saisie libre et anciens documents inchangés.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const calls = { rpc: [], invoke: [] };
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
    from: () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }), delete: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }) }),
  },
}));
import { TeamView, TeamMemberField, memberDisplayName, RapportInterventionEditor, PlanningChantierEditor, newRapportInterventionDocument, newPlanningChantierDocument, PLANS } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });
beforeEach(() => { calls.rpc = []; calls.invoke = []; state.members = [
  { id: "m1", user_id: "u1", role: "owner", status: "active", email: "patron@exemple.fr", company_name: "", full_name: "", job_title: "", phone: "" },
  { id: "m2", user_id: "u2", role: "editor", status: "active", email: "karim@exemple.fr", company_name: "", full_name: "Karim Benali", job_title: "Plombier", phone: "06 12 34 56 78" },
  { id: "m3", user_id: "u3", role: "viewer", status: "invited", email: "invite@exemple.fr", company_name: "", full_name: "Pas Encore", job_title: "", phone: "" },
]; });

const noop = () => {};
const siteSettings = { name: "Chantiflow", landingPageVersion: "classique" };
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
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const buttonByText = (c, text) => [...c.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
const buttonsByTitle = (c, title) => [...c.querySelectorAll(`button[title="${title}"]`)];
const inputAfterLabel = (c, label) => [...c.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(label))?.querySelector("input");
// Formulaire de modification d'un profil (libellés sans « (optionnel) »).
const editInput = (c, label) => [...c.querySelectorAll("label")].find((l) => l.textContent.trim() === label)?.querySelector("input");
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 500)); });

describe("helpers", () => {
  it("nom affiché : nom complet, sinon e-mail", () => {
    expect(memberDisplayName({ full_name: " Karim Benali ", email: "k@e.fr" })).toBe("Karim Benali");
    expect(memberDisplayName({ full_name: "", email: "k@e.fr" })).toBe("k@e.fr");
    expect(memberDisplayName({})).toBe("Membre");
  });
});

describe("page Équipe", () => {
  it("propriétaire : nom, poste et téléphone affichés ; formulaire d'invitation avec les trois champs", async () => {
    const { container, unmount } = await mount(<TeamView account={owner} siteSettings={siteSettings} />);
    const text = container.textContent;
    expect(text).toContain("Karim Benali");
    expect(text).toContain("karim@exemple.fr · Plombier · 06 12 34 56 78");
    expect(text).toContain("patron@exemple.fr"); // sans nom : l'e-mail reste le titre
    for (const l of ["Nom complet (optionnel)", "Poste / spécialité (optionnel)", "Téléphone (optionnel)"]) expect(text).toContain(l);
    // Le propriétaire peut modifier le profil de chaque membre (3 crayons)
    expect(buttonsByTitle(container, "Modifier le profil (nom, poste, téléphone)")).toHaveLength(3);
    await unmount();
  }, 30000);
  it("invitation : nom, poste et téléphone envoyés à la fonction invite-member", async () => {
    const { container, unmount } = await mount(<TeamView account={owner} siteSettings={siteSettings} />);
    await act(async () => { setValue(inputAfterLabel(container, "Email"), "nouveau@exemple.fr"); });
    await act(async () => { setValue(inputAfterLabel(container, "Nom complet (optionnel)"), "Léa Martin"); });
    await act(async () => { setValue(inputAfterLabel(container, "Poste / spécialité (optionnel)"), "Électricienne"); });
    await act(async () => { setValue(inputAfterLabel(container, "Téléphone (optionnel)"), "07 00 00 00 00"); });
    await click(buttonByText(container, "Inviter"));
    await settle();
    expect(calls.invoke).toHaveLength(1);
    expect(calls.invoke[0]).toMatchObject({ name: "invite-member", body: { email: "nouveau@exemple.fr", role: "editor", organizationId: "org", fullName: "Léa Martin", jobTitle: "Électricienne", phone: "07 00 00 00 00" } });
    expect(container.textContent).toContain("nouveau@exemple.fr a été ajouté à l'équipe.");
    expect(inputAfterLabel(container, "Nom complet (optionnel)").value).toBe(""); // formulaire vidé
    await unmount();
  }, 30000);
  it("modification d'un profil : fonction SQL update_member_profile puis rechargement", async () => {
    const { container, unmount } = await mount(<TeamView account={owner} siteSettings={siteSettings} />);
    await click(buttonsByTitle(container, "Modifier le profil (nom, poste, téléphone)")[1]); // Karim
    expect(editInput(container, "Nom complet").value).toBe("Karim Benali");
    expect(editInput(container, "Poste / spécialité").value).toBe("Plombier");
    await act(async () => { setValue(editInput(container, "Poste / spécialité"), "Chef de chantier"); });
    await act(async () => { setValue(editInput(container, "Téléphone"), "06 99 99 99 99"); });
    await click(buttonByText(container, "Enregistrer le profil"));
    await settle();
    const update = calls.rpc.find((c) => c.name === "update_member_profile");
    expect(update.args).toEqual({ member_id: "m2", new_full_name: "Karim Benali", new_job_title: "Chef de chantier", new_phone: "06 99 99 99 99" });
    expect(calls.rpc.filter((c) => c.name === "get_organization_members_with_profiles").length).toBeGreaterThanOrEqual(2);
    expect(buttonByText(container, "Enregistrer le profil")).toBeUndefined(); // formulaire refermé
    await unmount();
  }, 30000);
  it("membre non propriétaire : ne peut modifier que son propre profil", async () => {
    const { container, unmount } = await mount(<TeamView account={editorAccount} siteSettings={siteSettings} />);
    const pencils = buttonsByTitle(container, "Modifier le profil (nom, poste, téléphone)");
    expect(pencils).toHaveLength(1);
    expect(pencils[0].closest("div.px-4").textContent).toContain("Karim Benali");
    expect(container.textContent).not.toContain("Inviter un membre");
    await unmount();
  }, 30000);
});

describe("champ membre de l'équipe", () => {
  const members = [{ userId: "u1", label: "patron@exemple.fr", jobTitle: "" }, { userId: "u2", label: "Karim Benali", jobTitle: "Plombier" }];
  it("sans membre : simple champ texte", async () => {
    const { container, unmount } = await mount(<TeamMemberField members={[]} value="Ancien" memberId={null} onChange={noop} />);
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector("input").value).toBe("Ancien");
    await unmount();
  });
  it("membre choisi : nom en texte + repère ; Autre… rouvre la saisie libre ; ancien texte affiché en Autre…", async () => {
    const changes = [];
    const { container, unmount } = await mount(<TeamMemberField members={members} value="" memberId={null} onChange={(v) => changes.push(v)} required />);
    const select = container.querySelector("select");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Choisir un membre de l'équipe…", "patron@exemple.fr", "Karim Benali — Plombier", "Autre… (saisie libre)"]);
    expect(select.value).toBe("");
    await act(async () => { setValue(select, "u2"); });
    expect(changes.at(-1)).toEqual({ value: "Karim Benali", memberId: "u2" });
    await act(async () => { setValue(select, "autre"); });
    expect(changes.at(-1)).toEqual({ value: "", memberId: null });
    expect(container.querySelector("input")).toBeTruthy();
    await unmount();
    const legacy = await mount(<TeamMemberField members={members} value="Ancien Tech" memberId={null} onChange={noop} />);
    expect(legacy.container.querySelector("select").value).toBe("autre");
    expect(legacy.container.querySelector("input").value).toBe("Ancien Tech");
    await legacy.unmount();
    const chosen = await mount(<TeamMemberField members={members} value="Karim Benali" memberId="u2" onChange={noop} />);
    expect(chosen.container.querySelector("select").value).toBe("u2");
    expect(chosen.container.querySelector("input")).toBeNull();
    await chosen.unmount();
  });
});

describe("éditeurs : rapport et planning", () => {
  const props = { saving: false, account: owner, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onFinalize: noop, onBack: noop, onGoToPricing: noop, clients: [] };
  const selectWithOption = (c, label) => [...c.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent === label));
  it("rapport : choisir un membre renseigne technicien + technicienMemberId ; ancien rapport en saisie libre, non bloqué", async () => {
    const patches = [];
    const { container, unmount } = await mount(<RapportInterventionEditor {...props} doc={newRapportInterventionDocument([])} onChange={(p) => patches.push(p)} />);
    const select = selectWithOption(container, "Karim Benali — Plombier");
    expect(select).toBeTruthy();
    await act(async () => { setValue(select, "u2"); });
    await settle();
    expect(patches.at(-1)).toMatchObject({ technicien: "Karim Benali", technicienMemberId: "u2" });
    await unmount();
    const legacyDoc = { ...newRapportInterventionDocument([]), technicien: "Ancien Tech", motifAppel: "Fuite", client: { ...newRapportInterventionDocument([]).client, name: "Mme Martin" } };
    delete legacyDoc.schemaVersion; delete legacyDoc.technicienMemberId;
    const legacy = await mount(<RapportInterventionEditor {...props} doc={legacyDoc} onChange={noop} />);
    const legacySelect = selectWithOption(legacy.container, "Karim Benali — Plombier");
    expect(legacySelect.value).toBe("autre");
    expect(legacy.container.textContent).toContain("Ancien Tech".slice(0, 0) + "Technicien *");
    expect([...legacy.container.querySelectorAll("input")].some((i) => i.value === "Ancien Tech")).toBe(true);
    expect(buttonByText(legacy.container, "Enregistrer")?.hasAttribute("disabled")).toBe(false);
    await legacy.unmount();
  }, 30000);
  it("planning : choisir un membre renseigne responsable + responsableMemberId", async () => {
    const patches = [];
    const { container, unmount } = await mount(<PlanningChantierEditor {...props} doc={newPlanningChantierDocument([])} onChange={(p) => patches.push(p)} />);
    const select = selectWithOption(container, "Karim Benali — Plombier");
    expect(select).toBeTruthy();
    await act(async () => { setValue(select, "u2"); });
    await settle();
    expect(patches.at(-1)).toMatchObject({ responsable: "Karim Benali", responsableMemberId: "u2" });
    await unmount();
  }, 30000);
  it("membre invité mais pas encore actif : absent des listes", async () => {
    const { container, unmount } = await mount(<PlanningChantierEditor {...props} doc={newPlanningChantierDocument([])} onChange={noop} />);
    const select = selectWithOption(container, "Karim Benali — Plombier");
    expect([...select.options].map((o) => o.textContent)).not.toContain("Pas Encore");
    await unmount();
  }, 30000);
});
