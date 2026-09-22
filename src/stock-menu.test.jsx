// @vitest-environment jsdom
// Menu « Gestion de stock » : un seul bouton qui se déplie sur six entrées,
// dans l'ordre demandé, dans les trois versions (barre Classique, sidebar et
// mobile Avancée, menu Plus d'Atelier).
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { StockMenu, STOCK_MENU, AtelierShell } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });

const ORDER = ["Produits", "Entrepôts", "Entrée", "Sortie", "Documents de stock", "Comptabilité"];
const styleFor = (active) => ({ background: active ? "#000" : "transparent" });
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const buttons = (c) => [...c.querySelectorAll("button")].map((b) => b.textContent.trim());
const stockButton = (c) => [...c.querySelectorAll("button")].find((b) => b.textContent.includes("Gestion de stock"));

describe("ordre et libellés", () => {
  it("six entrées dans l'ordre demandé", () => {
    expect(STOCK_MENU.map((m) => m.label)).toEqual(ORDER);
    expect(STOCK_MENU.map((m) => m.id)).toEqual(["stock-produits", "stock-entrepots", "stock-entree", "stock-sortie", "stock-documents", "stock-comptabilite"]);
  });
});

describe("sidebar Avancée et menus mobiles (accordéon)", () => {
  for (const variant of ["sidebar", "inline"]) {
    it(`${variant} : un seul bouton, replié hors du stock, se déplie et se replie au clic, dans l'ordre`, async () => {
      const { container, unmount } = await mount(<StockMenu variant={variant} view="dashboard" setView={() => {}} locked={false} styleFor={styleFor} itemClass="px-3 py-2 text-xs" />);
      expect(buttons(container)).toEqual(["Gestion de stock"]);
      await click(stockButton(container));
      expect(buttons(container)).toEqual(["Gestion de stock", ...ORDER]);
      expect(stockButton(container).getAttribute("aria-expanded")).toBe("true");
      await click(stockButton(container));
      expect(buttons(container)).toEqual(["Gestion de stock"]);
      await unmount();
    });
  }
  it("déplié d'office quand une page du stock est ouverte, l'entrée active marquée", async () => {
    const { container, unmount } = await mount(<StockMenu variant="sidebar" view="stock-entrepots" setView={() => {}} locked={false} styleFor={styleFor} />);
    expect(buttons(container)).toEqual(["Gestion de stock", ...ORDER]);
    const active = [...container.querySelectorAll("button")].filter((b) => b.style.background === "rgb(0, 0, 0)").map((b) => b.textContent.trim());
    expect(active).toEqual(["Entrepôts"]);
    await unmount();
  });
  it("navigue et referme le menu mobile", async () => {
    const views = []; let closed = 0;
    const { container, unmount } = await mount(<StockMenu variant="inline" view="dashboard" setView={(v) => views.push(v)} locked={false} styleFor={styleFor} onNavigate={() => { closed += 1; }} />);
    await click(stockButton(container));
    await click([...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Comptabilité"));
    expect(views).toEqual(["stock-comptabilite"]);
    expect(closed).toBe(1);
    await unmount();
  });
});

describe("barre Classique (menu déroulant)", () => {
  it("un seul bouton, liste déroulante dans l'ordre, refermée après un choix", async () => {
    const views = [];
    const { container, unmount } = await mount(<StockMenu variant="dropdown" view="dashboard" setView={(v) => views.push(v)} locked={false} styleFor={styleFor} iconColor="#8F5C2E" />);
    expect(buttons(container)).toEqual(["Gestion de stock"]);
    await click(stockButton(container));
    expect(buttons(container)).toEqual(["Gestion de stock", ...ORDER]);
    await click([...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Sortie"));
    expect(views).toEqual(["stock-sortie"]);
    expect(buttons(container)).toEqual(["Gestion de stock"]);
    await unmount();
  });
});

describe("Atelier (barre principale)", () => {
  const account = { id: "u", organizationId: "org", plan: "pro", role: "owner", email: "t@e.fr", firstName: "Thomas", memberships: [{ organizationId: "org", role: "owner", name: "Org" }] };
  const shell = (view, setView = () => {}) => (
    <AtelierShell view={view} setView={setView} account={account} siteSettings={{ name: "Chantiflow", landingPageVersion: "atelier" }} darkMode={false} setDarkMode={() => {}} onLogout={() => {}} onSwitchOrganization={() => {}} onCreateOwnOrg={() => {}} creatingOwnOrg={false} onOpenCreate={() => {}} commandPaletteOpen={false} setCommandPaletteOpen={() => {}} paletteCommands={[]}>
      <div>page</div>
    </AtelierShell>
  );
  const openMore = async (container) => { await click([...container.querySelectorAll("button")].find((b) => b.getAttribute("title") === "Menu")); };
  const headerNav = (c) => c.querySelector("header nav");
  // Libellé d'un bouton de l'en-tête : titre, sinon premier span (les onglets
  // ont deux spans, grand et petit écran, avec le même texte).
  const labelOf = (b) => b.getAttribute("title") || b.querySelector("span")?.textContent.trim() || b.textContent.trim();
  it("en-tête : « Gestion de stock » juste après Clients, au même niveau, déroulant sur les six entrées ; absent du menu Plus", async () => {
    const views = [];
    const { container, unmount } = await mount(shell("dashboard", (v) => views.push(v)));
    const nav = headerNav(container);
    expect([...nav.querySelectorAll(":scope > button, :scope > div > button")].map(labelOf)).toEqual(["Accueil", "Documents", "Chantiers", "Clients", "Gestion de stock"]);
    await openMore(container);
    expect([...container.querySelectorAll("button")].filter((b) => b.getAttribute("title") === "Gestion de stock")).toHaveLength(2); // en-tête + onglet « Stock » du bas, rien dans le menu Plus
    expect(buttons(container)).not.toContain("Produits");
    await click(stockButton(nav));
    const after = buttons(container);
    for (const l of ORDER) expect(after, l).toContain(l);
    expect(ORDER.map((l) => after.indexOf(l))).toEqual([...ORDER.map((l) => after.indexOf(l))].sort((a, b) => a - b));
    await click([...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Documents de stock"));
    expect(views).toEqual(["stock-documents"]);
    await unmount();
  });
  it("téléphone : sixième onglet « Stock » dans la barre du bas, volet avec les six entrées, actif sur une page du stock", async () => {
    const views = [];
    const { container, unmount } = await mount(shell("stock-produits", (v) => views.push(v)));
    const bottom = container.querySelector("nav.grid");
    expect(bottom.className).toContain("grid-cols-6");
    expect([...bottom.querySelectorAll("button")].map((b) => b.textContent.trim())).toEqual(["Accueil", "Documents", "Créer", "Chantiers", "Clients", "Stock"]);
    const stockTab = [...bottom.querySelectorAll("button")].find((b) => b.textContent.trim() === "Stock");
    expect(stockTab.getAttribute("title")).toBe("Gestion de stock");
    const clientsTab = [...bottom.querySelectorAll("button")].find((b) => b.textContent.trim() === "Clients");
    expect(stockTab.style.color).not.toBe(clientsTab.style.color); // onglet actif (page du stock ouverte)
    expect(container.querySelector('[role="dialog"][aria-label="Gestion de stock"]')).toBeNull();
    await click(stockTab);
    const sheet = container.querySelector('[role="dialog"][aria-label="Gestion de stock"]');
    expect(sheet).toBeTruthy();
    expect([...sheet.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean)).toEqual(ORDER);
    await click([...sheet.querySelectorAll("button")].find((b) => b.textContent.trim() === "Sortie"));
    expect(views).toEqual(["stock-sortie"]);
    await unmount();
  });
});
