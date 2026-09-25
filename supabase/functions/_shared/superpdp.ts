// _shared/superpdp.ts
//
// Super PDP (Plateforme Agréée) — briques communes aux fonctions serveur :
//   * flux OAuth 2.1 Authorization Code avec PKCE (chaque artisan connecte
//     SON compte Super PDP, avec son SIREN) ;
//   * chiffrement des jetons en base (AES-256-GCM, clé SUPERPDP_TOKEN_KEY :
//     32 octets en base64, connue des seules fonctions serveur) ;
//   * jeton d'accès valide à la demande (rafraîchissement avec rotation,
//     écriture conditionnelle pour qu'un renouvellement simultané ne perde
//     pas le jeton) ;
//   * appel de l'API authentifié pour une organisation.
//
// Les fonctions pures (sirenOf, pkcePair, buildAuthorizeUrl, encryptSecret,
// decryptSecret, publicStatusOf) n'utilisent pas Deno : elles sont testées
// côté site (src/superpdp-shared.test.js).
//
// Garde-fou production : tant que la variable SUPERPDP_ALLOW_PRODUCTION ne
// vaut pas "true", une connexion à une entreprise dont Super PDP indique
// env = production est refusée (bac à sable seulement).

const env = (k: string): string => {
  const d = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno;
  return d?.env?.get(k) ?? "";
};
export const superpdpApiBase = (): string => (env("SUPERPDP_API_BASE") || "https://api.superpdp.tech").replace(/\/+$/, "");
export const superpdpClientId = (): string => env("SUPERPDP_CLIENT_ID");
export const superpdpClientSecret = (): string => env("SUPERPDP_CLIENT_SECRET");
export const superpdpAllowProduction = (): boolean => env("SUPERPDP_ALLOW_PRODUCTION") === "true";
export const superpdpTokenKey = (): string => env("SUPERPDP_TOKEN_KEY");
export const superpdpConfigured = (): boolean => !!superpdpClientId() && !!superpdpClientSecret() && !!superpdpTokenKey();

// ------------------------------------------------------------ utilitaires
const te = new TextEncoder();
const td = new TextDecoder();
export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function randomToken(bytes = 24): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}
// SIREN (9 chiffres) depuis un SIRET (14 chiffres) ou un SIREN, espaces tolérés.
export function sirenOf(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 9 || digits.length === 14) return digits.slice(0, 9);
  return null;
}
// PKCE : vérificateur aléatoire et son empreinte S256.
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(32);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(verifier)));
  return { verifier, challenge: b64url(digest) };
}
export function buildAuthorizeUrl(base: string, p: { clientId: string; redirectUri: string; state: string; codeChallenge: string; loginHint?: string; siren?: string | null }): string {
  const u = new URL(`${base.replace(/\/+$/, "")}/oauth2/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("state", p.state);
  u.searchParams.set("code_challenge", p.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (p.loginHint) u.searchParams.set("login_hint", p.loginHint);
  if (p.siren) { u.searchParams.set("superpdp_company_number", p.siren); u.searchParams.set("superpdp_company_number_scheme", "fr_siren"); }
  return u.toString();
}

// ------------------------------------------------------------ chiffrement
async function aesKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromB64(keyB64);
  if (raw.length !== 32) throw new Error("SUPERPDP_TOKEN_KEY : 32 octets attendus (base64).");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
// Format : « v1:<iv base64>:<chiffré base64> ».
export async function encryptSecret(plain: string, keyB64: string): Promise<string> {
  const key = await aesKey(keyB64);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(plain)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}
export async function decryptSecret(cipher: string, keyB64: string): Promise<string> {
  const [v, ivB64, ctB64] = String(cipher || "").split(":");
  if (v !== "v1" || !ivB64 || !ctB64) throw new Error("Jeton chiffré illisible.");
  const key = await aesKey(keyB64);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(ivB64) }, key, fromB64(ctB64));
  return td.decode(plain);
}

// ------------------------------------------------------------ OAuth / API
export type TokenSet = { access_token: string; refresh_token: string; expires_in?: number; token_type?: string };
async function tokenRequest(params: Record<string, string>): Promise<TokenSet> {
  const resp = await fetch(`${superpdpApiBase()}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: superpdpClientId(), client_secret: superpdpClientSecret(), ...params }).toString(),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || !body?.access_token) {
    const detail = body?.error_description || body?.error || body?.message || `http ${resp.status}`;
    throw new Error(`Super PDP a refusé l'authentification : ${detail}`);
  }
  return body as TokenSet;
}
export function exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier });
}
export function refreshTokenSet(refreshToken: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`${superpdpApiBase()}/oauth2/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: superpdpClientId(), client_secret: superpdpClientSecret(), token }).toString(),
    });
  } catch (err) { console.error("Révocation Super PDP non confirmée", err); }
}

export type PdpConnection = {
  organization_id: string; provider: string; env: "sandbox" | "production";
  company_number: string | null; company_number_scheme: string | null; company_name: string | null;
  vat_regime: string | null; has_vat_on_debits: boolean | null; verification_status: string | null;
  access_token_enc: string; access_expires_at: string | null; refresh_token_enc: string;
  connected_at: string; last_event_id: number; last_error: string | null; updated_at: string;
};
// Ce que le navigateur reçoit : jamais un jeton.
export function publicStatusOf(c: Partial<PdpConnection> | null | undefined) {
  if (!c) return { connected: false };
  return {
    connected: true,
    env: c.env || "sandbox",
    companyName: c.company_name || "",
    companyNumber: c.company_number || "",
    companyNumberScheme: c.company_number_scheme || "",
    vatRegime: c.vat_regime || "",
    verificationStatus: c.verification_status || "",
    connectedAt: c.connected_at || null,
    lastError: c.last_error || null,
  };
}
export async function readConnection(dbAdmin: any, organizationId: string): Promise<PdpConnection | null> {
  const { data, error } = await dbAdmin.from("pdp_connections").select("*").eq("organization_id", organizationId).maybeSingle();
  if (error) throw new Error(`Connexion Super PDP illisible : ${error.message}`);
  return (data as PdpConnection) || null;
}
// Jeton d'accès valide pour l'organisation : rafraîchi (avec rotation du
// jeton de rafraîchissement) s'il expire dans moins d'une minute.
export async function accessTokenFor(dbAdmin: any, organizationId: string): Promise<{ token: string; connection: PdpConnection }> {
  const conn = await readConnection(dbAdmin, organizationId);
  if (!conn) throw new Error("Aucun compte Super PDP connecté pour cette organisation.");
  const key = superpdpTokenKey();
  const expiresAt = conn.access_expires_at ? new Date(conn.access_expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) return { token: await decryptSecret(conn.access_token_enc, key), connection: conn };
  const fresh = await refreshTokenSet(await decryptSecret(conn.refresh_token_enc, key));
  const patch = {
    access_token_enc: await encryptSecret(fresh.access_token, key),
    refresh_token_enc: await encryptSecret(fresh.refresh_token || (await decryptSecret(conn.refresh_token_enc, key)), key),
    access_expires_at: new Date(Date.now() + Math.max(60, Number(fresh.expires_in) || 1800) * 1000).toISOString(),
    last_error: null,
  };
  // Écriture conditionnelle : si un autre appel vient de rafraîchir, on garde
  // sa version (le jeton de rafraîchissement tourne à chaque usage).
  const { data: updated } = await dbAdmin.from("pdp_connections").update(patch).eq("organization_id", organizationId).eq("updated_at", conn.updated_at).select("updated_at");
  if (!Array.isArray(updated) || updated.length === 0) {
    const again = await readConnection(dbAdmin, organizationId);
    if (again) return { token: await decryptSecret(again.access_token_enc, key), connection: again };
  }
  return { token: fresh.access_token, connection: { ...conn, ...patch } };
}
// Appel authentifié de l'API pour une organisation ; renvoie la réponse brute.
export async function superpdpFetch(dbAdmin: any, organizationId: string, path: string, init: RequestInit = {}): Promise<Response> {
  const { token } = await accessTokenFor(dbAdmin, organizationId);
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  return fetch(`${superpdpApiBase()}${path.startsWith("/") ? "" : "/"}${path}`, { ...init, headers });
}
// Message d'erreur lisible depuis une réponse de l'API.
export async function apiErrorMessage(resp: Response): Promise<string> {
  const body = await resp.json().catch(() => null);
  const detail = body?.error?.message || body?.message || body?.error || body?.detail || "";
  return `Super PDP a répondu ${resp.status}${detail ? ` : ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 300)}` : ""}`;
}
