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

describe("Atelier (menu Plus)", () => {
  const account = { id: "u", organizationId: "org", plan: "pro", role: "owner", email: "t@e.fr", firstName: "Thomas", memberships: [{ organizationId: "org", role: "owner", name: "Org" }] };
  const shell = (view, setView = () => {}) => (
    <AtelierShell view={view} setView={setView} account={account} siteSettings={{ name: "Chantiflow", landingPageVersion: "atelier" }} darkMode={false} setDarkMode={() => {}} onLogout={() => {}} onSwitchOrganization={() => {}} onCreateOwnOrg={() => {}} creatingOwnOrg={false} onOpenCreate={() => {}} commandPaletteOpen={false} setCommandPaletteOpen={() => {}} paletteCommands={[]}>
      <div>page</div>
    </AtelierShell>
  );
  const openMore = async (container) => { await click([...container.querySelectorAll("button")].find((b) => b.getAttribute("title") === "Menu" || /Menu/i.test(b.textContent))); };
  it("une seule entrée « Gestion de stock » dans le menu Plus, qui se déplie sur les six entrées dans l'ordre", async () => {
    const views = [];
    const { container, unmount } = await mount(shell("dashboard", (v) => views.push(v)));
    await openMore(container);
    // Le menu Plus est rendu deux fois (en-tête bureau et barre mobile) : on
    // raisonne sur le premier ; chacun ne contient qu'une entrée « Gestion de stock ».
    const labels = buttons(container);
    expect(labels.filter((l) => l.startsWith("Gestion de stock"))).toHaveLength(2);
    expect(labels.filter((l) => l.startsWith("Gestion de stock ·"))).toHaveLength(0);
    expect(labels).not.toContain("Produits");
    await click(stockButton(container));
    const after = buttons(container);
    for (const l of ORDER) expect(after, l).toContain(l);
    expect(ORDER.map((l) => after.indexOf(l))).toEqual([...ORDER.map((l) => after.indexOf(l))].sort((a, b) => a - b));
    await click([...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Documents de stock"));
    expect(views).toEqual(["stock-documents"]);
    await unmount();
  });
  it("déplié d'office sur une page du stock", async () => {
    const { container, unmount } = await mount(shell("stock-produits"));
    await openMore(container);
    expect(buttons(container)).toContain("Produits");
    await unmount();
  });
});
