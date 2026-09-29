// @vitest-environment jsdom
// Point 3, proposition A (30/09/2026) : sur les pièces qui ont le bloc de
// paiement (facture, facture d'acompte), ce bloc occupe la colonne de gauche
// de la rangée des totaux et le QR code de paiement vient sous le tableau des
// totaux, à 2 cm sur fond blanc avec marge de silence ; la rangée du bas ne
// garde que la signature. Devis (signature en ligne), avoir
// et proforma (consultation) gardent leur QR code en bas à gauche, à 2 cm.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintDocument, newDocument, computeTotals } from "./App.jsx";

const qr = { url: "https://www.chantiflow.fr/?voir-document=tok", dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
const line = { id: "l1", type: "line", designation: "Pose", details: [], qty: 1, unitPrice: 100, tva: 20, discount: 0 };
const html = (doc, extra = {}) => renderToStaticMarkup(<PrintDocument doc={doc} totals={computeTotals(doc)} siteSettings={{ name: "Chantiflow" }} watermarkEnabled={false} publicQr={qr} {...extra} />);
const piece = (type, extra = {}) => ({ ...newDocument(type, []), docNumber: `${type.toUpperCase()}-1`, items: [line], client: { ...newDocument(type, []).client, name: "Client SAS" }, ...extra });
const qrBlocks = (markup) => [...markup.matchAll(/<img src="data:image\/png;base64,iVBORw0KGgo=" alt="QR code" style="([^"]*)"/g)].map((m) => m[1]);

describe("QR code de paiement dans la rangée des totaux", () => {
  it("facture et facture d'acompte : un seul QR code à 2 cm sous le tableau des totaux ; bloc de paiement avant les totaux (colonne de gauche)", () => {
    for (const type of ["facture", "acompte"]) {
      const markup = html(piece(type));
      const blocks = qrBlocks(markup);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toContain("width:2cm");
      expect(blocks[0]).toContain("padding:2mm"); // marge de silence sur fond blanc
      expect(markup).toContain('class="print-qr-totals"');
      const qrAt = markup.indexOf("print-qr-totals");
      expect(qrAt).toBeGreaterThan(markup.indexOf("Total TTC"));
      expect(markup.indexOf("À payer :")).toBeLessThan(markup.indexOf("Total TTC")); // bloc de paiement dans la colonne de gauche, avant les totaux
      expect(markup.indexOf("À payer :")).toBeLessThan(qrAt);
      expect((markup.match(/Scannez pour voir les informations de paiement/g) || []).length).toBe(1);
    }
  });
  it("avec une note : la note reste au-dessus du bloc de paiement dans la colonne de gauche", () => {
    const markup = html(piece("facture", { notes: "Merci de votre confiance" }));
    expect(markup.indexOf("Merci de votre confiance")).toBeLessThan(markup.indexOf("À payer :"));
    expect(qrBlocks(markup)).toHaveLength(1);
  });
  it("facture payée : le tampon PAYÉ est dans le bloc de paiement, le QR code sous les totaux", () => {
    const markup = html(piece("facture", { status: "payée", paidAt: "2026-09-30" }));
    expect(qrBlocks(markup)).toHaveLength(1);
    expect(markup).toContain("print-paid-stamp");
    expect(markup.indexOf("print-paid-stamp")).toBeLessThan(markup.indexOf("print-qr-totals"));
    expect(markup.indexOf("À payer :")).toBeLessThan(markup.indexOf("print-paid-stamp"));
  });
  it("devis, avoir, proforma : QR code inchangé, en bas à gauche à 2 cm, après les totaux", () => {
    for (const [type, legend] of [["devis", "Scannez pour signer en ligne"], ["avoir", "Scannez pour consulter en ligne"], ["proforma", "Scannez pour consulter en ligne"]]) {
      const markup = html(piece(type));
      const blocks = qrBlocks(markup);
      expect(blocks, type).toHaveLength(1);
      expect(blocks[0]).toContain("width:2cm");
      expect(markup).not.toContain("print-qr-totals");
      expect(markup).toContain(legend);
      expect(markup.lastIndexOf('alt="QR code"')).toBeGreaterThan(markup.indexOf("Total TTC"));
    }
  });
  it("sans lien public : aucun QR code nulle part ; signature seule en bas", () => {
    const markup = html(piece("facture", { signature: { mode: "texte", name: "Client SAS" } }), { publicQr: null });
    expect(qrBlocks(markup)).toHaveLength(0);
    expect(markup).not.toContain("print-qr-totals");
    expect(markup).toContain("Client SAS");
  });
});
