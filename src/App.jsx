import { useState, useEffect, useRef, useMemo, forwardRef } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { db } from "./client.js";
import { clearStorageCache, setActiveOrganization } from "./storage-adapter.js";
import * as XLSX from "xlsx";
import {
  Plus, Trash2, Printer, FileSpreadsheet, PenTool, Type as TypeIcon, Upload,
  ArrowRightLeft, Eraser, ChevronUp, ChevronDown, LayoutList, ArrowLeft,
  Search, FileText, Receipt, Copy, Loader2, Inbox, Check, Users, Building2,
  Pencil, X, UserPlus, UserCircle, LayoutDashboard, LogOut, Lock, CreditCard, Mail,
  KeyRound, Sparkles, ArrowRight, Eye, EyeOff, GitMerge, Scissors,
  Library, BookmarkPlus, RotateCcw, AlertTriangle, IndentIncrease, IndentDecrease,
  Shield, ToggleLeft, ToggleRight, Calculator, Download, Layers, Menu,
  Ship, Package, MapPinned,
} from "lucide-react";

const colors = {
  ink: "#1B2A33",
  inkSoft: "#4A5B63",
  paper: "#E9EEEA",
  surface: "#FFFFFF",
  brass: "#B8763E",
  brassDark: "#8F5C2E",
  slate: "#3E5C6E",
  moss: "#5B7A55",
  brick: "#A6483B",
  line: "#DAE1DC",
};

const TVA_RATES = [20, 10, 5.5, 2.1, 0];
const UNITS = ["forfait", "heure", "jour", "m²", "m³", "ml", "pièce", "kg", "lot"];
const UNIT_OPTIONS = ["", ...UNITS];
const unitLabel = (u) => u || "— (non précisé)";
const DEVIS_STATUSES = ["brouillon", "envoyé", "vu", "signé", "refusé", "expiré"];
const FACTURE_STATUSES = ["brouillon", "envoyée", "payée", "en retard"];
const PROFORMA_STATUSES = ["brouillon", "envoyée", "acceptée", "expirée"];

const PLANS = [
  { id: "gratuit", name: "Gratuit", monthly: 0, annual: 0, limit: 3, tagline: "Pour découvrir", features: ["3 devis ou factures", "Export PDF", "1 utilisateur"] },
  { id: "essentiel", name: "Essentiel", monthly: 19, annual: 182, limit: Infinity, tagline: "Pour l'artisan solo", features: ["Devis et factures illimités", "Export PDF/Excel", "Signature électronique", "1 utilisateur"] },
  { id: "pro", name: "Pro", monthly: 39, annual: 374, limit: Infinity, tagline: "Pour l'entreprise", features: ["Tout Essentiel", "Multi-utilisateurs", "Bibliothèque de prestations", "Suggestions IA", "Relances automatiques"] },
  { id: "entreprise", name: "Entreprise", monthly: null, annual: null, limit: Infinity, tagline: "Sur mesure", features: ["Tout Pro", "API (bientôt disponible)", "Support prioritaire"] },
];
function planLabel(id) { return PLANS.find((p) => p.id === id)?.name || "Gratuit"; }

const TIER_ORDER = ["gratuit", "essentiel", "pro", "entreprise"];
function tierAtLeast(plan, minTier) {
  return TIER_ORDER.indexOf(plan || "gratuit") >= TIER_ORDER.indexOf(minTier);
}
// Vérifie à la fois le niveau du forfait ET que le paiement est bien actif.
// Un forfait payant dont le paiement a échoué (impayé) ne donne plus accès
// à ses fonctionnalités, même si le champ "plan" n'a pas encore été rétrogradé.
function hasAccess(account, minTier) {
  if (minTier === "gratuit") return true;
  if (!tierAtLeast(account?.plan, minTier)) return false;
  return account?.paymentStatus === "payé";
}

function docTypeIcon(type) {
  if (type === "devis") return FileText;
  if (type === "proforma") return Ship;
  return Receipt;
}
function docTypeColor(type) {
  if (type === "devis") return colors.slate;
  if (type === "proforma") return colors.moss;
  return colors.brassDark;
}
function docTypeLabel(type) {
  if (type === "devis") return "Devis";
  if (type === "proforma") return "Proforma";
  return "Facture";
}

function statusColor(status) {
  if (status === "signé" || status === "payée" || status === "acceptée") return colors.moss;
  if (status === "refusé" || status === "en retard" || status === "expirée") return colors.brick;
  if (status === "envoyé" || status === "envoyée") return colors.slate;
  if (status === "vu") return colors.brassDark;
  return colors.inkSoft;
}

let uidCounter = 0;
const nextId = (p = "id") => `${p}_${++uidCounter}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
const eur = (n) => (isFinite(n) ? n : 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
// Formate un montant dans la devise du document (devis/facture/proforma).
// Distinct de eur() ci-dessus, qui reste réservé aux prix d'abonnement du site (toujours en EUR).
function formatMoney(n, currency) {
  const amount = isFinite(n) ? n : 0;
  try {
    return amount.toLocaleString("fr-FR", { style: "currency", currency: currency || "EUR" });
  } catch (e) {
    return `${amount.toFixed(2)} ${currency || "EUR"}`;
  }
}
const CURRENCIES = [
  "EUR", "USD", "GBP", "CHF", "CAD", "MAD", "DZD", "TND", "XOF", "XAF",
  "CNY", "JPY", "AED", "SAR", "TRY", "INR", "BRL", "MXN", "AUD", "SEK", "NOK", "PLN",
];
const fr = (d) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
const frLong = (d) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

function emptyLine() {
  return { id: nextId("l"), type: "line", designation: "", details: [], qty: 1, unit: "forfait", unitPrice: 0, tva: 20, discount: 0, marginScheme: false, purchasePriceTTC: "", salePriceTTC: "" };
}
const MARKERS = ["▪", "•", "◦", "‣", "▹", "►", "→", "–", "✓", "×", "★", "◆", "○", "■", "♦"];
function defaultMarker(level) {
  return level === 1 ? "▪" : "–";
}
function initials(name) {
  if (!name || !name.trim()) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}
function emptyDetail(level = 1) {
  return { id: nextId("d"), level, text: "", price: "", included: true, marker: defaultMarker(level) };
}
function detailsSum(details) {
  return (details || []).filter((d) => d.included).reduce((s, d) => s + (Number(d.price) || 0), 0);
}
function lineBaseHT(l) {
  return (Number(l.qty) || 0) * (Number(l.unitPrice) || 0) + detailsSum(l.details);
}
// Calcul du régime de la TVA sur la marge (article 297 A du CGI) :
// la TVA n'est due que sur la marge (prix de vente TTC - prix d'achat
// TTC), pas sur le prix de vente total. Le client ne paie que le prix
// de vente TTC affiché — aucune TVA n'est ajoutée par-dessus.
function lineMarginCalc(l, lineDiscount, globalDiscount) {
  const qty = Number(l.qty) || 0;
  const sale = Number(l.salePriceTTC) || 0;
  const purchase = Number(l.purchasePriceTTC) || 0;
  const factor = (1 - (Number(lineDiscount) || 0) / 100) * (1 - (Number(globalDiscount) || 0) / 100);
  const saleTTC = qty * sale * factor;
  const marginTTC = Math.max(0, qty * (sale - purchase)) * factor;
  const rate = Number(l.tva) || 0;
  const marginTVA = (marginTTC * rate) / (100 + rate);
  const totalHT = saleTTC - marginTVA; // pour que Total HT + TVA = prix TTC facturé au client
  return { saleTTC, marginTTC, marginTVA, totalHT };
}
const DEFAULT_MARGIN_MENTION = "Régime particulier - Biens d'occasion (article 297 A du CGI). TVA calculée sur la marge, non récupérable par l'acheteur.";
function emptySection() {
  return { id: nextId("s"), type: "section", title: "", subtitle: "" };
}
const COUNTRIES = [
  "France", "Belgique", "Suisse", "Luxembourg", "Monaco",
  "Allemagne", "Espagne", "Italie", "Portugal", "Pays-Bas", "Royaume-Uni", "Irlande",
  "Maroc", "Algérie", "Tunisie", "Sénégal", "Côte d'Ivoire", "Cameroun", "Mali", "Bénin", "Togo", "Burkina Faso", "Madagascar", "Congo (RDC)", "Congo (Brazzaville)", "Gabon", "Niger", "Guinée",
  "Canada", "États-Unis", "Mexique", "Brésil", "Argentine",
  "Chine", "Japon", "Corée du Sud", "Inde", "Émirats arabes unis", "Arabie saoudite", "Turquie", "Liban",
  "Roumanie", "Pologne", "Grèce", "Autriche", "Suède", "Norvège", "Danemark", "Finlande",
  "Australie", "Nouvelle-Zélande", "Afrique du Sud",
  "Autre",
];

function emptyClient() {
  return { id: nextId("cli"), type: "entreprise", name: "", address: "", country: "", email: "", phone: "" };
}
function emptyCompanyProfile() {
  return { type: "entreprise", name: "", siret: "", address: "", country: "", email: "", phone: "", tva: "", logo: null };
}
function emptyPrestation() {
  return { id: nextId("pr"), designation: "", category: "", unit: "forfait", unitPrice: 0, tva: 20 };
}

function nextNumber(documents, type) {
  const prefix = type === "devis" ? "DEV" : type === "proforma" ? "PRO" : "FAC";
  const nums = documents.filter((d) => d.type === type).map((d) => parseInt((d.docNumber.match(/(\d+)$/) || [])[1] || "0", 10));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

function emptyProforma() {
  return {
    serie: "", incoterm: "", incotermPlace: "", currency: "EUR",
    paymentTerms: "", grossWeight: "", netWeight: "", packagesCount: "",
    originCountry: "", hsCode: "", loadingPort: "", dischargingPort: "", transportMode: "",
    customFields: [],
  };
}

function newDocument(type, documents) {
  return {
    id: nextId("doc"),
    type,
    docNumber: nextNumber(documents, type),
    issueDate: new Date().toISOString().slice(0, 10),
    currency: "EUR",
    validityDays: 30,
    dueDays: 30,
    company: { type: "entreprise", name: "", siret: "", address: "", country: "", email: "", phone: "", tva: "", logo: null },
    client: { type: "entreprise", name: "", address: "", country: "", email: "", phone: "" },
    clientId: null,
    items: [emptyLine()],
    globalDiscount: 0,
    acompte: 0,
    notes: "Merci de votre confiance.",
    marginLegalMention: DEFAULT_MARGIN_MENTION,
    signature: { mode: "texte", name: "", image: null, drawing: null },
    proforma: type === "proforma" ? emptyProforma() : null,
    status: "brouillon",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function computeTotals(doc) {
  const lineItems = (doc.items || []).filter((i) => i.type === "line");
  const computedLines = lineItems.map((l) => {
    if (l.marginScheme) {
      const { saleTTC, marginTTC, marginTVA, totalHT } = lineMarginCalc(l, l.discount, doc.globalDiscount);
      return { ...l, totalHT, marginTVA, marginTTC, saleTTC };
    }
    const base = lineBaseHT(l);
    const afterLine = base * (1 - (Number(l.discount) || 0) / 100);
    const afterGlobal = afterLine * (1 - (Number(doc.globalDiscount) || 0) / 100);
    return { ...l, totalHT: afterGlobal };
  });
  const subtotalHT = computedLines.reduce((s, l) => s + l.totalHT, 0);
  const tvaGroups = {};
  computedLines.forEach((l) => {
    const rate = Number(l.tva) || 0;
    const lineTVA = l.marginScheme ? (l.marginTVA || 0) : (l.totalHT * rate) / 100;
    tvaGroups[rate] = (tvaGroups[rate] || 0) + lineTVA;
  });
  const totalTVA = Object.values(tvaGroups).reduce((a, b) => a + b, 0);
  const totalTTC = subtotalHT + totalTVA;
  const acompteAmount = totalTTC * ((Number(doc.acompte) || 0) / 100);
  const resteAPayer = totalTTC - acompteAmount;
  const hasMarginLines = computedLines.some((l) => l.marginScheme);
  return { computedLines, subtotalHT, tvaGroups, totalTVA, totalTTC, acompteAmount, resteAPayer, hasMarginLines };
}

const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
    .df-root { font-family: 'Inter', sans-serif; }
    .df-display { font-family: 'Space Grotesk', sans-serif; }
    .df-mono { font-family: 'IBM Plex Mono', monospace; }
    .df-input:focus, .df-select:focus, .df-textarea:focus { outline: none; border-color: ${colors.brass} !important; box-shadow: 0 0 0 3px rgba(184,118,62,0.15); }
    @keyframes df-marquee {
      0% { transform: translateX(-100vw); opacity: 0; }
      8% { opacity: 1; }
      92% { opacity: 1; }
      100% { transform: translateX(100vw); opacity: 0; }
    }
    .df-marquee-text { display: inline-block; white-space: nowrap; animation: df-marquee 11s linear infinite; }
    .print-doc { display: none; }
    @media print {
      @page { size: A4; margin: 0; }
      html, body { background: white !important; }
      .no-print, .editor-form { display: none !important; }
      .print-doc { display: block !important; box-sizing: border-box; }
      .print-doc * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `}</style>
);

const PrintDocument = forwardRef(function PrintDocument({ doc, totals, accountPlan, siteSettings, watermarkEnabled = true }, ref) {
  const { subtotalHT, tvaGroups, totalTVA, totalTTC, acompteAmount, resteAPayer } = totals;
  const validityDate = new Date(new Date(doc.issueDate).getTime() + (Number(doc.validityDays) || 0) * 86400000);
  const dueDate = new Date(new Date(doc.issueDate).getTime() + (Number(doc.dueDays) || 0) * 86400000);
  const lineItems = (doc.items || []).filter((i) => i.type === "line" || i.type === "section");
  const ink = siteSettings?.pdfHeaderColor || "#1B2A33";
  const inkSoft = "#4A5B63", brass = "#B8763E", brassDark = "#8F5C2E", line = "#DAE1DC";
  const box = siteSettings?.pdfBlockColor || "#F1F0EA";
  const pageBg = siteSettings?.pdfBackground || "#FBF7EF";
  const mono = { fontFamily: "'IBM Plex Mono', monospace" };
  const isFreeWatermark = watermarkEnabled; // contrôlé par l'Admin, forfait par forfait
  const watermarkText = (siteSettings?.name || "DeviFact").toUpperCase();
  const watermarkSize = Math.max(24, Math.min(48, Math.round(760 / Math.max(watermarkText.length, 1))));
  const pStyle = {
    fontFamily: "'Inter', sans-serif", color: ink, fontSize: "10.5pt", lineHeight: 1.4,
    background: pageBg,
    width: "210mm", minHeight: "294mm", boxSizing: "border-box",
    padding: "24px 28px", position: "relative", overflow: "hidden",
  };

  return (
    <div ref={ref} className="print-doc" style={pStyle}>
      {isFreeWatermark && (
        <div style={{
          position: "absolute", top: "45%", left: "50%", transform: "translate(-50%, -50%) rotate(-32deg)",
          fontFamily: "'Space Grotesk', sans-serif", fontSize: `${watermarkSize}pt`, fontWeight: 700, color: "rgba(27,42,51,0.08)",
          whiteSpace: "nowrap", pointerEvents: "none", zIndex: 0, letterSpacing: "0.05em",
        }}>
          {watermarkText}
        </div>
      )}
      {/* Numéro + Logo/Entreprise */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "18px", position: "relative", zIndex: 1 }}>
        <div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "14pt", fontWeight: 700 }}>
            {docTypeLabel(doc.type).toUpperCase()} N° : 
            <span style={mono}>{doc.docNumber || "—"}/{new Date(doc.issueDate).getFullYear()}</span>
          </div>
          <div style={{ fontSize: "9.5pt", color: inkSoft, marginTop: "4px" }}>Date d'émission : {frLong(doc.issueDate)}</div>
          <div style={{ fontSize: "9.5pt", color: inkSoft }}>{doc.type !== "facture" ? `Valable jusqu'au ${frLong(validityDate)}` : `Échéance : ${frLong(dueDate)}`}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          {doc.company.logo && (
            <img src={doc.company.logo} alt="Logo" style={{ height: "46px", marginLeft: "auto", marginBottom: "6px", objectFit: "contain" }} />
          )}
          {doc.company.name && (
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "14pt", fontWeight: 700 }}>{doc.company.name}</div>
          )}
        </div>
      </div>

      {/* Émetteur / Client */}
      <div style={{ display: "flex", gap: "16px", marginBottom: "20px", position: "relative", zIndex: 1 }}>
        <div style={{ flex: 1, background: box, borderRadius: "4px", padding: "10px 14px" }}>
          <div style={{ fontWeight: 700, marginBottom: "3px" }}>{doc.company.name || "—"}</div>
          {doc.company.address && <div>{doc.company.address}</div>}
          {doc.company.phone && <div>Téléphone : {doc.company.phone}</div>}
          {doc.company.email && <div>Mail : {doc.company.email}</div>}
          {doc.company.type !== "particulier" && doc.company.siret && <div>SIRET : {doc.company.siret}</div>}
          {doc.company.type !== "particulier" && doc.company.tva && <div>N° TVA : {doc.company.tva}</div>}
        </div>
        <div style={{ flex: 1, background: box, borderRadius: "4px", padding: "10px 14px" }}>
          {doc.client.name && <div style={{ fontWeight: 600 }}>{doc.client.name}</div>}
          {doc.client.address && <div>{doc.client.address}</div>}
          {doc.client.email && <div>{doc.client.email}</div>}
          {doc.client.phone && <div>{doc.client.phone}</div>}
        </div>
      </div>

      {doc.type === "proforma" && doc.proforma && (() => {
        const pf = doc.proforma;
        const rows = [
          ["Série", pf.serie], ["Incoterm", [pf.incoterm, pf.incotermPlace].filter(Boolean).join(" — ")],
          ["Devise", pf.currency], ["Conditions de paiement", pf.paymentTerms],
          ["Pays d'origine", pf.originCountry], ["Code SH / douanier", pf.hsCode],
          ["Poids brut", pf.grossWeight], ["Poids net", pf.netWeight],
          ["Nombre de colis", pf.packagesCount], ["Port de chargement", pf.loadingPort],
          ["Port de déchargement", pf.dischargingPort], ["Mode de transport", pf.transportMode],
          ...(pf.customFields || []).map((f) => [f.label, f.value]),
        ].filter(([, v]) => v);
        if (rows.length === 0) return null;
        return (
          <div style={{ marginBottom: "18px", position: "relative", zIndex: 1, background: box, borderRadius: "4px", padding: "10px 14px" }}>
            <div style={{ fontWeight: 700, marginBottom: "6px", color: brassDark, fontSize: "9pt", textTransform: "uppercase", letterSpacing: "0.04em" }}>Informations complémentaires</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 18px", fontSize: "9pt" }}>
              {rows.map(([label, value]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                  <span style={{ color: inkSoft }}>{label}</span>
                  <span style={{ fontWeight: 600, textAlign: "right" }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Tableau */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9.3pt", position: "relative", zIndex: 1 }}>
        <thead>
          <tr style={{ background: ink, color: "white" }}>
            <th style={{ textAlign: "left", padding: "6px 6px", fontSize: "8pt", textTransform: "uppercase", letterSpacing: "0.04em" }}>Désignation</th>
            <th style={{ textAlign: "right", padding: "6px 6px", fontSize: "8pt" }}>Qté</th>
            <th style={{ textAlign: "left", padding: "6px 6px", fontSize: "8pt" }}>Unité</th>
            <th style={{ textAlign: "right", padding: "6px 6px", fontSize: "8pt" }}>PU HT</th>
            <th style={{ textAlign: "right", padding: "6px 6px", fontSize: "8pt" }}>% TVA</th>
            <th style={{ textAlign: "right", padding: "6px 6px", fontSize: "8pt" }}>Total TVA</th>
            <th style={{ textAlign: "right", padding: "6px 6px", fontSize: "8pt" }}>Total HT</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((it, idx) => it.type === "section" ? (
            (it.title || it.subtitle) && (
              <tr key={it.id} style={{ pageBreakInside: "avoid" }}>
                <td colSpan={7} style={{ paddingTop: "10px", paddingBottom: "2px", borderBottom: `1.5px solid ${brass}` }}>
                  <div style={{ fontWeight: 700 }}>{it.title}</div>
                  {it.subtitle && <div style={{ fontSize: "8.5pt", color: inkSoft }}>{it.subtitle}</div>}
                </td>
              </tr>
            )
          ) : (() => {
            const isMargin = it.marginScheme;
            const marginCalc = isMargin ? lineMarginCalc(it, it.discount, doc.globalDiscount) : null;
            const lineHT = isMargin ? 0 : lineBaseHT(it) * (1 - (Number(it.discount) || 0) / 100) * (1 - (Number(doc.globalDiscount) || 0) / 100);
            const lineTVA = isMargin ? 0 : (lineHT * (Number(it.tva) || 0)) / 100;
            return (
              <tr key={it.id} style={{ pageBreakInside: "avoid", borderBottom: `1px solid ${line}`, background: idx % 2 ? "transparent" : "rgba(27,42,51,0.02)" }}>
                <td style={{ padding: "6px 6px", verticalAlign: "top" }}>
                  <div>{it.designation || "—"}</div>
                  {(it.details || []).filter((d) => d.included && (d.text || d.price)).map((d) => (
                    <div key={d.id} style={{ fontSize: "8.5pt", color: inkSoft, marginLeft: `${8 + (d.level - 1) * 14}px`, display: "flex", justifyContent: "space-between", gap: "8px" }}>
                      <span>{d.marker || defaultMarker(d.level)} {renderMarkup(d.text)}</span>
                      {Number(d.price) > 0 && <span style={mono}>{formatMoney(Number(d.price), doc.currency)}</span>}
                    </div>
                  ))}
                </td>
                <td style={{ padding: "6px 6px", textAlign: "right", verticalAlign: "top", ...mono }}>{it.qty}</td>
                <td style={{ padding: "6px 6px", verticalAlign: "top" }}>{it.unit}</td>
                {isMargin ? (
                  <>
                    <td style={{ padding: "6px 6px", textAlign: "right", verticalAlign: "top", ...mono }}>{formatMoney(Number(it.salePriceTTC) || 0, doc.currency)}</td>
                    <td colSpan={2} style={{ padding: "6px 6px", textAlign: "right", verticalAlign: "top", fontSize: "8pt", fontStyle: "italic", color: inkSoft }}>Régime de la marge*</td>
                    <td style={{ padding: "6px 6px", textAlign: "right", verticalAlign: "top", ...mono, fontWeight: 600 }}>{formatMoney(marginCalc.saleTTC, doc.currency)}</td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: "6px 6px", textAlign: "right", verticalAlign: "top", ...mono }}>{formatMoney(Number(it.unitPrice) || 0, doc.currency)}</td>
                    <td style={{ padding: "6px 6px", textAlign: "right", verticalAlign: "top", ...mono }}>{it.tva}%</td>
                    <td style={{ padding: "6px 6px", textAlign: "right", verticalAlign: "top", ...mono }}>{formatMoney(lineTVA, doc.currency)}</td>
                    <td style={{ padding: "6px 6px", textAlign: "right", verticalAlign: "top", ...mono, fontWeight: 600 }}>{formatMoney(lineHT, doc.currency)}</td>
                  </>
                )}
              </tr>
            );
          })())}
        </tbody>
      </table>
      {totals.hasMarginLines && (
        <div style={{ marginTop: "6px", fontSize: "7.5pt", color: inkSoft, position: "relative", zIndex: 1 }}>
          * {doc.marginLegalMention || DEFAULT_MARGIN_MENTION}
        </div>
      )}

      {/* Conditions + Totaux */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: "24px", marginTop: "18px", pageBreakInside: "avoid", position: "relative", zIndex: 1 }}>
        <div style={{ flex: 1, fontSize: "9pt" }}>
          {doc.notes && (
            <>
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Note :</div>
              <div style={{ color: inkSoft, whiteSpace: "pre-wrap" }}>{renderMarkup(doc.notes)}</div>
            </>
          )}
          {Number(doc.acompte) > 0 && (
            <div style={{ marginTop: "6px" }}>Acompte de {doc.acompte}% à la commande : <strong style={mono}>{formatMoney(acompteAmount, doc.currency)}</strong></div>
          )}
        </div>

        <div style={{ width: "230px", fontSize: "10pt" }}>
          <div style={{ display: "flex", justifyContent: "space-between", background: ink, color: "white", padding: "7px 10px", fontWeight: 700 }}>
            <span>Total HT</span><span style={mono}>{formatMoney(subtotalHT, doc.currency)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", border: `1px solid ${line}`, padding: "7px 10px", fontWeight: 600 }}>
            <span>Total TVA</span><span style={mono}>{formatMoney(totalTVA, doc.currency)}</span>
          </div>
          {Object.keys(tvaGroups).length > 1 && Object.entries(tvaGroups).map(([rate, amount]) => (
            <div key={rate} style={{ display: "flex", justifyContent: "space-between", padding: "2px 10px", fontSize: "8.5pt", color: inkSoft }}>
              <span>dont TVA {rate}%</span><span style={mono}>{formatMoney(amount, doc.currency)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", background: ink, color: "white", padding: "9px 10px", fontWeight: 700, fontSize: "12.5pt", marginTop: "2px" }}>
            <span>Net à payer</span><span style={mono}>{formatMoney(totalTTC, doc.currency)}</span>
          </div>
          {Number(doc.acompte) > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", fontWeight: 700, color: brassDark }}>
              <span>Reste à payer</span><span style={mono}>{formatMoney(resteAPayer, doc.currency)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Signature — bas à droite, uniquement si une signature existe */}
      {((doc.signature?.mode === "texte" && doc.signature?.name) ||
        (doc.signature?.mode === "dessin" && doc.signature?.drawing) ||
        (doc.signature?.mode === "image" && doc.signature?.image)) && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "20px", pageBreakInside: "avoid", position: "relative", zIndex: 1 }}>
          <div style={{ width: "230px", border: `1px solid ${line}`, borderRadius: "4px", padding: "10px 14px", minHeight: "70px" }}>
            {doc.signature?.mode === "texte" && doc.signature?.name && (
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "14pt", fontStyle: "italic" }}>{doc.signature.name}</div>
            )}
            {doc.signature?.mode === "dessin" && doc.signature?.drawing && (
              <img src={doc.signature.drawing} alt="Signature" style={{ height: "60px" }} />
            )}
            {doc.signature?.mode === "image" && doc.signature?.image && (
              <img src={doc.signature.image} alt="Signature" style={{ height: "60px", objectFit: "contain" }} />
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default function DeviFactApp() {
  const [view, setView] = useState("dashboard");
  const [documents, setDocuments] = useState([]);
  const [clients, setClients] = useState([]);
  const [prestations, setPrestations] = useState([]);
  const [companyProfile, setCompanyProfile] = useState(emptyCompanyProfile());
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingClients, setSavingClients] = useState(false);
  const [savingPrestations, setSavingPrestations] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("tous");
  const [limitNotice, setLimitNotice] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [splitNotice, setSplitNotice] = useState(null);
  const [savingPlanSettings, setSavingPlanSettings] = useState(false);
  const [preAuthView, setPreAuthView] = useState("landing"); // landing | auth
  const [siteSettings, setSiteSettings] = useState({ name: "DeviFact", logo: null, logoWidth: 36, logoHeight: 36, pdfBackground: "#FBF7EF", pdfHeaderColor: "#1B2A33", pdfBlockColor: "#F1F0EA" });
  const [savingSiteSettings, setSavingSiteSettings] = useState(false);
  const [authMode, setAuthMode] = useState("signup");

  const [plans, setPlans] = useState(PLANS);

  async function loadProfile(userId, email, preferredOrgId = null) {
    const { data: profile } = await db.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (!profile) return null;

    const { data: memberships } = await db
      .from("organization_members")
      .select("role, organization_id, organizations ( id, name, plan, billing_cycle, payment_status )")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    const list = memberships || [];
    // Choix déterministe de l'organisation active — jamais au hasard,
    // pour ne jamais mélanger les données de deux organisations
    // différentes dont ferait partie la même personne :
    // 1. celle demandée explicitement (changement d'organisation), sinon
    // 2. celle dont la personne est propriétaire (son propre espace), sinon
    // 3. la plus ancienne organisation dont elle est membre.
    const membership =
      list.find((m) => m.organization_id === preferredOrgId) ||
      list.find((m) => m.role === "owner") ||
      list[0] ||
      null;

    const org = membership?.organizations;

    return {
      id: userId,
      email,
      companyName: profile.company_name || "",
      firstName: profile.first_name || "",
      lastName: profile.last_name || "",
      isAdmin: profile.is_admin,
      loggedIn: true,
      organizationId: membership?.organization_id || null,
      organizationName: org?.name || "",
      role: membership?.role || "owner",
      memberships: list.map((m) => ({ organizationId: m.organization_id, name: m.organizations?.name || "", role: m.role })),
      plan: org?.plan || "gratuit",
      billing: org?.billing_cycle || "mensuel",
      paymentStatus: org?.payment_status || "gratuit",
    };
  }
  async function loadPlans() {
    const { data, error } = await db.from("plans").select("*");
    if (error || !data) {
      console.error("Erreur de chargement des forfaits (état précédent conservé)", error);
      return; // on garde l'état actuel plutôt que d'écraser avec les valeurs par défaut
    }
    const merged = PLANS.map((base) => {
      const row = data.find((p) => p.id === base.id);
      if (!row) return base;
      return {
        ...base,
        monthly: row.monthly_price, annual: row.annual_price,
        limit: row.document_limit ?? Infinity, tagline: row.tagline || base.tagline,
        hidden: !row.is_visible,
        paypalPlanIdMonthly: row.paypal_plan_id_monthly || "",
        paypalPlanIdAnnual: row.paypal_plan_id_annual || "",
        watermarkEnabled: row.watermark_enabled ?? true,
      };
    });
    setPlans(merged);
  }
  async function updatePlanPaypalId(planId, field, value) {
    setSavingPlanSettings(true);
    const column = field === "monthly" ? "paypal_plan_id_monthly" : "paypal_plan_id_annual";
    const { error } = await db.from("plans").update({ [column]: value || null }).eq("id", planId);
    if (error) console.error("Erreur de mise à jour de l'identifiant PayPal (droits admin requis)", error);
    await loadPlans();
    setSavingPlanSettings(false);
  }

  async function loadSiteSettings() {
    const { data, error } = await db.from("site_settings").select("*").eq("id", 1).maybeSingle();
    if (error || !data) {
      console.error("Erreur de chargement des paramètres du site (état précédent conservé)", error);
      return;
    }
    setSiteSettings({
      name: data.name || "DeviFact", logo: data.logo_url || null, logoWidth: data.logo_width || 36, logoHeight: data.logo_height || 36,
      pdfBackground: data.pdf_background || "#FBF7EF",
      pdfHeaderColor: data.pdf_header_color || "#1B2A33",
      pdfBlockColor: data.pdf_block_color || "#F1F0EA",
    });
  }
  async function updateSiteSettings(patch) {
    setSavingSiteSettings(true);
    const column = { name: "name", logo: "logo_url", logoWidth: "logo_width", logoHeight: "logo_height", pdfBackground: "pdf_background", pdfHeaderColor: "pdf_header_color", pdfBlockColor: "pdf_block_color" };
    const dbPatch = {};
    Object.entries(patch).forEach(([k, v]) => { if (column[k]) dbPatch[column[k]] = v; });
    const { error } = await db.from("site_settings").update(dbPatch).eq("id", 1);
    if (error) console.error("Erreur de mise à jour des paramètres du site (droits admin requis)", error);
    await loadSiteSettings();
    setSavingSiteSettings(false);
  }

  async function loadUserData() {
    const [docsRes, clientsRes, companyRes, prestationsRes] = await Promise.allSettled([
      window.storage.get("documents", false),
      window.storage.get("clients", false),
      window.storage.get("company-profile", false),
      window.storage.get("prestations", false),
    ]);
    setDocuments(docsRes.status === "fulfilled" && docsRes.value ? JSON.parse(docsRes.value.value) : []);
    setClients(clientsRes.status === "fulfilled" && clientsRes.value ? JSON.parse(clientsRes.value.value) : []);
    setCompanyProfile(companyRes.status === "fulfilled" && companyRes.value ? JSON.parse(companyRes.value.value) : emptyCompanyProfile());
    setPrestations(prestationsRes.status === "fulfilled" && prestationsRes.value ? JSON.parse(prestationsRes.value.value) : []);
  }
  function clearUserData() {
    // Vide toutes les données en mémoire — indispensable à la déconnexion
    // pour qu'aucune trace du compte précédent ne reste visible au suivant.
    setDocuments([]);
    setClients([]);
    setCompanyProfile(emptyCompanyProfile());
    setPrestations([]);
    setActiveId(null);
  }

  // Change l'organisation actuellement affichée, parmi celles dont la
  // personne connectée est membre — jamais de mélange : les données
  // de l'ancienne organisation sont d'abord entièrement vidées, avant
  // de charger celles de la nouvelle.
  async function switchOrganization(organizationId) {
    const { data: { user } } = await db.auth.getUser();
    if (!user) return;
    clearUserData();
    const profile = await loadProfile(user.id, user.email, organizationId);
    setActiveOrganization(profile?.organizationId || null);
    await loadUserData();
    setAccount(profile);
    setView("dashboard");
  }

  useEffect(() => {
    (async () => {
      await Promise.all([loadPlans(), loadSiteSettings()]);
    })();

    // Seule source de vérité pour les données propres à l'utilisateur :
    // se déclenche à l'ouverture (avec la session actuelle, s'il y en a
    // une), à chaque connexion/inscription, et à chaque déconnexion —
    // qu'il s'agisse du même utilisateur ou d'un utilisateur différent.
    const { data: authListener } = db.auth.onAuthStateChange(async (_event, session) => {
      try {
        if (_event === "PASSWORD_RECOVERY") setRecoveryMode(true);
        if (session?.user) {
          const profile = await loadProfile(session.user.id, session.user.email);
          setActiveOrganization(profile?.organizationId || null);
          await loadUserData();
          setAccount(profile);
        } else {
          clearUserData();
          setAccount(null);
        }
      } catch (err) {
        // Ne doit jamais laisser l'écran de connexion bloqué indéfiniment,
        // même si une étape du chargement échoue de façon inattendue.
        console.error("Erreur lors du chargement de la session :", err);
        setAccount(null);
      } finally {
        setLoading(false);
      }
    });
    return () => authListener?.subscription?.unsubscribe();
  }, []);

  async function updatePlanPrice(planId, field, value) {
    setSavingPlanSettings(true);
    const column = field === "monthly" ? "monthly_price" : "annual_price";
    const { error } = await db.from("plans").update({ [column]: value === "" ? null : Number(value) }).eq("id", planId);
    if (error) console.error("Erreur de mise à jour du prix (droits admin requis)", error);
    await loadPlans();
    setSavingPlanSettings(false);
  }
  async function updatePlanLimit(planId, value) {
    setSavingPlanSettings(true);
    const limit = value === "" ? null : Math.max(0, parseInt(value, 10) || 0);
    const { error } = await db.from("plans").update({ document_limit: limit }).eq("id", planId);
    if (error) console.error("Erreur de mise à jour de la limite (droits admin requis)", error);
    await loadPlans();
    setSavingPlanSettings(false);
  }
  async function togglePlanVisibility(planId) {
    setSavingPlanSettings(true);
    const current = plans.find((p) => p.id === planId);
    const { error } = await db.from("plans").update({ is_visible: !!current?.hidden }).eq("id", planId);
    if (error) console.error("Erreur de mise à jour de la visibilité (droits admin requis)", error);
    await loadPlans();
    setSavingPlanSettings(false);
  }
  async function toggleWatermark(planId) {
    setSavingPlanSettings(true);
    const current = plans.find((p) => p.id === planId);
    const { error } = await db.from("plans").update({ watermark_enabled: !current?.watermarkEnabled }).eq("id", planId);
    if (error) console.error("Erreur de mise à jour du filigrane (droits admin requis)", error);
    await loadPlans();
    setSavingPlanSettings(false);
  }

  async function persistAccount(next) {
    setAccount(next);
    const { data: { user } } = await db.auth.getUser();
    if (!user) return;
    try {
      // Le forfait payant n'est jamais confirmé ici : seul le webhook PayPal,
      // qui tourne côté serveur, a le droit de faire passer un compte sur un
      // forfait payant. Voir functions/paypal-webhook.
      await db.from("profiles").update({
        company_name: next.companyName,
        billing_cycle: next.billing,
      }).eq("id", user.id);
    } catch (e) {
      console.error("Erreur d'enregistrement compte", e);
    }
  }
  async function logout() {
    await db.auth.signOut();
    clearStorageCache();
    setAccount(null);
  }
  async function chooseFreePlan() {
    if (!account?.organizationId) return;
    const { error } = await db.from("organizations").update({ plan: "gratuit", payment_status: "gratuit" }).eq("id", account.organizationId);
    if (error) { console.error("Erreur de passage au forfait gratuit", error); return; }
    setAccount((prev) => ({ ...prev, plan: "gratuit", paymentStatus: "gratuit" }));
  }
  // Active directement un forfait payant dont le prix est à 0€, sans passer
  // par PayPal (inutile de créer une souscription pour un montant nul).
  // Sûr : le prix vient de la table "plans" en base, que seul un admin
  // peut modifier (RLS) — un utilisateur ne peut pas déclencher ceci en
  // falsifiant un prix depuis son navigateur.
  async function chooseZeroPricePlan(planId, billingCycle) {
    if (!account?.organizationId) return;
    const { error } = await db.from("organizations").update({ plan: planId, billing_cycle: billingCycle, payment_status: "payé" }).eq("id", account.organizationId);
    if (error) { console.error("Erreur d'activation du forfait à 0€", error); return; }
    setAccount((prev) => ({ ...prev, plan: planId, billing: billingCycle, paymentStatus: "payé" }));
  }
  async function togglePaymentStatus() {
    if (!account?.organizationId) return;
    const nextStatus = account.paymentStatus === "payé" ? "impayé" : "payé";
    const { error } = await db.from("organizations").update({ payment_status: nextStatus }).eq("id", account.organizationId);
    if (error) { console.error("Erreur de mise à jour du statut de paiement", error); return; }
    setAccount({ ...account, paymentStatus: nextStatus });
  }
  async function deleteCurrentAccount() {
    if (!account?.organizationId) return;
    // Supprime les données applicatives de l'organisation. La suppression
    // du compte d'authentification lui-même se fait depuis le dashboard
    // du fournisseur (Authentication → Users), jamais depuis le navigateur.
    await Promise.allSettled([
      window.storage.set("documents", JSON.stringify([]), false),
      window.storage.set("clients", JSON.stringify([]), false),
      window.storage.set("prestations", JSON.stringify([]), false),
      window.storage.set("company-profile", JSON.stringify(emptyCompanyProfile()), false),
      db.from("organizations").update({ plan: "gratuit", payment_status: "gratuit" }).eq("id", account.organizationId),
    ]);
    setDocuments([]); setClients([]); setPrestations([]); setCompanyProfile(emptyCompanyProfile());
    await logout();
  }

  async function persist(next) {
    setDocuments(next);
    setSaving(true);
    try {
      await window.storage.set("documents", JSON.stringify(next), false);
    } catch (e) {
      console.error("Erreur d'enregistrement", e);
    } finally {
      setSaving(false);
    }
  }
  async function persistClients(next) {
    setClients(next);
    setSavingClients(true);
    try {
      await window.storage.set("clients", JSON.stringify(next), false);
    } catch (e) {
      console.error("Erreur d'enregistrement clients", e);
    } finally {
      setSavingClients(false);
    }
  }
  async function persistCompanyProfile(next) {
    if (isLocked) return;
    setCompanyProfile(next);
    setSavingCompany(true);
    try {
      await window.storage.set("company-profile", JSON.stringify(next), false);
    } catch (e) {
      console.error("Erreur d'enregistrement profil entreprise", e);
    } finally {
      setSavingCompany(false);
    }
  }
  function upsertClient(clientData) {
    if (isLocked) return;
    const exists = clients.some((c) => c.id === clientData.id);
    const next = exists ? clients.map((c) => (c.id === clientData.id ? clientData : c)) : [clientData, ...clients];
    persistClients(next);
  }
  function deleteClient(id) {
    if (isLocked) return;
    persistClients(clients.filter((c) => c.id !== id));
  }
  async function persistPrestations(next) {
    setPrestations(next);
    setSavingPrestations(true);
    try {
      await window.storage.set("prestations", JSON.stringify(next), false);
    } catch (e) {
      console.error("Erreur d'enregistrement prestations", e);
    } finally {
      setSavingPrestations(false);
    }
  }
  function upsertPrestation(p) {
    const exists = prestations.some((x) => x.id === p.id);
    const next = exists ? prestations.map((x) => (x.id === p.id ? p : x)) : [p, ...prestations];
    persistPrestations(next);
  }
  function deletePrestation(id) {
    persistPrestations(prestations.filter((x) => x.id !== id));
  }
  async function resetTestData() {
    if (isLocked) return;
    setDocuments([]);
    setClients([]);
    setPrestations([]);
    setSelectedIds([]);
    try {
      await Promise.all([
        window.storage.set("documents", JSON.stringify([]), false),
        window.storage.set("clients", JSON.stringify([]), false),
        window.storage.set("prestations", JSON.stringify([]), false),
      ]);
    } catch (e) {
      console.error("Erreur de réinitialisation", e);
    }
  }

  function openNew(type) {
    const plan = plans.find((p) => p.id === (account?.plan || "gratuit")) || PLANS[0];
    if (documents.length >= plan.limit) {
      setLimitNotice(true);
      setView("pricing");
      return;
    }
    const doc = newDocument(type, documents);
    if (companyProfile.name) doc.company = { ...companyProfile };
    persist([doc, ...documents]);
    setActiveId(doc.id);
    setView("editor");
  }
  function openDoc(id) {
    setActiveId(id);
    setView("editor");
  }
  function backToDashboard() {
    setView("dashboard");
    setActiveId(null);
  }
  function updateDoc(id, patch) {
    if (isLocked) return;
    persist(documents.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d)));
  }
  function deleteDoc(id) {
    if (isLocked) return;
    persist(documents.filter((d) => d.id !== id));
    if (activeId === id) backToDashboard();
  }
  function duplicateDoc(id) {
    if (isLocked) return;
    const original = documents.find((d) => d.id === id);
    if (!original) return;
    const copy = { ...original, id: nextId("doc"), docNumber: nextNumber(documents, original.type), status: "brouillon", createdAt: Date.now(), updatedAt: Date.now() };
    persist([copy, ...documents]);
  }
  function convertToInvoice(id) {
    if (isLocked) return;
    const original = documents.find((d) => d.id === id);
    if (!original || original.type !== "devis") return;
    const invoice = {
      ...original,
      id: nextId("doc"),
      type: "facture",
      docNumber: nextNumber(documents, "facture"),
      issueDate: new Date().toISOString().slice(0, 10),
      status: "brouillon",
      linkedDevisId: original.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    persist([invoice, ...documents]);
    setActiveId(invoice.id);
    setView("editor");
  }
  function toggleSelect(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function mergeDocuments(ids) {
    if (isLocked) return;
    const docs = documents.filter((d) => ids.includes(d.id));
    if (docs.length < 2) return;
    const type = docs[0].type;
    const mergedItems = [];
    docs.forEach((d) => {
      mergedItems.push({ id: nextId("s"), type: "section", title: `${d.docNumber}${d.client.name ? " — " + d.client.name : ""}`, subtitle: "" });
      d.items.filter((i) => i.type === "line").forEach((line) => {
        mergedItems.push({ ...line, id: nextId("l") });
      });
    });
    const base = docs[0];
    const merged = {
      ...newDocument(type, documents),
      company: base.company,
      client: base.client,
      clientId: base.clientId,
      items: mergedItems,
      notes: `Document fusionné à partir de ${docs.map((d) => d.docNumber).join(", ")}.`,
      mergedFrom: ids,
    };
    persist([merged, ...documents]);
    setSelectedIds([]);
    setActiveId(merged.id);
    setView("editor");
  }
  function createSplitDocument(sourceDoc, extractedItems) {
    const newDoc = {
      ...newDocument(sourceDoc.type, documents),
      company: sourceDoc.company,
      client: sourceDoc.client,
      clientId: sourceDoc.clientId,
      items: extractedItems.length ? extractedItems : [emptyLine()],
      notes: `Document extrait de ${sourceDoc.docNumber}.`,
      splitFrom: sourceDoc.id,
    };
    persist([newDoc, ...documents]);
    setSplitNotice({ docNumber: newDoc.docNumber, id: newDoc.id });
  }

  const filtered = useMemo(() => {
    return documents
      .filter((d) => typeFilter === "tous" || d.type === typeFilter)
      .filter((d) => {
        if (!search.trim()) return true;
        const s = search.toLowerCase();
        return d.docNumber.toLowerCase().includes(s) || (d.client.name || "").toLowerCase().includes(s);
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [documents, typeFilter, search]);

  const stats = useMemo(() => {
    const enAttente = documents.filter((d) => d.type === "devis" && ["envoyé", "vu"].includes(d.status));
    const montantEnAttente = enAttente.reduce((s, d) => s + computeTotals(d).totalTTC, 0);
    const impayees = documents.filter((d) => d.type === "facture" && d.status !== "payée");
    const montantImpaye = impayees.reduce((s, d) => s + computeTotals(d).totalTTC, 0);
    const devisTraites = documents.filter((d) => d.type === "devis" && d.status !== "brouillon");
    const devisSignes = documents.filter((d) => d.type === "devis" && d.status === "signé");
    const tauxSignature = devisTraites.length ? Math.round((devisSignes.length / devisTraites.length) * 100) : null;
    return { enAttenteCount: enAttente.length, montantEnAttente, impayeesCount: impayees.length, montantImpaye, tauxSignature };
  }, [documents]);

  const reminders = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const list = [];
    documents.forEach((d) => {
      if (d.type === "devis" && ["envoyé", "vu"].includes(d.status)) {
        const validityDate = new Date(new Date(d.issueDate).getTime() + (Number(d.validityDays) || 0) * 86400000);
        const daysLeft = Math.round((validityDate - today) / 86400000);
        if (daysLeft <= 3) list.push({ doc: d, reason: daysLeft < 0 ? "Devis expiré" : daysLeft === 0 ? "Expire aujourd'hui" : `Expire dans ${daysLeft} j`, urgent: daysLeft <= 0 });
      }
      if (d.type === "facture" && d.status === "envoyée") {
        const dueDate = new Date(new Date(d.issueDate).getTime() + (Number(d.dueDays) || 0) * 86400000);
        const daysLate = Math.round((today - dueDate) / 86400000);
        if (daysLate >= 0) list.push({ doc: d, reason: daysLate === 0 ? "Échéance aujourd'hui" : `${daysLate} j de retard`, urgent: daysLate > 0 });
      }
    });
    return list.sort((a, b) => (b.urgent === a.urgent ? 0 : b.urgent ? 1 : -1));
  }, [documents]);

  function reminderMailto({ doc }) {
    const { totalTTC } = computeTotals(doc);
    const subject = doc.type === "devis" ? `Relance — Devis ${doc.docNumber}` : `Relance — Facture ${doc.docNumber}`;
    const body = doc.type === "devis"
      ? `Bonjour ${doc.client.name || ""},\n\nJe me permets de vous relancer au sujet du devis ${doc.docNumber}, dont la date de validité approche.\n\nN'hésitez pas à me contacter pour toute question.\n\nCordialement.`
      : `Bonjour ${doc.client.name || ""},\n\nSauf erreur de notre part, la facture ${doc.docNumber} d'un montant de ${formatMoney(totalTTC, doc.currency)} reste impayée à ce jour.\n\nMerci de bien vouloir procéder au règlement dans les meilleurs délais.\n\nCordialement.`;
    return `mailto:${doc.client.email || ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function exportAccountingCSV() {
    const rows = [["Type", "Numéro", "Date d'émission", "Client", "Statut", "Montant HT", "Montant TVA", "Montant TTC"]];
    documents
      .slice()
      .sort((a, b) => new Date(a.issueDate) - new Date(b.issueDate))
      .forEach((d) => {
        const t = computeTotals(d);
        rows.push([
          d.type === "devis" ? "Devis" : "Facture", d.docNumber, fr(new Date(d.issueDate)), d.client.name || "",
          d.status, Number(t.subtotalHT.toFixed(2)), Number(t.totalTVA.toFixed(2)), Number(t.totalTTC.toFixed(2)),
        ]);
      });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 24 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, "Export comptable");
    XLSX.writeFile(wb, `export-comptable-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const activeDoc = documents.find((d) => d.id === activeId);

  if (loading) {
    return (
      <div className="flex min-h-full w-full items-center justify-center py-24" style={{ background: colors.paper }}>
        <GlobalStyle />
        <Loader2 className="animate-spin" size={22} style={{ color: colors.slate }} />
      </div>
    );
  }

  if (recoveryMode) {
    return <ResetPasswordScreen siteSettings={siteSettings} onDone={() => setRecoveryMode(false)} />;
  }

  if (!account || !account.loggedIn) {
    if (preAuthView === "landing") {
      return (
        <LandingPage
          plans={plans}
          siteSettings={siteSettings}
          onGetStarted={() => { setAuthMode("signup"); setPreAuthView("auth"); }}
          onLogin={() => { setAuthMode("login"); setPreAuthView("auth"); }}
        />
      );
    }
    return <AuthScreen initialMode={authMode} onBack={() => setPreAuthView("landing")} siteSettings={siteSettings} />;
  }

  const freeLimit = plans.find((p) => p.id === "gratuit")?.limit ?? 3;
  const freeLimitReached = (account?.plan || "gratuit") === "gratuit" && documents.length >= freeLimit;
  const isViewer = account?.role === "viewer";
  const isLocked = freeLimitReached || isViewer;

  if (view === "editor" && activeDoc) {
    return (
      <Editor
        doc={activeDoc}
        saving={saving}
        clients={clients}
        prestations={prestations}
        account={account}
        plans={plans}
        siteSettings={siteSettings}
        isLocked={isLocked}
        isViewer={isViewer}
        onChange={(patch) => updateDoc(activeDoc.id, patch)}
        onBack={backToDashboard}
        onConvert={() => convertToInvoice(activeDoc.id)}
        onSaveClient={upsertClient}
        onSavePrestation={upsertPrestation}
        onSplit={(extractedItems) => createSplitDocument(activeDoc, extractedItems)}
        splitNotice={splitNotice}
        onOpenSplitDoc={() => { if (splitNotice) { setActiveId(splitNotice.id); setSplitNotice(null); } }}
        onDismissSplitNotice={() => setSplitNotice(null)}
        onGoToPricing={() => setView("pricing")}
      />
    );
  }

  const navProps = { view, setView, onNewDevis: () => openNew("devis"), onNewFacture: () => openNew("facture"), onNewProforma: () => openNew("proforma"), account, onLogout: logout, onSwitchOrganization: switchOrganization, siteSettings, companyProfile, onSetCompanyType: (type) => { persistCompanyProfile({ ...companyProfile, type }); setView("company"); } };

  if (view === "clients") {
    return (
      <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <ClientsView clients={clients} documents={documents} saving={savingClients} onSave={upsertClient} onDelete={deleteClient} isLocked={isLocked} isViewer={isViewer} onGoToPricing={() => setView("pricing")} />
      </div>
    );
  }

  if (view === "company") {
    return (
      <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <CompanyView profile={companyProfile} saving={savingCompany} onSave={persistCompanyProfile} onReset={resetTestData} documentCount={documents.length} clientCount={clients.length} account={account} isLocked={isLocked} isViewer={isViewer} onGoToPricing={() => setView("pricing")} />
      </div>
    );
  }

  if (view === "team") {
    return (
      <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <TeamView account={account} />
      </div>
    );
  }

  if (view === "account") {
    return (
      <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <AccountView account={account} />
      </div>
    );
  }

  if (view === "prestations") {
    return (
      <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        {hasAccess(account, "pro") ? (
          <PrestationsView prestations={prestations} saving={savingPrestations} onSave={upsertPrestation} onDelete={deletePrestation} />
        ) : (
          <LockedFeature onGoToPricing={() => setView("pricing")} />
        )}
      </div>
    );
  }

  if (view === "pricing") {
    return (
      <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <PricingView
          account={account}
          plans={plans}
          onChooseFree={async () => { await chooseFreePlan(); setLimitNotice(false); setView("dashboard"); }}
          onChooseZeroPrice={async (planId, billingCycle) => { await chooseZeroPricePlan(planId, billingCycle); setLimitNotice(false); setView("dashboard"); }}
          limitNotice={limitNotice}
          documentCount={documents.length}
        />
      </div>
    );
  }

  if (view === "admin" && account?.isAdmin) {
    return (
      <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <AdminView
          account={account}
          documents={documents}
          clients={clients}
          companyProfile={companyProfile}
          plans={plans}
          savingPlanSettings={savingPlanSettings}
          onTogglePlan={togglePlanVisibility}
          onToggleWatermark={toggleWatermark}
          onUpdatePlanPrice={updatePlanPrice}
          onUpdatePlanLimit={updatePlanLimit}
          onUpdatePlanPaypalId={updatePlanPaypalId}
          onTogglePayment={togglePaymentStatus}
          onDeleteAccount={deleteCurrentAccount}
          siteSettings={siteSettings}
          savingSiteSettings={savingSiteSettings}
          onUpdateSiteSettings={updateSiteSettings}
        />
      </div>
    );
  }

  return (
    <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <TopNav {...navProps} />

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {isViewer && (
          <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl px-4 py-3" style={{ background: `${colors.slate}12`, border: `1px solid ${colors.slate}40` }}>
            <span className="flex items-center gap-2 text-sm" style={{ color: colors.slate }}>
              <Eye size={15} /> Accès en lecture seule — {account?.organizationName || "cette équipe"} t'a donné le rôle "Lecteur", tu peux consulter mais pas modifier.
            </span>
          </div>
        )}
        {(account?.plan || "gratuit") === "gratuit" && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3" style={{ background: isLocked ? `${colors.brick}12` : colors.surface, border: `1px solid ${isLocked ? colors.brick + "40" : colors.line}` }}>
            <span className="flex items-center gap-2 text-sm" style={{ color: isLocked ? colors.brick : colors.inkSoft }}>
              {freeLimitReached && <Lock size={15} />}
              Forfait Gratuit — <strong className="df-mono">{documents.length}/{freeLimit}</strong> devis/factures/proforma utilisés
              {freeLimitReached && " — compte verrouillé jusqu'au passage à un forfait payant"}
            </span>
            <button onClick={() => setView("pricing")} className={freeLimitReached ? "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white" : "text-xs font-medium underline"} style={freeLimitReached ? { background: colors.brick } : { color: colors.brassDark }}>Passer à un forfait payant</button>
          </div>
        )}
        {/* Stats */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Devis en attente de réponse" value={stats.enAttenteCount} sub={eur(stats.montantEnAttente)} color={colors.slate} />
          <StatCard label="Factures impayées" value={stats.impayeesCount} sub={eur(stats.montantImpaye)} color={colors.brick} />
          <StatCard label="Taux de signature des devis" value={stats.tauxSignature === null ? "—" : `${stats.tauxSignature}%`} sub="devis envoyés → signés" color={colors.moss} />
        </div>

        {reminders.length > 0 && !hasAccess(account, "pro") && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3" style={{ background: colors.surface, border: `1px dashed ${colors.line}` }}>
            <span className="flex items-center gap-2 text-sm" style={{ color: colors.inkSoft }}>
              <Lock size={14} /> {reminders.length} relance(s) à faire — fonctionnalité réservée aux forfaits Pro et Entreprise
            </span>
            <button onClick={() => setView("pricing")} className="text-xs font-medium underline" style={{ color: colors.brassDark }}>Voir les forfaits</button>
          </div>
        )}
        {reminders.length > 0 && hasAccess(account, "pro") && (
          <div className="mb-6 overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.brick}40` }}>
            <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: `${colors.brick}0F`, borderBottom: `1px solid ${colors.line}` }}>
              <AlertTriangle size={14} style={{ color: colors.brick }} />
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: colors.brick }}>Relances à faire ({reminders.length})</span>
            </div>
            {reminders.map(({ doc: d, reason, urgent }, idx) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5" style={{ borderTop: idx ? `1px solid ${colors.line}` : "none" }}>
                <div style={{ color: d.type === "devis" ? colors.slate : colors.brassDark }}>{d.type === "devis" ? <FileText size={15} /> : <Receipt size={15} />}</div>
                <button onClick={() => openDoc(d.id)} className="df-mono w-32 shrink-0 text-left text-sm font-medium hover:underline">{d.docNumber}</button>
                <div className="min-w-0 grow basis-40 truncate text-sm">{d.client.name || <span style={{ color: colors.inkSoft }}>Client non renseigné</span>}</div>
                <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: urgent ? `${colors.brick}18` : `${colors.brassDark}18`, color: urgent ? colors.brick : colors.brassDark }}>{reason}</span>
                <a href={reminderMailto({ doc: d })} className="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium" style={{ border: `1px solid ${colors.line}`, color: colors.slate }}>
                  <Mail size={12} /> Relancer par email
                </a>
              </div>
            ))}
          </div>
        )}

        {/* Filtres */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
            <Search size={15} style={{ color: colors.inkSoft }} />
            <input className="df-input bg-transparent text-sm outline-none" placeholder="Rechercher un client ou un numéro..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1 rounded-lg p-1" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
            {[["tous", "Tous"], ["devis", "Devis"], ["facture", "Factures"], ["proforma", "Proforma"]].map(([id, label]) => (
              <button key={id} onClick={() => setTypeFilter(id)} className="rounded-md px-3 py-1.5 text-sm font-medium" style={{ background: typeFilter === id ? colors.ink : "transparent", color: typeFilter === id ? "white" : colors.inkSoft }}>
                {label}
              </button>
            ))}
          </div>
          {documents.length > 0 && (
            <button onClick={exportAccountingCSV} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium" style={{ border: `1px solid ${colors.line}`, color: colors.moss }} title="Liste de tous les documents avec montants HT/TVA/TTC, à donner à un comptable">
              <FileSpreadsheet size={15} /> Export comptable
            </button>
          )}
          {saving && <span className="flex items-center gap-1 text-xs" style={{ color: colors.inkSoft }}><Loader2 size={12} className="animate-spin" /> Enregistrement...</span>}

          {selectedIds.length > 0 && (() => {
            const selectedDocs = documents.filter((d) => selectedIds.includes(d.id));
            const sameType = selectedDocs.every((d) => d.type === selectedDocs[0].type);
            const canMerge = selectedDocs.length >= 2 && sameType && !isLocked;
            return (
              <div className="ml-auto flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: colors.paper, border: `1px solid ${colors.line}` }}>
                <span className="text-xs font-medium" style={{ color: colors.inkSoft }}>{selectedIds.length} sélectionné(s)</span>
                <button
                  onClick={() => canMerge && mergeDocuments(selectedIds)}
                  disabled={!canMerge}
                  title={!sameType ? "Sélectionne uniquement des devis ou uniquement des factures" : selectedDocs.length < 2 ? "Sélectionne au moins 2 documents" : "Fusionner en un seul document"}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
                  style={{ background: canMerge ? colors.slate : colors.line, color: canMerge ? "white" : colors.inkSoft, cursor: canMerge ? "pointer" : "not-allowed" }}
                >
                  <GitMerge size={13} /> Fusionner
                </button>
                <button onClick={() => setSelectedIds([])} className="text-xs" style={{ color: colors.inkSoft }}>Annuler</button>
              </div>
            );
          })()}
        </div>

        {/* Liste */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center" style={{ background: colors.surface, border: `1px dashed ${colors.line}` }}>
            <Inbox size={28} style={{ color: colors.inkSoft }} />
            <p className="df-display mt-3 text-lg font-semibold">{documents.length === 0 ? "Aucun document pour l'instant" : "Aucun résultat"}</p>
            <p className="mt-1 text-sm" style={{ color: colors.inkSoft }}>{documents.length === 0 ? "Crée ton premier devis ou ta première facture." : "Essaie une autre recherche ou un autre filtre."}</p>
            {documents.length === 0 && (
              <button onClick={() => openNew("devis")} className="mt-4 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink }}>
                <Plus size={15} /> Créer un devis
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
            <p className="border-b px-4 py-2 text-xs" style={{ borderColor: colors.line, color: colors.inkSoft }}>
              Sélectionne plusieurs devis (ou plusieurs factures) pour les <strong>fusionner</strong> en un seul document.
            </p>
            {filtered.map((d, idx) => {
              const { totalTTC } = computeTotals(d);
              const statuses = d.type === "devis" ? DEVIS_STATUSES : d.type === "proforma" ? PROFORMA_STATUSES : FACTURE_STATUSES;
              const TypeIconComp = docTypeIcon(d.type);
              return (
                <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderTop: idx ? `1px solid ${colors.line}` : "none", background: selectedIds.includes(d.id) ? "rgba(184,118,62,0.06)" : "transparent" }}>
                  <input type="checkbox" checked={selectedIds.includes(d.id)} onChange={() => toggleSelect(d.id)} style={{ accentColor: colors.brass }} />
                  <div className="flex items-center gap-2" style={{ color: docTypeColor(d.type) }}>
                    <TypeIconComp size={16} />
                  </div>
                  <button onClick={() => openDoc(d.id)} className="df-mono w-32 shrink-0 text-left text-sm font-medium hover:underline">{d.docNumber}</button>
                  <div className="min-w-0 grow basis-40 truncate text-sm">{d.client.name || <span style={{ color: colors.inkSoft }}>Client non renseigné</span>}</div>
                  <div className="df-mono w-28 shrink-0 text-right text-sm font-medium">{formatMoney(totalTTC, d.currency)}</div>
                  <div className="w-24 shrink-0 text-right text-xs" style={{ color: colors.inkSoft }}>{fr(d.updatedAt)}</div>
                  <select
                    value={d.status}
                    onChange={(e) => updateDoc(d.id, { status: e.target.value })}
                    className="df-select w-28 shrink-0 rounded-full px-2 py-1 text-xs font-medium"
                    style={{ background: `${statusColor(d.status)}1A`, color: statusColor(d.status), border: `1px solid ${statusColor(d.status)}55` }}
                  >
                    {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => duplicateDoc(d.id)} disabled={isLocked} title={isLocked ? "Verrouillé — passe à un forfait payant" : "Dupliquer"} style={{ color: colors.inkSoft, opacity: isLocked ? 0.4 : 1, cursor: isLocked ? "not-allowed" : "pointer" }}><Copy size={15} /></button>
                    <button onClick={() => deleteDoc(d.id)} disabled={isLocked} title={isLocked ? "Verrouillé — passe à un forfait payant" : "Supprimer"} style={{ color: colors.brick, opacity: isLocked ? 0.4 : 1, cursor: isLocked ? "not-allowed" : "pointer" }}><Trash2 size={15} /></button>
                  </div>
                </div>

              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function LandingPage({ plans, siteSettings, onGetStarted, onLogin }) {
  const [openFaq, setOpenFaq] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const visiblePlans = plans.filter((p) => !p.hidden);

  const features = [
    { icon: FileText, title: "Devis ou facture, à la carte", text: "Choisissez ce que vous produisez : un devis, une facture, ou les deux liés automatiquement en un clic." },
    { icon: Calculator, title: "Calculs automatiques", text: "TVA multi-taux, remises par ligne ou globales, acomptes : les totaux se recalculent seuls, sans erreur." },
    { icon: Layers, title: "Descriptions détaillées", text: "Structurez vos devis avec des descriptions et sous-descriptions imbriquées, uniquement si vous en avez besoin." },
    { icon: PenTool, title: "Signature électronique", text: "Signature saisie, dessinée à l'écran ou importée depuis une image, directement sur le document." },
    { icon: Download, title: "Export PDF & Excel", text: "Un PDF propre à envoyer tel quel, ou un fichier Excel avec tous les calculs à retravailler." },
    { icon: Users, title: "Clients & entreprise enregistrés", text: "Vos informations et celles de vos clients, saisies une fois, réutilisées automatiquement partout." },
  ];

  const faqs = [
    { q: "Dois-je entrer une carte bancaire pour l'essai gratuit ?", a: "Non. Le forfait Gratuit est accessible sans carte bancaire, avec une limite de 3 devis ou factures pour tester l'outil." },
    { q: "Puis-je transformer un devis en facture ?", a: "Oui, en un clic. Les lignes, quantités et prix sont repris automatiquement dans la facture générée." },
    { q: "Le produit est-il conforme à la réforme de facturation électronique ?", a: `${siteSettings.name} génère déjà les mentions légales obligatoires. La connexion à une Plateforme Agréée, obligatoire pour les TPE/PME au 1ᵉʳ septembre 2027, fait partie de la feuille de route.` },
    { q: "Puis-je changer de forfait à tout moment ?", a: "Oui, depuis votre compte, sans engagement pour le mensuel." },
  ];

  return (
    <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
      <GlobalStyle />

      <div className="relative w-full overflow-hidden py-2.5" style={{ background: colors.ink }}>
        <span className="df-marquee-text df-display text-xl font-semibold sm:text-2xl" style={{ color: colors.brass }}>
          ✦ Votre devis prêt en quelques clics
        </span>
      </div>

      <header className="sticky top-0 z-10" style={{ background: "rgba(233,238,234,0.92)", backdropFilter: "blur(8px)", borderBottom: `1px solid ${colors.line}` }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            {siteSettings.logo ? (
              <img src={siteSettings.logo} alt={siteSettings.name} style={{ width: siteSettings.logoWidth, height: siteSettings.logoHeight, objectFit: "contain" }} />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-lg df-mono text-sm font-semibold" style={{ background: colors.brass, color: colors.ink }}>{initials(siteSettings.name) || "DF"}</div>
            )}
            <span className="df-display text-lg font-semibold tracking-wide">{siteSettings.name}</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm font-medium sm:flex" style={{ color: colors.inkSoft }}>
            <a href="#fonctionnalites">Fonctionnalités</a>
            <a href="#tarifs">Tarifs</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="hidden items-center gap-3 sm:flex">
            <button onClick={onLogin} className="text-sm font-medium" style={{ color: colors.inkSoft }}>Connexion</button>
            <button onClick={onGetStarted} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink }}>Essai gratuit</button>
          </div>
          <button onClick={() => setMobileMenu((v) => !v)} className="sm:hidden"><Menu size={22} /></button>
        </div>
        {mobileMenu && (
          <div className="flex flex-col gap-3 border-t px-6 py-4 sm:hidden" style={{ borderColor: colors.line }}>
            <a href="#fonctionnalites" onClick={() => setMobileMenu(false)} className="text-sm font-medium">Fonctionnalités</a>
            <a href="#tarifs" onClick={() => setMobileMenu(false)} className="text-sm font-medium">Tarifs</a>
            <button onClick={onLogin} className="text-left text-sm font-medium">Connexion</button>
            <button onClick={onGetStarted} className="rounded-lg px-4 py-2 text-center text-sm font-medium" style={{ background: colors.brass, color: colors.ink }}>Essai gratuit</button>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-6 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: colors.brassDark }}>Devis &amp; factures pour artisans</span>
          <h1 className="df-display mt-3 text-4xl font-semibold leading-tight sm:text-5xl">Des devis clairs et des factures propres, sans y perdre votre soirée.</h1>
          <p className="mt-4 max-w-md text-base" style={{ color: colors.inkSoft }}>{siteSettings.name} réunit devis, factures, signature électronique et calculs automatiques dans un seul outil pensé pour les artisans et petites entreprises françaises.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={onGetStarted} className="flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-medium" style={{ background: colors.brass, color: colors.ink }}>Commencer gratuitement <ArrowRight size={16} /></button>
            <a href="#tarifs" className="flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-medium" style={{ border: `1px solid ${colors.line}` }}>Voir les tarifs</a>
          </div>
          <p className="mt-4 text-xs" style={{ color: colors.inkSoft }}>Aucune carte bancaire requise · Pensé pour la réforme de facturation électronique 2027</p>
        </div>
        <div className="rounded-2xl p-6 shadow-sm" style={{ background: colors.surface, border: `1px solid ${colors.line}`, transform: "rotate(1deg)" }}>
          <div className="mb-3 flex items-center justify-between border-b pb-3" style={{ borderColor: colors.line }}>
            <div>
              <div className="df-display text-lg font-semibold uppercase">Devis</div>
              <div className="df-mono text-xs" style={{ color: colors.inkSoft }}>DEV-2026-014</div>
            </div>
            <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${colors.moss}22`, color: colors.moss }}>signé</span>
          </div>
          <div className="flex justify-between border-b py-1.5 text-sm" style={{ borderColor: colors.line }}><span>Dépose ancienne robinetterie</span><span className="df-mono">45,00 €</span></div>
          <div className="flex justify-between border-b py-1.5 text-sm" style={{ borderColor: colors.line }}><span>Mitigeur thermostatique — pose</span><span className="df-mono">180,00 €</span></div>
          <div className="flex justify-between py-1.5 text-sm"><span>Reprise étanchéité</span><span className="df-mono">90,00 €</span></div>
          <div className="mt-4 flex justify-end">
            <div className="relative flex h-28 w-28 items-center justify-center" style={{ transform: "rotate(-5deg)" }}>
              <div className="absolute inset-0 rounded-full" style={{ border: `2.5px solid ${colors.brass}` }} />
              <div className="absolute inset-1.5 rounded-full" style={{ border: `1px solid ${colors.brass}` }} />
              <div className="text-center">
                <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: colors.brassDark }}>Total TTC</div>
                <div className="df-mono mt-1 text-lg font-semibold">378,00 €</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Fonctionnalités */}
      <section id="fonctionnalites" className="border-y py-16" style={{ background: colors.surface, borderColor: colors.line }}>
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto mb-10 max-w-lg text-center">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: colors.brassDark }}>Fonctionnalités</span>
            <h2 className="df-display mt-2 text-2xl font-semibold sm:text-3xl">Tout ce qu'il faut, rien de superflu</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl p-5" style={{ border: `1px solid ${colors.line}` }}>
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: colors.paper, color: colors.slate }}><Icon size={18} /></div>
                <div className="mb-1 text-sm font-semibold">{title}</div>
                <p className="text-xs" style={{ color: colors.inkSoft }}>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tarifs */}
      <section id="tarifs" className="py-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto mb-10 max-w-lg text-center">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: colors.brassDark }}>Tarifs</span>
            <h2 className="df-display mt-2 text-2xl font-semibold sm:text-3xl">Un forfait pour chaque taille d'entreprise</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {visiblePlans.map((plan) => (
              <div key={plan.id} className="flex flex-col overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${plan.id === "essentiel" ? colors.brass : colors.line}`, boxShadow: plan.id === "essentiel" ? `0 0 0 2px ${colors.brass}30` : "none" }}>
                <div style={{ height: "6px", background: planAccentColor(plan.id) }} />
                <div className="flex grow flex-col p-5">
                <div className="df-display text-lg font-bold" style={{ color: planAccentColor(plan.id) }}>{plan.name}</div>
                <div className="text-xs" style={{ color: colors.inkSoft }}>{plan.tagline}</div>
                <div className="df-mono my-4">
                  {plan.monthly === null ? <span className="text-2xl font-semibold">Sur devis</span> : (
                    <><span className="text-3xl font-extrabold">{plan.monthly}€</span><span className="text-sm" style={{ color: colors.inkSoft }}>/mois</span></>
                  )}
                </div>
                <ul className="mb-5 grow space-y-2 text-sm">
                  {(plan.features || []).map((f) => <PlanFeatureItem key={f} text={f} accentColor={planAccentColor(plan.id)} />)}
                </ul>
                <button onClick={onGetStarted} className="rounded-lg py-2 text-sm font-medium" style={{ background: plan.id === "essentiel" ? colors.brass : colors.ink, color: plan.id === "essentiel" ? colors.ink : "white" }}>Commencer</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t py-16" style={{ borderColor: colors.line }}>
        <div className="mx-auto max-w-2xl px-6">
          <div className="mb-8 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: colors.brassDark }}>Questions fréquentes</span>
          </div>
          {faqs.map((f, idx) => (
            <div key={f.q} className="border-b" style={{ borderColor: colors.line }}>
              <button onClick={() => setOpenFaq(openFaq === idx ? null : idx)} className="flex w-full items-center justify-between gap-3 py-4 text-left text-sm font-medium">
                {f.q} <ChevronDown size={16} className="shrink-0" style={{ transform: openFaq === idx ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
              </button>
              {openFaq === idx && <p className="pb-4 text-sm" style={{ color: colors.inkSoft }}>{f.a}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="px-6 pb-16">
        <div className="mx-auto max-w-4xl rounded-2xl p-10 text-center" style={{ background: colors.ink, color: "white" }}>
          <h2 className="df-display text-2xl font-semibold sm:text-3xl">Prêt à arrêter de perdre du temps sur vos devis ?</h2>
          <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>Créez votre compte en une minute, sans carte bancaire.</p>
          <button onClick={onGetStarted} className="mt-6 rounded-lg px-6 py-3 text-sm font-medium" style={{ background: colors.brass, color: colors.ink }}>Commencer gratuitement</button>
        </div>
      </section>

      <footer className="border-t px-6 py-8 text-center text-xs" style={{ borderColor: colors.line, color: colors.inkSoft }}>
        © 2026 {siteSettings.name} — <a href="mailto:contact@devifact.fr">contact@devifact.fr</a>
      </footer>
    </div>
  );
}

function ResetPasswordScreen({ siteSettings, onDone }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setError("");
    if (password.length < 6) { setError("Le mot de passe doit faire au moins 6 caractères."); return; }
    setBusy(true);
    try {
      const { error: updateError } = await db.auth.updateUser({ password });
      if (updateError) { setError(updateError.message); setBusy(false); return; }
      onDone();
    } catch (err) {
      console.error(err);
      setError("Une erreur est survenue. Réessaie.");
      setBusy(false);
    }
  }

  return (
    <div className="df-root flex min-h-full w-full items-center justify-center px-4 py-16" style={{ background: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          {siteSettings?.logo ? (
            <img src={siteSettings.logo} alt={siteSettings.name} style={{ width: siteSettings.logoWidth, height: siteSettings.logoHeight, objectFit: "contain" }} />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg df-mono text-base font-semibold" style={{ background: colors.brass, color: colors.ink }}>{initials(siteSettings?.name) || "DF"}</div>
          )}
          <span className="df-display text-xl font-semibold tracking-wide">{siteSettings?.name || "DeviFact"}</span>
        </div>
        <div className="rounded-2xl p-6" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          <h1 className="df-display mb-1 text-lg font-semibold">Nouveau mot de passe</h1>
          <p className="mb-4 text-xs" style={{ color: colors.inkSoft }}>Choisis un nouveau mot de passe pour ton compte.</p>
          <div className="space-y-3">
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium" style={{ color: colors.inkSoft }}><KeyRound size={13} /> Nouveau mot de passe</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className="df-input w-full rounded-md py-2 pl-3 pr-10 text-sm"
                  style={{ border: `1px solid ${colors.line}` }}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                  placeholder="••••••••"
                  autoFocus
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute inset-y-0 right-0 flex w-9 items-center justify-center" style={{ color: colors.inkSoft }} title={showPassword ? "Masquer" : "Afficher"}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {error && <p className="text-xs" style={{ color: colors.brick }}>{error}</p>}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-medium"
              style={{ background: colors.brass, color: colors.ink, opacity: busy ? 0.7 : 1 }}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <>Valider le nouveau mot de passe <ArrowRight size={15} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthScreen({ initialMode = "signup", onBack, siteSettings }) {
  const [mode, setMode] = useState(initialMode);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleForgotPassword() {
    setError("");
    setInfo("");
    const cleanEmail = email.trim();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);
    if (!cleanEmail || !emailOk) { setError("Renseigne un email valide pour recevoir le lien."); return; }

    setBusy(true);
    try {
      const { error: resetError } = await db.auth.resetPasswordForEmail(cleanEmail, { redirectTo: window.location.origin });
      if (resetError) { setError(resetError.message); setBusy(false); return; }
      setInfo("Si un compte existe avec cet email, un lien de réinitialisation vient d'être envoyé. Vérifie ta boîte mail (et les spams).");
      setBusy(false);
    } catch (err) {
      console.error(err);
      setError("Une erreur est survenue. Réessaie.");
      setBusy(false);
    }
  }

  async function handleSubmit() {
    setError("");
    setInfo("");

    const cleanEmail = email.trim();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);

    if (!cleanEmail) { setError("Merci de renseigner un email."); return; }
    if (!emailOk) { setError("Cet email ne semble pas valide (ex : toi@entreprise.fr)."); return; }
    if (!password) { setError("Merci de renseigner un mot de passe."); return; }

    setBusy(true);
    try {
      if (mode === "signup") {
        if (password.length < 6) { setError("Le mot de passe doit faire au moins 6 caractères."); setBusy(false); return; }
        const { data, error: signUpError } = await db.auth.signUp({ email: cleanEmail, password });
        if (signUpError) { setError(signUpError.message); setBusy(false); return; }

        // Un email déjà utilisé ne renvoie pas d'erreur explicite (mesure
        // de sécurité de Supabase), mais son tableau "identities" est vide
        // dans ce cas — c'est le seul moyen fiable de détecter la situation.
        const alreadyExists = data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;
        if (alreadyExists) {
          setError("Un compte existe déjà avec cet email. Connecte-toi plutôt, ou utilise \"Mot de passe oublié ?\" si besoin.");
          setMode("login");
          setBusy(false);
          return;
        }

        if (data.user) {
          if (companyName.trim() || firstName.trim() || lastName.trim()) {
            await db.from("profiles").update({ company_name: companyName.trim(), first_name: firstName.trim(), last_name: lastName.trim() }).eq("id", data.user.id);
          }
          // Crée l'organisation du nouvel inscrit, dont il devient
          // aussitôt propriétaire — c'est elle qui portera l'abonnement
          // et les données, éventuellement partagées avec une équipe plus tard.
          const { data: newOrg, error: orgError } = await db.from("organizations").insert({ name: companyName.trim() }).select("id").single();
          if (orgError) {
            console.error("Erreur de création de l'organisation", orgError);
          } else {
            await db.from("organization_members").insert({ organization_id: newOrg.id, user_id: data.user.id, role: "owner", status: "active" });
          }
        }
        if (!data.session) {
          // Si la confirmation par email est activée côté serveur, pas de
          // session immédiate : il faut cliquer le lien reçu par mail.
          setInfo("Compte créé ! Vérifie ta boîte mail pour confirmer ton adresse, puis reviens te connecter ici.");
          setMode("login");
          setBusy(false);
          return;
        }
        // Sinon : session créée immédiatement, l'écouteur onAuthStateChange
        // dans le composant principal prend le relais automatiquement.
      } else {
        const { error: signInError } = await db.auth.signInWithPassword({ email: cleanEmail, password });
        if (signInError) { setError("Email ou mot de passe incorrect."); setBusy(false); return; }
        setBusy(false);
      }
    } catch (err) {
      console.error(err);
      setError("Une erreur est survenue. Réessaie.");
      setBusy(false);
    }
  }
  function onEnterKey(e) {
    if (e.key === "Enter") handleSubmit();
  }

  return (
    <div className="df-root flex min-h-full w-full items-center justify-center px-4 py-16" style={{ background: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="w-full max-w-sm">
        {onBack && (
          <button onClick={onBack} className="mb-4 flex items-center gap-1.5 text-sm font-medium" style={{ color: colors.inkSoft }}>
            <ArrowLeft size={15} /> Retour au site
          </button>
        )}
        <div className="mb-6 flex items-center justify-center gap-3">
          {siteSettings?.logo ? (
            <img src={siteSettings.logo} alt={siteSettings.name} style={{ width: siteSettings.logoWidth, height: siteSettings.logoHeight, objectFit: "contain" }} />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg df-mono text-base font-semibold" style={{ background: colors.brass, color: colors.ink }}>{initials(siteSettings?.name) || "DF"}</div>
          )}
          <span className="df-display text-xl font-semibold tracking-wide">{siteSettings?.name || "DeviFact"}</span>
        </div>

        <div className="rounded-2xl p-6" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          {mode !== "forgot" && (
            <div className="mb-5 flex gap-1 rounded-lg p-1" style={{ background: colors.paper }}>
              <button type="button" onClick={() => { setMode("signup"); setError(""); setInfo(""); }} className="grow rounded-md py-1.5 text-sm font-medium" style={{ background: mode === "signup" ? colors.ink : "transparent", color: mode === "signup" ? "white" : colors.inkSoft }}>Inscription</button>
              <button type="button" onClick={() => { setMode("login"); setError(""); setInfo(""); }} className="grow rounded-md py-1.5 text-sm font-medium" style={{ background: mode === "login" ? colors.ink : "transparent", color: mode === "login" ? "white" : colors.inkSoft }}>Connexion</button>
            </div>
          )}

          {mode === "forgot" ? (
            <div className="space-y-3">
              <div>
                <p className="mb-3 text-xs" style={{ color: colors.inkSoft }}>Indique ton email, on t'envoie un lien pour choisir un nouveau mot de passe.</p>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium" style={{ color: colors.inkSoft }}><Mail size={13} /> Email</label>
                <input type="text" autoComplete="email" className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleForgotPassword(); }} placeholder="toi@entreprise.fr" />
              </div>
              {error && <p className="text-xs" style={{ color: colors.brick }}>{error}</p>}
              {info && <p className="text-xs" style={{ color: colors.moss }}>{info}</p>}
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={busy}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-medium"
                style={{ background: colors.brass, color: colors.ink, opacity: busy ? 0.7 : 1 }}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <>Envoyer le lien <ArrowRight size={15} /></>}
              </button>
              <button type="button" onClick={() => { setMode("login"); setError(""); setInfo(""); }} className="w-full text-center text-xs font-medium" style={{ color: colors.inkSoft }}>
                ← Retour à la connexion
              </button>
            </div>
          ) : (
          <div className="space-y-3">
            {mode === "signup" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Prénom</label>
                  <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={firstName} onChange={(e) => setFirstName(e.target.value)} onKeyDown={onEnterKey} placeholder="Jean" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Nom</label>
                  <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={lastName} onChange={(e) => setLastName(e.target.value)} onKeyDown={onEnterKey} placeholder="Martin" />
                </div>
              </div>
            )}
            {mode === "signup" && (
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium" style={{ color: colors.inkSoft }}><Building2 size={13} /> Nom de l'entreprise</label>
                <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={companyName} onChange={(e) => setCompanyName(e.target.value)} onKeyDown={onEnterKey} placeholder="Martin Rénovation" />
              </div>
            )}
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium" style={{ color: colors.inkSoft }}><Mail size={13} /> Email</label>
              <input type="text" autoComplete="email" className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onEnterKey} placeholder="toi@entreprise.fr" />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs font-medium" style={{ color: colors.inkSoft }}><KeyRound size={13} /> Mot de passe</label>
                {mode === "login" && (
                  <button type="button" onClick={() => { setMode("forgot"); setError(""); setInfo(""); }} className="text-xs font-medium" style={{ color: colors.slate }}>
                    Mot de passe oublié ?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  className="df-input w-full rounded-md py-2 pl-3 pr-10 text-sm"
                  style={{ border: `1px solid ${colors.line}` }}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={onEnterKey}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex w-9 items-center justify-center"
                  style={{ color: colors.inkSoft }}
                  aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  title={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {error && <p className="text-xs" style={{ color: colors.brick }}>{error}</p>}
            {info && <p className="text-xs" style={{ color: colors.moss }}>{info}</p>}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-medium"
              style={{ background: colors.brass, color: colors.ink, opacity: busy ? 0.7 : 1 }}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <>{mode === "signup" ? "Créer mon compte" : "Se connecter"} <ArrowRight size={15} /></>}
            </button>
          </div>
          )}
        </div>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs" style={{ color: colors.inkSoft }}>
          <Lock size={12} /> Authentification sécurisée (mots de passe hachés, jamais stockés en clair).
        </p>
      </div>
    </div>
  );
}

function TopNav({ view, setView, onNewDevis, onNewFacture, onNewProforma, account, onLogout, onSwitchOrganization, siteSettings, companyProfile, onSetCompanyType }) {
  const mainTabs = [
    { id: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    { id: "clients", label: "Clients", icon: Users },
    { id: "prestations", label: "Bibliothèque", icon: Library },
    { id: "company", label: "Mon entreprise", icon: Building2 },
    { id: "team", label: "Équipe", icon: UserPlus },
  ];
  const rightTabs = [
    { id: "pricing", label: "Abonnement", icon: CreditCard },
    ...(account?.isAdmin ? [{ id: "admin", label: "Admin", icon: Shield }] : []),
    { id: "account", label: "Mon compte", icon: UserCircle },
  ];
  const tabs = [...mainTabs, ...rightTabs];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink }}>
      <div className="flex min-w-0 grow items-center gap-6">
        <div className="flex shrink-0 items-center gap-3">
          {siteSettings?.logo ? (
            <img src={siteSettings.logo} alt={siteSettings.name} style={{ width: siteSettings.logoWidth, height: siteSettings.logoHeight, objectFit: "contain" }} />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg df-mono text-sm font-semibold" style={{ background: colors.brass, color: colors.ink }}>{initials(siteSettings?.name) || "DF"}</div>
          )}
          <span className="df-display text-lg font-semibold tracking-wide text-white">{siteSettings?.name || "DeviFact"}</span>
        </div>
        <div className="hidden min-w-0 grow items-center justify-between gap-3 lg:flex">
          <div className="flex items-center gap-1">
            {mainTabs.map(({ id, label, icon: Icon }) =>
              id === "company" ? (
                <div key={id} className="relative flex items-center">
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) onSetCompanyType(e.target.value); }}
                    onClick={() => setView("company")}
                    className="df-select appearance-none rounded-lg py-1.5 pl-8 pr-3 text-sm font-medium"
                    style={{ background: view === id ? "rgba(255,255,255,0.12)" : "transparent", color: view === id ? "white" : "rgba(255,255,255,0.65)", border: "none" }}
                    title="Mon entreprise"
                  >
                    <option value="" disabled hidden style={{ color: colors.ink }}>Entreprise/Particulier</option>
                    <option value="entreprise" style={{ color: colors.ink }}>Entreprise</option>
                    <option value="particulier" style={{ color: colors.ink }}>Particulier</option>
                  </select>
                  <Building2 size={15} className="pointer-events-none absolute left-2.5" style={{ color: view === id ? "white" : "rgba(255,255,255,0.65)" }} />
                </div>
              ) : (
                <button key={id} onClick={() => setView(id)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium" style={{ background: view === id ? "rgba(255,255,255,0.12)" : "transparent", color: view === id ? "white" : "rgba(255,255,255,0.65)" }}>
                  <Icon size={15} /> {label} {id === "prestations" && !hasAccess(account, "pro") && <Lock size={11} />}
                </button>
              )
            )}
          </div>
          <div className="flex items-center gap-2">
            {account?.memberships?.length > 1 && (
              <select
                value={account.organizationId || ""}
                onChange={(e) => onSwitchOrganization(e.target.value)}
                className="df-select rounded-lg px-2 py-1.5 text-xs font-medium"
                style={{ background: "rgba(255,255,255,0.1)", color: "white", border: "none" }}
                title="Changer d'organisation"
              >
                {account.memberships.map((m) => (
                  <option key={m.organizationId} value={m.organizationId} style={{ color: colors.ink }}>
                    {m.name || "Organisation"} {m.role !== "owner" ? `(${ROLE_LABELS[m.role] || m.role})` : ""}
                  </option>
                ))}
              </select>
            )}
            <div className="flex items-center gap-1">
              {rightTabs.map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setView(id)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium" style={{ background: view === id ? "rgba(255,255,255,0.12)" : "transparent", color: view === id ? "white" : "rgba(255,255,255,0.65)" }}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onNewDevis} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink }}>
          <Plus size={15} /> Devis
        </button>
        <button onClick={onNewFacture} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.slate }}>
          <Plus size={15} /> Facture
        </button>
        <button onClick={onNewProforma} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: colors.moss, color: "white" }} title="Nouvelle facture proforma">
          <Plus size={15} /> Proforma
        </button>
        <button onClick={onLogout} className="flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium" style={{ color: "rgba(255,255,255,0.65)" }} title="Se déconnecter">
          <LogOut size={15} />
        </button>
      </div>
      <div className="flex w-full items-center gap-1 overflow-x-auto lg:hidden" style={{ WebkitOverflowScrolling: "touch" }}>
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setView(id)} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium" style={{ background: view === id ? "rgba(255,255,255,0.12)" : "transparent", color: view === id ? "white" : "rgba(255,255,255,0.65)" }}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ClientsView({ clients, documents, saving, onSave, onDelete, isLocked, isViewer, onGoToPricing }) {
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");

  const filtered = clients.filter((c) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (c.name || "").toLowerCase().includes(s) || (c.email || "").toLowerCase().includes(s);
  });

  function countDocs(clientId) {
    return documents.filter((d) => d.clientId === clientId).length;
  }
  function startNew() { if (!isLocked) setEditing(emptyClient()); }
  function startEdit(c) { if (!isLocked) setEditing({ ...c }); }
  function save() {
    if (isLocked || !editing.name.trim()) return;
    onSave(editing);
    setEditing(null);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="df-display text-2xl font-semibold">Clients</h1>
          <p className="text-sm" style={{ color: colors.inkSoft }}>Ta base de clients, réutilisable dans chaque devis ou facture.</p>
        </div>
        <button onClick={startNew} disabled={isLocked} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: isLocked ? colors.line : colors.ink, color: isLocked ? colors.inkSoft : "white", cursor: isLocked ? "not-allowed" : "pointer" }}>
          {isLocked ? <Lock size={15} /> : <UserPlus size={15} />} Nouveau client
        </button>
      </div>

      {isLocked && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4" style={{ background: `${colors.brick}12`, border: `1px solid ${colors.brick}40` }}>
          <span className="flex items-center gap-2 text-sm font-medium" style={{ color: colors.brick }}>
            <Lock size={15} /> {isViewer ? "Accès en lecture seule — la gestion des clients est verrouillée." : "Limite du forfait Gratuit atteinte — la gestion des clients est verrouillée."}
          </span>
          {!isViewer && <button onClick={onGoToPricing} className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white" style={{ background: colors.brick }}>Passer à un forfait payant</button>}
        </div>
      )}

      {editing && !isLocked && (
        <div className="mb-6 rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.brass}` }}>
          <div className="mb-3 flex items-center justify-between">
            <span className="df-display text-xs font-semibold uppercase tracking-widest" style={{ color: colors.brassDark }}>{clients.some((c) => c.id === editing.id) ? "Modifier le client" : "Nouveau client"}</span>
            <button onClick={() => setEditing(null)} style={{ color: colors.inkSoft }}><X size={16} /></button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input className="df-input rounded-md px-2 py-1.5 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom / raison sociale" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <input className="df-input rounded-md px-2 py-1.5 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Adresse" value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
            <input className="df-input rounded-md px-2 py-1.5 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
            <input className="df-input rounded-md px-2 py-1.5 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Téléphone" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
          </div>
          <button onClick={save} className="mt-3 rounded-lg px-4 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink }}>Enregistrer</button>
        </div>
      )}

      <div className="mb-4 flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
        <Search size={15} style={{ color: colors.inkSoft }} />
        <input className="df-input bg-transparent text-sm outline-none" placeholder="Rechercher un client..." value={search} onChange={(e) => setSearch(e.target.value)} />
        {saving && <Loader2 size={13} className="animate-spin" style={{ color: colors.inkSoft }} />}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center" style={{ background: colors.surface, border: `1px dashed ${colors.line}` }}>
          <Users size={28} style={{ color: colors.inkSoft }} />
          <p className="df-display mt-3 text-lg font-semibold">Aucun client enregistré</p>
          <p className="mt-1 text-sm" style={{ color: colors.inkSoft }}>Ajoute un client ici, ou enregistre-le directement depuis un devis.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          {filtered.map((c, idx) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderTop: idx ? `1px solid ${colors.line}` : "none" }}>
              <div className="min-w-0 grow basis-40 truncate text-sm font-medium">{c.name}</div>
              <div className="min-w-0 grow basis-40 truncate text-xs" style={{ color: colors.inkSoft }}>{c.email || "—"}</div>
              <div className="w-28 shrink-0 text-xs" style={{ color: colors.inkSoft }}>{c.phone || "—"}</div>
              <div className="w-24 shrink-0 df-mono text-xs" style={{ color: colors.inkSoft }}>{countDocs(c.id)} document(s)</div>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => startEdit(c)} disabled={isLocked} style={{ color: isLocked ? colors.line : colors.slate, cursor: isLocked ? "not-allowed" : "pointer" }}><Pencil size={15} /></button>
                <button onClick={() => onDelete(c.id)} disabled={isLocked} style={{ color: isLocked ? colors.line : colors.brick, cursor: isLocked ? "not-allowed" : "pointer" }}><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PrestationsView({ prestations, saving, onSave, onDelete }) {
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");

  const filtered = prestations.filter((p) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (p.designation || "").toLowerCase().includes(s) || (p.category || "").toLowerCase().includes(s);
  });

  function startNew() { setEditing(emptyPrestation()); }
  function startEdit(p) { setEditing({ ...p }); }
  function save() {
    if (!editing.designation.trim()) return;
    onSave(editing);
    setEditing(null);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="df-display text-2xl font-semibold">Bibliothèque de prestations</h1>
          <p className="text-sm" style={{ color: colors.inkSoft }}>Vos prestations types, prêtes à insérer dans n'importe quel devis ou facture.</p>
        </div>
        <button onClick={startNew} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.ink }}>
          <Plus size={15} /> Nouvelle prestation
        </button>
      </div>

      {editing && (
        <div className="mb-6 rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.brass}` }}>
          <div className="mb-3 flex items-center justify-between">
            <span className="df-display text-xs font-semibold uppercase tracking-widest" style={{ color: colors.brassDark }}>{prestations.some((p) => p.id === editing.id) ? "Modifier la prestation" : "Nouvelle prestation"}</span>
            <button onClick={() => setEditing(null)} style={{ color: colors.inkSoft }}><X size={16} /></button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input className="df-input rounded-md px-2 py-1.5 text-sm sm:col-span-2" style={{ border: `1px solid ${colors.line}` }} placeholder="Désignation (ex : Fourniture et pose mitigeur)" value={editing.designation} onChange={(e) => setEditing({ ...editing, designation: e.target.value })} />
            <input className="df-input rounded-md px-2 py-1.5 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Catégorie (optionnel, ex : Plomberie)" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} />
            <select className="df-select rounded-md px-2 py-1.5 text-sm" style={{ border: `1px solid ${colors.line}` }} value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })}>
              {UNIT_OPTIONS.map((u) => <option key={u || "none"} value={u}>{unitLabel(u)}</option>)}
            </select>
            <input type="number" className="df-input df-mono rounded-md px-2 py-1.5 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Prix unitaire HT" value={editing.unitPrice} onChange={(e) => setEditing({ ...editing, unitPrice: e.target.value })} />
            <div className="relative">
              <input type="number" step="0.1" min="0" className="df-input df-mono w-full rounded-md py-1.5 pl-2 pr-6 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="TVA" value={editing.tva} onChange={(e) => setEditing({ ...editing, tva: e.target.value })} />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: colors.inkSoft }}>%</span>
            </div>
          </div>
          <button onClick={save} className="mt-3 rounded-lg px-4 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink }}>Enregistrer</button>
        </div>
      )}

      <div className="mb-4 flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
        <Search size={15} style={{ color: colors.inkSoft }} />
        <input className="df-input bg-transparent text-sm outline-none" placeholder="Rechercher une prestation..." value={search} onChange={(e) => setSearch(e.target.value)} />
        {saving && <Loader2 size={13} className="animate-spin" style={{ color: colors.inkSoft }} />}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center" style={{ background: colors.surface, border: `1px dashed ${colors.line}` }}>
          <Library size={28} style={{ color: colors.inkSoft }} />
          <p className="df-display mt-3 text-lg font-semibold">Aucune prestation enregistrée</p>
          <p className="mt-1 text-sm" style={{ color: colors.inkSoft }}>Ajoute une prestation ici, ou depuis une ligne d'un devis avec l'icône signet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          {filtered.map((p, idx) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderTop: idx ? `1px solid ${colors.line}` : "none" }}>
              <div className="min-w-0 grow basis-56 truncate text-sm font-medium">{p.designation}</div>
              <div className="w-24 shrink-0 text-xs" style={{ color: colors.inkSoft }}>{p.category || "—"}</div>
              <div className="w-20 shrink-0 text-xs" style={{ color: colors.inkSoft }}>{p.unit}</div>
              <div className="df-mono w-24 shrink-0 text-right text-sm font-medium">{eur(Number(p.unitPrice) || 0)}</div>
              <div className="df-mono w-16 shrink-0 text-right text-xs" style={{ color: colors.inkSoft }}>{p.tva}%</div>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => startEdit(p)} style={{ color: colors.slate }}><Pencil size={15} /></button>
                <button onClick={() => onDelete(p.id)} style={{ color: colors.brick }}><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const ROLE_LABELS = { owner: "Propriétaire", editor: "Éditeur", viewer: "Lecteur" };
const ROLE_COLORS = { owner: colors.brassDark, editor: colors.moss, viewer: colors.slate };

function AccountView({ account }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);

  async function savePassword() {
    setPasswordError("");
    setPasswordSaved(false);
    if (!currentPassword) { setPasswordError("Renseigne ton mot de passe actuel."); return; }
    if (newPassword.length < 6) { setPasswordError("Le nouveau mot de passe doit faire au moins 6 caractères."); return; }
    if (newPassword !== confirmPassword) { setPasswordError("Les deux saisies du nouveau mot de passe ne correspondent pas."); return; }

    setSavingPassword(true);
    // Vérifie le mot de passe actuel avant tout changement, en tentant
    // une reconnexion avec — c'est le seul moyen de le confirmer côté
    // client sans exposer de logique de vérification séparée.
    const { error: checkError } = await db.auth.signInWithPassword({ email: account.email, password: currentPassword });
    if (checkError) { setPasswordError("Mot de passe actuel incorrect."); setSavingPassword(false); return; }

    const { error } = await db.auth.updateUser({ password: newPassword });
    if (error) setPasswordError(error.message);
    else { setPasswordSaved(true); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); }
    setSavingPassword(false);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="df-display text-2xl font-semibold">Mon compte</h1>
        <p className="text-sm" style={{ color: colors.inkSoft }}>Tes informations personnelles, saisies à l'inscription.</p>
      </div>

      <div className="mb-6 rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
        <span className="df-display mb-3 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Informations personnelles</span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs" style={{ color: colors.inkSoft }}>
            Prénom
            <input disabled className="df-input mt-1 block w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, background: colors.paper, color: colors.inkSoft }} value={account?.firstName || "—"} />
          </label>
          <label className="text-xs" style={{ color: colors.inkSoft }}>
            Nom
            <input disabled className="df-input mt-1 block w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, background: colors.paper, color: colors.inkSoft }} value={account?.lastName || "—"} />
          </label>
        </div>
        <label className="mt-3 block text-xs" style={{ color: colors.inkSoft }}>
          Email
          <input disabled className="df-input mt-1 block w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, background: colors.paper, color: colors.inkSoft }} value={account?.email || ""} />
        </label>
        <p className="mt-3 text-xs" style={{ color: colors.inkSoft }}>Ces informations ne sont pas modifiables ici. Contacte le support si besoin de les corriger.</p>
      </div>

      <div className="rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
        <span className="df-display mb-3 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Changer de mot de passe</span>

        <label className="mb-1 block text-xs" style={{ color: colors.inkSoft }}>Mot de passe actuel</label>
        <input
          type="password"
          autoComplete="current-password"
          className="df-input mb-3 block w-full max-w-xs rounded-md px-3 py-2 text-sm"
          style={{ border: `1px solid ${colors.line}` }}
          value={currentPassword}
          onChange={(e) => { setCurrentPassword(e.target.value); setPasswordSaved(false); }}
          placeholder="••••••••"
        />

        <label className="mb-1 block text-xs" style={{ color: colors.inkSoft }}>Nouveau mot de passe</label>
        <div className="relative mb-3 max-w-xs">
          <input
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            className="df-input w-full rounded-md py-2 pl-3 pr-10 text-sm"
            style={{ border: `1px solid ${colors.line}` }}
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); setPasswordSaved(false); }}
            placeholder="••••••••"
          />
          <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute inset-y-0 right-0 flex w-9 items-center justify-center" style={{ color: colors.inkSoft }} title={showPassword ? "Masquer" : "Afficher"}>
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        <label className="mb-1 block text-xs" style={{ color: colors.inkSoft }}>Confirme le nouveau mot de passe</label>
        <input
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          className="df-input mb-3 block w-full max-w-xs rounded-md px-3 py-2 text-sm"
          style={{ border: `1px solid ${colors.line}` }}
          value={confirmPassword}
          onChange={(e) => { setConfirmPassword(e.target.value); setPasswordSaved(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") savePassword(); }}
          placeholder="••••••••"
        />

        {passwordError && <p className="mb-2 text-xs" style={{ color: colors.brick }}>{passwordError}</p>}
        {passwordSaved && <p className="mb-2 text-xs" style={{ color: colors.moss }}>Mot de passe mis à jour.</p>}
        <button onClick={savePassword} disabled={savingPassword} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium" style={{ background: colors.ink, color: "white", opacity: savingPassword ? 0.7 : 1 }}>
          {savingPassword ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Mettre à jour le mot de passe
        </button>
      </div>
    </div>
  );
}

function TeamView({ account }) {
  const [members, setMembers] = useState(null);
  const [membersError, setMembersError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const isOwner = account?.role === "owner";

  async function loadMembers() {
    if (!account?.organizationId) { setMembers([]); return; }
    const { data, error: loadError } = await db
      .from("organization_members")
      .select("id, user_id, role, status, profiles:user_id ( email, company_name )")
      .eq("organization_id", account.organizationId)
      .order("created_at", { ascending: true });
    if (loadError) {
      console.error("Erreur de chargement de l'équipe", loadError);
      setMembersError("Impossible de charger la liste des membres. Réessaie dans un instant.");
      setMembers([]);
      return;
    }
    setMembersError("");
    setMembers(data || []);
  }

  useEffect(() => { loadMembers(); }, [account?.organizationId]);

  async function handleInvite() {
    setError(""); setInfo("");
    const cleanEmail = inviteEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) { setError("Email invalide."); return; }
    setInviting(true);
    try {
      const { data: { session } } = await db.auth.getSession();
      const { data, error: fnError } = await db.functions.invoke("invite-member", {
        body: { email: cleanEmail, role: inviteRole, organizationId: account.organizationId },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (fnError || data?.error) {
        // Le SDK masque le vrai message derrière une erreur générique en
        // cas de statut non-2xx — on va le chercher dans la réponse brute.
        let realMessage = data?.error;
        if (!realMessage && fnError?.context) {
          try { realMessage = (await fnError.context.json())?.error; } catch { /* pas de corps JSON lisible */ }
        }
        setError(realMessage || fnError?.message || "Impossible d'envoyer l'invitation.");
      } else {
        setInfo(`${cleanEmail} a été ajouté à l'équipe.`);
        setInviteEmail("");
        await loadMembers();
      }
    } catch (err) {
      console.error(err);
      setError("Une erreur est survenue. Réessaie.");
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(memberId, newRole) {
    const { error: updateError } = await db.from("organization_members").update({ role: newRole }).eq("id", memberId);
    if (updateError) { console.error("Erreur de changement de rôle", updateError); return; }
    await loadMembers();
  }

  async function removeMember(memberId) {
    const { error: deleteError } = await db.from("organization_members").delete().eq("id", memberId);
    if (deleteError) { console.error("Erreur de suppression du membre", deleteError); return; }
    await loadMembers();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="df-display text-2xl font-semibold">Équipe</h1>
        <p className="text-sm" style={{ color: colors.inkSoft }}>
          {isOwner
            ? "Invite des collègues à partager tes devis, clients et prestations — avec le niveau d'accès de ton choix."
            : "Les membres de ton organisation. Seul le propriétaire peut inviter ou modifier les rôles."}
        </p>
      </div>

      {isOwner && (
        <div className="mb-6 rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          <span className="df-display mb-3 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Inviter un membre</span>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grow basis-48 text-xs" style={{ color: colors.inkSoft }}>
              Email
              <input type="text" className="df-input mt-1 block w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="collegue@entreprise.fr" onKeyDown={(e) => { if (e.key === "Enter") handleInvite(); }} />
            </label>
            <label className="text-xs" style={{ color: colors.inkSoft }}>
              Rôle
              <select className="df-select mt-1 block rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                <option value="editor">Éditeur</option>
                <option value="viewer">Lecteur</option>
                <option value="owner">Propriétaire</option>
              </select>
            </label>
            <button onClick={handleInvite} disabled={inviting} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink, opacity: inviting ? 0.7 : 1 }}>
              {inviting ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Inviter
            </button>
          </div>
          {error && <p className="mt-2 text-xs" style={{ color: colors.brick }}>{error}</p>}
          {info && <p className="mt-2 text-xs" style={{ color: colors.moss }}>{info}</p>}
          <p className="mt-3 text-xs" style={{ color: colors.inkSoft }}>
            <strong>Éditeur</strong> : peut créer et modifier devis, clients, prestations. <strong>Lecteur</strong> : consultation uniquement. Si la personne n'a pas encore de compte, elle reçoit un email pour en créer un.
          </p>
        </div>
      )}

      {members === null ? (
        <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin" style={{ color: colors.inkSoft }} /></div>
      ) : membersError ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl px-6 py-10 text-center" style={{ background: colors.surface, border: `1px dashed ${colors.brick}` }}>
          <p className="text-sm" style={{ color: colors.brick }}>{membersError}</p>
          <button onClick={loadMembers} className="text-xs font-medium underline" style={{ color: colors.brassDark }}>Réessayer</button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          {members.map((m, idx) => (
            <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderTop: idx ? `1px solid ${colors.line}` : "none" }}>
              <div className="min-w-0 grow basis-40">
                <div className="truncate text-sm font-medium">{m.profiles?.email || "—"}</div>
                {m.user_id === account?.id && <span className="text-xs" style={{ color: colors.inkSoft }}>C'est toi</span>}
              </div>
              {isOwner && m.user_id !== account?.id ? (
                <select className="df-select rounded-md px-2 py-1 text-xs" style={{ border: `1px solid ${colors.line}` }} value={m.role} onChange={(e) => changeRole(m.id, e.target.value)}>
                  <option value="owner">Propriétaire</option>
                  <option value="editor">Éditeur</option>
                  <option value="viewer">Lecteur</option>
                </select>
              ) : (
                <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${ROLE_COLORS[m.role]}18`, color: ROLE_COLORS[m.role] }}>{ROLE_LABELS[m.role]}</span>
              )}
              {isOwner && m.user_id !== account?.id && (
                <button onClick={() => removeMember(m.id)} title="Retirer de l'équipe" style={{ color: colors.brick }}><Trash2 size={15} /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyView({ profile, saving, onSave, onReset, documentCount, clientCount, account, isLocked, isViewer, onGoToPricing }) {
  const [local, setLocal] = useState(profile);
  const [editing, setEditing] = useState(!profile.name);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => setLocal(profile), []);

  function patch(p) {
    setLocal((prev) => ({ ...prev, ...p }));
  }
  function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => patch({ logo: reader.result });
    reader.readAsDataURL(file);
  }
  function handleSave() {
    onSave(local);
    setEditing(false);
  }
  function startEdit() {
    if (isLocked) return;
    setLocal(profile);
    setEditing(true);
  }
  function cancelEdit() {
    setLocal(profile);
    setEditing(false);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="df-display text-2xl font-semibold">{(editing ? local.type : profile.type) === "particulier" ? "Mes informations" : "Mon entreprise"}</h1>
          <p className="text-sm" style={{ color: colors.inkSoft }}>Ces informations pré-remplissent automatiquement chaque nouveau devis ou facture.</p>
        </div>
        {saving && <span className="flex items-center gap-1 text-xs" style={{ color: colors.inkSoft }}><Loader2 size={12} className="animate-spin" /> Enregistrement</span>}
      </div>

      {isLocked && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4" style={{ background: `${colors.brick}12`, border: `1px solid ${colors.brick}40` }}>
          <span className="flex items-center gap-2 text-sm font-medium" style={{ color: colors.brick }}>
            <Lock size={15} /> {isViewer ? "Accès en lecture seule — ces informations ne sont pas modifiables." : "Limite du forfait Gratuit atteinte — ces informations ne sont plus modifiables."}
          </span>
          {!isViewer && <button onClick={onGoToPricing} className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white" style={{ background: colors.brick }}>Passer à un forfait payant</button>}
        </div>
      )}

      {!editing ? (
        <div className="rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full" style={{ background: colors.brass, color: "white" }}>
                {profile.logo ? <img src={profile.logo} alt="Logo" className="h-full w-full object-cover" /> : <span className="df-display text-base font-semibold">{initials(profile.name) || "?"}</span>}
              </div>
              <div>
                <div className="text-sm font-semibold">{profile.name || "Non renseigné"}</div>
                <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${colors.slate}18`, color: colors.slate }}>{profile.type === "particulier" ? "Particulier" : "Entreprise"}</span>
              </div>
            </div>
            <button onClick={startEdit} disabled={isLocked} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-white" style={{ background: isLocked ? colors.line : colors.ink, color: isLocked ? colors.inkSoft : "white", cursor: isLocked ? "not-allowed" : "pointer" }}>
              {isLocked ? <Lock size={13} /> : <Pencil size={13} />} Modifier
            </button>
          </div>
          <dl className="space-y-1.5 text-sm">
            {profile.address && <div className="flex gap-2"><dt className="w-24 shrink-0" style={{ color: colors.inkSoft }}>Adresse</dt><dd>{profile.address}</dd></div>}
            {profile.country && <div className="flex gap-2"><dt className="w-24 shrink-0" style={{ color: colors.inkSoft }}>Pays</dt><dd>{profile.country}</dd></div>}
            {profile.email && <div className="flex gap-2"><dt className="w-24 shrink-0" style={{ color: colors.inkSoft }}>Email</dt><dd>{profile.email}</dd></div>}
            {profile.phone && <div className="flex gap-2"><dt className="w-24 shrink-0" style={{ color: colors.inkSoft }}>Téléphone</dt><dd>{profile.phone}</dd></div>}
            {profile.type !== "particulier" && profile.siret && <div className="flex gap-2"><dt className="w-24 shrink-0" style={{ color: colors.inkSoft }}>SIRET</dt><dd>{profile.siret}</dd></div>}
            {profile.type !== "particulier" && profile.tva && <div className="flex gap-2"><dt className="w-24 shrink-0" style={{ color: colors.inkSoft }}>N° TVA</dt><dd>{profile.tva}</dd></div>}
            {!profile.address && !profile.email && !profile.phone && <p className="text-xs" style={{ color: colors.inkSoft }}>Aucune information renseignée pour le moment.</p>}
          </dl>
        </div>
      ) : (
        <div className="space-y-3 rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Type</label>
            <select className="df-select w-full max-w-xs rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={local.type || "entreprise"} onChange={(e) => patch({ type: e.target.value })}>
              <option value="entreprise">Entreprise</option>
              <option value="particulier">Particulier</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full" style={{ background: colors.brass, color: "white" }}>
              {local.logo ? <img src={local.logo} alt="Logo" className="h-full w-full object-cover" /> : <span className="df-display text-base font-semibold">{initials(local.name) || "?"}</span>}
            </div>
            <div>
              <label className="block text-xs font-medium" style={{ color: colors.inkSoft }}>Logo (optionnel)</label>
              <input type="file" accept="image/*" onChange={handleLogoUpload} className="text-xs" />
              {local.logo && <button onClick={() => patch({ logo: null })} className="mt-1 text-xs" style={{ color: colors.brick }}>Retirer le logo</button>}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>{local.type === "particulier" ? "Nom et prénom" : "Raison sociale"}</label>
            <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={local.name} onChange={(e) => patch({ name: e.target.value })} />
          </div>
          {local.type !== "particulier" && (
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>SIRET</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={local.siret} onChange={(e) => patch({ siret: e.target.value })} />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Adresse</label>
            <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={local.address} onChange={(e) => patch({ address: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Pays</label>
            <select className="df-select w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={local.country || ""} onChange={(e) => patch({ country: e.target.value })}>
              <option value="">— Non précisé —</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Email</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={local.email} onChange={(e) => patch({ email: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Téléphone</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={local.phone} onChange={(e) => patch({ phone: e.target.value })} />
            </div>
          </div>
          {local.type !== "particulier" && (
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>N° TVA intracommunautaire (optionnel)</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={local.tva} onChange={(e) => patch({ tva: e.target.value })} />
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button onClick={handleSave} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink }}>
              <Check size={14} /> Enregistrer
            </button>
            {profile.name && (
              <button onClick={cancelEdit} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ border: `1px solid ${colors.line}`, color: colors.inkSoft }}>Annuler</button>
            )}
          </div>
        </div>
      )}

      <div className="mt-8 rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.brick}40` }}>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: colors.brick }}>
          <AlertTriangle size={15} /> Zone de test
        </div>
        <p className="mb-4 text-xs" style={{ color: colors.inkSoft }}>
          Tu as actuellement <strong>{documentCount} devis/factures</strong> et <strong>{clientCount} clients</strong> enregistrés (accumulés pendant les tests). Cette action supprime tous les devis, factures, clients et prestations pour repartir de zéro — ton compte et tes infos d'entreprise sont conservés.
        </p>
        {!confirmReset ? (
          <button onClick={() => !isLocked && setConfirmReset(true)} disabled={isLocked} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium" style={{ border: `1px solid ${isLocked ? colors.line : colors.brick}`, color: isLocked ? colors.inkSoft : colors.brick, cursor: isLocked ? "not-allowed" : "pointer" }}>
            <RotateCcw size={13} /> Réinitialiser les données de test
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium" style={{ color: colors.brick }}>Confirmer la suppression de toutes les données ?</span>
            <button onClick={() => { onReset(); setConfirmReset(false); }} className="rounded-lg px-3 py-1.5 text-xs font-medium text-white" style={{ background: colors.brick }}>Oui, tout effacer</button>
            <button onClick={() => setConfirmReset(false)} className="rounded-lg px-3 py-1.5 text-xs font-medium" style={{ border: `1px solid ${colors.line}`, color: colors.inkSoft }}>Annuler</button>
          </div>
        )}
      </div>
    </div>
  );
}

function PayPalButton({ planId, organizationId, onApproved }) {
  const containerRef = useRef(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState(false);

  useEffect(() => {
    const clientId = import.meta.env.VITE_PAYPAL_CLIENT_ID;
    if (!clientId) { setSdkError(true); return; }
    if (window.paypal) { setSdkReady(true); return; }
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&vault=true&intent=subscription`;
    script.onload = () => setSdkReady(true);
    script.onerror = () => setSdkError(true);
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    if (!sdkReady || !containerRef.current || !window.paypal) return;
    containerRef.current.innerHTML = "";
    window.paypal.Buttons({
      style: { shape: "pill", color: "gold", layout: "horizontal", label: "subscribe", height: 40 },
      createSubscription: (data, actions) => actions.subscription.create({ plan_id: planId, custom_id: organizationId }),
      onApprove: () => onApproved && onApproved(),
    }).render(containerRef.current);
  }, [sdkReady, planId, organizationId]);

  if (sdkError) return <p className="text-xs" style={{ color: colors.brick }}>Configuration PayPal manquante côté site (VITE_PAYPAL_CLIENT_ID).</p>;
  return <div ref={containerRef} />;
}

function PricingView({ account, plans, onChooseFree, onChooseZeroPrice, limitNotice, documentCount }) {
  const [billing, setBilling] = useState(account?.billing || "mensuel");
  const [approvedMsg, setApprovedMsg] = useState(false);
  const visiblePlans = plans.filter((p) => !p.hidden);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 text-center">
        <h1 className="df-display text-2xl font-semibold">Choisir un forfait</h1>
        <p className="mt-1 text-sm" style={{ color: colors.inkSoft }}>Tarifs indicatifs — à affiner selon l'étude de la concurrence.</p>
      </div>

      {limitNotice && (
        <div className="mx-auto mb-6 max-w-lg rounded-xl p-3 text-center text-sm" style={{ background: `${colors.brick}15`, color: colors.brick, border: `1px solid ${colors.brick}40` }}>
          Le forfait Gratuit est limité à {plans.find((p) => p.id === "gratuit")?.limit ?? 3} devis/factures ({documentCount} déjà créés). Passe à un forfait payant pour continuer.
        </div>
      )}
      {approvedMsg && (
        <div className="mx-auto mb-6 max-w-lg rounded-xl p-3 text-center text-sm" style={{ background: `${colors.moss}15`, color: colors.moss, border: `1px solid ${colors.moss}40` }}>
          Merci ! Ton paiement PayPal a été approuvé. L'activation du forfait peut prendre une minute ou deux (elle est confirmée par PayPal à notre serveur) — recharge la page dans un instant.
        </div>
      )}

      <div className="mb-8 flex justify-center">
        <div className="flex gap-1 rounded-lg p-1" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          <button onClick={() => setBilling("mensuel")} className="rounded-md px-4 py-1.5 text-sm font-medium" style={{ background: billing === "mensuel" ? colors.ink : "transparent", color: billing === "mensuel" ? "white" : colors.inkSoft }}>Mensuel</button>
          <button onClick={() => setBilling("annuel")} className="flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium" style={{ background: billing === "annuel" ? colors.ink : "transparent", color: billing === "annuel" ? "white" : colors.inkSoft }}>
            Annuel <span className="rounded-full px-1.5 py-0.5 text-xs" style={{ background: colors.moss, color: "white" }}>-20%</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {visiblePlans.map((plan) => {
          const isCurrent = account?.plan === plan.id;
          const price = billing === "annuel" ? plan.annual : plan.monthly;
          const paypalPlanId = billing === "annuel" ? plan.paypalPlanIdAnnual : plan.paypalPlanIdMonthly;
          return (
            <div key={plan.id} className="flex flex-col overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${plan.id === "essentiel" ? colors.brass : colors.line}`, boxShadow: plan.id === "essentiel" ? `0 0 0 2px ${colors.brass}30` : "none" }}>
              <div style={{ height: "6px", background: planAccentColor(plan.id) }} />
              <div className="flex grow flex-col p-5">
              {plan.id === "essentiel" && (
                <div className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide" style={{ color: colors.brassDark }}><Sparkles size={12} /> Le plus choisi</div>
              )}
              <div className="df-display text-lg font-bold" style={{ color: planAccentColor(plan.id) }}>{plan.name}</div>
              <div className="text-xs" style={{ color: colors.inkSoft }}>{plan.tagline}</div>
              <div className="df-mono mt-4 mb-4">
                {price === null ? (
                  <span className="text-2xl font-semibold">Sur devis</span>
                ) : (
                  <>
                    <span className="text-3xl font-extrabold">{price === 0 ? "0€" : `${billing === "annuel" ? Math.round(price / 12) : price}€`}</span>
                    <span className="text-sm" style={{ color: colors.inkSoft }}>/mois</span>
                  </>
                )}
              </div>
              <ul className="mb-5 grow space-y-2 text-sm">
                {plan.features.map((f) => <PlanFeatureItem key={f} text={f} accentColor={planAccentColor(plan.id)} />)}
              </ul>

              {isCurrent ? (
                <button disabled className="rounded-lg py-2 text-sm font-medium" style={{ background: colors.paper, color: colors.inkSoft }}>Forfait actuel</button>
              ) : plan.id === "gratuit" ? (
                <button onClick={onChooseFree} className="rounded-lg py-2 text-sm font-medium" style={{ background: colors.ink, color: "white" }}>Choisir ce forfait</button>
              ) : plan.id === "entreprise" ? (
                <a href="mailto:contact@devifact.fr?subject=Forfait%20Entreprise" className="rounded-lg py-2 text-center text-sm font-medium" style={{ background: colors.ink, color: "white" }}>Nous contacter</a>
              ) : price === 0 ? (
                <button onClick={() => onChooseZeroPrice(plan.id, billing)} className="rounded-lg py-2 text-sm font-medium" style={{ background: colors.ink, color: "white" }}>Activer (0€)</button>
              ) : paypalPlanId ? (
                <PayPalButton planId={paypalPlanId} organizationId={account?.organizationId} onApproved={() => setApprovedMsg(true)} />
              ) : (
                <p className="rounded-lg py-2 text-center text-xs" style={{ background: colors.paper, color: colors.inkSoft }}>Paiement bientôt disponible</p>
              )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PriceInput({ label, value, onSave }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);

  function commit() {
    if (Number(draft) !== Number(value)) onSave(draft);
  }

  return (
    <label className="text-xs" style={{ color: colors.inkSoft }}>
      {label}
      <input
        type="number"
        className="df-input df-mono mt-0.5 block w-20 rounded-md px-2 py-1 text-sm"
        style={{ border: `1px solid ${colors.line}` }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { commit(); e.target.blur(); } }}
      />
    </label>
  );
}

function PaypalIdField({ label, value, onSave }) {
  const [editing, setEditing] = useState(!value);
  const [draft, setDraft] = useState(value || "");

  useEffect(() => {
    // Si une valeur enregistrée apparaît (ou change) et qu'on n'est pas
    // en train de la modifier, on repasse en mode "badge configuré".
    if (value) setEditing(false);
  }, [value]);

  if (!editing && value) {
    return (
      <div className="text-xs" style={{ color: colors.inkSoft }}>
        <div className="mb-0.5">{label}</div>
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 rounded-md px-2 py-1" style={{ background: `${colors.moss}15`, color: colors.moss }}>
            <Check size={11} /> Configuré
          </span>
          <button onClick={() => { setDraft(value); setEditing(true); }} className="underline" style={{ color: colors.slate }}>Modifier</button>
        </div>
      </div>
    );
  }
  return (
    <label className="text-xs" style={{ color: colors.inkSoft }}>
      {label}
      <div className="mt-0.5 flex items-center gap-1">
        <input type="text" placeholder="P-XXXXXXXX" className="df-input block w-32 rounded-md px-2 py-1 text-xs" style={{ border: `1px solid ${colors.line}` }} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button onClick={() => { onSave(draft); setEditing(false); }} title="Enregistrer" className="rounded-md px-1.5 py-1 text-xs font-medium text-white" style={{ background: colors.slate }}>
          <Check size={12} />
        </button>
      </div>
    </label>
  );
}

function SiteIdentitySettings({ siteSettings, saving, onSave }) {
  const [local, setLocal] = useState(siteSettings);

  useEffect(() => { setLocal(siteSettings); }, []);

  function patch(p) {
    setLocal((prev) => ({ ...prev, ...p }));
  }
  function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => patch({ logo: reader.result });
    reader.readAsDataURL(file);
  }
  function handleSave() {
    onSave(local);
  }

  return (
    <div className="mb-6 overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: colors.line }}>
        <span className="df-display text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Identité du site</span>
        {saving && <span className="flex items-center gap-1 text-xs" style={{ color: colors.inkSoft }}><Loader2 size={13} className="animate-spin" /> Enregistrement</span>}
      </div>
      <p className="border-b px-4 py-2 text-xs" style={{ borderColor: colors.line, color: colors.inkSoft }}>
        Change le nom, le logo et les couleurs des PDF générés (fond, en-tête de tableau, blocs émetteur/client). N'oublie pas de cliquer "Enregistrer" en bas pour valider tes changements.
      </p>
      <div className="space-y-4 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Nom du site</label>
          <input className="df-input w-full max-w-xs rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={local.name} onChange={(e) => patch({ name: e.target.value })} />
        </div>
        <div>
          <label className="mb-2 block text-xs font-medium" style={{ color: colors.inkSoft }}>Logo du site</label>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center justify-center overflow-hidden rounded-lg" style={{ width: local.logoWidth, height: local.logoHeight, background: local.logo ? "transparent" : colors.brass, color: "white" }}>
              {local.logo ? <img src={local.logo} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span className="df-mono text-sm font-semibold">{initials(local.name) || "DF"}</span>}
            </div>
            <div>
              <input type="file" accept="image/*" onChange={handleLogoUpload} className="text-xs" />
              {local.logo && (
                <button onClick={() => patch({ logo: null })} className="mt-1 flex items-center gap-1 text-xs" style={{ color: colors.brick }}>
                  <RotateCcw size={12} /> Réinitialiser au logo par défaut (initiales)
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="text-xs" style={{ color: colors.inkSoft }}>
            Largeur (px)
            <input type="number" min="16" max="200" className="df-input df-mono mt-0.5 block w-24 rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} value={local.logoWidth} onChange={(e) => patch({ logoWidth: Number(e.target.value) || 36 })} />
          </label>
          <label className="text-xs" style={{ color: colors.inkSoft }}>
            Hauteur (px)
            <input type="number" min="16" max="200" className="df-input df-mono mt-0.5 block w-24 rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} value={local.logoHeight} onChange={(e) => patch({ logoHeight: Number(e.target.value) || 36 })} />
          </label>
        </div>
        <div className="border-t pt-4" style={{ borderColor: colors.line }}>
          <label className="mb-2 block text-xs font-medium" style={{ color: colors.inkSoft }}>Couleurs des PDF (devis, factures, proforma)</label>
          <div className="flex flex-wrap gap-4">
            <label className="text-xs" style={{ color: colors.inkSoft }}>
              Fond de page
              <div className="mt-1 flex items-center gap-2">
                <input type="color" className="h-9 w-9 cursor-pointer rounded" style={{ border: `1px solid ${colors.line}` }} value={local.pdfBackground} onChange={(e) => patch({ pdfBackground: e.target.value })} />
                <span className="df-mono text-xs">{local.pdfBackground}</span>
              </div>
            </label>
            <label className="text-xs" style={{ color: colors.inkSoft }}>
              En-tête de tableau
              <div className="mt-1 flex items-center gap-2">
                <input type="color" className="h-9 w-9 cursor-pointer rounded" style={{ border: `1px solid ${colors.line}` }} value={local.pdfHeaderColor} onChange={(e) => patch({ pdfHeaderColor: e.target.value })} />
                <span className="df-mono text-xs">{local.pdfHeaderColor}</span>
              </div>
            </label>
            <label className="text-xs" style={{ color: colors.inkSoft }}>
              Blocs émetteur / client
              <div className="mt-1 flex items-center gap-2">
                <input type="color" className="h-9 w-9 cursor-pointer rounded" style={{ border: `1px solid ${colors.line}` }} value={local.pdfBlockColor} onChange={(e) => patch({ pdfBlockColor: e.target.value })} />
                <span className="df-mono text-xs">{local.pdfBlockColor}</span>
              </div>
            </label>
          </div>
        </div>
        <button onClick={handleSave} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink }}>
          <Check size={14} /> Enregistrer
        </button>
      </div>
    </div>
  );
}

function AdminView({ account, documents, clients, companyProfile, plans, savingPlanSettings, onTogglePlan, onToggleWatermark, onUpdatePlanPrice, onUpdatePlanLimit, onUpdatePlanPaypalId, onTogglePayment, onDeleteAccount, siteSettings, savingSiteSettings, onUpdateSiteSettings }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState("apercu");
  const totalTTC = documents.reduce((s, d) => s + computeTotals(d).totalTTC, 0);
  const paid = account?.paymentStatus === "payé";

  const TABS = [
    { id: "apercu", label: "Vue d'ensemble", icon: LayoutDashboard },
    { id: "identite", label: "Identité du site", icon: Building2 },
    { id: "forfaits", label: "Forfaits & tarifs", icon: CreditCard },
    { id: "paiement", label: "Paiement (PayPal)", icon: KeyRound },
    { id: "compte", label: "Mon compte", icon: Users },
    { id: "danger", label: "Zone dangereuse", icon: AlertTriangle },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="df-display flex items-center gap-2 text-2xl font-semibold"><Shield size={22} style={{ color: colors.brassDark }} /> Espace Admin</h1>
        <p className="text-sm" style={{ color: colors.inkSoft }}>Vue d'ensemble, gestion des forfaits et du compte.</p>
      </div>

      <div className="mb-6 flex w-full items-center gap-1 overflow-x-auto rounded-xl p-1" style={{ background: colors.surface, border: `1px solid ${colors.line}`, WebkitOverflowScrolling: "touch" }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium" style={{ background: tab === id ? colors.ink : "transparent", color: tab === id ? "white" : colors.inkSoft }}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {tab === "apercu" && (
        <>
          <div className="mb-6 rounded-2xl p-4" style={{ background: `${colors.moss}0D`, border: `1px solid ${colors.moss}40` }}>
            <div className="flex items-start gap-2">
              <Check size={16} style={{ color: colors.moss, marginTop: "2px", flexShrink: 0 }} />
              <p className="text-xs" style={{ color: colors.moss }}>
                Cet espace est connecté à une vraie base de données. Ton statut administrateur est vérifié côté serveur (RLS) — il ne peut pas être falsifié depuis le navigateur. La liste ci-dessous ne montre encore que <strong>tes propres statistiques</strong> ; une vraie table listant tous les comptes réels peut être ajoutée facilement une fois que tu as de premiers utilisateurs (voir le Dossier de passation technique).
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Ton compte" value={account ? 1 : 0} sub={account?.email || "—"} color={colors.slate} />
            <StatCard label="Documents créés" value={documents.length} sub={eur(totalTTC) + " au total"} color={colors.moss} />
            <StatCard label="Clients enregistrés" value={clients.length} sub={companyProfile.name || "Entreprise non renseignée"} color={colors.brassDark} />
          </div>
        </>
      )}

      {tab === "identite" && (
        <SiteIdentitySettings siteSettings={siteSettings} saving={savingSiteSettings} onSave={onUpdateSiteSettings} />
      )}

      {tab === "compte" && (
        <div className="overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          <div className="border-b px-4 py-3" style={{ borderColor: colors.line }}>
            <span className="df-display text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Compte utilisateur</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="flex items-center gap-2" style={{ color: colors.slate }}><Users size={16} /></div>
            <div className="min-w-0 grow basis-40 truncate text-sm font-medium">{account?.email || "—"}</div>
            <div className="text-sm" style={{ color: colors.inkSoft }}>{account?.companyName || companyProfile.name || "—"}</div>
            <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${colors.brass}22`, color: colors.brassDark }}>{planLabel(account?.plan)}</span>
            {account?.isAdmin && <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${colors.moss}22`, color: colors.moss }}>Admin</span>}
            {account?.plan !== "gratuit" && (
              <button onClick={onTogglePayment} className="ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: paid ? `${colors.moss}18` : `${colors.brick}18`, color: paid ? colors.moss : colors.brick }} title="Forcer le statut (usage exceptionnel — normalement mis à jour par le webhook PayPal)">
                  {paid ? <Check size={12} /> : <AlertTriangle size={12} />} {paid ? "Payé" : "Impayé"}
                </button>
            )}
          </div>
          <p className="border-t px-4 py-2 text-xs" style={{ borderColor: colors.line, color: colors.inkSoft }}>
            En production, ce statut doit être mis à jour automatiquement par la fonction de webhook PayPal (voir <code>functions/paypal-webhook</code>), pas manuellement.
          </p>
        </div>
      )}

      {tab === "forfaits" && (
        <div className="overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: colors.line }}>
            <span className="df-display text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Forfaits & tarifs</span>
            {savingPlanSettings && <Loader2 size={13} className="animate-spin" style={{ color: colors.inkSoft }} />}
          </div>
          <p className="border-b px-4 py-2 text-xs" style={{ borderColor: colors.line, color: colors.inkSoft }}>
            Prix affiché, visibilité publique, filigrane, et nombre de documents autorisés avant blocage du compte. Laisse le nombre de documents vide pour "illimité".
          </p>
          <div className="flex items-start gap-2 border-b px-4 py-2.5" style={{ borderColor: colors.line, background: `${colors.brick}0D` }}>
            <AlertTriangle size={13} style={{ color: colors.brick, marginTop: "2px", flexShrink: 0 }} />
            <p className="text-xs" style={{ color: colors.brick }}>
              Si tu réduis le nombre de documents d'un forfait en dessous de ce qu'un compte a déjà créé, ce compte se verrouille automatiquement (fonctionnalités bloquées) sans perdre ses documents existants — il doit passer à un forfait payant pour continuer.
            </p>
          </div>
          {plans.map((plan) => (
            <div key={plan.id} className="flex flex-wrap items-center gap-3 border-b px-4 py-3" style={{ borderColor: colors.line }}>
              <div className="min-w-0 basis-32 grow">
                <div className="text-sm font-medium">{plan.name}</div>
                <div className="text-xs" style={{ color: colors.inkSoft }}>{plan.tagline}</div>
              </div>
              {plan.monthly !== null ? (
                <>
                  <PriceInput label="Mensuel €" value={plan.monthly} onSave={(v) => onUpdatePlanPrice(plan.id, "monthly", v)} />
                  <PriceInput label="Annuel €" value={plan.annual} onSave={(v) => onUpdatePlanPrice(plan.id, "annual", v)} />
                </>
              ) : (
                <span className="text-xs" style={{ color: colors.inkSoft }}>Sur devis</span>
              )}
              <label className="text-xs" style={{ color: colors.inkSoft }}>
                Documents max
                <input
                  type="number" min="0" placeholder="Illimité"
                  className="df-input df-mono mt-0.5 block w-20 rounded-md px-2 py-1 text-sm"
                  style={{ border: `1px solid ${colors.line}` }}
                  defaultValue={plan.limit === Infinity ? "" : plan.limit}
                  key={`${plan.id}-${plan.limit}`}
                  onBlur={(e) => onUpdatePlanLimit(plan.id, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                />
              </label>
              <div className="ml-auto flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium" style={{ color: plan.watermarkEnabled === false ? colors.inkSoft : colors.brassDark }}>Filigrane</span>
                  <button
                    onClick={() => onToggleWatermark(plan.id)}
                    title={plan.watermarkEnabled === false ? "Activer le filigrane pour ce forfait" : "Retirer le filigrane pour ce forfait"}
                    style={{ color: plan.watermarkEnabled === false ? colors.line : colors.brassDark }}
                  >
                    {plan.watermarkEnabled === false ? <ToggleLeft size={22} /> : <ToggleRight size={22} />}
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium" style={{ color: plan.hidden ? colors.brick : colors.moss }}>{plan.hidden ? "Masqué" : "Visible"}</span>
                  <button
                    onClick={() => onTogglePlan(plan.id)}
                    title={plan.hidden ? "Rendre visible" : "Masquer ce forfait"}
                    style={{ color: plan.hidden ? colors.inkSoft : colors.moss }}
                  >
                    {plan.hidden ? <ToggleLeft size={22} /> : <ToggleRight size={22} />}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "paiement" && (
        <div className="overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: colors.line }}>
            <span className="df-display text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Paiement — identifiants PayPal</span>
            {savingPlanSettings && <Loader2 size={13} className="animate-spin" style={{ color: colors.inkSoft }} />}
          </div>
          <p className="border-b px-4 py-2 text-xs" style={{ borderColor: colors.line, color: colors.inkSoft }}>
            Colle ici l'identifiant du plan créé côté PayPal pour chaque forfait — obligatoire pour que le bouton d'abonnement fonctionne. Le prix facturé est celui défini dans PayPal, pas celui de l'onglet "Forfaits & tarifs".
          </p>
          {plans.filter((p) => p.monthly !== null).map((plan) => (
            <div key={plan.id} className="flex flex-wrap items-center gap-4 border-b px-4 py-3" style={{ borderColor: colors.line }}>
              <div className="min-w-0 basis-28 shrink-0 text-sm font-medium">{plan.name}</div>
              <PaypalIdField label="ID forfait PayPal (mensuel)" value={plan.paypalPlanIdMonthly} onSave={(v) => onUpdatePlanPaypalId(plan.id, "monthly", v)} />
              <PaypalIdField label="ID forfait PayPal (annuel)" value={plan.paypalPlanIdAnnual} onSave={(v) => onUpdatePlanPaypalId(plan.id, "annual", v)} />
            </div>
          ))}
        </div>
      )}

      {tab === "danger" && (
        <div className="rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.brick}40` }}>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: colors.brick }}>
            <AlertTriangle size={15} /> Zone dangereuse
          </div>
          <p className="mb-4 text-xs" style={{ color: colors.inkSoft }}>
            Réinitialise tes devis, factures, clients et prestations, et te déconnecte. Pour supprimer complètement le compte d'authentification, va dans le dashboard d'administration de la base de données → Authentication → Users.
          </p>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium" style={{ border: `1px solid ${colors.brick}`, color: colors.brick }}>
              <Trash2 size={13} /> Réinitialiser mon compte
            </button>
          ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium" style={{ color: colors.brick }}>Confirmer la réinitialisation définitive ?</span>
            <button onClick={onDeleteAccount} className="rounded-lg px-3 py-1.5 text-xs font-medium text-white" style={{ background: colors.brick }}>Oui, réinitialiser</button>
            <button onClick={() => setConfirmDelete(false)} className="rounded-lg px-3 py-1.5 text-xs font-medium" style={{ border: `1px solid ${colors.line}`, color: colors.inkSoft }}>Annuler</button>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function planAccentColor(id) {
  if (id === "gratuit") return colors.slate;
  if (id === "essentiel") return colors.brass;
  if (id === "pro") return colors.moss;
  return colors.ink;
}

function PlanFeatureItem({ text, accentColor }) {
  const soon = text.includes("(bientôt disponible)");
  const inherited = text.startsWith("Tout ");
  const clean = text.replace(" (bientôt disponible)", "");

  if (soon) {
    return (
      <li className="flex items-start gap-2" style={{ color: colors.inkSoft, fontStyle: "italic" }}>
        <Loader2 size={14} className="mt-0.5 shrink-0" style={{ color: colors.inkSoft }} />
        <span>{clean} <span className="text-xs font-semibold" style={{ color: colors.brick }}>— bientôt disponible</span></span>
      </li>
    );
  }
  if (inherited) {
    return (
      <li className="flex items-start gap-2" style={{ color: colors.inkSoft }}>
        <Check size={14} className="mt-0.5 shrink-0" style={{ color: colors.inkSoft }} />
        <span>{clean}</span>
      </li>
    );
  }
  // Fonctionnalité propre à ce forfait : mise en avant en gras
  return (
    <li className="flex items-start gap-2">
      <Check size={15} className="mt-0.5 shrink-0" style={{ color: accentColor }} />
      <span className="font-bold" style={{ color: colors.ink }}>{clean}</span>
    </li>
  );
}

function LockedFeature({ onGoToPricing, title, text }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <div className="flex flex-col items-center rounded-2xl p-10 text-center" style={{ background: colors.surface, border: `1px dashed ${colors.line}` }}>
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: colors.paper, color: colors.brassDark }}>
          <Lock size={20} />
        </div>
        <h2 className="df-display mb-1 text-lg font-semibold">{title || "Fonctionnalité réservée aux forfaits Pro et Entreprise"}</h2>
        <p className="mb-5 text-sm" style={{ color: colors.inkSoft }}>{text || "Passe à un forfait supérieur pour y avoir accès."}</p>
        <button onClick={onGoToPricing} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ background: colors.brassDark, color: "white" }}>Voir les forfaits</button>
      </div>
    </div>
  );
}

// Transforme **gras**, __souligné__ et ::couleur:: en éléments stylés.
// Utilisé partout où un texte de devis/facture/proforma est affiché (PDF).
// Retire les marqueurs **/__/:: pour les endroits qui ne peuvent pas
// afficher de mise en forme (export Excel).
function stripMarkup(text) {
  return String(text || "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/::(.+?)::/g, "$1");
}

function renderMarkup(text) {
  if (!text) return text;
  const parts = [];
  let remaining = String(text);
  const regex = /(\*\*(.+?)\*\*|__(.+?)__|::(.+?)::)/;
  let key = 0;
  while (remaining) {
    const m = remaining.match(regex);
    if (!m) { parts.push(remaining); break; }
    if (m.index > 0) parts.push(remaining.slice(0, m.index));
    if (m[2] !== undefined) parts.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3] !== undefined) parts.push(<span key={key++} style={{ textDecoration: "underline" }}>{m[3]}</span>);
    else if (m[4] !== undefined) parts.push(<span key={key++} style={{ color: "#B8763E", fontWeight: 600 }}>{m[4]}</span>);
    remaining = remaining.slice(m.index + m[0].length);
  }
  return parts;
}

// Champ texte avec petite barre Gras/Souligné/Couleur — réservée aux
// forfaits Essentiel et Pro (le forfait Gratuit garde un champ simple).
function FormattableField({ value, onChange, placeholder, className, style, multiline, enabled, onKeyDown, autoFocus, wrapperClassName }) {
  const ref = useRef(null);
  const hasAutoFocused = useRef(false);

  useEffect(() => {
    if (autoFocus && !hasAutoFocused.current && ref.current) {
      hasAutoFocused.current = true; // ne se déclenche plus jamais ensuite, même si la prop reste vraie
      ref.current.focus();
    }
  }, [autoFocus]);

  function wrap(marker) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || "texte";
    const newValue = value.slice(0, start) + marker + selected + marker + value.slice(end);
    onChange(newValue);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + marker.length, start + marker.length + selected.length);
    });
  }

  const fieldProps = {
    ref, value, placeholder, className, style, onKeyDown,
    onChange: (e) => onChange(e.target.value),
  };

  return (
    <div className={wrapperClassName}>
      {enabled && (
        <div className="no-print mb-1 flex gap-1">
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap("**")} className="rounded px-1.5 text-xs font-bold" style={{ border: `1px solid ${colors.line}`, color: colors.inkSoft }} title="Gras">G</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap("__")} className="rounded px-1.5 text-xs underline" style={{ border: `1px solid ${colors.line}`, color: colors.inkSoft }} title="Souligné">S</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap("::")} className="rounded px-1.5 text-xs font-semibold" style={{ border: `1px solid ${colors.line}`, color: colors.brassDark }} title="Couleur">C</button>
        </div>
      )}
      {multiline ? <textarea {...fieldProps} /> : <input {...fieldProps} />}
    </div>
  );
}

function StatCard({ label, value, sub, color }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: colors.inkSoft }}>{label}</div>
      <div className="df-display mt-1 text-2xl font-semibold" style={{ color }}>{value}</div>
      <div className="df-mono mt-0.5 text-xs" style={{ color: colors.inkSoft }}>{sub}</div>
    </div>
  );
}

function Editor({ doc, saving, clients, prestations, account, plans, siteSettings, isLocked, isViewer, onChange, onBack, onConvert, onSaveClient, onSavePrestation, onSplit, splitNotice, onOpenSplitDoc, onDismissSplitNotice, onGoToPricing }) {
  const [localDoc, setLocalDoc] = useState(doc);
  const [clientQuery, setClientQuery] = useState("");
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [selectedLineIds, setSelectedLineIds] = useState([]);
  const [openDetailsFor, setOpenDetailsFor] = useState([]);
  const [lastAddedDetailId, setLastAddedDetailId] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDescription, setAiDescription] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const saveTimer = useRef(null);

  const matchingClients = clientQuery.trim()
    ? clients.filter((c) => (c.name || "").toLowerCase().includes(clientQuery.toLowerCase())).slice(0, 5)
    : [];

  useEffect(() => setLocalDoc(doc), [doc.id]);

  // Le focus automatique sur un champ nouvellement ajouté ne doit jouer
  // qu'une fois — sinon il "vole" le focus en continu à chaque frappe
  // ailleurs, ce qui provoquait la saisie mélangée entre descriptions.
  useEffect(() => {
    if (!lastAddedDetailId) return;
    const t = setTimeout(() => setLastAddedDetailId(null), 150);
    return () => clearTimeout(t);
  }, [lastAddedDetailId]);

  function patch(p) {
    const next = { ...localDoc, ...p };
    setLocalDoc(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onChange(p), 400);
  }
  function patchDeep(key, subPatch) {
    patch({ [key]: { ...localDoc[key], ...subPatch } });
  }
  function patchProforma(subPatch) {
    patch({ proforma: { ...(localDoc.proforma || emptyProforma()), ...subPatch } });
  }
  function addCustomField() {
    const current = localDoc.proforma || emptyProforma();
    patchProforma({ customFields: [...(current.customFields || []), { id: nextId("cf"), label: "", value: "" }] });
  }
  function updateCustomField(id, p) {
    const current = localDoc.proforma || emptyProforma();
    patchProforma({ customFields: (current.customFields || []).map((f) => (f.id === id ? { ...f, ...p } : f)) });
  }
  function removeCustomField(id) {
    const current = localDoc.proforma || emptyProforma();
    patchProforma({ customFields: (current.customFields || []).filter((f) => f.id !== id) });
  }
  function updateItem(id, itemPatch) {
    patch({ items: localDoc.items.map((it) => (it.id === id ? { ...it, ...itemPatch } : it)) });
  }
  function selectClient(c) {
    patch({ client: { name: c.name, address: c.address, email: c.email, phone: c.phone }, clientId: c.id });
    setClientQuery("");
    setClientPickerOpen(false);
  }
  function saveCurrentClient() {
    if (!localDoc.client.name.trim()) return;
    const id = localDoc.clientId || nextId("cli");
    onSaveClient({ id, ...localDoc.client });
    if (!localDoc.clientId) patch({ clientId: id });
  }
  function toggleLineSelect(id) {
    setSelectedLineIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function addDetail(lineId, level, afterId) {
    const newDetail = emptyDetail(level);
    patch({
      items: localDoc.items.map((it) => {
        if (it.id !== lineId) return it;
        const details = it.details || [];
        if (afterId) {
          const idx = details.findIndex((d) => d.id === afterId);
          const copy = [...details];
          copy.splice(idx + 1, 0, newDetail);
          return { ...it, details: copy };
        }
        return { ...it, details: [...details, newDetail] };
      }),
    });
    setOpenDetailsFor((prev) => (prev.includes(lineId) ? prev : [...prev, lineId]));
    setLastAddedDetailId(newDetail.id);
    return newDetail.id;
  }
  function updateDetail(lineId, detailId, detailPatch) {
    patch({
      items: localDoc.items.map((it) =>
        it.id === lineId ? { ...it, details: (it.details || []).map((d) => (d.id === detailId ? { ...d, ...detailPatch } : d)) } : it
      ),
    });
  }
  function removeDetail(lineId, detailId) {
    patch({
      items: localDoc.items.map((it) =>
        it.id === lineId ? { ...it, details: (it.details || []).filter((d) => d.id !== detailId) } : it
      ),
    });
  }
  function indentDetail(lineId, detailId) {
    patch({
      items: localDoc.items.map((it) => {
        if (it.id !== lineId) return it;
        const details = it.details || [];
        const idx = details.findIndex((d) => d.id === detailId);
        if (idx <= 0) return it;
        const maxLevel = details[idx - 1].level + 1;
        const copy = [...details];
        copy[idx] = { ...copy[idx], level: Math.min(copy[idx].level + 1, maxLevel) };
        return { ...it, details: copy };
      }),
    });
  }
  function outdentDetail(lineId, detailId) {
    patch({
      items: localDoc.items.map((it) =>
        it.id === lineId ? { ...it, details: (it.details || []).map((d) => (d.id === detailId ? { ...d, level: Math.max(1, d.level - 1) } : d)) } : it
      ),
    });
  }
  function handleExtract() {
    if (selectedLineIds.length === 0) return;
    const extracted = localDoc.items.filter((it) => it.type === "line" && selectedLineIds.includes(it.id)).map((it) => ({ ...it, id: nextId("l") }));
    const remaining = localDoc.items.filter((it) => !(it.type === "line" && selectedLineIds.includes(it.id)));
    patch({ items: remaining.length ? remaining : [emptyLine()] });
    onSplit(extracted);
    setSelectedLineIds([]);
  }
  function addLine() { patch({ items: [...localDoc.items, emptyLine()] }); }
  function addFromLibrary(p) {
    patch({ items: [...localDoc.items, { id: nextId("l"), type: "line", designation: p.designation, details: [], qty: 1, unit: p.unit, unitPrice: p.unitPrice, tva: p.tva, discount: 0 }] });
    setLibraryOpen(false);
    setLibraryQuery("");
  }
  function saveLineAsPrestation(it) {
    if (!it.designation.trim()) return;
    onSavePrestation({ id: nextId("pr"), designation: it.designation, category: "", unit: it.unit, unitPrice: it.unitPrice, tva: it.tva });
  }
  async function generateFromAI() {
    if (!aiDescription.trim() || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const { data: { session } } = await db.auth.getSession();
      const { data, error } = await db.functions.invoke("suggest-lines", {
        body: { description: aiDescription.trim() },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error) throw error;
      const parsed = data?.lines;
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Réponse vide");
      const newLines = parsed.slice(0, 25).map((item) => ({
        id: nextId("l"), type: "line",
        designation: String(item.designation || "").slice(0, 200),
        details: [],
        qty: Number(item.qty) || 1,
        unit: UNITS.includes(item.unit) ? item.unit : "",
        unitPrice: 0, tva: 20, discount: 0,
      }));
      patch({ items: [...localDoc.items, ...newLines] });
      setAiOpen(false);
      setAiDescription("");
    } catch (e) {
      console.error(e);
      setAiError("Impossible de générer les lignes pour le moment. Vérifie que la fonction \"suggest-lines\" est bien déployée et configurée (clé Gemini) — voir le Guide de déploiement, section IA. Sinon, réessaie dans un instant.");
    } finally {
      setAiLoading(false);
    }
  }
  function addSection() { patch({ items: [...localDoc.items, emptySection()] }); }
  function removeItem(id) { patch({ items: localDoc.items.filter((it) => it.id !== id) }); }
  function moveItem(id, dir) {
    const idx = localDoc.items.findIndex((i) => i.id === id);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= localDoc.items.length) return;
    const copy = [...localDoc.items];
    [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
    patch({ items: copy });
  }

  const { computedLines, subtotalHT, tvaGroups, totalTVA, totalTTC, acompteAmount, resteAPayer, hasMarginLines } = computeTotals(localDoc);
  const hasEssentiel = hasAccess(account, "essentiel");
  const hasPro = hasAccess(account, "pro");
  const currentPlanData = plans.find((p) => p.id === (account?.plan || "gratuit"));
  const watermarkEnabled = currentPlanData?.watermarkEnabled !== false;
  const validityDate = new Date(new Date(localDoc.issueDate).getTime() + (Number(localDoc.validityDays) || 0) * 86400000);
  const dueDate = new Date(new Date(localDoc.issueDate).getTime() + (Number(localDoc.dueDays) || 0) * 86400000);

  function getPos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: cx - rect.left, y: cy - rect.top };
  }
  function startDraw(e) {
    drawingRef.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function draw(e) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  function endDraw() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    patchDeep("signature", { drawing: canvasRef.current.toDataURL("image/png") });
  }
  function clearCanvas() {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    patchDeep("signature", { drawing: null });
  }
  function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => patchDeep("signature", { image: reader.result });
    reader.readAsDataURL(file);
  }

  const printRef = useRef(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  async function downloadPdf() {
    const el = printRef.current;
    if (!el || pdfGenerating) return;
    setPdfGenerating(true);

    // L'élément est masqué en dehors de l'impression classique — on le
    // rend temporairement visible (hors champ visuel) pour pouvoir le
    // capturer, puis on le recache immédiatement après.
    const prevStyle = { display: el.style.display, position: el.style.position, left: el.style.left, top: el.style.top, zIndex: el.style.zIndex };
    el.style.display = "block";
    el.style.position = "fixed";
    el.style.left = "-9999px";
    el.style.top = "0";
    el.style.zIndex = "-1";

    try {
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: siteSettings?.pdfBackground || "#FBF7EF" });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgHeight = (canvas.height * pageWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 3) { // tolérance : ignore les dépassements d'arrondi de quelques mm
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const safeName = `${docTypeLabel(localDoc.type)}-${(localDoc.docNumber || "document").replace(/[\\/:*?"<>|]/g, "-")}.pdf`;
      pdf.save(safeName);
    } catch (err) {
      console.error("Erreur de génération du PDF", err);
      alert("Impossible de générer le PDF. Réessaie, et préviens-moi si ça persiste.");
    } finally {
      el.style.display = prevStyle.display;
      el.style.position = prevStyle.position;
      el.style.left = prevStyle.left;
      el.style.top = prevStyle.top;
      el.style.zIndex = prevStyle.zIndex;
      setPdfGenerating(false);
    }
  }

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    const rows = [];
    rows.push([docTypeLabel(localDoc.type).toUpperCase(), localDoc.docNumber]);
    rows.push(["Date d'émission", frLong(localDoc.issueDate)]);
    rows.push([localDoc.type !== "facture" ? "Valable jusqu'au" : "Échéance", frLong(localDoc.type !== "facture" ? validityDate : dueDate)]);
    rows.push(["Devise", localDoc.currency || "EUR"]);
    rows.push([]);
    rows.push(["Émetteur", localDoc.company.name]);
    rows.push(["SIRET", localDoc.company.siret]);
    rows.push([]);
    rows.push(["Client", localDoc.client.name]);
    rows.push([]);
    rows.push(["Désignation", "Description", "Qté", "Unité", "PU HT / PV TTC (marge)", "TVA %", "Remise %", "Total"]);
    computedLines.forEach((l) => {
      const puValue = l.marginScheme ? Number(l.salePriceTTC) || 0 : Number(l.unitPrice) || 0;
      const lineTotal = l.marginScheme ? Number(l.saleTTC || 0) : Number(l.totalHT || 0);
      rows.push([l.designation + (l.marginScheme ? " (régime de la marge)" : ""), "", l.qty, l.unit, puValue, l.tva, l.discount, Number(lineTotal.toFixed(2))]);
      if (l.marginScheme) {
        rows.push(["", `Prix d'achat TTC unitaire : ${Number(l.purchasePriceTTC) || 0} — TVA sur marge : ${Number(l.marginTVA || 0).toFixed(2)}`, "", "", "", "", "", ""]);
      }
      (l.details || []).filter((d) => d.included && (d.text || d.price)).forEach((d) => {
        rows.push(["", "  ".repeat(d.level) + (d.marker || defaultMarker(d.level)) + " " + stripMarkup(d.text), "", "", "", "", "", Number(d.price) > 0 ? Number(d.price) : ""]);
      });
    });
    rows.push([]);
    rows.push(["", "", "", "", "", "", "Sous-total HT", Number(subtotalHT.toFixed(2))]);
    Object.entries(tvaGroups).forEach(([rate, amount]) => rows.push(["", "", "", "", "", "", `TVA ${rate}%`, Number(amount.toFixed(2))]));
    rows.push(["", "", "", "", "", "", "Total TTC", Number(totalTTC.toFixed(2))]);
    if (Number(localDoc.acompte) > 0) {
      rows.push(["", "", "", "", "", "", `Acompte (${localDoc.acompte}%)`, Number(acompteAmount.toFixed(2))]);
      rows.push(["", "", "", "", "", "", "Reste à payer", Number(resteAPayer.toFixed(2))]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 30 }, { wch: 30 }, { wch: 6 }, { wch: 9 }, { wch: 10 }, { wch: 7 }, { wch: 9 }, { wch: 13 }];
    XLSX.utils.book_append_sheet(wb, ws, localDoc.type === "devis" ? "Devis" : localDoc.type === "proforma" ? "Proforma" : "Facture");
    XLSX.writeFile(wb, `${localDoc.docNumber}.xlsx`);
  }

  const inputStyle = { fontFamily: "'Inter', sans-serif", border: `1px solid ${colors.line}`, color: colors.ink };
  const statuses = localDoc.type === "devis" ? DEVIS_STATUSES : localDoc.type === "proforma" ? PROFORMA_STATUSES : FACTURE_STATUSES;

  return (
    <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
      <GlobalStyle />

      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink }}>
        <button onClick={onBack} className="flex items-center gap-2 text-sm font-medium text-white">
          <ArrowLeft size={16} /> Tableau de bord
        </button>
        <div className="flex items-center gap-2">
          <select
            value={localDoc.status}
            onChange={(e) => patch({ status: e.target.value })}
            className="df-select rounded-full px-3 py-1.5 text-xs font-medium"
            style={{ background: `${statusColor(localDoc.status)}22`, color: "white", border: `1px solid ${statusColor(localDoc.status)}` }}
          >
            {statuses.map((s) => <option key={s} value={s} style={{ color: colors.ink }}>{s}</option>)}
          </select>
          {saving ? (
            <span className="flex items-center gap-1 text-xs text-white"><Loader2 size={12} className="animate-spin" /> Enregistrement</span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-white"><Check size={12} /> Enregistré</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {localDoc.type === "devis" && (
            <button onClick={onConvert} disabled={isLocked} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.slate, opacity: isLocked ? 0.5 : 1 }}>
              <ArrowRightLeft size={15} /> Convertir en facture
            </button>
          )}
          <button onClick={downloadPdf} disabled={pdfGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink, opacity: pdfGenerating ? 0.7 : 1 }}>
            {pdfGenerating ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} {pdfGenerating ? "Génération…" : "PDF"}
          </button>
          <button onClick={exportExcel} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.moss }}>
            <FileSpreadsheet size={15} /> Excel
          </button>
        </div>
      </div>

      <div className="no-print mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {splitNotice && (
          <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3" style={{ background: `${colors.moss}15`, border: `1px solid ${colors.moss}40` }}>
            <span className="text-sm" style={{ color: colors.moss }}>
              <strong>{splitNotice.docNumber}</strong> a été créé avec les lignes extraites.
            </span>
            <div className="flex items-center gap-3">
              <button onClick={onOpenSplitDoc} className="text-sm font-medium underline" style={{ color: colors.moss }}>Voir le document</button>
              <button onClick={onDismissSplitNotice} style={{ color: colors.inkSoft }}><X size={15} /></button>
            </div>
          </div>
        )}
        {isLocked && (
          <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4" style={{ background: `${colors.brick}12`, border: `1px solid ${colors.brick}40` }}>
            <span className="flex items-center gap-2 text-sm font-medium" style={{ color: colors.brick }}>
              <Lock size={15} /> {isViewer ? "Accès en lecture seule — ce document n'est pas modifiable." : "Limite du forfait Gratuit atteinte — ce document n'est plus modifiable."}
            </span>
            {!isViewer && <button onClick={onGoToPricing} className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white" style={{ background: colors.brick }}>Passer à un forfait payant</button>}
          </div>
        )}
        <div className="editor-form rounded-2xl p-6 shadow-sm sm:p-10" style={{ background: colors.surface, border: `1px solid ${colors.line}`, pointerEvents: isLocked ? "none" : "auto", opacity: isLocked ? 0.55 : 1 }}>

          <div className="mb-8 flex flex-wrap items-start justify-between gap-6 border-b pb-6" style={{ borderColor: colors.line }}>
            <div>
              <div className="df-display text-3xl font-semibold uppercase tracking-wide">{docTypeLabel(localDoc.type)}</div>
              <input className="df-input df-mono mt-2 rounded-md px-2 py-1 text-sm" style={inputStyle} value={localDoc.docNumber} onChange={(e) => patch({ docNumber: e.target.value })} />
              <div className="mt-2 flex items-center gap-1.5">
                <label className="text-xs" style={{ color: colors.inkSoft }}>Devise</label>
                <select className="df-select df-mono rounded-md px-2 py-1 text-xs" style={inputStyle} value={localDoc.currency || "EUR"} onChange={(e) => patch({ currency: e.target.value })}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <label className="self-center text-right" style={{ color: colors.inkSoft }}>Émis le</label>
              <input type="date" className="df-input df-mono rounded-md px-2 py-1" style={inputStyle} value={localDoc.issueDate} onChange={(e) => patch({ issueDate: e.target.value })} />
              {localDoc.type !== "facture" ? (
                <>
                  <label className="self-center text-right" style={{ color: colors.inkSoft }}>Validité (jours)</label>
                  <input type="number" className="df-input df-mono rounded-md px-2 py-1" style={inputStyle} value={localDoc.validityDays} onChange={(e) => patch({ validityDays: Number(e.target.value) || 0 })} />
                </>
              ) : (
                <>
                  <label className="self-center text-right" style={{ color: colors.inkSoft }}>Échéance (jours)</label>
                  <input type="number" className="df-input df-mono rounded-md px-2 py-1" style={inputStyle} value={localDoc.dueDays} onChange={(e) => patch({ dueDays: Number(e.target.value) || 0 })} />
                </>
              )}
              <div className="col-span-2 text-right text-xs" style={{ color: colors.inkSoft }}>
                {localDoc.type !== "facture" ? `Valable jusqu'au ${frLong(validityDate)}` : `Paiement attendu avant le ${frLong(dueDate)}`}
              </div>
            </div>
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="rounded-xl p-4" style={{ border: `1px solid ${colors.line}` }}>
              <div className="mb-2 flex items-center justify-between">
                <div className="df-display text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Émetteur</div>
                <div className="no-print flex gap-1 rounded-md p-0.5" style={{ background: colors.paper }}>
                  <button onClick={() => patchDeep("company", { type: "entreprise" })} className="rounded px-2 py-0.5 text-xs font-medium" style={{ background: (localDoc.company.type || "entreprise") === "entreprise" ? colors.ink : "transparent", color: (localDoc.company.type || "entreprise") === "entreprise" ? "white" : colors.inkSoft }}>Entreprise</button>
                  <button onClick={() => patchDeep("company", { type: "particulier" })} className="rounded px-2 py-0.5 text-xs font-medium" style={{ background: localDoc.company.type === "particulier" ? colors.ink : "transparent", color: localDoc.company.type === "particulier" ? "white" : colors.inkSoft }}>Particulier</button>
                </div>
              </div>
              <input className="df-input mb-2 w-full rounded-md px-2 py-1.5 text-sm font-medium" style={inputStyle} placeholder={localDoc.company.type === "particulier" ? "Nom et prénom" : "Raison sociale"} value={localDoc.company.name} onChange={(e) => patchDeep("company", { name: e.target.value })} />
              {localDoc.company.type !== "particulier" && (
                <input className="df-input mb-2 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="SIRET" value={localDoc.company.siret} onChange={(e) => patchDeep("company", { siret: e.target.value })} />
              )}
              <input className="df-input mb-2 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Adresse" value={localDoc.company.address} onChange={(e) => patchDeep("company", { address: e.target.value })} />
              <div className="flex gap-2">
                <input className="df-input w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Email" value={localDoc.company.email} onChange={(e) => patchDeep("company", { email: e.target.value })} />
                <input className="df-input w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Téléphone" value={localDoc.company.phone} onChange={(e) => patchDeep("company", { phone: e.target.value })} />
              </div>
            </div>
            <div className="rounded-xl p-4" style={{ border: `1px solid ${colors.line}` }}>
              <div className="mb-2 flex items-center justify-between">
                <div className="df-display text-xs font-semibold uppercase tracking-widest" style={{ color: colors.brassDark }}>Client</div>
                <div className="no-print flex gap-1 rounded-md p-0.5" style={{ background: colors.paper }}>
                  <button onClick={() => patchDeep("client", { type: "entreprise" })} className="rounded px-2 py-0.5 text-xs font-medium" style={{ background: (localDoc.client.type || "entreprise") === "entreprise" ? colors.ink : "transparent", color: (localDoc.client.type || "entreprise") === "entreprise" ? "white" : colors.inkSoft }}>Entreprise</button>
                  <button onClick={() => patchDeep("client", { type: "particulier" })} className="rounded px-2 py-0.5 text-xs font-medium" style={{ background: localDoc.client.type === "particulier" ? colors.ink : "transparent", color: localDoc.client.type === "particulier" ? "white" : colors.inkSoft }}>Particulier</button>
                </div>
              </div>
              <div className="mb-2 flex items-center justify-end">
                <button onClick={saveCurrentClient} className="no-print text-xs font-medium" style={{ color: colors.slate }}>Enregistrer comme client</button>
              </div>
              {clients.length > 0 && (
                <div className="no-print relative mb-2">
                  <input
                    className="df-input w-full rounded-md px-2 py-1.5 text-sm"
                    style={inputStyle}
                    placeholder="Rechercher un client existant..."
                    value={clientQuery}
                    onChange={(e) => { setClientQuery(e.target.value); setClientPickerOpen(true); }}
                    onFocus={() => setClientPickerOpen(true)}
                  />
                  {clientPickerOpen && matchingClients.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md shadow-sm" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
                      {matchingClients.map((c) => (
                        <button key={c.id} onClick={() => selectClient(c)} className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5">
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <input className="df-input mb-2 w-full rounded-md px-2 py-1.5 text-sm font-medium" style={inputStyle} placeholder={localDoc.client.type === "particulier" ? "Nom et prénom" : "Raison sociale"} value={localDoc.client.name} onChange={(e) => patchDeep("client", { name: e.target.value })} />
              <input className="df-input mb-2 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Adresse" value={localDoc.client.address} onChange={(e) => patchDeep("client", { address: e.target.value })} />
              <div className="flex gap-2">
                <input className="df-input w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Email" value={localDoc.client.email} onChange={(e) => patchDeep("client", { email: e.target.value })} />
                <input className="df-input w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Téléphone" value={localDoc.client.phone} onChange={(e) => patchDeep("client", { phone: e.target.value })} />
              </div>
            </div>
          </div>

          {localDoc.type === "proforma" && (() => {
            const pf = localDoc.proforma || emptyProforma();
            return (
              <div className="no-print mb-8 rounded-xl p-4" style={{ border: `1px solid ${colors.line}` }}>
                <div className="df-display mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest" style={{ color: colors.moss }}>
                  <Ship size={13} /> Informations proforma (international)
                </div>
                <p className="mb-3 text-xs" style={{ color: colors.inkSoft }}>Tous ces champs sont optionnels — remplis uniquement ceux dont tu as besoin. Ils apparaîtront sur le PDF seulement s'ils sont renseignés.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="text-xs" style={{ color: colors.inkSoft }}>
                    Série / référence
                    <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} value={pf.serie} onChange={(e) => patchProforma({ serie: e.target.value })} />
                  </label>
                  <label className="text-xs" style={{ color: colors.inkSoft }}>
                    Incoterm
                    <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="ex : FOB, CIF, EXW..." value={pf.incoterm} onChange={(e) => patchProforma({ incoterm: e.target.value })} />
                  </label>
                  <label className="text-xs" style={{ color: colors.inkSoft }}>
                    Lieu de l'Incoterm
                    <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="ex : Casablanca" value={pf.incotermPlace} onChange={(e) => patchProforma({ incotermPlace: e.target.value })} />
                  </label>
                  <label className="text-xs" style={{ color: colors.inkSoft }}>
                    Devise
                    <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="EUR, USD..." value={pf.currency} onChange={(e) => patchProforma({ currency: e.target.value })} />
                  </label>
                  <label className="text-xs" style={{ color: colors.inkSoft }}>
                    Conditions de paiement
                    <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="ex : Crédit documentaire irrévocable" value={pf.paymentTerms} onChange={(e) => patchProforma({ paymentTerms: e.target.value })} />
                  </label>
                  <label className="text-xs" style={{ color: colors.inkSoft }}>
                    Pays d'origine des marchandises
                    <select className="df-select mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} value={pf.originCountry} onChange={(e) => patchProforma({ originCountry: e.target.value })}>
                      <option value="">— Non précisé —</option>
                      {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="text-xs" style={{ color: colors.inkSoft }}>
                    Code SH / douanier
                    <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} value={pf.hsCode} onChange={(e) => patchProforma({ hsCode: e.target.value })} />
                  </label>
                  <label className="text-xs" style={{ color: colors.inkSoft }}>
                    Poids brut
                    <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="ex : 320 kg" value={pf.grossWeight} onChange={(e) => patchProforma({ grossWeight: e.target.value })} />
                  </label>
                  <label className="text-xs" style={{ color: colors.inkSoft }}>
                    Poids net
                    <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="ex : 280 kg" value={pf.netWeight} onChange={(e) => patchProforma({ netWeight: e.target.value })} />
                  </label>
                  <label className="text-xs" style={{ color: colors.inkSoft }}>
                    Nombre de colis
                    <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="ex : 8 cartons sur 1 palette" value={pf.packagesCount} onChange={(e) => patchProforma({ packagesCount: e.target.value })} />
                  </label>
                  <label className="text-xs" style={{ color: colors.inkSoft }}>
                    Port de chargement
                    <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} value={pf.loadingPort} onChange={(e) => patchProforma({ loadingPort: e.target.value })} />
                  </label>
                  <label className="text-xs" style={{ color: colors.inkSoft }}>
                    Port de déchargement
                    <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} value={pf.dischargingPort} onChange={(e) => patchProforma({ dischargingPort: e.target.value })} />
                  </label>
                  <label className="text-xs" style={{ color: colors.inkSoft }}>
                    Mode de transport
                    <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Maritime, aérien, routier..." value={pf.transportMode} onChange={(e) => patchProforma({ transportMode: e.target.value })} />
                  </label>
                </div>

                <div className="mt-4 border-t pt-4" style={{ borderColor: colors.line }}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold" style={{ color: colors.inkSoft }}>Champs personnalisés</span>
                    <button onClick={addCustomField} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ border: `1px solid ${colors.line}`, color: colors.slate }}>
                      <Plus size={12} /> Ajouter un champ
                    </button>
                  </div>
                  <p className="mb-2 text-xs" style={{ color: colors.inkSoft }}>Pour tout ce qui n'est pas prévu ci-dessus : numéro de châssis, année de fabrication, dimensions... à toi de nommer le champ.</p>
                  <div className="space-y-2">
                    {(pf.customFields || []).map((f) => (
                      <div key={f.id} className="flex items-center gap-2">
                        <input className="df-input w-1/3 rounded-md px-2 py-1.5 text-xs" style={inputStyle} placeholder="Nom du champ (ex : Numéro de châssis)" value={f.label} onChange={(e) => updateCustomField(f.id, { label: e.target.value })} />
                        <input className="df-input grow rounded-md px-2 py-1.5 text-xs" style={inputStyle} placeholder="Valeur" value={f.value} onChange={(e) => updateCustomField(f.id, { value: e.target.value })} />
                        <button onClick={() => removeCustomField(f.id)} style={{ color: colors.brick }}><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="df-display text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Prestations</div>
            <div className="no-print flex flex-wrap gap-2">
              {selectedLineIds.length > 0 && (
                <button onClick={handleExtract} className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-white" style={{ background: colors.brick }}>
                  <Scissors size={13} /> Extraire {selectedLineIds.length} ligne(s) vers un nouveau document
                </button>
              )}
              <div className="relative">
                <button
                  onClick={() => hasPro ? setAiOpen((v) => !v) : onGoToPricing()}
                  className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-white"
                  style={{ background: hasPro ? colors.brassDark : colors.line, color: hasPro ? "white" : colors.inkSoft }}
                  title={hasPro ? "" : "Fonctionnalité réservée aux forfaits Pro et Entreprise"}
                >
                  {hasPro ? <Sparkles size={13} /> : <Lock size={13} />} Suggérer avec l'IA
                </button>
                {aiOpen && hasPro && (
                  <div className="absolute right-0 z-10 mt-1 w-80 rounded-md p-3 shadow-sm" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
                    <p className="mb-2 text-xs" style={{ color: colors.inkSoft }}>Décris le chantier, l'IA propose des lignes (désignation, quantité, unité) — <strong>sans les prix</strong>, à compléter toi-même.</p>
                    <textarea
                      className="df-textarea w-full rounded-md px-2 py-1.5 text-sm"
                      style={{ ...inputStyle, minHeight: "4.5rem" }}
                      placeholder="Ex : Rénovation salle de bain, dépose ancienne baignoire, pose douche italienne, faïence murale 15m²..."
                      value={aiDescription}
                      onChange={(e) => setAiDescription(e.target.value)}
                    />
                    {aiError && <p className="mt-1 text-xs" style={{ color: colors.brick }}>{aiError}</p>}
                    <div className="mt-2 flex justify-end gap-2">
                      <button onClick={() => setAiOpen(false)} className="rounded-md px-3 py-1.5 text-xs font-medium" style={{ color: colors.inkSoft }}>Annuler</button>
                      <button onClick={generateFromAI} disabled={aiLoading || !aiDescription.trim()} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white" style={{ background: colors.brassDark, opacity: aiLoading || !aiDescription.trim() ? 0.6 : 1 }}>
                        {aiLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {aiLoading ? "Génération..." : "Générer"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {prestations.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => hasPro ? setLibraryOpen((v) => !v) : onGoToPricing()}
                    className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium"
                    style={{ border: `1px solid ${colors.line}`, color: hasPro ? colors.brassDark : colors.inkSoft }}
                    title={hasPro ? "" : "Fonctionnalité réservée aux forfaits Pro et Entreprise"}
                  >
                    {hasPro ? <Library size={13} /> : <Lock size={13} />} Depuis la bibliothèque
                  </button>
                  {libraryOpen && hasPro && (
                    <div className="absolute right-0 z-10 mt-1 w-72 overflow-hidden rounded-md shadow-sm" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
                      <input autoFocus className="df-input w-full border-0 border-b px-3 py-2 text-sm" style={{ borderColor: colors.line }} placeholder="Rechercher..." value={libraryQuery} onChange={(e) => setLibraryQuery(e.target.value)} />
                      <div className="max-h-64 overflow-y-auto">
                        {prestations.filter((p) => p.designation.toLowerCase().includes(libraryQuery.toLowerCase())).map((p) => (
                          <button key={p.id} onClick={() => addFromLibrary(p)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-black/5">
                            <span className="truncate">{p.designation}</span>
                            <span className="df-mono shrink-0 text-xs" style={{ color: colors.inkSoft }}>{eur(Number(p.unitPrice) || 0)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <button onClick={addSection} className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium" style={{ border: `1px solid ${colors.line}`, color: colors.slate }}>
                <LayoutList size={13} /> Titre de section
              </button>
              <button onClick={addLine} className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-white" style={{ background: colors.ink }}>
                <Plus size={13} /> Ligne
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {localDoc.items.map((it, idx) => it.type === "section" ? (
              <div key={it.id} className="group flex items-start gap-2 rounded-lg py-2" style={{ borderTop: `2px solid ${colors.slate}` }}>
                <div className="grow pt-1">
                  <input className="df-input w-full rounded-md px-2 py-1 text-sm font-semibold" style={{ ...inputStyle, borderColor: "transparent", background: "transparent" }} placeholder="Titre de section (ex : Lot Plomberie)" value={it.title} onChange={(e) => updateItem(it.id, { title: e.target.value })} />
                  <input className="df-input w-full rounded-md px-2 py-1 text-xs" style={{ ...inputStyle, borderColor: "transparent", background: "transparent", color: colors.inkSoft }} placeholder="Sous-titre (optionnel)" value={it.subtitle} onChange={(e) => updateItem(it.id, { subtitle: e.target.value })} />
                </div>
                <div className="no-print flex shrink-0 gap-1 pt-2">
                  <button onClick={() => moveItem(it.id, -1)} style={{ color: colors.inkSoft }}><ChevronUp size={15} /></button>
                  <button onClick={() => moveItem(it.id, 1)} style={{ color: colors.inkSoft }}><ChevronDown size={15} /></button>
                  <button onClick={() => removeItem(it.id)} style={{ color: colors.brick }}><Trash2 size={15} /></button>
                </div>
              </div>
            ) : (
              <div key={it.id} className="rounded-lg p-2" style={{ background: selectedLineIds.includes(it.id) ? "rgba(166,72,59,0.08)" : idx % 2 ? "transparent" : "rgba(62,92,110,0.04)" }}>
                <div className="flex flex-wrap items-start gap-2">
                  <input type="checkbox" className="no-print mt-2" checked={selectedLineIds.includes(it.id)} onChange={() => toggleLineSelect(it.id)} style={{ accentColor: colors.brick }} />
                  <div className="grow basis-56">
                    <input className="df-input w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Désignation" value={it.designation} onChange={(e) => updateItem(it.id, { designation: e.target.value })} />
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {!(openDetailsFor.includes(it.id) || (it.details || []).length > 0) && (
                        <button onClick={() => addDetail(it.id, 1)} className="no-print flex items-center gap-1 text-xs" style={{ color: colors.slate }}>
                          <Plus size={11} /> Ajouter une description détaillée
                        </button>
                      )}
                      <button
                        onClick={() => updateItem(it.id, { marginScheme: !it.marginScheme })}
                        className="no-print flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
                        style={{ background: it.marginScheme ? `${colors.moss}18` : "transparent", color: it.marginScheme ? colors.moss : colors.inkSoft, border: `1px solid ${it.marginScheme ? colors.moss : colors.line}` }}
                        title="Régime particulier : TVA calculée sur la marge (biens d'occasion, article 297 A du CGI) au lieu du prix total"
                      >
                        <Calculator size={11} /> TVA sur marge
                      </button>
                    </div>
                    {it.marginScheme && (
                      <div className="no-print mt-2 flex flex-wrap gap-2 rounded-md p-2" style={{ background: "rgba(91,122,85,0.06)" }}>
                        <label className="text-xs" style={{ color: colors.inkSoft }}>
                          Prix d'achat TTC (unitaire)
                          <input type="number" className="df-input df-mono mt-0.5 block w-32 rounded-md px-2 py-1 text-sm" style={inputStyle} value={it.purchasePriceTTC} onChange={(e) => updateItem(it.id, { purchasePriceTTC: e.target.value })} />
                        </label>
                        <label className="text-xs" style={{ color: colors.inkSoft }}>
                          Prix de vente TTC (unitaire)
                          <input type="number" className="df-input df-mono mt-0.5 block w-32 rounded-md px-2 py-1 text-sm" style={inputStyle} value={it.salePriceTTC} onChange={(e) => updateItem(it.id, { salePriceTTC: e.target.value })} />
                        </label>
                        <div className="text-xs" style={{ color: colors.inkSoft }}>
                          Marge TTC
                          <div className="df-mono mt-0.5 font-medium" style={{ color: colors.moss }}>{formatMoney(lineMarginCalc(it, it.discount, localDoc.globalDiscount).marginTTC, localDoc.currency)}</div>
                        </div>
                        <div className="text-xs" style={{ color: colors.inkSoft }}>
                          dont TVA sur marge
                          <div className="df-mono mt-0.5 font-medium">{formatMoney(lineMarginCalc(it, it.discount, localDoc.globalDiscount).marginTVA, localDoc.currency)}</div>
                        </div>
                      </div>
                    )}
                  </div>
                  <label className="w-14 text-xs">
                    <span className="mb-0.5 block" style={{ color: colors.inkSoft }}>Qté</span>
                    <input type="number" className="df-input df-mono w-14 rounded-md px-1 py-1.5 text-right text-sm" style={inputStyle} value={it.qty} onChange={(e) => updateItem(it.id, { qty: e.target.value })} />
                  </label>
                  <label className="w-20 text-xs">
                    <span className="mb-0.5 block" style={{ color: colors.inkSoft }}>Unité</span>
                    <select className="df-select w-20 rounded-md px-1 py-1.5 text-sm" style={inputStyle} value={it.unit} onChange={(e) => updateItem(it.id, { unit: e.target.value })}>
                      {UNIT_OPTIONS.map((u) => <option key={u || "none"} value={u}>{unitLabel(u)}</option>)}
                    </select>
                  </label>
                  <label className="w-24 text-xs">
                    <span className="mb-0.5 block" style={{ color: colors.inkSoft }}>PU HT</span>
                    {it.marginScheme ? (
                      <div className="w-24 rounded-md px-1 py-1.5 text-right text-sm" style={{ color: colors.inkSoft }} title="Prix de vente TTC (voir ci-dessus)">TTC</div>
                    ) : (
                      <input type="number" className="df-input df-mono w-24 rounded-md px-1 py-1.5 text-right text-sm" style={inputStyle} value={it.unitPrice} onChange={(e) => updateItem(it.id, { unitPrice: e.target.value })} />
                    )}
                  </label>
                  <label className="w-16 text-xs">
                    <span className="mb-0.5 block" style={{ color: colors.inkSoft }}>TVA %</span>
                    <input type="number" step="0.1" min="0" title="Taux de TVA (%)" className="df-input df-mono w-16 rounded-md px-1 py-1.5 text-right text-sm" style={inputStyle} value={it.tva} onChange={(e) => updateItem(it.id, { tva: e.target.value })} />
                  </label>
                  <label className="w-16 text-xs">
                    <span className="mb-0.5 block" style={{ color: colors.inkSoft }}>Remise %</span>
                    <input type="number" className="df-input df-mono w-16 rounded-md px-1 py-1.5 text-right text-sm" style={inputStyle} value={it.discount} onChange={(e) => updateItem(it.id, { discount: e.target.value })} />
                  </label>
                  <div className="w-24 text-xs">
                    <span className="mb-0.5 block" style={{ color: colors.inkSoft }}>Total HT</span>
                    <div className="df-mono py-1.5 text-right text-sm font-medium">
                      {it.marginScheme
                        ? formatMoney(lineMarginCalc(it, it.discount, localDoc.globalDiscount).saleTTC, localDoc.currency)
                        : formatMoney(lineBaseHT(it) * (1 - (Number(it.discount) || 0) / 100) * (1 - (Number(localDoc.globalDiscount) || 0) / 100), localDoc.currency)}
                    </div>
                  </div>
                  <div className="no-print flex w-24 shrink-0 justify-end gap-1 pt-1.5">
                    <button onClick={() => saveLineAsPrestation(it)} title="Enregistrer comme prestation" style={{ color: colors.brassDark }}><BookmarkPlus size={14} /></button>
                    <button onClick={() => moveItem(it.id, -1)} style={{ color: colors.inkSoft }}><ChevronUp size={14} /></button>
                    <button onClick={() => moveItem(it.id, 1)} style={{ color: colors.inkSoft }}><ChevronDown size={14} /></button>
                    <button onClick={() => removeItem(it.id)} style={{ color: colors.brick }}><Trash2 size={14} /></button>
                  </div>
                </div>

                {(openDetailsFor.includes(it.id) || (it.details || []).length > 0) && (
                  <div className="mt-2 ml-6 space-y-1 rounded-md p-2" style={{ background: "rgba(27,42,51,0.03)" }}>
                    {(it.details || []).map((d, dIdx) => (
                      <div key={d.id} className="flex items-center gap-1.5" style={{ marginLeft: `${(d.level - 1) * 1.5}rem` }}>
                        <input type="checkbox" checked={d.included} onChange={(e) => updateDetail(it.id, d.id, { included: e.target.checked })} title="Inclus dans le document" style={{ accentColor: colors.moss }} className="no-print shrink-0" />
                        <select
                          className="df-select no-print shrink-0 rounded px-1 py-1 text-sm"
                          style={{ ...inputStyle, width: "2.6rem" }}
                          value={d.marker || defaultMarker(d.level)}
                          onChange={(e) => updateDetail(it.id, d.id, { marker: e.target.value })}
                          title="Choisir le symbole de début de ligne"
                        >
                          {MARKERS.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <FormattableField
                          wrapperClassName="grow"
                          enabled={hasEssentiel}
                          className="df-input w-full rounded-md px-2 py-1 text-xs"
                          style={{ ...inputStyle, opacity: d.included ? 1 : 0.45 }}
                          placeholder={d.level === 1 ? "Description" : "Sous-description"}
                          value={d.text}
                          autoFocus={d.id === lastAddedDetailId}
                          onChange={(v) => updateDetail(it.id, d.id, { text: v })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); addDetail(it.id, d.level, d.id); }
                            else if (e.key === "Tab") { e.preventDefault(); e.shiftKey ? outdentDetail(it.id, d.id) : indentDetail(it.id, d.id); }
                          }}
                        />
                        <input type="number" className="df-input df-mono w-20 rounded-md px-1 py-1 text-right text-xs" style={inputStyle} placeholder="Prix" value={d.price} onChange={(e) => updateDetail(it.id, d.id, { price: e.target.value })} />
                        <button onClick={() => outdentDetail(it.id, d.id)} disabled={d.level <= 1} title="Désindenter (Maj+Tab)" className="no-print shrink-0" style={{ color: d.level <= 1 ? colors.line : colors.inkSoft }}><IndentDecrease size={13} /></button>
                        <button onClick={() => indentDetail(it.id, d.id)} disabled={dIdx === 0} title="Indenter (Tab) — devient une sous-description" className="no-print shrink-0" style={{ color: dIdx === 0 ? colors.line : colors.inkSoft }}><IndentIncrease size={13} /></button>
                        <button onClick={() => removeDetail(it.id, d.id)} className="no-print shrink-0" style={{ color: colors.brick }}><X size={12} /></button>
                      </div>
                    ))}
                    <button onClick={() => addDetail(it.id, 1)} className="no-print flex items-center gap-1 text-xs" style={{ color: colors.slate }}>
                      <Plus size={11} /> Description
                    </button>
                    <p className="no-print text-xs" style={{ color: colors.inkSoft }}>Entrée = nouvelle ligne · Tab = indenter (sous-description) · Maj+Tab = désindenter</p>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-start justify-between gap-8 border-t pt-8" style={{ borderColor: colors.line }}>
            <div className="flex flex-wrap gap-6">
              <label className="text-sm">
                <div className="mb-1" style={{ color: colors.inkSoft }}>Remise globale (%)</div>
                <input type="number" className="df-input df-mono w-28 rounded-md px-2 py-1.5" style={inputStyle} value={localDoc.globalDiscount} onChange={(e) => patch({ globalDiscount: e.target.value })} />
              </label>
              <label className="text-sm">
                <div className="mb-1" style={{ color: colors.inkSoft }}>Acompte demandé (%)</div>
                <input type="number" className="df-input df-mono w-28 rounded-md px-2 py-1.5" style={inputStyle} value={localDoc.acompte} onChange={(e) => patch({ acompte: e.target.value })} />
              </label>
            </div>

            <div className="flex items-center gap-8">
              <div className="df-mono space-y-1 text-right text-sm">
                <div className="flex justify-between gap-8"><span style={{ color: colors.inkSoft }}>Sous-total HT</span><span>{formatMoney(subtotalHT, localDoc.currency)}</span></div>
                {Object.entries(tvaGroups).map(([rate, amount]) => (
                  <div key={rate} className="flex justify-between gap-8"><span style={{ color: colors.inkSoft }}>TVA {rate}%</span><span>{formatMoney(amount, localDoc.currency)}</span></div>
                ))}
                {Number(localDoc.acompte) > 0 && (
                  <>
                    <div className="flex justify-between gap-8"><span style={{ color: colors.inkSoft }}>Acompte ({localDoc.acompte}%)</span><span>- {formatMoney(acompteAmount, localDoc.currency)}</span></div>
                    <div className="flex justify-between gap-8 font-semibold" style={{ color: colors.moss }}><span>Reste à payer</span><span>{formatMoney(resteAPayer, localDoc.currency)}</span></div>
                  </>
                )}
              </div>

              <div className="relative flex h-36 w-36 shrink-0 items-center justify-center" style={{ transform: "rotate(-4deg)" }}>
                <div className="absolute inset-0 rounded-full" style={{ border: `3px solid ${colors.brass}` }} />
                <div className="absolute inset-1.5 rounded-full" style={{ border: `1px solid ${colors.brass}` }} />
                <div className="px-2 text-center">
                  <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: colors.brassDark }}>Total TTC</div>
                  <div className="df-mono mt-1 text-xl font-semibold leading-tight">{formatMoney(totalTTC, localDoc.currency)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 border-t pt-6" style={{ borderColor: colors.line }}>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Notes</label>
            <FormattableField multiline enabled={hasEssentiel} className="df-textarea w-full rounded-md px-3 py-2 text-sm" style={{ ...inputStyle, minHeight: "3.5rem" }} value={localDoc.notes} onChange={(v) => patch({ notes: v })} />
          </div>

          {localDoc.items.some((it) => it.marginScheme) && (
            <div className="mt-8 border-t pt-6" style={{ borderColor: colors.line }}>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color: colors.moss }}>
                <Calculator size={13} /> Mention légale — TVA sur la marge
              </label>
              <p className="mb-2 text-xs" style={{ color: colors.inkSoft }}>
                Adapte ce texte à ta situation (biens d'occasion, objets d'art, véhicules d'occasion...) — la loi impose une mention précise selon la catégorie.
              </p>
              <textarea className="df-textarea w-full rounded-md px-3 py-2 text-xs" style={{ ...inputStyle, minHeight: "3rem" }} value={localDoc.marginLegalMention || DEFAULT_MARGIN_MENTION} onChange={(e) => patch({ marginLegalMention: e.target.value })} />
            </div>
          )}

          <div className="mt-8 border-t pt-6" style={{ borderColor: colors.line }}>
            <div className="df-display mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>
              Signature du client (optionnelle) {!hasEssentiel && <Lock size={12} style={{ color: colors.inkSoft }} />}
            </div>
            {!hasEssentiel ? (
              <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl p-4" style={{ border: `1px dashed ${colors.line}`, background: colors.paper }}>
                <p className="text-xs" style={{ color: colors.inkSoft }}>La signature électronique (saisie, dessin ou image) est réservée aux forfaits <strong>Essentiel</strong>, <strong>Pro</strong> et <strong>Entreprise</strong>.</p>
                <button onClick={onGoToPricing} className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white" style={{ background: colors.brassDark }}>Voir les forfaits</button>
              </div>
            ) : (
              <>
                <div className="no-print mb-3 flex gap-2">
                  {[
                    { id: "texte", label: "Saisie du nom", icon: TypeIcon },
                    { id: "dessin", label: "Dessin à main levée", icon: PenTool },
                    { id: "image", label: "Uploader une image", icon: Upload },
                  ].map(({ id, label, icon: Icon }) => (
                    <button key={id} onClick={() => patchDeep("signature", { mode: id })} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium" style={{ background: localDoc.signature.mode === id ? colors.ink : "transparent", color: localDoc.signature.mode === id ? "white" : colors.inkSoft, border: `1px solid ${localDoc.signature.mode === id ? colors.ink : colors.line}` }}>
                      <Icon size={13} /> {label}
                    </button>
                  ))}
                </div>
                <div className="rounded-xl p-4" style={{ border: `1px dashed ${colors.line}` }}>
                  {localDoc.signature.mode === "texte" && (
                    <input className="df-input df-display w-full max-w-sm rounded-md px-3 py-2 text-lg italic" style={inputStyle} placeholder="Tapez votre nom pour signer" value={localDoc.signature.name} onChange={(e) => patchDeep("signature", { name: e.target.value })} />
                  )}
                  {localDoc.signature.mode === "dessin" && (
                    <div>
                      <canvas
                        ref={canvasRef} width={360} height={130}
                        className="rounded-md"
                        style={{ background: colors.surface, border: `1px solid ${colors.line}`, touchAction: "none", cursor: "crosshair" }}
                        onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                        onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
                      />
                      <button onClick={clearCanvas} className="no-print mt-2 flex items-center gap-1 text-xs font-medium" style={{ color: colors.brick }}>
                        <Eraser size={13} /> Effacer
                      </button>
                    </div>
                  )}
                  {localDoc.signature.mode === "image" && (
                    <div>
                      <input type="file" accept="image/*" onChange={handleImageUpload} className="no-print text-xs" />
                      {localDoc.signature.image && <img src={localDoc.signature.image} alt="Signature" className="mt-2 h-24 rounded-md object-contain" style={{ border: `1px solid ${colors.line}` }} />}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <PrintDocument ref={printRef} doc={localDoc} totals={{ computedLines, subtotalHT, tvaGroups, totalTVA, totalTTC, acompteAmount, resteAPayer, hasMarginLines }} accountPlan={account?.plan} siteSettings={siteSettings} watermarkEnabled={watermarkEnabled} />
    </div>
  );
}
