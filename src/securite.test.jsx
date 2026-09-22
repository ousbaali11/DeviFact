// @vitest-environment jsdom
// Audit sécurité : bandeau d'erreur d'enregistrement, contrôle des pièces
// jointes, longueur minimale du mot de passe.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { SaveErrorBanner, productFileProblem, PASSWORD_MIN_LENGTH } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });

describe("bandeau d'erreur d'enregistrement", () => {
  it("rien sans erreur ; message, Réessayer et Fermer sinon", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<SaveErrorBanner error={null} />); });
    expect(container.textContent).toBe("");
    let retried = 0, dismissed = 0;
    await act(async () => { root.render(<SaveErrorBanner error={{ message: "Impossible d'enregistrer les documents.", retry: () => { retried += 1; }, dismiss: () => { dismissed += 1; } }} />); });
    expect(container.querySelector('[role="alert"]').textContent).toContain("Impossible d'enregistrer les documents.");
    const buttons = [...container.querySelectorAll("button")];
    await act(async () => { buttons.find((b) => b.textContent === "Réessayer").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { buttons.find((b) => b.textContent === "Fermer").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect([retried, dismissed]).toEqual([1, 1]);
    await act(async () => { root.unmount(); });
    container.remove();
  });
});

describe("pièces jointes de produit", () => {
  it("type et taille contrôlés avant l'envoi", () => {
    expect(productFileProblem({ name: "fiche.pdf", size: 1000 })).toBe("");
    expect(productFileProblem({ name: "photo.JPG", size: 1000 })).toBe("");
    expect(productFileProblem({ name: "script.exe", size: 10 })).toContain("n'est pas accepté");
    expect(productFileProblem({ name: "gros.pdf", size: 10 * 1024 * 1024 + 1 })).toContain("10 Mo");
    expect(productFileProblem(null)).toBe("Aucun fichier.");
  });
});

describe("mot de passe", () => {
  it("au moins 10 caractères à l'inscription", () => {
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(10);
  });
});
