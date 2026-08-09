import { useState, useEffect, useRef, useMemo, forwardRef } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { db } from "./client.js";
import { clearStorageCache, setActiveOrganization } from "./storage-adapter.js";
import * as XLSX from "xlsx";
import {
  Plus, Trash2, Printer, FileSpreadsheet, PenTool, Type as TypeIcon, Upload,
  ArrowRightLeft, Eraser, ChevronUp, ChevronDown, LayoutList, ArrowLeft, TrendingUp, Info, Minus,
  Search, FileText, Receipt, Copy, Loader2, Inbox, Check, Users, Building2,
  Pencil, X, UserPlus, UserCircle, LayoutDashboard, LogOut, Lock, CreditCard, Mail,
  KeyRound, Sparkles, ArrowRight, Eye, EyeOff, GitMerge, Scissors,
  Library, BookmarkPlus, RotateCcw, AlertTriangle, IndentIncrease, IndentDecrease,
  Shield, ToggleLeft, ToggleRight, Calculator, Download, Layers, Menu,
  Ship, Package, MapPinned, ShoppingCart, Truck, BarChart3, ClipboardCheck, List, Wrench, FileSignature, Calendar, Wallet,
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
  { id: "entreprise", name: "Entreprise", monthly: null, annual: null, limit: Infinity, tagline: "Sur mesure", features: ["Tout Pro", "API", "Support prioritaire"] },
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
  if (type === "revision") return TrendingUp;
  if (type === "avoir") return RotateCcw;
  if (type === "acompte") return Wallet;
  if (type === "commande") return ShoppingCart;
  if (type === "livraison") return Truck;
  if (type === "situation") return BarChart3;
  if (type === "pv_reception") return ClipboardCheck;
  if (type === "bpu") return List;
  if (type === "rapport") return Wrench;
  if (type === "contrat") return FileSignature;
  if (type === "relance") return AlertTriangle;
  if (type === "planning") return Calendar;
  return Receipt;
}
function docTypeColor(type) {
  if (type === "devis") return colors.slate;
  if (type === "proforma") return colors.moss;
  if (type === "revision") return colors.brick;
  if (type === "avoir") return colors.brick;
  if (type === "acompte") return colors.brassDark;
  if (type === "commande") return colors.slate;
  if (type === "livraison") return colors.moss;
  if (type === "situation") return colors.brassDark;
  if (type === "pv_reception") return colors.moss;
  if (type === "bpu") return colors.slate;
  if (type === "rapport") return colors.brassDark;
  if (type === "contrat") return colors.slate;
  if (type === "relance") return colors.brick;
  if (type === "planning") return colors.moss;
  return colors.brassDark;
}
function docTypeLabel(type) {
  if (type === "devis") return "Devis";
  if (type === "proforma") return "Proforma";
  if (type === "revision") return "Revision-prix";
  if (type === "avoir") return "Avoir";
  if (type === "acompte") return "Facture d'acompte";
  if (type === "commande") return "Bon de commande";
  if (type === "livraison") return "Bon de livraison";
  if (type === "situation") return "Situation de travaux";
  if (type === "pv_reception") return "PV de réception";
  if (type === "bpu") return "Bordereau de prix unitaires";
  if (type === "rapport") return "Rapport d'intervention";
  if (type === "contrat") return "Contrat de chantier";
  if (type === "relance") return "Mise en demeure";
  if (type === "planning") return "Planning de chantier";
  return "Facture";
}

// Registre central de tous les services proposés par l'application —
// utilisé par le menu de création, la page Admin (afficher/masquer)
// et la page d'accueil. "implemented" distingue ce qui a un vrai
// éditeur de ce qui est encore en développement.
const SERVICES = [
  { id: "devis", label: "Devis", icon: FileText, description: "Proposition commerciale avant travaux", implemented: true },
  { id: "facture", label: "Facture", icon: Receipt, description: "Facturation classique", implemented: true },
  { id: "proforma", label: "Facture proforma", icon: Ship, description: "Facture indicative, souvent pour douane ou import", implemented: true },
  { id: "revision", label: "Révision de prix", icon: TrendingUp, description: "Révision de prix pour marchés à long terme", implemented: true },
  { id: "acompte", label: "Facture d'acompte", icon: Wallet, description: "Facture séparée pour une avance avant travaux", implemented: true },
  { id: "avoir", label: "Avoir", icon: RotateCcw, description: "Note de crédit pour annuler ou corriger une facture", implemented: true },
  { id: "commande", label: "Bon de commande", icon: ShoppingCart, description: "Commande de matériel auprès d'un fournisseur", implemented: true },
  { id: "livraison", label: "Bon de livraison", icon: Truck, description: "Accusé de réception de matériel ou de travaux", implemented: true },
  { id: "situation", label: "Situation de travaux", icon: BarChart3, description: "Facturation par tranches selon l'avancement du chantier", implemented: true },
  { id: "pv_reception", label: "PV de réception", icon: ClipboardCheck, description: "Validation de fin de chantier signée par le client", implemented: true },
  { id: "bpu", label: "Bordereau de prix unitaires", icon: List, description: "Liste de prix détaillée par unité", implemented: true },
  { id: "rapport", label: "Rapport d'intervention", icon: Wrench, description: "Fiche de visite pour dépannage ou service", implemented: true },
  { id: "contrat", label: "Contrat de chantier", icon: FileSignature, description: "Contrat signé, distinct du simple devis", implemented: true },
  { id: "relance", label: "Relance formelle", icon: AlertTriangle, description: "Mise en demeure pour impayé", implemented: true },
  { id: "planning", label: "Planning de chantier", icon: Calendar, description: "Planification des travaux", implemented: true },
];
function getService(id) {
  return SERVICES.find((s) => s.id === id);
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
// Format court pour la colonne "Situation" des révisions de prix :
// jour + mois sur 3 lettres, en majuscules, sans année (ex: "21 FEV").
const MOIS_COURTS = ["JAN", "FEV", "MAR", "AVR", "MAI", "JUN", "JUL", "AOU", "SEP", "OCT", "NOV", "DEC"];
const frShort = (d) => {
  const date = new Date(d);
  const jour = String(date.getDate()).padStart(2, "0");
  return `${jour} ${MOIS_COURTS[date.getMonth()]}`;
};
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
  // Europe (exhaustive)
  "🇫🇷 FR", "🇧🇪 BE", "🇨🇭 CH", "🇱🇺 LU", "🇲🇨 MC", "🇩🇪 DE", "🇪🇸 ES", "🇮🇹 IT", "🇵🇹 PT",
  "🇳🇱 NL", "🇬🇧 GB", "🇮🇪 IE", "🇷🇴 RO", "🇵🇱 PL", "🇬🇷 GR", "🇦🇹 AT", "🇸🇪 SE", "🇳🇴 NO",
  "🇩🇰 DK", "🇫🇮 FI", "🇮🇸 IS", "🇭🇺 HU", "🇨🇿 CZ", "🇸🇰 SK", "🇸🇮 SI", "🇭🇷 HR", "🇧🇬 BG",
  "🇪🇪 EE", "🇱🇻 LV", "🇱🇹 LT", "🇲🇹 MT", "🇨🇾 CY", "🇱🇮 LI", "🇦🇩 AD", "🇸🇲 SM", "🇻🇦 VA",
  "🇧🇦 BA", "🇷🇸 RS", "🇲🇪 ME", "🇲🇰 MK", "🇦🇱 AL", "🇽🇰 XK", "🇲🇩 MD", "🇺🇦 UA", "🇧🇾 BY",
  "🇷🇺 RU", "🇬🇪 GE", "🇦🇲 AM", "🇦🇿 AZ",
  // Afrique (exhaustive)
  "🇲🇦 MA", "🇩🇿 DZ", "🇹🇳 TN", "🇱🇾 LY", "🇪🇬 EG", "🇸🇩 SD", "🇸🇸 SS", "🇸🇳 SN", "🇨🇮 CI",
  "🇨🇲 CM", "🇲🇱 ML", "🇧🇯 BJ", "🇹🇬 TG", "🇧🇫 BF", "🇲🇬 MG", "🇨🇩 CD", "🇨🇬 CG", "🇬🇦 GA",
  "🇳🇪 NE", "🇬🇳 GN", "🇲🇷 MR", "🇬🇼 GW", "🇬🇶 GQ", "🇹🇩 TD", "🇨🇫 CF", "🇷🇼 RW", "🇧🇮 BI",
  "🇩🇯 DJ", "🇸🇴 SO", "🇪🇷 ER", "🇪🇹 ET", "🇰🇪 KE", "🇺🇬 UG", "🇹🇿 TZ", "🇿🇲 ZM", "🇿🇼 ZW",
  "🇲🇼 MW", "🇲🇿 MZ", "🇦🇴 AO", "🇳🇦 NA", "🇧🇼 BW", "🇿🇦 ZA", "🇱🇸 LS", "🇸🇿 SZ", "🇬🇭 GH",
  "🇳🇬 NG", "🇱🇷 LR", "🇸🇱 SL", "🇬🇲 GM", "🇨🇻 CV", "🇰🇲 KM", "🇸🇨 SC", "🇲🇺 MU", "🇸🇹 ST",
  // Amériques
  "🇨🇦 CA", "🇺🇸 US", "🇲🇽 MX", "🇧🇷 BR", "🇦🇷 AR", "🇨🇱 CL", "🇨🇴 CO", "🇵🇪 PE",
  // Asie & Moyen-Orient
  "🇨🇳 CN", "🇯🇵 JP", "🇰🇷 KR", "🇮🇳 IN", "🇦🇪 AE", "🇸🇦 SA", "🇹🇷 TR", "🇱🇧 LB", "🇯🇴 JO", "🇶🇦 QA", "🇰🇼 KW", "🇮🇱 IL",
  // Océanie
  "🇦🇺 AU", "🇳🇿 NZ",
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
  const prefixes = { devis: "DEV", proforma: "PRO", revision: "REV", acompte: "ACO", avoir: "AVO", commande: "CMD", livraison: "BL", situation: "SIT", pv_reception: "PV", bpu: "BPU", rapport: "RI", contrat: "CTR", relance: "MED", planning: "PLN" };
  const prefix = prefixes[type] || "FAC";
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

const REVISION_SECTORS = [
  "Gros œuvre / Maçonnerie", "Plomberie / Sanitaire", "Électricité", "Menuiserie",
  "Peinture / Revêtements", "Couverture / Étanchéité", "Chauffage / Climatisation",
  "Carrelage / Sols", "Terrassement / VRD", "Métallerie / Serrurerie", "Isolation",
  "Travaux publics", "Réservoirs / Ouvrages hydrauliques", "Conduites / Canalisations",
  "Équipements électromécaniques", "Autre secteur",
];

// Repères par pays pour la révision de prix — uniquement là où la
// référence est bien établie et vérifiée. Pour tout autre pays, la
// formule reste la même (universelle, réglable) mais sans repère
// local inventé — mieux vaut ne rien affirmer que risquer une
// référence fausse sur un document professionnel.
const REVISION_COUNTRY_INFO = {
  "🇫🇷 FR": { currency: "EUR", indexHint: "BT01 - Index national du bâtiment tous corps d'état", authority: "INSEE (insee.fr)" },
  "🇧🇪 BE": { currency: "EUR", indexHint: "Indice I 2021 (Mercuriale des matériaux) + indice S (salaires)", authority: "SPF Économie (economie.fgov.be)" },
  "🇨🇭 CH": { currency: "CHF", indexHint: "Norme SIA 122 (méthode paramétrique) — indices KBOB/OFS", authority: "Office fédéral de la statistique (bfs.admin.ch)" },
  "🇱🇺 LU": { currency: "EUR", indexHint: "Indice STATEC des prix de la construction (par corps de métier)", authority: "STATEC (statistiques.public.lu) — matériaux : CRTIB (crtib.lu)" },
  "🇨🇦 CA": { currency: "CAD", indexHint: "IPCB - Indice des prix de la construction de bâtiments", authority: "Statistique Canada (statcan.gc.ca, tableau 18-10-0004-01)" },
  // Pays de l'UE / Espace économique européen : un indice de coût de la
  // construction harmonisé existe pour tous, encadré par un règlement
  // européen (Eurostat, code STS_COPI_m) — chacun a aussi son propre
  // institut national qui publie le détail.
  "🇩🇪 DE": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "Destatis (destatis.de)" },
  "🇪🇸 ES": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "INE (ine.es)" },
  "🇮🇹 IT": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "ISTAT (istat.it)" },
  "🇵🇹 PT": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "INE Portugal (ine.pt)" },
  "🇳🇱 NL": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "CBS (cbs.nl)" },
  "🇬🇧 GB": { currency: "GBP", indexHint: "Construction cost index (Eurostat / national)", authority: "ONS (ons.gov.uk)" },
  "🇮🇪 IE": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "CSO Irlande (cso.ie)" },
  "🇷🇴 RO": { currency: "RON", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "INS Roumanie (insse.ro)" },
  "🇵🇱 PL": { currency: "PLN", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "GUS (stat.gov.pl)" },
  "🇬🇷 GR": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "ELSTAT (statistics.gr)" },
  "🇦🇹 AT": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "Statistik Austria (statistik.at)" },
  "🇸🇪 SE": { currency: "SEK", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "SCB (scb.se)" },
  "🇳🇴 NO": { currency: "NOK", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "SSB (ssb.no)" },
  "🇩🇰 DK": { currency: "DKK", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "Danmarks Statistik (dst.dk)" },
  "🇫🇮 FI": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "Statistics Finland (stat.fi)" },
  "🇮🇸 IS": { currency: "ISK", indexHint: "Indice des coûts de construction", authority: "Statistics Iceland (statice.is)" },
  "🇭🇺 HU": { currency: "HUF", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "KSH (ksh.hu)" },
  "🇨🇿 CZ": { currency: "CZK", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "ČSÚ (czso.cz)" },
  "🇸🇰 SK": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "Štatistický úrad SR (statistics.sk)" },
  "🇭🇷 HR": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "DZS Croatie (dzs.hr)" },
  "🇧🇬 BG": { currency: "BGN", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "NSI Bulgarie (nsi.bg)" },
  "🇪🇪 EE": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "Statistics Estonia (stat.ee)" },
  "🇱🇻 LV": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "CSB Lettonie (stat.gov.lv)" },
  "🇱🇹 LT": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "Statistics Lithuania (stat.gov.lt)" },
  "🇲🇹 MT": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "NSO Malte (nso.gov.mt)" },
  "🇨🇾 CY": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "CYSTAT (cystat.gov.cy)" },
  "🇸🇮 SI": { currency: "EUR", indexHint: "Indice européen des coûts de construction (Eurostat)", authority: "SURS Slovénie (stat.si)" },
  "🇧🇦 BA": { currency: "BAM", indexHint: "Indice des coûts de construction (référence Eurostat régionale)", authority: "BHAS (bhas.gov.ba)" },
  "🇲🇪 ME": { currency: "EUR", indexHint: "Indice des coûts de construction (référence Eurostat régionale)", authority: "Monstat (monstat.org)" },
  "🇲🇰 MK": { currency: "MKD", indexHint: "Indice des coûts de construction (référence Eurostat régionale)", authority: "État statistique de Macédoine du Nord" },
  "🇦🇱 AL": { currency: "ALL", indexHint: "Indice des coûts de construction (référence Eurostat régionale)", authority: "INSTAT Albanie (instat.gov.al)" },
  "🇷🇸 RS": { currency: "RSD", indexHint: "Indice des coûts de construction (référence Eurostat régionale)", authority: "RZS Serbie (stat.gov.rs)" },
  "🇹🇷 TR": { currency: "TRY", indexHint: "Indice des coûts de construction (référence Eurostat régionale)", authority: "TÜİK Turquie (tuik.gov.tr)" },
  // Afrique francophone : repères vérifiés directement auprès des
  // instituts nationaux (pas de code d'indice deviné, uniquement ce
  // qui est réellement publié).
  "🇲🇦 MA": { currency: "MAD", indexHint: "BAT6 - Bâtiment tous corps d'état (barèmes d'indexation)", authority: "Ministère de l'Équipement et de l'Eau (index.ma ou bulletins officiels)" },
  "🇹🇳 TN": { currency: "TND", indexHint: "Indice des prix de la construction / immobilier", authority: "INS Tunisie (ins.tn)" },
  "🇨🇮 CI": { currency: "XOF", indexHint: "IABTP - Indicateur avancé des BTP", authority: "ANSTAT Côte d'Ivoire (anstat.ci)" },
  "🇨🇲 CM": { currency: "XAF", indexHint: "Indice des prix à la production industrielle (BTP)", authority: "INS Cameroun (ins-cameroun.cm)" },
  "🇸🇳 SN": { currency: "XOF", indexHint: "ICC - Indice du Coût de la Construction / IMC - Indice des Prix des Matériaux", authority: "ANSD Sénégal (ansd.sn)" },
  // Pays où seul l'institut national a pu être confirmé (pas de nom
  // d'indice BTP précis trouvé) — mieux vaut ce repère partiel
  // qu'une référence générique, mais moins précis que le Sénégal ou
  // la Côte d'Ivoire.
  "🇲🇱 ML": { currency: "XOF", indexHint: "Indice des prix de la construction (nom exact à vérifier)", authority: "INSTAT Mali" },
  "🇧🇯 BJ": { currency: "XOF", indexHint: "Indice des prix de la construction (nom exact à vérifier)", authority: "INSAE Bénin (instad.bj)" },
  "🇧🇫 BF": { currency: "XOF", indexHint: "Indice des prix de la construction (nom exact à vérifier)", authority: "INSD Burkina Faso" },
  "🇹🇩 TD": { currency: "XAF", indexHint: "Indice des prix de la construction (nom exact à vérifier)", authority: "INSEED Tchad" },
  "🇲🇬 MG": { currency: "MGA", indexHint: "Indice des prix de la construction (nom exact à vérifier)", authority: "INSTAT Madagascar" },
};
function getRevisionCountryInfo(country) {
  return REVISION_COUNTRY_INFO[country] || { currency: null, indexHint: "", authority: "l'organisme national de statistiques de ton pays" };
}

// Construit un lien de recherche vers la source officielle d'un
// indice — toujours une recherche (jamais une URL directe devinée),
// pour ne jamais tomber sur une erreur 404 : la structure exacte des
// sites officiels varie trop d'un pays à l'autre pour la deviner de
// façon fiable, et une recherche tolère les petites variations dans
// ce que la personne a tapé (casse, espaces...). L'opérateur "site:"
// cible directement le bon site quand on le connaît avec certitude.
function buildIndexSourceUrl(country, symbole) {
  // Les listes vérifiées (REVISION_INDEX_OPTIONS) stockent le symbole
  // au format "CODE - Description complète" — on ne garde que le code
  // pour la recherche, sinon la requête devient un paragraphe entier.
  const raw = (symbole || "").trim();
  if (!raw) return null;
  const code = raw.split(" - ")[0].trim();
  let query;
  if (country === "🇲🇦 MA") {
    query = `${code} site:index.ma`;
  } else if (country === "🇫🇷 FR") {
    query = `${code} site:insee.fr indice BT TP construction`;
  } else {
    const info = getRevisionCountryInfo(country);
    const authority = info.authority && info.authority !== "l'organisme national de statistiques de ton pays" ? info.authority : "";
    const countryCode = (country || "").replace(/[^\x00-\x7F]/g, "").trim(); // retire le drapeau, garde le code (ex: "BE")
    query = `${code} ${authority || "indice révision prix construction " + countryCode}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

// Listes de formules/indices officiels vérifiés directement auprès des
// sources nationales — uniquement pour les pays où j'ai pu confirmer
// la liste complète (pas de code deviné). Pour les autres pays, on
// retombe sur la saisie libre.
const REVISION_INDEX_OPTIONS = {
  "🇲🇦 MA": [
    "BAT1 - Gros œuvre, revêtement, étanchéité",
    "BAT2 - Menuiserie",
    "BAT3 - Électricité",
    "BAT4 - Plomberie sanitaire",
    "BAT5 - Peinture vitrerie",
    "BAT6 - Bâtiment tous corps d'état",
  ],
  "🇫🇷 FR": [
    "BT01 - Tous corps d'état",
    "BT02 - Terrassements",
    "BT03 - Maçonnerie et canalisations en béton",
    "BT06 - Ossature, ouvrages en béton armé",
    "BT07 - Ossature et charpentes métalliques",
    "BT08 - Plâtre et préfabriqués",
    "BT09 - Carrelage et revêtement céramique",
    "BT30 - Couverture en ardoises de schiste",
    "BT32 - Couverture en tuiles en terre cuite",
    "BT34 - Couverture en zinc et en métal",
    "BT55 - Isolation thermique par l'extérieur",
  ],
};
const REVISION_OTHER_OPTION = "Autre (je précise moi-même)";
function getRevisionIndexOptions(country) {
  return REVISION_INDEX_OPTIONS[country] || null;
}

// Un "terme" représente un indice de la formule (symbole + poids +
// valeur de base) — une formule à 1 seul terme donne l'ancien modèle
// simple, une formule à 5 ou 7 termes donne exactement ce qu'on voit
// dans les vrais marchés publics marocains (chaque contrat définit
// ses propres symboles et poids dans son CPS).
function emptyRevisionTerm() {
  return { id: nextId("tm"), symbole: "", poids: "", indexBase: "" };
}

function emptyRevisionSector(sector, country) {
  const info = getRevisionCountryInfo(country);
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: nextId("rs"),
    sector: sector || REVISION_SECTORS[0],
    coeffFixe: 0.15,
    terms: [{ ...emptyRevisionTerm(), symbole: info.indexHint || "", poids: 0.85 }],
    dateBase: today,
    articleCPS: "",
    tvaRate: 0.20,
    montantInitialHT: "",
    dateActuelle: today,
    valeursActuelles: {},
    useDecomptes: false,
    decomptes: [],
  };
}

function emptyMois() {
  return { id: nextId("ms"), date: new Date().toISOString().slice(0, 10), jours: "", valeurs: {} };
}

function emptyDecompte() {
  return { id: nextId("dc"), label: "", dateDecompte: new Date().toISOString().slice(0, 10), montantTotal: "", mois: [emptyMois()], isFinal: false };
}

function newRevisionDocument(sector, country, documents) {
  const info = getRevisionCountryInfo(country);
  return {
    id: nextId("doc"),
    type: "revision",
    docNumber: nextNumber(documents, "revision"),
    issueDate: new Date().toISOString().slice(0, 10),
    currency: info.currency || "EUR",
    country,
    marcheNumero: "",
    objet: "",
    dateDemarrage: "",
    sectors: [emptyRevisionSector(sector, country)],
    showTotal: false,
    company: { type: "entreprise", name: "", siret: "", address: "", country: country || "", email: "", phone: "", tva: "", logo: null },
    client: { type: "entreprise", name: "", address: "", country: "", email: "", phone: "" },
    clientId: null,
    notes: "",
    status: "brouillon",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Renvoie toujours un tableau de secteurs — recrée ce tableau à la
// volée pour un document créé avant ce changement (ancien modèle à
// un seul indice), en le transformant en formule à 1 terme, sans
// jamais rien casser de ce qui existe déjà.
function getRevisionSectors(doc) {
  if (Array.isArray(doc.sectors)) {
    // Migration silencieuse : d'anciens secteurs (juste après le
    // passage aux décomptes, avant les termes multiples) utilisaient
    // encore indexName/indexInitial/indexActuel/coeffVariable.
    return doc.sectors.map((s) => {
      if (Array.isArray(s.terms)) return s;
      const legacyTermId = "legacy-term";
      return {
        ...s,
        terms: [{ id: legacyTermId, symbole: s.indexName || "", poids: s.coeffVariable, indexBase: s.indexInitial }],
        dateBase: s.dateInitiale || doc.issueDate,
        valeursActuelles: { [legacyTermId]: s.indexActuel },
        decomptes: (s.decomptes || []).map((d) => ({ ...d, valeurs: { [legacyTermId]: d.indexValeur } })),
      };
    });
  }
  if (doc.sector !== undefined) {
    const legacyTermId = "legacy-term";
    return [{
      id: "legacy",
      sector: doc.sector,
      montantInitialHT: doc.montantInitialHT,
      coeffFixe: doc.coeffFixe,
      terms: [{ id: legacyTermId, symbole: doc.indexName || "", poids: doc.coeffVariable, indexBase: doc.indexInitial }],
      dateBase: doc.dateInitiale || doc.issueDate,
      dateActuelle: doc.dateActuelle || doc.issueDate,
      valeursActuelles: { [legacyTermId]: doc.indexActuel },
      useDecomptes: false,
      decomptes: [],
    }];
  }
  return [];
}

// Le montant initial "de référence" d'un secteur : soit sa valeur
// unique, soit la somme de ses décomptes s'il en utilise plusieurs.
function getSectorMontantInitial(line) {
  if (line?.useDecomptes && Array.isArray(line.decomptes)) {
    return line.decomptes.reduce((s, d) => s + (Number(d.montantTotal) || 0), 0);
  }
  return Number(line?.montantInitialHT) || 0;
}

// Calcule le coefficient de révision (P/P0) pour un jeu de valeurs
// d'indices donné, sans référence à un montant — utilisé pour
// calculer le coefficient MOIS PAR MOIS à l'intérieur d'un décompte.
function computeCoefficientOnly(sector, valeurs) {
  const terms = Array.isArray(sector?.terms) ? sector.terms : [];
  if (!terms.length) return { valid: false, coefficient: 0 };
  const a = Number(sector.coeffFixe) || 0;
  let variable = 0;
  for (const t of terms) {
    const base = Number(t.indexBase), val = Number(valeurs?.[t.id]);
    if (!base || !val) return { valid: false, coefficient: 0 };
    variable += (Number(t.poids) || 0) * (val / base);
  }
  return { valid: true, coefficient: a + variable };
}

// Cœur du calcul, valable pour 1 terme (formule simple, ex: Maroc
// BAT6) comme pour 7 termes (formule composite négociée au contrat) :
// coefficient = partie fixe + somme(poids du terme × valeur/valeur de base)
function computeRevisionAmount(sector, montantHT, valeurs) {
  const c0 = Number(montantHT) || 0;
  const terms = Array.isArray(sector?.terms) ? sector.terms : [];
  if (!c0 || !terms.length) return { valid: false, montantRevise: 0, ecartMontant: 0, coefficient: 0 };
  const a = Number(sector.coeffFixe) || 0;
  let variable = 0;
  for (const t of terms) {
    const base = Number(t.indexBase);
    const val = Number(valeurs?.[t.id]);
    if (!base || !val) return { valid: false, montantRevise: 0, ecartMontant: 0, coefficient: 0 };
    variable += (Number(t.poids) || 0) * (val / base);
  }
  const coefficient = a + variable;
  const montantRevise = c0 * coefficient;
  return { valid: true, montantRevise, ecartMontant: montantRevise - c0, coefficient };
}

// Calcule la révision d'un décompte (DP) qui peut couvrir plusieurs
// mois : le montant total du DP est réparti entre ses mois au
// prorata du nombre de jours de chacun, chaque mois appliquant son
// propre coefficient de révision (calculé avec ses propres valeurs
// d'indices) — exactement la méthode utilisée dans les vraies notes
// de calcul marocaines (DP1, DP2... avec répartition "jours / total").
function computeDecompteRevision(sector, decompte) {
  const montantTotal = Number(decompte?.montantTotal) || 0;
  const moisList = Array.isArray(decompte?.mois) ? decompte.mois : [];
  if (!montantTotal || !moisList.length) return { valid: false, montantRevise: 0, ecartMontant: 0, coefficient: 0, detail: [] };
  const totalJours = moisList.reduce((s, m) => s + (Number(m.jours) || 0), 0);
  if (!totalJours) return { valid: false, montantRevise: 0, ecartMontant: 0, coefficient: 0, detail: [] };

  let ecartTotal = 0;
  let allValid = true;
  const detail = moisList.map((m) => {
    const c = computeCoefficientOnly(sector, m.valeurs);
    const jours = Number(m.jours) || 0;
    if (!c.valid) { allValid = false; return { valid: false, jours }; }
    const delta = c.coefficient - 1;
    const ecart = montantTotal * delta * (jours / totalJours);
    ecartTotal += ecart;
    return { valid: true, coefficient: c.coefficient, delta, ecart, jours };
  });

  if (!allValid) return { valid: false, montantRevise: 0, ecartMontant: 0, coefficient: 0, detail };
  return { valid: true, montantRevise: montantTotal + ecartTotal, ecartMontant: ecartTotal, coefficient: 0, detail };
}

function computeRevisionLine(line) {
  if (line?.useDecomptes && Array.isArray(line.decomptes) && line.decomptes.length) {
    const results = line.decomptes.map((d) => computeDecompteRevision(line, d));
    const validResults = results.filter((r) => r.valid);
    if (!validResults.length) return { valid: false, montantRevise: 0, ecartMontant: 0, ecartPct: 0, coefficient: 0 };
    const montantInitial = getSectorMontantInitial(line);
    const montantRevise = validResults.reduce((s, r) => s + r.montantRevise, 0);
    const ecartMontant = montantRevise - montantInitial;
    const ecartPct = montantInitial ? (ecartMontant / montantInitial) * 100 : 0;
    return { valid: true, montantRevise, ecartMontant, ecartPct, coefficient: 0 };
  }
  const result = computeRevisionAmount(line, line?.montantInitialHT, line?.valeursActuelles);
  const c0 = Number(line?.montantInitialHT) || 0;
  const ecartPct = result.valid && c0 ? (result.ecartMontant / c0) * 100 : 0;
  return { ...result, ecartPct };
}

// Total combiné de tous les secteurs d'un document — c'est cette
// fonction que le tableau de bord et l'export comptable utilisent
// déjà (via computeRevision), donc rien à changer de leur côté.
// ===================== Situation de travaux =====================
// Facturation par tranches selon l'avancement du chantier. Chaque
// ligne garde son propre pourcentage d'avancement CUMULÉ (pas juste
// celui de cette situation), et le montant "déjà facturé" jusqu'à la
// situation précédente — ce qui permet de calculer automatiquement
// ce qui doit être facturé MAINTENANT (la différence), exactement
// comme une vraie situation de travaux de chantier.
function emptySituationLine() {
  return {
    id: nextId("sl"), type: "line",
    designation: "", unit: "forfait", qty: 1, unitPrice: 0, tva: 20,
    avancementPct: 0, montantCumulePrecedent: 0,
  };
}

function newSituationDocument(documents) {
  return {
    id: nextId("doc"),
    type: "situation",
    docNumber: nextNumber(documents, "situation"),
    issueDate: new Date().toISOString().slice(0, 10),
    currency: "EUR",
    numeroSituation: 1,
    previousSituationId: null,
    marcheNumero: "",
    objet: "",
    dateDebut: "",
    company: { type: "entreprise", name: "", siret: "", address: "", country: "", email: "", phone: "", tva: "", logo: null },
    client: { type: "entreprise", name: "", address: "", country: "", email: "", phone: "" },
    clientId: null,
    items: [emptySituationLine()],
    retenueGarantiePct: 5,
    acompteVerse: 0,
    notes: "",
    status: "brouillon",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function computeSituationLine(line) {
  const montantMarche = (Number(line.qty) || 0) * (Number(line.unitPrice) || 0);
  const montantCumuleActuel = (montantMarche * (Number(line.avancementPct) || 0)) / 100;
  const montantCumulePrecedent = Number(line.montantCumulePrecedent) || 0;
  const montantCetteSituation = montantCumuleActuel - montantCumulePrecedent;
  return { montantMarche, montantCumuleActuel, montantCumulePrecedent, montantCetteSituation };
}

function computeSituation(doc) {
  const lines = (doc.items || []).filter((l) => l.type === "line").map((l) => ({ ...l, ...computeSituationLine(l) }));
  const subtotalHT = lines.reduce((s, l) => s + l.montantCetteSituation, 0);
  const tvaGroups = {};
  lines.forEach((l) => {
    const rate = Number(l.tva) || 0;
    tvaGroups[rate] = (tvaGroups[rate] || 0) + (l.montantCetteSituation * rate) / 100;
  });
  const totalTVA = Object.values(tvaGroups).reduce((a, b) => a + b, 0);
  const totalTTCBrut = subtotalHT + totalTVA;
  const retenueGarantie = totalTTCBrut * ((Number(doc.retenueGarantiePct) || 0) / 100);
  const acompteVerse = Number(doc.acompteVerse) || 0;
  const netAPayer = totalTTCBrut - retenueGarantie - acompteVerse;
  const montantMarcheTotal = lines.reduce((s, l) => s + l.montantMarche, 0);
  const montantCumuleTotal = lines.reduce((s, l) => s + l.montantCumuleActuel, 0);
  const avancementGlobalPct = montantMarcheTotal ? (montantCumuleTotal / montantMarcheTotal) * 100 : 0;
  return { lines, subtotalHT, tvaGroups, totalTVA, totalTTCBrut, retenueGarantie, acompteVerse, netAPayer, montantMarcheTotal, montantCumuleTotal, avancementGlobalPct };
}

// Crée la situation suivante à partir d'une situation existante : le
// "déjà facturé" de chaque ligne devient automatiquement le cumul
// atteint par la situation précédente — c'est ce qui permet à la
// chaîne de situations de rester cohérente, sans jamais refacturer
// deux fois le même avancement.
function createNextSituation(sourceDoc, documents) {
  const computed = computeSituation(sourceDoc);
  const newItems = computed.lines.map((l) => ({
    id: nextId("sl"), type: "line",
    designation: l.designation, unit: l.unit, qty: l.qty, unitPrice: l.unitPrice, tva: l.tva,
    avancementPct: l.avancementPct,
    montantCumulePrecedent: Number(l.montantCumuleActuel.toFixed(2)),
  }));
  return {
    ...newSituationDocument(documents),
    numeroSituation: (sourceDoc.numeroSituation || 1) + 1,
    previousSituationId: sourceDoc.id,
    marcheNumero: sourceDoc.marcheNumero,
    objet: sourceDoc.objet,
    dateDebut: sourceDoc.dateDebut,
    company: sourceDoc.company,
    client: sourceDoc.client,
    clientId: sourceDoc.clientId,
    items: newItems,
    retenueGarantiePct: sourceDoc.retenueGarantiePct,
    currency: sourceDoc.currency,
  };
}
// ================= fin Situation de travaux =================

// ===================== PV de réception =====================
// Acte juridique bilatéral (signé par le client ET l'entreprise), pas
// une facture — structure volontairement différente : réserves
// éventuelles, et calcul automatique des dates de garantie légales
// françaises à partir de la date de réception effective.
function emptyReserve() {
  return { id: nextId("rv"), description: "", localisation: "", delaiJours: 30, levee: false };
}

function newPvReceptionDocument(documents) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: nextId("doc"),
    type: "pv_reception",
    docNumber: nextNumber(documents, "pv_reception"),
    issueDate: today,
    marcheNumero: "",
    objet: "",
    dateDebutTravaux: "",
    dateReceptionEffective: today,
    typeReception: "sans_reserves", // sans_reserves | avec_reserves | refusee
    reserves: [],
    company: { type: "entreprise", name: "", siret: "", address: "", country: "", email: "", phone: "", tva: "", logo: null },
    client: { type: "entreprise", name: "", address: "", country: "", email: "", phone: "" },
    clientId: null,
    signatureClient: { name: "", date: today },
    signatureEntreprise: { name: "", date: today },
    notes: "",
    status: "brouillon",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Les garanties légales françaises du bâtiment démarrent toutes à la
// date de réception — les calculer automatiquement évite une erreur
// facile à faire à la main (et souvent oubliée).
function computePvGaranties(doc) {
  if (!doc.dateReceptionEffective) return null;
  const base = new Date(doc.dateReceptionEffective);
  if (isNaN(base.getTime())) return null;
  const addTime = (months) => { const d = new Date(base); d.setMonth(d.getMonth() + months); return d; };
  return {
    parfaitAchevement: addTime(12),
    biennale: addTime(24),
    decennale: addTime(120),
  };
}
// ================= fin PV de réception =================

// ===================== Rapport d'intervention =====================
// Pour les artisans du dépannage/SAV (plombier, électricien...) — un
// diagnostic et un compte-rendu de visite, pas une facture. La durée
// se calcule automatiquement à partir des heures d'arrivée/départ.
function emptyMaterielUtilise() {
  return { id: nextId("mu"), designation: "", quantite: 1 };
}

function newRapportInterventionDocument(documents) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: nextId("doc"),
    type: "rapport",
    docNumber: nextNumber(documents, "rapport"),
    issueDate: today,
    company: { type: "entreprise", name: "", siret: "", address: "", country: "", email: "", phone: "", tva: "", logo: null },
    client: { type: "entreprise", name: "", address: "", country: "", email: "", phone: "" },
    clientId: null,
    adresseIntervention: "",
    typeIntervention: "depannage", // depannage | entretien | sav | diagnostic
    technicien: "",
    heureArrivee: "", heureDepart: "",
    motifAppel: "",
    diagnostic: "",
    travauxRealises: "",
    materielsUtilises: [],
    statutResolution: "resolu", // resolu | partiel | nouvelle_intervention
    recommandations: "",
    prochaineInterventionDate: "",
    signatureClient: { name: "", date: today },
    notes: "",
    status: "brouillon",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function computeInterventionDuree(doc) {
  if (!doc.heureArrivee || !doc.heureDepart) return null;
  const [h1, m1] = doc.heureArrivee.split(":").map(Number);
  const [h2, m2] = doc.heureDepart.split(":").map(Number);
  if ([h1, m1, h2, m2].some((n) => Number.isNaN(n))) return null;
  const minutes = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (minutes < 0) return null;
  return { heures: Math.floor(minutes / 60), minutes: minutes % 60, totalMinutes: minutes };
}
// ================= fin Rapport d'intervention =================

// ===================== Contrat de chantier =====================
// IMPORTANT : ce document fournit une STRUCTURE et des clauses de
// départ courantes, pas un avis juridique. Le texte pré-rempli est
// générique et doit être adapté (ou relu par un professionnel du
// droit) avant signature — c'est rappelé dans le formulaire et sur
// le PDF lui-même.
function newContratChantierDocument(documents) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: nextId("doc"),
    type: "contrat",
    docNumber: nextNumber(documents, "contrat"),
    issueDate: today,
    objetTravaux: "",
    montantTotalHT: "",
    tva: 20,
    dateDebutTravaux: "",
    dureeTravauxJours: "",
    modalitesPaiement: "30 % à la signature du contrat, 40 % à mi-chantier, 30 % à la réception des travaux.",
    penalitesRetard: "En cas de retard imputable à l'entreprise et non justifié par un cas de force majeure, une pénalité pourra être appliquée, dans les conditions à préciser entre les parties.",
    assurances: "L'entreprise déclare être couverte par une assurance responsabilité civile professionnelle et une assurance décennale pour les travaux concernés, dont elle remettra les attestations au maître d'ouvrage.",
    clauseResiliation: "Le contrat peut être résilié par écrit par l'une ou l'autre des parties en cas de manquement grave de l'autre partie à ses obligations, après mise en demeure restée sans effet.",
    clauseLitiges: "En cas de litige, les parties s'efforceront de trouver une solution amiable avant tout recours judiciaire.",
    company: { type: "entreprise", name: "", siret: "", address: "", country: "", email: "", phone: "", tva: "", logo: null },
    client: { type: "entreprise", name: "", address: "", country: "", email: "", phone: "" },
    clientId: null,
    signatureClient: { name: "", date: today },
    signatureEntreprise: { name: "", date: today },
    notes: "",
    status: "brouillon",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
// ================= fin Contrat de chantier =================

// ===================== Relance formelle (mise en demeure) =====================
// Version légale de la relance, au-delà du simple email déjà existant
// (bouton "Relancer par email" sur le tableau de bord). L'indemnité
// forfaitaire de 40 € est une obligation légale française entre
// professionnels (Code de commerce) — proposée par défaut, éditable.
function newRelanceFormelleDocument(documents) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: nextId("doc"),
    type: "relance",
    docNumber: nextNumber(documents, "relance"),
    issueDate: today,
    factureRef: "",
    factureDate: "",
    montantDu: "",
    dateEcheanceOrigine: "",
    delaiPaiementJours: 15,
    tauxInteretRetard: "3 fois le taux d'intérêt légal",
    indemniteForfaitaire: 40,
    company: { type: "entreprise", name: "", siret: "", address: "", country: "", email: "", phone: "", tva: "", logo: null },
    client: { type: "entreprise", name: "", address: "", country: "", email: "", phone: "" },
    clientId: null,
    notes: "",
    status: "brouillon",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function computeRelanceDateLimite(doc) {
  if (!doc.issueDate || !doc.delaiPaiementJours) return null;
  const d = new Date(doc.issueDate);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + (Number(doc.delaiPaiementJours) || 0));
  return d;
}
// ================= fin Relance formelle =================

// ===================== Planning de chantier =====================
// Le seul des 7 nouveaux services qui n'est pas vraiment un
// "document" — plutôt une frise chronologique visuelle des tâches du
// chantier. Le statut affiché tient compte de la date du jour même si
// personne ne l'a mis à jour manuellement (sauf "terminé", qui reste
// définitif une fois coché).
const PLANNING_COULEURS = ["#8AA6C7", "#B8763E", "#7A9E7E", "#B06A6A", "#9B87B0", "#C7A96B"];

function emptyTachePlanning(index = 0) {
  return { id: nextId("tc"), designation: "", dateDebut: "", dateFin: "", corpsMetier: "", statut: "a_venir", couleur: PLANNING_COULEURS[index % PLANNING_COULEURS.length] };
}

function newPlanningChantierDocument(documents) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: nextId("doc"),
    type: "planning",
    docNumber: nextNumber(documents, "planning"),
    issueDate: today,
    marcheNumero: "",
    objet: "",
    taches: [emptyTachePlanning(0)],
    company: { type: "entreprise", name: "", siret: "", address: "", country: "", email: "", phone: "", tva: "", logo: null },
    client: { type: "entreprise", name: "", address: "", country: "", email: "", phone: "" },
    clientId: null,
    notes: "",
    status: "brouillon",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// "Terminé" reste tel quel une fois coché ; sinon le statut se déduit
// de la date du jour comparée aux dates de la tâche.
function computeTacheStatutEffectif(tache) {
  if (tache.statut === "termine") return "termine";
  if (!tache.dateDebut && !tache.dateFin) return "a_venir";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const debut = tache.dateDebut ? new Date(tache.dateDebut) : null;
  const fin = tache.dateFin ? new Date(tache.dateFin) : null;
  if (fin && today > fin) return "retard";
  if (debut && today >= debut) return "en_cours";
  return "a_venir";
}

// Plage de dates globale du planning (première date de début à
// dernière date de fin) — sert à positionner chaque tâche
// proportionnellement sur la frise chronologique.
function computePlanningRange(doc) {
  const dates = [];
  (doc.taches || []).forEach((t) => {
    if (t.dateDebut) dates.push(new Date(t.dateDebut));
    if (t.dateFin) dates.push(new Date(t.dateFin));
  });
  if (!dates.length) return null;
  const min = new Date(Math.min(...dates));
  const max = new Date(Math.max(...dates));
  const totalDays = Math.max(1, Math.round((max - min) / 86400000));
  return { min, max, totalDays };
}

function computeTachePosition(tache, range) {
  if (!range || !tache.dateDebut || !tache.dateFin) return null;
  const debut = new Date(tache.dateDebut), fin = new Date(tache.dateFin);
  const offsetDays = Math.max(0, Math.round((debut - range.min) / 86400000));
  const durationDays = Math.max(1, Math.round((fin - debut) / 86400000) + 1);
  return { leftPct: (offsetDays / range.totalDays) * 100, widthPct: (durationDays / range.totalDays) * 100 };
}
// ================= fin Planning de chantier =================

function computeRevision(doc) {
  const sectors = getRevisionSectors(doc);
  const lines = sectors.map(computeRevisionLine);
  const validLines = lines.filter((l) => l.valid);
  if (!validLines.length) return { valid: false, montantRevise: 0, ecartMontant: 0, ecartPct: 0, coefficient: 0 };
  const montantInitialTotal = sectors.reduce((s, l) => s + getSectorMontantInitial(l), 0);
  const montantRevise = validLines.reduce((s, l) => s + l.montantRevise, 0);
  const ecartMontant = montantRevise - montantInitialTotal;
  const ecartPct = montantInitialTotal ? (ecartMontant / montantInitialTotal) * 100 : 0;
  return { valid: true, montantRevise, ecartMontant, ecartPct, montantInitialTotal, coefficient: 0 };
}

// Construit une feuille Excel au format marocain pour UN secteur d'UN
// document — fonction partagée entre l'export d'un seul document et
// l'export groupé de plusieurs documents (tableau de bord), pour ne
// jamais avoir deux versions différentes de cette mise en forme.
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildMarocRevisionSheet(workbook, doc, sec, namePrefix = "") {
  const up = (v) => String(v ?? "").toUpperCase();
  const COL = {
    label: "FFEDEDED", jours: "FFDCEEFB", situation: "FFE2F0D9", index: "FFFFF2CC",
    lettre: "FFFCE4D6", ppo: "FFE4DFEC", pct: "FFFCE4EC", montant: "FFD9F2E6",
    formule: "FFE8ECF5", revision: "FFFAD9D9", dpLabel: "FFD6E4F0", blank: "FF000000",
  };
  const thinBorder = { style: "thin", color: { argb: "FFB7B7B7" } };
  const allBorders = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };
  function fillCell(cell, color, opts = {}) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    cell.border = allBorders;
    if (opts.bold) cell.font = { bold: true };
    cell.alignment = { horizontal: opts.align, vertical: "middle", wrapText: !!opts.wrap };
  }

  const terms = sec.terms || [];
  const nCols = 8 + terms.length * 2;
  const sheetName0 = up(`${namePrefix}${sec.sector || "SECTEUR"}`).replace(/[\\/*?:[\]]/g, "").slice(0, 31) || "SECTEUR";
  let sheetName = sheetName0, n = 2;
  while (workbook.getWorksheet(sheetName)) { sheetName = `${sheetName0.slice(0, 28)} (${n})`; n++; }
  const ws = workbook.addWorksheet(sheetName);

  const widths = [10, 14, ...terms.map(() => 12), ...terms.map(() => 8), 9, 9, 15, 15, 22, 15];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const labelSpan = Math.min(5, nCols);

  let r = 1;
  function labelRow(text, mergeTo, opts = {}) {
    ws.mergeCells(r, 1, r, mergeTo || Math.min(4, nCols));
    const cell = ws.getCell(r, 1);
    cell.value = up(text);
    fillCell(cell, COL.label, { bold: true, align: "center", wrap: !!opts.wrap });
    if (opts.wrap) ws.getRow(r).height = 30;
    r++;
  }
  function kvRow(label, values) {
    ws.mergeCells(r, 1, r, labelSpan);
    const cell = ws.getCell(r, 1);
    cell.value = up(label);
    fillCell(cell, COL.label, { bold: true, align: "left" });
    (values || []).forEach((v, i) => {
      const c = ws.getCell(r, labelSpan + 1 + i);
      c.value = v;
      fillCell(c, COL.label, { align: "left" });
    });
    r++;
  }

  labelRow("NOTE DE CALCUL DE LA REVISION DES PRIX", nCols);
  r++;
  labelRow(`MARCHE N°: ${doc.marcheNumero || ""}`, nCols);
  r++;
  labelRow(doc.objet || "", nCols, { wrap: true });
  r++;
  labelRow(`STE : ${doc.company.name || ""}`, nCols);
  r++;
  kvRow("Date de soumission :", [sec.dateBase ? fr(sec.dateBase) : ""]);
  kvRow("Symbole d'index:", terms.map((t) => up(t.symbole || "")));
  kvRow("Index de base:", terms.map((t) => Number(t.indexBase) || ""));
  kvRow("T.V.A Initiale", [Number(sec.tvaRate ?? 0.20)]);
  if (sec.articleCPS) kvRow("Article / référence du contrat :", [up(sec.articleCPS)]);
  if (doc.dateDemarrage) kvRow("Ordre de service de commencer des travaux:", [fr(doc.dateDemarrage)]);
  const a = Number(sec.coeffFixe) || 0;
  const termLetters = terms.map((_, i) => String.fromCharCode(65 + i));
  kvRow("Formule de révision des prix", [up(`P/P0 = ${a} + ${termLetters.join(" + ")}`)]);
  terms.forEach((t, i) => kvRow(`${termLetters[i]} = ${t.poids}*(${up(t.symbole || "?")}/${up(t.symbole || "?")}0)`, []));
  r++;

  const headers = ["N.B JOURS", "SITUATION"];
  terms.forEach((t) => headers.push(`INDEX ${up(t.symbole || "?")}`));
  termLetters.forEach((l) => headers.push(l));
  headers.push("P/P0", "%", "MT DE DECOMPTE", "MT A REVISER", "FORMULE", "MT DE LA REVISION");
  const headerColors = ["jours", "situation", ...terms.map(() => "index"), ...terms.map(() => "lettre"), "ppo", "pct", "montant", "montant", "formule", "revision"];
  headers.forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    fillCell(c, COL[headerColors[i]], { bold: true, align: "center" });
  });
  r++;

  let totalHT = 0;
  (sec.decomptes && sec.decomptes.length ? sec.decomptes : []).forEach((d) => {
    if (d.isBlank) {
      ws.mergeCells(r, 1, r, nCols);
      const c = ws.getCell(r, 1);
      c.value = "";
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COL.blank } };
      c.border = allBorders;
      r++;
      return;
    }
    if (d.label) {
      ws.mergeCells(r, 1, r, nCols);
      const c = ws.getCell(r, 1);
      c.value = up(d.label);
      fillCell(c, COL.dpLabel, { bold: true, align: "center" });
      r++;
    }
    const dr = computeDecompteRevision(sec, d);
    const totalJours = (d.mois || []).reduce((s, m) => s + (Number(m.jours) || 0), 0);
    (d.mois || []).forEach((m, mIdx) => {
      const detail = (dr.detail || [])[mIdx];
      const values = [Number(m.jours) || "", m.date ? frShort(m.date) : ""];
      terms.forEach((t) => values.push(Number(m.valeurs?.[t.id]) || ""));
      terms.forEach((t) => {
        const base = Number(t.indexBase), val = Number(m.valeurs?.[t.id]);
        values.push(base && val ? Number(((Number(t.poids) || 0) * (val / base)).toFixed(4)) : "");
      });
      values.push(detail?.valid ? Number(detail.coefficient.toFixed(4)) : "");
      values.push(detail?.valid ? Number(detail.delta.toFixed(4)) : "");
      values.push(Number(d.montantTotal) || "");
      values.push(Number(d.montantTotal) || "");
      values.push(detail?.valid ? up(`x ${detail.delta.toFixed(4)} x ${m.jours}/${totalJours}`) : "");
      values.push(detail?.valid ? Number(detail.ecart.toFixed(2)) : "");
      values.forEach((v, i) => {
        const c = ws.getCell(r, i + 1);
        c.value = v;
        fillCell(c, COL[headerColors[i]]);
      });
      r++;
    });
    const subCell = ws.getCell(r, 1);
    subCell.value = totalJours;
    fillCell(subCell, COL.jours, { bold: true });
    const subResult = ws.getCell(r, nCols);
    subResult.value = dr.valid ? Number(dr.ecartMontant.toFixed(2)) : "";
    fillCell(subResult, COL.revision, { bold: true });
    for (let cc = 2; cc < nCols; cc++) { const c = ws.getCell(r, cc); c.value = ""; c.border = allBorders; }
    r++;
    if (dr.valid) totalHT += dr.ecartMontant;
  });

  if (!sec.useDecomptes) {
    const rr = computeRevisionLine(sec);
    const values = ["", sec.dateActuelle ? frShort(sec.dateActuelle) : ""];
    terms.forEach((t) => values.push(Number(sec.valeursActuelles?.[t.id]) || ""));
    terms.forEach((t) => {
      const base = Number(t.indexBase), val = Number(sec.valeursActuelles?.[t.id]);
      values.push(base && val ? Number(((Number(t.poids) || 0) * (val / base)).toFixed(4)) : "");
    });
    values.push(rr.valid ? Number(rr.coefficient.toFixed(4)) : "");
    values.push(rr.valid ? Number((rr.coefficient - 1).toFixed(4)) : "");
    values.push(Number(sec.montantInitialHT) || "");
    values.push(Number(sec.montantInitialHT) || "");
    values.push("");
    values.push(rr.valid ? Number(rr.ecartMontant.toFixed(2)) : "");
    values.forEach((v, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = v;
      fillCell(c, COL[headerColors[i]]);
    });
    r++;
    if (rr.valid) totalHT += rr.ecartMontant;
  }

  r++;
  const tvaRate = Number(sec.tvaRate ?? 0.20);
  function totalRow(label, value, color) {
    ws.mergeCells(r, 1, r, nCols - 2);
    const lc = ws.getCell(r, 1);
    lc.value = up(label);
    fillCell(lc, COL.label, { bold: true, align: "right" });
    ws.mergeCells(r, nCols - 1, r, nCols);
    const vc = ws.getCell(r, nCols - 1);
    vc.value = Number(value.toFixed(2));
    fillCell(vc, color, { bold: true, align: "right" });
    r++;
  }
  totalRow("Total de la révision des prix HTVA", totalHT, COL.revision);
  totalRow(`TVA ${Math.round(tvaRate * 100)}%`, totalHT * tvaRate, COL.revision);
  totalRow("Total de la révision des prix TTC", totalHT * (1 + tvaRate), COL.revision);
  r++;
  ws.mergeCells(r, 1, r, Math.floor(nCols / 2));
  const ent = ws.getCell(r, 1);
  ent.value = "ENTREPRISE";
  fillCell(ent, COL.label, { bold: true, align: "center" });
  ws.mergeCells(r, Math.floor(nCols / 2) + 1, r, nCols);
  const srv = ws.getCell(r, Math.floor(nCols / 2) + 1);
  srv.value = "SERVICE / MAÎTRE D'OUVRAGE";
  fillCell(srv, COL.label, { bold: true, align: "center" });
}

function newDocument(type, documents) {
  const base = {
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
  // Facture d'acompte : doit référencer le devis/marché d'origine et
  // savoir combien reste à facturer après cet acompte — sans ça, ce
  // n'est qu'une facture ordinaire mal nommée.
  if (type === "acompte") {
    return { ...base, sourceDevisRef: "", montantMarcheHT: "", acompteMode: "pourcentage", acomptePourcentage: 30, acompteMontantFixe: "", notes: "" };
  }
  // Avoir : la référence à la facture d'origine et le motif sont
  // obligatoires pour qu'un avoir soit valide (article 289 du CGI).
  if (type === "avoir") {
    return { ...base, factureOrigineRef: "", motifAvoir: "", notes: "" };
  }
  // Bon de commande : s'adresse à un FOURNISSEUR, pas à un client —
  // le champ "client" est réutilisé (même structure nom/adresse) mais
  // affiché comme "Fournisseur" partout dans l'interface et le PDF.
  if (type === "commande") {
    return { ...base, dateLivraisonSouhaitee: "", adresseLivraison: "", conditionsPaiement: "", notes: "" };
  }
  // Bon de livraison : pas de prix par défaut (juste des quantités),
  // une référence à la commande/au devis d'origine, un état de
  // livraison, et la personne qui réceptionne (avec signature).
  if (type === "livraison") {
    return { ...base, commandeRef: "", etatLivraison: "conforme", reservesLivraison: "", showPrices: false, notes: "" };
  }
  // Bordereau de prix unitaires : liste de prix de référence, pas une
  // facturation — les quantités sont estimatives (pas engageantes), et
  // le bordereau a une durée de validité, avec révision possible.
  if (type === "bpu") {
    return { ...base, dureeValidite: "", referenceRevision: "", notes: "" };
  }
  return base;
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
  const hidePrices = doc.type === "livraison" && !doc.showPrices;
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

      {doc.type === "acompte" && (doc.sourceDevisRef || Number(doc.montantMarcheHT) > 0) && (() => {
        const montantMarche = Number(doc.montantMarcheHT) || 0;
        const montantAcompte = (doc.acompteMode || "pourcentage") === "pourcentage" ? (montantMarche * (Number(doc.acomptePourcentage) || 0)) / 100 : (Number(doc.acompteMontantFixe) || 0);
        const reste = montantMarche - montantAcompte;
        return (
          <div style={{ marginBottom: "18px", padding: "10px 14px", borderRadius: "4px", background: box, fontSize: "9.5pt", position: "relative", zIndex: 1 }}>
            {doc.sourceDevisRef && <div>Facture d'acompte sur devis / marché <strong>{doc.sourceDevisRef}</strong></div>}
            {montantMarche > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", color: inkSoft }}>
                <span>Montant total du marché HT : {formatMoney(montantMarche, doc.currency)}</span>
                <span>Reste à facturer après cet acompte : <strong style={{ color: ink }}>{formatMoney(reste, doc.currency)}</strong></span>
              </div>
            )}
          </div>
        );
      })()}

      {doc.type === "avoir" && (doc.factureOrigineRef || doc.motifAvoir) && (
        <div style={{ marginBottom: "18px", padding: "10px 14px", borderRadius: "4px", background: "#F9E3E0", color: "#8A2E1F", fontSize: "9.5pt", position: "relative", zIndex: 1 }}>
          {doc.factureOrigineRef && <div><strong>AVOIR sur la facture N° {doc.factureOrigineRef}</strong></div>}
          {doc.motifAvoir && <div style={{ marginTop: "2px" }}>Motif : {doc.motifAvoir}</div>}
        </div>
      )}

      {doc.type === "commande" && (doc.dateLivraisonSouhaitee || doc.conditionsPaiement || doc.adresseLivraison) && (
        <div style={{ marginBottom: "18px", padding: "10px 14px", borderRadius: "4px", background: box, fontSize: "9.5pt", position: "relative", zIndex: 1 }}>
          {doc.dateLivraisonSouhaitee && <div>Livraison souhaitée le : <strong>{frLong(doc.dateLivraisonSouhaitee)}</strong></div>}
          {doc.adresseLivraison && <div style={{ marginTop: "2px" }}>Adresse de livraison : {doc.adresseLivraison}</div>}
          {doc.conditionsPaiement && <div style={{ marginTop: "2px" }}>Conditions de paiement : {doc.conditionsPaiement}</div>}
        </div>
      )}

      {doc.type === "livraison" && (doc.commandeRef || doc.etatLivraison) && (
        <div style={{ marginBottom: "18px", padding: "10px 14px", borderRadius: "4px", background: doc.etatLivraison === "conforme" ? box : "#F9E3E0", fontSize: "9.5pt", position: "relative", zIndex: 1 }}>
          {doc.commandeRef && <div>Référence commande / devis : <strong>{doc.commandeRef}</strong></div>}
          <div style={{ marginTop: "2px" }}>État de la livraison : <strong>{doc.etatLivraison === "conforme" ? "Conforme" : doc.etatLivraison === "reserves" ? "Livré avec réserves" : "Livraison incomplète"}</strong></div>
          {doc.reservesLivraison && doc.etatLivraison !== "conforme" && <div style={{ marginTop: "2px" }}>{doc.reservesLivraison}</div>}
        </div>
      )}

      {doc.type === "bpu" && (
        <div style={{ marginBottom: "18px", padding: "10px 14px", borderRadius: "4px", background: box, fontSize: "9.5pt", position: "relative", zIndex: 1 }}>
          <div style={{ fontStyle: "italic", color: inkSoft }}>Bordereau de prix de référence — les quantités indiquées sont estimatives, non engageantes.</div>
          {doc.dureeValidite && <div style={{ marginTop: "2px" }}>Durée de validité des prix : <strong>{doc.dureeValidite}</strong></div>}
          {doc.referenceRevision && <div style={{ marginTop: "2px" }}>Révision des prix : {doc.referenceRevision}</div>}
        </div>
      )}

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
            <th style={{ textAlign: "right", padding: "6px 6px", fontSize: "8pt" }}>{doc.type === "bpu" ? "Qté estim." : "Qté"}</th>
            <th style={{ textAlign: "left", padding: "6px 6px", fontSize: "8pt" }}>Unité</th>
            {!hidePrices && <th style={{ textAlign: "right", padding: "6px 6px", fontSize: "8pt" }}>PU HT</th>}
            {!hidePrices && <th style={{ textAlign: "right", padding: "6px 6px", fontSize: "8pt" }}>% TVA</th>}
            {!hidePrices && <th style={{ textAlign: "right", padding: "6px 6px", fontSize: "8pt" }}>Total TVA</th>}
            {!hidePrices && <th style={{ textAlign: "right", padding: "6px 6px", fontSize: "8pt" }}>Total HT</th>}
          </tr>
        </thead>
        <tbody>
          {lineItems.map((it, idx) => it.type === "section" ? (
            (it.title || it.subtitle) && (
              <tr key={it.id} style={{ pageBreakInside: "avoid" }}>
                <td colSpan={hidePrices ? 3 : 7} style={{ paddingTop: "10px", paddingBottom: "2px", borderBottom: `1.5px solid ${brass}` }}>
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
                {!hidePrices && (isMargin ? (
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
                ))}
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

        {!hidePrices && (
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
              <span>{doc.type === "bpu" ? "Montant total estimatif" : "Net à payer"}</span><span style={mono}>{formatMoney(totalTTC, doc.currency)}</span>
            </div>
            {Number(doc.acompte) > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", fontWeight: 700, color: brassDark }}>
                <span>Reste à payer</span><span style={mono}>{formatMoney(resteAPayer, doc.currency)}</span>
              </div>
            )}
          </div>
        )}
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
  // Repère de diagnostic temporaire : affiche dans la console (F12)
  // l'heure exacte à laquelle l'application démarre. Si cette ligne
  // réapparaît avec une NOUVELLE heure après être revenu sur l'onglet,
  // ça prouve qu'un vrai rechargement de page a eu lieu. Si elle ne
  // réapparaît pas, la page n'a pas rechargé — la cause est ailleurs.
  useEffect(() => {
    console.log(`%c🔵 DeviFact démarré à ${new Date().toLocaleTimeString("fr-FR")}`, "background:#1B2A33;color:white;padding:4px 8px;border-radius:4px;font-weight:bold;");
  }, []);

  const [view, setView] = useState(() => {
    if (typeof window === "undefined") return "dashboard";
    // Priorité absolue : si on revient d'un paiement Stripe, toujours
    // atterrir sur la page Tarifs (pour voir la confirmation), même si
    // une autre page était mémorisée avant de partir payer.
    if (new URLSearchParams(window.location.search).get("paiement")) return "pricing";
    return sessionStorage.getItem("devifact_lastView") || "dashboard";
  });
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
  const [activeId, setActiveId] = useState(() => (typeof window !== "undefined" && sessionStorage.getItem("devifact_lastActiveId")) || null);
  // Garde en mémoire l'identifiant de la personne dont les données sont
  // actuellement chargées — permet de savoir, dans le gestionnaire de
  // connexion, si un événement concerne vraiment un changement de
  // compte ou juste une revalidation de la même session.
  const currentUserIdRef = useRef(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("tous");
  const [revisionCountry, setRevisionCountry] = useState("🇫🇷 FR");
  const [limitNotice, setLimitNotice] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [batchExportDoc, setBatchExportDoc] = useState(null);
  const [batchExporting, setBatchExporting] = useState(false);
  const batchPrintRef = useRef(null);
  const [splitNotice, setSplitNotice] = useState(null);
  const [savingPlanSettings, setSavingPlanSettings] = useState(false);
  const [preAuthView, setPreAuthView] = useState("landing"); // landing | auth
  const [siteSettings, setSiteSettings] = useState({ name: "DeviFact", logo: null, logoWidth: 36, logoHeight: 36, pdfBackground: "#FBF7EF", pdfHeaderColor: "#1B2A33", pdfBlockColor: "#F1F0EA", contactEmail: "contact@chantiflow.fr" });
  const [savingSiteSettings, setSavingSiteSettings] = useState(false);
  const [authMode, setAuthMode] = useState("signup");
  // Le titre affiché dans l'onglet du navigateur vient du fichier
  // index.html (figé une fois pour toutes) — on le remplace ici
  // dynamiquement dès que le vrai nom du site est chargé, pour qu'il
  // reste toujours synchronisé avec ce qui est configuré dans Admin.
  useEffect(() => {
    if (siteSettings?.name) document.title = siteSettings.name;
  }, [siteSettings?.name]);

  const [plans, setPlans] = useState(PLANS);

  async function loadProfile(userId, email, preferredOrgId = null) {
    const { data: profile } = await db.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (!profile) return null;

    let { data: memberships } = await db
      .from("organization_members")
      .select("role, organization_id, organizations ( id, name, plan, billing_cycle, payment_status )")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    // Auto-réparation : un compte sans AUCUNE organisation est un état
    // cassé (ne devrait jamais arriver, mais un souci passager à
    // l'inscription — ou une ancienne remise à zéro de la base — a pu
    // en laisser certains dans cet état). Plutôt que de laisser la
    // personne bloquée sans le comprendre, on lui crée son espace ici,
    // silencieusement, dès la prochaine connexion.
    if (!memberships || memberships.length === 0) {
      console.warn("Compte sans organisation détecté — création automatique d'un espace de secours.");

      // S'assure que la session est bien pleinement établie avant
      // d'agir — appelée juste après une connexion, cette fonction
      // peut sinon s'exécuter une fraction de seconde trop tôt,
      // avant que les requêtes suivantes soient correctement
      // authentifiées, ce qui ferait échouer les règles de sécurité
      // même si elles sont correctement configurées.
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: sessionData } = await db.auth.getSession();
        if (sessionData?.session?.access_token) break;
        await new Promise((r) => setTimeout(r, 300));
      }

      let healed = false;
      for (let attempt = 0; attempt < 2 && !healed; attempt++) {
        if (attempt > 0) {
          console.warn(`Nouvelle tentative de réparation automatique (essai ${attempt + 1})...`);
          await new Promise((r) => setTimeout(r, 500));
        }
        // Identifiant généré ici plutôt que par la base : évite d'avoir
        // à relire la ligne juste après l'avoir créée, ce que la règle
        // de lecture bloquerait tant qu'on n'est pas encore membre de
        // cette organisation (même principe que "Créer mon propre espace").
        const newOrgId = crypto.randomUUID();
        const { error: orgError } = await db.from("organizations").insert({ id: newOrgId, name: profile.company_name || email });
        if (orgError) {
          console.error(`Échec de la création automatique de l'espace de secours (essai ${attempt + 1})`, orgError);
          continue;
        }
        const { error: memberError } = await db.from("organization_members").insert({ organization_id: newOrgId, user_id: userId, role: "owner", status: "active" });
        if (memberError) {
          console.error(`Échec de l'ajout comme propriétaire de l'espace de secours (essai ${attempt + 1})`, memberError);
          continue;
        }
        const { data: retried } = await db
          .from("organization_members")
          .select("role, organization_id, organizations ( id, name, plan, billing_cycle, payment_status )")
          .eq("user_id", userId)
          .eq("status", "active")
          .order("created_at", { ascending: true });
        memberships = retried;
        healed = true;
        console.warn("Espace de secours créé avec succès.");
      }
    }

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
        stripePriceIdMonthly: row.stripe_price_id_monthly || "",
        stripePriceIdAnnual: row.stripe_price_id_annual || "",
        cardPaymentEnabled: row.card_payment_enabled ?? true,
        paypalPaymentEnabled: row.paypal_payment_enabled ?? true,
        watermarkEnabled: row.watermark_enabled ?? true,
      };
    });
    setPlans(merged);
  }

  // Liste de tous les utilisateurs du site — lecture seule, réservée
  // à l'Admin (voir migration_admin_voir_utilisateurs.sql pour la
  // règle de sécurité qui permet cette lecture élargie).
  const [allUsers, setAllUsers] = useState([]);
  const [allUsersError, setAllUsersError] = useState("");
  async function loadAllUsers() {
    const { data, error } = await db.from("profiles").select("id, email, first_name, last_name, company_name, is_admin, created_at, confirmed_at, last_confirmation_sent_at").order("created_at", { ascending: false });
    if (error) {
      console.error("Erreur de chargement de la liste des utilisateurs", error);
      setAllUsersError(error.message || "Erreur inconnue");
      return;
    }
    setAllUsersError("");
    setAllUsers(data || []);
  }
  useEffect(() => {
    if (view === "admin" && account?.isAdmin) loadAllUsers();
  }, [view, account?.isAdmin]);
  const [resendingConfirmationId, setResendingConfirmationId] = useState(null);
  async function resendConfirmation(userId) {
    setResendingConfirmationId(userId);
    try {
      const { data, error } = await db.functions.invoke("send-confirmation-email", { body: { userId } });
      if (error || data?.error) {
        alert(`Impossible d'envoyer l'email : ${data?.error || error?.message || "erreur inconnue"}`);
      } else {
        alert("Email de confirmation renvoyé.");
        await loadAllUsers();
      }
    } catch (err) {
      console.error("Erreur de relance de confirmation", err);
      alert("Impossible d'envoyer l'email. Réessaie dans un instant.");
    } finally {
      setResendingConfirmationId(null);
    }
  }
  async function updatePlanPaypalId(planId, field, value) {
    setSavingPlanSettings(true);
    const column = field === "monthly" ? "paypal_plan_id_monthly" : "paypal_plan_id_annual";
    const { error } = await db.from("plans").update({ [column]: value || null }).eq("id", planId);
    if (error) console.error("Erreur de mise à jour de l'identifiant PayPal (droits admin requis)", error);
    await loadPlans();
    setSavingPlanSettings(false);
  }

  async function updatePlanStripeId(planId, field, value) {
    setSavingPlanSettings(true);
    const column = field === "monthly" ? "stripe_price_id_monthly" : "stripe_price_id_annual";
    const { error } = await db.from("plans").update({ [column]: value || null }).eq("id", planId);
    if (error) console.error("Erreur de mise à jour de l'identifiant Stripe (droits admin requis)", error);
    await loadPlans();
    setSavingPlanSettings(false);
  }
  async function toggleCardPayment(planId) {
    setSavingPlanSettings(true);
    const plan = plans.find((p) => p.id === planId);
    const { error } = await db.from("plans").update({ card_payment_enabled: !(plan?.cardPaymentEnabled ?? true) }).eq("id", planId);
    if (error) console.error("Erreur de mise à jour de l'affichage du paiement par carte (droits admin requis)", error);
    await loadPlans();
    setSavingPlanSettings(false);
  }
  async function togglePaypalPayment(planId) {
    setSavingPlanSettings(true);
    const plan = plans.find((p) => p.id === planId);
    const { error } = await db.from("plans").update({ paypal_payment_enabled: !(plan?.paypalPaymentEnabled ?? true) }).eq("id", planId);
    if (error) console.error("Erreur de mise à jour de l'affichage de PayPal (droits admin requis)", error);
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
      visibleServices: data.visible_services || null,
      contactEmail: data.contact_email || "contact@chantiflow.fr",
    });
  }
  async function updateSiteSettings(patch) {
    setSavingSiteSettings(true);
    const column = { name: "name", logo: "logo_url", logoWidth: "logo_width", logoHeight: "logo_height", pdfBackground: "pdf_background", pdfHeaderColor: "pdf_header_color", pdfBlockColor: "pdf_block_color", visibleServices: "visible_services", contactEmail: "contact_email" };
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
    // Efface aussi la position mémorisée (vue + document actif) : sans
    // ça, un autre compte se connectant dans le même onglet pourrait
    // se retrouver ramené sur un document qui ne lui appartient pas.
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("devifact_lastView");
      sessionStorage.removeItem("devifact_lastActiveId");
    }
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

  // Pour une personne arrivée uniquement via une invitation (jamais
  // inscrite par elle-même) : lui permet de se créer son propre
  // espace, séparé de celui où elle a été invitée, en réutilisant
  // exactement la même logique que l'inscription classique.
  const [creatingOwnOrg, setCreatingOwnOrg] = useState(false);
  async function createMyOwnOrganization() {
    const { data: { user } } = await db.auth.getUser();
    if (!user) return;
    setCreatingOwnOrg(true);
    try {
      // Identifiant généré ici plutôt que par la base : évite d'avoir à
      // relire la ligne juste après l'avoir créée (.select().single()),
      // ce que la règle de lecture bloque tant qu'on n'est pas encore
      // membre de cette organisation — un problème classique de
      // "poule et œuf" avec ce genre de sécurité en base de données.
      const newOrgId = crypto.randomUUID();
      const { error: orgError } = await db.from("organizations").insert({ id: newOrgId, name: user.email });
      if (orgError) {
        console.error("Erreur de création de l'organisation", orgError);
        alert(`Impossible de créer ton espace (${orgError.message || "erreur inconnue"}). Réessaie dans un instant.`);
        return;
      }
      const { error: memberError } = await db.from("organization_members").insert({ organization_id: newOrgId, user_id: user.id, role: "owner", status: "active" });
      if (memberError) {
        console.error("Erreur d'ajout comme propriétaire", memberError);
        alert(`Impossible de créer ton espace (${memberError.message || "erreur inconnue"}). Réessaie dans un instant.`);
        return;
      }
      await switchOrganization(newOrgId);
    } finally {
      setCreatingOwnOrg(false);
    }
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
          // Important : ne recharger (et donc vider l'écran en cours) que
          // si c'est vraiment une personne DIFFÉRENTE qui vient de se
          // connecter — jamais en se basant sur le type d'événement
          // (SIGNED_IN, TOKEN_REFRESHED...), car le comportement exact
          // varie et n'est pas garanti d'un cas à l'autre. Ici, si
          // l'identifiant de la personne est le même que celui déjà
          // chargé, on ne touche à rien — ça couvre aussi bien le retour
          // sur l'onglet après une mise en veille que le rafraîchissement
          // automatique du jeton de session.
          if (currentUserIdRef.current === session.user.id) {
            setLoading(false);
            return;
          }
          currentUserIdRef.current = session.user.id;
          // Vider d'abord toute donnée encore en mémoire (d'un compte
          // précédent) avant de charger celles de cette connexion —
          // même précaution que switchOrganization, pour ne jamais
          // laisser des documents d'un autre compte s'afficher, même
          // brièvement, pendant le chargement.
          clearUserData();
          const profile = await loadProfile(session.user.id, session.user.email);
          setActiveOrganization(profile?.organizationId || null);
          await loadUserData();
          setAccount(profile);
        } else {
          currentUserIdRef.current = null;
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

  // Détecte un lien de confirmation ("?confirm=...") dans l'adresse —
  // fonctionne que la personne soit connectée ou non sur cet appareil
  // (elle clique depuis sa boîte mail, pas forcément depuis la même
  // session). Voir migration_confirmation_8_semaines.sql.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("confirm");
    if (!token) return;
    (async () => {
      const { data: ok, error } = await db.rpc("confirm_account", { token });
      if (error || !ok) {
        alert("Ce lien de confirmation n'est plus valide (déjà utilisé, ou expiré).");
      } else {
        alert("Ton adresse email est confirmée. Merci !");
      }
      const params = new URLSearchParams(window.location.search);
      params.delete("confirm");
      window.history.replaceState({}, "", window.location.pathname + (params.toString() ? `?${params.toString()}` : ""));
    })();
  }, []);

  // Mémorise en continu la vue et le document actuellement ouverts —
  // ainsi, si le navigateur recharge la page toute seule (mise en
  // veille d'un onglet inactif pour économiser la mémoire, fréquente
  // en changeant de fenêtre), la personne retrouve exactement où elle
  // en était plutôt que d'être ramenée au tableau de bord.
  useEffect(() => {
    if (typeof window === "undefined" || !account) return;
    if (view && view !== "dashboard") sessionStorage.setItem("devifact_lastView", view);
    else sessionStorage.removeItem("devifact_lastView");
    if (activeId) sessionStorage.setItem("devifact_lastActiveId", activeId);
    else sessionStorage.removeItem("devifact_lastActiveId");
  }, [view, activeId, account]);

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
    const { data, error } = await db.from("organizations").update({ plan: "gratuit", payment_status: "gratuit" }).eq("id", account.organizationId).select();
    if (error) { console.error("Erreur de passage au forfait gratuit", error); alert(`Impossible de changer de forfait : ${error.message || "erreur inconnue"}`); return; }
    if (!data || data.length === 0) { console.error("Aucune ligne modifiée (passage au forfait gratuit) — probablement bloqué par une règle de sécurité."); alert("Impossible de changer de forfait : la mise à jour a été bloquée."); return; }
    setAccount((prev) => ({ ...prev, plan: "gratuit", paymentStatus: "gratuit" }));
  }
  // Active directement un forfait payant dont le prix est à 0€, sans passer
  // par PayPal (inutile de créer une souscription pour un montant nul).
  // Sûr : le prix vient de la table "plans" en base, que seul un admin
  // peut modifier (RLS) — un utilisateur ne peut pas déclencher ceci en
  // falsifiant un prix depuis son navigateur.
  async function chooseZeroPricePlan(planId, billingCycle) {
    console.log("[Activer 0€] Démarrage — planId:", planId, "billingCycle:", billingCycle, "organizationId:", account?.organizationId);
    if (!account?.organizationId) {
      console.error("[Activer 0€] ARRÊT : aucune organisation active sur ce compte.");
      alert("Impossible d'activer ce forfait : aucune organisation active sur ce compte. Reconnecte-toi et réessaie.");
      return false;
    }
    // .select() ajouté exprès : sans lui, une mise à jour bloquée par une
    // règle de sécurité (RLS) peut renvoyer "succès" tout en n'ayant
    // modifié aucune ligne, sans la moindre erreur — invisible sinon.
    const { data, error } = await db.from("organizations").update({ plan: planId, billing_cycle: billingCycle, payment_status: "payé" }).eq("id", account.organizationId).select();
    console.log("[Activer 0€] Réponse de la base — data:", data, "error:", error);
    if (error) {
      console.error("[Activer 0€] Erreur d'activation du forfait à 0€", error);
      alert(`Impossible d'activer ce forfait : ${error.message || "erreur inconnue"}`);
      return false;
    }
    if (!data || data.length === 0) {
      console.error("[Activer 0€] Aucune ligne modifiée — probablement bloqué par une règle de sécurité (RLS) sur la table organizations.");
      alert("Impossible d'activer ce forfait : la mise à jour a été bloquée (probablement un droit d'accès insuffisant). Regarde la console (F12) pour le détail, et signale ce message.");
      return false;
    }
    console.log("[Activer 0€] Succès — nouvelle ligne organizations :", data[0]);
    setAccount((prev) => ({ ...prev, plan: planId, billing: billingCycle, paymentStatus: "payé" }));
    return true;
  }
  async function togglePaymentStatus() {
    if (!account?.organizationId) return;
    const nextStatus = account.paymentStatus === "payé" ? "impayé" : "payé";
    const { data, error } = await db.from("organizations").update({ payment_status: nextStatus }).eq("id", account.organizationId).select();
    if (error) { console.error("Erreur de mise à jour du statut de paiement", error); alert(`Impossible de mettre à jour le statut : ${error.message || "erreur inconnue"}`); return; }
    if (!data || data.length === 0) { console.error("Aucune ligne modifiée (statut de paiement) — probablement bloqué par une règle de sécurité."); alert("Impossible de mettre à jour le statut : la mise à jour a été bloquée."); return; }
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
    const doc = type === "situation" ? newSituationDocument(documents) : type === "pv_reception" ? newPvReceptionDocument(documents) : type === "rapport" ? newRapportInterventionDocument(documents) : type === "contrat" ? newContratChantierDocument(documents) : type === "relance" ? newRelanceFormelleDocument(documents) : type === "planning" ? newPlanningChantierDocument(documents) : newDocument(type, documents);
    if (companyProfile.name) doc.company = { ...companyProfile };
    persist([doc, ...documents]);
    setActiveId(doc.id);
    setView(type === "situation" ? "situation-editor" : type === "pv_reception" ? "pv-editor" : type === "rapport" ? "rapport-editor" : type === "contrat" ? "contrat-editor" : type === "relance" ? "relance-editor" : type === "planning" ? "planning-editor" : "editor");
  }
  function createNextSituationDoc(sourceDoc) {
    const plan = plans.find((p) => p.id === (account?.plan || "gratuit")) || PLANS[0];
    if (documents.length >= plan.limit) {
      setLimitNotice(true);
      setView("pricing");
      return;
    }
    const doc = createNextSituation(sourceDoc, documents);
    persist([doc, ...documents]);
    setActiveId(doc.id);
    setView("situation-editor");
  }
  function openNewRevision(sector, country) {
    const plan = plans.find((p) => p.id === (account?.plan || "gratuit")) || PLANS[0];
    if (documents.length >= plan.limit) {
      setLimitNotice(true);
      setView("pricing");
      return;
    }
    const doc = newRevisionDocument(sector, country, documents);
    if (companyProfile.name) doc.company = { ...companyProfile };
    persist([doc, ...documents]);
    setActiveId(doc.id);
    setView("revision-editor");
  }
  function openDoc(id) {
    const target = documents.find((d) => d.id === id);
    setActiveId(id);
    setView(target?.type === "revision" ? "revision-editor" : target?.type === "situation" ? "situation-editor" : target?.type === "pv_reception" ? "pv-editor" : target?.type === "rapport" ? "rapport-editor" : target?.type === "contrat" ? "contrat-editor" : target?.type === "relance" ? "relance-editor" : target?.type === "planning" ? "planning-editor" : "editor");
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
  // Excel groupé : un classeur, une feuille par document (les
  // révisions Maroc peuvent en avoir plusieurs, une par secteur).
  async function exportBatchExcel(docs) {
    if (!docs.length) return;
    const type = docs[0].type;
    if (type === "revision") {
      const { default: ExcelJS } = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      docs.forEach((doc) => {
        const sectors = getRevisionSectors(doc);
        const prefix = `${doc.docNumber} `;
        sectors.forEach((sec) => {
          buildMarocRevisionSheet(workbook, doc, sec, prefix);
        });
      });
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      downloadBlob(blob, "Revisions-groupees.xlsx");
      return;
    }
    if (type === "situation") {
      const wb = XLSX.utils.book_new();
      docs.forEach((doc) => {
        const s = computeSituation(doc);
        const rows = [];
        rows.push(["SITUATION DE TRAVAUX", `N° ${doc.numeroSituation || 1}`]);
        rows.push(["Référence", doc.docNumber]);
        rows.push(["Marché N°", doc.marcheNumero || ""]);
        rows.push(["Avancement global", `${s.avancementGlobalPct.toFixed(1)}%`]);
        rows.push([]);
        rows.push(["Désignation", "Montant marché", "% cumulé", "Cumul atteint", "Déjà facturé", "Cette situation"]);
        s.lines.forEach((l) => {
          rows.push([l.designation, Number(l.montantMarche.toFixed(2)), Number(l.avancementPct) || 0, Number(l.montantCumuleActuel.toFixed(2)), Number(l.montantCumulePrecedent.toFixed(2)), Number(l.montantCetteSituation.toFixed(2))]);
        });
        rows.push([]);
        rows.push(["", "", "", "", "Net à payer", Number(s.netAPayer.toFixed(2))]);
        const ws = XLSX.utils.aoa_to_sheet(rows);
        let sheetName = doc.docNumber.replace(/[\\/*?:[\]]/g, "").slice(0, 31);
        let n = 2;
        while (wb.SheetNames.includes(sheetName)) { sheetName = `${doc.docNumber.slice(0, 28)} (${n})`; n++; }
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });
      XLSX.writeFile(wb, "Situations-groupees.xlsx");
      return;
    }
    if (type === "pv_reception" || type === "rapport" || type === "contrat" || type === "relance" || type === "planning") {
      // Pas de structure en lignes de prix pour ces types — une
      // feuille "fiche" avec les champs clés plutôt qu'un tableau.
      const wb = XLSX.utils.book_new();
      docs.forEach((doc) => {
        const rows = [];
        if (type === "pv_reception") {
          rows.push(["PV DE RÉCEPTION", doc.docNumber]);
          rows.push(["Date de réception", doc.dateReceptionEffective ? fr(doc.dateReceptionEffective) : ""]);
          rows.push(["Marché N°", doc.marcheNumero || ""]);
          rows.push(["Client", doc.client?.name || ""]);
          rows.push(["Type de réception", (PV_TYPES[doc.typeReception] || {}).label || ""]);
          rows.push([]);
          rows.push(["Réserves", "Localisation", "Délai (jours)", "Levée"]);
          (doc.reserves || []).forEach((r) => rows.push([r.description, r.localisation, r.delaiJours, r.levee ? "Oui" : "Non"]));
        } else if (type === "rapport") {
          rows.push(["RAPPORT D'INTERVENTION", doc.docNumber]);
          rows.push(["Date", fr(doc.issueDate)]);
          rows.push(["Client", doc.client?.name || ""]);
          rows.push(["Technicien", doc.technicien || ""]);
          rows.push(["Motif de l'appel", doc.motifAppel || ""]);
          rows.push(["Diagnostic", doc.diagnostic || ""]);
          rows.push(["Travaux réalisés", doc.travauxRealises || ""]);
          rows.push(["Statut", (STATUTS_RESOLUTION[doc.statutResolution] || {}).label || ""]);
        } else if (type === "contrat") {
          rows.push(["CONTRAT DE CHANTIER", doc.docNumber]);
          rows.push(["Date", fr(doc.issueDate)]);
          rows.push(["Entreprise", doc.company?.name || ""]);
          rows.push(["Maître d'ouvrage", doc.client?.name || ""]);
          rows.push(["Objet des travaux", doc.objetTravaux || ""]);
          rows.push(["Montant total HT", Number(doc.montantTotalHT) || 0]);
          rows.push(["TVA %", Number(doc.tva) || 0]);
          rows.push(["Modalités de paiement", doc.modalitesPaiement || ""]);
          rows.push(["Début des travaux", doc.dateDebutTravaux ? fr(doc.dateDebutTravaux) : ""]);
        } else if (type === "relance") {
          const dateLimite = computeRelanceDateLimite(doc);
          rows.push(["MISE EN DEMEURE", doc.docNumber]);
          rows.push(["Date d'émission", fr(doc.issueDate)]);
          rows.push(["Client débiteur", doc.client?.name || ""]);
          rows.push(["Facture concernée", doc.factureRef || ""]);
          rows.push(["Montant dû", Number(doc.montantDu) || 0]);
          rows.push(["Délai accordé (jours)", doc.delaiPaiementJours || ""]);
          rows.push(["Date limite de paiement", dateLimite ? dateLimite.toLocaleDateString("fr-FR") : ""]);
        } else if (type === "planning") {
          rows.push(["PLANNING DE CHANTIER", doc.docNumber]);
          rows.push(["Date", fr(doc.issueDate)]);
          rows.push(["Marché N°", doc.marcheNumero || ""]);
          rows.push(["Objet", doc.objet || ""]);
          rows.push([]);
          rows.push(["Tâche", "Corps de métier", "Début", "Fin", "Statut"]);
          (doc.taches || []).forEach((t) => rows.push([t.designation, t.corpsMetier, t.dateDebut ? fr(t.dateDebut) : "", t.dateFin ? fr(t.dateFin) : "", (STATUTS_TACHE[computeTacheStatutEffectif(t)] || {}).label || ""]));
        }
        const ws = XLSX.utils.aoa_to_sheet(rows);
        let sheetName = doc.docNumber.replace(/[\\/*?:[\]]/g, "").slice(0, 31);
        let n = 2;
        while (wb.SheetNames.includes(sheetName)) { sheetName = `${doc.docNumber.slice(0, 28)} (${n})`; n++; }
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });
      XLSX.writeFile(wb, `${docTypeLabel(type)}s-groupes.xlsx`);
      return;
    }
    const wb = XLSX.utils.book_new();
    docs.forEach((doc) => {
      const t = computeTotals(doc);
      const rows = [];
      rows.push([docTypeLabel(doc.type).toUpperCase(), doc.docNumber]);
      rows.push(["Date", fr(doc.issueDate)]);
      rows.push(["Client", doc.client?.name || ""]);
      rows.push([]);
      rows.push(["Désignation", "Qté", "Prix unitaire HT", "TVA %", "Total HT"]);
      t.computedLines.forEach((line) => {
        rows.push([line.designation || "", Number(line.qty) || 0, Number(line.unitPrice) || 0, Number(line.tva) || 0, Number(line.totalHT.toFixed(2))]);
      });
      rows.push([]);
      rows.push(["", "", "", "Total HT", Number(t.subtotalHT.toFixed(2))]);
      rows.push(["", "", "", "Total TVA", Number(t.totalTVA.toFixed(2))]);
      rows.push(["", "", "", "Total TTC", Number(t.totalTTC.toFixed(2))]);
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{ wch: 32 }, { wch: 8 }, { wch: 14 }, { wch: 8 }, { wch: 14 }];
      let sheetName = doc.docNumber.replace(/[\\/*?:[\]]/g, "").slice(0, 31);
      let n = 2;
      while (wb.SheetNames.includes(sheetName)) { sheetName = `${doc.docNumber.slice(0, 28)} (${n})`; n++; }
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
    XLSX.writeFile(wb, `${docTypeLabel(type)}s-groupes.xlsx`);
  }

  // PDF groupé : un seul fichier, une page (ou plus) par document —
  // rendu séquentiellement dans une zone cachée puis capturé.
  async function exportBatchPdf(docs) {
    if (!docs.length || batchExporting) return;
    setBatchExporting(true);
    const isRevision = docs[0].type === "revision";
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: isRevision ? "landscape" : "portrait" });
    try {
      for (let i = 0; i < docs.length; i++) {
        setBatchExportDoc(docs[i]);
        // Laisse React monter/mettre à jour le rendu caché avant de capturer
        // (marge un peu large : les révisions à plusieurs secteurs ont
        // beaucoup de contenu à afficher avant d'être prêtes).
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        await new Promise((res) => setTimeout(res, 120));
        const el = batchPrintRef.current;
        if (!el) continue;
        el.style.display = "block";
        const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: siteSettings?.pdfBackground || "#FBF7EF" });
        const imgData = canvas.toDataURL("image/jpeg", 0.95);
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgHeight = (canvas.height * pageWidth) / canvas.width;
        if (i > 0) pdf.addPage();
        let heightLeft = imgHeight, position = 0;
        pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight);
        heightLeft -= pageHeight;
        while (heightLeft > 3) {
          position -= pageHeight;
          pdf.addPage();
          pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight);
          heightLeft -= pageHeight;
        }
      }
      pdf.save(`${docTypeLabel(docs[0].type)}s-groupes.pdf`);
    } catch (err) {
      console.error("Erreur d'export PDF groupé", err);
      alert("Impossible de générer le PDF groupé. Réessaie, et préviens-moi si ça persiste.");
    } finally {
      setBatchExportDoc(null);
      setBatchExporting(false);
    }
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
        if (d.type === "revision") {
          const r = computeRevision(d);
          rows.push([docTypeLabel(d.type), d.docNumber, fr(new Date(d.issueDate)), d.client.name || "", d.status, Number((r.montantInitialTotal || 0).toFixed(2)), Number(r.ecartMontant.toFixed(2)), Number(r.montantRevise.toFixed(2))]);
          return;
        }
        if (d.type === "situation") {
          const s = computeSituation(d);
          rows.push([docTypeLabel(d.type), d.docNumber, fr(new Date(d.issueDate)), d.client.name || "", d.status, Number(s.subtotalHT.toFixed(2)), Number(s.totalTVA.toFixed(2)), Number(s.totalTTCBrut.toFixed(2))]);
          return;
        }
        if (d.type === "contrat") {
          const ht = Number(d.montantTotalHT) || 0;
          const tva = ht * (Number(d.tva) || 0) / 100;
          rows.push([docTypeLabel(d.type), d.docNumber, fr(new Date(d.issueDate)), d.client.name || "", d.status, Number(ht.toFixed(2)), Number(tva.toFixed(2)), Number((ht + tva).toFixed(2))]);
          return;
        }
        if (d.type === "relance") {
          rows.push([docTypeLabel(d.type), d.docNumber, fr(new Date(d.issueDate)), d.client.name || "", d.status, "", "", Number((Number(d.montantDu) || 0).toFixed(2))]);
          return;
        }
        const t = computeTotals(d);
        rows.push([
          docTypeLabel(d.type), d.docNumber, fr(new Date(d.issueDate)), d.client.name || "",
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

  if (view === "revision-editor" && activeDoc) {
    return (
      <RevisionEditor
        doc={activeDoc}
        saving={saving}
        clients={clients}
        account={account}
        plans={plans}
        siteSettings={siteSettings}
        isLocked={isLocked}
        isViewer={isViewer}
        onChange={(patch) => updateDoc(activeDoc.id, patch)}
        onBack={backToDashboard}
        onSaveClient={upsertClient}
        onGoToPricing={() => setView("pricing")}
      />
    );
  }

  if (view === "situation-editor" && activeDoc) {
    return (
      <SituationEditor
        doc={activeDoc}
        documents={documents}
        saving={saving}
        account={account}
        plans={plans}
        siteSettings={siteSettings}
        isLocked={isLocked}
        isViewer={isViewer}
        onChange={(patch) => updateDoc(activeDoc.id, patch)}
        onBack={backToDashboard}
        onCreateNext={createNextSituationDoc}
        onGoToPricing={() => setView("pricing")}
      />
    );
  }

  if (view === "pv-editor" && activeDoc) {
    return (
      <PvReceptionEditor
        doc={activeDoc}
        saving={saving}
        account={account}
        plans={plans}
        siteSettings={siteSettings}
        isLocked={isLocked}
        isViewer={isViewer}
        onChange={(patch) => updateDoc(activeDoc.id, patch)}
        onBack={backToDashboard}
        onGoToPricing={() => setView("pricing")}
      />
    );
  }

  if (view === "rapport-editor" && activeDoc) {
    return (
      <RapportInterventionEditor
        doc={activeDoc}
        saving={saving}
        account={account}
        plans={plans}
        siteSettings={siteSettings}
        isLocked={isLocked}
        isViewer={isViewer}
        onChange={(patch) => updateDoc(activeDoc.id, patch)}
        onBack={backToDashboard}
        onGoToPricing={() => setView("pricing")}
      />
    );
  }

  if (view === "contrat-editor" && activeDoc) {
    return (
      <ContratChantierEditor
        doc={activeDoc}
        saving={saving}
        account={account}
        plans={plans}
        siteSettings={siteSettings}
        isLocked={isLocked}
        isViewer={isViewer}
        onChange={(patch) => updateDoc(activeDoc.id, patch)}
        onBack={backToDashboard}
        onGoToPricing={() => setView("pricing")}
      />
    );
  }

  if (view === "relance-editor" && activeDoc) {
    return (
      <RelanceFormelleEditor
        doc={activeDoc}
        saving={saving}
        account={account}
        plans={plans}
        siteSettings={siteSettings}
        isLocked={isLocked}
        isViewer={isViewer}
        onChange={(patch) => updateDoc(activeDoc.id, patch)}
        onBack={backToDashboard}
        onGoToPricing={() => setView("pricing")}
      />
    );
  }

  if (view === "planning-editor" && activeDoc) {
    return (
      <PlanningChantierEditor
        doc={activeDoc}
        saving={saving}
        account={account}
        plans={plans}
        siteSettings={siteSettings}
        isLocked={isLocked}
        isViewer={isViewer}
        onChange={(patch) => updateDoc(activeDoc.id, patch)}
        onBack={backToDashboard}
        onGoToPricing={() => setView("pricing")}
      />
    );
  }

  const visibleServices = siteSettings?.visibleServices || SERVICES.filter((s) => s.implemented).map((s) => s.id);
  function openNewService(serviceId) {
    const svc = getService(serviceId);
    if (!svc) return;
    if (!svc.implemented) {
      alert(`"${svc.label}" est encore en développement — bientôt disponible !`);
      return;
    }
    if (serviceId === "revision") { setView("revision-sector"); return; }
    if (serviceId === "devis" || serviceId === "facture" || serviceId === "proforma" || serviceId === "acompte" || serviceId === "avoir" || serviceId === "commande" || serviceId === "livraison" || serviceId === "situation" || serviceId === "pv_reception" || serviceId === "bpu" || serviceId === "rapport" || serviceId === "contrat" || serviceId === "relance" || serviceId === "planning") {
      openNew(serviceId);
      return;
    }
  }
  const navProps = { view, setView, onNewDevis: () => openNew("devis"), onNewFacture: () => openNew("facture"), onNewProforma: () => openNew("proforma"), onNewRevision: () => setView("revision-sector"), onNewService: openNewService, visibleServices, account, onLogout: logout, onSwitchOrganization: switchOrganization, onCreateOwnOrg: createMyOwnOrganization, creatingOwnOrg, siteSettings, companyProfile, onSetCompanyType: (type) => { persistCompanyProfile({ ...companyProfile, type }); setView("company"); } };

  if (view === "revision-sector") {
    const countryInfo = getRevisionCountryInfo(revisionCountry);
    return (
      <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <button onClick={backToDashboard} className="no-print mb-4 flex items-center gap-1 text-sm" style={{ color: colors.inkSoft }}><ArrowLeft size={15} /> Retour</button>
          <h1 className="df-display mb-1 text-2xl font-semibold">Nouvelle révision de prix</h1>
          <p className="mb-6 text-sm" style={{ color: colors.inkSoft }}>Choisis le pays, puis le secteur concerné.</p>

          <label className="mb-1 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Pays</label>
          <div className="mb-2 max-w-sm">
            <CountrySelect
              value={revisionCountry}
              onChange={setRevisionCountry}
              options={COUNTRIES.filter((c) => c !== "Autre")}
              allowOther
              showEmpty={false}
            />
          </div>
          <div className="mb-6 flex items-start gap-2 rounded-lg p-3 text-xs" style={{ background: colors.surface, border: `1px solid ${colors.line}`, color: colors.inkSoft }}>
            <Info size={14} className="mt-0.5 shrink-0" />
            {countryInfo.currency ? (
              <span>Devise suggérée : <strong>{countryInfo.currency}</strong>. Indice de référence usuel : <strong>{countryInfo.indexHint}</strong>, publié par {countryInfo.authority}. À vérifier avec ton contrat.</span>
            ) : (
              <span>Pas de repère spécifique enregistré pour ce pays — renseigne toi-même le nom et les valeurs de l'indice applicable (contrat, ou {countryInfo.authority}). La formule de calcul reste la même et s'adapte à tes propres valeurs.</span>
            )}
          </div>

          <label className="mb-2 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Secteur</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {REVISION_SECTORS.map((sector) => (
              <button
                key={sector}
                onClick={() => openNewRevision(sector, revisionCountry)}
                className="flex items-center justify-between gap-2 rounded-xl px-4 py-3 text-left text-sm font-medium"
                style={{ background: colors.surface, border: `1px solid ${colors.line}` }}
              >
                {sector} <ArrowRight size={15} style={{ color: colors.inkSoft }} />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

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

  if (view === "api") {
    return (
      <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <ApiView account={account} />
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
          onChooseZeroPrice={async (planId, billingCycle) => { const ok = await chooseZeroPricePlan(planId, billingCycle); if (ok) { setLimitNotice(false); setView("dashboard"); } }}
          limitNotice={limitNotice}
          documentCount={documents.length}
          siteSettings={siteSettings}
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
          onUpdatePlanStripeId={updatePlanStripeId}
          onToggleCardPayment={toggleCardPayment}
          onTogglePaypalPayment={togglePaypalPayment}
          onTogglePayment={togglePaymentStatus}
          onDeleteAccount={deleteCurrentAccount}
          siteSettings={siteSettings}
          savingSiteSettings={savingSiteSettings}
          onUpdateSiteSettings={updateSiteSettings}
          allUsers={allUsers}
          allUsersError={allUsersError}
          onResendConfirmation={resendConfirmation}
          resendingConfirmationId={resendingConfirmationId}
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
            {[["tous", "Tous"], ["devis", "Devis"], ["facture", "Factures"], ["proforma", "Proforma"], ["revision", "Révisions"]].map(([id, label]) => (
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
            const canBatchExport = selectedDocs.length >= 2 && sameType;
            return (
              <div className="ml-auto flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: colors.paper, border: `1px solid ${colors.line}` }}>
                <span className="text-xs font-medium" style={{ color: colors.inkSoft }}>{selectedIds.length} sélectionné(s)</span>
                {(selectedDocs[0]?.type === "devis" || selectedDocs[0]?.type === "facture") && (
                  <button
                    onClick={() => canMerge && mergeDocuments(selectedIds)}
                    disabled={!canMerge}
                    title={!sameType ? "Sélectionne uniquement des devis ou uniquement des factures" : selectedDocs.length < 2 ? "Sélectionne au moins 2 documents" : "Fusionner en un seul document"}
                    className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
                    style={{ background: canMerge ? colors.slate : colors.line, color: canMerge ? "white" : colors.inkSoft, cursor: canMerge ? "pointer" : "not-allowed" }}
                  >
                    <GitMerge size={13} /> Fusionner
                  </button>
                )}
                <button
                  onClick={() => canBatchExport && exportBatchExcel(selectedDocs)}
                  disabled={!canBatchExport}
                  title={!sameType ? "Sélectionne des documents du même type (tous devis, ou toutes factures...)" : selectedDocs.length < 2 ? "Sélectionne au moins 2 documents" : "Un seul fichier Excel, un onglet par document"}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
                  style={{ background: canBatchExport ? colors.moss : colors.line, color: canBatchExport ? "white" : colors.inkSoft, cursor: canBatchExport ? "pointer" : "not-allowed" }}
                >
                  <FileSpreadsheet size={13} /> Excel
                </button>
                <button
                  onClick={() => canBatchExport && exportBatchPdf(selectedDocs)}
                  disabled={!canBatchExport || batchExporting}
                  title={!sameType ? "Sélectionne des documents du même type (tous devis, ou toutes factures...)" : selectedDocs.length < 2 ? "Sélectionne au moins 2 documents" : "Un seul PDF, une page par document"}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
                  style={{ background: canBatchExport ? colors.brass : colors.line, color: canBatchExport ? colors.ink : colors.inkSoft, cursor: canBatchExport ? "pointer" : "not-allowed" }}
                >
                  {batchExporting ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />} PDF
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
              const isRevision = d.type === "revision";
              const isSituation = d.type === "situation";
              const totalTTC = isRevision ? computeRevision(d).montantRevise
                : isSituation ? computeSituation(d).netAPayer
                : d.type === "contrat" ? (Number(d.montantTotalHT) || 0) * (1 + (Number(d.tva) || 0) / 100)
                : d.type === "relance" ? (Number(d.montantDu) || 0)
                : computeTotals(d).totalTTC;
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

      <div style={{ position: "fixed", top: 0, left: "-9999px", zIndex: -1 }}>
        {batchExportDoc && (() => {
          const wmEnabled = (plans.find((p) => p.id === (account?.plan || "gratuit"))?.watermarkEnabled) !== false;
          if (batchExportDoc.type === "revision") return <PrintRevision ref={batchPrintRef} doc={batchExportDoc} siteSettings={siteSettings} watermarkEnabled={wmEnabled} />;
          if (batchExportDoc.type === "situation") return <PrintSituation ref={batchPrintRef} doc={batchExportDoc} siteSettings={siteSettings} watermarkEnabled={wmEnabled} />;
          if (batchExportDoc.type === "pv_reception") return <PrintPvReception ref={batchPrintRef} doc={batchExportDoc} siteSettings={siteSettings} watermarkEnabled={wmEnabled} />;
          if (batchExportDoc.type === "rapport") return <PrintRapportIntervention ref={batchPrintRef} doc={batchExportDoc} siteSettings={siteSettings} watermarkEnabled={wmEnabled} />;
          if (batchExportDoc.type === "contrat") return <PrintContrat ref={batchPrintRef} doc={batchExportDoc} siteSettings={siteSettings} watermarkEnabled={wmEnabled} />;
          if (batchExportDoc.type === "relance") return <PrintRelance ref={batchPrintRef} doc={batchExportDoc} siteSettings={siteSettings} watermarkEnabled={wmEnabled} />;
          if (batchExportDoc.type === "planning") return <PrintPlanning ref={batchPrintRef} doc={batchExportDoc} siteSettings={siteSettings} watermarkEnabled={wmEnabled} />;
          return <PrintDocument ref={batchPrintRef} doc={batchExportDoc} totals={computeTotals(batchExportDoc)} accountPlan={account?.plan} siteSettings={siteSettings} watermarkEnabled={wmEnabled} />;
        })()}
      </div>
    </div>
  );
}

function LandingPage({ plans, siteSettings, onGetStarted, onLogin }) {
  const [openFaq, setOpenFaq] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const visiblePlans = plans.filter((p) => !p.hidden);

  const features = [
    { icon: Menu, title: "Un service pour chaque besoin", text: "Devis, factures, révisions de prix, bons de commande, avoirs... choisissez le bon document en quelques clics." },
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
          ✦ Devis, factures, révisions de prix et bien plus — tout pour votre entreprise
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
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: colors.brassDark }}>La gestion administrative des artisans</span>
          <h1 className="df-display mt-3 text-4xl font-semibold leading-tight sm:text-5xl">Devis, factures, et bien plus — un seul outil pour toute votre administration.</h1>
          <p className="mt-4 max-w-md text-base" style={{ color: colors.inkSoft }}>{siteSettings.name} réunit devis, factures, révisions de prix et plusieurs autres services dans un seul outil pensé pour les artisans et petites entreprises.</p>
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
        © 2026 {siteSettings.name} — <a href={`mailto:${siteSettings.contactEmail || "contact@chantiflow.fr"}`}>{siteSettings.contactEmail || "contact@chantiflow.fr"}</a>
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
      setError((err && typeof err === "object" && err.message) ? err.message : "Une erreur est survenue. Réessaie.");
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
      // Vérifie d'abord si un compte existe pour cet email — décision
      // assumée de révéler cette information (voir la migration SQL
      // pour le compromis de sécurité que ça représente).
      const { data: exists, error: checkError } = await db.rpc("email_has_account", { check_email: cleanEmail });
      if (checkError) {
        console.error("Erreur de vérification de l'email", checkError);
        setError((err && typeof err === "object" && err.message) ? err.message : "Une erreur est survenue. Réessaie.");
        setBusy(false);
        return;
      }
      if (!exists) {
        setError("Aucun compte n'est associé à cette adresse email.");
        setBusy(false);
        return;
      }
      const { error: resetError } = await db.auth.resetPasswordForEmail(cleanEmail, { redirectTo: window.location.origin });
      if (resetError) { setError(resetError.message); setBusy(false); return; }
      setInfo("Un lien de réinitialisation vient d'être envoyé à cette adresse. Vérifie ta boîte mail (et les spams).");
      setBusy(false);
    } catch (err) {
      console.error(err);
      setError((err && typeof err === "object" && err.message) ? err.message : "Une erreur est survenue. Réessaie.");
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
          // Important : si ça échoue, on ne laisse JAMAIS l'inscription
          // "réussir" silencieusement — sans organisation, rien ne
          // fonctionne ensuite (impossible d'activer un forfait, de
          // créer un document...) et la personne se retrouve bloquée
          // sans le savoir. On réessaie une fois, puis on prévient
          // clairement si ça persiste.
          async function createOrgForNewUser() {
            const { data: newOrg, error: orgError } = await db.from("organizations").insert({ name: companyName.trim() || cleanEmail }).select("id").single();
            if (orgError || !newOrg) return { ok: false, error: orgError };
            const { error: memberError } = await db.from("organization_members").insert({ organization_id: newOrg.id, user_id: data.user.id, role: "owner", status: "active" });
            if (memberError) return { ok: false, error: memberError };
            return { ok: true };
          }
          let orgResult = await createOrgForNewUser();
          if (!orgResult.ok) {
            console.error("Erreur de création de l'organisation (1ère tentative)", orgResult.error);
            orgResult = await createOrgForNewUser(); // une seconde chance, en cas de souci passager
          }
          if (!orgResult.ok) {
            console.error("Erreur de création de l'organisation (2ème tentative)", orgResult.error);
            setError("Ton compte a été créé, mais la mise en place de ton espace a rencontré un souci. Déconnecte-toi puis reconnecte-toi pour réessayer automatiquement — si ça persiste, contacte-nous.");
            setBusy(false);
            return;
          }
          // Le compte fonctionne tout de suite (confirmation par email
          // désactivée côté Supabase), mais on envoie quand même un
          // email de confirmation "maison" — 8 semaines pour cliquer,
          // sinon suppression automatique (voir Admin → Utilisateurs).
          db.functions.invoke("send-confirmation-email", { body: { userId: data.user.id } }).catch((e) => console.error("Erreur d'envoi de l'email de confirmation", e));
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
      setError((err && typeof err === "object" && err.message) ? err.message : "Une erreur est survenue. Réessaie.");
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

function TopNav({ view, setView, onNewDevis, onNewFacture, onNewProforma, onNewRevision, onNewService, visibleServices, account, onLogout, onSwitchOrganization, onCreateOwnOrg, creatingOwnOrg, siteSettings, companyProfile, onSetCompanyType }) {
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [servicesMenuOpen, setServicesMenuOpen] = useState(false);
  const mainTabs = [
    { id: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    { id: "clients", label: "Clients", icon: Users },
    { id: "prestations", label: "Bibliothèque", icon: Library },
    { id: "company", label: "Mon entreprise", icon: Building2 },
    { id: "team", label: "Équipe", icon: UserPlus },
    ...(account?.plan === "entreprise" && account?.role === "owner" ? [{ id: "api", label: "API", icon: KeyRound }] : []),
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
            {(() => {
              const memberships = account?.memberships || [];
              const hasOwnOrg = memberships.some((m) => m.role === "owner");
              if (memberships.length <= 1 && hasOwnOrg) return null;
              return (
                <div className="relative">
                  <button
                    onClick={() => setOrgMenuOpen((v) => !v)}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                    style={{ background: "rgba(255,255,255,0.1)", color: "white", border: "none" }}
                    title="Changer d'organisation"
                  >
                    <Building2 size={13} /> <span className="max-w-[9rem] truncate">{account.organizationName || "Organisation"}</span>
                    <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "rgba(255,255,255,0.15)" }}>{ROLE_LABELS[account.role] || account.role}</span>
                    <ChevronDown size={12} />
                  </button>
                  {orgMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setOrgMenuOpen(false)} />
                      <div className="absolute right-0 top-full z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg py-1 shadow-lg" style={{ background: "white", border: `1px solid ${colors.line}` }}>
                        {memberships.map((m) => (
                          <button
                            key={m.organizationId}
                            onClick={() => { onSwitchOrganization(m.organizationId); setOrgMenuOpen(false); }}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs"
                            style={{ background: m.organizationId === account.organizationId ? colors.paper : "transparent", color: colors.ink }}
                          >
                            <span className="truncate">{m.name || "Organisation"}</span>
                            <span className="shrink-0 text-xs" style={{ color: colors.inkSoft }}>{ROLE_LABELS[m.role] || m.role}</span>
                          </button>
                        ))}
                        {!hasOwnOrg && (
                          <button
                            onClick={() => { setOrgMenuOpen(false); onCreateOwnOrg(); }}
                            disabled={creatingOwnOrg}
                            className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-xs font-medium"
                            style={{ borderColor: colors.line, color: colors.brassDark }}
                          >
                            {creatingOwnOrg ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                            {creatingOwnOrg ? "Création…" : "Créer mon propre espace"}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
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
        <button onClick={onNewRevision} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: colors.slate, color: "white" }} title="Nouvelle révision des prix">
          <TrendingUp size={15} /> Révision des prix
        </button>
        <div className="relative">
          <button onClick={() => setServicesMenuOpen((v) => !v)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium" style={{ background: "rgba(255,255,255,0.1)", color: "white" }} title="Tous les services">
            <Menu size={16} />
          </button>
          {servicesMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setServicesMenuOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 max-h-96 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg py-1 shadow-lg" style={{ background: "white", border: `1px solid ${colors.line}` }}>
                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Tous les services</div>
                {SERVICES.filter((s) => visibleServices.includes(s.id)).map((s) => {
                  const SIcon = s.icon;
                  return (
                    <button
                      key={s.id}
                      onClick={() => { setServicesMenuOpen(false); onNewService(s.id); }}
                      className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-xs hover:bg-black/5"
                      style={{ color: colors.ink }}
                    >
                      <SIcon size={15} className="mt-0.5 shrink-0" style={{ color: colors.brassDark }} />
                      <span className="min-w-0">
                        <span className="block font-medium">{s.label}{!s.implemented && <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-normal" style={{ background: `${colors.inkSoft}18`, color: colors.inkSoft }}>bientôt</span>}</span>
                        <span className="block truncate" style={{ color: colors.inkSoft }}>{s.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
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

const REV_COL = {
  label: "#EDEDED", jours: "#DCEEFB", situation: "#E2F0D9", index: "#FFF2CC",
  lettre: "#FCE4D6", ppo: "#E4DFEC", pct: "#FCE4EC", montant: "#D9F2E6",
  formule: "#E8ECF5", revision: "#FAD9D9", dpLabel: "#D6E4F0", blank: "#000000",
};
const upx = (v) => String(v ?? "").toUpperCase();

const PrintRevision = forwardRef(function PrintRevision({ doc, siteSettings, watermarkEnabled = true }, ref) {
  const sectorLines = getRevisionSectors(doc);
  const ink = siteSettings?.pdfHeaderColor || "#1B2A33";
  const pageBg = siteSettings?.pdfBackground || "#FBF7EF";
  const cellStyle = { border: "1px solid #B7B7B7", padding: "3px 5px", verticalAlign: "middle", whiteSpace: "nowrap" };
  const watermarkText = upx(siteSettings?.name || "DeviFact");
  const watermarkSize = Math.max(24, Math.min(48, Math.round(760 / Math.max(watermarkText.length, 1))));
  const pStyle = {
    fontFamily: "'Inter', sans-serif", color: ink, fontSize: "7.5pt", lineHeight: 1.3,
    background: pageBg,
    width: "297mm", minHeight: "210mm", boxSizing: "border-box",
    padding: "16px 18px", position: "relative", overflow: "hidden",
  };

  return (
    <div ref={ref} className="print-doc" style={pStyle}>
      {watermarkEnabled && (
        <div style={{
          position: "absolute", top: "45%", left: "50%", transform: "translate(-50%, -50%) rotate(-25deg)",
          fontFamily: "'Space Grotesk', sans-serif", fontSize: `${watermarkSize}pt`, fontWeight: 700, color: "rgba(27,42,51,0.07)",
          whiteSpace: "nowrap", pointerEvents: "none",
        }}>{watermarkText}</div>
      )}

      {sectorLines.map((sec, secIdx) => {
        const terms = sec.terms || [];
        const termLetters = terms.map((_, i) => String.fromCharCode(65 + i));
        const nCols = 8 + terms.length * 2;
        const a = Number(sec.coeffFixe) || 0;
        const headerCols = [
          { label: "N.B JOURS", color: REV_COL.jours },
          { label: "SITUATION", color: REV_COL.situation },
          ...terms.map((t) => ({ label: `INDEX ${upx(t.symbole || "?")}`, color: REV_COL.index })),
          ...termLetters.map((l) => ({ label: l, color: REV_COL.lettre })),
          { label: "P/P0", color: REV_COL.ppo },
          { label: "%", color: REV_COL.pct },
          { label: "MT DE DECOMPTE", color: REV_COL.montant },
          { label: "MT A REVISER", color: REV_COL.montant },
          { label: "FORMULE", color: REV_COL.formule },
          { label: "MT DE LA REVISION", color: REV_COL.revision },
        ];

        let totalHT = 0;
        const bodyRows = [];
        (sec.decomptes && sec.decomptes.length ? sec.decomptes : []).forEach((d, dIdx) => {
          if (d.isBlank) {
            bodyRows.push(<tr key={`blank-${dIdx}`}><td colSpan={nCols} style={{ ...cellStyle, background: REV_COL.blank, height: "10px" }}></td></tr>);
            return;
          }
          if (d.label) {
            bodyRows.push(<tr key={`lbl-${dIdx}`}><td colSpan={nCols} style={{ ...cellStyle, background: REV_COL.dpLabel, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap" }}>{upx(d.label)}</td></tr>);
          }
          const dr = computeDecompteRevision(sec, d);
          const totalJours = (d.mois || []).reduce((s, m) => s + (Number(m.jours) || 0), 0);
          (d.mois || []).forEach((m, mIdx) => {
            const detail = (dr.detail || [])[mIdx];
            const cells = [
              Number(m.jours) || "",
              m.date ? frShort(m.date) : "",
              ...terms.map((t) => Number(m.valeurs?.[t.id]) || ""),
              ...terms.map((t) => {
                const base = Number(t.indexBase), val = Number(m.valeurs?.[t.id]);
                return base && val ? ((Number(t.poids) || 0) * (val / base)).toFixed(4) : "";
              }),
              detail?.valid ? detail.coefficient.toFixed(4) : "",
              detail?.valid ? detail.delta.toFixed(4) : "",
              formatMoney(Number(d.montantTotal) || 0, doc.currency),
              formatMoney(Number(d.montantTotal) || 0, doc.currency),
              detail?.valid ? upx(`x ${detail.delta.toFixed(4)} x ${m.jours}/${totalJours}`) : "",
              detail?.valid ? formatMoney(detail.ecart, doc.currency) : "",
            ];
            bodyRows.push(
              <tr key={`${dIdx}-${mIdx}`}>
                {cells.map((v, i) => <td key={i} style={{ ...cellStyle, background: headerCols[i].color, textAlign: i < 2 ? "left" : "right" }}>{v}</td>)}
              </tr>
            );
          });
          const subCells = new Array(nCols).fill("");
          subCells[0] = totalJours;
          subCells[nCols - 1] = dr.valid ? formatMoney(dr.ecartMontant, doc.currency) : "";
          bodyRows.push(
            <tr key={`sub-${dIdx}`}>
              {subCells.map((v, i) => <td key={i} style={{ ...cellStyle, background: v !== "" ? headerCols[i].color : "transparent", fontWeight: 700, textAlign: i < 2 ? "left" : "right" }}>{v}</td>)}
            </tr>
          );
          if (dr.valid) totalHT += dr.ecartMontant;
        });
        if (!sec.useDecomptes) {
          const rr = computeRevisionLine(sec);
          const cells = [
            "", sec.dateActuelle ? frShort(sec.dateActuelle) : "",
            ...terms.map((t) => Number(sec.valeursActuelles?.[t.id]) || ""),
            ...terms.map((t) => {
              const base = Number(t.indexBase), val = Number(sec.valeursActuelles?.[t.id]);
              return base && val ? ((Number(t.poids) || 0) * (val / base)).toFixed(4) : "";
            }),
            rr.valid ? rr.coefficient.toFixed(4) : "",
            rr.valid ? (rr.coefficient - 1).toFixed(4) : "",
            formatMoney(Number(sec.montantInitialHT) || 0, doc.currency),
            formatMoney(Number(sec.montantInitialHT) || 0, doc.currency),
            "",
            rr.valid ? formatMoney(rr.ecartMontant, doc.currency) : "",
          ];
          bodyRows.push(<tr key="simple">{cells.map((v, i) => <td key={i} style={{ ...cellStyle, background: headerCols[i].color, textAlign: i < 2 ? "left" : "right" }}>{v}</td>)}</tr>);
          if (rr.valid) totalHT += rr.ecartMontant;
        }
        const tvaRate = Number(sec.tvaRate ?? 0.20);

        return (
          <div key={sec.id || secIdx} style={{ position: "relative", zIndex: 1, marginBottom: "22px", pageBreakAfter: secIdx < sectorLines.length - 1 ? "always" : "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                <tr><td colSpan={nCols} style={{ ...cellStyle, background: REV_COL.label, fontWeight: 700, fontSize: "10pt", textAlign: "center", whiteSpace: "nowrap" }}>NOTE DE CALCUL DE LA REVISION DES PRIX — {upx(sec.sector)}</td></tr>
                <tr><td colSpan={nCols} style={{ ...cellStyle, background: REV_COL.label, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap" }}>{upx(`MARCHE N°: ${doc.marcheNumero || ""}`)}</td></tr>
                {doc.objet && <tr><td colSpan={nCols} style={{ ...cellStyle, background: REV_COL.label, textAlign: "center", whiteSpace: "normal" }}>{upx(doc.objet)}</td></tr>}
                <tr><td colSpan={nCols} style={{ ...cellStyle, background: REV_COL.label, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap" }}>{upx(`STE : ${doc.company.name || ""}`)}</td></tr>
                <tr>
                  <td colSpan={2} style={{ ...cellStyle, background: REV_COL.label, fontWeight: 700, textAlign: "left", whiteSpace: "nowrap" }}>DATE DE SOUMISSION :</td>
                  <td colSpan={nCols - 2} style={{ ...cellStyle, background: REV_COL.label, textAlign: "left", whiteSpace: "nowrap" }}>{sec.dateBase ? fr(sec.dateBase) : ""}</td>
                </tr>
                <tr>
                  <td colSpan={2} style={{ ...cellStyle, background: REV_COL.label, fontWeight: 700, textAlign: "left", whiteSpace: "nowrap" }}>SYMBOLE D'INDEX :</td>
                  <td colSpan={nCols - 2} style={{ ...cellStyle, background: REV_COL.label, textAlign: "left", whiteSpace: "nowrap" }}>{terms.map((t) => upx(t.symbole)).join(" · ")}</td>
                </tr>
                <tr>
                  <td colSpan={2} style={{ ...cellStyle, background: REV_COL.label, fontWeight: 700, textAlign: "left", whiteSpace: "nowrap" }}>INDEX DE BASE :</td>
                  <td colSpan={nCols - 2} style={{ ...cellStyle, background: REV_COL.label, textAlign: "left", whiteSpace: "nowrap" }}>{terms.map((t) => t.indexBase).join(" · ")}</td>
                </tr>
                <tr>
                  <td colSpan={2} style={{ ...cellStyle, background: REV_COL.label, fontWeight: 700, textAlign: "left", whiteSpace: "nowrap" }}>T.V.A INITIALE :</td>
                  <td colSpan={nCols - 2} style={{ ...cellStyle, background: REV_COL.label, textAlign: "left", whiteSpace: "nowrap" }}>{tvaRate}</td>
                </tr>
                {sec.articleCPS && (
                  <tr>
                    <td colSpan={2} style={{ ...cellStyle, background: REV_COL.label, fontWeight: 700, textAlign: "left", whiteSpace: "nowrap" }}>ARTICLE / RÉFÉRENCE :</td>
                    <td colSpan={nCols - 2} style={{ ...cellStyle, background: REV_COL.label, textAlign: "left", whiteSpace: "nowrap" }}>{upx(sec.articleCPS)}</td>
                  </tr>
                )}
                {doc.dateDemarrage && (
                  <tr>
                    <td colSpan={2} style={{ ...cellStyle, background: REV_COL.label, fontWeight: 700, textAlign: "left", whiteSpace: "nowrap" }}>ORDRE DE SERVICE :</td>
                    <td colSpan={nCols - 2} style={{ ...cellStyle, background: REV_COL.label, textAlign: "left", whiteSpace: "nowrap" }}>{fr(doc.dateDemarrage)}</td>
                  </tr>
                )}
                <tr>
                  <td colSpan={nCols} style={{ ...cellStyle, background: REV_COL.label, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap" }}>{upx(`FORMULE DE REVISION DES PRIX : P/P0 = ${a} + ${termLetters.join(" + ")}`)}</td>
                </tr>
                {terms.map((t, i) => (
                  <tr key={t.id}><td colSpan={nCols} style={{ ...cellStyle, background: REV_COL.label, textAlign: "center", whiteSpace: "nowrap" }}>{upx(`${termLetters[i]} = ${t.poids}*(${t.symbole || "?"}/${t.symbole || "?"}0)`)}</td></tr>
                ))}
                <tr>{headerCols.map((h, i) => <td key={i} style={{ ...cellStyle, background: h.color, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap" }}>{h.label}</td>)}</tr>
                {bodyRows}
                <tr>
                  <td colSpan={nCols - 2} style={{ ...cellStyle, background: REV_COL.label, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>TOTAL DE LA REVISION DES PRIX HTVA</td>
                  <td colSpan={2} style={{ ...cellStyle, background: REV_COL.revision, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>{formatMoney(totalHT, doc.currency)}</td>
                </tr>
                <tr>
                  <td colSpan={nCols - 2} style={{ ...cellStyle, background: REV_COL.label, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>{upx(`TVA ${Math.round(tvaRate * 100)}%`)}</td>
                  <td colSpan={2} style={{ ...cellStyle, background: REV_COL.revision, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>{formatMoney(totalHT * tvaRate, doc.currency)}</td>
                </tr>
                <tr>
                  <td colSpan={nCols - 2} style={{ ...cellStyle, background: REV_COL.label, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>TOTAL DE LA REVISION DES PRIX TTC</td>
                  <td colSpan={2} style={{ ...cellStyle, background: REV_COL.revision, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>{formatMoney(totalHT * (1 + tvaRate), doc.currency)}</td>
                </tr>
                <tr>
                  <td colSpan={Math.floor(nCols / 2)} style={{ ...cellStyle, background: REV_COL.label, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap" }}>ENTREPRISE</td>
                  <td colSpan={nCols - Math.floor(nCols / 2)} style={{ ...cellStyle, background: REV_COL.label, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap" }}>SERVICE / MAÎTRE D'OUVRAGE</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}

      {doc.notes && (
        <div style={{ marginTop: "16px", fontSize: "9pt", position: "relative", zIndex: 1 }}>
          <div style={{ fontWeight: 700, marginBottom: "4px" }}>NOTE :</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{upx(doc.notes)}</div>
        </div>
      )}
    </div>
  );
});

function RevisionEditor({ doc, saving, clients, account, plans, siteSettings, isLocked, isViewer, onChange, onBack, onSaveClient, onGoToPricing }) {
  const [localDoc, setLocalDoc] = useState(doc);
  const saveTimer = useRef(null);
  useEffect(() => setLocalDoc(doc), [doc.id]);

  function patch(p) {
    const next = { ...localDoc, ...p };
    setLocalDoc(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onChange(p), 400);
  }
  function patchDeep(field, p) {
    patch({ [field]: { ...localDoc[field], ...p } });
  }

  const total = computeRevision(localDoc);
  const sectorLines = getRevisionSectors(localDoc);
  const currentPlanData = (plans || []).find((p) => p.id === (account?.plan || "gratuit"));
  const watermarkEnabled = currentPlanData?.watermarkEnabled !== false;
  const printRef = useRef(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  function patchSector(sectorId, p) {
    patch({ sectors: sectorLines.map((l) => (l.id === sectorId ? { ...l, ...p } : l)) });
  }
  function addSector() {
    patch({ sectors: [...sectorLines, emptyRevisionSector(REVISION_SECTORS[0], localDoc.country)] });
  }
  function removeSector(sectorId) {
    if (sectorLines.length <= 1) return;
    patch({ sectors: sectorLines.filter((l) => l.id !== sectorId) });
  }
  // Renvoie, pour chaque terme, la dernière valeur saisie quelque part
  // dans le secteur (tous décomptes confondus) — sert à pré-remplir
  // les nouveaux mois avec ce qui ne change probablement pas.
  function getLastKnownValeurs(sec) {
    const result = {};
    // D'abord la valeur de base de chaque terme — c'est le point de
    // départ le plus probable pour un premier mois.
    (sec?.terms || []).forEach((t) => {
      if (t.indexBase !== "" && t.indexBase !== undefined && t.indexBase !== null) result[t.id] = t.indexBase;
    });
    // Puis la dernière valeur réellement saisie quelque part, qui
    // prend le dessus si elle existe (plus à jour que la base).
    (sec?.decomptes || []).forEach((d) => {
      (d.mois || []).forEach((m) => {
        Object.entries(m.valeurs || {}).forEach(([termId, val]) => {
          if (val !== "" && val !== undefined && val !== null) result[termId] = val;
        });
      });
    });
    return result;
  }
  function addDecompte(sectorId) {
    const sec = sectorLines.find((l) => l.id === sectorId);
    const nd = emptyDecompte();
    const known = getLastKnownValeurs(sec);
    nd.mois = nd.mois.map((m) => ({ ...m, valeurs: { ...known } }));
    patchSector(sectorId, { decomptes: [...(sec?.decomptes || []), nd] });
  }
  function addBlankRow(sectorId) {
    const sec = sectorLines.find((l) => l.id === sectorId);
    patchSector(sectorId, { decomptes: [...(sec?.decomptes || []), { id: nextId("dc"), isBlank: true }] });
  }
  function patchDecompte(sectorId, decompteId, p) {
    const sec = sectorLines.find((l) => l.id === sectorId);
    patchSector(sectorId, { decomptes: (sec?.decomptes || []).map((d) => (d.id === decompteId ? { ...d, ...p } : d)) });
  }
  function removeDecompte(sectorId, decompteId) {
    const sec = sectorLines.find((l) => l.id === sectorId);
    patchSector(sectorId, { decomptes: (sec?.decomptes || []).filter((d) => d.id !== decompteId) });
  }
  function addTerm(sectorId) {
    const sec = sectorLines.find((l) => l.id === sectorId);
    patchSector(sectorId, { terms: [...(sec?.terms || []), emptyRevisionTerm()] });
  }
  function patchTerm(sectorId, termId, p) {
    const sec = sectorLines.find((l) => l.id === sectorId);
    patchSector(sectorId, { terms: (sec?.terms || []).map((t) => (t.id === termId ? { ...t, ...p } : t)) });
  }
  // Propage la valeur de base d'un terme vers les mois qui n'ont encore
  // rien pour lui — appelée seulement quand on quitte le champ (pas à
  // chaque frappe), sinon un nombre à plusieurs chiffres se retrouve
  // tronqué au premier chiffre tapé.
  function propagateTermBaseValue(sectorId, termId) {
    const sec = sectorLines.find((l) => l.id === sectorId);
    const term = (sec?.terms || []).find((t) => t.id === termId);
    if (!term || term.indexBase === "" || term.indexBase === undefined) return;
    const decomptes = (sec?.decomptes || []).map((d) => ({
      ...d,
      mois: (d.mois || []).map((m) => {
        const dejaRempli = m.valeurs?.[termId] !== undefined && m.valeurs?.[termId] !== "";
        if (dejaRempli) return m;
        return { ...m, valeurs: { ...(m.valeurs || {}), [termId]: term.indexBase } };
      }),
    }));
    patchSector(sectorId, { decomptes });
  }
  function removeTerm(sectorId, termId) {
    const sec = sectorLines.find((l) => l.id === sectorId);
    if ((sec?.terms || []).length <= 1) return;
    patchSector(sectorId, {
      terms: sec.terms.filter((t) => t.id !== termId),
      valeursActuelles: Object.fromEntries(Object.entries(sec.valeursActuelles || {}).filter(([k]) => k !== termId)),
      decomptes: (sec.decomptes || []).map((d) => ({
        ...d,
        mois: (d.mois || []).map((m) => ({ ...m, valeurs: Object.fromEntries(Object.entries(m.valeurs || {}).filter(([k]) => k !== termId)) })),
      })),
    });
  }
  function patchValeurActuelle(sectorId, termId, value) {
    const sec = sectorLines.find((l) => l.id === sectorId);
    patchSector(sectorId, { valeursActuelles: { ...(sec?.valeursActuelles || {}), [termId]: value } });
  }
  function addMois(sectorId, decompteId) {
    const sec = sectorLines.find((l) => l.id === sectorId);
    const d = (sec?.decomptes || []).find((dd) => dd.id === decompteId);
    // Pré-remplit le nouveau mois avec les dernières valeurs connues
    // de chaque terme (ou sa valeur de base si jamais saisie ailleurs)
    // — modifiable ensuite si ce mois est un cas particulier.
    const known = getLastKnownValeurs(sec);
    patchDecompte(sectorId, decompteId, { mois: [...(d?.mois || []), { ...emptyMois(), valeurs: known }] });
  }
  function patchMois(sectorId, decompteId, moisId, p) {
    const sec = sectorLines.find((l) => l.id === sectorId);
    const d = (sec?.decomptes || []).find((dd) => dd.id === decompteId);
    patchDecompte(sectorId, decompteId, { mois: (d?.mois || []).map((m) => (m.id === moisId ? { ...m, ...p } : m)) });
  }
  function removeMois(sectorId, decompteId, moisId) {
    const sec = sectorLines.find((l) => l.id === sectorId);
    const d = (sec?.decomptes || []).find((dd) => dd.id === decompteId);
    if ((d?.mois || []).length <= 1) return;
    patchDecompte(sectorId, decompteId, { mois: (d.mois || []).filter((m) => m.id !== moisId) });
  }
  function patchMoisValeur(sectorId, decompteId, moisId, termId, value) {
    const sec = sectorLines.find((l) => l.id === sectorId);
    const d = (sec?.decomptes || []).find((dd) => dd.id === decompteId);
    const m = (d?.mois || []).find((mm) => mm.id === moisId);
    patchMois(sectorId, decompteId, moisId, { valeurs: { ...(m?.valeurs || {}), [termId]: value } });
  }
  // Propage la valeur d'un mois vers les autres mois qui n'ont encore
  // rien pour ce terme — seulement à la fin de la saisie (quitter le
  // champ), jamais à chaque frappe, sinon un nombre à plusieurs
  // chiffres se retrouve tronqué au premier chiffre tapé.
  function propagateMoisValeur(sectorId, decompteId, moisId, termId) {
    const sec = sectorLines.find((l) => l.id === sectorId);
    const d = (sec?.decomptes || []).find((dd) => dd.id === decompteId);
    const m = (d?.mois || []).find((mm) => mm.id === moisId);
    const value = m?.valeurs?.[termId];
    if (value === undefined || value === "") return;
    const decomptes = (sec?.decomptes || []).map((dd) => ({
      ...dd,
      mois: (dd.mois || []).map((mm) => {
        if (mm.id === moisId) return mm;
        const dejaRempli = mm.valeurs?.[termId] !== undefined && mm.valeurs?.[termId] !== "";
        if (dejaRempli) return mm;
        return { ...mm, valeurs: { ...(mm.valeurs || {}), [termId]: value } };
      }),
    }));
    patchSector(sectorId, { decomptes });
  }

  async function downloadPdf() {
    const el = printRef.current;
    if (!el || pdfGenerating) return;
    setPdfGenerating(true);
    const prevStyle = { display: el.style.display, position: el.style.position, left: el.style.left, top: el.style.top, zIndex: el.style.zIndex };
    el.style.display = "block";
    el.style.position = "fixed";
    el.style.left = "-9999px";
    el.style.top = "0";
    el.style.zIndex = "-1";
    try {
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: siteSettings?.pdfBackground || "#FBF7EF" });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgHeight = (canvas.height * pageWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 3) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(`Revision-${(localDoc.docNumber || "document").replace(/[\\/:*?"<>|]/g, "-")}.pdf`);
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

  // Même mise en forme complète (bordures, couleurs, décomptes mois
  // par mois) pour tous les pays — le Maroc a juste été le premier
  // dont j'avais un vrai exemple pour la construire, mais la
  // structure (jours, décomptes, termes lettrés A/B/C...) est
  // universelle, pas propre à un seul pays.
  async function exportExcel() {
    return exportExcelMaroc();
  }

  // Ancien export au format exact des notes de calcul marocaines —
  // s'applique désormais à tous les pays (voir exportExcel ci-dessus).
  // Export au format exact des notes de calcul marocaines (marchés
  // publics) — une feuille par secteur, colonnes dynamiques selon le
  // nombre de termes de la formule, reproduisant la mise en page de
  // ce type de document (index de base, formule détaillée, décomptes,
  // total HT/TVA/TTC, cadres de signature).
  async function exportExcelMaroc() {
    // Chargé seulement ici, au moment de l'export — évite d'alourdir
    // le chargement initial de l'application pour tout le monde avec
    // une librairie dont seul le forfait Entreprise au Maroc a besoin.
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    sectorLines.forEach((sec) => buildMarocRevisionSheet(workbook, localDoc, sec));

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${localDoc.docNumber}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-white"><ArrowLeft size={16} /> Tableau de bord</button>
        <div className="flex items-center gap-2">
          <button onClick={downloadPdf} disabled={pdfGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink, opacity: pdfGenerating ? 0.7 : 1 }}>
            {pdfGenerating ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} {pdfGenerating ? "Génération…" : "PDF"}
          </button>
          <button onClick={exportExcel} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.moss }}>
            <Download size={15} /> Excel
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {isLocked && (
          <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4" style={{ background: `${colors.brick}12`, border: `1px solid ${colors.brick}40` }}>
            <span className="flex items-center gap-2 text-sm font-medium" style={{ color: colors.brick }}>
              <Lock size={15} /> {isViewer ? "Accès en lecture seule — ce document n'est pas modifiable." : "Limite du forfait Gratuit atteinte — ce document n'est plus modifiable."}
            </span>
            {!isViewer && <button onClick={onGoToPricing} className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white" style={{ background: colors.brick }}>Passer à un forfait payant</button>}
          </div>
        )}
        <div className="rounded-2xl p-6 shadow-sm sm:p-8" style={{ background: colors.surface, border: `1px solid ${colors.line}`, pointerEvents: isLocked ? "none" : "auto", opacity: isLocked ? 0.55 : 1 }}>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b pb-4" style={{ borderColor: colors.line }}>
            <div>
              <h1 className="df-display text-xl font-semibold">Révision de prix</h1>
              {localDoc.country && <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${colors.brassDark}18`, color: colors.brassDark }}>{localDoc.country}</span>}
              <span className="ml-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${colors.slate}18`, color: colors.slate }}>{sectorLines.length} secteur{sectorLines.length > 1 ? "s" : ""}</span>
            </div>
            <div className="text-right">
              <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>N°</label>
              <input className="df-input df-mono w-28 rounded-md px-2 py-1 text-right text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.docNumber} onChange={(e) => patch({ docNumber: e.target.value })} />
            </div>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Marché N°</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="ex: TA 23/2020" value={localDoc.marcheNumero || ""} onChange={(e) => patch({ marcheNumero: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Entreprise</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom de l'entreprise" value={localDoc.company.name} onChange={(e) => patchDeep("company", { name: e.target.value })} />
            </div>
          </div>

          <div className="mb-6">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Objet (description du marché)</label>
            <textarea className="df-textarea w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} placeholder="ex: Travaux d'assainissement liquide du centre..." value={localDoc.objet || ""} onChange={(e) => patch({ objet: e.target.value })} />
          </div>

          <div className="mb-6 max-w-xs">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Date de démarrage du chantier (optionnel)</label>
            <input type="date" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.dateDemarrage || ""} onChange={(e) => patch({ dateDemarrage: e.target.value })} />
          </div>

          <div className="mb-4 flex items-center justify-between">
            <label className="block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Secteurs du chantier</label>
            <button onClick={addSector} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium" style={{ background: colors.ink, color: "white" }}>
              <Plus size={13} /> Ajouter un secteur
            </button>
          </div>

          <div className="mb-6 space-y-4">
            {sectorLines.map((sec, idx) => {
              const r = computeRevisionLine(sec);
              return (
                <div key={sec.id || idx} className="rounded-xl p-4" style={{ background: colors.paper, border: `1px solid ${colors.line}` }}>
                  <div className="mb-3 flex items-center gap-2">
                    <select className="df-select grow rounded-md px-3 py-2 text-sm font-medium" style={{ border: `1px solid ${colors.line}` }} value={sec.sector} onChange={(e) => patchSector(sec.id, { sector: e.target.value })}>
                      {REVISION_SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {sectorLines.length > 1 && (
                      <button onClick={() => removeSector(sec.id)} title="Retirer ce secteur" style={{ color: colors.brick }}><Trash2 size={16} /></button>
                    )}
                  </div>

                  <div className="mb-3 flex items-center gap-1 rounded-lg p-1" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
                    <button onClick={() => patchSector(sec.id, { useDecomptes: false })} className="grow rounded-md py-1.5 text-xs font-medium" style={{ background: !sec.useDecomptes ? colors.ink : "transparent", color: !sec.useDecomptes ? "white" : colors.inkSoft }}>Décompte unique</button>
                    <button onClick={() => patchSector(sec.id, { useDecomptes: true, decomptes: sec.decomptes?.length ? sec.decomptes : [emptyDecompte()] })} className="grow rounded-md py-1.5 text-xs font-medium" style={{ background: sec.useDecomptes ? colors.ink : "transparent", color: sec.useDecomptes ? "white" : colors.inkSoft }}>Plusieurs décomptes (chantier en plusieurs paiements)</button>
                  </div>

                  <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
                    <div>
                      <label className="mb-1 block text-xs" style={{ color: colors.inkSoft }}>Date de base (soumission / origine)</label>
                      <input type="date" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={sec.dateBase} onChange={(e) => patchSector(sec.id, { dateBase: e.target.value })} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs" style={{ color: colors.inkSoft }}>Article / référence du contrat (optionnel)</label>
                      <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="ex: 13 page 9 et 10" value={sec.articleCPS || ""} onChange={(e) => patchSector(sec.id, { articleCPS: e.target.value })} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs" style={{ color: colors.inkSoft }}>Taux de TVA</label>
                      <input type="number" step="0.01" min="0" max="1" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={sec.tvaRate ?? 0.20} onChange={(e) => patchSector(sec.id, { tvaRate: e.target.value })} />
                    </div>
                  </div>

                  {!sec.useDecomptes && (
                    <div className="mb-3">
                      <label className="mb-1 block text-xs" style={{ color: colors.inkSoft }}>Montant initial HT (marché d'origine)</label>
                      <input type="number" className="df-input df-mono w-full max-w-xs rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={sec.montantInitialHT} onChange={(e) => patchSector(sec.id, { montantInitialHT: e.target.value })} placeholder="0" />
                    </div>
                  )}

                  <div className="mb-3">
                    <label className="mb-1 block text-xs" style={{ color: colors.inkSoft }}>Partie fixe non révisable (a)</label>
                    <input type="number" step="0.01" min="0" max="1" className="df-input df-mono w-full max-w-[120px] rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={sec.coeffFixe} onChange={(e) => patchSector(sec.id, { coeffFixe: e.target.value })} />
                  </div>

                  <div className="mb-3 rounded-lg p-3" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-xs font-semibold" style={{ color: colors.slate }}>Termes de la formule (un par indice utilisé)</label>
                      <button onClick={() => addTerm(sec.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: colors.ink, color: "white" }}><Plus size={12} /> Terme</button>
                    </div>
                    <div className="space-y-2">
                      {(sec.terms || []).map((t, tIdx) => (
                        <div key={t.id || tIdx} className="rounded-md p-2" style={{ background: colors.paper, border: `1px solid ${colors.line}` }}>
                          <div className="mb-2 flex items-center gap-2">
                            {(() => {
                              const options = getRevisionIndexOptions(localDoc.country);
                              if (!options) {
                                return <input className="df-input grow rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} placeholder="Symbole (ex: S, ChTp, REP...)" value={t.symbole} onChange={(e) => patchTerm(sec.id, t.id, { symbole: e.target.value })} />;
                              }
                              const isCustom = !options.includes(t.symbole);
                              return (
                                <select className="df-select grow rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} value={isCustom ? REVISION_OTHER_OPTION : t.symbole} onChange={(e) => patchTerm(sec.id, t.id, { symbole: e.target.value === REVISION_OTHER_OPTION ? "" : e.target.value })}>
                                  {options.map((o) => <option key={o} value={o}>{o}</option>)}
                                  <option value={REVISION_OTHER_OPTION}>{REVISION_OTHER_OPTION}</option>
                                </select>
                              );
                            })()}
                            {(sec.terms || []).length > 1 && (
                              <button onClick={() => removeTerm(sec.id, t.id)} style={{ color: colors.brick }}><Trash2 size={14} /></button>
                            )}
                          </div>
                          {getRevisionIndexOptions(localDoc.country) && !getRevisionIndexOptions(localDoc.country).includes(t.symbole) && (
                            <input className="df-input mb-2 w-full rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} placeholder="Précise le symbole (ex: S, ChTp...)" value={t.symbole} onChange={(e) => patchTerm(sec.id, t.id, { symbole: e.target.value })} />
                          )}
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs" style={{ color: colors.inkSoft }}>Poids dans la formule</label>
                              <input type="number" step="0.01" min="0" max="1" className="df-input df-mono w-full rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} value={t.poids} onChange={(e) => patchTerm(sec.id, t.id, { poids: e.target.value })} />
                            </div>
                            <div>
                              <div className="mb-1 flex items-center justify-between">
                                <label className="block text-xs" style={{ color: colors.inkSoft }}>Valeur de base</label>
                                {t.symbole && (() => {
                                  const url = buildIndexSourceUrl(localDoc.country, t.symbole);
                                  if (!url) return null;
                                  return (
                                    <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-medium" style={{ color: colors.brassDark }} title={`Aller chercher la valeur de "${t.symbole}" pour ${localDoc.country || "ce pays"}`}>
                                      <TrendingUp size={11} /> Voir la source ↗
                                    </a>
                                  );
                                })()}
                              </div>
                              <input type="number" step="0.1" className="df-input df-mono w-full rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} value={t.indexBase} onChange={(e) => patchTerm(sec.id, t.id, { indexBase: e.target.value })} onBlur={() => propagateTermBaseValue(sec.id, t.id)} />
                            </div>
                          </div>
                          {!sec.useDecomptes && (
                            <div className="mt-2">
                              <label className="mb-1 block text-xs" style={{ color: colors.inkSoft }}>Valeur actuelle</label>
                              <input type="number" step="0.1" className="df-input df-mono w-full rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} value={sec.valeursActuelles?.[t.id] || ""} onChange={(e) => patchValeurActuelle(sec.id, t.id, e.target.value)} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {(() => {
                      const a = Number(sec.coeffFixe) || 0;
                      const sommePoids = (sec.terms || []).reduce((s, t) => s + (Number(t.poids) || 0), 0);
                      const total = a + sommePoids;
                      const ok = Math.abs(total - 1) < 0.005;
                      return (
                        <p className="mt-2 text-xs" style={{ color: ok ? colors.moss : colors.brick }}>
                          {a.toFixed(2)} + {sommePoids.toFixed(2)} = {total.toFixed(2)} {ok ? "✓" : "— devrait faire 1,00 au total"}
                        </p>
                      );
                    })()}
                    <p className="mt-1 text-xs" style={{ color: colors.inkSoft }}>Valeurs à récupérer auprès de {getRevisionCountryInfo(localDoc.country).authority}, ou dans ton contrat (CPS).</p>
                  </div>

                  {!sec.useDecomptes && (
                    <div className="mb-3 max-w-xs">
                      <label className="mb-1 block text-xs" style={{ color: colors.inkSoft }}>Date de cette révision</label>
                      <input type="date" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={sec.dateActuelle} onChange={(e) => patchSector(sec.id, { dateActuelle: e.target.value })} />
                    </div>
                  )}

                  {sec.useDecomptes && (
                    <div className="mb-3">
                      <label className="mb-1 block text-xs" style={{ color: colors.inkSoft }}>Décomptes (DP) — chacun peut couvrir plusieurs mois</label>
                      <p className="mb-2 text-xs" style={{ color: colors.inkSoft }}>Le montant total du décompte est réparti entre ses mois au prorata du nombre de jours de chacun — comme dans une vraie note de calcul marocaine.</p>
                      <div className="space-y-2">
                        {(sec.decomptes || []).map((d, dIdx) => {
                          if (d.isBlank) {
                            return (
                              <div key={d.id || dIdx} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ background: "repeating-linear-gradient(45deg, transparent, transparent 6px, " + colors.line + "40 6px, " + colors.line + "40 12px)", border: `1px dashed ${colors.line}` }}>
                                <span className="text-xs italic" style={{ color: colors.inkSoft }}>— ligne vide (séparateur dans l'Excel) —</span>
                                <button onClick={() => removeDecompte(sec.id, d.id)} style={{ color: colors.brick }}><Trash2 size={14} /></button>
                              </div>
                            );
                          }
                          const dr = computeDecompteRevision(sec, d);
                          const totalJours = (d.mois || []).reduce((s, m) => s + (Number(m.jours) || 0), 0);
                          return (
                            <div key={d.id || dIdx} className="rounded-lg p-3" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
                              <div className="mb-2 flex items-center gap-2">
                                <input className="df-input grow rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} placeholder={`ex: DP N°${dIdx + 1} : Travaux exécutés du ... au ...`} value={d.label} onChange={(e) => patchDecompte(sec.id, d.id, { label: e.target.value })} />
                                {(sec.decomptes || []).length > 1 && (
                                  <button onClick={() => removeDecompte(sec.id, d.id)} style={{ color: colors.brick }}><Trash2 size={14} /></button>
                                )}
                              </div>
                              <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <div>
                                  <label className="mb-1 block text-xs" style={{ color: colors.inkSoft }}>Date du décompte</label>
                                  <input type="date" className="df-input df-mono w-full rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} value={d.dateDecompte} onChange={(e) => patchDecompte(sec.id, d.id, { dateDecompte: e.target.value })} />
                                </div>
                                <div>
                                  <label className="mb-1 block text-xs" style={{ color: colors.inkSoft }}>Montant total à réviser HT</label>
                                  <input type="number" className="df-input df-mono w-full rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} value={d.montantTotal} onChange={(e) => patchDecompte(sec.id, d.id, { montantTotal: e.target.value })} placeholder="0" />
                                </div>
                              </div>

                              <div className="mb-2 flex items-center justify-between">
                                <label className="text-xs" style={{ color: colors.inkSoft }}>Mois inclus dans ce décompte ({totalJours} jour{totalJours > 1 ? "s" : ""} au total)</label>
                                <button onClick={() => addMois(sec.id, d.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: colors.ink, color: "white" }}><Plus size={11} /> Mois</button>
                              </div>
                              <div className="space-y-1.5">
                                {(d.mois || []).map((m, mIdx) => (
                                  <div key={m.id || mIdx} className="rounded-md p-2" style={{ background: colors.paper, border: `1px solid ${colors.line}` }}>
                                    <div className="mb-1.5 flex items-center gap-2">
                                      <input type="date" className="df-input df-mono rounded-md px-2 py-1 text-xs" style={{ border: `1px solid ${colors.line}`, width: "9.5rem" }} value={m.date} onChange={(e) => patchMois(sec.id, d.id, m.id, { date: e.target.value })} />
                                      <input type="number" className="df-input df-mono w-20 rounded-md px-2 py-1 text-xs" style={{ border: `1px solid ${colors.line}` }} value={m.jours} onChange={(e) => patchMois(sec.id, d.id, m.id, { jours: e.target.value })} placeholder="jours" />
                                      <span className="grow" />
                                      {(d.mois || []).length > 1 && (
                                        <button onClick={() => removeMois(sec.id, d.id, m.id)} style={{ color: colors.brick }}><Trash2 size={13} /></button>
                                      )}
                                    </div>
                                    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min((sec.terms || []).length, 4) || 1}, minmax(0,1fr))` }}>
                                      {(sec.terms || []).map((t) => (
                                        <div key={t.id}>
                                          <label className="mb-0.5 block truncate text-xs" style={{ color: colors.inkSoft }} title={t.symbole}>{t.symbole || "Indice"}</label>
                                          <input type="number" step="0.1" className="df-input df-mono w-full rounded-md px-2 py-1 text-xs" style={{ border: `1px solid ${colors.line}` }} value={m.valeurs?.[t.id] || ""} onChange={(e) => patchMoisValeur(sec.id, d.id, m.id, t.id, e.target.value)} onBlur={() => propagateMoisValeur(sec.id, d.id, m.id, t.id)} />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>

                              {dr.valid && (
                                <div className="mt-2 flex items-center justify-between text-xs font-medium" style={{ color: colors.moss }}>
                                  <span>Écart de révision pour ce décompte</span>
                                  <span className="df-mono">{formatMoney(dr.ecartMontant, localDoc.currency)}</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-2 flex items-center justify-end gap-1.5">
                        <button onClick={() => addBlankRow(sec.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: colors.surface, border: `1px solid ${colors.line}`, color: colors.inkSoft }}><Minus size={12} /> Ligne vide</button>
                        <button onClick={() => addDecompte(sec.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: colors.ink, color: "white" }}><Plus size={12} /> Décompte</button>
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg p-3" style={{ background: r.valid ? `${colors.moss}0D` : colors.surface, border: `1px solid ${r.valid ? colors.moss + "40" : colors.line}` }}>
                    {!r.valid ? (
                      <p className="text-xs" style={{ color: colors.inkSoft }}>Renseigne le montant et les deux indices pour voir le résultat de ce secteur.</p>
                    ) : (
                      <div className="flex items-center justify-between text-sm font-semibold">
                        <span>Montant révisé HT</span>
                        <span className="df-mono" style={{ color: colors.moss }}>{formatMoney(r.montantRevise, localDoc.currency)}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <label className="mb-6 flex items-center gap-2 text-sm" style={{ color: colors.ink }}>
            <input type="checkbox" checked={!!localDoc.showTotal} onChange={(e) => patch({ showTotal: e.target.checked })} style={{ accentColor: colors.brick }} />
            Afficher le total combiné de tous les secteurs (en plus du détail de chacun)
          </label>

          {localDoc.showTotal && (
            <div className="mb-6 rounded-xl p-4" style={{ background: total.valid ? `${colors.ink}` : colors.paper, border: `1px solid ${colors.line}` }}>
              {!total.valid ? (
                <p className="text-sm" style={{ color: colors.inkSoft }}>Complète au moins un secteur pour voir le total combiné.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>
                    <span>Écart total</span>
                    <span className="df-mono">{total.ecartMontant >= 0 ? "+" : ""}{formatMoney(total.ecartMontant, localDoc.currency)} ({total.ecartPct >= 0 ? "+" : ""}{total.ecartPct.toFixed(2)}%)</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-lg font-semibold text-white">
                    <span>Total révisé HT</span>
                    <span className="df-mono">{formatMoney(total.montantRevise, localDoc.currency)}</span>
                  </div>
                </>
              )}
            </div>
          )}

          <label className="mb-1 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Note</label>
          <textarea className="df-textarea w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} value={localDoc.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </div>
      </div>

      <PrintRevision ref={printRef} doc={localDoc} siteSettings={siteSettings} watermarkEnabled={watermarkEnabled} />
    </div>
  );
}

const PrintSituation = forwardRef(function PrintSituation({ doc, siteSettings, watermarkEnabled = true }, ref) {
  const s = computeSituation(doc);
  const ink = siteSettings?.pdfHeaderColor || "#1B2A33";
  const inkSoft = "#4A5B63", line = "#DAE1DC";
  const box = siteSettings?.pdfBlockColor || "#F1F0EA";
  const pageBg = siteSettings?.pdfBackground || "#FBF7EF";
  const mono = { fontFamily: "'IBM Plex Mono', monospace" };
  const watermarkText = (siteSettings?.name || "DeviFact").toUpperCase();
  const watermarkSize = Math.max(24, Math.min(48, Math.round(760 / Math.max(watermarkText.length, 1))));
  const pStyle = {
    fontFamily: "'Inter', sans-serif", color: ink, fontSize: "9.5pt", lineHeight: 1.4,
    background: pageBg, width: "210mm", minHeight: "294mm", boxSizing: "border-box",
    padding: "24px 28px", position: "relative", overflow: "hidden",
  };
  return (
    <div ref={ref} className="print-doc" style={pStyle}>
      {watermarkEnabled && (
        <div style={{ position: "absolute", top: "45%", left: "50%", transform: "translate(-50%, -50%) rotate(-32deg)", fontFamily: "'Space Grotesk', sans-serif", fontSize: `${watermarkSize}pt`, fontWeight: 700, color: "rgba(27,42,51,0.08)", whiteSpace: "nowrap", pointerEvents: "none" }}>{watermarkText}</div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative", zIndex: 1 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "14pt" }}>SITUATION DE TRAVAUX N° {doc.numeroSituation || 1}</div>
          <div style={{ color: inkSoft, marginTop: "4px" }}>Réf. {doc.docNumber} — Date : {new Date(doc.issueDate).toLocaleDateString("fr-FR")}</div>
          {doc.marcheNumero && <div style={{ color: inkSoft }}>Marché N° : {doc.marcheNumero}</div>}
        </div>
        {doc.company.logo ? <img src={doc.company.logo} alt="" style={{ maxHeight: "48px", maxWidth: "160px", objectFit: "contain" }} /> : <div style={{ fontWeight: 700, fontSize: "13pt" }}>{doc.company.name}</div>}
      </div>
      {doc.objet && <div style={{ marginTop: "10px", fontSize: "9pt", color: inkSoft, position: "relative", zIndex: 1 }}>{doc.objet}</div>}
      <div style={{ display: "flex", gap: "16px", marginTop: "16px", position: "relative", zIndex: 1 }}>
        <div style={{ flex: 1, background: box, borderRadius: "4px", padding: "10px 14px" }}>
          <div style={{ fontWeight: 700, marginBottom: "3px" }}>{doc.company.name || "—"}</div>
          {doc.company.address && <div>{doc.company.address}</div>}
        </div>
        <div style={{ flex: 1, background: box, borderRadius: "4px", padding: "10px 14px" }}>
          {doc.client.name && <div style={{ fontWeight: 600 }}>{doc.client.name}</div>}
          {doc.client.address && <div>{doc.client.address}</div>}
        </div>
      </div>

      <div style={{ marginTop: "14px", padding: "8px 14px", borderRadius: "4px", background: ink, color: "white", display: "flex", justifyContent: "space-between", position: "relative", zIndex: 1 }}>
        <span>Avancement global du chantier</span>
        <span style={{ fontWeight: 700, ...mono }}>{s.avancementGlobalPct.toFixed(1)}%</span>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt", marginTop: "16px", position: "relative", zIndex: 1 }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${ink}` }}>
            <th style={{ padding: "5px 4px", textAlign: "left" }}>Désignation</th>
            <th style={{ padding: "5px 4px", textAlign: "right" }}>Montant marché</th>
            <th style={{ padding: "5px 4px", textAlign: "right" }}>% cumulé</th>
            <th style={{ padding: "5px 4px", textAlign: "right" }}>Cumul atteint</th>
            <th style={{ padding: "5px 4px", textAlign: "right" }}>Déjà facturé</th>
            <th style={{ padding: "5px 4px", textAlign: "right" }}>Cette situation</th>
          </tr>
        </thead>
        <tbody>
          {s.lines.map((l) => (
            <tr key={l.id} style={{ borderBottom: `1px solid ${line}` }}>
              <td style={{ padding: "5px 4px" }}>{l.designation}</td>
              <td style={{ padding: "5px 4px", textAlign: "right", ...mono }}>{formatMoney(l.montantMarche, doc.currency)}</td>
              <td style={{ padding: "5px 4px", textAlign: "right", ...mono }}>{Number(l.avancementPct || 0).toFixed(1)}%</td>
              <td style={{ padding: "5px 4px", textAlign: "right", ...mono }}>{formatMoney(l.montantCumuleActuel, doc.currency)}</td>
              <td style={{ padding: "5px 4px", textAlign: "right", ...mono }}>{formatMoney(l.montantCumulePrecedent, doc.currency)}</td>
              <td style={{ padding: "5px 4px", textAlign: "right", ...mono, fontWeight: 600 }}>{formatMoney(l.montantCetteSituation, doc.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px", position: "relative", zIndex: 1 }}>
        <div style={{ width: "280px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 12px" }}><span>Total HT (cette situation)</span><span style={mono}>{formatMoney(s.subtotalHT, doc.currency)}</span></div>
          {Object.entries(s.tvaGroups).map(([rate, amt]) => (
            <div key={rate} style={{ display: "flex", justifyContent: "space-between", padding: "4px 12px", color: inkSoft }}><span>TVA {rate}%</span><span style={mono}>{formatMoney(amt, doc.currency)}</span></div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 12px", fontWeight: 600 }}><span>Total TTC</span><span style={mono}>{formatMoney(s.totalTTCBrut, doc.currency)}</span></div>
          {s.retenueGarantie > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 12px", color: inkSoft }}><span>Retenue de garantie ({doc.retenueGarantiePct}%)</span><span style={mono}>-{formatMoney(s.retenueGarantie, doc.currency)}</span></div>}
          {s.acompteVerse > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 12px", color: inkSoft }}><span>Acompte déjà versé</span><span style={mono}>-{formatMoney(s.acompteVerse, doc.currency)}</span></div>}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: ink, color: "white", fontWeight: 700, borderRadius: "4px", marginTop: "4px" }}><span>Net à payer</span><span style={mono}>{formatMoney(s.netAPayer, doc.currency)}</span></div>
        </div>
      </div>

      {doc.notes && <div style={{ marginTop: "20px", fontSize: "8.5pt", color: inkSoft, position: "relative", zIndex: 1 }}>{renderMarkup(doc.notes)}</div>}
    </div>
  );
});

function SituationEditor({ doc, documents, saving, account, plans, siteSettings, isLocked, isViewer, onChange, onBack, onCreateNext, onGoToPricing }) {
  const [localDoc, setLocalDoc] = useState(doc);
  const saveTimer = useRef(null);
  useEffect(() => setLocalDoc(doc), [doc.id]);

  function patch(p) {
    const next = { ...localDoc, ...p };
    setLocalDoc(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onChange(p), 400);
  }
  function patchDeep(field, p) { patch({ [field]: { ...localDoc[field], ...p } }); }
  function patchLine(id, p) { patch({ items: localDoc.items.map((l) => (l.id === id ? { ...l, ...p } : l)) }); }
  function addLine() { patch({ items: [...localDoc.items, emptySituationLine()] }); }
  function removeLine(id) { if (localDoc.items.length <= 1) return; patch({ items: localDoc.items.filter((l) => l.id !== id) }); }

  const s = computeSituation(localDoc);
  const currentPlanData = (plans || []).find((p) => p.id === (account?.plan || "gratuit"));
  const watermarkEnabled = currentPlanData?.watermarkEnabled !== false;
  const printRef = useRef(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const hasNextSituation = (documents || []).some((d) => d.type === "situation" && d.previousSituationId === localDoc.id);

  async function downloadPdf() {
    const el = printRef.current;
    if (!el || pdfGenerating) return;
    setPdfGenerating(true);
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
      let heightLeft = imgHeight, position = 0;
      pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 3) { position -= pageHeight; pdf.addPage(); pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight); heightLeft -= pageHeight; }
      pdf.save(`${(localDoc.docNumber || "situation").replace(/[\\/:*?"<>|]/g, "-")}.pdf`);
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
    const rows = [];
    rows.push(["SITUATION DE TRAVAUX", `N° ${localDoc.numeroSituation || 1}`]);
    rows.push(["Référence", localDoc.docNumber]);
    rows.push(["Marché N°", localDoc.marcheNumero || ""]);
    rows.push(["Objet", localDoc.objet || ""]);
    rows.push(["Avancement global", `${s.avancementGlobalPct.toFixed(1)}%`]);
    rows.push([]);
    rows.push(["Désignation", "Qté", "PU", "Montant marché", "% cumulé", "Cumul atteint", "Déjà facturé", "Cette situation"]);
    s.lines.forEach((l) => {
      rows.push([l.designation, Number(l.qty) || 0, Number(l.unitPrice) || 0, Number(l.montantMarche.toFixed(2)), Number(l.avancementPct) || 0, Number(l.montantCumuleActuel.toFixed(2)), Number(l.montantCumulePrecedent.toFixed(2)), Number(l.montantCetteSituation.toFixed(2))]);
    });
    rows.push([]);
    rows.push(["", "", "", "", "", "", "Total HT", Number(s.subtotalHT.toFixed(2))]);
    rows.push(["", "", "", "", "", "", "TVA", Number(s.totalTVA.toFixed(2))]);
    rows.push(["", "", "", "", "", "", "Total TTC", Number(s.totalTTCBrut.toFixed(2))]);
    if (s.retenueGarantie > 0) rows.push(["", "", "", "", "", "", `Retenue garantie (${localDoc.retenueGarantiePct}%)`, -Number(s.retenueGarantie.toFixed(2))]);
    if (s.acompteVerse > 0) rows.push(["", "", "", "", "", "", "Acompte versé", -Number(s.acompteVerse.toFixed(2))]);
    rows.push(["", "", "", "", "", "", "NET À PAYER", Number(s.netAPayer.toFixed(2))]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 28 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Situation");
    XLSX.writeFile(wb, `${localDoc.docNumber}.xlsx`);
  }

  return (
    <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-white"><ArrowLeft size={16} /> Tableau de bord</button>
        <div className="flex items-center gap-2">
          {!hasNextSituation && !isLocked && (
            <button onClick={() => onCreateNext(localDoc)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.moss }} title="Crée la situation suivante, en reprenant automatiquement le cumul de celle-ci">
              <ArrowRight size={15} /> Situation suivante
            </button>
          )}
          <button onClick={downloadPdf} disabled={pdfGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink, opacity: pdfGenerating ? 0.7 : 1 }}>
            {pdfGenerating ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} {pdfGenerating ? "Génération…" : "PDF"}
          </button>
          <button onClick={exportExcel} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.slate }}>
            <Download size={15} /> Excel
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {isLocked && (
          <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4" style={{ background: `${colors.brick}12`, border: `1px solid ${colors.brick}40` }}>
            <span className="flex items-center gap-2 text-sm font-medium" style={{ color: colors.brick }}>
              <Lock size={15} /> {isViewer ? "Accès en lecture seule — ce document n'est pas modifiable." : "Limite du forfait Gratuit atteinte — ce document n'est plus modifiable."}
            </span>
            {!isViewer && <button onClick={onGoToPricing} className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white" style={{ background: colors.brick }}>Passer à un forfait payant</button>}
          </div>
        )}
        <div className="rounded-2xl p-6 shadow-sm sm:p-8" style={{ background: colors.surface, border: `1px solid ${colors.line}`, pointerEvents: isLocked ? "none" : "auto", opacity: isLocked ? 0.55 : 1 }}>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b pb-4" style={{ borderColor: colors.line }}>
            <div>
              <h1 className="df-display text-xl font-semibold">Situation de travaux N° {localDoc.numeroSituation || 1}</h1>
              {localDoc.previousSituationId && <span className="text-xs" style={{ color: colors.inkSoft }}>Suite de la situation précédente — cumul repris automatiquement</span>}
            </div>
            <div className="text-right">
              <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Réf.</label>
              <input className="df-input df-mono w-28 rounded-md px-2 py-1 text-right text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.docNumber} onChange={(e) => patch({ docNumber: e.target.value })} />
            </div>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Marché N°</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.marcheNumero || ""} onChange={(e) => patch({ marcheNumero: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Date de début des travaux</label>
              <input type="date" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.dateDebut || ""} onChange={(e) => patch({ dateDebut: e.target.value })} />
            </div>
          </div>
          <div className="mb-6">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Objet</label>
            <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.objet || ""} onChange={(e) => patch({ objet: e.target.value })} />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg p-3" style={{ background: colors.paper }}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Entreprise</label>
              <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom" value={localDoc.company.name} onChange={(e) => patchDeep("company", { name: e.target.value })} />
              <input className="df-input w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Adresse" value={localDoc.company.address} onChange={(e) => patchDeep("company", { address: e.target.value })} />
            </div>
            <div className="rounded-lg p-3" style={{ background: colors.paper }}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Client</label>
              <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom" value={localDoc.client.name} onChange={(e) => patchDeep("client", { name: e.target.value })} />
              <input className="df-input w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Adresse" value={localDoc.client.address} onChange={(e) => patchDeep("client", { address: e.target.value })} />
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Postes du marché</label>
            <button onClick={addLine} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: colors.ink, color: "white" }}><Plus size={12} /> Poste</button>
          </div>
          <div className="mb-4 space-y-2">
            {localDoc.items.map((l) => {
              const cl = computeSituationLine(l);
              return (
                <div key={l.id} className="rounded-lg p-3" style={{ background: colors.paper, border: `1px solid ${colors.line}` }}>
                  <div className="mb-2 flex items-center gap-2">
                    <input className="df-input grow rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} placeholder="Désignation du poste" value={l.designation} onChange={(e) => patchLine(l.id, { designation: e.target.value })} />
                    {localDoc.items.length > 1 && <button onClick={() => removeLine(l.id)} style={{ color: colors.brick }}><Trash2 size={14} /></button>}
                  </div>
                  <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div><label className="mb-0.5 block text-xs" style={{ color: colors.inkSoft }}>Qté</label><input type="number" className="df-input df-mono w-full rounded-md px-2 py-1 text-xs" style={{ border: `1px solid ${colors.line}` }} value={l.qty} onChange={(e) => patchLine(l.id, { qty: e.target.value })} /></div>
                    <div><label className="mb-0.5 block text-xs" style={{ color: colors.inkSoft }}>PU HT</label><input type="number" className="df-input df-mono w-full rounded-md px-2 py-1 text-xs" style={{ border: `1px solid ${colors.line}` }} value={l.unitPrice} onChange={(e) => patchLine(l.id, { unitPrice: e.target.value })} /></div>
                    <div><label className="mb-0.5 block text-xs" style={{ color: colors.inkSoft }}>TVA %</label><input type="number" className="df-input df-mono w-full rounded-md px-2 py-1 text-xs" style={{ border: `1px solid ${colors.line}` }} value={l.tva} onChange={(e) => patchLine(l.id, { tva: e.target.value })} /></div>
                    <div><label className="mb-0.5 block text-xs" style={{ color: colors.inkSoft }}>Montant marché</label><div className="df-mono rounded-md px-2 py-1 text-xs" style={{ background: colors.surface }}>{formatMoney(cl.montantMarche, localDoc.currency)}</div></div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div>
                      <label className="mb-0.5 block text-xs" style={{ color: colors.inkSoft }}>% avancement cumulé</label>
                      <input type="number" step="0.1" min="0" max="100" className="df-input df-mono w-full rounded-md px-2 py-1 text-xs" style={{ border: `1px solid ${colors.line}` }} value={l.avancementPct} onChange={(e) => patchLine(l.id, { avancementPct: e.target.value })} />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-xs" style={{ color: colors.inkSoft }}>Déjà facturé</label>
                      <input type="number" className="df-input df-mono w-full rounded-md px-2 py-1 text-xs" style={{ border: `1px solid ${colors.line}`, background: localDoc.previousSituationId ? colors.surface : "white" }} value={l.montantCumulePrecedent} onChange={(e) => patchLine(l.id, { montantCumulePrecedent: e.target.value })} />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-xs" style={{ color: colors.inkSoft }}>Cette situation</label>
                      <div className="df-mono rounded-md px-2 py-1 text-xs font-semibold" style={{ background: `${colors.moss}18`, color: colors.moss }}>{formatMoney(cl.montantCetteSituation, localDoc.currency)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs" style={{ color: colors.inkSoft }}>Retenue de garantie (%)</label>
              <input type="number" step="0.5" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.retenueGarantiePct} onChange={(e) => patch({ retenueGarantiePct: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs" style={{ color: colors.inkSoft }}>Acompte déjà versé</label>
              <input type="number" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.acompteVerse} onChange={(e) => patch({ acompteVerse: e.target.value })} />
            </div>
          </div>

          <div className="mb-6 rounded-xl p-4" style={{ background: `${colors.ink}` }}>
            <div className="flex items-center justify-between text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
              <span>Avancement global du chantier</span>
              <span className="df-mono font-semibold text-white">{s.avancementGlobalPct.toFixed(1)}%</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-lg font-semibold text-white">
              <span>Net à payer (cette situation)</span>
              <span className="df-mono">{formatMoney(s.netAPayer, localDoc.currency)}</span>
            </div>
          </div>

          <label className="mb-1 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Note</label>
          <textarea className="df-textarea w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} value={localDoc.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </div>
      </div>

      <PrintSituation ref={printRef} doc={localDoc} siteSettings={siteSettings} watermarkEnabled={watermarkEnabled} />
    </div>
  );
}

const PV_TYPES = {
  sans_reserves: { label: "Réception sans réserves", color: "#2F6B4F" },
  avec_reserves: { label: "Réception avec réserves", color: "#B8763E" },
  refusee: { label: "Réception refusée", color: "#A33B2A" },
};

const PrintPvReception = forwardRef(function PrintPvReception({ doc, siteSettings, watermarkEnabled = true }, ref) {
  const ink = siteSettings?.pdfHeaderColor || "#1B2A33";
  const inkSoft = "#4A5B63", line = "#DAE1DC";
  const box = siteSettings?.pdfBlockColor || "#F1F0EA";
  const pageBg = siteSettings?.pdfBackground || "#FBF7EF";
  const garanties = computePvGaranties(doc);
  const typeInfo = PV_TYPES[doc.typeReception] || PV_TYPES.sans_reserves;
  const watermarkText = (siteSettings?.name || "DeviFact").toUpperCase();
  const watermarkSize = Math.max(24, Math.min(48, Math.round(760 / Math.max(watermarkText.length, 1))));
  const pStyle = {
    fontFamily: "'Inter', sans-serif", color: ink, fontSize: "9.5pt", lineHeight: 1.4,
    background: pageBg, width: "210mm", minHeight: "294mm", boxSizing: "border-box",
    padding: "24px 28px", position: "relative", overflow: "hidden",
  };
  return (
    <div ref={ref} className="print-doc" style={pStyle}>
      {watermarkEnabled && (
        <div style={{ position: "absolute", top: "45%", left: "50%", transform: "translate(-50%, -50%) rotate(-32deg)", fontFamily: "'Space Grotesk', sans-serif", fontSize: `${watermarkSize}pt`, fontWeight: 700, color: "rgba(27,42,51,0.08)", whiteSpace: "nowrap", pointerEvents: "none" }}>{watermarkText}</div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative", zIndex: 1 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "14pt" }}>PROCÈS-VERBAL DE RÉCEPTION DE TRAVAUX</div>
          <div style={{ color: inkSoft, marginTop: "4px" }}>Réf. {doc.docNumber} — Date : {new Date(doc.issueDate).toLocaleDateString("fr-FR")}</div>
          {doc.marcheNumero && <div style={{ color: inkSoft }}>Marché N° : {doc.marcheNumero}</div>}
        </div>
        {doc.company.logo ? <img src={doc.company.logo} alt="" style={{ maxHeight: "48px", maxWidth: "160px", objectFit: "contain" }} /> : <div style={{ fontWeight: 700, fontSize: "13pt" }}>{doc.company.name}</div>}
      </div>
      {doc.objet && <div style={{ marginTop: "10px", fontSize: "9pt", color: inkSoft, position: "relative", zIndex: 1 }}>{doc.objet}</div>}

      <div style={{ display: "flex", gap: "16px", marginTop: "16px", position: "relative", zIndex: 1 }}>
        <div style={{ flex: 1, background: box, borderRadius: "4px", padding: "10px 14px" }}>
          <div style={{ fontWeight: 700, marginBottom: "3px" }}>{doc.company.name || "—"}</div>
          {doc.company.address && <div>{doc.company.address}</div>}
        </div>
        <div style={{ flex: 1, background: box, borderRadius: "4px", padding: "10px 14px" }}>
          {doc.client.name && <div style={{ fontWeight: 600 }}>{doc.client.name}</div>}
          {doc.client.address && <div>{doc.client.address}</div>}
        </div>
      </div>

      <div style={{ marginTop: "16px", display: "flex", gap: "16px", position: "relative", zIndex: 1 }}>
        {doc.dateDebutTravaux && <div style={{ fontSize: "9pt" }}>Début des travaux : <strong>{new Date(doc.dateDebutTravaux).toLocaleDateString("fr-FR")}</strong></div>}
        <div style={{ fontSize: "9pt" }}>Date de réception effective : <strong>{doc.dateReceptionEffective ? new Date(doc.dateReceptionEffective).toLocaleDateString("fr-FR") : "—"}</strong></div>
      </div>

      <div style={{ marginTop: "14px", padding: "10px 14px", borderRadius: "4px", background: typeInfo.color, color: "white", fontWeight: 700, fontSize: "11pt", textAlign: "center", position: "relative", zIndex: 1 }}>
        {typeInfo.label.toUpperCase()}
      </div>

      {doc.typeReception === "avec_reserves" && (doc.reserves || []).length > 0 && (
        <div style={{ marginTop: "16px", position: "relative", zIndex: 1 }}>
          <div style={{ fontWeight: 700, marginBottom: "6px", fontSize: "10pt" }}>Liste des réserves</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt" }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${ink}` }}>
                <th style={{ padding: "5px 4px", textAlign: "left" }}>Description</th>
                <th style={{ padding: "5px 4px", textAlign: "left" }}>Localisation</th>
                <th style={{ padding: "5px 4px", textAlign: "right" }}>Délai</th>
                <th style={{ padding: "5px 4px", textAlign: "center" }}>État</th>
              </tr>
            </thead>
            <tbody>
              {doc.reserves.map((r) => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${line}` }}>
                  <td style={{ padding: "5px 4px" }}>{r.description}</td>
                  <td style={{ padding: "5px 4px" }}>{r.localisation}</td>
                  <td style={{ padding: "5px 4px", textAlign: "right" }}>{r.delaiJours} jours</td>
                  <td style={{ padding: "5px 4px", textAlign: "center" }}>{r.levee ? "Levée" : "Non levée"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {garanties && (
        <div style={{ marginTop: "18px", padding: "10px 14px", borderRadius: "4px", background: box, position: "relative", zIndex: 1 }}>
          <div style={{ fontWeight: 700, marginBottom: "6px", fontSize: "9.5pt" }}>Garanties légales (calculées à partir de la date de réception)</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "8.5pt", padding: "2px 0" }}><span>Garantie de parfait achèvement (1 an)</span><span>{garanties.parfaitAchevement.toLocaleDateString("fr-FR")}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "8.5pt", padding: "2px 0" }}><span>Garantie biennale — équipements (2 ans)</span><span>{garanties.biennale.toLocaleDateString("fr-FR")}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "8.5pt", padding: "2px 0" }}><span>Garantie décennale — structure (10 ans)</span><span>{garanties.decennale.toLocaleDateString("fr-FR")}</span></div>
        </div>
      )}

      {doc.notes && <div style={{ marginTop: "16px", fontSize: "8.5pt", color: inkSoft, position: "relative", zIndex: 1 }}>{renderMarkup(doc.notes)}</div>}

      <div style={{ display: "flex", gap: "24px", marginTop: "32px", position: "relative", zIndex: 1 }}>
        <div style={{ flex: 1, borderTop: `1px solid ${ink}`, paddingTop: "6px" }}>
          <div style={{ fontWeight: 700, fontSize: "9pt" }}>Le client</div>
          <div style={{ fontSize: "8.5pt", color: inkSoft, marginTop: "2px" }}>{doc.signatureClient?.date ? new Date(doc.signatureClient.date).toLocaleDateString("fr-FR") : ""}</div>
          {doc.signatureClient?.name && <div style={{ marginTop: "18px", fontFamily: "'Space Grotesk', sans-serif", fontSize: "13pt", fontStyle: "italic" }}>{doc.signatureClient.name}</div>}
        </div>
        <div style={{ flex: 1, borderTop: `1px solid ${ink}`, paddingTop: "6px" }}>
          <div style={{ fontWeight: 700, fontSize: "9pt" }}>L'entreprise</div>
          <div style={{ fontSize: "8.5pt", color: inkSoft, marginTop: "2px" }}>{doc.signatureEntreprise?.date ? new Date(doc.signatureEntreprise.date).toLocaleDateString("fr-FR") : ""}</div>
          {doc.signatureEntreprise?.name && <div style={{ marginTop: "18px", fontFamily: "'Space Grotesk', sans-serif", fontSize: "13pt", fontStyle: "italic" }}>{doc.signatureEntreprise.name}</div>}
        </div>
      </div>
    </div>
  );
});

function PvReceptionEditor({ doc, saving, account, plans, siteSettings, isLocked, isViewer, onChange, onBack, onGoToPricing }) {
  const [localDoc, setLocalDoc] = useState(doc);
  const saveTimer = useRef(null);
  useEffect(() => setLocalDoc(doc), [doc.id]);

  function patch(p) {
    const next = { ...localDoc, ...p };
    setLocalDoc(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onChange(p), 400);
  }
  function patchDeep(field, p) { patch({ [field]: { ...localDoc[field], ...p } }); }
  function addReserve() { patch({ reserves: [...(localDoc.reserves || []), emptyReserve()] }); }
  function patchReserve(id, p) { patch({ reserves: (localDoc.reserves || []).map((r) => (r.id === id ? { ...r, ...p } : r)) }); }
  function removeReserve(id) { patch({ reserves: (localDoc.reserves || []).filter((r) => r.id !== id) }); }

  const currentPlanData = (plans || []).find((p) => p.id === (account?.plan || "gratuit"));
  const watermarkEnabled = currentPlanData?.watermarkEnabled !== false;
  const printRef = useRef(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const garanties = computePvGaranties(localDoc);

  async function downloadPdf() {
    const el = printRef.current;
    if (!el || pdfGenerating) return;
    setPdfGenerating(true);
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
      let heightLeft = imgHeight, position = 0;
      pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 3) { position -= pageHeight; pdf.addPage(); pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight); heightLeft -= pageHeight; }
      pdf.save(`${(localDoc.docNumber || "pv-reception").replace(/[\\/:*?"<>|]/g, "-")}.pdf`);
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
    const rows = [];
    rows.push(["PV DE RÉCEPTION", localDoc.docNumber]);
    rows.push(["Date de réception", localDoc.dateReceptionEffective ? fr(localDoc.dateReceptionEffective) : ""]);
    rows.push(["Marché N°", localDoc.marcheNumero || ""]);
    rows.push(["Objet", localDoc.objet || ""]);
    rows.push(["Entreprise", localDoc.company?.name || ""]);
    rows.push(["Client", localDoc.client?.name || ""]);
    rows.push(["Type de réception", (PV_TYPES[localDoc.typeReception] || {}).label || ""]);
    if (garanties) {
      rows.push([]);
      rows.push(["Garanties légales"]);
      rows.push(["Parfait achèvement (1 an)", garanties.parfaitAchevement.toLocaleDateString("fr-FR")]);
      rows.push(["Biennale (2 ans)", garanties.biennale.toLocaleDateString("fr-FR")]);
      rows.push(["Décennale (10 ans)", garanties.decennale.toLocaleDateString("fr-FR")]);
    }
    if ((localDoc.reserves || []).length) {
      rows.push([]);
      rows.push(["Réserves", "Localisation", "Délai (jours)", "Levée"]);
      localDoc.reserves.forEach((r) => rows.push([r.description, r.localisation, r.delaiJours, r.levee ? "Oui" : "Non"]));
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 32 }, { wch: 20 }, { wch: 14 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PV réception");
    XLSX.writeFile(wb, `${localDoc.docNumber}.xlsx`);
  }

  return (
    <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-white"><ArrowLeft size={16} /> Tableau de bord</button>
        <div className="flex items-center gap-2">
          <button onClick={downloadPdf} disabled={pdfGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink, opacity: pdfGenerating ? 0.7 : 1 }}>
            {pdfGenerating ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} {pdfGenerating ? "Génération…" : "PDF"}
          </button>
          <button onClick={exportExcel} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.slate }}>
            <Download size={15} /> Excel
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {isLocked && (
          <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4" style={{ background: `${colors.brick}12`, border: `1px solid ${colors.brick}40` }}>
            <span className="flex items-center gap-2 text-sm font-medium" style={{ color: colors.brick }}>
              <Lock size={15} /> {isViewer ? "Accès en lecture seule — ce document n'est pas modifiable." : "Limite du forfait Gratuit atteinte — ce document n'est plus modifiable."}
            </span>
            {!isViewer && <button onClick={onGoToPricing} className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white" style={{ background: colors.brick }}>Passer à un forfait payant</button>}
          </div>
        )}
        <div className="rounded-2xl p-6 shadow-sm sm:p-8" style={{ background: colors.surface, border: `1px solid ${colors.line}`, pointerEvents: isLocked ? "none" : "auto", opacity: isLocked ? 0.55 : 1 }}>
          <h1 className="df-display mb-6 border-b pb-4 text-xl font-semibold" style={{ borderColor: colors.line }}>Procès-verbal de réception de travaux</h1>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Marché N°</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.marcheNumero || ""} onChange={(e) => patch({ marcheNumero: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Date de réception effective</label>
              <input type="date" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.dateReceptionEffective || ""} onChange={(e) => patch({ dateReceptionEffective: e.target.value })} />
            </div>
          </div>
          <div className="mb-6">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Objet</label>
            <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.objet || ""} onChange={(e) => patch({ objet: e.target.value })} />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg p-3" style={{ background: colors.paper }}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Entreprise</label>
              <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom" value={localDoc.company.name} onChange={(e) => patchDeep("company", { name: e.target.value })} />
              <input className="df-input w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Adresse" value={localDoc.company.address} onChange={(e) => patchDeep("company", { address: e.target.value })} />
            </div>
            <div className="rounded-lg p-3" style={{ background: colors.paper }}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Client</label>
              <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom" value={localDoc.client.name} onChange={(e) => patchDeep("client", { name: e.target.value })} />
              <input className="df-input w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Adresse" value={localDoc.client.address} onChange={(e) => patchDeep("client", { address: e.target.value })} />
            </div>
          </div>

          <div className="mb-6">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Type de réception</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(PV_TYPES).map(([id, info]) => (
                <button key={id} onClick={() => patch({ typeReception: id })} className="rounded-lg px-3 py-2 text-sm font-medium" style={{ background: localDoc.typeReception === id ? info.color : colors.paper, color: localDoc.typeReception === id ? "white" : colors.inkSoft }}>
                  {info.label}
                </button>
              ))}
            </div>
          </div>

          {localDoc.typeReception === "avec_reserves" && (
            <div className="mb-6">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Réserves</label>
                <button onClick={addReserve} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: colors.ink, color: "white" }}><Plus size={12} /> Réserve</button>
              </div>
              <div className="space-y-2">
                {(localDoc.reserves || []).map((r) => (
                  <div key={r.id} className="rounded-lg p-3" style={{ background: colors.paper, border: `1px solid ${colors.line}` }}>
                    <div className="mb-2 flex items-center gap-2">
                      <input className="df-input grow rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} placeholder="Description de la réserve" value={r.description} onChange={(e) => patchReserve(r.id, { description: e.target.value })} />
                      <button onClick={() => removeReserve(r.id)} style={{ color: colors.brick }}><Trash2 size={14} /></button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <input className="df-input rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} placeholder="Localisation" value={r.localisation} onChange={(e) => patchReserve(r.id, { localisation: e.target.value })} />
                      <input type="number" className="df-input df-mono rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} placeholder="Délai (jours)" value={r.delaiJours} onChange={(e) => patchReserve(r.id, { delaiJours: e.target.value })} />
                      <label className="flex items-center gap-1.5 text-xs" style={{ color: colors.inkSoft }}>
                        <input type="checkbox" checked={r.levee} onChange={(e) => patchReserve(r.id, { levee: e.target.checked })} /> Levée
                      </label>
                    </div>
                  </div>
                ))}
                {(localDoc.reserves || []).length === 0 && <p className="text-xs" style={{ color: colors.inkSoft }}>Aucune réserve ajoutée pour l'instant.</p>}
              </div>
            </div>
          )}

          {garanties && (
            <div className="mb-6 rounded-lg p-3" style={{ background: `${colors.moss}0D`, border: `1px solid ${colors.moss}30` }}>
              <div className="mb-1.5 text-xs font-semibold" style={{ color: colors.moss }}>Garanties légales (calculées automatiquement)</div>
              <div className="flex justify-between text-xs" style={{ color: colors.ink }}><span>Parfait achèvement (1 an)</span><span className="df-mono">{garanties.parfaitAchevement.toLocaleDateString("fr-FR")}</span></div>
              <div className="flex justify-between text-xs" style={{ color: colors.ink }}><span>Biennale (2 ans)</span><span className="df-mono">{garanties.biennale.toLocaleDateString("fr-FR")}</span></div>
              <div className="flex justify-between text-xs" style={{ color: colors.ink }}><span>Décennale (10 ans)</span><span className="df-mono">{garanties.decennale.toLocaleDateString("fr-FR")}</span></div>
            </div>
          )}

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg p-3" style={{ background: colors.paper }}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Signature — le client</label>
              <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom (vaut signature)" value={localDoc.signatureClient?.name || ""} onChange={(e) => patchDeep("signatureClient", { name: e.target.value })} />
              <input type="date" className="df-input df-mono w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.signatureClient?.date || ""} onChange={(e) => patchDeep("signatureClient", { date: e.target.value })} />
            </div>
            <div className="rounded-lg p-3" style={{ background: colors.paper }}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Signature — l'entreprise</label>
              <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom (vaut signature)" value={localDoc.signatureEntreprise?.name || ""} onChange={(e) => patchDeep("signatureEntreprise", { name: e.target.value })} />
              <input type="date" className="df-input df-mono w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.signatureEntreprise?.date || ""} onChange={(e) => patchDeep("signatureEntreprise", { date: e.target.value })} />
            </div>
          </div>

          <label className="mb-1 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Note</label>
          <textarea className="df-textarea w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} value={localDoc.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </div>
      </div>

      <PrintPvReception ref={printRef} doc={localDoc} siteSettings={siteSettings} watermarkEnabled={watermarkEnabled} />
    </div>
  );
}

const TYPES_INTERVENTION = { depannage: "Dépannage urgent", entretien: "Entretien programmé", sav: "Service après-vente", diagnostic: "Diagnostic" };
const STATUTS_RESOLUTION = { resolu: { label: "Problème résolu", color: "#2F6B4F" }, partiel: { label: "Partiellement résolu", color: "#B8763E" }, nouvelle_intervention: { label: "Nouvelle intervention nécessaire", color: "#A33B2A" } };

const PrintRapportIntervention = forwardRef(function PrintRapportIntervention({ doc, siteSettings, watermarkEnabled = true }, ref) {
  const ink = siteSettings?.pdfHeaderColor || "#1B2A33";
  const inkSoft = "#4A5B63", line = "#DAE1DC";
  const box = siteSettings?.pdfBlockColor || "#F1F0EA";
  const pageBg = siteSettings?.pdfBackground || "#FBF7EF";
  const duree = computeInterventionDuree(doc);
  const statut = STATUTS_RESOLUTION[doc.statutResolution] || STATUTS_RESOLUTION.resolu;
  const watermarkText = (siteSettings?.name || "DeviFact").toUpperCase();
  const watermarkSize = Math.max(24, Math.min(48, Math.round(760 / Math.max(watermarkText.length, 1))));
  const pStyle = {
    fontFamily: "'Inter', sans-serif", color: ink, fontSize: "9.5pt", lineHeight: 1.4,
    background: pageBg, width: "210mm", minHeight: "294mm", boxSizing: "border-box",
    padding: "24px 28px", position: "relative", overflow: "hidden",
  };
  return (
    <div ref={ref} className="print-doc" style={pStyle}>
      {watermarkEnabled && (
        <div style={{ position: "absolute", top: "45%", left: "50%", transform: "translate(-50%, -50%) rotate(-32deg)", fontFamily: "'Space Grotesk', sans-serif", fontSize: `${watermarkSize}pt`, fontWeight: 700, color: "rgba(27,42,51,0.08)", whiteSpace: "nowrap", pointerEvents: "none" }}>{watermarkText}</div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative", zIndex: 1 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "14pt" }}>RAPPORT D'INTERVENTION</div>
          <div style={{ color: inkSoft, marginTop: "4px" }}>Réf. {doc.docNumber} — Date : {new Date(doc.issueDate).toLocaleDateString("fr-FR")}</div>
          <div style={{ color: inkSoft }}>{TYPES_INTERVENTION[doc.typeIntervention] || ""}{doc.technicien ? ` — Technicien : ${doc.technicien}` : ""}</div>
        </div>
        {doc.company.logo ? <img src={doc.company.logo} alt="" style={{ maxHeight: "48px", maxWidth: "160px", objectFit: "contain" }} /> : <div style={{ fontWeight: 700, fontSize: "13pt" }}>{doc.company.name}</div>}
      </div>

      <div style={{ display: "flex", gap: "16px", marginTop: "16px", position: "relative", zIndex: 1 }}>
        <div style={{ flex: 1, background: box, borderRadius: "4px", padding: "10px 14px" }}>
          <div style={{ fontWeight: 700, marginBottom: "3px" }}>{doc.company.name || "—"}</div>
          {doc.company.phone && <div>Tél. {doc.company.phone}</div>}
        </div>
        <div style={{ flex: 1, background: box, borderRadius: "4px", padding: "10px 14px" }}>
          {doc.client.name && <div style={{ fontWeight: 600 }}>{doc.client.name}</div>}
          <div>{doc.adresseIntervention || doc.client.address}</div>
        </div>
      </div>

      <div style={{ marginTop: "16px", display: "flex", gap: "24px", fontSize: "9pt", position: "relative", zIndex: 1 }}>
        {doc.heureArrivee && <div>Arrivée : <strong>{doc.heureArrivee}</strong></div>}
        {doc.heureDepart && <div>Départ : <strong>{doc.heureDepart}</strong></div>}
        {duree && <div>Durée : <strong>{duree.heures}h{String(duree.minutes).padStart(2, "0")}</strong></div>}
      </div>

      {doc.motifAppel && (
        <div style={{ marginTop: "16px", position: "relative", zIndex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "9.5pt", marginBottom: "3px" }}>Motif de l'appel</div>
          <div style={{ color: inkSoft }}>{doc.motifAppel}</div>
        </div>
      )}
      {doc.diagnostic && (
        <div style={{ marginTop: "12px", position: "relative", zIndex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "9.5pt", marginBottom: "3px" }}>Diagnostic</div>
          <div style={{ color: inkSoft }}>{doc.diagnostic}</div>
        </div>
      )}
      {doc.travauxRealises && (
        <div style={{ marginTop: "12px", position: "relative", zIndex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "9.5pt", marginBottom: "3px" }}>Travaux réalisés</div>
          <div style={{ color: inkSoft }}>{doc.travauxRealises}</div>
        </div>
      )}

      {(doc.materielsUtilises || []).length > 0 && (
        <div style={{ marginTop: "16px", position: "relative", zIndex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "9.5pt", marginBottom: "4px" }}>Matériel utilisé</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt" }}>
            <tbody>
              {doc.materielsUtilises.map((m) => (
                <tr key={m.id} style={{ borderBottom: `1px solid ${line}` }}>
                  <td style={{ padding: "4px 4px" }}>{m.designation}</td>
                  <td style={{ padding: "4px 4px", textAlign: "right", width: "80px" }}>× {m.quantite}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: "16px", padding: "10px 14px", borderRadius: "4px", background: statut.color, color: "white", fontWeight: 700, textAlign: "center", position: "relative", zIndex: 1 }}>
        {statut.label.toUpperCase()}
      </div>

      {doc.recommandations && (
        <div style={{ marginTop: "12px", position: "relative", zIndex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "9.5pt", marginBottom: "3px" }}>Recommandations</div>
          <div style={{ color: inkSoft }}>{doc.recommandations}</div>
        </div>
      )}
      {doc.prochaineInterventionDate && (
        <div style={{ marginTop: "8px", fontSize: "9pt", position: "relative", zIndex: 1 }}>Prochaine intervention recommandée : <strong>{new Date(doc.prochaineInterventionDate).toLocaleDateString("fr-FR")}</strong></div>
      )}

      {doc.notes && <div style={{ marginTop: "16px", fontSize: "8.5pt", color: inkSoft, position: "relative", zIndex: 1 }}>{renderMarkup(doc.notes)}</div>}

      <div style={{ marginTop: "32px", position: "relative", zIndex: 1, width: "260px" }}>
        <div style={{ borderTop: `1px solid ${ink}`, paddingTop: "6px" }}>
          <div style={{ fontWeight: 700, fontSize: "9pt" }}>Signature du client</div>
          <div style={{ fontSize: "8.5pt", color: inkSoft, marginTop: "2px" }}>Atteste de la réalisation de cette intervention — {doc.signatureClient?.date ? new Date(doc.signatureClient.date).toLocaleDateString("fr-FR") : ""}</div>
          {doc.signatureClient?.name && <div style={{ marginTop: "16px", fontFamily: "'Space Grotesk', sans-serif", fontSize: "13pt", fontStyle: "italic" }}>{doc.signatureClient.name}</div>}
        </div>
      </div>
    </div>
  );
});

function RapportInterventionEditor({ doc, saving, account, plans, siteSettings, isLocked, isViewer, onChange, onBack, onGoToPricing }) {
  const [localDoc, setLocalDoc] = useState(doc);
  const saveTimer = useRef(null);
  useEffect(() => setLocalDoc(doc), [doc.id]);

  function patch(p) {
    const next = { ...localDoc, ...p };
    setLocalDoc(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onChange(p), 400);
  }
  function patchDeep(field, p) { patch({ [field]: { ...localDoc[field], ...p } }); }
  function addMateriel() { patch({ materielsUtilises: [...(localDoc.materielsUtilises || []), emptyMaterielUtilise()] }); }
  function patchMateriel(id, p) { patch({ materielsUtilises: (localDoc.materielsUtilises || []).map((m) => (m.id === id ? { ...m, ...p } : m)) }); }
  function removeMateriel(id) { patch({ materielsUtilises: (localDoc.materielsUtilises || []).filter((m) => m.id !== id) }); }

  const currentPlanData = (plans || []).find((p) => p.id === (account?.plan || "gratuit"));
  const watermarkEnabled = currentPlanData?.watermarkEnabled !== false;
  const printRef = useRef(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const duree = computeInterventionDuree(localDoc);

  async function downloadPdf() {
    const el = printRef.current;
    if (!el || pdfGenerating) return;
    setPdfGenerating(true);
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
      let heightLeft = imgHeight, position = 0;
      pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 3) { position -= pageHeight; pdf.addPage(); pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight); heightLeft -= pageHeight; }
      pdf.save(`${(localDoc.docNumber || "rapport").replace(/[\\/:*?"<>|]/g, "-")}.pdf`);
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
    const rows = [];
    rows.push(["RAPPORT D'INTERVENTION", localDoc.docNumber]);
    rows.push(["Date", fr(localDoc.issueDate)]);
    rows.push(["Type d'intervention", TYPES_INTERVENTION[localDoc.typeIntervention] || ""]);
    rows.push(["Technicien", localDoc.technicien || ""]);
    rows.push(["Client", localDoc.client?.name || ""]);
    rows.push(["Adresse d'intervention", localDoc.adresseIntervention || ""]);
    rows.push(["Heure d'arrivée", localDoc.heureArrivee || ""]);
    rows.push(["Heure de départ", localDoc.heureDepart || ""]);
    rows.push(["Motif de l'appel", localDoc.motifAppel || ""]);
    rows.push(["Diagnostic", localDoc.diagnostic || ""]);
    rows.push(["Travaux réalisés", localDoc.travauxRealises || ""]);
    rows.push(["Statut", STATUTS_RESOLUTION[localDoc.statutResolution]?.label || ""]);
    rows.push(["Recommandations", localDoc.recommandations || ""]);
    if ((localDoc.materielsUtilises || []).length) {
      rows.push([]);
      rows.push(["Matériel utilisé", "Quantité"]);
      localDoc.materielsUtilises.forEach((m) => rows.push([m.designation, m.quantite]));
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 26 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rapport");
    XLSX.writeFile(wb, `${localDoc.docNumber}.xlsx`);
  }

  return (
    <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-white"><ArrowLeft size={16} /> Tableau de bord</button>
        <div className="flex items-center gap-2">
          <button onClick={downloadPdf} disabled={pdfGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink, opacity: pdfGenerating ? 0.7 : 1 }}>
            {pdfGenerating ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} {pdfGenerating ? "Génération…" : "PDF"}
          </button>
          <button onClick={exportExcel} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.slate }}>
            <Download size={15} /> Excel
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {isLocked && (
          <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4" style={{ background: `${colors.brick}12`, border: `1px solid ${colors.brick}40` }}>
            <span className="flex items-center gap-2 text-sm font-medium" style={{ color: colors.brick }}>
              <Lock size={15} /> {isViewer ? "Accès en lecture seule — ce document n'est pas modifiable." : "Limite du forfait Gratuit atteinte — ce document n'est plus modifiable."}
            </span>
            {!isViewer && <button onClick={onGoToPricing} className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white" style={{ background: colors.brick }}>Passer à un forfait payant</button>}
          </div>
        )}
        <div className="rounded-2xl p-6 shadow-sm sm:p-8" style={{ background: colors.surface, border: `1px solid ${colors.line}`, pointerEvents: isLocked ? "none" : "auto", opacity: isLocked ? 0.55 : 1 }}>
          <h1 className="df-display mb-6 border-b pb-4 text-xl font-semibold" style={{ borderColor: colors.line }}>Rapport d'intervention</h1>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Type d'intervention</label>
              <select className="df-select w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.typeIntervention} onChange={(e) => patch({ typeIntervention: e.target.value })}>
                {Object.entries(TYPES_INTERVENTION).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Technicien</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.technicien || ""} onChange={(e) => patch({ technicien: e.target.value })} />
            </div>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Heure d'arrivée</label>
              <input type="time" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.heureArrivee || ""} onChange={(e) => patch({ heureArrivee: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Heure de départ</label>
              <input type="time" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.heureDepart || ""} onChange={(e) => patch({ heureDepart: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Durée</label>
              <div className="df-mono rounded-md px-3 py-2 text-sm" style={{ background: colors.paper }}>{duree ? `${duree.heures}h${String(duree.minutes).padStart(2, "0")}` : "—"}</div>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg p-3" style={{ background: colors.paper }}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Client</label>
              <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom" value={localDoc.client.name} onChange={(e) => patchDeep("client", { name: e.target.value })} />
              <input className="df-input w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Adresse de facturation" value={localDoc.client.address} onChange={(e) => patchDeep("client", { address: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Adresse d'intervention (si différente)</label>
              <input className="df-input w-full rounded-md px-2 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.adresseIntervention || ""} onChange={(e) => patch({ adresseIntervention: e.target.value })} />
            </div>
          </div>

          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Motif de l'appel</label>
          <textarea className="df-textarea mb-4 w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} value={localDoc.motifAppel} onChange={(e) => patch({ motifAppel: e.target.value })} />

          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Diagnostic</label>
          <textarea className="df-textarea mb-4 w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} value={localDoc.diagnostic} onChange={(e) => patch({ diagnostic: e.target.value })} />

          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Travaux réalisés</label>
          <textarea className="df-textarea mb-4 w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} value={localDoc.travauxRealises} onChange={(e) => patch({ travauxRealises: e.target.value })} />

          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Matériel utilisé</label>
              <button onClick={addMateriel} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: colors.ink, color: "white" }}><Plus size={12} /> Matériel</button>
            </div>
            <div className="space-y-2">
              {(localDoc.materielsUtilises || []).map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <input className="df-input grow rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} placeholder="Désignation" value={m.designation} onChange={(e) => patchMateriel(m.id, { designation: e.target.value })} />
                  <input type="number" className="df-input df-mono w-20 rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} value={m.quantite} onChange={(e) => patchMateriel(m.id, { quantite: e.target.value })} />
                  <button onClick={() => removeMateriel(m.id)} style={{ color: colors.brick }}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Statut à l'issue de l'intervention</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(STATUTS_RESOLUTION).map(([id, info]) => (
                <button key={id} onClick={() => patch({ statutResolution: id })} className="rounded-lg px-3 py-2 text-sm font-medium" style={{ background: localDoc.statutResolution === id ? info.color : colors.paper, color: localDoc.statutResolution === id ? "white" : colors.inkSoft }}>
                  {info.label}
                </button>
              ))}
            </div>
          </div>

          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Recommandations</label>
          <textarea className="df-textarea mb-4 w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} value={localDoc.recommandations} onChange={(e) => patch({ recommandations: e.target.value })} />

          <div className="mb-6 max-w-xs">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Prochaine intervention recommandée</label>
            <input type="date" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.prochaineInterventionDate || ""} onChange={(e) => patch({ prochaineInterventionDate: e.target.value })} />
          </div>

          <div className="mb-6 rounded-lg p-3" style={{ background: colors.paper }}>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Signature du client (atteste de l'intervention)</label>
            <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom (vaut signature)" value={localDoc.signatureClient?.name || ""} onChange={(e) => patchDeep("signatureClient", { name: e.target.value })} />
            <input type="date" className="df-input df-mono w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.signatureClient?.date || ""} onChange={(e) => patchDeep("signatureClient", { date: e.target.value })} />
          </div>

          <label className="mb-1 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Note</label>
          <textarea className="df-textarea w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} value={localDoc.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </div>
      </div>

      <PrintRapportIntervention ref={printRef} doc={localDoc} siteSettings={siteSettings} watermarkEnabled={watermarkEnabled} />
    </div>
  );
}

const PrintContrat = forwardRef(function PrintContrat({ doc, siteSettings, watermarkEnabled = true }, ref) {
  const ink = siteSettings?.pdfHeaderColor || "#1B2A33";
  const inkSoft = "#4A5B63", line = "#DAE1DC";
  const box = siteSettings?.pdfBlockColor || "#F1F0EA";
  const pageBg = siteSettings?.pdfBackground || "#FBF7EF";
  const mono = { fontFamily: "'IBM Plex Mono', monospace" };
  const montantTVA = (Number(doc.montantTotalHT) || 0) * (Number(doc.tva) || 0) / 100;
  const montantTTC = (Number(doc.montantTotalHT) || 0) + montantTVA;
  const watermarkText = (siteSettings?.name || "DeviFact").toUpperCase();
  const watermarkSize = Math.max(24, Math.min(48, Math.round(760 / Math.max(watermarkText.length, 1))));
  const pStyle = {
    fontFamily: "'Inter', sans-serif", color: ink, fontSize: "9.5pt", lineHeight: 1.45,
    background: pageBg, width: "210mm", minHeight: "294mm", boxSizing: "border-box",
    padding: "24px 28px", position: "relative", overflow: "hidden",
  };
  const clause = (titre, texte) => texte && (
    <div style={{ marginTop: "14px", position: "relative", zIndex: 1 }}>
      <div style={{ fontWeight: 700, fontSize: "9.5pt", marginBottom: "3px" }}>{titre}</div>
      <div style={{ color: inkSoft, whiteSpace: "pre-wrap" }}>{texte}</div>
    </div>
  );
  return (
    <div ref={ref} className="print-doc" style={pStyle}>
      {watermarkEnabled && (
        <div style={{ position: "absolute", top: "45%", left: "50%", transform: "translate(-50%, -50%) rotate(-32deg)", fontFamily: "'Space Grotesk', sans-serif", fontSize: `${watermarkSize}pt`, fontWeight: 700, color: "rgba(27,42,51,0.08)", whiteSpace: "nowrap", pointerEvents: "none" }}>{watermarkText}</div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative", zIndex: 1 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "14pt" }}>CONTRAT DE CHANTIER</div>
          <div style={{ color: inkSoft, marginTop: "4px" }}>Réf. {doc.docNumber} — Date : {new Date(doc.issueDate).toLocaleDateString("fr-FR")}</div>
        </div>
        {doc.company.logo ? <img src={doc.company.logo} alt="" style={{ maxHeight: "48px", maxWidth: "160px", objectFit: "contain" }} /> : <div style={{ fontWeight: 700, fontSize: "13pt" }}>{doc.company.name}</div>}
      </div>

      <div style={{ marginTop: "10px", padding: "8px 12px", borderRadius: "4px", background: "#FDF3D9", color: "#7A5A12", fontSize: "8pt", fontStyle: "italic", position: "relative", zIndex: 1 }}>
        Modèle de contrat à adapter à votre situation. Ce document ne constitue pas un conseil juridique — faites-le relire par un professionnel du droit ou votre fédération professionnelle avant signature.
      </div>

      <div style={{ display: "flex", gap: "16px", marginTop: "16px", position: "relative", zIndex: 1 }}>
        <div style={{ flex: 1, background: box, borderRadius: "4px", padding: "10px 14px" }}>
          <div style={{ fontWeight: 700, marginBottom: "3px" }}>L'entreprise</div>
          <div>{doc.company.name || "—"}</div>
          {doc.company.address && <div>{doc.company.address}</div>}
          {doc.company.siret && <div>SIRET : {doc.company.siret}</div>}
        </div>
        <div style={{ flex: 1, background: box, borderRadius: "4px", padding: "10px 14px" }}>
          <div style={{ fontWeight: 700, marginBottom: "3px" }}>Le maître d'ouvrage</div>
          <div>{doc.client.name || "—"}</div>
          {doc.client.address && <div>{doc.client.address}</div>}
        </div>
      </div>

      {clause("Article 1 — Objet des travaux", doc.objetTravaux)}

      <div style={{ marginTop: "14px", padding: "10px 14px", borderRadius: "4px", background: box, position: "relative", zIndex: 1 }}>
        <div style={{ fontWeight: 700, marginBottom: "6px" }}>Article 2 — Prix</div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>Montant total HT</span><span style={mono}>{formatMoney(Number(doc.montantTotalHT) || 0, "EUR")}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", color: inkSoft }}><span>TVA {doc.tva}%</span><span style={mono}>{formatMoney(montantTVA, "EUR")}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginTop: "3px" }}><span>Montant total TTC</span><span style={mono}>{formatMoney(montantTTC, "EUR")}</span></div>
      </div>

      {clause("Article 3 — Modalités de paiement", doc.modalitesPaiement)}

      <div style={{ marginTop: "14px", display: "flex", gap: "24px", fontSize: "9pt", position: "relative", zIndex: 1 }}>
        {doc.dateDebutTravaux && <div>Début des travaux prévu : <strong>{new Date(doc.dateDebutTravaux).toLocaleDateString("fr-FR")}</strong></div>}
        {doc.dureeTravauxJours && <div>Durée prévisionnelle : <strong>{doc.dureeTravauxJours} jours</strong></div>}
      </div>

      {clause("Article 4 — Pénalités de retard", doc.penalitesRetard)}
      {clause("Article 5 — Assurances", doc.assurances)}
      {clause("Article 6 — Résiliation", doc.clauseResiliation)}
      {clause("Article 7 — Litiges", doc.clauseLitiges)}
      {doc.notes && clause("Notes complémentaires", doc.notes)}

      <div style={{ display: "flex", gap: "24px", marginTop: "32px", position: "relative", zIndex: 1 }}>
        <div style={{ flex: 1, borderTop: `1px solid ${ink}`, paddingTop: "6px" }}>
          <div style={{ fontWeight: 700, fontSize: "9pt" }}>Le maître d'ouvrage</div>
          <div style={{ fontSize: "8.5pt", color: inkSoft, marginTop: "2px" }}>Lu et approuvé — {doc.signatureClient?.date ? new Date(doc.signatureClient.date).toLocaleDateString("fr-FR") : ""}</div>
          {doc.signatureClient?.name && <div style={{ marginTop: "18px", fontFamily: "'Space Grotesk', sans-serif", fontSize: "13pt", fontStyle: "italic" }}>{doc.signatureClient.name}</div>}
        </div>
        <div style={{ flex: 1, borderTop: `1px solid ${ink}`, paddingTop: "6px" }}>
          <div style={{ fontWeight: 700, fontSize: "9pt" }}>L'entreprise</div>
          <div style={{ fontSize: "8.5pt", color: inkSoft, marginTop: "2px" }}>Lu et approuvé — {doc.signatureEntreprise?.date ? new Date(doc.signatureEntreprise.date).toLocaleDateString("fr-FR") : ""}</div>
          {doc.signatureEntreprise?.name && <div style={{ marginTop: "18px", fontFamily: "'Space Grotesk', sans-serif", fontSize: "13pt", fontStyle: "italic" }}>{doc.signatureEntreprise.name}</div>}
        </div>
      </div>
    </div>
  );
});

function ContratChantierEditor({ doc, saving, account, plans, siteSettings, isLocked, isViewer, onChange, onBack, onGoToPricing }) {
  const [localDoc, setLocalDoc] = useState(doc);
  const saveTimer = useRef(null);
  useEffect(() => setLocalDoc(doc), [doc.id]);

  function patch(p) {
    const next = { ...localDoc, ...p };
    setLocalDoc(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onChange(p), 400);
  }
  function patchDeep(field, p) { patch({ [field]: { ...localDoc[field], ...p } }); }

  const currentPlanData = (plans || []).find((p) => p.id === (account?.plan || "gratuit"));
  const watermarkEnabled = currentPlanData?.watermarkEnabled !== false;
  const printRef = useRef(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  async function downloadPdf() {
    const el = printRef.current;
    if (!el || pdfGenerating) return;
    setPdfGenerating(true);
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
      let heightLeft = imgHeight, position = 0;
      pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 3) { position -= pageHeight; pdf.addPage(); pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight); heightLeft -= pageHeight; }
      pdf.save(`${(localDoc.docNumber || "contrat").replace(/[\\/:*?"<>|]/g, "-")}.pdf`);
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
    const rows = [];
    rows.push(["CONTRAT DE CHANTIER", localDoc.docNumber]);
    rows.push(["Date", fr(localDoc.issueDate)]);
    rows.push(["Entreprise", localDoc.company?.name || ""]);
    rows.push(["Maître d'ouvrage", localDoc.client?.name || ""]);
    rows.push(["Objet des travaux", localDoc.objetTravaux || ""]);
    rows.push(["Montant total HT", Number(localDoc.montantTotalHT) || 0]);
    rows.push(["TVA %", Number(localDoc.tva) || 0]);
    rows.push(["Début des travaux", localDoc.dateDebutTravaux ? fr(localDoc.dateDebutTravaux) : ""]);
    rows.push(["Durée prévisionnelle (jours)", localDoc.dureeTravauxJours || ""]);
    rows.push(["Modalités de paiement", localDoc.modalitesPaiement || ""]);
    rows.push(["Pénalités de retard", localDoc.penalitesRetard || ""]);
    rows.push(["Assurances", localDoc.assurances || ""]);
    rows.push(["Résiliation", localDoc.clauseResiliation || ""]);
    rows.push(["Litiges", localDoc.clauseLitiges || ""]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 26 }, { wch: 50 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contrat");
    XLSX.writeFile(wb, `${localDoc.docNumber}.xlsx`);
  }

  return (
    <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-white"><ArrowLeft size={16} /> Tableau de bord</button>
        <div className="flex items-center gap-2">
          <button onClick={downloadPdf} disabled={pdfGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink, opacity: pdfGenerating ? 0.7 : 1 }}>
            {pdfGenerating ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} {pdfGenerating ? "Génération…" : "PDF"}
          </button>
          <button onClick={exportExcel} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.slate }}>
            <Download size={15} /> Excel
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="no-print mb-6 flex items-start gap-2.5 rounded-xl p-4" style={{ background: "#FDF3D9", border: "1px solid #E9CE85" }}>
          <AlertTriangle size={16} style={{ color: "#7A5A12", flexShrink: 0, marginTop: "1px" }} />
          <p className="text-xs" style={{ color: "#7A5A12" }}>
            <strong>Ce document fournit une structure et des clauses de départ courantes — ce n'est pas un conseil juridique.</strong> Le texte pré-rempli est générique et doit être adapté à ta situation, idéalement relu par un professionnel du droit ou ta fédération professionnelle avant signature.
          </p>
        </div>

        {isLocked && (
          <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4" style={{ background: `${colors.brick}12`, border: `1px solid ${colors.brick}40` }}>
            <span className="flex items-center gap-2 text-sm font-medium" style={{ color: colors.brick }}>
              <Lock size={15} /> {isViewer ? "Accès en lecture seule — ce document n'est pas modifiable." : "Limite du forfait Gratuit atteinte — ce document n'est plus modifiable."}
            </span>
            {!isViewer && <button onClick={onGoToPricing} className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white" style={{ background: colors.brick }}>Passer à un forfait payant</button>}
          </div>
        )}
        <div className="rounded-2xl p-6 shadow-sm sm:p-8" style={{ background: colors.surface, border: `1px solid ${colors.line}`, pointerEvents: isLocked ? "none" : "auto", opacity: isLocked ? 0.55 : 1 }}>
          <h1 className="df-display mb-6 border-b pb-4 text-xl font-semibold" style={{ borderColor: colors.line }}>Contrat de chantier</h1>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg p-3" style={{ background: colors.paper }}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Entreprise</label>
              <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom" value={localDoc.company.name} onChange={(e) => patchDeep("company", { name: e.target.value })} />
              <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Adresse" value={localDoc.company.address} onChange={(e) => patchDeep("company", { address: e.target.value })} />
              <input className="df-input w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="SIRET" value={localDoc.company.siret} onChange={(e) => patchDeep("company", { siret: e.target.value })} />
            </div>
            <div className="rounded-lg p-3" style={{ background: colors.paper }}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Maître d'ouvrage (client)</label>
              <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom" value={localDoc.client.name} onChange={(e) => patchDeep("client", { name: e.target.value })} />
              <input className="df-input w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Adresse" value={localDoc.client.address} onChange={(e) => patchDeep("client", { address: e.target.value })} />
            </div>
          </div>

          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Article 1 — Objet des travaux</label>
          <textarea className="df-textarea mb-4 w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "4rem" }} value={localDoc.objetTravaux} onChange={(e) => patch({ objetTravaux: e.target.value })} />

          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Montant total HT</label>
              <input type="number" className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.montantTotalHT} onChange={(e) => patch({ montantTotalHT: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>TVA %</label>
              <input type="number" className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.tva} onChange={(e) => patch({ tva: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Durée prévisionnelle (jours)</label>
              <input type="number" className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.dureeTravauxJours} onChange={(e) => patch({ dureeTravauxJours: e.target.value })} />
            </div>
          </div>

          <div className="mb-4 max-w-xs">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Début des travaux prévu</label>
            <input type="date" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.dateDebutTravaux || ""} onChange={(e) => patch({ dateDebutTravaux: e.target.value })} />
          </div>

          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Article 3 — Modalités de paiement</label>
          <textarea className="df-textarea mb-4 w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} value={localDoc.modalitesPaiement} onChange={(e) => patch({ modalitesPaiement: e.target.value })} />

          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Article 4 — Pénalités de retard</label>
          <textarea className="df-textarea mb-4 w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} value={localDoc.penalitesRetard} onChange={(e) => patch({ penalitesRetard: e.target.value })} />

          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Article 5 — Assurances</label>
          <textarea className="df-textarea mb-4 w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} value={localDoc.assurances} onChange={(e) => patch({ assurances: e.target.value })} />

          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Article 6 — Résiliation</label>
          <textarea className="df-textarea mb-4 w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} value={localDoc.clauseResiliation} onChange={(e) => patch({ clauseResiliation: e.target.value })} />

          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Article 7 — Litiges</label>
          <textarea className="df-textarea mb-4 w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} value={localDoc.clauseLitiges} onChange={(e) => patch({ clauseLitiges: e.target.value })} />

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg p-3" style={{ background: colors.paper }}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Signature — le maître d'ouvrage</label>
              <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom (vaut signature)" value={localDoc.signatureClient?.name || ""} onChange={(e) => patchDeep("signatureClient", { name: e.target.value })} />
              <input type="date" className="df-input df-mono w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.signatureClient?.date || ""} onChange={(e) => patchDeep("signatureClient", { date: e.target.value })} />
            </div>
            <div className="rounded-lg p-3" style={{ background: colors.paper }}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Signature — l'entreprise</label>
              <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom (vaut signature)" value={localDoc.signatureEntreprise?.name || ""} onChange={(e) => patchDeep("signatureEntreprise", { name: e.target.value })} />
              <input type="date" className="df-input df-mono w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.signatureEntreprise?.date || ""} onChange={(e) => patchDeep("signatureEntreprise", { date: e.target.value })} />
            </div>
          </div>

          <label className="mb-1 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Notes complémentaires</label>
          <textarea className="df-textarea w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} value={localDoc.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </div>
      </div>

      <PrintContrat ref={printRef} doc={localDoc} siteSettings={siteSettings} watermarkEnabled={watermarkEnabled} />
    </div>
  );
}

const PrintRelance = forwardRef(function PrintRelance({ doc, siteSettings, watermarkEnabled = true }, ref) {
  const ink = siteSettings?.pdfHeaderColor || "#1B2A33";
  const inkSoft = "#4A5B63", line = "#DAE1DC";
  const box = siteSettings?.pdfBlockColor || "#F1F0EA";
  const pageBg = siteSettings?.pdfBackground || "#FBF7EF";
  const mono = { fontFamily: "'IBM Plex Mono', monospace" };
  const dateLimite = computeRelanceDateLimite(doc);
  const watermarkText = (siteSettings?.name || "DeviFact").toUpperCase();
  const watermarkSize = Math.max(24, Math.min(48, Math.round(760 / Math.max(watermarkText.length, 1))));
  const pStyle = {
    fontFamily: "'Inter', sans-serif", color: ink, fontSize: "10pt", lineHeight: 1.5,
    background: pageBg, width: "210mm", minHeight: "294mm", boxSizing: "border-box",
    padding: "26px 30px", position: "relative", overflow: "hidden",
  };
  return (
    <div ref={ref} className="print-doc" style={pStyle}>
      {watermarkEnabled && (
        <div style={{ position: "absolute", top: "45%", left: "50%", transform: "translate(-50%, -50%) rotate(-32deg)", fontFamily: "'Space Grotesk', sans-serif", fontSize: `${watermarkSize}pt`, fontWeight: 700, color: "rgba(27,42,51,0.08)", whiteSpace: "nowrap", pointerEvents: "none" }}>{watermarkText}</div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative", zIndex: 1 }}>
        <div>
          {doc.company.name && <div style={{ fontWeight: 700 }}>{doc.company.name}</div>}
          {doc.company.address && <div style={{ fontSize: "9pt", color: inkSoft }}>{doc.company.address}</div>}
        </div>
        <div style={{ textAlign: "right", fontSize: "9pt", color: inkSoft }}>{new Date(doc.issueDate).toLocaleDateString("fr-FR")}</div>
      </div>

      <div style={{ marginTop: "24px", position: "relative", zIndex: 1 }}>
        <div>{doc.client.name}</div>
        {doc.client.address && <div>{doc.client.address}</div>}
      </div>

      <div style={{ marginTop: "10px", fontSize: "8pt", color: inkSoft, fontStyle: "italic", position: "relative", zIndex: 1 }}>Envoyé par lettre recommandée avec accusé de réception</div>

      <div style={{ marginTop: "24px", textAlign: "center", fontWeight: 700, fontSize: "13pt", letterSpacing: "0.03em", position: "relative", zIndex: 1 }}>
        MISE EN DEMEURE DE PAYER
      </div>

      <div style={{ marginTop: "24px", position: "relative", zIndex: 1 }}>
        <p>Madame, Monsieur,</p>
        <p style={{ marginTop: "10px" }}>
          Malgré nos relances précédentes, nous constatons que la facture {doc.factureRef ? <strong>n° {doc.factureRef}</strong> : ""}{doc.factureDate ? ` du ${new Date(doc.factureDate).toLocaleDateString("fr-FR")}` : ""}, d'un montant de <strong>{formatMoney(Number(doc.montantDu) || 0, doc.currency || "EUR")}</strong>{doc.dateEcheanceOrigine ? `, échue depuis le ${new Date(doc.dateEcheanceOrigine).toLocaleDateString("fr-FR")}` : ""}, demeure impayée à ce jour.
        </p>
        <p style={{ marginTop: "10px" }}>
          Par la présente, nous vous <strong>mettons en demeure</strong> de régler l'intégralité de cette somme dans un délai de <strong>{doc.delaiPaiementJours} jours</strong> à compter de la réception de ce courrier{dateLimite ? `, soit au plus tard le ${dateLimite.toLocaleDateString("fr-FR")}` : ""}.
        </p>
        <p style={{ marginTop: "10px" }}>
          À défaut de règlement dans ce délai, des pénalités de retard au taux de {doc.tauxInteretRetard} seront appliquées, ainsi qu'une indemnité forfaitaire pour frais de recouvrement de {formatMoney(Number(doc.indemniteForfaitaire) || 40, doc.currency || "EUR")}, conformément aux dispositions du Code de commerce. Nous nous réservons également le droit d'engager toute action, y compris judiciaire, pour obtenir le recouvrement de cette créance.
        </p>
        {doc.notes && <p style={{ marginTop: "10px", whiteSpace: "pre-wrap" }}>{doc.notes}</p>}
        <p style={{ marginTop: "10px" }}>Nous restons à votre disposition pour tout règlement amiable de cette situation.</p>
        <p style={{ marginTop: "10px" }}>Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.</p>
      </div>

      <div style={{ marginTop: "40px", textAlign: "right", position: "relative", zIndex: 1 }}>
        <div>{doc.company.name}</div>
      </div>

      <div style={{ marginTop: "30px", padding: "10px 14px", borderRadius: "4px", background: box, fontSize: "8pt", color: inkSoft, position: "relative", zIndex: 1 }}>
        Rappel des montants dus : {formatMoney(Number(doc.montantDu) || 0, doc.currency || "EUR")} — Date limite de paiement : {dateLimite ? dateLimite.toLocaleDateString("fr-FR") : "—"}
      </div>
    </div>
  );
});

function RelanceFormelleEditor({ doc, saving, account, plans, siteSettings, isLocked, isViewer, onChange, onBack, onGoToPricing }) {
  const [localDoc, setLocalDoc] = useState(doc);
  const saveTimer = useRef(null);
  useEffect(() => setLocalDoc(doc), [doc.id]);

  function patch(p) {
    const next = { ...localDoc, ...p };
    setLocalDoc(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onChange(p), 400);
  }
  function patchDeep(field, p) { patch({ [field]: { ...localDoc[field], ...p } }); }

  const currentPlanData = (plans || []).find((p) => p.id === (account?.plan || "gratuit"));
  const watermarkEnabled = currentPlanData?.watermarkEnabled !== false;
  const printRef = useRef(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const dateLimite = computeRelanceDateLimite(localDoc);

  async function downloadPdf() {
    const el = printRef.current;
    if (!el || pdfGenerating) return;
    setPdfGenerating(true);
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
      let heightLeft = imgHeight, position = 0;
      pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 3) { position -= pageHeight; pdf.addPage(); pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight); heightLeft -= pageHeight; }
      pdf.save(`${(localDoc.docNumber || "mise-en-demeure").replace(/[\\/:*?"<>|]/g, "-")}.pdf`);
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
    const rows = [];
    rows.push(["MISE EN DEMEURE", localDoc.docNumber]);
    rows.push(["Date d'émission", fr(localDoc.issueDate)]);
    rows.push(["Entreprise", localDoc.company?.name || ""]);
    rows.push(["Client débiteur", localDoc.client?.name || ""]);
    rows.push(["Facture concernée", localDoc.factureRef || ""]);
    rows.push(["Date de la facture", localDoc.factureDate ? fr(localDoc.factureDate) : ""]);
    rows.push(["Montant dû", Number(localDoc.montantDu) || 0]);
    rows.push(["Échéance d'origine", localDoc.dateEcheanceOrigine ? fr(localDoc.dateEcheanceOrigine) : ""]);
    rows.push(["Délai accordé (jours)", localDoc.delaiPaiementJours || ""]);
    rows.push(["Date limite de paiement", dateLimite ? dateLimite.toLocaleDateString("fr-FR") : ""]);
    rows.push(["Taux d'intérêt de retard", localDoc.tauxInteretRetard || ""]);
    rows.push(["Indemnité forfaitaire", Number(localDoc.indemniteForfaitaire) || 0]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 26 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mise en demeure");
    XLSX.writeFile(wb, `${localDoc.docNumber}.xlsx`);
  }

  return (
    <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-white"><ArrowLeft size={16} /> Tableau de bord</button>
        <div className="flex items-center gap-2">
          <button onClick={downloadPdf} disabled={pdfGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink, opacity: pdfGenerating ? 0.7 : 1 }}>
            {pdfGenerating ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} {pdfGenerating ? "Génération…" : "PDF"}
          </button>
          <button onClick={exportExcel} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.slate }}>
            <Download size={15} /> Excel
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="no-print mb-6 flex items-start gap-2.5 rounded-xl p-4" style={{ background: "#FDF3D9", border: "1px solid #E9CE85" }}>
          <AlertTriangle size={16} style={{ color: "#7A5A12", flexShrink: 0, marginTop: "1px" }} />
          <p className="text-xs" style={{ color: "#7A5A12" }}>
            Pour avoir sa pleine valeur légale, cette mise en demeure doit être envoyée par <strong>lettre recommandée avec accusé de réception</strong> (au guichet ou en ligne) — ce PDF en est le contenu, pas l'envoi lui-même.
          </p>
        </div>

        {isLocked && (
          <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4" style={{ background: `${colors.brick}12`, border: `1px solid ${colors.brick}40` }}>
            <span className="flex items-center gap-2 text-sm font-medium" style={{ color: colors.brick }}>
              <Lock size={15} /> {isViewer ? "Accès en lecture seule — ce document n'est pas modifiable." : "Limite du forfait Gratuit atteinte — ce document n'est plus modifiable."}
            </span>
            {!isViewer && <button onClick={onGoToPricing} className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white" style={{ background: colors.brick }}>Passer à un forfait payant</button>}
          </div>
        )}
        <div className="rounded-2xl p-6 shadow-sm sm:p-8" style={{ background: colors.surface, border: `1px solid ${colors.line}`, pointerEvents: isLocked ? "none" : "auto", opacity: isLocked ? 0.55 : 1 }}>
          <h1 className="df-display mb-6 border-b pb-4 text-xl font-semibold" style={{ borderColor: colors.line }}>Mise en demeure de payer</h1>

          <div className="mb-6 max-w-xs">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Date d'émission de ce courrier</label>
            <input type="date" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.issueDate || ""} onChange={(e) => patch({ issueDate: e.target.value })} />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg p-3" style={{ background: colors.paper }}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Entreprise</label>
              <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom" value={localDoc.company.name} onChange={(e) => patchDeep("company", { name: e.target.value })} />
              <input className="df-input w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Adresse" value={localDoc.company.address} onChange={(e) => patchDeep("company", { address: e.target.value })} />
            </div>
            <div className="rounded-lg p-3" style={{ background: colors.paper }}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Client débiteur</label>
              <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom" value={localDoc.client.name} onChange={(e) => patchDeep("client", { name: e.target.value })} />
              <input className="df-input w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Adresse" value={localDoc.client.address} onChange={(e) => patchDeep("client", { address: e.target.value })} />
            </div>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Facture concernée (référence)</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="ex : FAC-014" value={localDoc.factureRef || ""} onChange={(e) => patch({ factureRef: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Date de la facture</label>
              <input type="date" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.factureDate || ""} onChange={(e) => patch({ factureDate: e.target.value })} />
            </div>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Montant dû</label>
              <input type="number" className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.montantDu} onChange={(e) => patch({ montantDu: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Échéance d'origine</label>
              <input type="date" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.dateEcheanceOrigine || ""} onChange={(e) => patch({ dateEcheanceOrigine: e.target.value })} />
            </div>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Délai accordé (jours)</label>
              <input type="number" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.delaiPaiementJours} onChange={(e) => patch({ delaiPaiementJours: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Taux d'intérêt de retard</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.tauxInteretRetard} onChange={(e) => patch({ tauxInteretRetard: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Indemnité forfaitaire</label>
              <input type="number" className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.indemniteForfaitaire} onChange={(e) => patch({ indemniteForfaitaire: e.target.value })} />
            </div>
          </div>

          {dateLimite && (
            <div className="mb-6 rounded-lg p-3" style={{ background: `${colors.brick}0D`, border: `1px solid ${colors.brick}30` }}>
              <div className="flex items-center justify-between text-sm font-medium" style={{ color: colors.brick }}>
                <span>Date limite de paiement calculée</span>
                <span className="df-mono">{dateLimite.toLocaleDateString("fr-FR")}</span>
              </div>
            </div>
          )}

          <label className="mb-1 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Note complémentaire (optionnel, insérée dans le courrier)</label>
          <textarea className="df-textarea w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} value={localDoc.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </div>
      </div>

      <PrintRelance ref={printRef} doc={localDoc} siteSettings={siteSettings} watermarkEnabled={watermarkEnabled} />
    </div>
  );
}

const STATUTS_TACHE = {
  a_venir: { label: "À venir", color: "#8A97A0" },
  en_cours: { label: "En cours", color: "#B8763E" },
  termine: { label: "Terminé", color: "#2F6B4F" },
  retard: { label: "En retard", color: "#A33B2A" },
};

// Repères de mois pour la frise (une ligne verticale + libellé par
// début de mois compris dans la plage du planning).
function computeMonthMarkers(range) {
  if (!range) return [];
  const markers = [];
  const cursor = new Date(range.min.getFullYear(), range.min.getMonth(), 1);
  while (cursor <= range.max) {
    if (cursor >= range.min) {
      const offsetDays = Math.round((cursor - range.min) / 86400000);
      markers.push({ label: cursor.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }), leftPct: (offsetDays / range.totalDays) * 100 });
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return markers;
}

const PrintPlanning = forwardRef(function PrintPlanning({ doc, siteSettings, watermarkEnabled = true }, ref) {
  const ink = siteSettings?.pdfHeaderColor || "#1B2A33";
  const inkSoft = "#4A5B63", line = "#DAE1DC";
  const box = siteSettings?.pdfBlockColor || "#F1F0EA";
  const pageBg = siteSettings?.pdfBackground || "#FBF7EF";
  const range = computePlanningRange(doc);
  const monthMarkers = computeMonthMarkers(range);
  const watermarkText = (siteSettings?.name || "DeviFact").toUpperCase();
  const watermarkSize = Math.max(24, Math.min(48, Math.round(760 / Math.max(watermarkText.length, 1))));
  const pStyle = {
    fontFamily: "'Inter', sans-serif", color: ink, fontSize: "9.5pt", lineHeight: 1.4,
    background: pageBg, width: "297mm", minHeight: "210mm", boxSizing: "border-box",
    padding: "22px 26px", position: "relative", overflow: "hidden",
  };
  return (
    <div ref={ref} className="print-doc" style={pStyle}>
      {watermarkEnabled && (
        <div style={{ position: "absolute", top: "45%", left: "50%", transform: "translate(-50%, -50%) rotate(-25deg)", fontFamily: "'Space Grotesk', sans-serif", fontSize: `${watermarkSize}pt`, fontWeight: 700, color: "rgba(27,42,51,0.07)", whiteSpace: "nowrap", pointerEvents: "none" }}>{watermarkText}</div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative", zIndex: 1 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "14pt" }}>PLANNING DE CHANTIER</div>
          <div style={{ color: inkSoft, marginTop: "4px" }}>Réf. {doc.docNumber} — Date : {new Date(doc.issueDate).toLocaleDateString("fr-FR")}{doc.marcheNumero ? ` — Marché N° ${doc.marcheNumero}` : ""}</div>
          {doc.objet && <div style={{ color: inkSoft }}>{doc.objet}</div>}
          {doc.client?.name && <div style={{ color: inkSoft }}>Client : {doc.client.name}</div>}
        </div>
        {doc.company.logo ? <img src={doc.company.logo} alt="" style={{ maxHeight: "44px", maxWidth: "150px", objectFit: "contain" }} /> : <div style={{ fontWeight: 700, fontSize: "12pt" }}>{doc.company.name}</div>}
      </div>

      {range ? (
        <div style={{ marginTop: "20px", position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", marginBottom: "4px" }}>
            <div style={{ width: "160px", flexShrink: 0 }} />
            <div style={{ flex: 1, position: "relative", height: "16px" }}>
              {monthMarkers.map((m, i) => (
                <div key={i} style={{ position: "absolute", left: `${m.leftPct}%`, fontSize: "7.5pt", color: inkSoft, borderLeft: `1px solid ${line}`, paddingLeft: "3px", height: "100%" }}>{m.label}</div>
              ))}
            </div>
          </div>
          {(doc.taches || []).map((t) => {
            const pos = computeTachePosition(t, range);
            const statutEff = computeTacheStatutEffectif(t);
            const info = STATUTS_TACHE[statutEff];
            return (
              <div key={t.id} style={{ display: "flex", alignItems: "center", marginBottom: "6px" }}>
                <div style={{ width: "160px", flexShrink: 0, fontSize: "8.5pt", paddingRight: "8px" }}>
                  <div style={{ fontWeight: 600 }}>{t.designation || "—"}</div>
                  {t.corpsMetier && <div style={{ color: inkSoft, fontSize: "7.5pt" }}>{t.corpsMetier}</div>}
                </div>
                <div style={{ flex: 1, position: "relative", height: "18px", background: "#00000006", borderRadius: "3px" }}>
                  {monthMarkers.map((m, i) => (
                    <div key={i} style={{ position: "absolute", left: `${m.leftPct}%`, top: 0, bottom: 0, borderLeft: `1px solid ${line}` }} />
                  ))}
                  {pos && (
                    <div style={{ position: "absolute", left: `${pos.leftPct}%`, width: `${pos.widthPct}%`, top: "2px", bottom: "2px", background: info.color, borderRadius: "3px", minWidth: "3px" }} />
                  )}
                </div>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: "14px", marginTop: "12px", fontSize: "7.5pt" }}>
            {Object.entries(STATUTS_TACHE).map(([id, info]) => (
              <div key={id} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <div style={{ width: "9px", height: "9px", borderRadius: "2px", background: info.color }} />
                <span style={{ color: inkSoft }}>{info.label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: "24px", color: inkSoft, position: "relative", zIndex: 1 }}>Aucune tâche datée pour l'instant.</div>
      )}

      {doc.notes && <div style={{ marginTop: "20px", fontSize: "8.5pt", color: inkSoft, position: "relative", zIndex: 1 }}>{renderMarkup(doc.notes)}</div>}
    </div>
  );
});

function PlanningChantierEditor({ doc, saving, account, plans, siteSettings, isLocked, isViewer, onChange, onBack, onGoToPricing }) {
  const [localDoc, setLocalDoc] = useState(doc);
  const saveTimer = useRef(null);
  useEffect(() => setLocalDoc(doc), [doc.id]);

  function patch(p) {
    const next = { ...localDoc, ...p };
    setLocalDoc(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onChange(p), 400);
  }
  function patchDeep(field, p) { patch({ [field]: { ...localDoc[field], ...p } }); }
  function addTache() { patch({ taches: [...(localDoc.taches || []), emptyTachePlanning((localDoc.taches || []).length)] }); }
  function patchTache(id, p) { patch({ taches: (localDoc.taches || []).map((t) => (t.id === id ? { ...t, ...p } : t)) }); }
  function removeTache(id) { patch({ taches: (localDoc.taches || []).filter((t) => t.id !== id) }); }

  const currentPlanData = (plans || []).find((p) => p.id === (account?.plan || "gratuit"));
  const watermarkEnabled = currentPlanData?.watermarkEnabled !== false;
  const printRef = useRef(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const range = computePlanningRange(localDoc);
  const monthMarkers = computeMonthMarkers(range);

  async function downloadPdf() {
    const el = printRef.current;
    if (!el || pdfGenerating) return;
    setPdfGenerating(true);
    const prevStyle = { display: el.style.display, position: el.style.position, left: el.style.left, top: el.style.top, zIndex: el.style.zIndex };
    el.style.display = "block";
    el.style.position = "fixed";
    el.style.left = "-9999px";
    el.style.top = "0";
    el.style.zIndex = "-1";
    try {
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: siteSettings?.pdfBackground || "#FBF7EF" });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgHeight = (canvas.height * pageWidth) / canvas.width;
      let heightLeft = imgHeight, position = 0;
      pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 3) { position -= pageHeight; pdf.addPage(); pdf.addImage(imgData, "JPEG", 0, position, pageWidth, imgHeight); heightLeft -= pageHeight; }
      pdf.save(`${(localDoc.docNumber || "planning").replace(/[\\/:*?"<>|]/g, "-")}.pdf`);
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
    const rows = [];
    rows.push(["PLANNING DE CHANTIER", localDoc.docNumber]);
    rows.push(["Date", fr(localDoc.issueDate)]);
    rows.push(["Marché N°", localDoc.marcheNumero || ""]);
    rows.push(["Objet", localDoc.objet || ""]);
    rows.push([]);
    rows.push(["Tâche", "Corps de métier", "Début", "Fin", "Statut"]);
    (localDoc.taches || []).forEach((t) => rows.push([t.designation, t.corpsMetier, t.dateDebut ? fr(t.dateDebut) : "", t.dateFin ? fr(t.dateFin) : "", STATUTS_TACHE[computeTacheStatutEffectif(t)]?.label || ""]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 26 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Planning");
    XLSX.writeFile(wb, `${localDoc.docNumber}.xlsx`);
  }

  return (
    <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-white"><ArrowLeft size={16} /> Tableau de bord</button>
        <div className="flex items-center gap-2">
          <button onClick={downloadPdf} disabled={pdfGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink, opacity: pdfGenerating ? 0.7 : 1 }}>
            {pdfGenerating ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} {pdfGenerating ? "Génération…" : "PDF"}
          </button>
          <button onClick={exportExcel} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.slate }}>
            <Download size={15} /> Excel
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {isLocked && (
          <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4" style={{ background: `${colors.brick}12`, border: `1px solid ${colors.brick}40` }}>
            <span className="flex items-center gap-2 text-sm font-medium" style={{ color: colors.brick }}>
              <Lock size={15} /> {isViewer ? "Accès en lecture seule — ce document n'est pas modifiable." : "Limite du forfait Gratuit atteinte — ce document n'est plus modifiable."}
            </span>
            {!isViewer && <button onClick={onGoToPricing} className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white" style={{ background: colors.brick }}>Passer à un forfait payant</button>}
          </div>
        )}
        <div className="rounded-2xl p-6 shadow-sm sm:p-8" style={{ background: colors.surface, border: `1px solid ${colors.line}`, pointerEvents: isLocked ? "none" : "auto", opacity: isLocked ? 0.55 : 1 }}>
          <h1 className="df-display mb-6 border-b pb-4 text-xl font-semibold" style={{ borderColor: colors.line }}>Planning de chantier</h1>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg p-3" style={{ background: colors.paper }}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Entreprise</label>
              <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom" value={localDoc.company.name} onChange={(e) => patchDeep("company", { name: e.target.value })} />
              <input className="df-input w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Adresse" value={localDoc.company.address} onChange={(e) => patchDeep("company", { address: e.target.value })} />
            </div>
            <div className="rounded-lg p-3" style={{ background: colors.paper }}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Client (optionnel)</label>
              <input className="df-input mb-1 w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Nom" value={localDoc.client.name} onChange={(e) => patchDeep("client", { name: e.target.value })} />
              <input className="df-input w-full rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Adresse" value={localDoc.client.address} onChange={(e) => patchDeep("client", { address: e.target.value })} />
            </div>
          </div>

          <div className="mb-6 max-w-xs">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Date d'émission</label>
            <input type="date" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.issueDate || ""} onChange={(e) => patch({ issueDate: e.target.value })} />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Marché N°</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.marcheNumero || ""} onChange={(e) => patch({ marcheNumero: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Objet</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={localDoc.objet || ""} onChange={(e) => patch({ objet: e.target.value })} />
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Tâches</label>
            <button onClick={addTache} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: colors.ink, color: "white" }}><Plus size={12} /> Tâche</button>
          </div>
          <div className="mb-6 space-y-2">
            {(localDoc.taches || []).map((t) => {
              const statutEff = computeTacheStatutEffectif(t);
              const info = STATUTS_TACHE[statutEff];
              return (
                <div key={t.id} className="rounded-lg p-3" style={{ background: colors.paper, border: `1px solid ${colors.line}` }}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: t.couleur }} />
                    <input className="df-input grow rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} placeholder="Désignation de la tâche" value={t.designation} onChange={(e) => patchTache(t.id, { designation: e.target.value })} />
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${info.color}18`, color: info.color }}>{info.label}</span>
                    {(localDoc.taches || []).length > 1 && <button onClick={() => removeTache(t.id)} style={{ color: colors.brick }}><Trash2 size={14} /></button>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <input className="df-input rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} placeholder="Corps de métier" value={t.corpsMetier} onChange={(e) => patchTache(t.id, { corpsMetier: e.target.value })} />
                    <input type="date" className="df-input df-mono rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} value={t.dateDebut} onChange={(e) => patchTache(t.id, { dateDebut: e.target.value })} />
                    <input type="date" className="df-input df-mono rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} value={t.dateFin} onChange={(e) => patchTache(t.id, { dateFin: e.target.value })} />
                    <label className="flex items-center gap-1.5 text-xs" style={{ color: colors.inkSoft }}>
                      <input type="checkbox" checked={t.statut === "termine"} onChange={(e) => patchTache(t.id, { statut: e.target.checked ? "termine" : "a_venir" })} /> Terminé
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          {range && (
            <div className="mb-6">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Aperçu de la frise</label>
              <div className="overflow-x-auto rounded-lg p-3" style={{ background: colors.paper, border: `1px solid ${colors.line}` }}>
                <div style={{ minWidth: "480px" }}>
                  <div className="flex" style={{ marginBottom: "4px" }}>
                    <div style={{ width: "120px", flexShrink: 0 }} />
                    <div style={{ flex: 1, position: "relative", height: "14px" }}>
                      {monthMarkers.map((m, i) => (
                        <div key={i} className="text-xs" style={{ position: "absolute", left: `${m.leftPct}%`, color: colors.inkSoft, borderLeft: `1px solid ${colors.line}`, paddingLeft: "3px" }}>{m.label}</div>
                      ))}
                    </div>
                  </div>
                  {(localDoc.taches || []).map((t) => {
                    const pos = computeTachePosition(t, range);
                    const statutEff = computeTacheStatutEffectif(t);
                    const info = STATUTS_TACHE[statutEff];
                    return (
                      <div key={t.id} className="flex items-center" style={{ marginBottom: "6px" }}>
                        <div className="truncate text-xs" style={{ width: "120px", flexShrink: 0, paddingRight: "6px" }}>{t.designation || "—"}</div>
                        <div style={{ flex: 1, position: "relative", height: "16px", background: "rgba(0,0,0,0.03)", borderRadius: "3px" }}>
                          {pos && <div style={{ position: "absolute", left: `${pos.leftPct}%`, width: `${pos.widthPct}%`, top: "2px", bottom: "2px", background: info.color, borderRadius: "3px", minWidth: "3px" }} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <label className="mb-1 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Note</label>
          <textarea className="df-textarea w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}`, minHeight: "3rem" }} value={localDoc.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </div>
      </div>

      <PrintPlanning ref={printRef} doc={localDoc} siteSettings={siteSettings} watermarkEnabled={watermarkEnabled} />
    </div>
  );
}

// Extrait le code ISO à 2 lettres d'une entrée du type "🇲🇦 MA" -> "ma".
function countryCodeOf(entry) {
  const m = /([A-Z]{2})\s*$/.exec(entry || "");
  return m ? m[1].toLowerCase() : null;
}

// Remplace le <select> natif pour le pays : les emojis drapeaux ne
// s'affichent pas correctement sur Windows (ils retombent sur du texte
// qui ressemble au code répété, ex: "MA MA") — on utilise donc de
// vraies images de drapeau (flagcdn.com), qui s'affichent partout,
// avec une recherche vu le grand nombre de pays.
function CountrySelect({ value, onChange, options, placeholder = "— Non précisé —", allowOther = false, showEmpty = true }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const list = (options || COUNTRIES).filter((c) => c.toLowerCase().includes(query.toLowerCase()));
  const code = countryCodeOf(value);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="df-input flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm" style={{ border: `1px solid ${colors.line}`, background: "white" }}>
        {code ? <img src={`https://flagcdn.com/24x18/${code}.png`} alt="" width={20} height={15} style={{ borderRadius: "2px", flexShrink: 0 }} onError={(e) => { e.target.style.display = "none"; }} /> : null}
        <span className="grow truncate" style={{ color: value ? colors.ink : colors.inkSoft }}>{value || placeholder}</span>
        <ChevronDown size={14} style={{ color: colors.inkSoft, flexShrink: 0 }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-full overflow-hidden rounded-lg shadow-lg" style={{ background: "white", border: `1px solid ${colors.line}` }}>
            <input
              autoFocus
              className="df-input w-full border-b px-3 py-2 text-sm outline-none"
              style={{ borderColor: colors.line }}
              placeholder="Rechercher un pays..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="max-h-60 overflow-y-auto">
              {showEmpty && (
                <button type="button" onClick={() => { onChange(""); setOpen(false); setQuery(""); }} className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-black/5" style={{ color: colors.inkSoft }}>
                  {placeholder}
                </button>
              )}
              {list.map((c) => {
                const cCode = countryCodeOf(c);
                return (
                  <button key={c} type="button" onClick={() => { onChange(c); setOpen(false); setQuery(""); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5">
                    {cCode ? <img src={`https://flagcdn.com/24x18/${cCode}.png`} alt="" width={20} height={15} style={{ borderRadius: "2px", flexShrink: 0 }} onError={(e) => { e.target.style.display = "none"; }} /> : <span style={{ width: 20, flexShrink: 0 }} />}
                    <span>{c}</span>
                  </button>
                );
              })}
              {allowOther && (
                <button type="button" onClick={() => { onChange("Autre"); setOpen(false); setQuery(""); }} className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-black/5">
                  Autre pays
                </button>
              )}
            </div>
          </div>
        </>
      )}
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

function ApiView({ account }) {
  const [keys, setKeys] = useState(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const isOwner = account?.role === "owner";
  const isEnterprise = account?.plan === "entreprise";

  async function loadKeys() {
    if (!account?.organizationId) { setKeys([]); return; }
    const { data, error: loadError } = await db
      .from("api_keys")
      .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
      .eq("organization_id", account.organizationId)
      .order("created_at", { ascending: false });
    if (loadError) { console.error("Erreur de chargement des clés API", loadError); setKeys([]); return; }
    setKeys(data || []);
  }

  useEffect(() => { loadKeys(); }, [account?.organizationId]);

  async function createKey() {
    setError("");
    setCreating(true);
    try {
      const { data: { session } } = await db.auth.getSession();
      const { data, error: fnError } = await db.functions.invoke("manage-api-key", {
        body: { action: "create", organizationId: account.organizationId, name: newKeyName.trim() || "Clé API" },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      let realMessage = data?.error;
      if (!realMessage && fnError?.context) {
        try { realMessage = (await fnError.context.json())?.error; } catch { /* pas de corps JSON lisible */ }
      }
      if (fnError || data?.error) { setError(realMessage || fnError?.message || "Erreur de création."); setCreating(false); return; }
      setRevealedKey(data.key);
      setNewKeyName("");
      await loadKeys();
    } catch (err) {
      console.error(err);
      setError((err && typeof err === "object" && err.message) ? err.message : "Une erreur est survenue. Réessaie.");
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(keyId) {
    const { data: { session } } = await db.auth.getSession();
    await db.functions.invoke("manage-api-key", {
      body: { action: "revoke", organizationId: account.organizationId, keyId },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    await loadKeys();
  }

  function copyKey() {
    navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!isEnterprise) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <Lock size={28} className="mx-auto mb-3" style={{ color: colors.inkSoft }} />
        <h1 className="df-display mb-1 text-lg font-semibold">Accès API réservé au forfait Entreprise</h1>
        <p className="text-sm" style={{ color: colors.inkSoft }}>Contacte-nous pour en savoir plus sur le forfait Entreprise.</p>
      </div>
    );
  }
  if (!isOwner) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <Lock size={28} className="mx-auto mb-3" style={{ color: colors.inkSoft }} />
        <h1 className="df-display mb-1 text-lg font-semibold">Réservé au propriétaire de l'organisation</h1>
        <p className="text-sm" style={{ color: colors.inkSoft }}>Seul le propriétaire peut créer et gérer les clés API.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="df-display text-2xl font-semibold">Accès API</h1>
        <p className="text-sm" style={{ color: colors.inkSoft }}>Récupère tes devis, factures et clients depuis un logiciel externe (comptabilité, CRM...).</p>
      </div>

      {revealedKey && (
        <div className="mb-6 rounded-2xl p-5" style={{ background: `${colors.moss}0D`, border: `1px solid ${colors.moss}40` }}>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: colors.moss }}>
            <Check size={16} /> Clé créée — copie-la maintenant, elle ne sera plus jamais affichée.
          </div>
          <div className="flex items-center gap-2 rounded-lg p-3" style={{ background: "white", border: `1px solid ${colors.line}` }}>
            <code className="df-mono grow break-all text-xs">{revealedKey}</code>
            <button onClick={copyKey} className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium" style={{ background: colors.ink, color: "white" }}>
              {copied ? "Copié !" : "Copier"}
            </button>
          </div>
          <button onClick={() => setRevealedKey(null)} className="mt-3 text-xs font-medium underline" style={{ color: colors.inkSoft }}>J'ai bien copié la clé, fermer</button>
        </div>
      )}

      <div className="mb-6 rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
        <span className="df-display mb-3 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Nouvelle clé</span>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grow basis-48 text-xs" style={{ color: colors.inkSoft }}>
            Nom (pour t'y retrouver)
            <input className="df-input mt-1 block w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="Logiciel de comptabilité" onKeyDown={(e) => { if (e.key === "Enter") createKey(); }} />
          </label>
          <button onClick={createKey} disabled={creating} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink, opacity: creating ? 0.7 : 1 }}>
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Générer une clé
          </button>
        </div>
        {error && <p className="mt-2 text-xs" style={{ color: colors.brick }}>{error}</p>}
      </div>

      {keys === null ? (
        <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin" style={{ color: colors.inkSoft }} /></div>
      ) : keys.length === 0 ? (
        <p className="mb-6 text-sm" style={{ color: colors.inkSoft }}>Aucune clé créée pour le moment.</p>
      ) : (
        <div className="mb-8 overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          {keys.map((k, idx) => (
            <div key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderTop: idx ? `1px solid ${colors.line}` : "none", opacity: k.revoked_at ? 0.5 : 1 }}>
              <div className="min-w-0 grow basis-32">
                <div className="text-sm font-medium">{k.name}</div>
                <div className="df-mono text-xs" style={{ color: colors.inkSoft }}>{k.key_prefix}</div>
              </div>
              <div className="text-xs" style={{ color: colors.inkSoft }}>
                {k.revoked_at ? "Révoquée" : k.last_used_at ? `Utilisée le ${new Date(k.last_used_at).toLocaleDateString("fr-FR")}` : "Jamais utilisée"}
              </div>
              {!k.revoked_at && (
                <button onClick={() => revokeKey(k.id)} className="text-xs font-medium" style={{ color: colors.brick }}>Révoquer</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
        <span className="df-display mb-3 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Comment l'utiliser</span>
        <p className="mb-3 text-xs" style={{ color: colors.inkSoft }}>Envoie ta clé dans l'en-tête <code className="df-mono">Authorization</code> de chaque requête. Deux ressources disponibles : <code className="df-mono">documents</code> (devis, factures, proforma) et <code className="df-mono">clients</code>.</p>
        <pre className="df-mono overflow-x-auto rounded-lg p-3 text-xs" style={{ background: colors.ink, color: "#E8E4D8" }}>
{`curl "https://ieshjvzmpbxtqielhaii.supabase.co/functions/v1/api?resource=documents" \\
  -H "Authorization: Bearer dfk_ta_clé_ici"`}
        </pre>
        <p className="mt-3 text-xs" style={{ color: colors.inkSoft }}>Ajoute <code className="df-mono">&id=xxx</code> pour récupérer un seul élément. Limite : 60 requêtes par minute et par clé.</p>
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
    const { data, error: loadError } = await db.rpc("get_organization_members_with_profiles", { org_id: account.organizationId });
    if (loadError) {
      console.error("Erreur de chargement de l'équipe", loadError);
      setMembersError(`Impossible de charger la liste des membres (${loadError.message || "erreur inconnue"}). Réessaie dans un instant.`);
      setMembers([]);
      return;
    }
    setMembersError("");
    // Reforme la structure attendue par le reste du composant
    // (profiles imbriqué), pour ne rien avoir à changer plus bas.
    setMembers((data || []).map((m) => ({
      id: m.id, user_id: m.user_id, role: m.role, status: m.status,
      profiles: { email: m.email, company_name: m.company_name },
    })));
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
      setError((err && typeof err === "object" && err.message) ? err.message : "Une erreur est survenue. Réessaie.");
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(memberId, newRole) {
    const { data, error: updateError } = await db.from("organization_members").update({ role: newRole }).eq("id", memberId).select();
    if (updateError) { console.error("Erreur de changement de rôle", updateError); alert(`Impossible de changer ce rôle : ${updateError.message || "erreur inconnue"}`); return; }
    if (!data || data.length === 0) { console.error("Aucune ligne modifiée (changement de rôle) — probablement bloqué par une règle de sécurité."); alert("Impossible de changer ce rôle : la mise à jour a été bloquée."); return; }
    await loadMembers();
  }

  async function removeMember(memberId) {
    const { data, error: deleteError } = await db.from("organization_members").delete().eq("id", memberId).select();
    if (deleteError) { console.error("Erreur de suppression du membre", deleteError); alert(`Impossible de retirer ce membre : ${deleteError.message || "erreur inconnue"}`); return; }
    if (!data || data.length === 0) { console.error("Aucune ligne supprimée (retrait de membre) — probablement bloqué par une règle de sécurité."); alert("Impossible de retirer ce membre : l'action a été bloquée."); return; }
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
            <CountrySelect value={local.country || ""} onChange={(v) => patch({ country: v })} />
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

// Redirige vers une page de paiement Stripe séparée (Stripe Checkout,
// hébergée par Stripe) — la fonction serveur crée la session, le
// navigateur est ensuite redirigé dessus. C'est Stripe qui confirme
// le paiement au serveur ensuite (voir functions/stripe-webhook), pas
// ce bouton.
function StripeCheckoutButton({ planId, billingCycle, organizationId }) {
  const [loading, setLoading] = useState(false);
  async function handleClick() {
    setLoading(true);
    try {
      const { data, error } = await db.functions.invoke("create-checkout-session", {
        body: { planId, billingCycle, organizationId, successUrl: `${window.location.origin}/?paiement=succes`, cancelUrl: `${window.location.origin}/?paiement=annule` },
      });
      if (error || !data?.url) {
        // En cas d'erreur HTTP (statut non-2xx), le client Supabase ne
        // lit pas automatiquement le corps de la réponse — il faut
        // aller le chercher soi-même pour voir la vraie raison que la
        // fonction a renvoyée, sinon on ne voit que le message
        // générique "Edge Function returned a non-2xx status code".
        // Le corps du flux ne peut être lu qu'une seule fois, donc on
        // essaie plusieurs façons de l'atteindre, dans l'ordre.
        let realMessage = data?.error;
        if (!realMessage && error?.context) {
          try { realMessage = (await new Response(error.context.body).json())?.error; } catch { /* ignore, on tente autre chose */ }
          if (!realMessage) {
            try { realMessage = (await error.context.clone().json())?.error; } catch { /* ignore */ }
          }
          if (!realMessage) {
            try { realMessage = await error.context.clone().text(); } catch { /* ignore */ }
          }
        }
        console.error("Erreur de création de session Stripe (détail complet)", { data, error, realMessage, context: error?.context });
        alert(`Impossible d'ouvrir la page de paiement : ${realMessage || error?.message || "erreur inconnue"}`);
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      console.error("Erreur d'ouverture du paiement Stripe", err);
      alert("Impossible d'ouvrir la page de paiement. Réessaie dans un instant.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <button onClick={handleClick} disabled={loading} className="flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium text-white" style={{ background: colors.ink, opacity: loading ? 0.7 : 1 }}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />} {loading ? "Ouverture…" : "Payer par carte"}
    </button>
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
  return (
    // Hauteur limitée à celle du bouton lui-même (height: 40 ci-dessus,
    // + une petite marge) : PayPal insère parfois un texte
    // promotionnel sous le bouton qu'on ne peut pas retirer par
    // configuration — le couper visuellement est le seul moyen fiable.
    <div style={{ maxHeight: "44px", overflow: "hidden" }}>
      <div ref={containerRef} />
    </div>
  );
}

function PricingView({ account, plans, onChooseFree, onChooseZeroPrice, limitNotice, documentCount, siteSettings }) {
  const [billing, setBilling] = useState(account?.billing || "mensuel");
  const [approvedMsg, setApprovedMsg] = useState(false);
  const [stripeReturnMsg, setStripeReturnMsg] = useState(null); // "succes" | "annule" | null
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paiement = params.get("paiement");
    if (paiement === "succes" || paiement === "annule") {
      setStripeReturnMsg(paiement);
      params.delete("paiement");
      const newUrl = window.location.pathname + (params.toString() ? `?${params.toString()}` : "");
      window.history.replaceState({}, "", newUrl);
    }
  }, []);
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
      {stripeReturnMsg === "succes" && (
        <div className="mx-auto mb-6 max-w-lg rounded-xl p-3 text-center text-sm" style={{ background: `${colors.moss}15`, color: colors.moss, border: `1px solid ${colors.moss}40` }}>
          Merci ! Ton paiement par carte a été confirmé par Stripe. L'activation du forfait peut prendre quelques instants — recharge la page si besoin.
        </div>
      )}
      {stripeReturnMsg === "annule" && (
        <div className="mx-auto mb-6 max-w-lg rounded-xl p-3 text-center text-sm" style={{ background: `${colors.brick}12`, color: colors.brick, border: `1px solid ${colors.brick}40` }}>
          Paiement annulé — aucun montant n'a été prélevé. Tu peux réessayer quand tu veux.
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

      <div className="flex flex-wrap justify-center gap-4">
        {visiblePlans.map((plan) => {
          const isCurrent = account?.plan === plan.id;
          const price = billing === "annuel" ? plan.annual : plan.monthly;
          const paypalPlanId = billing === "annuel" ? plan.paypalPlanIdAnnual : plan.paypalPlanIdMonthly;
          const stripePriceId = billing === "annuel" ? plan.stripePriceIdAnnual : plan.stripePriceIdMonthly;
          const showCard = plan.cardPaymentEnabled && !!stripePriceId;
          const showPaypal = !!paypalPlanId && plan.paypalPaymentEnabled;
          return (
            <div key={plan.id} className="flex w-full flex-col overflow-hidden rounded-2xl sm:w-[calc(50%-0.5rem)] lg:w-[calc(25%-0.75rem)]" style={{ background: colors.surface, border: `1px solid ${plan.id === "essentiel" ? colors.brass : colors.line}`, boxShadow: plan.id === "essentiel" ? `0 0 0 2px ${colors.brass}30` : "none" }}>
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
                <a href={`mailto:${siteSettings?.contactEmail || "contact@chantiflow.fr"}?subject=Forfait%20Entreprise`} className="rounded-lg py-2 text-center text-sm font-medium" style={{ background: colors.ink, color: "white" }}>Nous contacter</a>
              ) : price === 0 ? (
                <button onClick={() => onChooseZeroPrice(plan.id, billing)} className="rounded-lg py-2 text-sm font-medium" style={{ background: colors.ink, color: "white" }}>Activer (0€)</button>
              ) : showCard || showPaypal ? (
                <div className="flex flex-col gap-2">
                  {showCard && <StripeCheckoutButton planId={plan.id} billingCycle={billing} organizationId={account?.organizationId} />}
                  {showPaypal && <PayPalButton planId={paypalPlanId} organizationId={account?.organizationId} onApproved={() => setApprovedMsg(true)} />}
                </div>
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

function StripeIdField({ label, value, onSave }) {
  const [editing, setEditing] = useState(!value);
  const [draft, setDraft] = useState(value || "");

  useEffect(() => {
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
        <input type="text" placeholder="price_XXXXXXXX" className="df-input block w-36 rounded-md px-2 py-1 text-xs" style={{ border: `1px solid ${colors.line}` }} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button onClick={() => { onSave(draft); setEditing(false); }} title="Enregistrer" className="rounded-md px-1.5 py-1 text-xs font-medium text-white" style={{ background: colors.slate }}>
          <Check size={12} />
        </button>
      </div>
    </label>
  );
}

function ServicesVisibilitySettings({ siteSettings, saving, onSave }) {
  const current = siteSettings?.visibleServices || SERVICES.filter((s) => s.implemented).map((s) => s.id);
  function toggle(id) {
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    onSave({ visibleServices: next });
  }
  return (
    <div className="mb-6 overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: colors.line }}>
        <span className="df-display text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Services</span>
        {saving && <span className="flex items-center gap-1 text-xs" style={{ color: colors.inkSoft }}><Loader2 size={13} className="animate-spin" /> Enregistrement</span>}
      </div>
      <p className="border-b px-4 py-2 text-xs" style={{ borderColor: colors.line, color: colors.inkSoft }}>
        Choisis les services visibles pour tout le monde dans le menu "+". Utile pour cacher un service encore en cours de développement, ou en retirer un temporairement.
      </p>
      <div>
        {SERVICES.map((s, idx) => {
          const SIcon = s.icon;
          const visible = current.includes(s.id);
          return (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: idx ? `1px solid ${colors.line}` : "none" }}>
              <SIcon size={16} style={{ color: colors.brassDark }} />
              <div className="min-w-0 grow">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {s.label}
                  {!s.implemented && <span className="rounded-full px-1.5 py-0.5 text-[10px] font-normal" style={{ background: `${colors.inkSoft}18`, color: colors.inkSoft }}>en développement</span>}
                </div>
                <div className="truncate text-xs" style={{ color: colors.inkSoft }}>{s.description}</div>
              </div>
              <button onClick={() => toggle(s.id)} title={visible ? "Visible pour tout le monde" : "Masqué"}>
                {visible ? <ToggleRight size={26} style={{ color: colors.moss }} /> : <ToggleLeft size={26} style={{ color: colors.inkSoft }} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
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
          <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Email de contact</label>
          <input type="email" className="df-input w-full max-w-xs rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="contact@tondomaine.fr" value={local.contactEmail || ""} onChange={(e) => patch({ contactEmail: e.target.value })} />
          <p className="mt-1 text-xs" style={{ color: colors.inkSoft }}>Utilisé pour le bouton "Nous contacter" du forfait Entreprise et le pied de page du site.</p>
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

function AdminView({ account, documents, clients, companyProfile, plans, savingPlanSettings, onTogglePlan, onToggleWatermark, onUpdatePlanPrice, onUpdatePlanLimit, onUpdatePlanPaypalId, onUpdatePlanStripeId, onToggleCardPayment, onTogglePaypalPayment, onTogglePayment, onDeleteAccount, siteSettings, savingSiteSettings, onUpdateSiteSettings, allUsers = [], allUsersError = "", onResendConfirmation, resendingConfirmationId }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState("apercu");
  const totalTTC = documents.reduce((s, d) => s + (
    d.type === "revision" ? computeRevision(d).montantRevise
    : d.type === "situation" ? computeSituation(d).netAPayer
    : d.type === "contrat" ? (Number(d.montantTotalHT) || 0) * (1 + (Number(d.tva) || 0) / 100)
    : d.type === "relance" ? (Number(d.montantDu) || 0)
    : computeTotals(d).totalTTC
  ), 0);
  const paid = account?.paymentStatus === "payé";

  const TABS = [
    { id: "apercu", label: "Vue d'ensemble", icon: LayoutDashboard },
    { id: "identite", label: "Identité du site", icon: Building2 },
    { id: "services", label: "Services", icon: Menu },
    { id: "utilisateurs", label: "Utilisateurs", icon: Users },
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

      {tab === "services" && (
        <ServicesVisibilitySettings siteSettings={siteSettings} saving={savingSiteSettings} onSave={onUpdateSiteSettings} />
      )}

      {tab === "utilisateurs" && (
        <div className="overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: colors.line }}>
            <span className="df-display text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Tous les utilisateurs du site</span>
            <span className="text-xs" style={{ color: colors.inkSoft }}>{allUsers.length} compte(s)</span>
          </div>
          {allUsersError && (
            <div className="border-b px-4 py-3 text-sm" style={{ borderColor: colors.line, background: `${colors.brick}0D`, color: colors.brick }}>
              Impossible de charger la liste ({allUsersError}). La migration migration_admin_voir_utilisateurs.sql a-t-elle bien été lancée dans Supabase ?
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: colors.paper }}>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Email</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Nom</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Entreprise</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Inscrit le</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Confirmation</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}></th>
                </tr>
              </thead>
              <tbody>
                {allUsers.map((u, idx) => {
                  const deadline = u.created_at ? new Date(new Date(u.created_at).getTime() + 8 * 7 * 24 * 60 * 60 * 1000) : null;
                  return (
                    <tr key={u.id} style={{ borderTop: idx ? `1px solid ${colors.line}` : "none" }}>
                      <td className="px-4 py-2.5">{u.email}</td>
                      <td className="px-4 py-2.5">{[u.first_name, u.last_name].filter(Boolean).join(" ") || <span style={{ color: colors.inkSoft }}>—</span>}</td>
                      <td className="px-4 py-2.5">{u.company_name || <span style={{ color: colors.inkSoft }}>—</span>}</td>
                      <td className="df-mono px-4 py-2.5 text-xs" style={{ color: colors.inkSoft }}>{u.created_at ? fr(u.created_at) : "—"}</td>
                      <td className="px-4 py-2.5">
                        {u.confirmed_at ? (
                          <span className="flex items-center gap-1 text-xs font-medium" style={{ color: colors.moss }}><Check size={13} /> Confirmé</span>
                        ) : (
                          <div>
                            <span className="flex items-center gap-1 text-xs font-medium" style={{ color: colors.brick }}><AlertTriangle size={13} /> Non confirmé</span>
                            {deadline && <span className="text-xs" style={{ color: colors.inkSoft }}>Suppression auto le {fr(deadline)}</span>}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {u.is_admin && <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${colors.brassDark}18`, color: colors.brassDark }}>Admin</span>}
                        {!u.confirmed_at && (
                          <button
                            onClick={() => onResendConfirmation(u.id)}
                            disabled={resendingConfirmationId === u.id}
                            className="ml-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-white"
                            style={{ background: colors.slate, opacity: resendingConfirmationId === u.id ? 0.7 : 1 }}
                          >
                            {resendingConfirmationId === u.id ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />} Relancer
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {allUsers.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-sm" style={{ color: colors.inkSoft }}>Aucun utilisateur pour l'instant.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
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
        <div className="space-y-4">
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
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-xs font-medium" style={{ color: plan.paypalPaymentEnabled ? colors.moss : colors.inkSoft }}>{plan.paypalPaymentEnabled ? "Affiché" : "Masqué"}</span>
                  <button
                    onClick={() => onTogglePaypalPayment(plan.id)}
                    title={plan.paypalPaymentEnabled ? "Masquer PayPal pour ce forfait" : "Afficher PayPal pour ce forfait"}
                    style={{ color: plan.paypalPaymentEnabled ? colors.moss : colors.line }}
                  >
                    {plan.paypalPaymentEnabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: colors.line }}>
              <span className="df-display text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Paiement — carte bancaire (Stripe)</span>
              {savingPlanSettings && <Loader2 size={13} className="animate-spin" style={{ color: colors.inkSoft }} />}
            </div>
            <p className="border-b px-4 py-2 text-xs" style={{ borderColor: colors.line, color: colors.inkSoft }}>
              Colle ici l'identifiant de prix Stripe ("price_...") créé pour chaque forfait — le bouton "Payer par carte" n'apparaît que si un identifiant est renseigné ET que l'affichage est activé ci-dessous.
            </p>
            {plans.filter((p) => p.monthly !== null).map((plan) => (
              <div key={plan.id} className="flex flex-wrap items-center gap-4 border-b px-4 py-3" style={{ borderColor: colors.line }}>
                <div className="min-w-0 basis-28 shrink-0 text-sm font-medium">{plan.name}</div>
                <StripeIdField label="ID prix Stripe (mensuel)" value={plan.stripePriceIdMonthly} onSave={(v) => onUpdatePlanStripeId(plan.id, "monthly", v)} />
                <StripeIdField label="ID prix Stripe (annuel)" value={plan.stripePriceIdAnnual} onSave={(v) => onUpdatePlanStripeId(plan.id, "annual", v)} />
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-xs font-medium" style={{ color: plan.cardPaymentEnabled ? colors.moss : colors.inkSoft }}>{plan.cardPaymentEnabled ? "Affiché" : "Masqué"}</span>
                  <button
                    onClick={() => onToggleCardPayment(plan.id)}
                    title={plan.cardPaymentEnabled ? "Masquer le paiement par carte pour ce forfait" : "Afficher le paiement par carte pour ce forfait"}
                    style={{ color: plan.cardPaymentEnabled ? colors.moss : colors.line }}
                  >
                    {plan.cardPaymentEnabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
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
    const hidePricesXls = localDoc.type === "livraison" && !localDoc.showPrices;
    rows.push([]);
    if (hidePricesXls) {
      rows.push(["Désignation", "Description", "Qté", "Unité"]);
      computedLines.forEach((l) => {
        rows.push([l.designation, "", l.qty, l.unit]);
        (l.details || []).filter((d) => d.included && (d.text || d.price)).forEach((d) => {
          rows.push(["", "  ".repeat(d.level) + (d.marker || defaultMarker(d.level)) + " " + stripMarkup(d.text), "", ""]);
        });
      });
    } else {
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
    }
    if (!hidePricesXls) {
      rows.push([]);
      rows.push(["", "", "", "", "", "", "Sous-total HT", Number(subtotalHT.toFixed(2))]);
      Object.entries(tvaGroups).forEach(([rate, amount]) => rows.push(["", "", "", "", "", "", `TVA ${rate}%`, Number(amount.toFixed(2))]));
      rows.push(["", "", "", "", "", "", "Total TTC", Number(totalTTC.toFixed(2))]);
      if (Number(localDoc.acompte) > 0) {
        rows.push(["", "", "", "", "", "", `Acompte (${localDoc.acompte}%)`, Number(acompteAmount.toFixed(2))]);
        rows.push(["", "", "", "", "", "", "Reste à payer", Number(resteAPayer.toFixed(2))]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 30 }, { wch: 30 }, { wch: 6 }, { wch: 9 }, { wch: 10 }, { wch: 7 }, { wch: 9 }, { wch: 13 }];
    XLSX.utils.book_append_sheet(wb, ws, docTypeLabel(localDoc.type).slice(0, 31));
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-2 text-sm">
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
                <div className="df-display text-xs font-semibold uppercase tracking-widest" style={{ color: colors.brassDark }}>{localDoc.type === "commande" ? "Fournisseur" : "Client"}</div>
                <div className="no-print flex gap-1 rounded-md p-0.5" style={{ background: colors.paper }}>
                  <button onClick={() => patchDeep("client", { type: "entreprise" })} className="rounded px-2 py-0.5 text-xs font-medium" style={{ background: (localDoc.client.type || "entreprise") === "entreprise" ? colors.ink : "transparent", color: (localDoc.client.type || "entreprise") === "entreprise" ? "white" : colors.inkSoft }}>Entreprise</button>
                  <button onClick={() => patchDeep("client", { type: "particulier" })} className="rounded px-2 py-0.5 text-xs font-medium" style={{ background: localDoc.client.type === "particulier" ? colors.ink : "transparent", color: localDoc.client.type === "particulier" ? "white" : colors.inkSoft }}>Particulier</button>
                </div>
              </div>
              {localDoc.type !== "commande" && (
                <div className="mb-2 flex items-center justify-end">
                  <button onClick={saveCurrentClient} className="no-print text-xs font-medium" style={{ color: colors.slate }}>Enregistrer comme client</button>
                </div>
              )}
              {localDoc.type !== "commande" && clients.length > 0 && (
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
              <input className="df-input mb-2 w-full rounded-md px-2 py-1.5 text-sm font-medium" style={inputStyle} placeholder={localDoc.type === "commande" ? "Nom du fournisseur" : localDoc.client.type === "particulier" ? "Nom et prénom" : "Raison sociale"} value={localDoc.client.name} onChange={(e) => patchDeep("client", { name: e.target.value })} />
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
                    <div className="mt-1">
                      <CountrySelect value={pf.originCountry} onChange={(v) => patchProforma({ originCountry: v })} />
                    </div>
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

          {localDoc.type === "acompte" && (
            <div className="no-print mb-8 rounded-xl p-4" style={{ border: `1px solid ${colors.line}` }}>
              <div className="df-display mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest" style={{ color: colors.brassDark }}>
                <Wallet size={13} /> Informations sur l'acompte
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs" style={{ color: colors.inkSoft }}>
                  Devis / marché d'origine (référence)
                  <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="ex : DEV-014" value={localDoc.sourceDevisRef || ""} onChange={(e) => patch({ sourceDevisRef: e.target.value })} />
                </label>
                <label className="text-xs" style={{ color: colors.inkSoft }}>
                  Montant total du marché HT
                  <input type="number" className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} value={localDoc.montantMarcheHT || ""} onChange={(e) => patch({ montantMarcheHT: e.target.value })} />
                </label>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button onClick={() => patch({ acompteMode: "pourcentage" })} className="rounded-md px-3 py-1.5 text-xs font-medium" style={{ background: (localDoc.acompteMode || "pourcentage") === "pourcentage" ? colors.ink : colors.paper, color: (localDoc.acompteMode || "pourcentage") === "pourcentage" ? "white" : colors.inkSoft }}>% du marché</button>
                <button onClick={() => patch({ acompteMode: "montant_fixe" })} className="rounded-md px-3 py-1.5 text-xs font-medium" style={{ background: localDoc.acompteMode === "montant_fixe" ? colors.ink : colors.paper, color: localDoc.acompteMode === "montant_fixe" ? "white" : colors.inkSoft }}>Montant fixe</button>
              </div>
              {(localDoc.acompteMode || "pourcentage") === "pourcentage" ? (
                <label className="mt-3 block w-40 text-xs" style={{ color: colors.inkSoft }}>
                  Pourcentage d'acompte
                  <input type="number" className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} value={localDoc.acomptePourcentage ?? 30} onChange={(e) => patch({ acomptePourcentage: e.target.value })} />
                </label>
              ) : (
                <label className="mt-3 block w-40 text-xs" style={{ color: colors.inkSoft }}>
                  Montant fixe HT
                  <input type="number" className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} value={localDoc.acompteMontantFixe || ""} onChange={(e) => patch({ acompteMontantFixe: e.target.value })} />
                </label>
              )}
              {(() => {
                const montantMarche = Number(localDoc.montantMarcheHT) || 0;
                const montantAcompte = (localDoc.acompteMode || "pourcentage") === "pourcentage" ? (montantMarche * (Number(localDoc.acomptePourcentage) || 0)) / 100 : (Number(localDoc.acompteMontantFixe) || 0);
                const reste = montantMarche - montantAcompte;
                return montantMarche > 0 && (
                  <div className="mt-3 rounded-lg p-3 text-xs" style={{ background: colors.paper }}>
                    <div className="flex justify-between"><span>Montant de cet acompte HT</span><span className="df-mono font-semibold">{formatMoney(montantAcompte, localDoc.currency)}</span></div>
                    <div className="mt-1 flex justify-between" style={{ color: colors.inkSoft }}><span>Reste à facturer après cet acompte</span><span className="df-mono">{formatMoney(reste, localDoc.currency)}</span></div>
                  </div>
                );
              })()}
              <p className="mt-3 text-xs" style={{ color: colors.inkSoft }}>Astuce : ajoute une ligne "Acompte sur devis N°..." dans les prestations ci-dessous, avec le montant calculé ci-dessus, pour qu'il apparaisse clairement sur le PDF.</p>
            </div>
          )}

          {localDoc.type === "avoir" && (
            <div className="no-print mb-8 rounded-xl p-4" style={{ border: `1px solid ${colors.brick}40`, background: `${colors.brick}08` }}>
              <div className="df-display mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest" style={{ color: colors.brick }}>
                <RotateCcw size={13} /> Référence obligatoire
              </div>
              <p className="mb-3 text-xs" style={{ color: colors.inkSoft }}>Un avoir doit obligatoirement référencer la facture qu'il corrige, et préciser le motif — sans ça, il n'est pas valide.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs" style={{ color: colors.inkSoft }}>
                  Facture d'origine (numéro)
                  <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="ex : FAC-014" value={localDoc.factureOrigineRef || ""} onChange={(e) => patch({ factureOrigineRef: e.target.value })} />
                </label>
                <label className="text-xs" style={{ color: colors.inkSoft }}>
                  Motif de l'avoir
                  <select className="df-select mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} value={localDoc.motifAvoir || ""} onChange={(e) => patch({ motifAvoir: e.target.value })}>
                    <option value="">— Choisir —</option>
                    <option value="Erreur de facturation">Erreur de facturation</option>
                    <option value="Retour de marchandise">Retour de marchandise</option>
                    <option value="Geste commercial">Geste commercial</option>
                    <option value="Résiliation / annulation">Résiliation / annulation</option>
                    <option value="Remise accordée a posteriori">Remise accordée a posteriori</option>
                    <option value="Autre">Autre</option>
                  </select>
                </label>
              </div>
              <p className="mt-3 text-xs" style={{ color: colors.inkSoft }}>Astuce : entre les montants à déduire normalement (en positif) dans les prestations ci-dessous — ils s'afficheront comme un avoir sur le PDF.</p>
            </div>
          )}

          {localDoc.type === "commande" && (
            <div className="no-print mb-8 rounded-xl p-4" style={{ border: `1px solid ${colors.line}` }}>
              <div className="df-display mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>
                <ShoppingCart size={13} /> Conditions de la commande
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs" style={{ color: colors.inkSoft }}>
                  Date de livraison souhaitée
                  <input type="date" className="df-input df-mono mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} value={localDoc.dateLivraisonSouhaitee || ""} onChange={(e) => patch({ dateLivraisonSouhaitee: e.target.value })} />
                </label>
                <label className="text-xs" style={{ color: colors.inkSoft }}>
                  Conditions de paiement convenues
                  <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="ex : 30 jours fin de mois" value={localDoc.conditionsPaiement || ""} onChange={(e) => patch({ conditionsPaiement: e.target.value })} />
                </label>
              </div>
              <label className="mt-3 block text-xs" style={{ color: colors.inkSoft }}>
                Adresse de livraison (si différente de la vôtre)
                <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="ex : Chantier — 12 rue de la Paix, 75001 Paris" value={localDoc.adresseLivraison || ""} onChange={(e) => patch({ adresseLivraison: e.target.value })} />
              </label>
            </div>
          )}

          {localDoc.type === "livraison" && (
            <div className="no-print mb-8 rounded-xl p-4" style={{ border: `1px solid ${colors.line}` }}>
              <div className="df-display mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest" style={{ color: colors.moss }}>
                <Truck size={13} /> Détails de la livraison
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs" style={{ color: colors.inkSoft }}>
                  Commande / devis d'origine (référence)
                  <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="ex : CMD-014" value={localDoc.commandeRef || ""} onChange={(e) => patch({ commandeRef: e.target.value })} />
                </label>
                <label className="text-xs" style={{ color: colors.inkSoft }}>
                  État de la livraison
                  <select className="df-select mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} value={localDoc.etatLivraison || "conforme"} onChange={(e) => patch({ etatLivraison: e.target.value })}>
                    <option value="conforme">Conforme</option>
                    <option value="reserves">Livré avec réserves</option>
                    <option value="incomplete">Livraison incomplète</option>
                  </select>
                </label>
              </div>
              {localDoc.etatLivraison && localDoc.etatLivraison !== "conforme" && (
                <label className="mt-3 block text-xs" style={{ color: colors.inkSoft }}>
                  Détail des réserves
                  <textarea className="df-textarea mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={{ ...inputStyle, minHeight: "3rem" }} value={localDoc.reservesLivraison || ""} onChange={(e) => patch({ reservesLivraison: e.target.value })} />
                </label>
              )}
              <label className="mt-3 flex items-center gap-2 text-xs" style={{ color: colors.inkSoft }}>
                <input type="checkbox" checked={!!localDoc.showPrices} onChange={(e) => patch({ showPrices: e.target.checked })} />
                Afficher les prix sur ce bon de livraison (généralement masqués)
              </label>
            </div>
          )}

          {localDoc.type === "bpu" && (
            <div className="no-print mb-8 rounded-xl p-4" style={{ border: `1px solid ${colors.line}` }}>
              <div className="df-display mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>
                <List size={13} /> Conditions du bordereau
              </div>
              <p className="mb-3 text-xs" style={{ color: colors.inkSoft }}>Un bordereau de prix unitaires fixe des prix de référence — les quantités saisies ci-dessous sont <strong>estimatives</strong>, pas engageantes. Les commandes réelles se feront ensuite via des bons de commande à ces prix.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs" style={{ color: colors.inkSoft }}>
                  Durée de validité des prix
                  <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="ex : 12 mois à compter de la notification" value={localDoc.dureeValidite || ""} onChange={(e) => patch({ dureeValidite: e.target.value })} />
                </label>
                <label className="text-xs" style={{ color: colors.inkSoft }}>
                  Révision des prix (référence, si applicable)
                  <input className="df-input mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="ex : voir REV-003" value={localDoc.referenceRevision || ""} onChange={(e) => patch({ referenceRevision: e.target.value })} />
                </label>
              </div>
            </div>
          )}

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
                    <div className="absolute right-0 z-10 mt-1 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md shadow-sm" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
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
