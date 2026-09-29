// @vitest-environment jsdom
// Admin → Utilisateurs, suppression d'un compte (01/10/2026) : bouton
// « Supprimer » sur les comptes non administrateurs autres que soi ; boîte de
// dialogue avec aperçu (organisations dont le compte est le seul membre,
// autres organisations non touchées), case « supprimer aussi les données »
// cochée par défaut, confirmation en tapant l'adresse e-mail, résultat.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AdminDeleteUserDialog, AdminView, PLANS, emptyCompanyProfile } from "./App.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.scrollTo = () => {}; });
const setValue = (input, value) => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); };
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}
const user = { id: "11111111-2222-4333-8444-555555555555", email: "artisan@exemple.fr" };
const preview = { email: user.email, isAdmin: false, soleOrganizations: [{ id: "o1", name: "Bâti Plus", role: "owner", documents: 12, clients: 4 }], otherOrganizations: [{ id: "o2", name: "Rénov & Co", role: "editor" }] };

describe("boîte de dialogue de suppression", () => {
  it("aperçu affiché, bouton inactif tant que l'e-mail n'est pas tapé, suppression avec les données par défaut, résultat", async () => {
    const onPreview = vi.fn(async () => preview);
    const onConfirm = vi.fn(async (id, deleteData) => ({ ok: true, email: user.email, organizationsDeleted: deleteData ? preview.soleOrganizations : [], organizationsKept: deleteData ? [] : preview.soleOrganizations, membershipsRemoved: preview.otherOrganizations }));
    const { container, unmount } = await mount(<AdminDeleteUserDialog user={user} onPreview={onPreview} onConfirm={onConfirm} onClose={() => {}} />);
    expect(onPreview).toHaveBeenCalledWith(user.id);
    const text = container.querySelector('[data-testid="admin-delete-preview"]').textContent;
    expect(text).toContain("Seul membre de 1 organisation");
    expect(text).toContain("Bâti Plus — 12 documents, 4 clients");
    expect(text).toContain("Aussi membre de 1 autre organisation, non touchée : Rénov & Co");
    expect(container.querySelector('[data-testid="admin-delete-data"]').checked).toBe(true);
    const confirm = container.querySelector('[data-testid="admin-delete-confirm"]');
    expect(confirm.disabled).toBe(true);
    await click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    await act(async () => { setValue(container.querySelector('[data-testid="admin-delete-confirm-input"]'), "ARTISAN@exemple.fr"); });
    expect(container.querySelector('[data-testid="admin-delete-confirm"]').disabled).toBe(false);
    await click(container.querySelector('[data-testid="admin-delete-confirm"]'));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(onConfirm).toHaveBeenCalledWith(user.id, true);
    const done = container.querySelector('[data-testid="admin-delete-done"]').textContent;
    expect(done).toContain("Compte artisan@exemple.fr supprimé");
    expect(done).toContain("Organisations supprimées avec leurs données : Bâti Plus");
    expect(done).toContain("Retiré de : Rénov & Co");
    await unmount();
  });
  it("case décochée : suppression sans les données ; erreur de la fonction affichée, boîte toujours ouverte", async () => {
    const onConfirm = vi.fn(async () => { throw new Error("Compte non supprimé côté authentification : test"); });
    const { container, unmount } = await mount(<AdminDeleteUserDialog user={user} onPreview={async () => preview} onConfirm={onConfirm} onClose={() => {}} />);
    await click(container.querySelector('[data-testid="admin-delete-data"]'));
    expect(container.querySelector('[data-testid="admin-delete-data"]').checked).toBe(false);
    await act(async () => { setValue(container.querySelector('[data-testid="admin-delete-confirm-input"]'), user.email); });
    await click(container.querySelector('[data-testid="admin-delete-confirm"]'));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(onConfirm).toHaveBeenCalledWith(user.id, false);
    expect(container.querySelector('[data-testid="admin-delete-error"]').textContent).toContain("Compte non supprimé côté authentification");
    expect(container.querySelector('[data-testid="admin-delete-done"]')).toBeNull();
    await unmount();
  });
  it("aperçu indisponible (script non appliqué) : message, aucune suppression possible", async () => {
    const { container, unmount } = await mount(<AdminDeleteUserDialog user={user} onPreview={async () => { throw new Error("function delete_account_preview does not exist"); }} onConfirm={vi.fn()} onClose={() => {}} />);
    expect(container.querySelector('[data-testid="admin-delete-error"]').textContent).toContain("delete_account_preview");
    await act(async () => { setValue(container.querySelector('[data-testid="admin-delete-confirm-input"]'), user.email); });
    expect(container.querySelector('[data-testid="admin-delete-confirm"]').disabled).toBe(true);
    await unmount();
  });
});

describe("onglet Utilisateurs", () => {
  it("bouton « Supprimer » seulement sur les comptes non administrateurs autres que soi ; il ouvre la boîte de dialogue", async () => {
    localStorage.setItem("devifact_lastAdminTab", "utilisateurs");
    const me = { id: "u-admin", email: "admin@exemple.fr", is_admin: true, created_at: "2026-01-01", confirmed_at: "2026-01-01", organizationId: "o0", plan: "pro", paymentStatus: "payé" };
    const otherAdmin = { id: "u-admin-2", email: "admin2@exemple.fr", is_admin: true, created_at: "2026-01-01", confirmed_at: "2026-01-01", organizationId: "o9", plan: "pro", paymentStatus: "payé" };
    const artisan = { id: user.id, email: user.email, is_admin: false, created_at: "2026-01-01", confirmed_at: "2026-01-01", organizationId: "o1", plan: "gratuit", paymentStatus: "gratuit" };
    const noop = () => {};
    const account = { id: "u-admin", organizationId: "o0", plan: "pro", paymentStatus: "payé", role: "owner", email: me.email, isAdmin: true, memberships: [] };
    const props = { account, documents: [], clients: [], companyProfile: emptyCompanyProfile(), plans: PLANS, savingPlanSettings: false, onTogglePlan: noop, onToggleWatermark: noop, onUpdatePlanPrice: noop, onUpdatePlanLimit: noop, onUpdatePlanPaypalId: noop, onUpdatePlanStripeId: noop, onToggleCardPayment: noop, onTogglePaypalPayment: noop, onTogglePayment: noop, onDeleteAccount: noop, deletingAccount: false, siteSettings: { name: "Chantiflow" }, savingSiteSettings: false, onUpdateSiteSettings: noop, allUsers: [me, otherAdmin, artisan], allUsersError: "", onResendConfirmation: noop, resendingConfirmationId: null, onRefreshUsers: noop, onSetUserPlan: noop, onSetUserPaidAt: noop, onSetUserExpiresAt: noop, savingUserPlanId: null, onPreviewDeleteUser: async () => preview, onDeleteUser: vi.fn() };
    const { container, unmount } = await mount(<AdminView {...props} />);
    expect(container.querySelector('[data-testid="admin-delete-u-admin"]')).toBeNull();
    expect(container.querySelector('[data-testid="admin-delete-u-admin-2"]')).toBeNull();
    const button = container.querySelector(`[data-testid="admin-delete-${user.id}"]`);
    expect(button).toBeTruthy();
    await click(button);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const dialog = container.querySelector('[data-testid="admin-delete-dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("Supprimer le compte artisan@exemple.fr");
    expect(dialog.textContent).toContain("Bâti Plus — 12 documents, 4 clients");
    await unmount();
  }, 30000);
});
