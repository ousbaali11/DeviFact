// @vitest-environment jsdom
// Test de rendu : chaque éditeur de document doit s'afficher sans erreur
// (avec et sans produits), comme quand un utilisateur ouvre un document.
// Ce test aurait détecté « ReferenceError: prestations is not defined ».
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  Editor, RevisionEditor, SituationEditor, PvReceptionEditor, RapportInterventionEditor, ContratChantierEditor, RelanceFormelleEditor, PlanningChantierEditor,
  newDocument, newRevisionDocument, newSituationDocument, newPvReceptionDocument, newRapportInterventionDocument, newContratChantierDocument, newRelanceFormelleDocument, newPlanningChantierDocument,
  emptyCompanyProfile, emptyProduct, PLANS, REVISION_SECTORS,
} from "./App.jsx";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom ne fournit pas de canvas : l'éditeur n'y touche qu'au dessin d'une signature.
  if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
  window.scrollTo = () => {};
});

const account = { id: "user_test", organizationId: "org_test", plan: "pro", paymentStatus: "payé", role: "owner", email: "test@exemple.fr", firstName: "Test", memberships: [] };
const siteSettings = { name: "Chantiflow", landingPageVersion: "classique", theme: "classique" };
const noop = () => {};
const common = { saving: false, account, plans: PLANS, siteSettings, isLocked: false, isViewer: false, onChange: noop, onFinalize: noop, onBack: noop, onGoToPricing: noop };

// Rend un élément dans un conteneur jsdom ; toute erreur de rendu remonte.
async function renderOnce(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  const html = container.innerHTML;
  await act(async () => { root.unmount(); });
  container.remove();
  return html;
}

const products = [
  { ...emptyProduct("org_test"), id: "p1", name: "Carrelage 60x60", reference: "CAR-60", sale_price_ht: 25, sale_vat_rate: 20, sale_price_ttc: 30, is_active: true, quantity_restricted: false },
  { ...emptyProduct("org_test"), id: "p2", name: "Inactif", is_active: false },
];

describe("éditeur générique (devis, facture, proforma, acompte, avoir, commande, livraison, bpu)", () => {
  const types = ["devis", "facture", "proforma", "acompte", "avoir", "commande", "livraison", "bpu"];
  for (const type of types) {
    it(`s'affiche pour un(e) ${type}, sans produit`, async () => {
      const html = await renderOnce(
        <Editor {...common} doc={newDocument(type, [])} clients={[]} products={[]} stockByProduct={{}} companyProfile={emptyCompanyProfile()} onConvert={noop} onSaveClient={noop} onSaveProduct={noop} onSplit={noop} splitNotice={null} onOpenSplitDoc={noop} onDismissSplitNotice={noop} />,
      );
      expect(html).toContain("Tableau de bord");
      expect(html).not.toContain("Depuis la bibliothèque"); // aucun produit : bouton masqué, comme avant
    });
    it(`s'affiche pour un(e) ${type}, avec des produits`, async () => {
      const html = await renderOnce(
        <Editor {...common} doc={newDocument(type, [])} clients={[]} products={products} stockByProduct={{ p1: 4 }} companyProfile={emptyCompanyProfile()} onConvert={noop} onSaveClient={noop} onSaveProduct={noop} onSplit={noop} splitNotice={null} onOpenSplitDoc={noop} onDismissSplitNotice={noop} />,
      );
      expect(html).toContain("Depuis la bibliothèque");
    });
  }
});

describe("avertissement prix saisi < prix de référence (étape 5)", () => {
  const withLine = (unitPrice) => ({ ...newDocument("devis", []), items: [{ id: "l1", type: "line", productId: "p1", designation: "Carrelage", qty: 1, unit: "m²", unitPrice, tva: 20, discount: 0, details: [] }] });
  const render = (doc) => renderOnce(
    <Editor {...common} doc={doc} clients={[]} products={products} stockByProduct={{ p1: 4 }} companyProfile={emptyCompanyProfile()} onConvert={noop} onSaveClient={noop} onSaveProduct={noop} onSplit={noop} splitNotice={null} onOpenSplitDoc={noop} onDismissSplitNotice={noop} />,
  );
  it("S < P : message non bloquant avec les deux montants", async () => {
    const html = await render(withLine(20));
    expect(html).toContain('data-testid="price-warning"');
    expect(html).toContain("Prix saisi 20,00");
    expect(html).toContain("prix de référence 25,00");
  });
  it("S = P et S > P : aucun message", async () => {
    expect(await render(withLine(25))).not.toContain('data-testid="price-warning"');
    expect(await render(withLine(30))).not.toContain('data-testid="price-warning"');
  });
});

describe("éditeurs spécialisés", () => {
  it("révision de prix", async () => {
    const html = await renderOnce(<RevisionEditor {...common} doc={newRevisionDocument(REVISION_SECTORS[0], "🇫🇷 FR", [])} clients={[]} onSaveClient={noop} />);
    expect(html.length).toBeGreaterThan(1000);
  });
  it("situation de travaux", async () => {
    const html = await renderOnce(<SituationEditor {...common} doc={newSituationDocument([])} documents={[]} onCreateNext={noop} />);
    expect(html.length).toBeGreaterThan(1000);
  });
  it("PV de réception", async () => {
    expect((await renderOnce(<PvReceptionEditor {...common} doc={newPvReceptionDocument([])} />)).length).toBeGreaterThan(1000);
  });
  it("rapport d'intervention", async () => {
    expect((await renderOnce(<RapportInterventionEditor {...common} doc={newRapportInterventionDocument([])} />)).length).toBeGreaterThan(1000);
  });
  it("contrat de chantier", async () => {
    expect((await renderOnce(<ContratChantierEditor {...common} doc={newContratChantierDocument([])} />)).length).toBeGreaterThan(1000);
  });
  it("relance formelle", async () => {
    expect((await renderOnce(<RelanceFormelleEditor {...common} doc={newRelanceFormelleDocument([])} />)).length).toBeGreaterThan(1000);
  });
  it("planning de chantier", async () => {
    expect((await renderOnce(<PlanningChantierEditor {...common} doc={newPlanningChantierDocument([])} />)).length).toBeGreaterThan(1000);
  });
});
