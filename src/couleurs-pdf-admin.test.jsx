// @vitest-environment jsdom
// Admin, couleurs des PDF (30/09/2026) : les quatre champs acceptent une
// saisie libre (hexadécimal ou RVB) en plus de la pastille native, affichent
// le RVB, refusent une valeur invalide, et « Enregistrer » transmet la valeur
// normalisée. Avant, seule la pastille permettait de changer la couleur et le
// code affiché n'était pas éditable.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { parseColorInput, SiteIdentitySettings } from "./App.jsx";

describe("parseColorInput", () => {
  it("hexadécimal (6 ou 3 chiffres, avec ou sans #, toute casse) et RVB (« r, g, b », « rgb(r, g, b) ») → #rrggbb minuscule ; sinon null", () => {
    expect(parseColorInput("#1B2A33")).toBe("#1b2a33");
    expect(parseColorInput("1b2a33")).toBe("#1b2a33");
    expect(parseColorInput(" #FbF7Ef ")).toBe("#fbf7ef");
    expect(parseColorInput("#abc")).toBe("#aabbcc");
    expect(parseColorInput("27, 42, 51")).toBe("#1b2a33");
    expect(parseColorInput("27 42 51")).toBe("#1b2a33");
    expect(parseColorInput("rgb(251, 247, 239)")).toBe("#fbf7ef");
    expect(parseColorInput("RGB(0,0,0)")).toBe("#000000");
    for (const bad of ["", "#12345", "rouge", "256, 0, 0", "27, 42", "#ggg", null, undefined]) expect(parseColorInput(bad)).toBeNull();
  });
});

describe("formulaire des couleurs des PDF", () => {
  beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });
  const settings = { name: "Chantiflow", logo: null, logoWidth: 36, logoHeight: 36, pdfBackground: "#ffffff", pdfHeaderColor: "#bababa", pdfTextColor: "#000000", pdfBlockColor: "#F1F0EA" };
  const setValue = (input, value) => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); };
  async function mount(onSave) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<SiteIdentitySettings siteSettings={settings} saving={false} onSave={onSave} />); });
    return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
  }
  const field = (c, key) => c.querySelector(`[data-testid="color-${key}"]`);
  // Trois temps distincts, comme une vraie saisie (focus, frappe, sortie du champ).
  async function typeAndBlur(input, value) {
    await act(async () => { input.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    await act(async () => { setValue(input, value); });
    await act(async () => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  }

  it("saisie en RVB puis en hexadécimal : valeurs normalisées, RVB affiché, enregistrées au clic sur Enregistrer", async () => {
    const saved = [];
    const { container, unmount } = await mount((p) => saved.push(p));
    expect(field(container, "pdfHeaderColor").value).toBe("#bababa");
    expect(container.textContent).toContain("186, 186, 186");
    await typeAndBlur(field(container, "pdfHeaderColor"), "27, 42, 51");
    await typeAndBlur(field(container, "pdfBackground"), "#FBF7EF");
    await typeAndBlur(field(container, "pdfTextColor"), "rgb(27, 42, 51)");
    expect(field(container, "pdfHeaderColor").value).toBe("#1b2a33");
    expect(field(container, "pdfBackground").value).toBe("#fbf7ef");
    expect(container.textContent).toContain("27, 42, 51");
    expect(container.textContent).toContain("251, 247, 239");
    const save = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Enregistrer");
    await act(async () => { save.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ pdfHeaderColor: "#1b2a33", pdfBackground: "#fbf7ef", pdfTextColor: "#1b2a33", pdfBlockColor: "#F1F0EA" });
    await unmount();
  });
  it("valeur invalide : signalée pendant la saisie, ignorée à la sortie du champ (valeur précédente conservée)", async () => {
    const saved = [];
    const { container, unmount } = await mount((p) => saved.push(p));
    const input = field(container, "pdfBlockColor");
    await act(async () => { input.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); setValue(input, "beige"); });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    await act(async () => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(input.value).toBe("#f1f0ea");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    const save = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Enregistrer");
    await act(async () => { save.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(saved[0].pdfBlockColor).toBe("#F1F0EA");
    await unmount();
  });
});
