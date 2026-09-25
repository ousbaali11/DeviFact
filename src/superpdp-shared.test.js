// Super PDP, étape 1 — briques pures du module serveur partagé
// (supabase/functions/_shared/superpdp.ts) : SIREN, PKCE, adresse
// d'autorisation pré-remplie, chiffrement des jetons, état public sans jeton.
import { describe, it, expect } from "vitest";
import { sirenOf, pkcePair, buildAuthorizeUrl, encryptSecret, decryptSecret, publicStatusOf, randomToken } from "../supabase/functions/_shared/superpdp.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("SIREN", () => {
  it("SIRET 14 chiffres → 9 premiers ; SIREN accepté tel quel ; autre longueur refusée", () => {
    expect(sirenOf("853 322 915 00012")).toBe("853322915");
    expect(sirenOf("853322915")).toBe("853322915");
    expect(sirenOf("12345")).toBeNull();
    expect(sirenOf("")).toBeNull();
    expect(sirenOf(null)).toBeNull();
  });
});

describe("PKCE et adresse d'autorisation", () => {
  it("le défi est l'empreinte S256 du vérificateur, en base64url", async () => {
    const { verifier, challenge } = await pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const expected = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    expect(challenge).toBe(expected);
    expect(randomToken(24)).not.toBe(randomToken(24));
  });
  it("adresse pré-remplie : e-mail, SIREN avec son schéma, état, PKCE, redirection", () => {
    const url = new URL(buildAuthorizeUrl("https://api.superpdp.tech/", { clientId: "cid", redirectUri: "https://www.chantiflow.fr/?superpdp=retour", state: "st", codeChallenge: "ch", loginHint: "a@b.fr", siren: "853322915" }));
    expect(url.origin + url.pathname).toBe("https://api.superpdp.tech/oauth2/authorize");
    const q = Object.fromEntries(url.searchParams.entries());
    expect(q).toMatchObject({ response_type: "code", client_id: "cid", redirect_uri: "https://www.chantiflow.fr/?superpdp=retour", state: "st", code_challenge: "ch", code_challenge_method: "S256", login_hint: "a@b.fr", superpdp_company_number: "853322915", superpdp_company_number_scheme: "fr_siren" });
    const sans = new URL(buildAuthorizeUrl("https://api.superpdp.tech", { clientId: "cid", redirectUri: "r", state: "st", codeChallenge: "ch" }));
    expect(sans.searchParams.has("login_hint")).toBe(false);
    expect(sans.searchParams.has("superpdp_company_number")).toBe(false);
  });
});

describe("chiffrement des jetons", () => {
  it("aller-retour ; deux chiffrements du même jeton diffèrent (vecteur aléatoire)", async () => {
    const a = await encryptSecret("refresh-abc", KEY);
    const b = await encryptSecret("refresh-abc", KEY);
    expect(a).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
    expect(await decryptSecret(a, KEY)).toBe("refresh-abc");
    expect(await decryptSecret(b, KEY)).toBe("refresh-abc");
  });
  it("mauvaise clé, texte altéré ou clé de mauvaise taille : refus, jamais un jeton en clair", async () => {
    const c = await encryptSecret("secret", KEY);
    await expect(decryptSecret(c, Buffer.alloc(32, 9).toString("base64"))).rejects.toThrow();
    const [v, iv, ct] = c.split(":");
    const altered = Buffer.from(ct, "base64"); altered[0] ^= 0xff;
    await expect(decryptSecret(`${v}:${iv}:${altered.toString("base64")}`, KEY)).rejects.toThrow();
    await expect(decryptSecret("n'importe quoi", KEY)).rejects.toThrow("illisible");
    await expect(encryptSecret("x", Buffer.alloc(16, 1).toString("base64"))).rejects.toThrow("32 octets");
  });
});

describe("état public", () => {
  it("jamais de jeton dans ce que reçoit le navigateur", () => {
    const st = publicStatusOf({ env: "sandbox", company_name: "Burger Queen", company_number: "315143296_001", company_number_scheme: "sandbox", vat_regime: "monthly", verification_status: "verified", connected_at: "2026-09-26T10:00:00Z", access_token_enc: "v1:x:y", refresh_token_enc: "v1:x:z" });
    expect(st).toEqual({ connected: true, env: "sandbox", companyName: "Burger Queen", companyNumber: "315143296_001", companyNumberScheme: "sandbox", vatRegime: "monthly", verificationStatus: "verified", connectedAt: "2026-09-26T10:00:00Z", lastError: null });
    expect(JSON.stringify(st)).not.toMatch(/token/i);
    expect(publicStatusOf(null)).toEqual({ connected: false });
  });
});
