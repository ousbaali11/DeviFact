// @vitest-environment jsdom
// Stripe Connect : compte connecté pré-rempli depuis Mon entreprise (type,
// nom, SIRET, adresse, téléphone, IBAN) et le profil (prénom, nom), pour
// que la page Stripe ne demande que le reste. Montage inchangé : Stripe
// porte les pertes, l'artisan paie ses frais, la plateforme rien.
import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { buildConnectAccountParams, withoutBankAccount, sirenOf, frenchIbanOf, splitPersonName } from "../supabase/functions/_shared/connect.ts";
import { StripeConnectCard } from "./App.jsx";

describe("paramètres du compte connecté", () => {
  const base = { organizationId: "org", email: "compte@exemple.fr", firstName: "Thomas", lastName: "Durand" };
  it("entreprise : company, SIREN tiré du SIRET, adresse, IBAN, montage sans frais pour la plateforme", () => {
    const p = buildConnectAccountParams({ ...base, profile: { type: "entreprise", name: "Stratos consulting", siret: "990 597 494 00014", address: "2 rue du Kleegarten", postalCode: "57350", city: "Stiring-Wendel", phone: "0668776128", email: "contact@stratos.fr", iban: "FR76 3000 6000 0112 3456 7890 189" } });
    expect(p.business_type).toBe("company");
    expect(p.company).toEqual({ name: "Stratos consulting", tax_id: "990597494", registration_number: "990597494", phone: "0668776128", address: { line1: "2 rue du Kleegarten", postal_code: "57350", city: "Stiring-Wendel", country: "FR" } });
    expect(p.individual).toBeUndefined();
    expect(p.email).toBe("contact@stratos.fr");
    expect(p.external_account).toEqual({ object: "bank_account", country: "FR", currency: "eur", account_number: "FR7630006000011234567890189", account_holder_name: "Stratos consulting", account_holder_type: "company" });
    expect(p.controller).toEqual({ fees: { payer: "account" }, losses: { payments: "stripe" }, stripe_dashboard: { type: "full" }, requirement_collection: "stripe" });
    expect(p.business_profile.mcc).toBe("1520");
    expect(withoutBankAccount(p).external_account).toBeUndefined();
    expect(withoutBankAccount(p).company).toEqual(p.company);
  });
  it("particulier : individual avec prénom et nom du profil, sinon découpés depuis le nom", () => {
    const p = buildConnectAccountParams({ ...base, profile: { type: "particulier", name: "Jean Dupont", address: "1 rue A", city: "Lyon", postalCode: "69000" } });
    expect(p.business_type).toBe("individual");
    expect(p.individual).toMatchObject({ first_name: "Thomas", last_name: "Durand", email: "compte@exemple.fr" });
    expect(p.company).toBeUndefined();
    const q = buildConnectAccountParams({ organizationId: "org", email: null, profile: { type: "particulier", name: "Marie Claire Martin" } });
    expect(q.individual).toMatchObject({ first_name: "Marie Claire", last_name: "Martin" });
    expect(q.external_account).toBeUndefined(); // pas d'IBAN
    expect(q.email).toBeUndefined();
  });
  it("valeurs douteuses ignorées plutôt que refusées par Stripe : SIRET invalide, IBAN non français", () => {
    expect(sirenOf("12")).toBe("");
    expect(sirenOf("123456789")).toBe("123456789");
    expect(frenchIbanOf("DE89 3704 0044 0532 0130 00")).toBe("");
    expect(frenchIbanOf("fr76 3000 6000 0112 3456 7890 189")).toBe("FR7630006000011234567890189");
    expect(splitPersonName("Dupont")).toEqual({ first: "", last: "Dupont" });
    const p = buildConnectAccountParams({ organizationId: "org", profile: { type: "entreprise", name: "X", siret: "12", iban: "DE89370400440532013000" }, organizationName: "Org" });
    expect(p.company.tax_id).toBeUndefined();
    expect(p.external_account).toBeUndefined();
  });
});

describe("carte : ce qui est pré-rempli", () => {
  it("liste ce que Mon entreprise fournit ; rappel si l'IBAN manque", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const owner = { id: "u1", organizationId: "org", role: "owner", email: "e@x.fr" };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<StripeConnectCard account={{ ...owner, role: "editor" }} profile={{ type: "entreprise", name: "Stratos", siret: "990597494", address: "2 rue", iban: "" }} />); });
    // membre non propriétaire : note seulement (pas d'appel serveur dans ce test)
    expect(container.textContent).toContain("Seul le propriétaire");
    await act(async () => { root.unmount(); });
    container.remove();
  });
});
