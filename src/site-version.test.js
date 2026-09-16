// @vitest-environment jsdom
// Cache local des paramètres du site : lecture tolérante, écriture, correspondance des colonnes.
import { describe, it, expect, beforeEach } from "vitest";
import { readCachedSiteSettings, writeCachedSiteSettings, siteSettingsFromRow, SITE_SETTINGS_CACHE_KEY } from "./App.jsx";

beforeEach(() => localStorage.clear());

describe("cache des paramètres du site", () => {
  it("absent, corrompu ou d'un autre type : null, sans erreur", () => {
    expect(readCachedSiteSettings()).toBeNull();
    localStorage.setItem(SITE_SETTINGS_CACHE_KEY, "{pas du json");
    expect(readCachedSiteSettings()).toBeNull();
    localStorage.setItem(SITE_SETTINGS_CACHE_KEY, "[1,2]");
    expect(readCachedSiteSettings()).toBeNull();
  });
  it("écriture puis relecture", () => {
    writeCachedSiteSettings({ landingPageVersion: "avancee", theme: "nuit" });
    expect(readCachedSiteSettings()).toEqual({ landingPageVersion: "avancee", theme: "nuit" });
  });
  it("colonnes de la table → paramètres, avec les valeurs par défaut", () => {
    const s = siteSettingsFromRow({ id: 1, landing_page_version: "atelier", legal_info: { rcs: "x" } });
    expect(s).toMatchObject({ landingPageVersion: "atelier", theme: "classique", name: "Chantiflow", legalInfo: { rcs: "x" } });
    expect(siteSettingsFromRow({ id: 1 }).landingPageVersion).toBe("classique");
  });
});
