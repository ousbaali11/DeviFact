// @vitest-environment jsdom
// Priorité 5 : attestations et assurances de l'entreprise (fichiers dans
// le bucket privé company-files, décrites dans la fiche entreprise,
// propriétaire seulement), jointes aux devis (PDF + lien public) et aux
// contrats (PDF), alerte à 30 jours puis rouge tant qu'une attestation
// expirée n'est pas remplacée.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

const publicState = { response: null };
vi.mock("./client.js", () => ({
  db: {
    functions: { invoke: async () => ({ data: publicState.response, error: null }) },
    from: () => { throw new Error("pas d'accès base attendu"); },
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed.test/f.pdf" }, error: null }) }) },
  },
}));
import { attestationsWithState, validAttestations, attestationAlerts, attachedAttestationsLine, attestationStateLabel, attestationFileProblem, appendAttachmentsToPdf, ATTESTATION_KINDS } from "./attestations.js";
import { validAttestations as validServer, attestationLabel as labelServer } from "../supabase/functions/_shared/attestations.ts";
import { AttestationsCard, Editor, ContratChantierEditor, PrintDocument, PrintContrat, PublicDocumentView, AtelierHome, newDocument, newContratChantierDocument, computeTotals, emptyCompanyProfile, companySnapshotOf, PLANS } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null; });

const today = new Date(2026, 8, 25); // 25 septembre 2026
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const inDays = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return iso(d); };
const clean = (s) => s.replace(/[  ]/g, " ");
const att = (extra = {}) => ({ id: "a1", kind: "decennale", label: "", organism: "AXA", number: "123", issuedAt: "2025-10-01", expiresAt: "2026-10-20", path: "org/attestations/1-dec.pdf", fileName: "decennale.pdf", size: 1000, mime: "application/pdf", ...extra });
const profile = (list) => ({ ...emptyCompanyProfile(), name: "Bâti Plus", attestations: list });
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const noop = () => {};
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent;

describe("états, alertes, jointure", () => {
  it("valide, expire bientôt (30 j ou moins), expirée ; tri par urgence ; libellé libre pour « Autre »", () => {
    const list = attestationsWithState(profile([
      att(), // 25 j
      att({ id: "a2", kind: "urssaf", organism: "URSSAF", expiresAt: "2027-03-01" }),
      att({ id: "a3", kind: "autre", label: "Qualification amiante", expiresAt: "2026-09-01" }), // expirée depuis 24 j
      att({ id: "a4", kind: "rc_pro", expiresAt: "2026-09-25" }), // aujourd'hui
    ]), today);
    expect(list.map((a) => [a.id, a.label, a.state, a.daysLeft])).toEqual([
      ["a3", "Qualification amiante", "expiree", -24],
      ["a4", "Responsabilité civile professionnelle", "expire_bientot", 0],
      ["a1", "Assurance décennale", "expire_bientot", 25],
      ["a2", "Attestation de vigilance URSSAF", "valide", 157],
    ]);
    expect(list.map(attestationStateLabel)).toEqual(["Expirée depuis 24 j", "Expire aujourd'hui", "Expire dans 25 j", "Valide"]);
    expect(ATTESTATION_KINDS.map(([id]) => id)).toContain("kbis");
  });
  it("jointes aux documents : valides seulement (y compris « expire bientôt »), munies d'un fichier ; parité serveur", () => {
    const p = profile([att(), att({ id: "a3", expiresAt: "2026-09-01" }), att({ id: "a5", path: "", expiresAt: "2027-01-01" }), att({ id: "a4", kind: "rc_pro", expiresAt: "2026-09-25" })]);
    expect(validAttestations(p, today).map((a) => a.id)).toEqual(["a4", "a1"]);
    expect(validServer(p, new Date(Date.UTC(2026, 8, 25, 12))).map((a) => a.id)).toEqual(["a4", "a1"]);
    expect(labelServer({ kind: "autre", label: "Amiante" })).toBe("Amiante");
    expect(attachedAttestationsLine(p, today)).toBe("Pièces jointes : Responsabilité civile professionnelle (AXA), valide jusqu'au 25 septembre 2026 ; Assurance décennale (AXA), valide jusqu'au 20 octobre 2026.");
    expect(attachedAttestationsLine(profile([]), today)).toBe("");
  });
  it("alertes : à 30 jours puis expirée (rouge) ; rien pour une attestation valide", () => {
    const alerts = attestationAlerts(profile([att(), att({ id: "a2", expiresAt: "2027-03-01" }), att({ id: "a3", expiresAt: "2026-09-01" })]), today);
    expect(alerts.map((a) => [a.id, a.state, a.daysLeft])).toEqual([["a3", "expiree", -24], ["a1", "expire_bientot", 25]]);
  });
  it("fichiers acceptés : PDF, JPG, PNG, 10 Mo ; date manquante = expirée", () => {
    expect(attestationFileProblem({ name: "a.pdf", size: 1000 })).toBe("");
    expect(attestationFileProblem({ name: "a.docx", size: 1000 })).toContain("PDF, JPG ou PNG");
    expect(attestationFileProblem({ name: "a.png", size: 11 * 1024 * 1024 })).toContain("10 Mo");
    expect(attestationsWithState(profile([att({ expiresAt: "" })]), today)[0].state).toBe("expiree");
  });
  it("la liste des attestations n'est jamais copiée dans un document", () => {
    expect(companySnapshotOf(profile([att()]))).not.toHaveProperty("attestations");
  });
});

describe("fusion PDF", () => {
  it("document (1 page) + attestation PDF (2 pages) + image PNG (1 page) = 4 pages ; fichier illisible ignoré et signalé", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const mk = async (n) => { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([595, 842]); return await d.save(); };
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const { bytes, skipped } = await appendAttachmentsToPdf(await mk(1), [
      { bytes: await mk(2), mime: "application/pdf", name: "decennale.pdf" },
      { bytes: png, mime: "image/png", name: "kbis.png" },
      { bytes: new Uint8Array([1, 2, 3]), mime: "application/pdf", name: "cassé.pdf" },
    ]);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(4);
    expect(skipped).toEqual(["cassé.pdf"]);
  }, 30000);
});

describe("Mon entreprise : carte Attestations", () => {
  it("propriétaire : liste avec états, boutons d'ajout, modification et suppression ; formulaire d'ajout avec les types", async () => {
    const { container, unmount } = await mount(<AttestationsCard profile={profile([att({ expiresAt: inDays(12) }), att({ id: "a3", kind: "urssaf", organism: "URSSAF", expiresAt: inDays(-3) })])} account={account} isLocked={false} isViewer={false} saving={false} onSave={async () => {}} />);
    const text = clean(container.textContent);
    expect(text).toContain("Assurance décennale · AXA · n° 123");
    expect(text).toContain("Expire dans 12 j");
    expect(text).toContain("Expirée depuis 3 j");
    expect(container.querySelectorAll('[data-testid="attestation-row"]')).toHaveLength(2);
    expect(container.querySelector('button[aria-label="Supprimer Assurance décennale"]')).toBeTruthy();
    await click([...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Ajouter une attestation"));
    const form = container.querySelector('[data-testid="attestation-form"]');
    expect(form).toBeTruthy();
    expect([...form.querySelectorAll("select option")].map((o) => o.textContent)).toContain("Attestation de vigilance URSSAF");
    expect(form.querySelector('input[type="file"]')).toBeTruthy();
    // Ajouter sans date : refus clair, aucun enregistrement.
    await click([...form.querySelectorAll("button")].find((b) => b.textContent.trim() === "Ajouter"));
    expect(container.textContent).toContain("Indique la date d'expiration.");
    await unmount();
  }, 30000);
  it("éditeur (non propriétaire) : liste en lecture seule, aucun bouton, mention explicite", async () => {
    const { container, unmount } = await mount(<AttestationsCard profile={profile([att()])} account={{ ...account, role: "editor" }} isLocked={false} isViewer={false} saving={false} onSave={async () => {}} />);
    expect(container.textContent).toContain("Gestion réservée au propriétaire de l'organisation.");
    expect(container.textContent).toContain("Assurance décennale");
    expect([...container.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean)).toEqual([]);
    expect(container.querySelector('button[aria-label="Supprimer Assurance décennale"]')).toBeNull();
    await unmount();
  }, 30000);
});

describe("devis et contrat : case « Joindre », mentions, PDF", () => {
  const siteSettings = { name: "Chantiflow" };
  const line = { id: "l1", type: "line", designation: "Pose", details: [], qty: 1, unitPrice: 100, tva: 20, discount: 0 };
  const editorProps = { saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onFinalize: noop, onBack: noop, onGoToPricing: noop, products: [], stockByProduct: {}, onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop, clients: [] };
  it("nouveaux devis et contrats : case cochée d'office ; facture : pas de case", () => {
    expect(newDocument("devis", []).attachAttestations).toBe(true);
    expect(newDocument("facture", []).attachAttestations).toBe(false);
    expect(newContratChantierDocument([]).attachAttestations).toBe(true);
  });
  it("éditeur de devis : compte des attestations valides, avertissement sur l'expirée, décoche enregistrée", async () => {
    const changes = [];
    const prof = profile([att({ expiresAt: inDays(40) }), att({ id: "a3", kind: "urssaf", expiresAt: inDays(-3) })]);
    const devis = { ...newDocument("devis", []), docNumber: "DEV-1", items: [line], client: { type: "particulier", name: "M. Dupont" } };
    const { container, unmount } = await mount(<Editor {...editorProps} doc={devis} companyProfile={prof} onChange={(p) => changes.push(p)} />);
    const toggle = container.querySelector('[data-testid="attach-attestations"]');
    expect(clean(toggle.textContent)).toContain("au PDF et au lien public (1)");
    expect(toggle.textContent).toContain("1 attestation expirée, jamais jointe");
    const box = toggle.querySelector('input[type="checkbox"]');
    expect(box.checked).toBe(true);
    await click(box);
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(changes[changes.length - 1]).toMatchObject({ attachAttestations: false });
    await unmount();
  }, 30000);
  it("éditeur de contrat : la case existe (PDF seulement)", async () => {
    const contrat = { ...newContratChantierDocument([]), docNumber: "CTR-1" };
    const { container, unmount } = await mount(<ContratChantierEditor doc={contrat} saving={false} account={account} plans={PLANS} siteSettings={siteSettings} isLocked={false} isViewer={false} onChange={noop} onFinalize={noop} onBack={noop} onGoToPricing={noop} companyProfile={profile([att({ expiresAt: inDays(40) })])} clients={[]} />);
    const toggle = container.querySelector('[data-testid="attach-attestations"]');
    expect(clean(toggle.textContent)).toContain("au PDF (1)");
    expect(toggle.textContent).not.toContain("lien public");
    await unmount();
  }, 30000);
  it("PDF du devis et du contrat : ligne « Pièces jointes » quand la case est cochée, absente sinon", () => {
    const prof = profile([att({ expiresAt: "2027-03-01" })]);
    const devis = { ...newDocument("devis", []), docNumber: "DEV-1", issueDate: "2026-09-21", items: [line], company: { ...prof, attestations: undefined }, client: { type: "particulier", name: "M. Dupont" } };
    const pdf = (d) => textOf(renderToStaticMarkup(<PrintDocument doc={d} totals={computeTotals(d)} siteSettings={siteSettings} watermarkEnabled={false} companyProfile={prof} />));
    expect(pdf(devis)).toContain("Pièces jointes : Assurance décennale (AXA), valide jusqu'au 01 mars 2027.");
    expect(pdf({ ...devis, attachAttestations: false })).not.toContain("Pièces jointes");
    const contrat = { ...newContratChantierDocument([]), docNumber: "CTR-1", objetTravaux: "Toiture", company: { ...prof, attestations: undefined }, client: { type: "particulier", name: "M. Dupont" } };
    const pdfC = (d) => textOf(renderToStaticMarkup(<PrintContrat doc={d} siteSettings={siteSettings} watermarkEnabled={false} companyProfile={prof} />));
    expect(pdfC(contrat)).toContain("Pièces jointes : Assurance décennale (AXA), valide jusqu'au 01 mars 2027.");
    expect(pdfC({ ...contrat, attachAttestations: false })).not.toContain("Pièces jointes");
  });
});

describe("page publique du devis", () => {
  it("attestations à télécharger quand le serveur les envoie ; rien sinon", async () => {
    const devis = { id: "d1", type: "devis", docNumber: "DEV-1", status: "envoyé", currency: "EUR", company: { type: "entreprise", name: "Bâti Plus" }, client: { name: "M. Dupont" }, items: [{ id: "l1", type: "line", designation: "Pose", qty: 1, unitPrice: 100, tva: 20 }] };
    publicState.response = { document: devis, siteName: "Chantiflow", signedAt: null, paidAt: null, attachments: [{ label: "Assurance décennale", organism: "AXA", expiresAt: "2027-03-01", fileName: "decennale.pdf", url: "https://signed.test/decennale.pdf" }] };
    const a = await mount(<PublicDocumentView token="abc" />);
    const block = a.container.querySelector('[data-testid="public-attachments"]');
    expect(block).toBeTruthy();
    expect(clean(block.textContent)).toContain("Assurance décennale (AXA) · valide jusqu'au 01 mars 2027");
    expect(block.querySelector("a").getAttribute("href")).toBe("https://signed.test/decennale.pdf");
    await a.unmount();
    publicState.response = { document: devis, siteName: "Chantiflow", signedAt: null, paidAt: null };
    const b = await mount(<PublicDocumentView token="abc" />);
    expect(b.container.querySelector('[data-testid="public-attachments"]')).toBeNull();
    await b.unmount();
  }, 30000);
});

describe("tableau de bord", () => {
  it("attestation expirée en rouge puis attestation à 12 jours, clic vers Mon entreprise, tous forfaits", async () => {
    const opened = [];
    const alerts = attestationAlerts(profile([att({ expiresAt: inDays(12) }), att({ id: "a3", kind: "urssaf", expiresAt: inDays(-5) })]));
    const props = { documents: [], darkMode: false, isLocked: false, isViewer: false, freeLimit: 10, freeLimitReached: false, offlineMode: false, visibleServices: ["devis"], reminders: [], reminderMailto: () => "#", onCreate: noop, onOpenCreate: noop, onOpenDoc: noop, onGoToDocuments: noop, onGoToPricing: noop, autoFactureNotice: null, onOpenAutoFacture: noop, onDismissAutoFacture: noop, reviewNotice: null, onSendReview: noop, onDismissReview: noop };
    const { container, unmount } = await mount(<AtelierHome {...props} account={{ ...account, organizationId: null, plan: "gratuit", paymentStatus: "gratuit" }} attestationAlerts={alerts} onOpenCompany={() => opened.push("company")} />);
    const rows = [...container.querySelectorAll('[data-testid="attestation-alert"]')];
    expect(rows).toHaveLength(2);
    expect(clean(rows[0].textContent)).toContain("Attestation de vigilance URSSAF · Mon entreprise");
    expect(rows[0].textContent).toContain("Expirée depuis 5 j");
    expect(rows[1].textContent).toContain("Expire dans 12 j");
    await click(rows[0]);
    expect(opened).toEqual(["company"]);
    await unmount();
  }, 30000);
});
