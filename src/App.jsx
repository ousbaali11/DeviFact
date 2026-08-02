import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "./supabase-client.js";
import * as XLSX from "xlsx";
import {
  Plus, Trash2, Printer, FileSpreadsheet, PenTool, Type as TypeIcon, Upload,
  ArrowRightLeft, Eraser, ChevronUp, ChevronDown, LayoutList, ArrowLeft,
  Search, FileText, Receipt, Copy, Loader2, Inbox, Check, Users, Building2,
  Pencil, X, UserPlus, LayoutDashboard, LogOut, Lock, CreditCard, Mail,
  KeyRound, Sparkles, ArrowRight, Eye, EyeOff, GitMerge, Scissors,
  Library, BookmarkPlus, RotateCcw, AlertTriangle, IndentIncrease, IndentDecrease,
  Shield, ToggleLeft, ToggleRight,
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

const PLANS = [
  { id: "gratuit", name: "Gratuit", monthly: 0, annual: 0, limit: 3, tagline: "Pour découvrir", features: ["3 devis ou factures", "Export PDF (avec filigrane)", "1 utilisateur"] },
  { id: "essentiel", name: "Essentiel", monthly: 19, annual: 182, limit: Infinity, tagline: "Pour l'artisan solo", features: ["Devis et factures illimités", "Export PDF/Excel sans filigrane", "Signature électronique", "1 utilisateur"] },
  { id: "pro", name: "Pro", monthly: 39, annual: 374, limit: Infinity, tagline: "Pour l'entreprise", features: ["Tout Essentiel", "Multi-utilisateurs", "Bibliothèque de prestations", "Suggestions IA", "Relances automatiques"] },
  { id: "entreprise", name: "Entreprise", monthly: null, annual: null, limit: Infinity, tagline: "Sur mesure", features: ["Tout Pro", "API", "Support prioritaire"] },
];
function planLabel(id) { return PLANS.find((p) => p.id === id)?.name || "Gratuit"; }

const TIER_ORDER = ["gratuit", "essentiel", "pro", "entreprise"];
function tierAtLeast(plan, minTier) {
  return TIER_ORDER.indexOf(plan || "gratuit") >= TIER_ORDER.indexOf(minTier);
}


function statusColor(status) {
  if (status === "signé" || status === "payée") return colors.moss;
  if (status === "refusé" || status === "en retard") return colors.brick;
  if (status === "envoyé" || status === "envoyée") return colors.slate;
  if (status === "vu") return colors.brassDark;
  return colors.inkSoft;
}

let uidCounter = 0;
const nextId = (p = "id") => `${p}_${++uidCounter}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
const eur = (n) => (isFinite(n) ? n : 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const fr = (d) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
const frLong = (d) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

function emptyLine() {
  return { id: nextId("l"), type: "line", designation: "", details: [], qty: 1, unit: "forfait", unitPrice: 0, tva: 20, discount: 0 };
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
function emptySection() {
  return { id: nextId("s"), type: "section", title: "", subtitle: "" };
}
function emptyClient() {
  return { id: nextId("cli"), type: "entreprise", name: "", address: "", email: "", phone: "" };
}
function emptyCompanyProfile() {
  return { type: "entreprise", name: "", siret: "", address: "", email: "", phone: "", tva: "", logo: null };
}
function emptyPrestation() {
  return { id: nextId("pr"), designation: "", category: "", unit: "forfait", unitPrice: 0, tva: 20 };
}

function nextNumber(documents, type) {
  const prefix = type === "devis" ? "DEV" : "FAC";
  const year = new Date().getFullYear();
  const nums = documents.filter((d) => d.type === type).map((d) => parseInt((d.docNumber.match(/(\d+)$/) || [])[1] || "0", 10));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}-${year}-${String(next).padStart(3, "0")}`;
}

function newDocument(type, documents) {
  return {
    id: nextId("doc"),
    type,
    docNumber: nextNumber(documents, type),
    issueDate: new Date().toISOString().slice(0, 10),
    validityDays: 30,
    dueDays: 30,
    company: { type: "entreprise", name: "", siret: "", address: "", email: "", phone: "", tva: "", logo: null },
    client: { type: "entreprise", name: "", address: "", email: "", phone: "" },
    clientId: null,
    items: [emptyLine()],
    globalDiscount: 0,
    acompte: 0,
    notes: "Merci de votre confiance.",
    signature: { mode: "texte", name: "", image: null, drawing: null },
    status: "brouillon",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function computeTotals(doc) {
  const lineItems = (doc.items || []).filter((i) => i.type === "line");
  const computedLines = lineItems.map((l) => {
    const base = lineBaseHT(l);
    const afterLine = base * (1 - (Number(l.discount) || 0) / 100);
    const afterGlobal = afterLine * (1 - (Number(doc.globalDiscount) || 0) / 100);
    return { ...l, totalHT: afterGlobal };
  });
  const subtotalHT = computedLines.reduce((s, l) => s + l.totalHT, 0);
  const tvaGroups = {};
  computedLines.forEach((l) => {
    const rate = Number(l.tva) || 0;
    tvaGroups[rate] = (tvaGroups[rate] || 0) + (l.totalHT * rate) / 100;
  });
  const totalTVA = Object.values(tvaGroups).reduce((a, b) => a + b, 0);
  const totalTTC = subtotalHT + totalTVA;
  const acompteAmount = totalTTC * ((Number(doc.acompte) || 0) / 100);
  const resteAPayer = totalTTC - acompteAmount;
  return { computedLines, subtotalHT, tvaGroups, totalTVA, totalTTC, acompteAmount, resteAPayer };
}

const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
    .df-root { font-family: 'Inter', sans-serif; }
    .df-display { font-family: 'Space Grotesk', sans-serif; }
    .df-mono { font-family: 'IBM Plex Mono', monospace; }
    .df-input:focus, .df-select:focus, .df-textarea:focus { outline: none; border-color: ${colors.brass} !important; box-shadow: 0 0 0 3px rgba(184,118,62,0.15); }
    .print-doc { display: none; }
    @media print {
      @page { size: A4; margin: 14mm 12mm; }
      html, body { background: white !important; }
      .no-print, .editor-form { display: none !important; }
      .print-doc { display: block !important; min-height: 258mm; box-sizing: border-box; }
      .print-doc * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `}</style>
);

function PrintDocument({ doc, totals, accountPlan }) {
  const { subtotalHT, tvaGroups, totalTVA, totalTTC, acompteAmount, resteAPayer } = totals;
  const validityDate = new Date(new Date(doc.issueDate).getTime() + (Number(doc.validityDays) || 0) * 86400000);
  const dueDate = new Date(new Date(doc.issueDate).getTime() + (Number(doc.dueDays) || 0) * 86400000);
  const lineItems = (doc.items || []).filter((i) => i.type === "line" || i.type === "section");
  const ink = "#1B2A33", inkSoft = "#4A5B63", brass = "#B8763E", brassDark = "#8F5C2E", line = "#DAE1DC", box = "#F1F0EA";
  const mono = { fontFamily: "'IBM Plex Mono', monospace" };
  const isFreeWatermark = (accountPlan || "gratuit") === "gratuit";
  const pStyle = {
    fontFamily: "'Inter', sans-serif", color: ink, fontSize: "10.5pt", lineHeight: 1.4,
    background: "#FBF7EF", border: `1.5px solid ${ink}`, outline: `1px solid ${brass}`, outlineOffset: "5px",
    padding: "24px 28px", margin: "5px", position: "relative", overflow: "hidden",
  };

  return (
    <div className="print-doc" style={pStyle}>
      {isFreeWatermark && (
        <div style={{
          position: "absolute", top: "45%", left: "50%", transform: "translate(-50%, -50%) rotate(-32deg)",
          fontFamily: "'Space Grotesk', sans-serif", fontSize: "48pt", fontWeight: 700, color: "rgba(27,42,51,0.08)",
          whiteSpace: "nowrap", pointerEvents: "none", zIndex: 0, letterSpacing: "0.05em",
        }}>
          FORFAIT GRATUIT
        </div>
      )}
      {/* Logo + titre */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "18px", position: "relative", zIndex: 1 }}>
        <div style={{ width: "62px", height: "62px", borderRadius: "50%", background: brass, color: "white", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", fontFamily: "'Space Grotesk', sans-serif", fontSize: "17pt", fontWeight: 700 }}>
          {doc.company.logo ? <img src={doc.company.logo} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (initials(doc.company.name) || "DF")}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "24pt", fontWeight: 700, letterSpacing: "0.02em" }}>
            {doc.type === "devis" ? "DEVIS" : "FACTURE"}
          </div>
          <div style={{ fontSize: "9.5pt", marginTop: "4px" }}>Numéro : <strong style={mono}>{doc.docNumber}</strong></div>
          <div style={{ fontSize: "9.5pt", color: inkSoft }}>Date d'émission : {frLong(doc.issueDate)}</div>
          <div style={{ fontSize: "9.5pt", color: inkSoft }}>{doc.type === "devis" ? `Valable jusqu'au ${frLong(validityDate)}` : `Échéance : ${frLong(dueDate)}`}</div>
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
          <div style={{ fontWeight: 700, marginBottom: "3px", color: brassDark }}>{doc.client.type === "particulier" ? "Client (particulier) :" : "Client (entreprise) :"}</div>
          <div style={{ fontWeight: 600 }}>{doc.client.name || "—"}</div>
          {doc.client.address && <div>{doc.client.address}</div>}
          {doc.client.email && <div>{doc.client.email}</div>}
          {doc.client.phone && <div>{doc.client.phone}</div>}
        </div>
      </div>

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
            const lineHT = lineBaseHT(it) * (1 - (Number(it.discount) || 0) / 100) * (1 - (Number(doc.globalDiscount) || 0) / 100);
            const lineTVA = lineHT * (Number(it.tva) || 0) / 100;
            return (
              <tr key={it.id} style={{ pageBreakInside: "avoid", borderBottom: `1px solid ${line}`, background: idx % 2 ? "transparent" : "rgba(27,42,51,0.02)" }}>
                <td style={{ padding: "6px 6px", verticalAlign: "top" }}>
                  <div>{it.designation || "—"}</div>
                  {(it.details || []).filter((d) => d.included && (d.text || d.price)).map((d) => (
                    <div key={d.id} style={{ fontSize: "8.5pt", color: inkSoft, marginLeft: `${8 + (d.level - 1) * 14}px`, display: "flex", justifyContent: "space-between", gap: "8px" }}>
                      <span>{d.marker || defaultMarker(d.level)} {d.text}</span>
                      {Number(d.price) > 0 && <span style={mono}>{eur(Number(d.price))}</span>}
                    </div>
                  ))}
                </td>
                <td style={{ padding: "6px 6px", textAlign: "right", verticalAlign: "top", ...mono }}>{it.qty}</td>
                <td style={{ padding: "6px 6px", verticalAlign: "top" }}>{it.unit}</td>
                <td style={{ padding: "6px 6px", textAlign: "right", verticalAlign: "top", ...mono }}>{eur(Number(it.unitPrice) || 0)}</td>
                <td style={{ padding: "6px 6px", textAlign: "right", verticalAlign: "top", ...mono }}>{it.tva}%</td>
                <td style={{ padding: "6px 6px", textAlign: "right", verticalAlign: "top", ...mono }}>{eur(lineTVA)}</td>
                <td style={{ padding: "6px 6px", textAlign: "right", verticalAlign: "top", ...mono, fontWeight: 600 }}>{eur(lineHT)}</td>
              </tr>
            );
          })())}
        </tbody>
      </table>

      {/* Conditions + Totaux */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: "24px", marginTop: "18px", pageBreakInside: "avoid", position: "relative", zIndex: 1 }}>
        <div style={{ flex: 1, fontSize: "9pt" }}>
          {doc.notes && (
            <>
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Conditions de règlement</div>
              <div style={{ color: inkSoft, whiteSpace: "pre-wrap" }}>{doc.notes}</div>
            </>
          )}
          {Number(doc.acompte) > 0 && (
            <div style={{ marginTop: "6px" }}>Acompte de {doc.acompte}% à la commande : <strong style={mono}>{eur(acompteAmount)}</strong></div>
          )}
        </div>

        <div style={{ width: "230px", fontSize: "10pt" }}>
          <div style={{ display: "flex", justifyContent: "space-between", background: ink, color: "white", padding: "7px 10px", fontWeight: 700 }}>
            <span>Total HT</span><span style={mono}>{eur(subtotalHT)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", border: `1px solid ${line}`, padding: "7px 10px", fontWeight: 600 }}>
            <span>Total TVA</span><span style={mono}>{eur(totalTVA)}</span>
          </div>
          {Object.keys(tvaGroups).length > 1 && Object.entries(tvaGroups).map(([rate, amount]) => (
            <div key={rate} style={{ display: "flex", justifyContent: "space-between", padding: "2px 10px", fontSize: "8.5pt", color: inkSoft }}>
              <span>dont TVA {rate}%</span><span style={mono}>{eur(amount)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", background: ink, color: "white", padding: "9px 10px", fontWeight: 700, fontSize: "12.5pt", marginTop: "2px" }}>
            <span>Net à payer</span><span style={mono}>{eur(totalTTC)}</span>
          </div>
          {Number(doc.acompte) > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", fontWeight: 700, color: brassDark }}>
              <span>Reste à payer</span><span style={mono}>{eur(resteAPayer)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Signature — bas à droite */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "20px", pageBreakInside: "avoid", position: "relative", zIndex: 1 }}>
        <div style={{ width: "230px", border: `1px solid ${line}`, borderRadius: "4px", padding: "10px 14px", minHeight: "70px" }}>
          <div style={{ fontSize: "8.5pt", color: inkSoft, marginBottom: "6px" }}>
            Signature du client {doc.type === "devis" && "(précédée de la mention « Bon pour accord »)"}
          </div>
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
    </div>
  );
}

export default function DeviFactApp() {
  const [view, setView] = useState("dashboard");
  const [documents, setDocuments] = useState([]);
  const [clients, setClients] = useState([]);
  const [prestations, setPrestations] = useState([]);
  const [companyProfile, setCompanyProfile] = useState(emptyCompanyProfile());
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
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

  const [plans, setPlans] = useState(PLANS);

  async function loadProfile(userId, email) {
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (!profile) return null;
    return {
      id: userId,
      email,
      companyName: profile.company_name || "",
      plan: profile.plan,
      billing: profile.billing_cycle,
      paymentStatus: profile.payment_status,
      isAdmin: profile.is_admin,
      loggedIn: true,
    };
  }
  async function loadPlans() {
    const { data, error } = await supabase.from("plans").select("*");
    if (error || !data) { setPlans(PLANS); return; }
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
      };
    });
    setPlans(merged);
  }
  async function updatePlanPaypalId(planId, field, value) {
    setSavingPlanSettings(true);
    const column = field === "monthly" ? "paypal_plan_id_monthly" : "paypal_plan_id_annual";
    const { error } = await supabase.from("plans").update({ [column]: value || null }).eq("id", planId);
    if (error) console.error("Erreur de mise à jour de l'identifiant PayPal (droits admin requis)", error);
    await loadPlans();
    setSavingPlanSettings(false);
  }

  useEffect(() => {
    (async () => {
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

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const profile = await loadProfile(session.user.id, session.user.email);
        setAccount(profile);
      }
      await loadPlans();
      setLoading(false);
    })();

    // Se met à jour automatiquement si la session change (connexion/déconnexion
    // dans un autre onglet, expiration du token, etc.)
    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const profile = await loadProfile(session.user.id, session.user.email);
        setAccount(profile);
      } else {
        setAccount(null);
      }
    });
    return () => authListener?.subscription?.unsubscribe();
  }, []);

  async function updatePlanPrice(planId, field, value) {
    setSavingPlanSettings(true);
    const column = field === "monthly" ? "monthly_price" : "annual_price";
    const { error } = await supabase.from("plans").update({ [column]: value === "" ? null : Number(value) }).eq("id", planId);
    if (error) console.error("Erreur de mise à jour du prix (droits admin requis)", error);
    await loadPlans();
    setSavingPlanSettings(false);
  }
  async function togglePlanVisibility(planId) {
    setSavingPlanSettings(true);
    const current = plans.find((p) => p.id === planId);
    const { error } = await supabase.from("plans").update({ is_visible: !!current?.hidden }).eq("id", planId);
    if (error) console.error("Erreur de mise à jour de la visibilité (droits admin requis)", error);
    await loadPlans();
    setSavingPlanSettings(false);
  }

  async function persistAccount(next) {
    setAccount(next);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    try {
      // Le forfait payant n'est jamais confirmé ici : seul le webhook PayPal,
      // qui tourne côté serveur, a le droit de faire passer un compte sur un
      // forfait payant. Voir supabase-functions/paypal-webhook.
      await supabase.from("profiles").update({
        company_name: next.companyName,
        billing_cycle: next.billing,
      }).eq("id", user.id);
    } catch (e) {
      console.error("Erreur d'enregistrement compte", e);
    }
  }
  async function logout() {
    await supabase.auth.signOut();
    setAccount(null);
  }
  async function chooseFreePlan() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ plan: "gratuit", payment_status: "gratuit" }).eq("id", user.id);
    if (error) { console.error("Erreur de passage au forfait gratuit", error); return; }
    setAccount((prev) => ({ ...prev, plan: "gratuit", paymentStatus: "gratuit" }));
  }
  async function togglePaymentStatus() {
    if (!account) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const nextStatus = account.paymentStatus === "payé" ? "impayé" : "payé";
    const { error } = await supabase.from("profiles").update({ payment_status: nextStatus }).eq("id", user.id);
    if (error) { console.error("Erreur de mise à jour du statut de paiement", error); return; }
    setAccount({ ...account, paymentStatus: nextStatus });
  }
  async function deleteCurrentAccount() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    // Supprime les données applicatives. La suppression du compte
    // d'authentification lui-même doit se faire depuis le dashboard
    // Supabase (Authentication → Users), ou via une fonction serveur
    // dédiée avec la clé "service role" — jamais depuis le navigateur.
    await Promise.allSettled([
      window.storage.set("documents", JSON.stringify([]), false),
      window.storage.set("clients", JSON.stringify([]), false),
      window.storage.set("prestations", JSON.stringify([]), false),
      window.storage.set("company-profile", JSON.stringify(emptyCompanyProfile()), false),
      supabase.from("profiles").update({ plan: "gratuit", is_admin: false, payment_status: "gratuit" }).eq("id", user.id),
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
    const exists = clients.some((c) => c.id === clientData.id);
    const next = exists ? clients.map((c) => (c.id === clientData.id ? clientData : c)) : [clientData, ...clients];
    persistClients(next);
  }
  function deleteClient(id) {
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
    const plan = PLANS.find((p) => p.id === (account?.plan || "gratuit"));
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
    persist(documents.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d)));
  }
  function deleteDoc(id) {
    persist(documents.filter((d) => d.id !== id));
    if (activeId === id) backToDashboard();
  }
  function duplicateDoc(id) {
    const original = documents.find((d) => d.id === id);
    if (!original) return;
    const copy = { ...original, id: nextId("doc"), docNumber: nextNumber(documents, original.type), status: "brouillon", createdAt: Date.now(), updatedAt: Date.now() };
    persist([copy, ...documents]);
  }
  function convertToInvoice(id) {
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
      : `Bonjour ${doc.client.name || ""},\n\nSauf erreur de notre part, la facture ${doc.docNumber} d'un montant de ${eur(totalTTC)} reste impayée à ce jour.\n\nMerci de bien vouloir procéder au règlement dans les meilleurs délais.\n\nCordialement.`;
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

  if (!account || !account.loggedIn) {
    return <AuthScreen />;
  }

  if (view === "editor" && activeDoc) {
    return (
      <Editor
        doc={activeDoc}
        saving={saving}
        clients={clients}
        prestations={prestations}
        accountPlan={account?.plan || "gratuit"}
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

  const navProps = { view, setView, onNewDevis: () => openNew("devis"), onNewFacture: () => openNew("facture"), account, onLogout: logout };

  if (view === "clients") {
    return (
      <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <ClientsView clients={clients} documents={documents} saving={savingClients} onSave={upsertClient} onDelete={deleteClient} />
      </div>
    );
  }

  if (view === "company") {
    return (
      <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <CompanyView profile={companyProfile} saving={savingCompany} onSave={persistCompanyProfile} onReset={resetTestData} documentCount={documents.length} clientCount={clients.length} account={account} />
      </div>
    );
  }

  if (view === "prestations") {
    return (
      <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <PrestationsView prestations={prestations} saving={savingPrestations} onSave={upsertPrestation} onDelete={deletePrestation} />
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
          onUpdatePlanPrice={updatePlanPrice}
          onUpdatePlanPaypalId={updatePlanPaypalId}
          onTogglePayment={togglePaymentStatus}
          onDeleteAccount={deleteCurrentAccount}
        />
      </div>
    );
  }

  return (
    <div className="df-root min-h-full w-full" style={{ background: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <TopNav {...navProps} />

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {(account?.plan || "gratuit") === "gratuit" && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3" style={{ background: documents.length >= 3 ? `${colors.brick}12` : colors.surface, border: `1px solid ${documents.length >= 3 ? colors.brick + "40" : colors.line}` }}>
            <span className="text-sm" style={{ color: documents.length >= 3 ? colors.brick : colors.inkSoft }}>
              Forfait Gratuit — <strong className="df-mono">{documents.length}/3</strong> devis/factures utilisés
            </span>
            <button onClick={() => setView("pricing")} className="text-xs font-medium underline" style={{ color: colors.brassDark }}>Passer à un forfait payant</button>
          </div>
        )}
        {/* Stats */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Devis en attente de réponse" value={stats.enAttenteCount} sub={eur(stats.montantEnAttente)} color={colors.slate} />
          <StatCard label="Factures impayées" value={stats.impayeesCount} sub={eur(stats.montantImpaye)} color={colors.brick} />
          <StatCard label="Taux de signature des devis" value={stats.tauxSignature === null ? "—" : `${stats.tauxSignature}%`} sub="devis envoyés → signés" color={colors.moss} />
        </div>

        {reminders.length > 0 && (
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
            {[["tous", "Tous"], ["devis", "Devis"], ["facture", "Factures"]].map(([id, label]) => (
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
            const canMerge = selectedDocs.length >= 2 && sameType;
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
              const statuses = d.type === "devis" ? DEVIS_STATUSES : FACTURE_STATUSES;
              return (
                <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderTop: idx ? `1px solid ${colors.line}` : "none", background: selectedIds.includes(d.id) ? "rgba(184,118,62,0.06)" : "transparent" }}>
                  <input type="checkbox" checked={selectedIds.includes(d.id)} onChange={() => toggleSelect(d.id)} style={{ accentColor: colors.brass }} />
                  <div className="flex items-center gap-2" style={{ color: d.type === "devis" ? colors.slate : colors.brassDark }}>
                    {d.type === "devis" ? <FileText size={16} /> : <Receipt size={16} />}
                  </div>
                  <button onClick={() => openDoc(d.id)} className="df-mono w-32 shrink-0 text-left text-sm font-medium hover:underline">{d.docNumber}</button>
                  <div className="min-w-0 grow basis-40 truncate text-sm">{d.client.name || <span style={{ color: colors.inkSoft }}>Client non renseigné</span>}</div>
                  <div className="df-mono w-28 shrink-0 text-right text-sm font-medium">{eur(totalTTC)}</div>
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
                    <button onClick={() => duplicateDoc(d.id)} title="Dupliquer" style={{ color: colors.inkSoft }}><Copy size={15} /></button>
                    <button onClick={() => deleteDoc(d.id)} title="Supprimer" style={{ color: colors.brick }}><Trash2 size={15} /></button>
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

function AuthScreen() {
  const [mode, setMode] = useState("signup");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

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
        const { data, error: signUpError } = await supabase.auth.signUp({ email: cleanEmail, password });
        if (signUpError) { setError(signUpError.message); setBusy(false); return; }
        if (companyName.trim() && data.user) {
          await supabase.from("profiles").update({ company_name: companyName.trim() }).eq("id", data.user.id);
        }
        if (!data.session) {
          // La confirmation par email est activée sur ce projet Supabase :
          // pas de session immédiate, il faut d'abord cliquer le lien reçu par mail.
          setInfo("Compte créé ! Vérifie ta boîte mail pour confirmer ton adresse, puis reviens te connecter ici.");
          setMode("login");
          setBusy(false);
          return;
        }
        // Sinon : session créée immédiatement, l'écouteur onAuthStateChange
        // dans le composant principal prend le relais automatiquement.
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (signInError) { setError("Email ou mot de passe incorrect."); setBusy(false); return; }
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
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg df-mono text-base font-semibold" style={{ background: colors.brass, color: colors.ink }}>DF</div>
          <span className="df-display text-xl font-semibold tracking-wide">DeviFact</span>
        </div>

        <div className="rounded-2xl p-6" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          <div className="mb-5 flex gap-1 rounded-lg p-1" style={{ background: colors.paper }}>
            <button type="button" onClick={() => { setMode("signup"); setError(""); setInfo(""); }} className="grow rounded-md py-1.5 text-sm font-medium" style={{ background: mode === "signup" ? colors.ink : "transparent", color: mode === "signup" ? "white" : colors.inkSoft }}>Inscription</button>
            <button type="button" onClick={() => { setMode("login"); setError(""); setInfo(""); }} className="grow rounded-md py-1.5 text-sm font-medium" style={{ background: mode === "login" ? colors.ink : "transparent", color: mode === "login" ? "white" : colors.inkSoft }}>Connexion</button>
          </div>

          <div className="space-y-3">
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
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium" style={{ color: colors.inkSoft }}><KeyRound size={13} /> Mot de passe</label>
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
        </div>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs" style={{ color: colors.inkSoft }}>
          <Lock size={12} /> Authentification sécurisée par Supabase (mots de passe hachés, jamais stockés en clair).
        </p>
      </div>
    </div>
  );
}

function TopNav({ view, setView, onNewDevis, onNewFacture, account, onLogout }) {
  const tabs = [
    { id: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    { id: "clients", label: "Clients", icon: Users },
    { id: "prestations", label: "Bibliothèque", icon: Library },
    { id: "company", label: "Mon entreprise", icon: Building2 },
    { id: "pricing", label: "Abonnement", icon: CreditCard },
    ...(account?.isAdmin ? [{ id: "admin", label: "Admin", icon: Shield }] : []),
  ];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink }}>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg df-mono text-sm font-semibold" style={{ background: colors.brass, color: colors.ink }}>DF</div>
          <span className="df-display text-lg font-semibold tracking-wide text-white">DeviFact</span>
        </div>
        <div className="hidden items-center gap-1 lg:flex">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setView(id)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium" style={{ background: view === id ? "rgba(255,255,255,0.12)" : "transparent", color: view === id ? "white" : "rgba(255,255,255,0.65)" }}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onNewDevis} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink }}>
          <Plus size={15} /> Devis
        </button>
        <button onClick={onNewFacture} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.slate }}>
          <Plus size={15} /> Facture
        </button>
        <button onClick={() => setView("pricing")} className="hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:flex" style={{ background: "rgba(255,255,255,0.1)", color: "white" }} title="Voir les forfaits">
          {planLabel(account?.plan)}
        </button>
        <button onClick={onLogout} className="flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium" style={{ color: "rgba(255,255,255,0.65)" }} title="Se déconnecter">
          <LogOut size={15} />
        </button>
      </div>
      <div className="flex w-full items-center gap-1 lg:hidden">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setView(id)} className="flex grow items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium" style={{ background: view === id ? "rgba(255,255,255,0.12)" : "transparent", color: view === id ? "white" : "rgba(255,255,255,0.65)" }}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ClientsView({ clients, documents, saving, onSave, onDelete }) {
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
  function startNew() { setEditing(emptyClient()); }
  function startEdit(c) { setEditing({ ...c }); }
  function save() {
    if (!editing.name.trim()) return;
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
        <button onClick={startNew} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.ink }}>
          <UserPlus size={15} /> Nouveau client
        </button>
      </div>

      {editing && (
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
                <button onClick={() => startEdit(c)} style={{ color: colors.slate }}><Pencil size={15} /></button>
                <button onClick={() => onDelete(c.id)} style={{ color: colors.brick }}><Trash2 size={15} /></button>
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
            <select className="df-select df-mono rounded-md px-2 py-1.5 text-sm" style={{ border: `1px solid ${colors.line}` }} value={editing.tva} onChange={(e) => setEditing({ ...editing, tva: e.target.value })}>
              {TVA_RATES.map((r) => <option key={r} value={r}>{r}% TVA</option>)}
            </select>
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

function CompanyView({ profile, saving, onSave, onReset, documentCount, clientCount, account }) {
  const [local, setLocal] = useState(profile);
  const [confirmReset, setConfirmReset] = useState(false);
  const timer = useRef(null);

  useEffect(() => setLocal(profile), []);

  function patch(p) {
    const next = { ...local, ...p };
    setLocal(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSave(next), 400);
  }
  function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => patch({ logo: reader.result });
    reader.readAsDataURL(file);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="df-display text-2xl font-semibold">Mon entreprise</h1>
          <p className="text-sm" style={{ color: colors.inkSoft }}>Ces informations pré-remplissent automatiquement chaque nouveau devis ou facture.</p>
        </div>
        {saving ? (
          <span className="flex items-center gap-1 text-xs" style={{ color: colors.inkSoft }}><Loader2 size={12} className="animate-spin" /> Enregistrement</span>
        ) : (
          <span className="flex items-center gap-1 text-xs" style={{ color: colors.moss }}><Check size={12} /> Enregistré</span>
        )}
      </div>
      <div className="space-y-3 rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
        <div className="flex gap-1 rounded-lg p-1" style={{ background: colors.paper, width: "fit-content" }}>
          <button onClick={() => patch({ type: "entreprise" })} className="rounded-md px-3 py-1.5 text-xs font-medium" style={{ background: (local.type || "entreprise") === "entreprise" ? colors.ink : "transparent", color: (local.type || "entreprise") === "entreprise" ? "white" : colors.inkSoft }}>Entreprise</button>
          <button onClick={() => patch({ type: "particulier" })} className="rounded-md px-3 py-1.5 text-xs font-medium" style={{ background: local.type === "particulier" ? colors.ink : "transparent", color: local.type === "particulier" ? "white" : colors.inkSoft }}>Particulier</button>
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
      </div>

      {!account?.isAdmin && (
        <div className="mt-8 rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: colors.slate }}>
            <Shield size={15} /> Accès administrateur
          </div>
          <p className="text-xs" style={{ color: colors.inkSoft }}>
            Le statut administrateur est désormais protégé côté serveur — il ne peut plus être activé depuis l'application elle-même (c'était une faille de sécurité dans une version précédente du prototype). Pour devenir admin : va dans ton dashboard Supabase → Table Editor → <code>profiles</code>, trouve la ligne correspondant à ton email, et passe la colonne <code>is_admin</code> à <code>true</code>.
          </p>
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
          <button onClick={() => setConfirmReset(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium" style={{ border: `1px solid ${colors.brick}`, color: colors.brick }}>
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

function PayPalButton({ planId, userId, onApproved }) {
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
      createSubscription: (data, actions) => actions.subscription.create({ plan_id: planId, custom_id: userId }),
      onApprove: () => onApproved && onApproved(),
    }).render(containerRef.current);
  }, [sdkReady, planId, userId]);

  if (sdkError) return <p className="text-xs" style={{ color: colors.brick }}>Configuration PayPal manquante côté site (VITE_PAYPAL_CLIENT_ID).</p>;
  return <div ref={containerRef} />;
}

function PricingView({ account, plans, onChooseFree, limitNotice, documentCount }) {
  const [billing, setBilling] = useState(account?.billing || "mensuel");
  const [approvedMsg, setApprovedMsg] = useState(false);
  const visiblePlans = plans.filter((p) => !p.hidden || account?.plan === p.id);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 text-center">
        <h1 className="df-display text-2xl font-semibold">Choisir un forfait</h1>
        <p className="mt-1 text-sm" style={{ color: colors.inkSoft }}>Tarifs indicatifs — à affiner selon l'étude de la concurrence.</p>
      </div>

      {limitNotice && (
        <div className="mx-auto mb-6 max-w-lg rounded-xl p-3 text-center text-sm" style={{ background: `${colors.brick}15`, color: colors.brick, border: `1px solid ${colors.brick}40` }}>
          Le forfait Gratuit est limité à 3 devis/factures ({documentCount} déjà créés). Passe à un forfait payant pour continuer.
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
            <div key={plan.id} className="flex flex-col rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${plan.id === "essentiel" ? colors.brass : colors.line}`, boxShadow: plan.id === "essentiel" ? `0 0 0 2px ${colors.brass}30` : "none" }}>
              {plan.id === "essentiel" && (
                <div className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide" style={{ color: colors.brassDark }}><Sparkles size={12} /> Le plus choisi</div>
              )}
              <div className="df-display text-lg font-semibold">{plan.name}</div>
              <div className="text-xs" style={{ color: colors.inkSoft }}>{plan.tagline}</div>
              <div className="df-mono mt-4 mb-4">
                {price === null ? (
                  <span className="text-2xl font-semibold">Sur devis</span>
                ) : (
                  <>
                    <span className="text-2xl font-semibold">{price === 0 ? "0€" : `${billing === "annuel" ? Math.round(price / 12) : price}€`}</span>
                    <span className="text-sm" style={{ color: colors.inkSoft }}>/mois</span>
                  </>
                )}
              </div>
              <ul className="mb-5 grow space-y-2 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check size={14} className="mt-0.5 shrink-0" style={{ color: colors.moss }} /> {f}
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <button disabled className="rounded-lg py-2 text-sm font-medium" style={{ background: colors.paper, color: colors.inkSoft }}>Forfait actuel</button>
              ) : plan.id === "gratuit" ? (
                <button onClick={onChooseFree} className="rounded-lg py-2 text-sm font-medium" style={{ background: colors.ink, color: "white" }}>Choisir ce forfait</button>
              ) : plan.id === "entreprise" ? (
                <a href="mailto:contact@devifact.fr?subject=Forfait%20Entreprise" className="rounded-lg py-2 text-center text-sm font-medium" style={{ background: colors.ink, color: "white" }}>Nous contacter</a>
              ) : paypalPlanId ? (
                <PayPalButton planId={paypalPlanId} userId={account?.id} onApproved={() => setApprovedMsg(true)} />
              ) : (
                <p className="rounded-lg py-2 text-center text-xs" style={{ background: colors.paper, color: colors.inkSoft }}>Paiement bientôt disponible</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AdminView({ account, documents, clients, companyProfile, plans, savingPlanSettings, onTogglePlan, onUpdatePlanPrice, onUpdatePlanPaypalId, onTogglePayment, onDeleteAccount }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const totalTTC = documents.reduce((s, d) => s + computeTotals(d).totalTTC, 0);
  const paid = account?.paymentStatus === "payé";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="df-display flex items-center gap-2 text-2xl font-semibold"><Shield size={22} style={{ color: colors.brassDark }} /> Espace Admin</h1>
        <p className="text-sm" style={{ color: colors.inkSoft }}>Vue d'ensemble, gestion des forfaits et du compte.</p>
      </div>

      <div className="mb-6 rounded-2xl p-4" style={{ background: `${colors.moss}0D`, border: `1px solid ${colors.moss}40` }}>
        <div className="flex items-start gap-2">
          <Check size={16} style={{ color: colors.moss, marginTop: "2px", flexShrink: 0 }} />
          <p className="text-xs" style={{ color: colors.moss }}>
            Cet espace est maintenant connecté à une vraie base de données (Supabase). Ton statut administrateur est vérifié côté serveur (RLS) — il ne peut pas être falsifié depuis le navigateur. La liste ci-dessous ne montre encore que <strong>tes propres statistiques</strong> ; une vraie table listant tous les comptes réels peut être ajoutée facilement une fois que tu as de premiers utilisateurs (voir le Dossier de passation technique).
          </p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Ton compte" value={account ? 1 : 0} sub={account?.email || "—"} color={colors.slate} />
        <StatCard label="Documents créés" value={documents.length} sub={eur(totalTTC) + " au total"} color={colors.moss} />
        <StatCard label="Clients enregistrés" value={clients.length} sub={companyProfile.name || "Entreprise non renseignée"} color={colors.brassDark} />
      </div>

      <div className="mb-6 overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
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
          En production, ce statut doit être mis à jour automatiquement par la fonction de webhook PayPal (voir <code>supabase-functions/paypal-webhook</code>), pas manuellement.
        </p>
      </div>

      <div className="mb-6 overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: colors.line }}>
          <span className="df-display text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Gestion des forfaits</span>
          {savingPlanSettings && <Loader2 size={13} className="animate-spin" style={{ color: colors.inkSoft }} />}
        </div>
        <p className="border-b px-4 py-2 text-xs" style={{ borderColor: colors.line, color: colors.inkSoft }}>
          Modifie le prix affiché, masque un forfait de la page publique, et colle l'identifiant du forfait créé côté PayPal (obligatoire pour que le bouton d'abonnement fonctionne).
        </p>
        {plans.map((plan, idx) => (
          <div key={plan.id} className="flex flex-wrap items-center gap-3 border-b px-4 py-3" style={{ borderColor: colors.line }}>
            <div className="min-w-0 basis-32 grow">
              <div className="text-sm font-medium">{plan.name}</div>
              <div className="text-xs" style={{ color: colors.inkSoft }}>{plan.tagline}</div>
            </div>
            {plan.monthly !== null ? (
              <>
                <label className="text-xs" style={{ color: colors.inkSoft }}>
                  Mensuel €
                  <input type="number" className="df-input df-mono mt-0.5 block w-20 rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} value={plan.monthly ?? ""} onChange={(e) => onUpdatePlanPrice(plan.id, "monthly", e.target.value)} />
                </label>
                <label className="text-xs" style={{ color: colors.inkSoft }}>
                  Annuel €
                  <input type="number" className="df-input df-mono mt-0.5 block w-20 rounded-md px-2 py-1 text-sm" style={{ border: `1px solid ${colors.line}` }} value={plan.annual ?? ""} onChange={(e) => onUpdatePlanPrice(plan.id, "annual", e.target.value)} />
                </label>
                <label className="text-xs" style={{ color: colors.inkSoft }}>
                  ID forfait PayPal (mensuel)
                  <input type="text" placeholder="P-XXXXXXXX" className="df-input mt-0.5 block w-36 rounded-md px-2 py-1 text-xs" style={{ border: `1px solid ${colors.line}` }} value={plan.paypalPlanIdMonthly || ""} onChange={(e) => onUpdatePlanPaypalId(plan.id, "monthly", e.target.value)} />
                </label>
                <label className="text-xs" style={{ color: colors.inkSoft }}>
                  ID forfait PayPal (annuel)
                  <input type="text" placeholder="P-XXXXXXXX" className="df-input mt-0.5 block w-36 rounded-md px-2 py-1 text-xs" style={{ border: `1px solid ${colors.line}` }} value={plan.paypalPlanIdAnnual || ""} onChange={(e) => onUpdatePlanPaypalId(plan.id, "annual", e.target.value)} />
                </label>
              </>
            ) : (
              <span className="text-xs" style={{ color: colors.inkSoft }}>Sur devis</span>
            )}
            <span className="ml-auto text-xs font-medium" style={{ color: plan.hidden ? colors.brick : colors.moss }}>{plan.hidden ? "Masqué" : "Visible"}</span>
            <button
              onClick={() => onTogglePlan(plan.id)}
              title={plan.hidden ? "Rendre visible" : "Masquer ce forfait"}
              style={{ color: plan.hidden ? colors.inkSoft : colors.moss }}
            >
              {plan.hidden ? <ToggleLeft size={26} /> : <ToggleRight size={26} />}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.brick}40` }}>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: colors.brick }}>
          <AlertTriangle size={15} /> Zone dangereuse
        </div>
        <p className="mb-4 text-xs" style={{ color: colors.inkSoft }}>
          Réinitialise tes devis, factures, clients et prestations, et te déconnecte. Pour supprimer complètement le compte d'authentification, va dans ton dashboard Supabase → Authentication → Users.
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

function Editor({ doc, saving, clients, prestations, accountPlan, onChange, onBack, onConvert, onSaveClient, onSavePrestation, onSplit, splitNotice, onOpenSplitDoc, onDismissSplitNotice, onGoToPricing }) {
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

  function patch(p) {
    const next = { ...localDoc, ...p };
    setLocalDoc(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onChange(p), 400);
  }
  function patchDeep(key, subPatch) {
    patch({ [key]: { ...localDoc[key], ...subPatch } });
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
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: `Tu es un assistant pour un artisan du bâtiment français qui rédige un devis. À partir de la description du chantier ci-dessous, propose une liste de lignes de devis structurées et réalistes pour ce métier (10 lignes maximum). Ne propose AUCUN prix : les artisans fixent eux-mêmes leurs prix. Réponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ni après, sans balises markdown, exactement sous cette forme : [{"designation":"...", "qty":1, "unit":"forfait"}]. Unités possibles : forfait, heure, jour, m², m³, ml, pièce, kg, lot, ou une chaîne vide.\n\nDescription du chantier : ${aiDescription.trim()}`,
            },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Erreur API (${response.status})`);
      const data = await response.json();
      const text = (data.content || []).map((b) => b.text || "").join("").trim();
      const clean = text.replace(/^```json\s*|^```\s*|```\s*$/g, "").trim();
      const parsed = JSON.parse(clean);
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
      setAiError("Impossible de générer les lignes pour le moment (vérifie ta connexion, ou réessaie).");
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

  const { computedLines, subtotalHT, tvaGroups, totalTVA, totalTTC, acompteAmount, resteAPayer } = computeTotals(localDoc);
  const hasEssentiel = tierAtLeast(accountPlan, "essentiel");
  const hasPro = tierAtLeast(accountPlan, "pro");
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

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    const rows = [];
    rows.push([localDoc.type === "devis" ? "DEVIS" : "FACTURE", localDoc.docNumber]);
    rows.push(["Date d'émission", frLong(localDoc.issueDate)]);
    rows.push([localDoc.type === "devis" ? "Valable jusqu'au" : "Échéance", frLong(localDoc.type === "devis" ? validityDate : dueDate)]);
    rows.push([]);
    rows.push(["Émetteur", localDoc.company.name]);
    rows.push(["SIRET", localDoc.company.siret]);
    rows.push([]);
    rows.push(["Client", localDoc.client.name]);
    rows.push([]);
    rows.push(["Désignation", "Description", "Qté", "Unité", "PU HT", "TVA %", "Remise %", "Total HT"]);
    computedLines.forEach((l) => {
      rows.push([l.designation, "", l.qty, l.unit, Number(l.unitPrice) || 0, l.tva, l.discount, Number(l.totalHT.toFixed(2))]);
      (l.details || []).filter((d) => d.included && (d.text || d.price)).forEach((d) => {
        rows.push(["", "  ".repeat(d.level) + (d.marker || defaultMarker(d.level)) + " " + d.text, "", "", "", "", "", Number(d.price) > 0 ? Number(d.price) : ""]);
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
    XLSX.utils.book_append_sheet(wb, ws, localDoc.type === "devis" ? "Devis" : "Facture");
    XLSX.writeFile(wb, `${localDoc.docNumber}.xlsx`);
  }

  const inputStyle = { fontFamily: "'Inter', sans-serif", border: `1px solid ${colors.line}`, color: colors.ink };
  const statuses = localDoc.type === "devis" ? DEVIS_STATUSES : FACTURE_STATUSES;

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
            <button onClick={onConvert} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.slate }}>
              <ArrowRightLeft size={15} /> Convertir en facture
            </button>
          )}
          <button onClick={() => window.print()} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink }}>
            <Printer size={15} /> PDF
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
        <div className="editor-form rounded-2xl p-6 shadow-sm sm:p-10" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>

          <div className="mb-8 flex flex-wrap items-start justify-between gap-6 border-b pb-6" style={{ borderColor: colors.line }}>
            <div>
              <div className="df-display text-3xl font-semibold uppercase tracking-wide">{localDoc.type === "devis" ? "Devis" : "Facture"}</div>
              <input className="df-input df-mono mt-2 rounded-md px-2 py-1 text-sm" style={inputStyle} value={localDoc.docNumber} onChange={(e) => patch({ docNumber: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <label className="self-center text-right" style={{ color: colors.inkSoft }}>Émis le</label>
              <input type="date" className="df-input df-mono rounded-md px-2 py-1" style={inputStyle} value={localDoc.issueDate} onChange={(e) => patch({ issueDate: e.target.value })} />
              {localDoc.type === "devis" ? (
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
                {localDoc.type === "devis" ? `Valable jusqu'au ${frLong(validityDate)}` : `Paiement attendu avant le ${frLong(dueDate)}`}
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

          <div className="mb-2 hidden gap-2 px-2 text-xs font-medium sm:flex" style={{ color: colors.inkSoft }}>
            <span className="grow basis-56">Désignation</span>
            <span className="w-14 text-right">Qté</span>
            <span className="w-20">Unité</span>
            <span className="w-24 text-right">PU HT</span>
            <span className="w-16 text-right">TVA</span>
            <span className="w-16 text-right">Remise</span>
            <span className="w-24 text-right">Total HT</span>
            <span className="no-print w-24" />
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
                    {!(openDetailsFor.includes(it.id) || (it.details || []).length > 0) && (
                      <button onClick={() => addDetail(it.id, 1)} className="no-print mt-1 flex items-center gap-1 text-xs" style={{ color: colors.slate }}>
                        <Plus size={11} /> Ajouter une description détaillée
                      </button>
                    )}
                  </div>
                  <input type="number" className="df-input df-mono w-14 rounded-md px-1 py-1.5 text-right text-sm" style={inputStyle} value={it.qty} onChange={(e) => updateItem(it.id, { qty: e.target.value })} />
                  <select className="df-select w-20 rounded-md px-1 py-1.5 text-sm" style={inputStyle} value={it.unit} onChange={(e) => updateItem(it.id, { unit: e.target.value })}>
                    {UNIT_OPTIONS.map((u) => <option key={u || "none"} value={u}>{unitLabel(u)}</option>)}
                  </select>
                  <input type="number" className="df-input df-mono w-24 rounded-md px-1 py-1.5 text-right text-sm" style={inputStyle} value={it.unitPrice} onChange={(e) => updateItem(it.id, { unitPrice: e.target.value })} />
                  <select className="df-select df-mono w-16 rounded-md px-1 py-1.5 text-sm" style={inputStyle} value={it.tva} onChange={(e) => updateItem(it.id, { tva: e.target.value })}>
                    {TVA_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                  </select>
                  <input type="number" className="df-input df-mono w-16 rounded-md px-1 py-1.5 text-right text-sm" style={inputStyle} value={it.discount} onChange={(e) => updateItem(it.id, { discount: e.target.value })} />
                  <div className="df-mono w-24 py-1.5 text-right text-sm font-medium">
                    {eur(lineBaseHT(it) * (1 - (Number(it.discount) || 0) / 100) * (1 - (Number(localDoc.globalDiscount) || 0) / 100))}
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
                        <input
                          className="df-input grow rounded-md px-2 py-1 text-xs"
                          style={{ ...inputStyle, opacity: d.included ? 1 : 0.45 }}
                          placeholder={d.level === 1 ? "Description" : "Sous-description"}
                          value={d.text}
                          autoFocus={d.id === lastAddedDetailId}
                          onChange={(e) => updateDetail(it.id, d.id, { text: e.target.value })}
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
                <div className="flex justify-between gap-8"><span style={{ color: colors.inkSoft }}>Sous-total HT</span><span>{eur(subtotalHT)}</span></div>
                {Object.entries(tvaGroups).map(([rate, amount]) => (
                  <div key={rate} className="flex justify-between gap-8"><span style={{ color: colors.inkSoft }}>TVA {rate}%</span><span>{eur(amount)}</span></div>
                ))}
                {Number(localDoc.acompte) > 0 && (
                  <>
                    <div className="flex justify-between gap-8"><span style={{ color: colors.inkSoft }}>Acompte ({localDoc.acompte}%)</span><span>- {eur(acompteAmount)}</span></div>
                    <div className="flex justify-between gap-8 font-semibold" style={{ color: colors.moss }}><span>Reste à payer</span><span>{eur(resteAPayer)}</span></div>
                  </>
                )}
              </div>

              <div className="relative flex h-36 w-36 shrink-0 items-center justify-center" style={{ transform: "rotate(-4deg)" }}>
                <div className="absolute inset-0 rounded-full" style={{ border: `3px solid ${colors.brass}` }} />
                <div className="absolute inset-1.5 rounded-full" style={{ border: `1px solid ${colors.brass}` }} />
                <div className="px-2 text-center">
                  <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: colors.brassDark }}>Total TTC</div>
                  <div className="df-mono mt-1 text-xl font-semibold leading-tight">{eur(totalTTC)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 border-t pt-6" style={{ borderColor: colors.line }}>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Notes</label>
            <textarea className="df-textarea w-full rounded-md px-3 py-2 text-sm" style={{ ...inputStyle, minHeight: "3.5rem" }} value={localDoc.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </div>

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
      <PrintDocument doc={localDoc} totals={{ computedLines, subtotalHT, tvaGroups, totalTVA, totalTTC, acompteAmount, resteAPayer }} accountPlan={accountPlan} />
    </div>
  );
}
