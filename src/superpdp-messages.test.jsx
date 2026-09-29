// @vitest-environment jsdom
// Super PDP, étape 4 (30/09/2026), chantier 3 — messages en français :
// traduction des messages connus de l'API, des événements et de la page
// d'autorisation ; glossaire des règles de validation (règle entre crochets,
// repli explicite pour une règle inconnue) ; texte d'origine conservé sinon ;
// parité site / serveur ; bandeau de rejet en français pour un échec réel.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor, newDocument, emptyCompanyProfile, PLANS } from "./App.jsx";
import * as site from "./pdp-rules.js";
import * as server from "../supabase/functions/_shared/superpdp-rules.ts";

describe("traduction des messages", () => {
  it("messages connus de l'API et de l'autorisation → phrase française avec la marche à suivre", () => {
    expect(site.translatePdpMessage("Application environment do not match company environement.")).toContain("même environnement (bac à sable ou production)");
    expect(site.translatePdpMessage("L'entreprise (000000002) liée à cette session ne correspond pas au vendeur de la facture (315143296).")).toContain("déconnecte puis reconnecte le bon compte");
    expect(site.translatePdpMessage("company_verification_status is not verified")).toContain("pas encore vérifiée");
    expect(site.translatePdpMessage("invalid_grant: Invalid Refresh Token")).toContain("reconnecte le compte");
    expect(site.translatePdpMessage("Recipient 0225:123456789 not found in directory")).toContain("annuaire");
    expect(site.translatePdpMessage("external_id already exists")).toContain("même identifiant");
    expect(site.translatePdpMessage("Unable to parse PDF")).toContain("Fichier illisible");
    expect(site.translatePdpMessage("Refused by buyer: wrong amount")).toBe("Refusée par le client : wrong amount");
    expect(site.translatePdpMessage("Refused by the buyer")).toBe("Refusée par le client.");
    expect(site.translatePdpMessage("Rejected by recipient platform: unknown address")).toBe("Rejetée par la plateforme du client : unknown address");
  });
  it("codes HTTP sans message connu : phrase selon le code ; message inconnu conservé avec préfixe ; message déjà français inchangé", () => {
    expect(site.translatePdpMessage("", 429)).toContain("Trop de demandes");
    expect(site.translatePdpMessage("Something odd", 429)).toContain("Trop de demandes");
    expect(site.translatePdpMessage("Internal Server Error", 502)).toContain("Panne temporaire chez Super PDP (réponse 502)");
    expect(site.translatePdpMessage("", 401)).toContain("Session Super PDP expirée");
    expect(site.translatePdpMessage("", 400)).toBe("Super PDP a répondu 400 sans détail.");
    expect(site.translatePdpMessage("")).toBe("Super PDP n'a pas donné de détail.");
    expect(site.translatePdpMessage("Weird unexpected thing happened", 400)).toBe("Super PDP indique : Weird unexpected thing happened");
    expect(site.translatePdpMessage("Le client (315143296_106842) n'est pas dans l'annuaire.")).toBe("Le client (315143296_106842) n'est pas dans l'annuaire.");
  });
});

describe("glossaire des règles de validation", () => {
  it("règle connue → phrase du glossaire avec l'identifiant ; règle inconnue → repli explicite avec le texte d'origine ; sans règle → texte tel quel", () => {
    expect(site.pdpRuleOf("[BR-CO-09] The Seller VAT identifier (BT-31)…")).toBe("BR-CO-09");
    expect(site.pdpRuleOf("BR-S-08 VAT category taxable amount")).toBe("BR-S-08");
    expect(site.pdpRuleOf("No rule here")).toBeNull();
    expect(site.explainValidationFailure("[BR-CO-09] The Seller VAT identifier (BT-31), the Seller tax representative VAT identifier (BT-63) and the Buyer VAT identifier (BT-48) shall have a prefix…")).toBe("[BR-CO-09] Le numéro de TVA de l'émetteur ou du client doit commencer par le code pays sur deux lettres (ex. FR12345678901) : à corriger dans Mon entreprise ou sur la fiche client.");
    expect(site.explainValidationFailure("[BR-CO-15] Invoice total amount with VAT (BT-112) = Invoice total amount without VAT (BT-109) + Invoice total VAT amount (BT-110).")).toBe("[BR-CO-15] Le total TTC doit être égal au total HT plus la TVA.");
    expect(site.explainValidationFailure("[BR-XY-99] Some brand new rule text")).toBe("[BR-XY-99] Règle non respectée : Some brand new rule text");
    expect(site.explainValidationFailure("Plain text without rule")).toBe("Plain text without rule");
    expect(Object.keys(site.PDP_RULE_GLOSSARY).length).toBeGreaterThanOrEqual(30);
  });
  it("un message d'envoi déjà enregistré avec des règles brutes est expliqué à l'affichage (motif du bandeau)", () => {
    const stored = "Le fichier Factur-X est refusé par la validation Super PDP : [BR-CO-09] The Seller VAT identifier… ; [BR-CO-10] Sum of Invoice line net amount…";
    const reason = site.pdpFailureSummary({ status: "api:invalid", error: stored, attempt: 1 }).reason;
    expect(reason).toContain("[BR-CO-09] Le numéro de TVA");
    expect(reason).toContain("[BR-CO-10] Le total HT des lignes");
    expect(reason).not.toContain("The Seller VAT identifier");
  });
  it("parité site / serveur", () => {
    const samples = ["Application environment do not match company environment", "Refused by buyer: x", "Weird", "", "[BR-CO-16] Amount due for payment", "[BR-ZZ-1] unknown", "Le client n'est pas dans l'annuaire."];
    for (const m of samples) for (const status of [null, 400, 401, 429, 503]) expect(server.translatePdpMessage(m, status)).toBe(site.translatePdpMessage(m, status));
    for (const m of samples) expect(server.explainValidationFailure(m)).toBe(site.explainValidationFailure(m));
    expect(server.PDP_RULE_GLOSSARY).toEqual(site.PDP_RULE_GLOSSARY);
    expect(server.PDP_MESSAGE_TRANSLATIONS.map((t) => String(t.test))).toEqual(site.PDP_MESSAGE_TRANSLATIONS.map((t) => String(t.test)));
  });
});

describe("bandeau de rejet en français", () => {
  beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null; });
  it("échec réel du 29/09 (BR-CO-09) : le motif affiché est la phrase du glossaire, pas le texte anglais", async () => {
    const noop = () => {};
    const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@exemple.fr", memberships: [] };
    const props = { saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, products: [], stockByProduct: {}, clients: [], companyProfile: { ...emptyCompanyProfile(), name: "Bâti Plus", country: "🇫🇷 FR" }, onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop };
    const doc = { ...newDocument("facture", []), docNumber: "FAC-026", status: "envoyée", pdp: { invoiceId: null, status: "api:invalid", statusText: "Fichier refusé", error: "Le fichier Factur-X est refusé par la validation Super PDP : [BR-CO-09] The Seller VAT identifier (BT-31), the Seller tax representative VAT identifier (BT-63) and the Buyer VAT identifier (BT-48) shall have a prefix in accordance with ISO code ISO 3166-1 alpha-2 by which the country of issue may be identified.", attempt: 1 } };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<Editor {...props} doc={doc} />); });
    const reason = container.querySelector('[data-testid="pdp-reject-reason"]').textContent;
    expect(reason).toContain("[BR-CO-09] Le numéro de TVA de l'émetteur ou du client doit commencer par le code pays");
    expect(reason).not.toContain("shall have a prefix");
    await act(async () => { root.unmount(); });
    container.remove();
  }, 30000);
});
