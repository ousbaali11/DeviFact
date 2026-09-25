// @vitest-environment jsdom
// Reprise des fiches dans les documents : choisir un client (ou son nom)
// reprend toute sa fiche (type, pays, ville, SIRET…) ; l'émetteur et le
// client d'un document sont complétés depuis Mon entreprise et la fiche
// client liée avant le contrôle des champs obligatoires, pour ne jamais
// réclamer une information déjà enregistrée. Fiche client : type et pays.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor, ClientsView, newDocument, emptyCompanyProfile, emptyClient, completeDocumentFromRecords, mergeClientRecord, clientRecordOf, documentValidationErrors, documentFieldGaps, PLANS } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null; });

const profile = { ...emptyCompanyProfile(), name: "Bâti Plus", siret: "12345678900012", tva: "FR12345678900", address: "1 rue des Lilas", postalCode: "69000", city: "Lyon", country: "France", email: "c@batiplus.fr", phone: "04 00" };
const clients = [
  { ...emptyClient(), id: "cli_1", type: "particulier", name: "Mme Martin", address: "2 av. du Port", postalCode: "13000", city: "Marseille", country: "France", email: "martin@exemple.fr", phone: "06 11" },
  { ...emptyClient(), id: "cli_2", type: "entreprise", name: "Commune de Lyon", address: "Hôtel de ville", postalCode: "69001", city: "Lyon", country: "France", siret: "21690123400019", tva: "FR00216901234", email: "", phone: "" },
];
const line = { id: "l1", type: "line", designation: "Pose", details: [], qty: 1, unitPrice: 100, tva: 20, discount: 0 };
// Facture créée quand les fiches étaient incomplètes : émetteur sans SIRET ni
// ville, client lié sans ville ni pays.
const stale = () => ({ ...newDocument("facture", []), docNumber: "F-001", issueDate: "2026-09-21", serviceDate: "2026-09-20", items: [line], company: { type: "entreprise", name: "Bâti Plus", siret: "", tva: "", address: "1 rue des Lilas", postalCode: "", city: "", country: "", email: "", phone: "", logo: null }, clientId: "cli_1", client: { type: "particulier", name: "Mme Martin", address: "Adresse saisie", postalCode: "", city: "", country: "", email: "", phone: "" } });

describe("reprise des fiches", () => {
  it("champs vides complétés depuis Mon entreprise et la fiche client liée ; valeurs saisies conservées", () => {
    const d = stale();
    const out = completeDocumentFromRecords(d, profile, clients);
    expect(out).not.toBe(d);
    expect(out.company).toMatchObject({ siret: "12345678900012", tva: "FR12345678900", city: "Lyon", postalCode: "69000", country: "France", email: "c@batiplus.fr", address: "1 rue des Lilas" });
    expect(out.client).toMatchObject({ city: "Marseille", postalCode: "13000", country: "France", email: "martin@exemple.fr", address: "Adresse saisie" }); // adresse saisie gardée
    expect(out.items).toBe(d.items);
  });
  it("client reconnu par son nom (sans clientId) : fiche reprise et lien posé ; rien à faire quand tout est déjà là", () => {
    const d = { ...stale(), clientId: null, client: { type: "entreprise", name: "commune de lyon", address: "", postalCode: "", city: "", country: "", email: "", phone: "" } };
    const out = completeDocumentFromRecords(d, profile, clients);
    expect(out.clientId).toBe("cli_2");
    expect(out.client).toMatchObject({ name: "commune de lyon", city: "Lyon", siret: "21690123400019" });
    const full = completeDocumentFromRecords(out, profile, clients);
    expect(full).toBe(out); // même objet : aucun changement
    expect(clientRecordOf(d, clients).id).toBe("cli_2");
    expect(clientRecordOf({ client: { name: "Inconnu" } }, clients)).toBeNull();
    expect(completeDocumentFromRecords(d, null, [])).toBe(d);
  });
  it("règles de champs : réclamées sans les fiches, satisfaites avec", () => {
    const d = stale();
    expect(documentFieldGaps(d)).toEqual(["Ville du client", "Pays du client", "SIRET de l'émetteur", "N° de TVA de l'émetteur (une ligne porte de la TVA)"]);
    expect(documentValidationErrors(d, { companyProfile: profile, clients })).toEqual([]);
    expect(documentValidationErrors(d, { companyProfile: profile, clients: [] })).toEqual(["Ville du client", "Pays du client"]);
  });
  it("nom reconnu dans un éditeur spécialisé : type, pays, ville, SIRET repris, champs saisis gardés", () => {
    const merged = mergeClientRecord({ type: "entreprise", name: "", address: "Saisie", email: "" }, clients[0], "mme martin");
    expect(merged).toMatchObject({ name: "mme martin", type: "particulier", address: "Saisie", city: "Marseille", country: "France", email: "martin@exemple.fr", phone: "06 11" });
    expect(mergeClientRecord({ name: "x", address: "A" }, null, "Nouveau")).toEqual({ name: "Nouveau", address: "A" });
  });
});

describe("éditeur : choisir un client existant", () => {
  const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  function setValue(input, value) {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  it("toute la fiche est reprise : type, pays, ville, code postal, SIRET, TVA", async () => {
    const noop = () => {};
    const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
    const patches = [];
    const common = { saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onFinalize: noop, onBack: noop, onGoToPricing: noop, clients, products: [], stockByProduct: {}, companyProfile: profile, onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop, onChange: (p) => patches.push(p) };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<Editor {...common} doc={newDocument("facture", [])} />); });
    const search = container.querySelector('input[placeholder="Rechercher un client existant..."]');
    await act(async () => { setValue(search, "Commune"); });
    const choice = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Commune de Lyon");
    expect(choice).toBeTruthy();
    await click(choice);
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    const last = patches.at(-1);
    expect(last.clientId).toBe("cli_2");
    expect(last.client).toMatchObject({ type: "entreprise", name: "Commune de Lyon", city: "Lyon", postalCode: "69001", country: "France", siret: "21690123400019", tva: "FR00216901234" });
    // Plus rien n'est réclamé pour le client dans le bandeau de contrôle
    expect(container.textContent).not.toContain("Ville du client");
    expect(container.textContent).not.toContain("Pays du client");
    await act(async () => { root.unmount(); });
    container.remove();
  }, 30000);
});

describe("fiche client : type et pays", () => {
  it("le formulaire propose Entreprise / Particulier et le pays ; SIRET et TVA masqués pour un particulier", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<ClientsView clients={clients} documents={[]} saving={false} onSave={() => {}} onDelete={() => {}} isLocked={false} isViewer={false} onGoToPricing={() => {}} siteSettings={{ name: "Chantiflow" }} darkMode={false} />); });
    const newBtn = [...container.querySelectorAll("button")].find((b) => /Nouveau client/.test(b.textContent));
    expect(newBtn).toBeTruthy();
    await act(async () => { newBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(container.querySelector('input[placeholder="SIRET (14 chiffres, si professionnel)"]')).toBeTruthy();
    expect(container.textContent).toContain("Type :");
    expect(container.querySelector('[title="Pays du client (imprimé sur la facture, requis pour Factur-X)"]')).toBeTruthy();
    const particulier = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Particulier");
    await act(async () => { particulier.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(container.querySelector('input[placeholder="SIRET (14 chiffres, si professionnel)"]')).toBeNull();
    expect(container.querySelector('input[placeholder="Nom et prénom"]')).toBeTruthy();
    await act(async () => { root.unmount(); });
    container.remove();
  }, 30000);
});
