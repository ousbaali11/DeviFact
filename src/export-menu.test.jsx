// @vitest-environment jsdom
// Priorité 7 : menu « Exporter » groupé dans les éditeurs (PDF, Excel,
// Factur-X, lien public, QR code) — mêmes actions, un seul bouton ; QR code
// du lien public en grand.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("./client.js", () => ({
  db: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => { throw new Error("pas d'accès base attendu"); },
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
import { Editor, ContratChantierEditor, ExportMenu, QrCodeDialog, newDocument, newContratChantierDocument, emptyCompanyProfile, PLANS } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null; });

const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", email: "t@e.fr", memberships: [] };
const line = { id: "l1", type: "line", designation: "Pose", details: [], qty: 1, unitPrice: 100, tva: 20, discount: 0 };
const props = { saving: false, account, plans: PLANS, siteSettings: { name: "Chantiflow" }, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop, products: [], stockByProduct: {}, companyProfile: { ...emptyCompanyProfile(), name: "Bâti Plus" }, onConvert: noop, onSaveClient: noop, onSaveProduct: noop, onSplit: noop, splitNotice: null, onOpenSplitDoc: noop, onDismissSplitNotice: noop, clients: [] };
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const buttons = (c) => [...c.querySelectorAll("button")].map((b) => b.textContent.trim());
const menuButton = (c) => c.querySelector('[data-testid="export-menu"] > button');
const menuItems = (c) => [...c.querySelectorAll('[data-testid="export-menu"] [role="menuitem"]')].map((b) => b.textContent.trim());

describe("éditeur principal", () => {
  it("devis : un seul bouton Exporter ; PDF, Excel, Lien de signature, QR code ; pas de Factur-X ; Convertir et Présentation restent à part", async () => {
    const devis = { ...newDocument("devis", []), docNumber: "DEV-1", items: [line], client: { type: "particulier", name: "M. Dupont" } };
    const { container, unmount } = await mount(<Editor {...props} doc={devis} />);
    const before = buttons(container);
    expect(before).toContain("Exporter");
    expect(before).not.toContain("PDF");
    expect(before).not.toContain("Excel");
    expect(before.some((b) => b.startsWith("Lien de"))).toBe(false);
    expect(before).toContain("Convertir en facture");
    expect(before).toContain("Présentation");
    await click(menuButton(container));
    expect(menuItems(container)).toEqual(["PDF", "Excel", "Lien de signature", "QR code du lien"]);
    expect(menuButton(container).getAttribute("aria-expanded")).toBe("true");
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(menuItems(container)).toEqual([]);
    await unmount();
  }, 30000);
  it("facture : Factur-X et Lien de paiement en plus ; lecteur : ni lien ni QR code", async () => {
    const facture = { ...newDocument("facture", []), docNumber: "FAC-1", items: [line], client: { type: "particulier", name: "M. Dupont" } };
    const a = await mount(<Editor {...props} doc={facture} />);
    await click(menuButton(a.container));
    expect(menuItems(a.container)).toEqual(["PDF", "Excel", "Factur-X (facture électronique)", "Lien de paiement", "QR code du lien"]);
    await a.unmount();
    const b = await mount(<Editor {...props} doc={facture} isViewer />);
    await click(menuButton(b.container));
    expect(menuItems(b.container)).toEqual(["PDF", "Excel", "Factur-X (facture électronique)"]);
    await b.unmount();
  }, 30000);
  it("clic à l'extérieur : le menu se ferme ; une entrée déclenche son action et referme", async () => {
    const calls = [];
    const { container, unmount } = await mount(<div><ExportMenu items={[{ id: "pdf", label: "PDF", onClick: () => calls.push("pdf") }, null, { id: "x", label: "Excel", onClick: () => calls.push("excel") }]} /><p id="outside">ailleurs</p></div>);
    await click(menuButton(container));
    expect(menuItems(container)).toEqual(["PDF", "Excel"]);
    await act(async () => { container.querySelector("#outside").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(menuItems(container)).toEqual([]);
    await click(menuButton(container));
    await click(container.querySelector('[role="menuitem"]'));
    expect(calls).toEqual(["pdf"]);
    expect(menuItems(container)).toEqual([]);
    await unmount();
  }, 30000);
  it("génération en cours : le bouton l'indique et l'entrée est inactive", async () => {
    const { container, unmount } = await mount(<ExportMenu items={[{ id: "pdf", label: "PDF", onClick: noop, busy: true }, { id: "x", label: "Excel", onClick: noop }]} />);
    expect(menuButton(container).textContent).toContain("Génération…");
    await click(menuButton(container));
    expect(container.querySelector('[role="menuitem"]').disabled).toBe(true);
    await unmount();
  }, 30000);
});

describe("éditeurs spécialisés et QR code", () => {
  it("contrat : menu avec PDF et Excel seulement", async () => {
    const contrat = { ...newContratChantierDocument([]), docNumber: "CTR-1" };
    const { container, unmount } = await mount(<ContratChantierEditor doc={contrat} saving={false} account={account} plans={PLANS} siteSettings={{ name: "Chantiflow" }} isLocked={false} isViewer={false} onChange={noop} onFinalize={noop} onBack={noop} onGoToPricing={noop} companyProfile={props.companyProfile} clients={[]} />);
    expect(buttons(container)).not.toContain("PDF");
    await click(menuButton(container));
    expect(menuItems(container)).toEqual(["PDF", "Excel"]);
    await unmount();
  }, 30000);
  it("QR code : image, lien, copie et fermeture", async () => {
    const closed = [];
    const written = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { written.push(t); } }, configurable: true });
    const qr = { url: "https://www.chantiflow.fr/?voir-document=abc", dataUrl: "data:image/png;base64,AAAA" };
    const { container, unmount } = await mount(<QrCodeDialog qr={qr} title="QR code du lien de signature" onClose={() => closed.push(1)} />);
    expect(container.querySelector('[data-testid="qr-dialog"] img').getAttribute("src")).toBe(qr.dataUrl);
    expect(container.textContent).toContain(qr.url);
    expect(container.querySelector('a[download="qr-code.png"]')).toBeTruthy();
    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Copier le lien"));
    expect(written).toEqual([qr.url]);
    expect(container.textContent).toContain("Lien copié");
    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Fermer"));
    expect(closed).toEqual([1]);
    await unmount();
    const empty = await mount(<QrCodeDialog qr={null} title="x" onClose={noop} />);
    expect(empty.container.querySelector('[data-testid="qr-dialog"]')).toBeNull();
    await empty.unmount();
  }, 30000);
});
