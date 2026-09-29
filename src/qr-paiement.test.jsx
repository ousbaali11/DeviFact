// @vitest-environment jsdom
// Point 3 (30/09/2026) : sur les pièces qui ont le bloc de paiement (facture,
// facture d'acompte), le QR code de paiement occupe la colonne de gauche de
// la rangée des totaux, calé en bas (aligné sur le Total TTC), à 1,6 cm ; la
// rangée du bas ne garde que la signature. Devis (signature en ligne), avoir
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
  it("facture et facture d'acompte : un seul QR code, à 1,6 cm, dans la colonne de gauche des totaux (avant le tableau des totaux et le bloc de paiement)", () => {
    for (const type of ["facture", "acompte"]) {
      const markup = html(piece(type));
      const blocks = qrBlocks(markup);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toContain("width:1.6cm");
      expect(markup).toContain('class="print-qr-totals"');
      expect(markup).toContain("margin-top:auto");
      const qrAt = markup.indexOf("print-qr-totals");
      expect(qrAt).toBeLessThan(markup.indexOf("Total TTC")); // « Total HT » est aussi un en-tête de colonne du tableau des lignes
      expect(qrAt).toBeLessThan(markup.indexOf("À payer :"));
      expect((markup.match(/Scannez pour voir les informations de paiement/g) || []).length).toBe(1);
    }
  });
  it("avec une note : la note reste au-dessus du QR code dans la même colonne", () => {
    const markup = html(piece("facture", { notes: "Merci de votre confiance" }));
    expect(markup.indexOf("Merci de votre confiance")).toBeLessThan(markup.indexOf("print-qr-totals"));
    expect(qrBlocks(markup)).toHaveLength(1);
  });
  it("facture payée : le QR code reste dans les totaux et le tampon PAYÉ reste à droite du bloc de paiement", () => {
    const markup = html(piece("facture", { status: "payée", paidAt: "2026-09-30" }));
    expect(qrBlocks(markup)).toHaveLength(1);
    expect(markup).toContain("print-paid-stamp");
    expect(markup.indexOf("print-qr-totals")).toBeLessThan(markup.indexOf("print-paid-stamp"));
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
