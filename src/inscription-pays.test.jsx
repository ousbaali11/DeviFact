// @vitest-environment jsdom
// Pays obligatoire à l'inscription : l'inscription est bloquée tant qu'il
// n'est pas choisi ; une fois le compte créé, le pays est mémorisé pour
// remplir Mon entreprise au premier chargement (sans nouvelle saisie).
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const calls = { signUp: [] };
vi.mock("./client.js", () => ({
  db: {
    auth: {
      signUp: async (args) => { calls.signUp.push(args); return { data: { user: { id: "u-new", identities: [{ id: "i" }] }, session: { access_token: "t" } }, error: null }; },
      signInWithPassword: async () => ({ data: {}, error: null }),
      getSession: async () => ({ data: { session: { access_token: "t", user: { id: "u-new" } } } }),
    },
    functions: { invoke: async () => ({ data: { success: true }, error: null }) },
    rpc: async () => ({ data: null, error: null }),
    from: () => ({ update: () => ({ eq: async () => ({ data: [], error: null }) }) }),
  },
}));
import { AuthScreen, rememberSignupCountry, takeSignupCountry, SIGNUP_COUNTRY_KEY } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });
beforeEach(() => { calls.signUp = []; localStorage.clear(); window.history.replaceState({}, "", "/"); });

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
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });
const props = { onBack: noop, siteSettings: { name: "Chantiflow" }, onLegal: noop, onSignedIn: noop, initialMode: "signup" };
async function fill(container) {
  const inputs = [...container.querySelectorAll("input")];
  await act(async () => { setValue(inputs.find((i) => i.getAttribute("autocomplete") === "email"), "nouveau@exemple.fr"); });
  await act(async () => { setValue(inputs.find((i) => i.type === "password"), "motdepasse-solide-12"); });
}
const submit = (container) => click([...container.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Créer mon compte")));
const countryButtons = (container) => [...container.querySelectorAll('[data-testid="signup-country"] button')];

describe("inscription", () => {
  it("sans pays : message et aucun compte créé", async () => {
    const { container, unmount } = await mount(<AuthScreen {...props} />);
    expect(container.textContent).toContain("Pays de l'entreprise");
    await fill(container);
    await submit(container);
    await settle();
    expect(container.textContent).toContain("Merci d'indiquer le pays de ton entreprise.");
    expect(calls.signUp).toHaveLength(0);
    expect(localStorage.getItem(SIGNUP_COUNTRY_KEY)).toBeNull();
    await unmount();
  }, 30000);
  it("avec le Maroc choisi : compte créé, pays mémorisé pour Mon entreprise", async () => {
    const { container, unmount } = await mount(<AuthScreen {...props} />);
    await fill(container);
    await click(countryButtons(container).find((b) => b.textContent.includes("Choisir le pays")));
    await click(countryButtons(container).find((b) => b.textContent.trim() === "🇲🇦 MA"));
    expect(container.textContent).toContain("🇲🇦 MA");
    await submit(container);
    await settle();
    expect(calls.signUp).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(SIGNUP_COUNTRY_KEY))).toEqual({ userId: "u-new", country: "🇲🇦 MA" });
    await unmount();
  }, 30000);
  it("en mode connexion : pas de champ Pays", async () => {
    const { container, unmount } = await mount(<AuthScreen {...props} initialMode="login" />);
    expect(container.querySelector('[data-testid="signup-country"]')).toBeNull();
    await unmount();
  }, 30000);
});

describe("reprise du pays au premier chargement", () => {
  it("le pays mémorisé n'est rendu qu'au bon compte, une seule fois", () => {
    rememberSignupCountry("u-new", "🇫🇷 FR");
    expect(takeSignupCountry("autre")).toBe("");
    expect(takeSignupCountry("u-new")).toBe("🇫🇷 FR");
    expect(takeSignupCountry("u-new")).toBe(""); // consommé
    rememberSignupCountry("", "🇫🇷 FR");
    expect(localStorage.getItem(SIGNUP_COUNTRY_KEY)).toBeNull();
  });
});
