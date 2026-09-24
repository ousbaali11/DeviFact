// @vitest-environment jsdom
// Logo + nom du site dans les trois barres de navigation : un vrai lien
// (href) vers l'accueil — clic gauche = navigation interne sans
// rechargement, Ctrl/Cmd-clic = comportement natif du navigateur (nouvel
// onglet) — et « /?accueil » qui force le tableau de bord au chargement.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { HomeLink, HOME_HREF, initialView, TopNav, AtelierShell } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
beforeEach(() => { localStorage.clear(); window.history.replaceState({}, "", "/"); });

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
// Clic sur un lien : renvoie true si la navigation native a été empêchée.
async function clickLink(el, init = {}) {
  let prevented = null;
  await act(async () => {
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
    el.dispatchEvent(ev);
    prevented = ev.defaultPrevented;
  });
  return prevented;
}
const noop = () => {};
const account = { id: "u", organizationId: "org", plan: "pro", role: "owner", email: "t@e.fr", firstName: "Thomas", memberships: [{ organizationId: "org", role: "owner", name: "Org" }] };
const homeLinks = (c) => [...c.querySelectorAll(`a[href="${HOME_HREF}"]`)];

describe("HomeLink", () => {
  it("clic gauche simple : navigation interne, navigation native empêchée", async () => {
    const views = [];
    const { container, unmount } = await mount(<HomeLink setView={(v) => views.push(v)} className="x">Chantiflow</HomeLink>);
    const a = container.querySelector("a");
    expect(a.getAttribute("href")).toBe("/?accueil");
    expect(a.getAttribute("title")).toBe("Retour à l'accueil");
    expect(await clickLink(a)).toBe(true);
    expect(views).toEqual(["dashboard"]);
    await unmount();
  });
  it("Ctrl-clic, Cmd-clic, Shift-clic : comportement natif (nouvel onglet), pas de navigation interne", async () => {
    const views = [];
    const { container, unmount } = await mount(<HomeLink setView={(v) => views.push(v)}>Chantiflow</HomeLink>);
    const a = container.querySelector("a");
    expect(await clickLink(a, { ctrlKey: true })).toBe(false);
    expect(await clickLink(a, { metaKey: true })).toBe(false);
    expect(await clickLink(a, { shiftKey: true })).toBe(false);
    expect(views).toEqual([]);
    await unmount();
  });
});

describe("vue de départ", () => {
  it("dernière vue mémorisée par défaut, tableau de bord sinon", () => {
    expect(initialView()).toBe("dashboard");
    localStorage.setItem("devifact_lastView", "clients");
    expect(initialView()).toBe("clients");
  });
  it("« /?accueil » force le tableau de bord et nettoie l'adresse, sans toucher aux autres paramètres", () => {
    localStorage.setItem("devifact_lastView", "clients");
    window.history.replaceState({}, "", "/?accueil");
    expect(initialView()).toBe("dashboard");
    expect(window.location.search).toBe("");
    window.history.replaceState({}, "", "/?accueil&x=1");
    expect(initialView()).toBe("dashboard");
    expect(window.location.search).toBe("?x=1");
  });
});

describe("logo dans les trois versions", () => {
  const navProps = (version) => ({ view: "clients", onNewDevis: noop, onNewFacture: noop, onNewProforma: noop, onNewRevision: noop, onNewService: noop, visibleServices: [], account, onLogout: noop, onSwitchOrganization: noop, onCreateOwnOrg: noop, creatingOwnOrg: false, siteSettings: { name: "Chantiflow", landingPageVersion: version }, companyProfile: {}, onSetCompanyType: noop, commandPaletteOpen: false, setCommandPaletteOpen: noop, paletteCommands: [], darkMode: false, setDarkMode: noop });
  it("Classique : le logo est un lien vers l'accueil", async () => {
    const views = [];
    const { container, unmount } = await mount(<TopNav {...navProps("classique")} setView={(v) => views.push(v)} />);
    const links = homeLinks(container);
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toContain("Chantiflow");
    expect(await clickLink(links[0])).toBe(true);
    expect(views).toEqual(["dashboard"]);
    // « Gestion de stock » juste après Clients dans la barre
    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent.trim());
    expect(labels.findIndex((l) => l.startsWith("Gestion de stock"))).toBe(labels.indexOf("Clients") + 1);
    await unmount();
  });
  it("Avancée : barre latérale et barre mobile, deux liens vers l'accueil", async () => {
    const views = [];
    const { container, unmount } = await mount(<TopNav {...navProps("avancee")} setView={(v) => views.push(v)} />);
    const links = homeLinks(container);
    expect(links).toHaveLength(2);
    for (const a of links) expect(await clickLink(a)).toBe(true);
    expect(views).toEqual(["dashboard", "dashboard"]);
    const sidebarLabels = [...container.querySelector(".df-sidebar-nav").querySelectorAll("button")].map((b) => b.textContent.trim());
    expect(sidebarLabels.indexOf("Gestion de stock")).toBe(sidebarLabels.indexOf("Clients") + 1);
    await unmount();
  });
  it("Atelier : en-têtes ordinateur et téléphone, deux liens vers l'accueil", async () => {
    const views = [];
    const { container, unmount } = await mount(
      <AtelierShell view="clients" setView={(v) => views.push(v)} account={account} siteSettings={{ name: "Chantiflow", landingPageVersion: "atelier" }} darkMode={false} setDarkMode={noop} onLogout={noop} onSwitchOrganization={noop} onCreateOwnOrg={noop} creatingOwnOrg={false} onOpenCreate={noop} commandPaletteOpen={false} setCommandPaletteOpen={noop} paletteCommands={[]}><div>page</div></AtelierShell>
    );
    const links = homeLinks(container);
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("title")).toBe("Accueil");
    for (const a of links) expect(await clickLink(a)).toBe(true);
    expect(views).toEqual(["dashboard", "dashboard"]);
    await unmount();
  });
});
