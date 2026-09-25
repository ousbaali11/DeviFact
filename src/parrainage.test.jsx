// @vitest-environment jsdom
// Priorité 11 : programme de parrainage. Code unique par compte (profil),
// champ à l'inscription pré-rempli par le lien ?parrain=CODE, application
// par la fonction serveur après la création du compte (jamais bloquante),
// bloc Parrainage de Mon compte (code, lien, filleuls sans e-mail).
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const calls = { invoke: [], rpc: [], updates: [] };
const state = { signUp: null, referrals: [] };
vi.mock("./client.js", () => ({
  db: {
    auth: {
      signUp: async () => state.signUp,
      signInWithPassword: async () => ({ data: {}, error: null }),
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
    },
    functions: { invoke: async (name, opts) => { calls.invoke.push({ name, body: opts?.body }); if (name === "apply-referral" && state.referralError) return { data: { error: state.referralError }, error: null }; return { data: { success: true }, error: null }; } },
    rpc: async (name, args) => { calls.rpc.push({ name, args }); if (name === "my_referrals") return { data: state.referrals, error: null }; return { data: null, error: null }; },
    from: () => ({ update: (row) => ({ eq: async () => { calls.updates.push(row); return { data: [], error: null }; } }) }),
  },
}));
import { AuthScreen, ReferralCard, AccountView, referralCodeFromUrl } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });
beforeEach(() => { calls.invoke = []; calls.rpc = []; calls.updates = []; state.referrals = []; state.referralError = null; state.signUp = { data: { user: { id: "u-new", identities: [{ id: "i" }] }, session: { access_token: "t" } }, error: null }; window.history.replaceState({}, "", "/"); });

const noop = () => {};
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
function setValue(input, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });
const byLabel = (c, label) => c.querySelector(`input[aria-label="${label}"]`);

describe("code depuis le lien", () => {
  it("?parrain=7kq2-mht4 → 7KQ2MHT4 ; rien sans paramètre", () => {
    window.history.replaceState({}, "", "/?parrain=7kq2-mht4");
    expect(referralCodeFromUrl()).toBe("7KQ2MHT4");
    window.history.replaceState({}, "", "/");
    expect(referralCodeFromUrl()).toBe("");
  });
});

describe("inscription", () => {
  const props = { onBack: noop, siteSettings: { name: "Chantiflow" }, onLegal: noop, onSignedIn: noop };
  async function signUp(container, code) {
    const inputs = [...container.querySelectorAll("input")];
    const email = inputs.find((i) => i.getAttribute("autocomplete") === "email");
    const password = inputs.find((i) => i.type === "password");
    await act(async () => { setValue(email, "nouveau@exemple.fr"); });
    await act(async () => { setValue(password, "motdepasse-solide-12"); });
    // Pays obligatoire : ouverture du sélecteur, choix de la France.
    await click([...container.querySelectorAll('[data-testid="signup-country"] button')].find((b) => b.textContent.includes("Choisir le pays")));
    await click([...container.querySelectorAll('[data-testid="signup-country"] button')].find((b) => b.textContent.trim() === "🇫🇷 FR"));
    if (code !== undefined) await act(async () => { setValue(byLabel(container, "Code de parrainage"), code); });
    await click([...container.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Créer mon compte")));
    await settle();
  }
  it("champ « Code de parrainage » en mode inscription, pré-rempli et forcé en inscription par le lien ; envoyé au serveur après la création du compte", async () => {
    window.history.replaceState({}, "", "/?parrain=7kq2mht4");
    const { container, unmount } = await mount(<AuthScreen {...props} initialMode="login" />);
    const field = byLabel(container, "Code de parrainage");
    expect(field).toBeTruthy(); // mode inscription forcé par le lien
    expect(field.value).toBe("7KQ2MHT4");
    await signUp(container);
    const names = calls.invoke.map((c) => c.name);
    expect(names).toContain("auto-confirm-user");
    expect(names.indexOf("apply-referral")).toBeGreaterThan(names.indexOf("auto-confirm-user"));
    expect(calls.invoke.find((c) => c.name === "apply-referral").body).toEqual({ userId: "u-new", code: "7KQ2MHT4" });
    expect(calls.rpc.some((c) => c.name === "ensure_user_has_organization")).toBe(true);
    await unmount();
  }, 30000);
  it("sans code : pas d'appel ; code inconnu : compte créé quand même, message affiché", async () => {
    const a = await mount(<AuthScreen {...props} initialMode="signup" />);
    expect(byLabel(a.container, "Code de parrainage").value).toBe("");
    await signUp(a.container);
    expect(calls.invoke.some((c) => c.name === "apply-referral")).toBe(false);
    await a.unmount();
    calls.invoke = [];
    state.referralError = "Code de parrainage inconnu : ton compte est créé sans parrain.";
    const alerts = [];
    window.alert = (m) => alerts.push(m);
    const b = await mount(<AuthScreen {...props} initialMode="signup" />);
    await signUp(b.container, "zz-99");
    expect(calls.invoke.find((c) => c.name === "apply-referral").body.code).toBe("ZZ99");
    expect(alerts).toEqual(["Code de parrainage inconnu : ton compte est créé sans parrain."]);
    expect(calls.invoke.some((c) => c.name === "send-confirmation-email")).toBe(true); // l'inscription continue
    await b.unmount();
  }, 30000);
  it("en mode connexion sans lien : pas de champ", async () => {
    const { container, unmount } = await mount(<AuthScreen {...props} initialMode="login" />);
    expect(byLabel(container, "Code de parrainage")).toBeNull();
    await unmount();
  }, 30000);
});

describe("Mon compte : bloc Parrainage", () => {
  const account = { id: "u1", email: "patron@exemple.fr", firstName: "Paul", lastName: "Martin", companyName: "Bâti Plus", referralCode: "7KQ2MHT4", organizationId: "org", plan: "pro", paymentStatus: "payé", role: "owner", memberships: [] };
  it("code, lien à partager, copie, filleuls (entreprise ou prénom, date) sans e-mail", async () => {
    const written = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { written.push(t); } }, configurable: true });
    state.referrals = [{ label: "Rénov Toiture SARL", created_at: "2026-09-20T10:00:00Z" }, { label: "Inès", created_at: "2026-09-25T08:00:00Z" }];
    const { container, unmount } = await mount(<ReferralCard account={account} />);
    expect(container.querySelector('[data-testid="referral-code"]').textContent).toBe("7KQ2MHT4");
    expect(container.querySelector('[data-testid="referral-link"]').textContent).toBe(`${window.location.origin}/?parrain=7KQ2MHT4`);
    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Copier le lien"));
    expect(written).toEqual([`${window.location.origin}/?parrain=7KQ2MHT4`]);
    expect(container.textContent).toContain("Lien copié");
    const text = container.textContent.replace(/[  ]/g, " ");
    expect(text).toContain("Filleuls (2)");
    expect(text).toContain("Rénov Toiture SARL");
    expect(text).toContain("inscrit le 20 sept. 2026");
    expect(text).toContain("Inès");
    expect(text).not.toContain("@");
    expect(text).toContain("Pas de récompense automatique");
    await unmount();
  }, 30000);
  it("sans code (script SQL pas encore appliqué) : message ; sans filleul : « Aucun filleul » ; présent dans Mon compte", async () => {
    const a = await mount(<ReferralCard account={{ ...account, referralCode: "" }} />);
    expect(a.container.textContent).toContain("pas encore disponible");
    expect(a.container.textContent).toContain("Aucun filleul pour l'instant.");
    await a.unmount();
    const b = await mount(<AccountView account={account} />);
    expect(b.container.querySelector('[data-testid="referral-card"]')).toBeTruthy();
    await b.unmount();
  }, 30000);
});
