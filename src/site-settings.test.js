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
    writeCachedSiteSettings({ name: "Chantiflow", contactEmail: "x@y.fr" });
    expect(readCachedSiteSettings()).toEqual({ name: "Chantiflow", contactEmail: "x@y.fr" });
  });
  it("colonnes de la table → paramètres, avec les valeurs par défaut", () => {
    const s = siteSettingsFromRow({ id: 1, theme: "moderne", legal_info: { rcs: "x" } });
    expect(s).toMatchObject({ name: "Chantiflow", legalInfo: { rcs: "x" } });
    expect(s.landingPageVersion).toBeUndefined(); // une seule interface : le réglage n'existe plus
    expect(s.theme).toBeUndefined(); // sélecteur de thème retiré : la colonne, si elle existe encore, est ignorée
    // Commission Stripe Connect : nombre, 0 si absente ou invalide
    expect(siteSettingsFromRow({ id: 1, connect_fee_percent: "2.50" }).connectFeePercent).toBe(2.5);
    expect(siteSettingsFromRow({ id: 1 }).connectFeePercent).toBe(0);
  });
});
