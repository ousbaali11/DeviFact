// @vitest-environment jsdom
// Audit des champs — nettoyage des champs communs : copie du profil sans
// les réglages d'application, suggestion et liaison automatique des
// clients dans les éditeurs spécialisés, comptage des documents par client.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PvReceptionEditor, ContratChantierEditor, ClientsView, companySnapshotOf, findClientByName, newPvReceptionDocument, newContratChantierDocument, emptyCompanyProfile, PLANS } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const siteSettings = { name: "Chantiflow" };
const clients = [
  { id: "cli_1", name: "Mme Martin", address: "2 av. du Port", email: "martin@exemple.fr", phone: "06 11" },
  { id: "cli_2", name: "Commune de Lyon", address: "Hôtel de ville", email: "", phone: "" },
];

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
function setValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("copie du profil dans les documents", () => {
  it("retire le lien d'avis, l'exercice comptable et les comptes par défaut, garde le reste", () => {
    const profile = { ...emptyCompanyProfile(), name: "Bâti Plus", iban: "FR76", bic: "BIC", vatOnDebits: true, legalForm: "SARL", googleReviewUrl: "https://g.page/x", fiscalStartMonth: 4, accounting: { sales: "706000" } };
    const snap = companySnapshotOf(profile);
    expect(snap).toMatchObject({ name: "Bâti Plus", iban: "FR76", bic: "BIC", vatOnDebits: true, legalForm: "SARL" });
    for (const k of ["googleReviewUrl", "fiscalStartMonth", "accounting"]) expect(snap).not.toHaveProperty(k);
    expect(profile.googleReviewUrl).toBe("https://g.page/x"); // le profil lui-même n'est pas modifié
  });
});

describe("liaison automatique des clients", () => {
  it("correspondance par nom, sans casse ni espaces", () => {
    expect(findClientByName(clients, "  mme martin ")?.id).toBe("cli_1");
    expect(findClientByName(clients, "Inconnu")).toBeNull();
    expect(findClientByName(clients, "")).toBeNull();
  });
  it("PV de réception : suggestions affichées, clientId et coordonnées vides remplis quand le nom correspond, remis à zéro sinon", async () => {
    const patches = [];
    const { container, unmount } = await mount(<PvReceptionEditor doc={newPvReceptionDocument([])} clients={clients} saving={false} account={account} plans={PLANS} siteSettings={siteSettings} isLocked={false} isViewer={false} onChange={(p) => patches.push(p)} onFinalize={noop} onBack={noop} onGoToPricing={noop} />);
    const options = [...container.querySelectorAll("datalist option")].map((o) => o.value);
    expect(options).toEqual(["Mme Martin", "Commune de Lyon"]);
    const nameInput = [...container.querySelectorAll("input")].find((i) => i.getAttribute("list") && i.placeholder === "Nom");
    expect(nameInput).toBeTruthy();
    await act(async () => { setValue(nameInput, "mme martin"); });
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); }); // enregistrement différé
    const last = patches.at(-1);
    expect(last.clientId).toBe("cli_1");
    expect(last.client).toMatchObject({ name: "mme martin", address: "2 av. du Port", email: "martin@exemple.fr", phone: "06 11" });
    await act(async () => { setValue(nameInput, "Quelqu'un d'autre"); });
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(patches.at(-1).clientId).toBeNull();
    await unmount();
  });
  it("contrat : même mécanisme, l'adresse déjà saisie n'est pas écrasée", async () => {
    const patches = [];
    const doc = { ...newContratChantierDocument([]), client: { ...newContratChantierDocument([]).client, address: "Adresse saisie" } };
    const { container, unmount } = await mount(<ContratChantierEditor doc={doc} clients={clients} saving={false} account={account} plans={PLANS} siteSettings={siteSettings} isLocked={false} isViewer={false} onChange={(p) => patches.push(p)} onFinalize={noop} onBack={noop} onGoToPricing={noop} />);
    const nameInput = [...container.querySelectorAll("input")].find((i) => i.getAttribute("list") && i.placeholder === "Nom");
    await act(async () => { setValue(nameInput, "Commune de Lyon"); });
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(patches.at(-1)).toMatchObject({ clientId: "cli_2", client: { name: "Commune de Lyon", address: "Adresse saisie" } });
    await unmount();
  });
});

describe("page Clients : comptage des documents", () => {
  it("compte les documents liés par identifiant et les anciens documents liés par le nom", async () => {
    const documents = [
      { id: "d1", type: "devis", clientId: "cli_1", client: { name: "Autre nom" }, items: [] },
      { id: "d2", type: "pv_reception", clientId: null, client: { name: "mme martin" } },
      { id: "d3", type: "contrat", clientId: null, client: { name: "Commune de Lyon" } },
      { id: "d4", type: "devis", clientId: "cli_2", client: { name: "Commune de Lyon" }, items: [] },
    ];
    const { container, unmount } = await mount(<ClientsView clients={clients} documents={documents} saving={false} onSave={noop} onDelete={noop} isLocked={false} isViewer={false} onGoToPricing={noop} siteSettings={siteSettings} darkMode={false} />);
    const text = container.textContent;
    expect(text).toContain("2 document(s)"); // Mme Martin : d1 + d2
    expect(text.split("2 document(s)").length - 1).toBe(2); // Commune de Lyon : d3 + d4
    await unmount();
  });
});
