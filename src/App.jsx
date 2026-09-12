import { useState, useEffect, useRef, useMemo, forwardRef, Fragment, Component } from "react";
import { flushSync } from "react-dom";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import QRCode from "qrcode";
import { db } from "./client.js";
import { clearStorageCache, setActiveOrganization, getActiveOrganization } from "./storage-adapter.js";
import * as XLSX from "xlsx";
import {
  Plus, Trash2, Printer, FileSpreadsheet, PenTool, Type as TypeIcon, Upload,
  ArrowRightLeft, Eraser, ChevronUp, ChevronDown, LayoutList, ArrowLeft, TrendingUp, Info, Minus,
  Search, FileText, Receipt, Copy, Loader2, Inbox, Check, Users, Building2,
  Pencil, X, UserPlus, UserCircle, LayoutDashboard, LogOut, Lock, CreditCard, Mail,
  KeyRound, Sparkles, ArrowRight, Eye, EyeOff, GitMerge, Scissors,
  Library, BookmarkPlus, RotateCcw, AlertTriangle, IndentIncrease, IndentDecrease,
  Shield, ToggleLeft, ToggleRight, Calculator, Download, Layers, Menu, Palette, Monitor, Mic, Sun, Moon, Link2,
  Ship, Package, MapPinned, ShoppingCart, Truck, BarChart3, ClipboardCheck, List, Wrench, FileSignature, Calendar, Wallet,
  Maximize2, Minimize2, Camera, ImagePlus,
  Home, HardHat, Files, ChevronRight,
} from "lucide-react";

// Chaque couleur pointe vers une variable CSS (définie par le thème
// actif, voir THEMES et ThemeStyleInjector) plutôt qu'une valeur figée
// — ainsi, changer de thème depuis Admin met à jour tout le site
// instantanément, sans devoir toucher aux centaines d'endroits qui
// utilisent déjà "colors.xxx".
const colors = {
  ink: "var(--df-ink, #1B2A33)",
  inkSoft: "var(--df-ink-soft, #4A5B63)",
  paper: "var(--df-paper, #E9EEEA)",
  surface: "var(--df-surface, #FFFFFF)",
  brass: "var(--df-brass, #B8763E)",
  brassDark: "var(--df-brass-dark, #8F5C2E)",
  slate: "var(--df-slate, #3E5C6E)",
  moss: "var(--df-moss, #5B7A55)",
  brick: "var(--df-brick, #A6483B)",
  line: "var(--df-line, #DAE1DC)",
};

// Palette dédiée à la version "Avancée" — volontairement indépendante
// du système de thèmes (13 thèmes, voir THEMES plus bas) : peu importe
// le thème choisi par ailleurs, l'interface avancée garde toujours
// cette identité propre (anthracite + émeraude), pour un vrai
// changement d'ambiance, pas juste une variante du même marine/laiton.
const adv = {
  ink: "#27272A",         // texte foncé (gris anthracite doux, jamais noir pur)
  inkSoft: "#71717A",
  paper: "#F9FAFB",       // fond général très clair
  surface: "linear-gradient(to bottom, #BFDBFE, #FFFFFF)",   // dégradé bleu clair → blanc, appliqué à toute case/carte/champ blanc par défaut
  sidebarBg: "linear-gradient(to bottom, #BFDBFE, #FFFFFF)",   // dégradé bleu clair → blanc, ne dépend jamais du thème choisi
  accent: "#4F46E5",      // indigo simple et clair, un seul accent, pas de turquoise
  accentSoft: "#EEF2FF",
  line: "#E4E4E7",
  brick: "#DC2626",
  moss: "#16A34A",
};

// Palette de la version "Atelier" — fixe, indépendante des thèmes de
// l'admin (comme la version avancée). Codes couleur du métier : bleu de
// travail pour l'accent, orange sécurité réservé à l'action « Créer »,
// gris béton en fond. Tous les couples texte/fond restent au-dessus de
// 4,5:1 de contraste. Les variables CSS --df-* sont redéfinies sous
// body.df-atelier (voir GlobalStyle) pour que les pages et éditeurs
// partagés prennent la même palette sans être modifiés.
const atelier = {
  ink: "#1C2733",
  inkSoft: "#5A6B78",
  paper: "#F4F6F8",
  surface: "#FFFFFF",
  line: "#D8DEE4",
  accent: "#1F5FA8",
  accentDark: "#174A85",
  accentSoft: "#E6EFF9",
  action: "#E8702A",
  actionDark: "#C95E1F",
  success: "#2E7D4F",
  warning: "#B7791F",
  danger: "#C0392B",
  dark: {
    ink: "#E6EBF0",
    inkSoft: "#9AA7B4",
    paper: "#151B22",
    surface: "#1E262F",
    line: "#2E3944",
    accent: "#5B9BE6",
    accentDark: "#3E7FCB",
    accentSoft: "#1D2C3D",
    action: "#E8702A",
    actionDark: "#C95E1F",
    success: "#4CAF77",
    warning: "#D19A3A",
    danger: "#E06356",
  },
};
// Couleurs Atelier selon le mode clair/sombre de l'appareil.
function atelierTone(darkMode) {
  return darkMode ? atelier.dark : atelier;
}

// Bibliothèque de thèmes — valeurs réelles utilisées par chaque
// variable CSS ci-dessus. "classique" reprend exactement les couleurs
// d'origine du site (rien ne change si l'admin ne touche à rien).
const THEMES = {
  classique: {
    label: "Classique",
    description: "Le style d'origine du site — encre marine et laiton.",
    values: { ink: "#1B2A33", inkSoft: "#4A5B63", paper: "#E9EEEA", surface: "#FFFFFF", brass: "#B8763E", brassDark: "#8F5C2E", slate: "#3E5C6E", moss: "#5B7A55", brick: "#A6483B", line: "#DAE1DC" },
  },
  moderne: {
    label: "Moderne",
    description: "Épuré et contemporain — bleu clair et gris doux.",
    values: { ink: "#1E2A3A", inkSoft: "#5B6B7F", paper: "#EEF2F7", surface: "#FFFFFF", brass: "#3B6FD6", brassDark: "#2C55AC", slate: "#4A6FA5", moss: "#3F9463", brick: "#D65A4A", line: "#DDE6F0" },
  },
  chantier: {
    label: "Chantier",
    description: "Inspiré des outils du métier — orange chaleureux et beige.",
    values: { ink: "#332B22", inkSoft: "#6B5D4A", paper: "#F3ECE0", surface: "#FFFFFF", brass: "#D9822E", brassDark: "#B5691F", slate: "#7A6E5C", moss: "#7A9450", brick: "#C05339", line: "#E8DCC8" },
  },
  trousse: {
    label: "Trousse",
    description: "Papeterie et fournitures — bleu marine et rouge doux.",
    values: { ink: "#242E4F", inkSoft: "#5C6690", paper: "#EEF0F8", surface: "#FFFFFF", brass: "#3355A0", brassDark: "#26417F", slate: "#4C68B0", moss: "#4B8F6A", brick: "#C0453B", line: "#DDE2F2" },
  },
  batisseur: {
    label: "Bâtisseur",
    description: "Terre cuite et bois clair — chaleureux et artisanal.",
    values: { ink: "#3D2E22", inkSoft: "#786551", paper: "#F4EBDD", surface: "#FFFDF9", brass: "#B5652F", brassDark: "#8F4E22", slate: "#7C6A50", moss: "#7A8C52", brick: "#A24A34", line: "#EADFC8" },
  },
  pastel: {
    label: "Pastel",
    description: "Doux et lumineux — lavande, menthe et corail léger.",
    values: { ink: "#463F58", inkSoft: "#867CA0", paper: "#F8F4FB", surface: "#FFFFFF", brass: "#A98AD1", brassDark: "#8A6CB5", slate: "#7FA0CC", moss: "#7ECBA6", brick: "#EE9C97", line: "#EBE3F5" },
  },
  sable: {
    label: "Sable",
    description: "Chaud et minéral — beige désert et terracotta clair.",
    values: { ink: "#4C4030", inkSoft: "#877560", paper: "#F6EFE2", surface: "#FFFBF4", brass: "#CC8F4C", brassDark: "#A6712F", slate: "#8A9483", moss: "#93A970", brick: "#C07248", line: "#EEE1CB" },
  },
  ocean: {
    label: "Océan",
    description: "Frais et clair — bleu lagon et blanc écume.",
    values: { ink: "#173239", inkSoft: "#527481", paper: "#EAF5F6", surface: "#FFFFFF", brass: "#2699AC", brassDark: "#1D7A8C", slate: "#3E7E92", moss: "#3FA684", brick: "#DB7360", line: "#D3EBEE" },
  },
  foret: {
    label: "Forêt",
    description: "Naturel et apaisant — verts doux et mousse.",
    values: { ink: "#2B3624", inkSoft: "#647159", paper: "#F0F3E9", surface: "#FBFCF8", brass: "#7C9C4C", brassDark: "#61793A", slate: "#5C7259", moss: "#68914A", brick: "#B5623F", line: "#E2E9D5" },
  },
  minimal: {
    label: "Minimal",
    description: "Noir, blanc et gris — sobre, une seule touche de couleur.",
    values: { ink: "#242427", inkSoft: "#77777C", paper: "#F5F5F6", surface: "#FFFFFF", brass: "#3B3B3F", brassDark: "#000000", slate: "#54545A", moss: "#2C9856", brick: "#D64545", line: "#E6E6E8" },
  },
  vintage: {
    label: "Vintage",
    description: "Papier ancien et sépia clair — comme un vieux carnet de chantier.",
    values: { ink: "#4A3826", inkSoft: "#7E6A50", paper: "#EFE5CE", surface: "#FAF4E4", brass: "#9C7040", brassDark: "#7C562E", slate: "#7C6E52", moss: "#83824F", brick: "#A85C3E", line: "#E2D5B0" },
  },
  papeterie: {
    label: "Papeterie",
    description: "Stylo, règle, gomme et document dessinés à la main, mélangés en fond — chaud et artisanal.",
    values: { ink: "#3A3226", inkSoft: "#7A6E58", paper: "#F5EFDE", surface: "#FFFCF4", brass: "#B87A3E", brassDark: "#93602E", slate: "#6E7C6A", moss: "#7A9460", brick: "#B5573F", line: "#E9DFC5" },
    pattern: `url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22220%22%20height%3D%22220%22%3E%0A%3Cg%20stroke%3D%22%2393602E%22%20stroke-width%3D%221.6%22%20fill%3D%22none%22%20opacity%3D%220.22%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%0A%20%20%3C%21--%20Stylo%20--%3E%0A%20%20%3Cpath%20d%3D%22M15%2C55%20Q18%2C50%2022%2C45%20T35%2C12%22/%3E%0A%20%20%3Cpath%20d%3D%22M31%2C20%20L38%2C13%20L33%2C8%20Z%22%20fill%3D%22%2393602E%22/%3E%0A%20%20%3C%21--%20R%C3%A8gle%20gradu%C3%A9e%20--%3E%0A%20%20%3Cpath%20d%3D%22M120%2C20%20Q123%2C19%20126%2C20%20L155%2C85%20Q156%2C88%20153%2C89%20L124%2C24%22/%3E%0A%20%20%3Cline%20x1%3D%22128%22%20y1%3D%2226%22%20x2%3D%22133%22%20y2%3D%2224%22/%3E%0A%20%20%3Cline%20x1%3D%22133%22%20y1%3D%2236%22%20x2%3D%22140%22%20y2%3D%2233%22/%3E%0A%20%20%3Cline%20x1%3D%22139%22%20y1%3D%2247%22%20x2%3D%22144%22%20y2%3D%2245%22/%3E%0A%20%20%3Cline%20x1%3D%22144%22%20y1%3D%2258%22%20x2%3D%22151%22%20y2%3D%2255%22/%3E%0A%20%20%3C%21--%20Gomme%20--%3E%0A%20%20%3Cpath%20d%3D%22M25%2C140%20Q22%2C138%2024%2C134%20L45%2C120%20Q49%2C118%2051%2C122%20L58%2C133%20Q60%2C137%2056%2C139%20L35%2C153%20Q31%2C155%2029%2C151%20Z%22/%3E%0A%20%20%3Cline%20x1%3D%2233%22%20y1%3D%22128%22%20x2%3D%2252%22%20y2%3D%22140%22/%3E%0A%20%20%3C%21--%20Document%20pli%C3%A9%20--%3E%0A%20%20%3Cpath%20d%3D%22M110%2C140%20L145%2C140%20L160%2C155%20L160%2C195%20L110%2C195%20Z%22/%3E%0A%20%20%3Cpath%20d%3D%22M145%2C140%20L145%2C155%20L160%2C155%22/%3E%0A%20%20%3Cline%20x1%3D%22118%22%20y1%3D%22165%22%20x2%3D%22150%22%20y2%3D%22165%22/%3E%0A%20%20%3Cline%20x1%3D%22118%22%20y1%3D%22174%22%20x2%3D%22150%22%20y2%3D%22174%22/%3E%0A%20%20%3Cline%20x1%3D%22118%22%20y1%3D%22183%22%20x2%3D%22140%22%20y2%3D%22183%22/%3E%0A%3C/g%3E%0A%3C/svg%3E%0A")`,
  },
  atelier_plan: {
    label: "Atelier de plan",
    description: "Compas, équerre, règle et rapporteur dessinés à la main, mélangés en fond — précis et technique.",
    values: { ink: "#26333D", inkSoft: "#5E7280", paper: "#EAF0F3", surface: "#FFFFFF", brass: "#3E7C93", brassDark: "#2E6273", slate: "#547E8F", moss: "#5C9470", brick: "#C15F4A", line: "#DAE6EA" },
    pattern: `url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22220%22%20height%3D%22220%22%3E%0A%3Cg%20stroke%3D%22%232E6273%22%20stroke-width%3D%221.6%22%20fill%3D%22none%22%20opacity%3D%220.22%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%0A%20%20%3C%21--%20Compas%20--%3E%0A%20%20%3Ccircle%20cx%3D%2245%22%20cy%3D%2260%22%20r%3D%222%22%20fill%3D%22%232E6273%22/%3E%0A%20%20%3Cpath%20d%3D%22M45%2C60%20Q35%2C40%2025%2C15%22/%3E%0A%20%20%3Cpath%20d%3D%22M45%2C60%20Q58%2C42%2068%2C18%22/%3E%0A%20%20%3Cpath%20d%3D%22M45%2C60%20m-25%2C0%20a25%2C25%200%200%201%2044%2C-20%22%20stroke-dasharray%3D%222%2C4%22/%3E%0A%20%20%3C%21--%20%C3%89querre%20--%3E%0A%20%20%3Cpath%20d%3D%22M120%2C25%20L120%2C80%20Q120%2C84%20124%2C84%20L172%2C84%20Q158%2C60%20120%2C25%20Z%22/%3E%0A%20%20%3Cline%20x1%3D%22126%22%20y1%3D%2232%22%20x2%3D%22132%22%20y2%3D%2232%22/%3E%0A%20%20%3Cline%20x1%3D%22126%22%20y1%3D%2242%22%20x2%3D%22130%22%20y2%3D%2242%22/%3E%0A%20%20%3Cline%20x1%3D%22126%22%20y1%3D%2252%22%20x2%3D%22132%22%20y2%3D%2252%22/%3E%0A%20%20%3C%21--%20R%C3%A8gle%20--%3E%0A%20%20%3Cpath%20d%3D%22M20%2C140%20Q23%2C138%2027%2C140%20L58%2C205%20Q60%2C209%2056%2C211%20L25%2C146%22/%3E%0A%20%20%3Cline%20x1%3D%2229%22%20y1%3D%22147%22%20x2%3D%2235%22%20y2%3D%22144%22/%3E%0A%20%20%3Cline%20x1%3D%2235%22%20y1%3D%22159%22%20x2%3D%2240%22%20y2%3D%22157%22/%3E%0A%20%20%3Cline%20x1%3D%2241%22%20y1%3D%22171%22%20x2%3D%2247%22%20y2%3D%22168%22/%3E%0A%20%20%3C%21--%20Rapporteur%20--%3E%0A%20%20%3Cpath%20d%3D%22M120%2C150%20a30%2C30%200%200%201%2060%2C0%20Z%22/%3E%0A%20%20%3Cline%20x1%3D%22150%22%20y1%3D%22120%22%20x2%3D%22150%22%20y2%3D%22150%22/%3E%0A%20%20%3Cline%20x1%3D%22135%22%20y1%3D%22126%22%20x2%3D%22141%22%20y2%3D%22146%22/%3E%0A%20%20%3Cline%20x1%3D%22165%22%20y1%3D%22126%22%20x2%3D%22159%22%20y2%3D%22146%22/%3E%0A%3C/g%3E%0A%3C/svg%3E%0A")`,
  },
  charpente: {
    label: "Charpente & Menuiserie",
    description: "Scie, marteau, mètre ruban et planche — le travail du bois.",
    values: { ink: "#3D2E1E", inkSoft: "#7A6650", paper: "#F4EAD9", surface: "#FFFDF8", brass: "#B5732E", brassDark: "#8F5A22", slate: "#7C6A50", moss: "#7A9450", brick: "#B5573F", line: "#EADFC5" },
    pattern: `url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22220%22%20height%3D%22220%22%3E%0A%3Cg%20stroke%3D%22%238A5A2E%22%20stroke-width%3D%221.6%22%20fill%3D%22none%22%20opacity%3D%220.24%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%0A%20%20%3C%21--%20Scie%20--%3E%0A%20%20%3Cpath%20d%3D%22M15%2C50%20Q30%2C42%2055%2C55%20L50%2C62%20Q28%2C52%2018%2C58%20Z%22/%3E%0A%20%20%3Cpath%20d%3D%22M20%2C53%20L22%2C48%20L24%2C53%20L26%2C48%20L28%2C53%20L30%2C48%20L32%2C53%20L34%2C48%20L36%2C53%20L38%2C48%20L40%2C53%20L42%2C48%20L44%2C53%20L46%2C48%22/%3E%0A%20%20%3Cpath%20d%3D%22M50%2C58%20Q58%2C55%2062%2C48%22/%3E%0A%20%20%3C%21--%20Marteau%20--%3E%0A%20%20%3Cpath%20d%3D%22M130%2C20%20L155%2C45%22/%3E%0A%20%20%3Cpath%20d%3D%22M120%2C10%20L138%2C28%20Q142%2C32%20138%2C36%20L134%2C40%20Q130%2C44%20126%2C40%20L108%2C22%20Q104%2C18%20108%2C14%20L112%2C10%20Q116%2C6%20120%2C10%20Z%22/%3E%0A%20%20%3C%21--%20M%C3%A8tre%20ruban%20--%3E%0A%20%20%3Ccircle%20cx%3D%2245%22%20cy%3D%22150%22%20r%3D%2218%22/%3E%0A%20%20%3Cpath%20d%3D%22M45%2C132%20Q70%2C135%2078%2C155%22/%3E%0A%20%20%3Cline%20x1%3D%2255%22%20y1%3D%22138%22%20x2%3D%2257%22%20y2%3D%22142%22/%3E%0A%20%20%3Cline%20x1%3D%2263%22%20y1%3D%22143%22%20x2%3D%2265%22%20y2%3D%22148%22/%3E%0A%20%20%3Cline%20x1%3D%2270%22%20y1%3D%22149%22%20x2%3D%2273%22%20y2%3D%22153%22/%3E%0A%20%20%3C%21--%20Planche%20avec%20clou%20--%3E%0A%20%20%3Crect%20x%3D%22120%22%20y%3D%22140%22%20width%3D%2270%22%20height%3D%2216%22%20rx%3D%222%22/%3E%0A%20%20%3Cline%20x1%3D%22150%22%20y1%3D%22140%22%20x2%3D%22150%22%20y2%3D%22122%22/%3E%0A%20%20%3Cpath%20d%3D%22M147%2C124%20L150%2C118%20L153%2C124%22/%3E%0A%3C/g%3E%0A%3C/svg%3E%0A")`,
  },
  plomberie: {
    label: "Plomberie",
    description: "Clé à molette, tuyau et robinet — précis et technique.",
    values: { ink: "#1C3644", inkSoft: "#537080", paper: "#E7F1F5", surface: "#FFFFFF", brass: "#2E86AA", brassDark: "#226A87", slate: "#4A7C94", moss: "#4E9470", brick: "#C15F4A", line: "#D3E6EE" },
    pattern: `url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22220%22%20height%3D%22220%22%3E%0A%3Cg%20stroke%3D%22%232E6B8A%22%20stroke-width%3D%221.6%22%20fill%3D%22none%22%20opacity%3D%220.24%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%0A%20%20%3C%21--%20Cl%C3%A9%20%C3%A0%20molette%20--%3E%0A%20%20%3Cpath%20d%3D%22M30%2C60%20L55%2C35%22/%3E%0A%20%20%3Cpath%20d%3D%22M50%2C30%20Q56%2C24%2062%2C30%20Q68%2C36%2062%2C42%20L55%2C49%20L46%2C40%20Z%22/%3E%0A%20%20%3Cpath%20d%3D%22M22%2C68%20Q16%2C74%2022%2C80%20Q28%2C86%2034%2C80%20L38%2C76%20L26%2C64%20Z%22/%3E%0A%20%20%3C%21--%20Tuyau%20coud%C3%A9%20--%3E%0A%20%20%3Cpath%20d%3D%22M120%2C20%20L120%2C55%20Q120%2C65%20130%2C65%20L165%2C65%22/%3E%0A%20%20%3Cpath%20d%3D%22M112%2C20%20L128%2C20%22/%3E%0A%20%20%3Cpath%20d%3D%22M157%2C58%20L172%2C65%20L157%2C72%22/%3E%0A%20%20%3C%21--%20Robinet%20--%3E%0A%20%20%3Cpath%20d%3D%22M40%2C150%20L40%2C170%20Q40%2C178%2048%2C178%20L60%2C178%22/%3E%0A%20%20%3Cpath%20d%3D%22M32%2C150%20L48%2C150%22/%3E%0A%20%20%3Ccircle%20cx%3D%2240%22%20cy%3D%22140%22%20r%3D%228%22/%3E%0A%20%20%3Cline%20x1%3D%2234%22%20y1%3D%22140%22%20x2%3D%2246%22%20y2%3D%22140%22/%3E%0A%20%20%3Cpath%20d%3D%22M60%2C178%20Q66%2C178%2066%2C184%20L66%2C192%22/%3E%0A%20%20%3C%21--%20Goutte%20--%3E%0A%20%20%3Cpath%20d%3D%22M66%2C196%20Q70%2C200%2066%2C205%20Q62%2C200%2066%2C196%20Z%22/%3E%0A%3C/g%3E%0A%3C/svg%3E%0A")`,
  },
  electricite: {
    label: "Électricité",
    description: "Ampoule, tournevis, prise et éclair — clair et vif.",
    values: { ink: "#3D3416", inkSoft: "#7A6E42", paper: "#F7F1DE", surface: "#FFFDF4", brass: "#C99A24", brassDark: "#A17A18", slate: "#7C8A5E", moss: "#7A9450", brick: "#B5573F", line: "#EFE2B8" },
    pattern: `url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22220%22%20height%3D%22220%22%3E%0A%3Cg%20stroke%3D%22%239C7A1E%22%20stroke-width%3D%221.6%22%20fill%3D%22none%22%20opacity%3D%220.24%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%0A%20%20%3C%21--%20Ampoule%20--%3E%0A%20%20%3Ccircle%20cx%3D%2245%22%20cy%3D%2245%22%20r%3D%2220%22/%3E%0A%20%20%3Cpath%20d%3D%22M37%2C62%20L53%2C62%20L53%2C70%20Q53%2C74%2049%2C74%20L41%2C74%20Q37%2C74%2037%2C70%20Z%22/%3E%0A%20%20%3Cline%20x1%3D%2240%22%20y1%3D%2266%22%20x2%3D%2250%22%20y2%3D%2266%22/%3E%0A%20%20%3Cpath%20d%3D%22M38%2C38%20Q45%2C30%2052%2C38%20Q48%2C45%2045%2C50%20Q42%2C45%2038%2C38%20Z%22/%3E%0A%20%20%3C%21--%20Tournevis%20--%3E%0A%20%20%3Cpath%20d%3D%22M130%2C15%20L160%2C45%22/%3E%0A%20%20%3Crect%20x%3D%22108%22%20y%3D%2245%22%20width%3D%2226%22%20height%3D%2212%22%20rx%3D%223%22%20transform%3D%22rotate%2845%20121%2051%29%22/%3E%0A%20%20%3Cpath%20d%3D%22M155%2C40%20L168%2C53%20L162%2C59%20L149%2C46%20Z%22/%3E%0A%20%20%3C%21--%20Prise%20%C3%A9lectrique%20--%3E%0A%20%20%3Crect%20x%3D%22110%22%20y%3D%22120%22%20width%3D%2250%22%20height%3D%2260%22%20rx%3D%226%22/%3E%0A%20%20%3Ccircle%20cx%3D%22127%22%20cy%3D%22140%22%20r%3D%223%22%20fill%3D%22%239C7A1E%22/%3E%0A%20%20%3Ccircle%20cx%3D%22143%22%20cy%3D%22140%22%20r%3D%223%22%20fill%3D%22%239C7A1E%22/%3E%0A%20%20%3Cline%20x1%3D%22135%22%20y1%3D%22155%22%20x2%3D%22135%22%20y2%3D%22165%22/%3E%0A%20%20%3C%21--%20%C3%89clair%20--%3E%0A%20%20%3Cpath%20d%3D%22M40%2C110%20L52%2C110%20L44%2C128%20L56%2C128%20L36%2C155%20L42%2C132%20L30%2C132%20Z%22/%3E%0A%3C/g%3E%0A%3C/svg%3E%0A")`,
  },
  maconnerie: {
    label: "Maçonnerie",
    description: "Truelle, brique, niveau et seau — solide et minéral.",
    values: { ink: "#3A2A22", inkSoft: "#78655A", paper: "#F1E7E2", surface: "#FFFDFB", brass: "#B0684E", brassDark: "#8A4F39", slate: "#7C8570", moss: "#7A9464", brick: "#A6483B", line: "#E6D3CA" },
    pattern: `url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22220%22%20height%3D%22220%22%3E%0A%3Cg%20stroke%3D%22%238A5240%22%20stroke-width%3D%221.6%22%20fill%3D%22none%22%20opacity%3D%220.24%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%0A%20%20%3C%21--%20Truelle%20--%3E%0A%20%20%3Cpath%20d%3D%22M20%2C30%20L45%2C55%20Q52%2C62%2046%2C68%20L42%2C72%20Q36%2C78%2030%2C72%20L8%2C50%20Q4%2C46%208%2C42%20L12%2C38%20Q16%2C34%2020%2C30%20Z%22/%3E%0A%20%20%3Cpath%20d%3D%22M42%2C68%20L58%2C84%22/%3E%0A%20%20%3Cpath%20d%3D%22M55%2C82%20L66%2C93%22/%3E%0A%20%20%3C%21--%20Brique%20--%3E%0A%20%20%3Crect%20x%3D%22110%22%20y%3D%2230%22%20width%3D%2260%22%20height%3D%2230%22%20rx%3D%222%22/%3E%0A%20%20%3Cline%20x1%3D%22140%22%20y1%3D%2230%22%20x2%3D%22140%22%20y2%3D%2260%22/%3E%0A%20%20%3Cline%20x1%3D%22110%22%20y1%3D%2245%22%20x2%3D%22125%22%20y2%3D%2245%22/%3E%0A%20%20%3Cline%20x1%3D%22155%22%20y1%3D%2245%22%20x2%3D%22170%22%20y2%3D%2245%22/%3E%0A%20%20%3C%21--%20Niveau%20%C3%A0%20bulle%20--%3E%0A%20%20%3Crect%20x%3D%2220%22%20y%3D%22120%22%20width%3D%2290%22%20height%3D%2216%22%20rx%3D%223%22/%3E%0A%20%20%3Ccircle%20cx%3D%2265%22%20cy%3D%22128%22%20r%3D%226%22/%3E%0A%20%20%3Ccircle%20cx%3D%2265%22%20cy%3D%22128%22%20r%3D%222%22%20fill%3D%22%238A5240%22/%3E%0A%20%20%3C%21--%20Seau%20--%3E%0A%20%20%3Cpath%20d%3D%22M130%2C150%20L170%2C150%20L163%2C190%20L137%2C190%20Z%22/%3E%0A%20%20%3Cpath%20d%3D%22M130%2C150%20Q150%2C144%20170%2C150%22/%3E%0A%20%20%3Cpath%20d%3D%22M138%2C150%20Q150%2C138%20162%2C150%22/%3E%0A%3C/g%3E%0A%3C/svg%3E%0A")`,
  },
  peinture: {
    label: "Peinture",
    description: "Rouleau, pinceau et pot de peinture — coloré et vivant.",
    values: { ink: "#3A2418", inkSoft: "#7A5E4C", paper: "#FAEDE4", surface: "#FFFFFF", brass: "#D9682E", brassDark: "#B0501F", slate: "#5E8A6E", moss: "#5E9460", brick: "#C15F4A", line: "#F3DCC9" },
    pattern: `url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22220%22%20height%3D%22220%22%3E%0A%3Cg%20stroke%3D%22%23B0512E%22%20stroke-width%3D%221.6%22%20fill%3D%22none%22%20opacity%3D%220.24%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%0A%20%20%3C%21--%20Rouleau%20--%3E%0A%20%20%3Crect%20x%3D%2220%22%20y%3D%2220%22%20width%3D%2255%22%20height%3D%2218%22%20rx%3D%229%22/%3E%0A%20%20%3Cline%20x1%3D%2260%22%20y1%3D%2229%22%20x2%3D%2280%22%20y2%3D%2229%22/%3E%0A%20%20%3Cpath%20d%3D%22M80%2C29%20L80%2C55%20L95%2C60%22/%3E%0A%20%20%3C%21--%20Pinceau%20--%3E%0A%20%20%3Cpath%20d%3D%22M140%2C15%20L165%2C40%22/%3E%0A%20%20%3Cpath%20d%3D%22M130%2C25%20Q124%2C31%20130%2C37%20L140%2C47%20Q146%2C53%20152%2C47%20L156%2C43%20L142%2C29%20Z%22/%3E%0A%20%20%3Cpath%20d%3D%22M128%2C38%20Q118%2C42%20116%2C54%20Q126%2C50%20132%2C42%20Z%22/%3E%0A%20%20%3C%21--%20Pot%20de%20peinture%20--%3E%0A%20%20%3Cpath%20d%3D%22M115%2C110%20L165%2C110%20L160%2C165%20L120%2C165%20Z%22/%3E%0A%20%20%3Cpath%20d%3D%22M115%2C110%20Q140%2C102%20165%2C110%22/%3E%0A%20%20%3Crect%20x%3D%22132%22%20y%3D%2295%22%20width%3D%2216%22%20height%3D%2215%22%20rx%3D%222%22/%3E%0A%20%20%3C%21--%20%C3%89claboussures%20--%3E%0A%20%20%3Ccircle%20cx%3D%2235%22%20cy%3D%22150%22%20r%3D%223%22/%3E%0A%20%20%3Ccircle%20cx%3D%2250%22%20cy%3D%22165%22%20r%3D%224%22/%3E%0A%20%20%3Ccircle%20cx%3D%2225%22%20cy%3D%22175%22%20r%3D%222.5%22/%3E%0A%3C/g%3E%0A%3C/svg%3E%0A")`,
  },
  jardinage: {
    label: "Jardinage & Paysage",
    description: "Pelle, râteau, arrosoir et feuille — naturel et frais.",
    values: { ink: "#25321E", inkSoft: "#5E6E4E", paper: "#EDF3E7", surface: "#FBFDF8", brass: "#5E8A44", brassDark: "#476B32", slate: "#5C7A64", moss: "#5E8A44", brick: "#B5623F", line: "#DCE9D0" },
    pattern: `url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22220%22%20height%3D%22220%22%3E%0A%3Cg%20stroke%3D%22%234C7A3E%22%20stroke-width%3D%221.6%22%20fill%3D%22none%22%20opacity%3D%220.24%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%0A%20%20%3C%21--%20Pelle%20--%3E%0A%20%20%3Cpath%20d%3D%22M35%2C20%20L60%2C45%22/%3E%0A%20%20%3Cpath%20d%3D%22M55%2C42%20Q68%2C55%2060%2C68%20Q52%2C80%2038%2C72%20Q26%2C64%2034%2C52%20Q42%2C44%2055%2C42%20Z%22/%3E%0A%20%20%3C%21--%20R%C3%A2teau%20--%3E%0A%20%20%3Cpath%20d%3D%22M140%2C15%20L165%2C40%22/%3E%0A%20%20%3Cpath%20d%3D%22M150%2C45%20L180%2C45%22/%3E%0A%20%20%3Cline%20x1%3D%22150%22%20y1%3D%2245%22%20x2%3D%22146%22%20y2%3D%2258%22/%3E%0A%20%20%3Cline%20x1%3D%22158%22%20y1%3D%2245%22%20x2%3D%22156%22%20y2%3D%2258%22/%3E%0A%20%20%3Cline%20x1%3D%22166%22%20y1%3D%2245%22%20x2%3D%22166%22%20y2%3D%2258%22/%3E%0A%20%20%3Cline%20x1%3D%22174%22%20y1%3D%2245%22%20x2%3D%22176%22%20y2%3D%2258%22/%3E%0A%20%20%3Cline%20x1%3D%22180%22%20y1%3D%2245%22%20x2%3D%22184%22%20y2%3D%2258%22/%3E%0A%20%20%3C%21--%20Arrosoir%20--%3E%0A%20%20%3Cpath%20d%3D%22M20%2C130%20L60%2C130%20L56%2C165%20L24%2C165%20Z%22/%3E%0A%20%20%3Cpath%20d%3D%22M20%2C130%20Q15%2C120%2022%2C112%22/%3E%0A%20%20%3Cpath%20d%3D%22M60%2C135%20L80%2C120%22/%3E%0A%20%20%3Ccircle%20cx%3D%2282%22%20cy%3D%22118%22%20r%3D%222%22/%3E%0A%20%20%3Ccircle%20cx%3D%2288%22%20cy%3D%22112%22%20r%3D%222%22/%3E%0A%20%20%3Ccircle%20cx%3D%2286%22%20cy%3D%22122%22%20r%3D%222%22/%3E%0A%20%20%3C%21--%20Feuille%20--%3E%0A%20%20%3Cpath%20d%3D%22M130%2C150%20Q150%2C135%20165%2C150%20Q150%2C175%20130%2C150%20Z%22/%3E%0A%20%20%3Cline%20x1%3D%22130%22%20y1%3D%22150%22%20x2%3D%22163%22%20y2%3D%22150%22/%3E%0A%3C/g%3E%0A%3C/svg%3E%0A")`,
  },
};

// Applique les variables CSS du thème actif directement sur la page —
// depuis un seul endroit central (voir le useEffect dédié plus bas
// dans le composant principal), ça couvre automatiquement tous les
// écrans (chargement, connexion, tableau de bord...) sans avoir à
// transmettre le thème à chacun des nombreux composants du site.
function applyTheme(themeId) {
  const theme = THEMES[themeId] || THEMES.classique;
  Object.entries(theme.values).forEach(([k, v]) => {
    const cssVarName = `--df-${k.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
    document.documentElement.style.setProperty(cssVarName, v);
  });
  document.documentElement.style.setProperty("--df-bg-pattern", theme.pattern || "none");
}

// Ferme un menu déroulant/popover avec la touche Échap — au clavier,
// jusqu'ici seul un clic en dehors du menu le fermait.
// Dessinée à la main plutôt qu'importée d'une bibliothèque d'icônes —
// lucide-react ne fournit pas d'icônes de marques (Instagram, etc.),
// contrairement aux icônes génériques utilisées partout ailleurs sur
// le site.
function InstagramIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

// Bouton "Enregistrer" en bas de chaque éditeur — marque le document
// comme "Terminé" une fois cliqué. Reste discret et informatif une
// fois déjà cliqué, plutôt que de disparaître (pour qu'on sache
// toujours où on en est en revenant sur ce document plus tard).
function FinalizeButton({ doc, onFinalize, siteSettings }) {
  const isDone = doc?.workStage === "termine";
  const isAdvanced = siteSettings?.landingPageVersion === "avancee";
  return (
    <div className="no-print flex items-center justify-end gap-2 border-t px-6 py-4" style={{ borderColor: colors.line }}>
      {isDone && <span className="text-xs" style={{ color: colors.inkSoft }}>Marqué comme terminé — modifie-le et enregistre à nouveau si besoin.</span>}
      <button
        onClick={onFinalize}
        className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium"
        style={isDone ? { background: isAdvanced ? adv.moss : colors.moss, color: "white" } : isAdvanced ? { background: adv.accent, color: "white" } : { background: colors.brass, color: colors.ink }}
      >
        {isDone ? <Check size={16} /> : null} {isDone ? "Terminé" : "Enregistrer"}
      </button>
    </div>
  );
}

// Palette de commandes (Ctrl+K / Cmd+K) — recherche rapide parmi
// toutes les actions et pages du site, sans naviguer dans les menus.
// Devient vite indispensable dès qu'il y a beaucoup de services (15
// ici) — un réflexe déjà bien installé sur les sites pros modernes.
function CommandPalette({ isOpen, onClose, commands }) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  useEscapeToClose(isOpen, onClose);

  useEffect(() => {
    if (isOpen) { setQuery(""); setSelectedIndex(0); setTimeout(() => inputRef.current?.focus(), 10); }
  }, [isOpen]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(q) || (c.keywords || "").toLowerCase().includes(q));
  }, [query, commands]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  function runSelected() {
    const cmd = filtered[selectedIndex];
    if (cmd) { cmd.action(); onClose(); }
  }

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-24" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose} role="presentation">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl" style={{ background: "white" }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Palette de commandes">
        <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: colors.line }}>
          <Search size={17} style={{ color: colors.inkSoft }} aria-hidden="true" />
          <input
            ref={inputRef}
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Rechercher une action ou une page..."
            aria-label="Rechercher une action ou une page"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); runSelected(); }
            }}
          />
          <span className="rounded border px-1.5 py-0.5 text-xs" style={{ borderColor: colors.line, color: colors.inkSoft }}>Échap</span>
        </div>
        <div id="command-palette-list" role="listbox" aria-label="Résultats" className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm" style={{ color: colors.inkSoft }}>Aucun résultat pour "{query}".</p>
          ) : (
            filtered.map((cmd, i) => {
              const CmdIcon = cmd.icon;
              return (
                <button
                  key={cmd.id}
                  role="option"
                  aria-selected={i === selectedIndex}
                  onClick={() => { cmd.action(); onClose(); }}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm"
                  style={{ background: i === selectedIndex ? colors.paper : "transparent", color: colors.ink }}
                >
                  {CmdIcon && <CmdIcon size={16} style={{ color: colors.inkSoft, flexShrink: 0 }} aria-hidden="true" />}
                  <span className="min-w-0 flex-1 truncate">{cmd.label}</span>
                  {cmd.hint && <span className="shrink-0 text-xs" style={{ color: colors.inkSoft }}>{cmd.hint}</span>}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function useEscapeToClose(isOpen, onClose) {
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);
}

// Lit un fichier image en le validant d'abord (type réel du fichier,
// pas juste l'attribut "accept" qui n'est qu'une suggestion visuelle
// et n'empêche personne de choisir autre chose) et sa taille — sans
// ça, une photo prise directement au téléphone (souvent 5 à 15 Mo)
// finissait stockée telle quelle, sans le moindre avertissement.
function readImageFile(file, maxSizeMB = 3) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Merci de choisir une image (JPG, PNG...)."));
      return;
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      reject(new Error(`Cette image est trop volumineuse (max ${maxSizeMB} Mo) — réduis-la avant de l'ajouter.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Impossible de lire ce fichier."));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Photos de chantier — bucket privé "chantier-photos" (règles d'accès :
// supabase/migrations_audit/2026-09-10_photos-chantier.sql). Le document ne
// garde que le chemin du fichier ; les adresses signées (1 h) sont
// régénérées à l'ouverture du document et juste avant chaque PDF.
// ---------------------------------------------------------------------------
const PHOTO_BUCKET = "chantier-photos";
const MAX_PHOTOS_PER_DOC = 20;
const PHOTO_MAX_PX = 1600;
const PHOTO_URL_TTL_SECONDS = 3600;

// Redimensionne une image (1600 px de côté maximum) et la convertit en
// JPEG dans le navigateur — une photo de téléphone de 5 à 15 Mo devient
// quelques centaines de Ko, sans passer par un service externe.
async function resizePhotoToJpeg(file) {
  if (!file || !String(file.type || "").startsWith("image/")) throw new Error("Ce fichier n'est pas une image.");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Impossible de lire cette image (format non pris en charge par le navigateur).")); };
      img.src = url;
    });
  }
  const w = bitmap.width, h = bitmap.height;
  if (!w || !h) throw new Error("Impossible de lire cette image.");
  const ratio = Math.min(1, PHOTO_MAX_PX / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (typeof bitmap.close === "function") bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("Impossible de convertir cette image.");
  return blob;
}

async function uploadDocumentPhoto(organizationId, documentId, file) {
  if (!organizationId) throw new Error("Aucune organisation active — reconnecte-toi.");
  const blob = await resizePhotoToJpeg(file);
  const id = nextId("ph");
  const path = `${organizationId}/${documentId}/${id}.jpg`;
  const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "3600", upsert: false });
  if (error) {
    console.error("Erreur d'envoi de photo", error);
    throw new Error(/row-level security|not authorized|Unauthorized/i.test(error.message || "") ? "Ton rôle ne permet pas d'ajouter des photos." : "Impossible d'envoyer cette photo pour l'instant.");
  }
  return { id, path, name: file.name || `${id}.jpg`, createdAt: Date.now() };
}

async function deleteDocumentPhoto(path) {
  const { error } = await db.storage.from(PHOTO_BUCKET).remove([path]);
  if (error) throw error;
}

// Supprime du bucket les fichiers de tous les documents passés — appelé
// quand un document (ou tous, lors d'une réinitialisation) est supprimé,
// pour ne laisser aucun fichier orphelin. Jamais bloquant : la
// suppression du document reste acquise même si le nettoyage échoue.
async function removeDocumentsPhotoFiles(docs) {
  const paths = (docs || []).flatMap((d) => (Array.isArray(d?.photos) ? d.photos.map((p) => p?.path).filter(Boolean) : []));
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    try {
      const { error } = await db.storage.from(PHOTO_BUCKET).remove(chunk);
      if (error) console.error("Erreur de suppression des photos de chantier", error);
    } catch (err) {
      console.error("Erreur de suppression des photos de chantier", err);
    }
  }
}

async function signPhotoUrls(photos) {
  return signPhotoPaths((photos || []).map((p) => p?.path));
}
async function signPhotoPaths(pathList) {
  const paths = (pathList || []).filter(Boolean);
  if (!paths.length) return {};
  const { data, error } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
  if (error) throw error;
  const map = {};
  for (const item of data || []) if (item.signedUrl && !item.error) map[item.path] = item.signedUrl;
  return map;
}

// Adresses signées des photos d'un document : chargées à l'ouverture,
// rechargées quand la liste change, et rafraîchies à la demande (avant
// une capture PDF) avec un rendu synchrone.
function usePhotoUrls(photos) {
  const [urls, setUrls] = useState({});
  const pathsKey = (photos || []).map((p) => p?.path).join("|");
  useEffect(() => {
    let cancelled = false;
    if (!pathsKey) { setUrls({}); return; }
    signPhotoPaths(pathsKey.split("|")).then((map) => { if (!cancelled) setUrls(map); }).catch((err) => console.error("Erreur de chargement des photos", err));
    return () => { cancelled = true; };
  }, [pathsKey]);
  async function refresh() {
    try {
      const map = await signPhotoUrls(photos);
      flushSync(() => setUrls(map));
      return map;
    } catch (err) {
      console.error("Erreur de rafraîchissement des photos", err);
      return urls;
    }
  }
  return { urls, refresh };
}

// Bloc "Photos de chantier" des éditeurs Rapport d'intervention, PV de
// réception et Situation de travaux : prise de vue directe ou galerie,
// vignettes, retrait (qui supprime aussi le fichier).
function DocumentPhotosBlock({ photos, urls, canEdit, uploading, onAdd, onRemove }) {
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const full = photos.length >= MAX_PHOTOS_PER_DOC;
  function handleFiles(e) {
    const files = e.target.files;
    const list = files ? Array.from(files) : [];
    e.target.value = "";
    if (list.length) onAdd(list);
  }
  const btnStyle = { border: `1px solid ${colors.line}`, color: colors.slate, opacity: uploading || full ? 0.6 : 1 };
  return (
    <div className="mt-6 border-t pt-6" style={{ borderColor: colors.line }}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>
          <Camera size={13} /> Photos de chantier <span className="df-mono font-normal normal-case tracking-normal" style={{ color: colors.inkSoft }}>{photos.length}/{MAX_PHOTOS_PER_DOC}</span>
        </label>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFiles} />
            <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
            <button type="button" onClick={() => cameraRef.current?.click()} disabled={uploading || full} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium" style={btnStyle}>
              <Camera size={13} /> Prendre une photo
            </button>
            <button type="button" onClick={() => galleryRef.current?.click()} disabled={uploading || full} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium" style={btnStyle}>
              <ImagePlus size={13} /> Choisir dans la galerie
            </button>
          </div>
        )}
      </div>
      <p className="mb-3 text-xs" style={{ color: colors.inkSoft }}>Les photos sont réduites avant l'envoi et apparaissent en grille à la fin du PDF.</p>
      {uploading && (
        <p className="mb-2 flex items-center gap-1.5 text-xs" style={{ color: colors.inkSoft }}><Loader2 size={13} className="animate-spin" /> Envoi en cours…</p>
      )}
      {photos.length === 0 ? (
        !uploading && <p className="text-xs" style={{ color: colors.inkSoft }}>Aucune photo pour l'instant.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {photos.map((p) => (
            <div key={p.id} className="relative overflow-hidden rounded-lg" style={{ aspectRatio: "1 / 1", background: colors.paper, border: `1px solid ${colors.line}` }}>
              {urls[p.path] ? (
                <img src={urls[p.path]} alt={p.name || "Photo de chantier"} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center"><Loader2 size={14} className="animate-spin" style={{ color: colors.inkSoft }} /></div>
              )}
              {canEdit && (
                <button type="button" onClick={() => onRemove(p)} title="Retirer cette photo" className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full text-white" style={{ background: "rgba(27,42,51,0.7)" }}>
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
// Libellé d'affichage d'une devise : le dirham marocain s'écrit « DH »
// (le code interne reste MAD pour les calculs et les exports normalisés).
function currencyLabel(currency) {
  return currency === "MAD" ? "DH" : currency;
}
function formatMoney(n, currency) {
  const amount = isFinite(n) ? n : 0;
  if (currency === "MAD") {
    return `${amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
  }
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

// ---------------------------------------------------------------------------
// Pays et devise détectés à la première visite (adresse IP, service
// GeoJS : gratuit, sans clé, sans autre donnée que l'IP). Sert uniquement
// de valeur de départ pour les NOUVELLES données (entreprise sans pays,
// nouveau client, nouveau document) — jamais pour écraser une valeur
// saisie. En cas d'échec, tout reste sur France / EUR, sans message.
// ---------------------------------------------------------------------------
const GEO_STORAGE_KEY = "devifact_geo_country";
const GEO_CACHE_DAYS = 30;
// Devise par code pays, pour les pays hors de la liste des indices de
// révision (qui porte déjà sa devise). Seules les devises proposées dans
// le sélecteur sont utilisées ; sinon EUR.
const GEO_CURRENCY_BY_CODE = {
  MA: "MAD", DZ: "DZD", TN: "TND",
  SN: "XOF", CI: "XOF", ML: "XOF", BF: "XOF", BJ: "XOF", TG: "XOF", NE: "XOF", GW: "XOF",
  CM: "XAF", GA: "XAF", CG: "XAF", TD: "XAF", CF: "XAF", GQ: "XAF",
  US: "USD", GB: "GBP", CH: "CHF", CA: "CAD", CN: "CNY", JP: "JPY", AE: "AED", SA: "SAR",
  TR: "TRY", IN: "INR", BR: "BRL", MX: "MXN", AU: "AUD", SE: "SEK", NO: "NOK", PL: "PLN",
};
let detectedGeo = null; // { code: "MA", country: "🇲🇦 MA", currency: "MAD" }
function geoFromCode(code) {
  const clean = String(code || "").toUpperCase().trim();
  if (!/^[A-Z]{2}$/.test(clean)) return null;
  const country = COUNTRIES.find((c) => c.endsWith(` ${clean}`)) || null;
  if (!country) return null;
  const candidate = REVISION_COUNTRY_INFO[country]?.currency || GEO_CURRENCY_BY_CODE[clean] || "EUR";
  return { code: clean, country, currency: CURRENCIES.includes(candidate) ? candidate : "EUR" };
}
// Valeurs de départ pour une nouvelle donnée : pays et devise détectés,
// sinon les valeurs historiques du site (pays vide, EUR).
function geoDefaults() {
  return { country: detectedGeo?.country || "", currency: detectedGeo?.currency || "EUR" };
}
async function detectGeoCountry() {
  if (typeof window === "undefined" || detectedGeo) return;
  try {
    const cached = JSON.parse(localStorage.getItem(GEO_STORAGE_KEY) || "null");
    if (cached?.code && Date.now() - (cached.at || 0) < GEO_CACHE_DAYS * 86400000) {
      detectedGeo = geoFromCode(cached.code);
      if (detectedGeo) return;
    }
  } catch { /* stockage local indisponible : on détecte à chaque fois */ }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("https://get.geojs.io/v1/ip/country.json", { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const data = await res.json();
    const geo = geoFromCode(data?.country);
    if (!geo) return;
    detectedGeo = geo;
    try { localStorage.setItem(GEO_STORAGE_KEY, JSON.stringify({ code: geo.code, at: Date.now() })); } catch { /* ignoré */ }
  } catch {
    // Service indisponible ou trop lent : valeurs par défaut, sans bruit.
  }
}
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
  return { id: nextId("l"), type: "line", designation: "", details: [], qty: 1, unit: "", unitPrice: 0, tva: 20, discount: 0 };
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

// Champs ajoutés pour la facturation électronique (Factur-X) — toujours
// en plus des champs existants, jamais à la place : "address" reste
// l'adresse en un seul bloc telle qu'elle est saisie et imprimée
// aujourd'hui, les nouveaux champs portent les informations que la norme
// EN 16931 exige séparément (code postal, ville, SIRET/SIREN, n° TVA).
function emptyClient() {
  return { id: nextId("cli"), type: "entreprise", name: "", address: "", country: geoDefaults().country, email: "", phone: "", siret: "", tva: "", postalCode: "", city: "" };
}
// Profil d'entreprise sans pays renseigné : proposé avec le pays détecté
// dans le formulaire (l'utilisateur peut le changer avant d'enregistrer).
function withGeoCountry(profile) {
  if (!profile || (profile.country || "").trim()) return profile;
  const { country } = geoDefaults();
  return country ? { ...profile, country } : profile;
}
function emptyCompanyProfile() {
  return { type: "entreprise", name: "", siret: "", address: "", country: "", email: "", phone: "", tva: "", logo: null, postalCode: "", city: "", iban: "", bic: "", vatOnDebits: false, googleReviewUrl: "" };
}
function emptyPrestation() {
  return { id: nextId("pr"), designation: "", category: "", unit: "", unitPrice: 0, tva: 20 };
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
    serie: "", incoterm: "", incotermPlace: "", currency: geoDefaults().currency,
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
    designation: "", unit: "", qty: 1, unitPrice: 0, tva: 20,
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
    photos: [],
    previousSituationId: null,
    marcheNumero: "",
    objet: "",
    dateDebut: "",
    company: { type: "entreprise", name: "", siret: "", address: "", country: "", email: "", phone: "", tva: "", logo: null },
    client: { type: "entreprise", name: "", address: "", country: "", email: "", phone: "" },
    clientId: null,
    chantier: "",
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
    photos: [],
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
    photos: [],
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

// Détecte si un document ne contient encore aucune vraie saisie de la
// personne — sert à ne jamais enregistrer un service ouvert "pour
// voir" et refermé aussitôt sans rien avoir écrit dedans.
function isDocumentEmpty(doc) {
  if (!doc) return true;
  if ((doc.client?.name || "").trim()) return false;
  if (Array.isArray(doc.items) && doc.items.some((it) => (it.designation || "").trim())) return false;
  // Une photo de chantier ajoutée est un vrai contenu (le fichier existe
  // déjà dans le stockage) : le document doit être conservé.
  if (Array.isArray(doc.photos) && doc.photos.length) return false;

  // Champs propres à certains types, en plus de client/items déjà
  // vérifiés ci-dessus pour tous les types.
  const specificFields = {
    situation: ["objet", "marcheNumero"],
    pv_reception: ["objet", "marcheNumero"],
    rapport: ["motifAppel", "diagnostic", "travauxRealises", "adresseIntervention", "technicien"],
    contrat: ["objetTravaux", "montantTotalHT"],
    relance: ["factureRef", "montantDu"],
    planning: ["objet", "marcheNumero"],
  };
  if ((specificFields[doc.type] || []).some((f) => String(doc[f] || "").trim())) return false;

  if (doc.type === "planning" && Array.isArray(doc.taches) && doc.taches.some((t) => (t.designation || "").trim())) return false;
  if (doc.type === "pv_reception" && Array.isArray(doc.reserves) && doc.reserves.length > 0) return false;

  // Les notes par défaut ("Merci de votre confiance." ou vide) ne
  // comptent pas comme un vrai contenu — seulement si modifiées.
  const defaultNotes = ["", "merci de votre confiance."];
  if (!defaultNotes.includes((doc.notes || "").trim().toLowerCase())) return false;

  return true;
}

function newDocument(type, documents) {
  const base = {
    id: nextId("doc"),
    type,
    docNumber: nextNumber(documents, type),
    issueDate: new Date().toISOString().slice(0, 10),
    currency: geoDefaults().currency,
    validityDays: 30,
    showValidity: true,
    dueDays: 30,
    company: { type: "entreprise", name: "", siret: "", address: "", country: "", email: "", phone: "", tva: "", logo: null, postalCode: "", city: "", iban: "", bic: "", vatOnDebits: false },
    client: { type: "entreprise", name: "", address: "", country: geoDefaults().country, email: "", phone: "", siret: "", tva: "", postalCode: "", city: "" },
    clientId: null,
    chantier: "",
    // Facturation électronique (réforme 2026-2027) : catégorie de
    // l'opération (livraison de biens / prestation de services / mixte)
    // et adresse de livraison si différente de celle du client — deux
    // des nouvelles mentions obligatoires. Vides par défaut : à
    // renseigner avant d'exporter en Factur-X.
    operationCategory: "",
    deliveryAddress: "",
    deliveryPostalCode: "",
    deliveryCity: "",
    // Motif d'exonération appliqué aux lignes à 0 % de TVA dans l'export
    // Factur-X — franchise en base par défaut (cas le plus fréquent).
    vatExemptionReason: "franchise",
    items: [emptyLine()],
    globalDiscount: 0,
    acompte: 0,
    notes: "Merci de votre confiance.",
    signature: { mode: "texte", name: "", image: null, drawing: null },
    proforma: type === "proforma" ? emptyProforma() : null,
    status: "brouillon",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  // Facture récurrente : pour un contrat d'entretien/maintenance, se
  // reproduit automatiquement à intervalle régulier (voir la tâche
  // planifiée process-recurring-invoices), jusqu'à une date de fin
  // optionnelle — jamais activée par défaut, un vrai choix explicite.
  if (type === "facture") {
    // acompteVerse : acompte déjà réglé par un autre moyen, en montant TTC,
    // déduit du total (vide par défaut, toujours confirmé par l'artisan).
    return { ...base, acompteVerse: "", isRecurring: false, recurrenceInterval: "mensuel", recurrenceEndDate: "", nextRecurrenceDate: "", remindersEnabled: true };
  }
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

// Totaux d'un document à lignes de prix. La remise globale (en %) est
// appliquée sur le total HT des lignes ; la TVA est calculée sur le
// total HT après remise. Sans remise, subtotalHTBrut === subtotalHT.
function computeTotals(doc) {
  const lineItems = (doc.items || []).filter((i) => i.type === "line");
  const globalDiscountPct = Math.min(100, Math.max(0, Number(doc.globalDiscount) || 0));
  const computedLines = lineItems.map((l) => {
    const base = lineBaseHT(l);
    const afterLine = base * (1 - (Number(l.discount) || 0) / 100);
    const afterGlobal = afterLine * (1 - globalDiscountPct / 100);
    return { ...l, totalHTBrut: afterLine, totalHT: afterGlobal };
  });
  const subtotalHTBrut = computedLines.reduce((s, l) => s + l.totalHTBrut, 0);
  const subtotalHT = computedLines.reduce((s, l) => s + l.totalHT, 0);
  const globalDiscountAmount = subtotalHTBrut - subtotalHT;
  const tvaGroups = {};
  computedLines.forEach((l) => {
    const rate = Number(l.tva) || 0;
    const lineTVA = (l.totalHT * rate) / 100;
    tvaGroups[rate] = (tvaGroups[rate] || 0) + lineTVA;
  });
  const totalTVA = Object.values(tvaGroups).reduce((a, b) => a + b, 0);
  const totalTTC = subtotalHT + totalTVA;
  // Devis (et autres) : acompte DEMANDÉ en % du TTC, avec le reste à payer.
  const acompteAmount = totalTTC * ((Number(doc.acompte) || 0) / 100);
  const resteAPayer = totalTTC - acompteAmount;
  // Factures uniquement : acompte DÉJÀ VERSÉ, en montant TTC, déduit du
  // total pour obtenir le montant TTC à régler (jamais négatif).
  const acompteVerse = doc.type === "facture" ? Math.max(0, Number(doc.acompteVerse) || 0) : 0;
  const montantARegler = Math.max(0, totalTTC - acompteVerse);
  return { computedLines, subtotalHTBrut, globalDiscountPct, globalDiscountAmount, subtotalHT, tvaGroups, totalTVA, totalTTC, acompteAmount, resteAPayer, acompteVerse, montantARegler };
}

const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
    html, body, #root { height: 100%; }
    .df-root { font-family: 'Inter', sans-serif; background-image: var(--df-bg-pattern, none); min-height: 100%; }
    button, [role="button"], a, .df-select, select, summary { cursor: pointer; }
    .df-display { font-family: 'Space Grotesk', sans-serif; }
    .df-mono { font-family: 'IBM Plex Mono', monospace; }
    .df-input:focus, .df-select:focus, .df-textarea:focus { outline: none; border-color: ${colors.brass} !important; box-shadow: 0 0 0 3px rgba(184,118,62,0.15); }
    /* Décale tout le contenu à droite quand une barre latérale (version
       avancée) est présente — uniquement à partir de la largeur où
       elle s'affiche réellement (voir lg:flex sur .df-sidebar-nav),
       jamais sur les pages sans navigation (accueil, connexion). */
    @media (min-width: 1024px) {
      .df-root:has(> .df-sidebar-nav) { padding-left: 272px; }
    }
    /* Mode sombre — un réglage personnel (mémorisé sur cet appareil),
       indépendant du thème de couleurs choisi par l'administrateur du
       site : couleurs douces (jamais noir pur), appliquées le plus
       largement possible — y compris aux champs de saisie, qui
       gardent sinon un fond blanc imposé par le navigateur. */
    body.df-dark {
      --df-ink: #E8EAED;
      --df-ink-soft: #9AA5B5;
      --df-paper: #1B212C;
      --df-surface: #262D3A;
      --df-line: #3A4353;
    }
    body.df-dark img { opacity: 0.92; }
    body.df-dark input, body.df-dark select, body.df-dark textarea {
      background: var(--df-surface) !important;
      color: var(--df-ink) !important;
      border-color: var(--df-line) !important;
    }
    body.df-dark input::placeholder, body.df-dark textarea::placeholder { color: var(--df-ink-soft); opacity: 1; }
    body.df-dark input[type="checkbox"], body.df-dark input[type="radio"] { background: transparent !important; }
    /* Version "Atelier" : palette fixe appliquée à tout le site connecté
       (pages partagées et éditeurs compris) en redéfinissant les
       variables de couleur — priorité sur le thème admin, qui est posé
       sur <html>. Le bloc sombre est après pour gagner en cascade. */
    body.df-atelier {
      --df-ink: #1C2733;
      --df-ink-soft: #5A6B78;
      --df-paper: #F4F6F8;
      --df-surface: #FFFFFF;
      --df-brass: #1F5FA8;
      --df-brass-dark: #174A85;
      --df-slate: #3D5468;
      --df-moss: #2E7D4F;
      --df-brick: #C0392B;
      --df-line: #D8DEE4;
      --df-bg-pattern: none;
    }
    body.df-atelier.df-dark {
      --df-ink: #E6EBF0;
      --df-ink-soft: #9AA7B4;
      --df-paper: #151B22;
      --df-surface: #1E262F;
      --df-brass: #5B9BE6;
      --df-brass-dark: #3E7FCB;
      --df-slate: #8FA3B8;
      --df-moss: #4CAF77;
      --df-brick: #E06356;
      --df-line: #2E3944;
    }
    body.df-atelier .df-at-tap { min-height: 44px; }
    body.df-atelier .df-at-bottom-pad { padding-bottom: calc(76px + env(safe-area-inset-bottom, 0px)); }
    @media (min-width: 768px) { body.df-atelier .df-at-bottom-pad { padding-bottom: 0; } }
    @keyframes df-marquee {
      0% { transform: translateX(-100vw); opacity: 0; }
      8% { opacity: 1; }
      92% { opacity: 1; }
      100% { transform: translateX(100vw); opacity: 0; }
    }
    .df-marquee-text { display: inline-block; white-space: nowrap; animation: df-marquee 11s linear infinite; }
    .print-doc { display: none; }
    /* Mode présentation : le document seul, en plein écran (tablette
       posée devant le client) — on réutilise le rendu PDF classique. */
    .df-presentation { position: fixed; inset: 0; z-index: 1000; overflow: auto; -webkit-overflow-scrolling: touch; }
    .df-presentation .print-doc { display: block; margin: 0 auto; box-shadow: 0 8px 30px rgba(0,0,0,0.18); }
    @media print {
      @page { size: A4; margin: 0; }
      html, body { background: white !important; }
      .no-print, .editor-form { display: none !important; }
      .print-doc { display: block !important; box-sizing: border-box; }
      .print-doc * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `}</style>
);

// Lien public d'un document (signature ou paiement en ligne, sans
// compte) et QR code correspondant, généré localement (aucun service
// externe) pour être imprimé sur le PDF classique.
function publicDocumentUrl(token) {
  return `${window.location.origin}${window.location.pathname}?voir-document=${token}`;
}
const PUBLIC_QR_OPTIONS = { margin: 0, width: 300, errorCorrectionLevel: "M", color: { dark: "#1B2A33", light: "#FFFFFF" } };

const PrintDocument = forwardRef(function PrintDocument({ doc, totals, accountPlan, siteSettings, watermarkEnabled = true, publicQr = null }, ref) {
  const { subtotalHT, tvaGroups, totalTVA, totalTTC, acompteAmount, resteAPayer } = totals;
  const hasGlobalDiscount = (totals.globalDiscountPct || 0) > 0 && (totals.globalDiscountAmount || 0) > 0;
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
  const watermarkText = (siteSettings?.name || "Chantiflow").toUpperCase();
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
          {(doc.type === "facture" || doc.showValidity !== false) && (
            <div style={{ fontSize: "9.5pt", color: inkSoft }}>{doc.type !== "facture" ? `Valable jusqu'au ${frLong(validityDate)}` : `Échéance : ${frLong(dueDate)}`}</div>
          )}
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
          {(doc.company.postalCode || doc.company.city) && <div>{[doc.company.postalCode, doc.company.city].filter(Boolean).join(" ")}</div>}
          {doc.company.phone && <div>Téléphone : {doc.company.phone}</div>}
          {doc.company.email && <div>Mail : {doc.company.email}</div>}
          {doc.company.type !== "particulier" && doc.company.siret && <div>SIRET : {doc.company.siret}</div>}
          {doc.company.type !== "particulier" && doc.company.tva && <div>N° TVA : {doc.company.tva}</div>}
        </div>
        <div style={{ flex: 1, background: box, borderRadius: "4px", padding: "10px 14px" }}>
          {doc.client.name && <div style={{ fontWeight: 600 }}>{doc.client.name}</div>}
          {doc.client.address && <div>{doc.client.address}</div>}
          {(doc.client.postalCode || doc.client.city) && <div>{[doc.client.postalCode, doc.client.city].filter(Boolean).join(" ")}</div>}
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
            const lineHT = lineBaseHT(it) * (1 - (Number(it.discount) || 0) / 100) * (1 - (Number(doc.globalDiscount) || 0) / 100);
            const lineTVA = (lineHT * (Number(it.tva) || 0)) / 100;
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
                {!hidePrices && (
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

      {/* Conditions + Totaux */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: "24px", marginTop: "18px", pageBreakInside: "avoid", position: "relative", zIndex: 1 }}>
        <div style={{ flex: 1, fontSize: "9pt" }}>
          {doc.notes && (
            <>
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Note :</div>
              <div style={{ color: inkSoft, whiteSpace: "pre-wrap" }}>{renderMarkup(doc.notes)}</div>
            </>
          )}
          {doc.type !== "facture" && Number(doc.acompte) > 0 && (
            <div style={{ marginTop: "6px" }}>Acompte de {doc.acompte}% à la commande : <strong style={mono}>{formatMoney(acompteAmount, doc.currency)}</strong></div>
          )}
        </div>

        {!hidePrices && (
          <div style={{ width: "230px", fontSize: "10pt" }}>
            {/* Remise globale : Total HT, remise, total HT après remise ;
                sans remise, seule la ligne Total HT apparaît. */}
            {hasGlobalDiscount && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", border: `1px solid ${line}`, padding: "6px 10px" }}>
                  <span>Total HT</span><span style={mono}>{formatMoney(totals.subtotalHTBrut, doc.currency)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", border: `1px solid ${line}`, borderTop: "none", padding: "6px 10px", color: brassDark }}>
                  <span>Remise ({totals.globalDiscountPct} %)</span><span style={mono}>- {formatMoney(totals.globalDiscountAmount, doc.currency)}</span>
                </div>
              </>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", background: ink, color: "white", padding: "7px 10px", fontWeight: 700 }}>
              <span>{hasGlobalDiscount ? "Total HT après remise" : "Total HT"}</span><span style={mono}>{formatMoney(subtotalHT, doc.currency)}</span>
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
              <span>{doc.type === "bpu" ? "Montant total estimatif" : "Total TTC"}</span><span style={mono}>{formatMoney(totalTTC, doc.currency)}</span>
            </div>
            {doc.type !== "facture" && Number(doc.acompte) > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", fontWeight: 700, color: brassDark }}>
                <span>Reste à payer</span><span style={mono}>{formatMoney(resteAPayer, doc.currency)}</span>
              </div>
            )}
            {/* Facture : acompte déjà versé déduit du total, montant TTC à régler */}
            {doc.type === "facture" && (totals.acompteVerse || 0) > 0 && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", border: `1px solid ${line}`, borderTop: "none", padding: "6px 10px", color: inkSoft }}>
                  <span>Acompte déjà versé</span><span style={mono}>- {formatMoney(totals.acompteVerse, doc.currency)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", fontWeight: 700, fontSize: "11.5pt", color: brassDark, border: `1px solid ${brassDark}` }}>
                  <span>Montant TTC à régler</span><span style={mono}>{formatMoney(totals.montantARegler, doc.currency)}</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* QR code du lien public — bas à gauche (devis/factures uniquement)
          — et signature — bas à droite, uniquement si une signature existe */}
      {(publicQr?.dataUrl ||
        (doc.signature?.mode === "texte" && doc.signature?.name) ||
        (doc.signature?.mode === "dessin" && doc.signature?.drawing) ||
        (doc.signature?.mode === "image" && doc.signature?.image)) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "20px", pageBreakInside: "avoid", position: "relative", zIndex: 1 }}>
          <div>
            {publicQr?.dataUrl && (
              <div style={{ width: "2cm" }}>
                <img src={publicQr.dataUrl} alt="QR code" style={{ width: "2cm", height: "2cm", display: "block" }} />
                <div style={{ fontSize: "6.5pt", color: inkSoft, marginTop: "3px", lineHeight: 1.2, textAlign: "center" }}>
                  {doc.type === "facture" ? "Scannez pour payer en ligne" : "Scannez pour signer en ligne"}
                </div>
              </div>
            )}
          </div>
          {((doc.signature?.mode === "texte" && doc.signature?.name) ||
            (doc.signature?.mode === "dessin" && doc.signature?.drawing) ||
            (doc.signature?.mode === "image" && doc.signature?.image)) && (
          <div style={{ width: "230px", border: `1px solid ${line}`, borderRadius: "4px", padding: "10px 14px", minHeight: "70px" }}>
            {doc.signature?.mode === "texte" && doc.signature?.name && (
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "14pt", fontStyle: "italic" }}>{doc.signature.name}</div>
            )}
            {/* Second signataire (signature en ligne à deux noms) */}
            {doc.signature?.mode === "texte" && doc.signature?.name && doc.signature?.secondName && (
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "14pt", fontStyle: "italic", marginTop: "4px" }}>{doc.signature.secondName}</div>
            )}
            {doc.signature?.mode === "dessin" && doc.signature?.drawing && (
              <img src={doc.signature.drawing} alt="Signature" style={{ height: "60px" }} />
            )}
            {doc.signature?.mode === "image" && doc.signature?.image && (
              <img src={doc.signature.image} alt="Signature" style={{ height: "60px", objectFit: "contain" }} />
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
});

function DeviFactAppInner() {
  // Repère de diagnostic temporaire : affiche dans la console (F12)
  // l'heure exacte à laquelle l'application démarre. Si cette ligne
  // réapparaît avec une NOUVELLE heure après être revenu sur l'onglet,
  // ça prouve qu'un vrai rechargement de page a eu lieu. Si elle ne
  // réapparaît pas, la page n'a pas rechargé — la cause est ailleurs.
  useEffect(() => {
    console.log(`%c🔵 Chantiflow démarré à ${new Date().toLocaleTimeString("fr-FR")}`, "background:#1B2A33;color:white;padding:4px 8px;border-radius:4px;font-weight:bold;");
    // Pays et devise de départ (voir detectGeoCountry) — silencieux.
    detectGeoCountry();
  }, []);

  const [view, setView] = useState(() => {
    if (typeof window === "undefined") return "dashboard";
    // Priorité absolue : si on revient d'un paiement Stripe, toujours
    // atterrir sur la page Tarifs (pour voir la confirmation), même si
    // une autre page était mémorisée avant de partir payer.
    if (new URLSearchParams(window.location.search).get("paiement")) return "pricing";
    const restored = localStorage.getItem("devifact_lastView") || "dashboard";
    console.log("[Position] Vue restaurée au chargement :", restored);
    return restored;
  });
  const [documents, setDocuments] = useState([]);
  // Toujours la liste la plus récente, y compris depuis une fonction
  // appelée en différé (enregistrement automatique des éditeurs, 400ms
  // après la frappe) — sans ça, une telle fonction repartait d'une
  // liste périmée et pouvait écraser un document créé entre-temps
  // (facture convertie, lignes extraites, "Terminé" cliqué...).
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const [clients, setClients] = useState([]);
  const [prestations, setPrestations] = useState([]);
  const [companyProfile, setCompanyProfile] = useState(emptyCompanyProfile());
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  // Empêche d'afficher la page d'accueil (ou toute page) avec la
  // version par défaut ("classique") pendant la fraction de seconde où
  // le vrai réglage n'est pas encore arrivé de la base de données —
  // sans ça, un "flash" de la mauvaise version apparaît brièvement à
  // chaque rechargement, avant de basculer sur la bonne.
  const [siteSettingsLoaded, setSiteSettingsLoaded] = useState(false);
  // Vrai uniquement quand les documents affichés proviennent du cache
  // local (vraie coupure réseau au chargement, pas juste une brève
  // fluctuation) — sert à afficher un bandeau clair et à bloquer toute
  // modification tant que la vraie connexion n'est pas revenue.
  const [offlineMode, setOfflineMode] = useState(false);
  // Mode sombre — réglage personnel, mémorisé sur cet appareil (pas en
  // base de données, contrairement au thème choisi par l'Admin).
  const [darkMode, setDarkMode] = useState(() => (typeof window !== "undefined" && localStorage.getItem("devifact_dark_mode") === "1"));
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("df-dark", darkMode);
    localStorage.setItem("devifact_dark_mode", darkMode ? "1" : "0");
  }, [darkMode]);
  // Notification après qu'une facture a été créée automatiquement à
  // partir d'un devis passé au statut "signé" — jamais de navigation
  // forcée surprise, juste un message clair avec un lien pour l'ouvrir
  // si la personne le souhaite.
  const [autoFactureNotice, setAutoFactureNotice] = useState(null);
  // Proposition d'envoyer une demande d'avis Google au client, quand
  // une facture vient de passer à "payée" — uniquement si le lien
  // d'avis est renseigné dans Mon entreprise et que le client a un
  // email. Jamais envoyé sans un clic explicite.
  const [reviewNotice, setReviewNotice] = useState(null);
  async function sendReviewRequest() {
    if (!reviewNotice || reviewNotice.sending || reviewNotice.sent) return;
    setReviewNotice((n) => ({ ...n, sending: true, error: null }));
    try {
      const { data: { session } } = await db.auth.getSession();
      const { data, error } = await db.functions.invoke("send-review-request", {
        body: { organizationId: account?.organizationId, documentId: reviewNotice.docId },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || data?.error) {
        let detail = data;
        if (!detail && error?.context) { try { detail = await error.context.json(); } catch { /* corps illisible */ } }
        throw new Error(detail?.error || error?.message || "Impossible d'envoyer la demande d'avis pour l'instant.");
      }
      setReviewNotice((n) => ({ ...n, sending: false, sent: true }));
    } catch (err) {
      setReviewNotice((n) => ({ ...n, sending: false, error: err.message || "Impossible d'envoyer la demande d'avis pour l'instant." }));
    }
  }
  // Palette de commandes (Ctrl+K / Cmd+K) — accessible depuis n'importe
  // quelle page une fois connecté.
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingClients, setSavingClients] = useState(false);
  const [savingPrestations, setSavingPrestations] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  const [activeId, setActiveId] = useState(() => (typeof window !== "undefined" && localStorage.getItem("devifact_lastActiveId")) || null);
  // Document tout juste ouvert ("Nouveau devis" etc.) mais jamais
  // encore réellement enregistré — reste ici, en mémoire seulement,
  // tant qu'il est vide. Dès qu'il contient un vrai contenu, il
  // rejoint la vraie liste "documents" (voir updateDoc) et devient un
  // brouillon normal. S'il reste vide et que la personne s'en va,
  // il disparaît simplement, sans avoir jamais été enregistré nulle part.
  const [pendingDoc, setPendingDoc] = useState(null);
  // Garde en mémoire l'identifiant de la personne dont les données sont
  // actuellement chargées — permet de savoir, dans le gestionnaire de
  // connexion, si un événement concerne vraiment un changement de
  // compte ou juste une revalidation de la même session.
  const currentUserIdRef = useRef(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("tous");
  const [stageFilter, setStageFilter] = useState("tous"); // tous | brouillon | termine
  const [revisionCountry, setRevisionCountry] = useState("🇫🇷 FR");
  const [limitNotice, setLimitNotice] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [batchExportDoc, setBatchExportDoc] = useState(null);
  const [batchExporting, setBatchExporting] = useState(false);
  const batchPrintRef = useRef(null);
  const [splitNotice, setSplitNotice] = useState(null);
  const [savingPlanSettings, setSavingPlanSettings] = useState(false);
  const [preAuthView, setPreAuthView] = useState("landing"); // landing | auth
  const [siteSettings, setSiteSettings] = useState({ name: "Chantiflow", logo: null, logoWidth: 36, logoHeight: 36, pdfBackground: "#FBF7EF", pdfHeaderColor: "#1B2A33", pdfBlockColor: "#F1F0EA", contactEmail: "contact@chantiflow.fr", theme: "classique" });
  // IMPORTANT : ce calcul doit impérativement rester ICI — après TOUS
  // les useState dont il dépend (notamment siteSettings, juste
  // au-dessus), mais avant tout "return" conditionnel plus bas (écran
  // de chargement, page de connexion...). Un Hook React (useMemo) ne
  // doit JAMAIS être sauté sur certains rendus et exécuté sur
  // d'autres, ni lire une variable avant sa propre déclaration — les
  // deux erreurs ont déjà été rencontrées ici, corrigées l'une après
  // l'autre : ne plus jamais déplacer ce bloc sans revérifier les deux.
  const visibleServices = siteSettings?.visibleServices || SERVICES.filter((s) => s.implemented).map((s) => s.id);
  const paletteCommands = useMemo(() => {
    const cmds = [
      { id: "nav-dashboard", label: "Aller au Tableau de bord", icon: LayoutDashboard, action: () => setView("dashboard") },
      { id: "nav-chantiers", label: "Aller à Chantiers", icon: MapPinned, action: () => setView("chantiers") },
      { id: "nav-planning-equipe", label: "Aller au Planning d'équipe", icon: Calendar, action: () => setView("planning-equipe") },
      { id: "nav-clients", label: "Aller à Clients", icon: Users, action: () => setView("clients") },
      { id: "nav-prestations", label: "Aller à Bibliothèque", icon: Library, action: () => setView("prestations") },
      { id: "nav-company", label: "Aller à Mon entreprise", icon: Building2, action: () => setView("company") },
      { id: "nav-team", label: "Aller à Équipe", icon: UserPlus, action: () => setView("team") },
      { id: "nav-account", label: "Aller à Mon compte", icon: UserCircle, action: () => setView("account") },
      { id: "nav-pricing", label: "Aller à Abonnement", icon: CreditCard, action: () => setView("pricing") },
      { id: "nav-contact", label: "Nous contacter", icon: Mail, action: () => setView("contact") },
      ...(account?.isAdmin ? [{ id: "nav-admin", label: "Aller à Admin", icon: Shield, action: () => setView("admin") }] : []),
    ];
    SERVICES.filter((s) => visibleServices.includes(s.id) && s.implemented).forEach((s) => {
      cmds.push({ id: `new-${s.id}`, label: `Nouveau : ${s.label}`, icon: s.icon, hint: "Créer", keywords: s.description, action: () => openNewService(s.id) });
    });
    return cmds;
  }, [account, visibleServices]);
  const [savingSiteSettings, setSavingSiteSettings] = useState(false);
  const [authMode, setAuthMode] = useState("signup");
  // Le titre affiché dans l'onglet du navigateur vient du fichier
  // index.html (figé une fois pour toutes) — on le remplace ici
  // dynamiquement dès que le vrai nom du site est chargé, pour qu'il
  // reste toujours synchronisé avec ce qui est configuré dans Admin.
  useEffect(() => {
    if (siteSettings?.name) document.title = siteSettings.name;
  }, [siteSettings?.name]);
  // Applique le thème choisi dans Admin → Apparence du site — à
  // chaque changement, et dès le chargement initial (thème "classique"
  // par défaut tant que les vrais paramètres n'ont pas encore chargé).
  useEffect(() => {
    applyTheme(siteSettings?.theme || "classique");
  }, [siteSettings?.theme]);
  // Version "Atelier" : classe sur le corps de page qui porte sa palette
  // fixe (voir GlobalStyle) — sans effet sur les versions classique et
  // avancée, qui n'ont pas cette classe.
  const isAtelier = siteSettings?.landingPageVersion === "atelier";
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("df-atelier", isAtelier);
  }, [isAtelier]);
  const [atelierCreateOpen, setAtelierCreateOpen] = useState(false);
  // Filtre pré-appliqué à la page Documents Atelier (carte « À faire »).
  const [atelierDocsPreset, setAtelierDocsPreset] = useState(null);
  // Fiche chantier ouverte (nom du chantier) et chantier à pré-remplir
  // sur le prochain document créé depuis le panneau « Créer ».
  const [atelierChantier, setAtelierChantier] = useState(null);
  const [atelierCreateChantier, setAtelierCreateChantier] = useState(null);

  const [plans, setPlans] = useState(PLANS);

  async function loadProfile(userId, email, preferredOrgId = null) {
    const { data: profile } = await db.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (!profile) return null;

    let { data: memberships } = await db
      .from("organization_members")
      .select("role, organization_id, organizations ( id, name, plan, billing_cycle, payment_status, activated_via_free_button, expires_at, subscription_cancelled, stripe_subscription_id, paypal_subscription_id )")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    // Auto-réparation : un compte sans AUCUNE organisation est un état
    // cassé (ne devrait jamais arriver, mais un souci passager à
    // l'inscription — ou une ancienne remise à zéro de la base — a pu
    // en laisser certains dans cet état). ensure_user_has_organization
    // garantit qu'aucun doublon n'est jamais créé, même en cas
    // d'appels simultanés (verrou côté base de données — voir
    // migration_organisation_atomique.sql), contrairement à l'ancienne
    // vérification côté site qui pouvait encore, dans de rares cas,
    // laisser passer deux créations presque simultanées.
    if (!memberships || memberships.length === 0) {
      console.warn("Compte sans organisation détecté — réparation automatique.");
      const { error: ensureError } = await db.rpc("ensure_user_has_organization", {
        target_user_id: userId,
        fallback_name: profile.company_name || email,
      });
      if (ensureError) {
        console.error("Échec de la réparation automatique", ensureError);
      } else {
        const { data: retried } = await db
          .from("organization_members")
          .select("role, organization_id, organizations ( id, name, plan, billing_cycle, payment_status, activated_via_free_button, expires_at, subscription_cancelled, stripe_subscription_id, paypal_subscription_id )")
          .eq("user_id", userId)
          .eq("status", "active")
          .order("created_at", { ascending: true });
        memberships = retried;
        console.warn("Espace de secours prêt.");
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

    // Si ce compte a activé via le bouton "Activer (0€)" (pas un vrai
    // paiement) et que le prix de ce forfait n'est plus à 0€
    // aujourd'hui, il doit régulariser — sauf s'il a depuis vraiment
    // payé (Stripe/PayPal mettent alors activated_via_free_button à
    // false). Requête ciblée et fraîche plutôt que de dépendre de
    // l'état "plans" déjà chargé en mémoire, qui pourrait ne pas
    // encore l'être à ce moment précis.
    let needsRegularization = false;
    if (org?.activated_via_free_button && org?.plan && org.plan !== "gratuit") {
      const { data: currentPlanRow } = await db.from("plans").select("monthly_price, annual_price").eq("id", org.plan).maybeSingle();
      const currentPrice = org.billing_cycle === "annuel" ? currentPlanRow?.annual_price : currentPlanRow?.monthly_price;
      if (currentPrice && Number(currentPrice) > 0) needsRegularization = true;
    }

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
      needsRegularization,
      subscriptionCancelled: org?.subscription_cancelled || false,
      expiresAt: org?.expires_at || null,
      hasStripeOrPaypal: !!(org?.stripe_subscription_id || org?.paypal_subscription_id),
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
    // Récupère, pour chaque utilisateur, l'organisation dont il est
    // propriétaire (celle qui porte son forfait) — requête séparée
    // plutôt qu'une jointure complexe, plus simple à maintenir.
    const { data: ownedOrgs, error: orgsError } = await db
      .from("organization_members")
      .select("user_id, organizations ( id, plan, payment_status, paid_at, expires_at )")
      .eq("role", "owner")
      .eq("status", "active");
    if (orgsError) console.error("Erreur de chargement des forfaits utilisateurs", orgsError);
    const orgByUser = {};
    (ownedOrgs || []).forEach((row) => { orgByUser[row.user_id] = row.organizations; });

    setAllUsersError("");
    setAllUsers((data || []).map((u) => ({
      ...u,
      organizationId: orgByUser[u.id]?.id || null,
      plan: orgByUser[u.id]?.plan || "gratuit",
      paymentStatus: orgByUser[u.id]?.payment_status || "gratuit",
      paidAt: orgByUser[u.id]?.paid_at || null,
      expiresAt: orgByUser[u.id]?.expires_at || null,
    })));
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

  // Gestion manuelle du forfait d'un utilisateur par l'Admin — pour
  // offrir un forfait à un proche, ou corriger une situation. Modifie
  // directement l'organisation dont cette personne est propriétaire.
  const [savingUserPlanId, setSavingUserPlanId] = useState(null);
  async function adminUpdateUserOrg(organizationId, patch) {
    if (!organizationId) { alert("Cette personne n'a pas d'organisation à modifier."); return; }
    setSavingUserPlanId(organizationId);
    const { error } = await db.from("organizations").update(patch).eq("id", organizationId);
    if (error) {
      console.error("Erreur de mise à jour du forfait par l'admin", error);
      alert(`Impossible de mettre à jour : ${error.message || "erreur inconnue"}`);
    } else {
      await loadAllUsers();
    }
    setSavingUserPlanId(null);
  }
  async function adminSetUserPlan(organizationId, planId) {
    // En changeant le forfait manuellement, on marque aussi le
    // paiement comme actif (sinon le forfait ne donnerait accès à
    // rien, voir hasAccess) — sauf en repassant à "gratuit".
    await adminUpdateUserOrg(organizationId, {
      plan: planId,
      payment_status: planId === "gratuit" ? "gratuit" : "payé",
      paid_at: planId === "gratuit" ? null : new Date().toISOString(),
    });
  }
  async function adminSetUserPaidAt(organizationId, dateStr) {
    await adminUpdateUserOrg(organizationId, { paid_at: dateStr ? new Date(dateStr).toISOString() : null });
  }
  async function adminSetUserExpiresAt(organizationId, dateStr) {
    await adminUpdateUserOrg(organizationId, { expires_at: dateStr ? new Date(dateStr).toISOString() : null });
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
      name: data.name || "Chantiflow", logo: data.logo_url || null, logoWidth: data.logo_width || 36, logoHeight: data.logo_height || 36,
      pdfBackground: data.pdf_background || "#FBF7EF",
      pdfHeaderColor: data.pdf_header_color || "#1B2A33",
      pdfBlockColor: data.pdf_block_color || "#F1F0EA",
      visibleServices: data.visible_services || null,
      contactEmail: data.contact_email || "contact@chantiflow.fr",
      theme: data.theme || "classique",
      desktopAppUrlWindows: data.desktop_app_url_windows || "",
      desktopAppUrlMac: data.desktop_app_url_mac || "",
      desktopAppEnabled: data.desktop_app_enabled || false,
      contactInstagramUrl: data.contact_instagram_url || "",
      landingPageVersion: data.landing_page_version || "classique",
    });
  }
  async function updateSiteSettings(patch) {
    setSavingSiteSettings(true);
    const column = { name: "name", logo: "logo_url", logoWidth: "logo_width", logoHeight: "logo_height", pdfBackground: "pdf_background", pdfHeaderColor: "pdf_header_color", pdfBlockColor: "pdf_block_color", visibleServices: "visible_services", contactEmail: "contact_email", theme: "theme", desktopAppUrlWindows: "desktop_app_url_windows", desktopAppUrlMac: "desktop_app_url_mac", desktopAppEnabled: "desktop_app_enabled", contactInstagramUrl: "contact_instagram_url", landingPageVersion: "landing_page_version" };
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
    // Si la connexion a échoué pour TOUT (documents ET clients à la
    // fois — le signe le plus fiable d'un vrai problème réseau, plutôt
    // qu'une simple clé absente pour un compte tout neuf), retombe sur
    // la dernière copie connue, gardée localement — jamais un écran
    // vide qui donnerait l'impression que les données ont disparu.
    // Toujours en LECTURE SEULE : rien de nouveau ne peut être créé ou
    // modifié tant que la vraie connexion n'est pas revenue, pour ne
    // jamais risquer de perdre un changement fait hors ligne.
    // Une clé simplement absente (compte tout neuf qui n'a encore rien
    // enregistré) n'est PAS une panne réseau — sans cette distinction,
    // un compte vide passait en "mode hors ligne" (et se retrouvait
    // verrouillé) dès son deuxième chargement.
    const realFailure = (r) => r.status === "rejected" && r.reason?.code !== "KEY_NOT_FOUND";
    const bothFailed = realFailure(docsRes) && realFailure(clientsRes);
    const orgId = getActiveOrganization();
    if (bothFailed && orgId) {
      try {
        const cached = localStorage.getItem(`devifact_offline_cache_${orgId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          setDocuments(parsed.documents || []);
          setClients(parsed.clients || []);
          setCompanyProfile(parsed.companyProfile || emptyCompanyProfile());
          setPrestations(parsed.prestations || []);
          setOfflineMode(true);
          return;
        }
      } catch (err) {
        console.error("Erreur de lecture du cache hors ligne", err);
      }
    }
    setOfflineMode(false);
    const docs = docsRes.status === "fulfilled" && docsRes.value ? JSON.parse(docsRes.value.value) : [];
    const cls = clientsRes.status === "fulfilled" && clientsRes.value ? JSON.parse(clientsRes.value.value) : [];
    const comp = companyRes.status === "fulfilled" && companyRes.value ? JSON.parse(companyRes.value.value) : emptyCompanyProfile();
    const prest = prestationsRes.status === "fulfilled" && prestationsRes.value ? JSON.parse(prestationsRes.value.value) : [];
    setDocuments(docs);
    setClients(cls);
    setCompanyProfile(comp);
    setPrestations(prest);
    // Garde une copie locale à jour à chaque chargement réussi — c'est
    // cette copie qui sera utilisée si la connexion vient à manquer la
    // prochaine fois.
    if (orgId) {
      try {
        localStorage.setItem(`devifact_offline_cache_${orgId}`, JSON.stringify({ documents: docs, clients: cls, companyProfile: comp, prestations: prest, savedAt: Date.now() }));
      } catch (err) {
        // Le stockage local peut être plein ou désactivé (navigation
        // privée) — jamais bloquant, juste pas de filet de secours
        // disponible dans ce cas précis.
        console.error("Erreur d'enregistrement du cache hors ligne", err);
      }
    }
  }
  function clearUserData() {
    // Vide toutes les données en mémoire — indispensable à la déconnexion
    // pour qu'aucune trace du compte précédent ne reste visible au suivant.
    setDocuments([]);
    setClients([]);
    setCompanyProfile(emptyCompanyProfile());
    setPrestations([]);
    setActiveId(null);
    setOfflineMode(false);
    // Efface aussi la position mémorisée (vue + document actif) et la
    // copie hors ligne : sans ça, un autre compte se connectant dans le
    // même onglet (appareil partagé) pourrait retrouver les documents
    // du compte précédent via le cache hors ligne.
    if (typeof window !== "undefined") {
      localStorage.removeItem("devifact_lastView");
      localStorage.removeItem("devifact_lastActiveId");
      const orgId = getActiveOrganization();
      if (orgId) localStorage.removeItem(`devifact_offline_cache_${orgId}`);
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
      try {
        await Promise.all([loadPlans(), loadSiteSettings()]);
      } finally {
        // Toujours levé, même si une erreur imprévue survient — pour
        // ne jamais bloquer indéfiniment l'affichage du site.
        setSiteSettingsLoaded(true);
      }
    })();

    // Vérification directe et explicite de la session, dès le
    // démarrage — la source la plus fiable qui soit, plutôt que de
    // dépendre du tout premier événement envoyé par l'écouteur
    // ci-dessous. Sans ça, si cet événement arrive une première fois
    // avec une session encore vide (avant que la vraie session
    // enregistrée ait fini d'être relue en arrière-plan), le site
    // affiche à tort la page d'accueil pendant un instant, avant de
    // finalement revenir sur le compte connecté une fois la vraie
    // information arrivée — exactement l'effet de "flash" à éviter.
    (async () => {
      try {
        const { data: { session } } = await db.auth.getSession();
        if (session?.user) {
          currentUserIdRef.current = session.user.id;
          const profile = await loadProfile(session.user.id, session.user.email);
          setActiveOrganization(profile?.organizationId || null);
          await loadUserData();
          setAccount(profile);
        } else {
          setAccount(null);
        }
      } catch (err) {
        console.error("Erreur lors de la vérification initiale de la session :", err);
        setAccount(null);
      } finally {
        setLoading(false);
      }
    })();

    // Seule source de vérité pour les données propres à l'utilisateur :
    // se déclenche à l'ouverture (avec la session actuelle, s'il y en a
    // une), à chaque connexion/inscription, et à chaque déconnexion —
    // qu'il s'agisse du même utilisateur ou d'un utilisateur différent.
    const { data: authListener } = db.auth.onAuthStateChange(async (_event, session) => {
      // "INITIAL_SESSION" est déjà géré ci-dessus, de façon plus fiable
      // (vérification directe, pas dépendante de l'ordre d'arrivée des
      // événements) — ne le retraite jamais ici, pour ne jamais annuler
      // par erreur ce qui vient d'être établi juste au-dessus.
      if (_event === "INITIAL_SESSION") return;
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
          setLoading(true);
          clearUserData();
          const profile = await loadProfile(session.user.id, session.user.email);
          setActiveOrganization(profile?.organizationId || null);
          await loadUserData();
          setAccount(profile);
        } else {
          // Ne traite "pas de session" comme vraiment définitif que pour
          // une vraie déconnexion explicite — la vérification initiale
          // (ci-dessus) s'est déjà chargée du cas du premier chargement.
          if (_event === "SIGNED_OUT" || !currentUserIdRef.current) {
            currentUserIdRef.current = null;
            clearUserData();
            setAccount(null);
          } else {
            setLoading(false);
            return;
          }
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
    console.log("[Confirmation email] Token détecté dans l'adresse :", token);
    if (!token) return;
    (async () => {
      const { data: ok, error } = await db.rpc("confirm_account", { token });
      console.log("[Confirmation email] Réponse de confirm_account — ok:", ok, "error:", error);
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
    if (view && view !== "dashboard") localStorage.setItem("devifact_lastView", view);
    else localStorage.removeItem("devifact_lastView");
    if (activeId) localStorage.setItem("devifact_lastActiveId", activeId);
    else localStorage.removeItem("devifact_lastActiveId");
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
  const [cancellingSubscription, setCancellingSubscription] = useState(false);
  // Recharge le compte depuis la base — utile juste après un retour de
  // paiement (Stripe/PayPal), pour que "Forfait actuel" apparaisse
  // automatiquement dès que le paiement est confirmé côté serveur,
  // sans que la personne ait à recharger la page elle-même.
  async function refreshAccount() {
    if (!account?.id) return;
    const profile = await loadProfile(account.id, account.email, account.organizationId);
    setAccount(profile);
  }

  async function cancelSubscription() {
    if (!account?.organizationId) return;
    if (!window.confirm("Résilier ton abonnement ? Tu gardes l'accès jusqu'à la fin de la période déjà payée, puis ton compte repassera automatiquement en gratuit.")) return;
    setCancellingSubscription(true);
    try {
      const { data: { session } } = await db.auth.getSession();
      const { data, error: fnError } = await db.functions.invoke("cancel-subscription", {
        body: { organizationId: account.organizationId },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (fnError || data?.error) {
        alert(`Impossible de résilier : ${data?.error || fnError?.message || "erreur inconnue"}`);
        return;
      }
      alert(`Résiliation confirmée. Ton accès reste actif jusqu'au ${fr(data.expiresAt)}.`);
      const profile = await loadProfile(account.id, account.email, account.organizationId);
      setAccount(profile);
    } catch (err) {
      console.error("Erreur de résiliation d'abonnement", err);
      alert("Impossible de résilier pour l'instant. Réessaie, et préviens-nous si ça persiste.");
    } finally {
      setCancellingSubscription(false);
    }
  }

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
    // activated_via_free_button: true — marque explicitement que ce
    // n'est PAS un vrai paiement. Si l'admin fixe un prix réel plus
    // tard pour ce forfait, ce compte devra régulariser (voir
    // needsRegularization plus bas) — contrairement à un compte ayant
    // vraiment payé via Stripe/PayPal, qui ne sera jamais affecté.
    const { data, error } = await db.from("organizations").update({ plan: planId, billing_cycle: billingCycle, payment_status: "payé", activated_via_free_button: true }).eq("id", account.organizationId).select();
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
  const [deletingAccount, setDeletingAccount] = useState(false);
  async function deleteCurrentAccount() {
    if (!account?.organizationId) return;
    setDeletingAccount(true);
    // Supprime les données applicatives de l'organisation. La suppression
    // du compte d'authentification lui-même se fait depuis le dashboard
    // du fournisseur (Authentication → Users), jamais depuis le navigateur.
    const results = await Promise.allSettled([
      window.storage.set("documents", JSON.stringify([]), false),
      window.storage.set("clients", JSON.stringify([]), false),
      window.storage.set("prestations", JSON.stringify([]), false),
      window.storage.set("company-profile", JSON.stringify(emptyCompanyProfile()), false),
      db.from("organizations").update({ plan: "gratuit", payment_status: "gratuit" }).eq("id", account.organizationId),
    ]);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      console.error("Échec partiel de la réinitialisation du compte", failed);
      alert("La réinitialisation n'a pas pu se terminer complètement. Vérifie ce qu'il reste, et réessaie si besoin.");
      setDeletingAccount(false);
      return;
    }
    setDocuments([]); setClients([]); setPrestations([]); setCompanyProfile(emptyCompanyProfile());
    await logout();
  }

  async function persist(next) {
    documentsRef.current = next;
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
    const client = clients.find((c) => c.id === id);
    if (!window.confirm(`Supprimer définitivement le client "${client?.name || ""}" ? Cette action est irréversible.`)) return;
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
    // Fichiers des photos de chantier de tous les documents effacés.
    removeDocumentsPhotoFiles(documents);
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
    doc.workStage = "brouillon";
    // N'enregistre PAS encore ce document — reste seulement en mémoire
    // (pendingDoc) tant qu'il est vide. Il ne rejoint la vraie liste
    // (et n'est réellement écrit en base) que dès sa première vraie
    // saisie, voir updateDoc — sans ça, ouvrir "Nouveau devis" par
    // erreur ou juste pour voir créait un brouillon vide inutile.
    setPendingDoc(doc);
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
    // Abandonne proprement le document "en attente" s'il n'a jamais
    // reçu de vrai contenu — il disparaît simplement, jamais enregistré.
    if (pendingDoc && pendingDoc.id === activeId) setPendingDoc(null);
    setView("dashboard");
    setActiveId(null);
  }
  function updateDoc(id, patch) {
    if (isLocked) return;
    // Liste la plus récente (voir documentsRef) — cette fonction est
    // souvent appelée en différé par les éditeurs.
    const documents = documentsRef.current;
    // Cas normal : le document existe déjà réellement (a déjà eu du
    // contenu à un moment donné) — mise à jour habituelle.
    if (documents.some((d) => d.id === id)) {
      const original = documents.find((d) => d.id === id);
      // Devis qui vient tout juste de passer à "signé" (jamais si déjà
      // signé avant, pour ne pas créer une facture à chaque petite
      // modification ultérieure) : génère automatiquement la facture
      // correspondante, sans naviguer ailleurs ni interrompre ce que la
      // personne était en train de faire — juste une notification.
      if (original && original.type === "devis" && patch.status === "signé" && original.status !== "signé") {
        const updatedOriginal = { ...original, ...patch, updatedAt: Date.now() };
        const invoice = {
          ...updatedOriginal,
          id: nextId("doc"),
          type: "facture",
          docNumber: nextNumber(documents, "facture"),
          issueDate: new Date().toISOString().slice(0, 10),
          status: "brouillon",
          workStage: "brouillon",
          linkedDevisId: updatedOriginal.id,
          acompteVerse: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        persist([invoice, ...documents.map((d) => (d.id === id ? updatedOriginal : d))]);
        setAutoFactureNotice({ docNumber: invoice.docNumber, id: invoice.id });
        return;
      }
      // Facture qui vient de passer à "payée" : propose (sans jamais
      // l'envoyer seul) un email de demande d'avis Google au client.
      if (original && original.type === "facture" && patch.status === "payée" && original.status !== "payée") {
        const updated = { ...original, ...patch };
        const reviewUrl = (companyProfile?.googleReviewUrl || "").trim();
        const clientEmail = (updated.client?.email || "").trim();
        if (reviewUrl && clientEmail) {
          setReviewNotice({ docId: id, docNumber: updated.docNumber, clientName: updated.client?.name || "", clientEmail, sending: false, sent: false, error: null });
        }
      }
      persist(documents.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d)));
      return;
    }
    // Sinon, c'est le document "en attente" (voir openNew) — tant
    // qu'il reste vide, on ne fait que mettre à jour la mémoire, sans
    // rien enregistrer. Dès qu'il contient un vrai contenu, c'est ICI
    // qu'il rejoint pour de vrai la liste des documents, et devient un
    // brouillon normal, comme les autres.
    if (pendingDoc?.id === id) {
      const merged = { ...pendingDoc, ...patch, updatedAt: Date.now() };
      if (isDocumentEmpty(merged)) {
        setPendingDoc(merged);
      } else {
        setPendingDoc(null);
        persist([merged, ...documents]);
      }
    }
  }
  // Marque un document comme "Terminé" (voir bouton "Enregistrer" dans
  // chaque éditeur) — impossible de "terminer" un document qui n'a
  // encore aucun vrai contenu, même principe que pour ne jamais
  // enregistrer un service resté vide.
  function finalizeDoc(id) {
    if (isLocked) return;
    const doc = documents.find((d) => d.id === id) || (pendingDoc?.id === id ? pendingDoc : null);
    if (!doc || isDocumentEmpty(doc)) {
      alert("Il n'y a encore rien à enregistrer — remplis au moins un champ avant.");
      return;
    }
    updateDoc(id, { workStage: "termine" });
  }
  function deleteDoc(id) {
    if (isLocked) return;
    const doc = documents.find((d) => d.id === id);
    if (!window.confirm(`Supprimer définitivement "${doc?.docNumber || "ce document"}" ? Cette action est irréversible.`)) return;
    persist(documents.filter((d) => d.id !== id));
    // Les photos de chantier du document disparaissent avec lui.
    if (doc) removeDocumentsPhotoFiles([doc]);
    if (activeId === id) backToDashboard();
  }
  function duplicateDoc(id) {
    if (isLocked) return;
    const original = documents.find((d) => d.id === id);
    if (!original) return;
    const copy = { ...original, id: nextId("doc"), docNumber: nextNumber(documents, original.type), status: "brouillon", createdAt: Date.now(), updatedAt: Date.now() };
    // Les photos de chantier restent propres à l'original : les fichiers ne
    // sont pas dupliqués, la copie repart sans photo (sinon retirer une
    // photo de l'un supprimerait le fichier de l'autre).
    if (Array.isArray(copy.photos) && copy.photos.length) copy.photos = [];
    // Facture récurrente : la copie garde les mêmes réglages (intervalle,
    // date de fin), mais sa prochaine échéance repart d'aujourd'hui —
    // sinon elle héritait de la date de l'original et la tâche
    // automatique générait aussitôt une facture en double.
    if (copy.type === "facture" && copy.isRecurring) {
      const next = new Date();
      if (copy.recurrenceInterval === "annuel") next.setFullYear(next.getFullYear() + 1);
      else if (copy.recurrenceInterval === "trimestriel") next.setMonth(next.getMonth() + 3);
      else next.setMonth(next.getMonth() + 1);
      copy.nextRecurrenceDate = next.toISOString().slice(0, 10);
    }
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
      // Acompte déjà versé : laissé vide, même si le devis demandait un
      // acompte — c'est à l'artisan de confirmer le montant réellement reçu.
      acompteVerse: "",
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
    const distinctClients = [...new Set(docs.map((d) => d.clientId || d.client?.name || ""))];
    if (distinctClients.length > 1) {
      if (!window.confirm("Ces documents appartiennent à des clients différents — seules les coordonnées du premier seront gardées sur le document fusionné. Continuer quand même ?")) return;
    }
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
    try {
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
    } catch (err) {
      console.error("Erreur de génération du fichier Excel groupé", err);
      alert("Impossible de générer le fichier Excel. Réessaie, et préviens-moi si ça persiste.");
    }
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
      .filter((d) => stageFilter === "tous" || (stageFilter === "termine" ? d.workStage === "termine" : d.workStage !== "termine"))
      .filter((d) => {
        if (!search.trim()) return true;
        const s = search.toLowerCase();
        return d.docNumber.toLowerCase().includes(s) || (d.client.name || "").toLowerCase().includes(s);
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [documents, typeFilter, stageFilter, search]);

  // Affiche un nombre limité de documents à la fois — sans ça, un
  // compte avec plusieurs centaines de documents accumulés au fil du
  // temps ralentirait la page (tout serait affiché d'un coup). La
  // recherche et les filtres continuent de porter sur TOUS les
  // documents, pas seulement ceux actuellement affichés.
  const PAGE_SIZE = 40;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [search, typeFilter, stageFilter]);
  const visibleFiltered = filtered.slice(0, visibleCount);

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

  const activeDoc = documents.find((d) => d.id === activeId) || (pendingDoc?.id === activeId ? pendingDoc : undefined);
  // Filet de sécurité valable pour TOUTE façon de quitter un document
  // en attente encore vide (pas seulement "Retour au tableau de
  // bord") — dès que ce n'est plus le document actuellement affiché,
  // il est abandonné, jamais enregistré.
  useEffect(() => {
    if (pendingDoc && pendingDoc.id !== activeId) setPendingDoc(null);
  }, [activeId, pendingDoc]);

  if (loading || !siteSettingsLoaded) {
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
    if (preAuthView === "contact") {
      return <ContactView siteSettings={siteSettings} onBack={() => setPreAuthView("landing")} onLegal={setPreAuthView} />;
    }
    // Pages légales (mentions légales, confidentialité, CGU) — accessibles
    // sans connexion, comme la page Contact.
    if (LEGAL_PAGES[preAuthView]) {
      return <LegalView kind={preAuthView} siteSettings={siteSettings} onBack={() => setPreAuthView("landing")} onLegal={setPreAuthView} />;
    }
    if (preAuthView === "landing") {
      const LandingComponent = siteSettings?.landingPageVersion === "atelier" ? LandingPageAtelier : siteSettings?.landingPageVersion === "avancee" ? LandingPageAvancee : LandingPage;
      return (
        <LandingComponent
          plans={plans}
          siteSettings={siteSettings}
          onGetStarted={() => { setAuthMode("signup"); setPreAuthView("auth"); }}
          onLogin={() => { setAuthMode("login"); setPreAuthView("auth"); }}
          onContact={() => setPreAuthView("contact")}
          onLegal={setPreAuthView}
        />
      );
    }
    return <AuthScreen initialMode={authMode} onBack={() => setPreAuthView("landing")} siteSettings={siteSettings} onLegal={setPreAuthView} />;
  }

  // Le prix de son forfait est passé de 0€ à un prix réel depuis son
  // activation gratuite — bloque l'accès jusqu'à ce qu'elle régularise
  // (choix mensuel/annuel, paiement réel). Ne s'applique jamais à un
  // vrai paiement déjà effectué (Stripe/PayPal), ni à l'admin lui-même,
  // ni à la page Contact — qui doit toujours rester joignable, y
  // compris pour quelqu'un de bloqué qui a besoin d'aide pour régler
  // justement ce blocage.
  if (account.needsRegularization && !account.isAdmin && view !== "contact") {
    return (
      <RegularizationScreen
        account={account}
        plans={plans}
        siteSettings={siteSettings}
        onLogout={logout}
        onContact={() => setView("contact")}
      />
    );
  }
  if (view === "contact") {
    return <ContactView siteSettings={siteSettings} onBack={() => setView("dashboard")} onLegal={setView} />;
  }
  if (LEGAL_PAGES[view]) {
    return <LegalView kind={view} siteSettings={siteSettings} onBack={() => setView("dashboard")} onLegal={setView} />;
  }

  const freeLimit = plans.find((p) => p.id === "gratuit")?.limit ?? 3;
  const freeLimitReached = (account?.plan || "gratuit") === "gratuit" && documents.length >= freeLimit;
  const isViewer = account?.role === "viewer" || account?.role === "comptable";
  const isLocked = freeLimitReached || isViewer || offlineMode;

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
        companyProfile={companyProfile}
        isLocked={isLocked}
        isViewer={isViewer}
        onChange={(patch) => updateDoc(activeDoc.id, patch)}
        onFinalize={() => finalizeDoc(activeDoc.id)}
        onBack={backToDashboard}
        onConvert={() => convertToInvoice(activeDoc.id)}
        onSaveClient={upsertClient}
        onSavePrestation={upsertPrestation}
        onSplit={(extractedItems) => createSplitDocument(activeDoc, extractedItems)}
        splitNotice={splitNotice}
        onOpenSplitDoc={() => { if (splitNotice) { setActiveId(splitNotice.id); setSplitNotice(null); } }}
        onDismissSplitNotice={() => setSplitNotice(null)}
        onGoToPricing={() => setView("pricing")}
        reviewNotice={reviewNotice?.docId === activeDoc.id ? reviewNotice : null}
        onSendReview={sendReviewRequest}
        onDismissReview={() => setReviewNotice(null)}
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
        onFinalize={() => finalizeDoc(activeDoc.id)}
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
        onFinalize={() => finalizeDoc(activeDoc.id)}
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
        onFinalize={() => finalizeDoc(activeDoc.id)}
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
        onFinalize={() => finalizeDoc(activeDoc.id)}
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
        onFinalize={() => finalizeDoc(activeDoc.id)}
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
        onFinalize={() => finalizeDoc(activeDoc.id)}
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
        onFinalize={() => finalizeDoc(activeDoc.id)}
        onBack={backToDashboard}
        onGoToPricing={() => setView("pricing")}
      />
    );
  }

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

  const navProps = { view, setView, onNewDevis: () => openNew("devis"), onNewFacture: () => openNew("facture"), onNewProforma: () => openNew("proforma"), onNewRevision: () => setView("revision-sector"), onNewService: openNewService, visibleServices, account, onLogout: logout, onSwitchOrganization: switchOrganization, onCreateOwnOrg: createMyOwnOrganization, creatingOwnOrg, siteSettings, companyProfile, onSetCompanyType: (type) => { persistCompanyProfile({ ...companyProfile, type }); setView("company"); }, commandPaletteOpen, setCommandPaletteOpen, paletteCommands, darkMode, setDarkMode };

  // ---------------------------------------------------------------------
  // Version "Atelier" : une seule branche, avant les écrans classique et
  // avancée, qui rend les pages dans la coque Atelier. Les éditeurs sont
  // déjà rendus plus haut (identiques pour toutes les versions).
  // ---------------------------------------------------------------------
  if (isAtelier) {
    const goPricing = () => setView("pricing");
    // Création depuis une fiche chantier : le document naît avec le nom
    // du chantier déjà rempli (mise à jour du brouillon en attente juste
    // après sa création, dans le même cycle de rendu).
    const createWithChantier = (serviceId) => {
      const chantierName = atelierCreateChantier;
      setAtelierCreateChantier(null);
      openNewService(serviceId);
      if (chantierName && serviceId !== "revision") setPendingDoc((p) => (p ? { ...p, chantier: chantierName } : p));
    };
    const openCreateForChantier = (chantierName) => { setAtelierCreateChantier(chantierName); setAtelierCreateOpen(true); };
    let page;
    if (view === "atelier-documents") {
      page = (
        <AtelierDocumentsView
          documents={documents}
          darkMode={darkMode}
          isLocked={isLocked}
          isViewer={isViewer}
          preset={atelierDocsPreset}
          onPresetConsumed={() => setAtelierDocsPreset(null)}
          onOpenDoc={openDoc}
          onChangeStatus={(id, status) => updateDoc(id, { status })}
          onDuplicate={duplicateDoc}
          onDelete={deleteDoc}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onClearSelection={() => setSelectedIds([])}
          onMerge={mergeDocuments}
          onBatchExcel={exportBatchExcel}
          onBatchPdf={exportBatchPdf}
          batchExporting={batchExporting}
          onExportAccounting={exportAccountingCSV}
        />
      );
    } else if (view === "revision-sector") {
      page = <AtelierRevisionSectorPicker revisionCountry={revisionCountry} setRevisionCountry={setRevisionCountry} onPick={openNewRevision} onBack={backToDashboard} darkMode={darkMode} />;
    } else if (view === "chantiers") {
      page = <AtelierChantiersView documents={documents} account={account} siteSettings={siteSettings} darkMode={darkMode} isLocked={isLocked} isViewer={isViewer} onOpenChantier={(name) => { setAtelierChantier(name); setView("atelier-chantier"); }} onNewChantier={openCreateForChantier} />;
    } else if (view === "atelier-chantier" && atelierChantier) {
      page = <AtelierChantierView name={atelierChantier} documents={documents} account={account} darkMode={darkMode} isLocked={isLocked} isViewer={isViewer} onBack={() => setView("chantiers")} onOpenDoc={openDoc} onCreateForChantier={openCreateForChantier} />;
    } else if (view === "atelier-chantier") {
      page = <AtelierChantiersView documents={documents} account={account} siteSettings={siteSettings} darkMode={darkMode} isLocked={isLocked} isViewer={isViewer} onOpenChantier={(name) => { setAtelierChantier(name); setView("atelier-chantier"); }} onNewChantier={openCreateForChantier} />;
    } else if (view === "clients") {
      page = <ClientsView clients={clients} documents={documents} saving={savingClients} onSave={upsertClient} onDelete={deleteClient} isLocked={isLocked} isViewer={isViewer} onGoToPricing={goPricing} siteSettings={siteSettings} darkMode={darkMode} />;
    } else if (view === "company") {
      page = <CompanyView profile={companyProfile} saving={savingCompany} onSave={persistCompanyProfile} onReset={resetTestData} documentCount={documents.length} clientCount={clients.length} account={account} isLocked={isLocked} isViewer={isViewer} onGoToPricing={goPricing} />;
    } else if (view === "team") {
      page = <TeamView account={account} siteSettings={siteSettings} />;
    } else if (view === "planning-equipe") {
      page = <PlanningView documents={documents} account={account} siteSettings={siteSettings} darkMode={darkMode} isLocked={isLocked} isViewer={isViewer} />;
    } else if (view === "api") {
      page = <ApiView account={account} siteSettings={siteSettings} />;
    } else if (view === "account") {
      page = <AccountView account={account} siteSettings={siteSettings} />;
    } else if (view === "prestations") {
      page = hasAccess(account, "pro")
        ? <PrestationsView prestations={prestations} saving={savingPrestations} onSave={upsertPrestation} onDelete={deletePrestation} siteSettings={siteSettings} darkMode={darkMode} />
        : <LockedFeature onGoToPricing={goPricing} />;
    } else if (view === "pricing") {
      page = (
        <PricingView
          account={account}
          plans={plans}
          onChooseFree={async () => { await chooseFreePlan(); setLimitNotice(false); }}
          onChooseZeroPrice={async (planId, billingCycle) => { const ok = await chooseZeroPricePlan(planId, billingCycle); if (ok) setLimitNotice(false); }}
          onCancelSubscription={cancelSubscription}
          onContact={() => setView("contact")}
          onRefreshAccount={refreshAccount}
          cancellingSubscription={cancellingSubscription}
          limitNotice={limitNotice}
          documentCount={documents.length}
          siteSettings={siteSettings}
        />
      );
    } else if (view === "admin" && account?.isAdmin) {
      page = (
        <AdminView
          account={account}
          darkMode={darkMode}
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
          deletingAccount={deletingAccount}
          siteSettings={siteSettings}
          savingSiteSettings={savingSiteSettings}
          onUpdateSiteSettings={updateSiteSettings}
          allUsers={allUsers}
          allUsersError={allUsersError}
          onRefreshUsers={loadAllUsers}
          onSetUserPlan={adminSetUserPlan}
          onSetUserPaidAt={adminSetUserPaidAt}
          onSetUserExpiresAt={adminSetUserExpiresAt}
          savingUserPlanId={savingUserPlanId}
          onResendConfirmation={resendConfirmation}
          resendingConfirmationId={resendingConfirmationId}
        />
      );
    } else {
      page = (
        <AtelierHome
          account={account}
          documents={documents}
          darkMode={darkMode}
          isLocked={isLocked}
          isViewer={isViewer}
          freeLimit={freeLimit}
          freeLimitReached={freeLimitReached}
          offlineMode={offlineMode}
          visibleServices={visibleServices}
          reminders={reminders}
          reminderMailto={reminderMailto}
          onCreate={openNewService}
          onOpenCreate={() => setAtelierCreateOpen(true)}
          onOpenDoc={openDoc}
          onGoToDocuments={(preset) => { setAtelierDocsPreset(preset || null); setView("atelier-documents"); }}
          onGoToPricing={goPricing}
          autoFactureNotice={autoFactureNotice}
          onOpenAutoFacture={() => { openDoc(autoFactureNotice.id); setAutoFactureNotice(null); }}
          onDismissAutoFacture={() => setAutoFactureNotice(null)}
          reviewNotice={reviewNotice}
          onSendReview={sendReviewRequest}
          onDismissReview={() => setReviewNotice(null)}
        />
      );
    }
    return (
      <AtelierShell
        view={view}
        setView={setView}
        account={account}
        siteSettings={siteSettings}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        onLogout={logout}
        onSwitchOrganization={switchOrganization}
        onCreateOwnOrg={createMyOwnOrganization}
        creatingOwnOrg={creatingOwnOrg}
        onOpenCreate={() => setAtelierCreateOpen(true)}
        commandPaletteOpen={commandPaletteOpen}
        setCommandPaletteOpen={setCommandPaletteOpen}
        paletteCommands={[{ id: "nav-atelier-documents", label: "Aller à Documents", icon: Files, action: () => setView("atelier-documents") }, ...paletteCommands]}
      >
        {page}
        <AtelierCreateSheet open={atelierCreateOpen} onClose={() => { setAtelierCreateOpen(false); setAtelierCreateChantier(null); }} visibleServices={visibleServices} onCreate={createWithChantier} chantierName={atelierCreateChantier} darkMode={darkMode} />
        {/* Hôte hors écran pour l'export PDF groupé (même mécanisme que
            le tableau de bord classique, rendu ici pour Atelier). */}
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
      </AtelierShell>
    );
  }

  if (view === "revision-sector") {
    const countryInfo = getRevisionCountryInfo(revisionCountry);
    return (
      <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
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

  if (view === "chantiers") {
    return (
      <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <ChantiersView documents={documents} siteSettings={siteSettings} darkMode={darkMode} onOpenDoc={openDoc} />
      </div>
    );
  }

  if (view === "clients") {
    return (
      <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <ClientsView clients={clients} documents={documents} saving={savingClients} onSave={upsertClient} onDelete={deleteClient} isLocked={isLocked} isViewer={isViewer} onGoToPricing={() => setView("pricing")} siteSettings={siteSettings} darkMode={darkMode} />
      </div>
    );
  }

  if (view === "company") {
    return (
      <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <CompanyView profile={companyProfile} saving={savingCompany} onSave={persistCompanyProfile} onReset={resetTestData} documentCount={documents.length} clientCount={clients.length} account={account} isLocked={isLocked} isViewer={isViewer} onGoToPricing={() => setView("pricing")} />
      </div>
    );
  }

  if (view === "team") {
    return (
      <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <TeamView account={account} siteSettings={siteSettings} />
      </div>
    );
  }

  if (view === "planning-equipe") {
    return (
      <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <PlanningView documents={documents} account={account} siteSettings={siteSettings} darkMode={darkMode} isLocked={isLocked} isViewer={isViewer} />
      </div>
    );
  }

  if (view === "api") {
    return (
      <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <ApiView account={account} siteSettings={siteSettings} />
      </div>
    );
  }

  if (view === "account") {
    return (
      <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <AccountView account={account} siteSettings={siteSettings} />
      </div>
    );
  }

  if (view === "prestations") {
    return (
      <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        {hasAccess(account, "pro") ? (
          <PrestationsView prestations={prestations} saving={savingPrestations} onSave={upsertPrestation} onDelete={deletePrestation} siteSettings={siteSettings} darkMode={darkMode} />
        ) : (
          <LockedFeature onGoToPricing={() => setView("pricing")} />
        )}
      </div>
    );
  }

  if (view === "pricing") {
    return (
      <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <PricingView
          account={account}
          plans={plans}
          onChooseFree={async () => { await chooseFreePlan(); setLimitNotice(false); }}
          onChooseZeroPrice={async (planId, billingCycle) => { const ok = await chooseZeroPricePlan(planId, billingCycle); if (ok) setLimitNotice(false); }}
          onCancelSubscription={cancelSubscription}
          onContact={() => setView("contact")}
          onRefreshAccount={refreshAccount}
          cancellingSubscription={cancellingSubscription}
          limitNotice={limitNotice}
          documentCount={documents.length}
          siteSettings={siteSettings}
        />
      </div>
    );
  }

  if (view === "admin" && account?.isAdmin) {
    return (
      <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
        <GlobalStyle />
        <TopNav {...navProps} />
        <AdminView
          account={account}
          darkMode={darkMode}
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
          deletingAccount={deletingAccount}
          siteSettings={siteSettings}
          savingSiteSettings={savingSiteSettings}
          onUpdateSiteSettings={updateSiteSettings}
          allUsers={allUsers}
          allUsersError={allUsersError}
          onRefreshUsers={loadAllUsers}
          onSetUserPlan={adminSetUserPlan}
          onSetUserPaidAt={adminSetUserPaidAt}
          onSetUserExpiresAt={adminSetUserExpiresAt}
          savingUserPlanId={savingUserPlanId}
          onResendConfirmation={resendConfirmation}
          resendingConfirmationId={resendingConfirmationId}
        />
      </div>
    );
  }

  return (
    <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
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
        {siteSettings?.landingPageVersion === "avancee" ? (
          <div className="mb-6 overflow-hidden rounded-3xl border" style={{ background: darkMode ? "linear-gradient(to bottom, #2A3241, #1B212C)" : "linear-gradient(to bottom, #BFDBFE, #FFFFFF)", borderColor: darkMode ? "#3A4353" : adv.line }}>
            <div className="p-6 sm:p-8">
              <h1 className="df-display text-xl font-bold sm:text-2xl" style={{ color: darkMode ? "#E8EAED" : adv.ink }}>Bonjour{account?.firstName ? `, ${account.firstName}` : ""} 👋</h1>
              <p className="mt-1 text-xs" style={{ color: darkMode ? "#9AA5B5" : adv.inkSoft }}>Voici un aperçu de ton activité — crée un nouveau document en un clic.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                {["devis", "facture", "commande", "situation"].map((id) => {
                  const svc = getService(id);
                  if (!svc) return null;
                  const SvcIcon = svc.icon;
                  return (
                    <button key={id} onClick={() => openNewService(id)} className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold" style={{ background: darkMode ? "#262D3A" : adv.paper, color: darkMode ? "#E8EAED" : adv.ink }}>
                      <SvcIcon size={15} style={{ color: adv.accent }} /> {svc.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-px sm:grid-cols-3" style={{ background: darkMode ? "#3A4353" : adv.line }}>
              {[
                { icon: Inbox, label: "Devis en attente de réponse", value: stats.enAttenteCount, sub: eur(stats.montantEnAttente) },
                { icon: AlertTriangle, label: "Factures impayées", value: stats.impayeesCount, sub: eur(stats.montantImpaye) },
                { icon: TrendingUp, label: "Taux de signature des devis", value: stats.tauxSignature === null ? "—" : `${stats.tauxSignature}%`, sub: "devis envoyés → signés" },
              ].map(({ icon: Icon, label, value, sub }) => (
                <div key={label} className="p-6" style={{ background: darkMode ? "#262D3A" : adv.surface }}>
                  <Icon size={17} style={{ color: adv.accent }} />
                  <div className="df-display mt-3 text-2xl font-bold" style={{ color: darkMode ? "#E8EAED" : adv.ink }}>{value}</div>
                  <div className="mt-1 text-xs font-medium" style={{ color: darkMode ? "#9AA5B5" : adv.inkSoft }}>{label}</div>
                  <div className="df-mono mt-1 text-[11px]" style={{ color: darkMode ? "#9AA5B5" : adv.inkSoft }}>{sub}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Devis en attente de réponse" value={stats.enAttenteCount} sub={eur(stats.montantEnAttente)} color={colors.slate} />
            <StatCard label="Factures impayées" value={stats.impayeesCount} sub={eur(stats.montantImpaye)} color={colors.brick} />
            <StatCard label="Taux de signature des devis" value={stats.tauxSignature === null ? "—" : `${stats.tauxSignature}%`} sub="devis envoyés → signés" color={colors.moss} />
          </div>
        )}

        <RevenueChart documents={documents} isAdvanced={siteSettings?.landingPageVersion === "avancee"} darkMode={darkMode} />

        {offlineMode && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl px-4 py-3" style={{ background: `${colors.brick}0D`, border: `1px solid ${colors.brick}40` }}>
            <AlertTriangle size={16} style={{ color: colors.brick, flexShrink: 0, marginTop: "2px" }} />
            <div>
              <p className="text-sm font-medium" style={{ color: colors.brick }}>Mode hors ligne — dernière copie connue</p>
              <p className="text-xs" style={{ color: colors.inkSoft }}>Impossible de joindre le serveur. Tu consultes une copie de tes documents enregistrée lors de ta dernière connexion — elle peut ne plus être à jour, et aucune modification n'est possible tant que la connexion n'est pas revenue.</p>
            </div>
          </div>
        )}

        {autoFactureNotice && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: `${colors.moss}0D`, border: `1px solid ${colors.moss}40` }}>
            <div className="flex items-center gap-2">
              <Check size={16} style={{ color: colors.moss, flexShrink: 0 }} />
              <p className="text-sm font-medium" style={{ color: colors.moss }}>Devis signé — la facture {autoFactureNotice.docNumber} a été créée automatiquement.</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => { openDoc(autoFactureNotice.id); setAutoFactureNotice(null); }} className="text-xs font-semibold underline" style={{ color: colors.moss }}>Ouvrir</button>
              <button onClick={() => setAutoFactureNotice(null)} style={{ color: colors.inkSoft }}><X size={14} /></button>
            </div>
          </div>
        )}
        <ReviewRequestNotice notice={reviewNotice} onSend={sendReviewRequest} onDismiss={() => setReviewNotice(null)} />

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
        <div className={siteSettings?.landingPageVersion === "avancee" ? "mb-5 flex flex-wrap items-center gap-3 rounded-2xl p-3" : "mb-4 flex flex-wrap items-center gap-3"} style={siteSettings?.landingPageVersion === "avancee" ? { background: colors.surface, border: `1px solid ${colors.line}` } : {}}>
          <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: siteSettings?.landingPageVersion === "avancee" ? colors.paper : colors.surface, border: siteSettings?.landingPageVersion === "avancee" ? "none" : `1px solid ${colors.line}`, minWidth: siteSettings?.landingPageVersion === "avancee" ? "220px" : "auto" }}>
            <Search size={15} style={{ color: colors.inkSoft }} />
            <input className="df-input w-full bg-transparent text-sm outline-none" placeholder="Rechercher un client ou un numéro..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg p-1" style={{ background: siteSettings?.landingPageVersion === "avancee" ? colors.paper : colors.surface, border: siteSettings?.landingPageVersion === "avancee" ? "none" : `1px solid ${colors.line}`, WebkitOverflowScrolling: "touch" }}>
            {[["tous", "Tous"], ["devis", "Devis"], ["facture", "Factures"], ["proforma", "Proforma"], ["revision", "Révisions"]].map(([id, label]) => (
              <button key={id} onClick={() => setTypeFilter(id)} className="shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium" style={{ background: typeFilter === id ? colors.ink : "transparent", color: typeFilter === id ? "white" : colors.inkSoft }}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg p-1" style={{ background: siteSettings?.landingPageVersion === "avancee" ? colors.paper : colors.surface, border: siteSettings?.landingPageVersion === "avancee" ? "none" : `1px solid ${colors.line}`, WebkitOverflowScrolling: "touch" }}>
            {[["tous", "Tous"], ["brouillon", "Brouillons"], ["termine", "Terminés"]].map(([id, label]) => (
              <button key={id} onClick={() => setStageFilter(id)} className="shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium" style={{ background: stageFilter === id ? colors.ink : "transparent", color: stageFilter === id ? "white" : colors.inkSoft }}>
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
              <button onClick={() => openNew("devis")} className="mt-4 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.brass, color: siteSettings?.landingPageVersion === "avancee" ? "white" : colors.ink }}>
                <Plus size={15} /> Créer un devis
              </button>
            )}
          </div>
        ) : siteSettings?.landingPageVersion === "avancee" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleFiltered.map((d) => {
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
                <div key={d.id} className="flex flex-col gap-3 rounded-2xl p-4 transition-shadow hover:shadow-md" style={{ background: siteSettings?.landingPageVersion === "avancee" ? (darkMode ? "#262D3A" : adv.surface) : colors.surface, border: `1px solid ${selectedIds.includes(d.id) ? colors.brass : colors.line}` }}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${docTypeColor(d.type)}18`, color: docTypeColor(d.type) }}><TypeIconComp size={16} /></div>
                      <div>
                        <button onClick={() => openDoc(d.id)} className="df-mono block text-left text-sm font-semibold hover:underline">{d.docNumber}</button>
                        <div className="text-xs" style={{ color: colors.inkSoft }}>{fr(d.updatedAt)}</div>
                      </div>
                    </div>
                    <input type="checkbox" checked={selectedIds.includes(d.id)} onChange={() => toggleSelect(d.id)} style={{ accentColor: colors.brass }} aria-label={`Sélectionner ${d.docNumber}`} />
                  </div>
                  <div className="truncate text-sm font-medium">{d.client.name || <span style={{ color: colors.inkSoft }}>Client non renseigné</span>}</div>
                  <div className="df-display text-xl font-bold">{formatMoney(totalTTC, d.currency)}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: d.workStage === "termine" ? `${colors.moss}18` : `${colors.inkSoft}18`, color: d.workStage === "termine" ? colors.moss : colors.inkSoft }}>
                      {d.workStage === "termine" ? <Check size={11} /> : null} {d.workStage === "termine" ? "Terminé" : "Brouillon"}
                    </span>
                    <select
                      value={d.status}
                      onChange={(e) => updateDoc(d.id, { status: e.target.value })}
                      className="df-select rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{ background: `${statusColor(d.status)}1A`, color: statusColor(d.status), border: `1px solid ${statusColor(d.status)}55` }}
                    >
                      {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="mt-1 flex justify-end gap-3 border-t pt-3" style={{ borderColor: colors.line }}>
                    <button onClick={() => duplicateDoc(d.id)} disabled={isLocked} title={isLocked ? "Verrouillé — passe à un forfait payant" : "Dupliquer"} style={{ color: colors.inkSoft, opacity: isLocked ? 0.4 : 1, cursor: isLocked ? "not-allowed" : "pointer" }}><Copy size={15} /></button>
                    <button onClick={() => deleteDoc(d.id)} disabled={isLocked} title={isLocked ? "Verrouillé — passe à un forfait payant" : "Supprimer"} style={{ color: colors.brick, opacity: isLocked ? 0.4 : 1, cursor: isLocked ? "not-allowed" : "pointer" }}><Trash2 size={15} /></button>
                  </div>
                </div>
              );
            })}
            {filtered.length > visibleCount && (
              <button onClick={() => setVisibleCount((c) => c + PAGE_SIZE)} className="flex items-center justify-center rounded-2xl p-4 text-sm font-medium" style={{ background: colors.surface, border: `1px dashed ${colors.line}`, color: colors.slate }}>
                Charger {Math.min(PAGE_SIZE, filtered.length - visibleCount)} de plus ({filtered.length - visibleCount} restant{filtered.length - visibleCount > 1 ? "s" : ""})
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
            <p className="border-b px-4 py-2 text-xs" style={{ borderColor: colors.line, color: colors.inkSoft }}>
              Sélectionne plusieurs devis (ou plusieurs factures) pour les <strong>fusionner</strong> en un seul document.
            </p>
            {visibleFiltered.map((d, idx) => {
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
                  <input type="checkbox" checked={selectedIds.includes(d.id)} onChange={() => toggleSelect(d.id)} style={{ accentColor: colors.brass }} aria-label={`Sélectionner ${d.docNumber}`} />
                  <div className="flex items-center gap-2" style={{ color: docTypeColor(d.type) }}>
                    <TypeIconComp size={16} />
                  </div>
                  <button onClick={() => openDoc(d.id)} className="df-mono w-32 shrink-0 text-left text-sm font-medium hover:underline">{d.docNumber}</button>
                  <div className="min-w-0 grow basis-40 truncate text-sm">{d.client.name || <span style={{ color: colors.inkSoft }}>Client non renseigné</span>}</div>
                  <div className="df-mono w-28 shrink-0 text-right text-sm font-medium">{formatMoney(totalTTC, d.currency)}</div>
                  <div className="w-24 shrink-0 text-right text-xs" style={{ color: colors.inkSoft }}>{fr(d.updatedAt)}</div>
                  <span className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: d.workStage === "termine" ? `${colors.moss}18` : `${colors.inkSoft}18`, color: d.workStage === "termine" ? colors.moss : colors.inkSoft }}>
                    {d.workStage === "termine" ? <Check size={11} /> : null} {d.workStage === "termine" ? "Terminé" : "Brouillon"}
                  </span>
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
            {filtered.length > visibleCount && (
              <div className="flex justify-center border-t px-4 py-3" style={{ borderColor: colors.line }}>
                <button onClick={() => setVisibleCount((c) => c + PAGE_SIZE)} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ background: colors.paper, color: colors.slate }}>
                  Charger {Math.min(PAGE_SIZE, filtered.length - visibleCount)} de plus ({filtered.length - visibleCount} restant{filtered.length - visibleCount > 1 ? "s" : ""})
                </button>
              </div>
            )}
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

// Filet de sécurité maison — si une erreur imprévue survient malgré
// tout (un vrai bug qui aurait échappé aux tests), la personne voit un
// message clair plutôt qu'un écran blanc silencieux. Volontairement
// sans dépendance externe (ex: Sentry) — si un jour tu veux une vraie
// alerte automatique en cas d'erreur chez un utilisateur, dis-le-moi,
// ça se rajoute proprement en un morceau séparé plutôt que d'imposer
// une dépendance non installée.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error("Erreur inattendue interceptée :", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-full w-full flex-col items-center justify-center gap-4 p-8 text-center" style={{ background: "#F5F5F6", color: "#242427" }}>
          <AlertTriangle size={40} style={{ color: "#D64545" }} />
          <div>
            <h2 className="text-lg font-semibold">Une erreur inattendue est survenue</h2>
            <p className="mt-1 text-sm" style={{ color: "#77777C" }}>Essaie de recharger la page. Si ça persiste, préviens-nous.</p>
          </div>
          <button onClick={() => { this.setState({ hasError: false }); window.location.reload(); }} className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ background: "#3B3B3F" }}>
            Recharger la page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Export par défaut réel — enveloppe l'application dans le filet de
// sécurité ci-dessus.
// Bandeau affiché en toutes circonstances (chargement, connexion,
// tableau de bord...) dès que la connexion internet est perdue —
// composant volontairement autonome, indépendant de l'écran
// actuellement affiché, pour ne jamais dépendre de sa logique interne.
function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" && !navigator.onLine);
  useEffect(() => {
    function handleOnline() { setIsOffline(false); }
    function handleOffline() { setIsOffline(true); }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);
  if (!isOffline) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 py-2 text-center text-sm font-medium text-white" style={{ background: "#A6483B" }}>
      <AlertTriangle size={14} /> Pas de connexion internet — certaines actions ne fonctionneront pas tant qu'elle n'est pas rétablie.
    </div>
  );
}

export default function DeviFactApp() {
  // Lien public reçu par un client (signature ou paiement d'un
  // document, sans avoir de compte) — vérifié ICI, avant même de
  // toucher à toute la logique de connexion/tableau de bord, pour que
  // ce soit accessible à n'importe qui, sans exception.
  const publicToken = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("voir-document") : null;
  if (publicToken) {
    return (
      <ErrorBoundary>
        <PublicDocumentView token={publicToken} />
      </ErrorBoundary>
    );
  }
  return (
    <ErrorBoundary>
      <OfflineBanner />
      <DeviFactAppInner />
    </ErrorBoundary>
  );
}

// Page vue par le client via un lien public envoyé par email — jamais
// besoin d'un compte. Permet de consulter un devis/facture, de le
// signer, ou de le payer en ligne selon son type et son statut.
function PublicDocumentView({ token }) {
  const [state, setState] = useState({ loading: true, error: null, document: null, siteName: "", signedAt: null, paidAt: null });
  const [signatureName, setSignatureName] = useState("");
  const [secondSigner, setSecondSigner] = useState(false);
  const [secondSignatureName, setSecondSignatureName] = useState("");
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState(null);
  const [signed, setSigned] = useState(false);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState(null);
  // Signature à distance : saisie du nom (par défaut) ou dessin à main
  // levée — même technique que le dessin dans l'éditeur (canvas 2D,
  // image PNG envoyée à sign-public-document dans signatureDrawing).
  const [signMode, setSignMode] = useState("texte"); // texte | dessin
  const [drawing, setDrawing] = useState(null);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  function getPos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    // Le canvas peut être affiché plus étroit que sa taille réelle sur
    // téléphone : on ramène la position dans ses coordonnées internes.
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return { x: (cx - rect.left) * scaleX, y: (cy - rect.top) * scaleY };
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
    ctx.strokeStyle = "#1B2A33";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  function endDraw() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    setDrawing(canvasRef.current.toDataURL("image/png"));
  }
  function clearCanvas() {
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setDrawing(null);
  }

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await db.functions.invoke("get-public-document", { body: { token } });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        setState({ loading: false, error: null, document: data.document, siteName: data.siteName, signedAt: data.signedAt, paidAt: data.paidAt });
      } catch (err) {
        setState({ loading: false, error: err.message || "Impossible de charger ce document.", document: null, siteName: "", signedAt: null, paidAt: null });
      }
    })();
  }, [token]);

  async function handleSign() {
    if (signMode === "dessin") {
      if (!drawing) { setSignError("Dessine ta signature dans le cadre pour signer."); return; }
    } else {
      if (!signatureName.trim()) { setSignError("Merci d'indiquer ton nom pour signer."); return; }
      if (secondSigner && !secondSignatureName.trim()) { setSignError("Merci d'indiquer le nom du second signataire."); return; }
    }
    setSigning(true);
    setSignError(null);
    try {
      const body = { token, signatureName: signatureName.trim() };
      if (signMode === "dessin") body.signatureDrawing = drawing;
      else if (secondSigner) body.secondSignatureName = secondSignatureName.trim();
      const { data, error } = await db.functions.invoke("sign-public-document", { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSigned(true);
    } catch (err) {
      setSignError(err.message || "Impossible d'enregistrer la signature pour l'instant.");
    } finally {
      setSigning(false);
    }
  }

  async function handlePay() {
    setPayLoading(true);
    setPayError(null);
    try {
      const { data, error } = await db.functions.invoke("create-invoice-payment", { body: { token } });
      if (error) throw error;
      if (data?.error || !data?.url) throw new Error(data?.error || "Erreur");
      window.location.href = data.url;
    } catch (err) {
      setPayError(err.message || "Impossible de lancer le paiement pour l'instant.");
      setPayLoading(false);
    }
  }

  return (
    <div className="df-root min-h-screen w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="mx-auto max-w-xl px-4 py-10 sm:py-16">
        <div className="mb-8 text-center">
          <div className="df-display text-lg font-bold">{state.siteName || "Chantiflow"}</div>
        </div>

        {state.loading && (
          <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: colors.slate }} /></div>
        )}

        {state.error && (
          <div className="rounded-2xl p-6 text-center" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
            <AlertTriangle size={28} style={{ color: colors.brick, margin: "0 auto 12px" }} />
            <p className="font-medium" style={{ color: colors.brick }}>{state.error}</p>
          </div>
        )}

        {state.document && (
          <div className="rounded-2xl p-6" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
            <div className="mb-4 flex items-center justify-between border-b pb-4" style={{ borderColor: colors.line }}>
              <div>
                <div className="df-display text-xl font-bold">{docTypeLabel(state.document.type)} {state.document.docNumber}</div>
                <div className="text-sm" style={{ color: colors.inkSoft }}>{state.document.client?.name}</div>
              </div>
              <div className="df-mono text-xl font-bold">{formatMoney(computeTotals(state.document).totalTTC, state.document.currency)}</div>
            </div>

            <div className="mb-4 space-y-1">
              {(state.document.items || []).filter((it) => it.type === "line").map((it) => (
                <div key={it.id} className="flex justify-between text-sm">
                  <span>{it.designation}</span>
                  <span className="df-mono" style={{ color: colors.inkSoft }}>{it.qty} × {formatMoney(it.unitPrice, state.document.currency)}</span>
                </div>
              ))}
            </div>

            {/* Signature — uniquement pour un devis pas encore signé */}
            {state.document.type === "devis" && state.document.status !== "signé" && !state.signedAt && !signed && (
              <div className="mt-6 rounded-xl p-4" style={{ background: colors.paper }}>
                <p className="mb-3 text-sm font-medium">Pour accepter ce devis, signe-le ci-dessous :</p>
                <div className="mb-3 flex gap-2">
                  {[
                    { id: "texte", label: "Taper mon nom", icon: TypeIcon },
                    { id: "dessin", label: "Dessiner ma signature", icon: PenTool },
                  ].map(({ id, label, icon: Icon }) => (
                    <button key={id} type="button" onClick={() => { setSignMode(id); setSignError(null); }} className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium" style={{ background: signMode === id ? colors.ink : "transparent", color: signMode === id ? "white" : colors.inkSoft, border: `1px solid ${signMode === id ? colors.ink : colors.line}` }}>
                      <Icon size={13} /> {label}
                    </button>
                  ))}
                </div>
                {signMode === "texte" ? (
                  <>
                    <input
                      className="df-input mb-2 w-full rounded-md px-3 py-2 text-sm"
                      style={{ border: `1px solid ${colors.line}` }}
                      placeholder="Ton nom complet, en guise de signature"
                      value={signatureName}
                      onChange={(e) => setSignatureName(e.target.value)}
                    />
                    <label className="mb-2 flex items-center gap-2 text-sm" style={{ color: colors.inkSoft }}>
                      <input type="checkbox" checked={secondSigner} onChange={(e) => setSecondSigner(e.target.checked)} />
                      Ajouter un second signataire
                    </label>
                    {secondSigner && (
                      <input
                        className="df-input mb-2 w-full rounded-md px-3 py-2 text-sm"
                        style={{ border: `1px solid ${colors.line}` }}
                        placeholder="Nom complet du second signataire"
                        value={secondSignatureName}
                        onChange={(e) => setSecondSignatureName(e.target.value)}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <canvas
                      ref={canvasRef} width={360} height={130}
                      className="w-full rounded-md"
                      style={{ background: colors.surface, border: `1px solid ${colors.line}`, touchAction: "none", cursor: "crosshair", maxWidth: 360 }}
                      onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                      onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
                    />
                    <div className="mb-2 mt-1 flex items-center justify-between gap-2">
                      <span className="text-xs" style={{ color: colors.inkSoft }}>Signe avec le doigt ou la souris dans le cadre.</span>
                      <button type="button" onClick={clearCanvas} className="flex items-center gap-1 text-xs font-medium" style={{ color: colors.inkSoft }}><Eraser size={13} /> Effacer</button>
                    </div>
                    <input
                      className="df-input mb-2 w-full rounded-md px-3 py-2 text-sm"
                      style={{ border: `1px solid ${colors.line}` }}
                      placeholder="Ton nom (facultatif)"
                      value={signatureName}
                      onChange={(e) => setSignatureName(e.target.value)}
                    />
                  </>
                )}
                {signError && <p className="mb-2 text-xs" style={{ color: colors.brick }}>{signError}</p>}
                <button onClick={handleSign} disabled={signing} className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white" style={{ background: colors.brassDark, opacity: signing ? 0.7 : 1 }}>
                  {signing ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {signing ? "Signature en cours..." : "Signer et accepter le devis"}
                </button>
              </div>
            )}
            {(signed || state.signedAt) && (
              <div className="mt-6 flex items-center gap-2 rounded-xl p-4" style={{ background: `${colors.moss}0D` }}>
                <Check size={18} style={{ color: colors.moss }} /> <p className="text-sm font-medium" style={{ color: colors.moss }}>Devis signé — merci !</p>
              </div>
            )}

            {/* Paiement — uniquement pour une facture pas encore payée */}
            {state.document.type === "facture" && state.document.status !== "payée" && !state.paidAt && (
              <div className="mt-6 rounded-xl p-4" style={{ background: colors.paper }}>
                {payError && <p className="mb-2 text-xs" style={{ color: colors.brick }}>{payError}</p>}
                <button onClick={handlePay} disabled={payLoading} className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white" style={{ background: colors.moss, opacity: payLoading ? 0.7 : 1 }}>
                  {payLoading ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />} {payLoading ? "Redirection..." : `Payer ${formatMoney(computeTotals(state.document).totalTTC, state.document.currency)} en ligne`}
                </button>
              </div>
            )}
            {state.paidAt && (
              <div className="mt-6 flex items-center gap-2 rounded-xl p-4" style={{ background: `${colors.moss}0D` }}>
                <Check size={18} style={{ color: colors.moss }} /> <p className="text-sm font-medium" style={{ color: colors.moss }}>Facture déjà payée — merci !</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Page "Nous contacter" — volontairement un composant à part, simple
// et autonome, pour qu'il reste accessible aussi bien depuis la page
// d'accueil (sans compte) que depuis l'intérieur de l'app (connecté)
// — et surtout, JAMAIS bloqué par une histoire d'abonnement expiré :
// quelqu'un qui n'a plus accès doit toujours pouvoir nous contacter
// pour savoir comment réactiver son compte.
function ContactView({ siteSettings, onBack, onLegal }) {
  const emptyForm = { nom: "", prenom: "", telephone: "", email: "", objet: "", message: "" };
  const [form, setForm] = useState(emptyForm);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  function patch(p) {
    setForm((f) => ({ ...f, ...p }));
    if (error) setError("");
  }

  async function handleSubmit() {
    if (!form.nom.trim() || !form.prenom.trim() || !form.email.trim() || !form.objet.trim() || !form.message.trim()) {
      setError("Merci de remplir tous les champs obligatoires (téléphone excepté).");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError("Cette adresse email ne semble pas valide.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const { data, error: fnError } = await db.functions.invoke("send-contact-message", { body: form });
      if (fnError || data?.error) {
        setError(data?.error || fnError?.message || "Une erreur est survenue. Réessaie dans un instant.");
        return;
      }
      setSent(true);
      setForm(emptyForm);
    } catch (err) {
      console.error("Erreur d'envoi du formulaire de contact", err);
      setError("Impossible d'envoyer le message pour l'instant. Réessaie, ou écris-nous directement par email.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="mx-auto max-w-xl px-4 py-10 sm:py-16">
        {onBack && (
          <button onClick={onBack} className="mb-6 flex items-center gap-1 text-sm" style={{ color: colors.inkSoft }}>
            <ArrowLeft size={15} /> Retour
          </button>
        )}
        <h1 className="df-display mb-2 text-3xl font-semibold">Nous contacter</h1>
        <p className="mb-6 text-sm" style={{ color: colors.inkSoft }}>
          Une question, besoin d'aide pour ton abonnement, ou tu ne peux pas payer par carte ou PayPal depuis ton pays ? Écris-nous, on te répond directement.
        </p>

        <div className="mb-8 flex gap-3">
          {siteSettings?.contactInstagramUrl && (
            <a href={siteSettings.contactInstagramUrl} target="_blank" rel="noopener noreferrer" className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: colors.surface, border: `1px solid ${colors.line}`, color: colors.ink }} title="Instagram">
              <InstagramIcon size={22} />
            </a>
          )}
          <a href={`mailto:${siteSettings?.contactEmail || "contact@chantiflow.fr"}`} className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: colors.surface, border: `1px solid ${colors.line}`, color: colors.ink }} title="Email">
            <Mail size={22} />
          </a>
        </div>

        {sent ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
            <Check size={32} style={{ color: colors.moss, margin: "0 auto 12px" }} />
            <p className="font-medium">Message envoyé — merci !</p>
            <p className="mt-1 text-sm" style={{ color: colors.inkSoft }}>On te répond dès que possible, généralement sous 24 à 48h.</p>
            <button onClick={() => setSent(false)} className="mt-4 text-sm underline" style={{ color: colors.slate }}>Envoyer un autre message</button>
          </div>
        ) : (
          <div className="space-y-3 rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Prénom *</label>
                <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={form.prenom} onChange={(e) => patch({ prenom: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Nom *</label>
                <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={form.nom} onChange={(e) => patch({ nom: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Email *</label>
                <input type="email" className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={form.email} onChange={(e) => patch({ email: e.target.value })} placeholder="toi@exemple.fr" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Téléphone (avec indicatif)</label>
                <input type="tel" className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={form.telephone} onChange={(e) => patch({ telephone: e.target.value })} placeholder="+33 6 12 34 56 78" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Objet *</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={form.objet} onChange={(e) => patch({ objet: e.target.value })} placeholder="Ex : Question sur l'abonnement" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Message *</label>
              <textarea rows={5} className="df-textarea w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={form.message} onChange={(e) => patch({ message: e.target.value })} />
            </div>
            {error && <p className="text-sm" style={{ color: colors.brick }}>{error}</p>}
            <button
              onClick={handleSubmit}
              disabled={sending}
              className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium"
              style={{ background: colors.brass, color: colors.ink, opacity: sending ? 0.7 : 1 }}
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : null} {sending ? "Envoi…" : "Envoyer le message"}
            </button>
          </div>
        )}
        {onLegal && (
          <div className="mt-8 border-t pt-4 text-center text-xs" style={{ borderColor: colors.line, color: colors.inkSoft }}>
            <LegalLinks onLegal={onLegal} color={colors.inkSoft} />
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// ⚠️  PAGES LÉGALES — PREMIER JET, NON VALIDÉ  ⚠️
//
// Les trois textes ci-dessous (Mentions légales, Politique de
// confidentialité, Conditions générales d'utilisation) sont un BROUILLON
// rédigé à partir de l'inventaire technique du site (septembre 2026).
// Ils DOIVENT être relus et validés par un professionnel du droit avant
// toute mise en ligne réelle. Les passages entre crochets
// « [À COMPLÉTER : …] » et « [À VÉRIFIER : …] » sont à renseigner ou à
// confirmer. Ne pas considérer ce contenu comme un conseil juridique.
// ===========================================================================
const LEGAL_PAGES = {
  "mentions-legales": { title: "Mentions légales", short: "Mentions légales" },
  "confidentialite": { title: "Politique de confidentialité", short: "Confidentialité" },
  "cgu": { title: "Conditions générales d'utilisation", short: "CGU" },
};
const LEGAL_LAST_UPDATE = "[À COMPLÉTER : date de mise en ligne]";

// Petits blocs de mise en page communs aux trois pages.
function LegalH2({ children }) { return <h2 className="df-display mb-2 mt-8 text-lg font-semibold">{children}</h2>; }
function LegalP({ children }) { return <p className="mb-3 text-sm leading-relaxed" style={{ color: colors.inkSoft }}>{children}</p>; }
function LegalUl({ items }) {
  return (
    <ul className="mb-3 list-disc space-y-1 pl-5 text-sm leading-relaxed" style={{ color: colors.inkSoft }}>
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}
function LegalTodo({ children }) {
  return <span className="rounded px-1 font-semibold" style={{ background: `${colors.brick}18`, color: colors.brick }}>[{children}]</span>;
}

// Liens vers les trois pages légales (pieds de page, inscription, contact).
function LegalLinks({ onLegal, color, className = "" }) {
  if (!onLegal) return null;
  return (
    <span className={className}>
      {Object.entries(LEGAL_PAGES).map(([id, p], i) => (
        <Fragment key={id}>
          {i > 0 && " · "}
          <button onClick={() => onLegal(id)} className="underline" style={{ color }}>{p.short}</button>
        </Fragment>
      ))}
    </span>
  );
}

function LegalView({ kind, siteSettings, onBack, onLegal }) {
  const page = LEGAL_PAGES[kind] || LEGAL_PAGES["mentions-legales"];
  const site = siteSettings?.name || "Chantiflow";
  const contactEmail = siteSettings?.contactEmail || "contact@chantiflow.fr";
  useEffect(() => { window.scrollTo(0, 0); }, [kind]);

  return (
    <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
        {onBack && (
          <button onClick={onBack} className="mb-6 flex items-center gap-1 text-sm" style={{ color: colors.inkSoft }}>
            <ArrowLeft size={15} /> Retour
          </button>
        )}
        <div className="mb-6 flex flex-wrap gap-2">
          {Object.entries(LEGAL_PAGES).map(([id, p]) => (
            <button key={id} onClick={() => onLegal && onLegal(id)} className="rounded-full px-3 py-1.5 text-xs font-medium" style={{ background: id === kind ? colors.ink : colors.surface, color: id === kind ? "white" : colors.inkSoft, border: `1px solid ${id === kind ? colors.ink : colors.line}` }}>{p.short}</button>
          ))}
        </div>
        <h1 className="df-display mb-1 text-3xl font-semibold">{page.title}</h1>
        <p className="mb-6 text-xs" style={{ color: colors.inkSoft }}>Dernière mise à jour : {LEGAL_LAST_UPDATE}</p>

        {kind === "mentions-legales" && (
          <>
            <LegalH2>Éditeur du site</LegalH2>
            <LegalP>Le site {site} est édité par <LegalTodo>À COMPLÉTER : dénomination ou nom et prénom de l'éditeur</LegalTodo>, <LegalTodo>À COMPLÉTER : forme juridique (entreprise individuelle, SASU, SARL…) et, le cas échéant, capital social</LegalTodo>, immatriculée sous le numéro SIRET <LegalTodo>À COMPLÉTER : SIRET</LegalTodo> (RCS <LegalTodo>À COMPLÉTER : ville du RCS, ou « dispensé d'immatriculation » si applicable</LegalTodo>), numéro de TVA intracommunautaire <LegalTodo>À COMPLÉTER : n° de TVA, ou « non applicable » en franchise en base</LegalTodo>.</LegalP>
            <LegalP>Siège social : <LegalTodo>À COMPLÉTER : adresse postale complète</LegalTodo>. Contact : {contactEmail}, <LegalTodo>À COMPLÉTER : numéro de téléphone</LegalTodo>.</LegalP>
            <LegalH2>Directeur de la publication</LegalH2>
            <LegalP><LegalTodo>À COMPLÉTER : nom et prénom du directeur de la publication (en général le représentant légal)</LegalTodo>, joignable à l'adresse {contactEmail}.</LegalP>
            <LegalH2>Hébergement</LegalH2>
            <LegalP>Les données de l'application (base de données, authentification, fichiers, fonctions serveur) sont hébergées par Supabase Inc., <LegalTodo>À COMPLÉTER : adresse de Supabase Inc., voir supabase.com/legal</LegalTodo>, dans la région Union européenne « eu-north-1 » (Stockholm, Suède).</LegalP>
            <LegalP>Les pages du site (partie visible) sont hébergées par <LegalTodo>À COMPLÉTER : nom et adresse de l'hébergeur du site web (Vercel, Netlify, OVH…), selon l'endroit où le front est déployé</LegalTodo>.</LegalP>
            <LegalH2>Propriété intellectuelle</LegalH2>
            <LegalP>L'ensemble du site (textes, mise en page, code, nom et logo {site}) est protégé par le droit d'auteur et le droit des marques. Toute reproduction, même partielle, sans autorisation écrite de l'éditeur est interdite. Les documents (devis, factures…) créés par les utilisateurs restent la propriété de ces derniers.</LegalP>
            <LegalH2>Crédits</LegalH2>
            <LegalUl items={[
              "Icônes : bibliothèque Lucide (licence ISC).",
              "Polices de caractères : Inter, Space Grotesk et IBM Plex Mono, chargées depuis Google Fonts.",
              "Drapeaux des pays : images fournies par flagcdn.com.",
              "Polices DejaVu (licence libre) intégrées dans les fichiers Factur-X.",
            ]} />
            <LegalH2>Données personnelles</LegalH2>
            <LegalP>Le traitement des données personnelles est décrit dans la <button onClick={() => onLegal && onLegal("confidentialite")} className="underline" style={{ color: colors.brassDark }}>politique de confidentialité</button>. Pour toute demande : {contactEmail}.</LegalP>
          </>
        )}

        {kind === "confidentialite" && (
          <>
            <LegalP>Cette politique explique quelles données {site} collecte, pourquoi, avec qui elles sont partagées et combien de temps elles sont conservées. Elle s'applique au site, à l'application connectée et à l'application de bureau, qui utilisent les mêmes services.</LegalP>
            <LegalH2>1. Qui est responsable du traitement ?</LegalH2>
            <LegalP>Le responsable du traitement est l'éditeur du site, identifié dans les mentions légales : <LegalTodo>À COMPLÉTER : dénomination et adresse</LegalTodo>. Contact pour toute question relative aux données : {contactEmail}.</LegalP>
            <LegalP><LegalTodo>À VÉRIFIER avec un professionnel</LegalTodo> : pour les données des clients que vous saisissez dans vos devis et factures (nom, adresse, email de vos propres clients), vous êtes responsable de leur traitement et {site} agit comme sous-traitant, hébergeant et traitant ces données pour votre compte et selon vos instructions.</LegalP>
            <LegalH2>2. Données collectées</LegalH2>
            <LegalUl items={[
              "Compte utilisateur : adresse email, prénom, nom, nom de l'entreprise, mot de passe (stocké uniquement sous forme hachée par le service d'authentification), date de création, état de confirmation de l'email, rôle dans l'organisation.",
              "Profil de l'entreprise (« Mon entreprise ») : raison sociale, SIRET, adresse, code postal, ville, pays, email, téléphone, numéro de TVA, IBAN et BIC (optionnels), logo, lien d'avis Google (optionnel).",
              "Fiches clients et documents : nom, adresse, code postal, ville, pays, email, téléphone, SIRET et numéro de TVA des clients ; contenu des devis, factures et autres documents (lignes, montants, notes, chantier).",
              "Signatures : nom saisi ou image de la signature (dessinée à l'écran ou importée), y compris lors d'une signature à distance par le client via un lien ou un QR code, avec la date de signature.",
              "Photos de chantier ajoutées aux rapports d'intervention, PV de réception et situations de travaux (fichiers image, réduits avant envoi).",
              "Équipe et planning : email des membres invités, rôle, créneaux du planning (titre, dates, membre, chantier).",
              "Abonnement : forfait, cycle de facturation, identifiants techniques de client et d'abonnement chez Stripe ou PayPal, dates de paiement et d'expiration. Aucun numéro de carte bancaire n'est stocké par le site.",
              "Formulaire de contact : prénom, nom, email, téléphone (optionnel), objet et message, enregistrés en base et transmis par email à l'éditeur.",
              "Clés d'accès API (forfait Entreprise) : nom de la clé, empreinte hachée (jamais la clé en clair), date de dernière utilisation, compteur d'appels par minute.",
              "Liens publics de signature ou de paiement : jeton aléatoire, dates de signature et de paiement.",
              "Journaux techniques du service d'hébergement (adresses IP, horodatages des requêtes), conservés par Supabase pour la sécurité et le diagnostic.",
            ]} />
            <LegalH2>3. Pourquoi ces données sont utilisées</LegalH2>
            <LegalUl items={[
              "Fournir le service : créer un compte, produire et stocker les documents, les exporter en PDF, Excel ou Factur-X, faire signer ou payer un document en ligne (exécution du contrat).",
              "Gérer l'abonnement et les paiements (exécution du contrat, obligations comptables).",
              "Envoyer les emails de fonctionnement : confirmation de l'adresse email, relances de factures impayées (forfaits Pro et Entreprise, jamais plus d'une par semaine et par facture), demande d'avis Google déclenchée manuellement par vous, réponse à vos messages de contact.",
              "Proposer des lignes de devis grâce à une intelligence artificielle, uniquement à votre demande explicite.",
              "Proposer un pays et une devise par défaut lors de la première visite.",
              "Assurer la sécurité du service, prévenir les abus et diagnostiquer les pannes (intérêt légitime).",
            ]} />
            <LegalH2>4. Services tiers qui reçoivent des données</LegalH2>
            <LegalP>Le site fait appel aux prestataires suivants. Les pays d'établissement et les garanties de transfert hors Union européenne sont à confirmer : <LegalTodo>À VÉRIFIER : localisation et clauses contractuelles de chaque prestataire</LegalTodo>.</LegalP>
            <LegalUl items={[
              "Supabase (hébergement de la base de données, authentification, stockage des photos, fonctions serveur) : ensemble des données, région Union européenne (Stockholm, Suède).",
              "Stripe (paiement par carte) : votre adresse email et l'identifiant de votre organisation lors de la souscription d'un abonnement ; pour le paiement d'une facture par un client, le numéro de la facture et son montant. Les données de carte sont saisies directement sur les pages de Stripe.",
              "PayPal (paiement de l'abonnement) : identifiant de votre organisation ; le paiement se fait sur les pages de PayPal, dont le script est chargé sur la page Tarifs.",
              "Resend (envoi des emails) : adresse email du destinataire, contenu de l'email (numéro de facture, montant, nom du client, lien d'avis, votre message de contact).",
              "Google (Gemini, intelligence artificielle) : uniquement le texte de description du chantier que vous saisissez dans la fenêtre « Suggestions IA ». Aucune donnée de compte, de client ni de montant n'est envoyée.",
              "GeoJS (détection du pays) : lors de la première visite, l'adresse IP est transmise au service GeoJS afin de proposer un pays et une devise par défaut ; aucune autre donnée n'est envoyée et le résultat est conservé 30 jours sur l'appareil.",
              "Google Fonts (polices de caractères) et flagcdn.com (images de drapeaux) : votre navigateur charge ces ressources directement, ce qui transmet votre adresse IP à ces services.",
              "INSEE (indices de révision de prix) : appel effectué par le serveur, sans aucune donnée personnelle.",
            ]} />
            <LegalH2>5. Ce qui est enregistré sur votre appareil</LegalH2>
            <LegalP>Le site n'utilise pas de cookies de suivi ni de mesure d'audience. Il utilise le stockage local du navigateur (localStorage), qui n'est jamais transmis à un tiers, pour :</LegalP>
            <LegalUl items={[
              "la session de connexion (jeton fourni par le service d'authentification) ;",
              "vos préférences d'affichage : mode sombre, dernière page et dernier document ouverts, dernier onglet d'administration ;",
              "une copie de vos documents, clients, prestations et profil d'entreprise, pour consultation en lecture seule en cas de coupure réseau (mode hors ligne), mise à jour à chaque chargement réussi ;",
              "le pays détecté lors de la première visite, conservé 30 jours.",
            ]} />
            <LegalP>L'application peut être installée sur l'écran d'accueil (application web progressive) : le navigateur garde alors en cache les fichiers de l'application, pas vos données. Le script de paiement PayPal, chargé sur la page Tarifs, peut déposer ses propres cookies : <LegalTodo>À VÉRIFIER : cookies déposés par PayPal et information à donner</LegalTodo>.</LegalP>
            <LegalH2>6. Durées de conservation</LegalH2>
            <LegalUl items={[
              "Compte non confirmé : supprimé automatiquement 8 semaines après sa création.",
              "Compte confirmé, documents, clients, photos : conservés tant que le compte existe. Un document supprimé par vous est supprimé immédiatement, ainsi que ses photos.",
              "Abonnement résilié : l'accès est maintenu jusqu'à la fin de la période payée, puis le compte repasse automatiquement au forfait Gratuit ; les données ne sont pas supprimées.",
              "Factures : à conserver 10 ans au titre des obligations comptables — cette durée s'applique à vos propres obligations en tant qu'émetteur ; " + "[À VÉRIFIER : durée de conservation par le site après suppression du compte]",
              "Messages du formulaire de contact : [À COMPLÉTER : durée, par exemple 12 mois].",
              "Données de facturation de l'abonnement (chez Stripe et PayPal) : selon leurs propres politiques et les obligations comptables.",
            ]} />
            <LegalH2>7. Vos droits</LegalH2>
            <LegalP>Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité de vos données, ainsi que du droit de définir des directives après votre décès. Vous pouvez modifier vous-même la plupart de vos données depuis l'application (Mon entreprise, Mon compte, Clients). Pour exercer un autre droit, notamment la suppression complète de votre compte, écrivez à {contactEmail} : la demande est traitée dans un délai de <LegalTodo>À COMPLÉTER : délai, un mois maximum selon le RGPD</LegalTodo>. Vous pouvez aussi introduire une réclamation auprès de la CNIL (cnil.fr).</LegalP>
            <LegalH2>8. Sécurité</LegalH2>
            <LegalP>Les échanges sont chiffrés (HTTPS). Les mots de passe ne sont jamais stockés en clair. L'accès aux données est cloisonné par organisation au niveau de la base de données, et les photos de chantier sont stockées dans un espace privé accessible uniquement aux membres de l'organisation, via des liens temporaires. Les clés API ne sont conservées que sous forme hachée.</LegalP>
            <LegalH2>9. Modifications</LegalH2>
            <LegalP>Cette politique peut être mise à jour ; la date en tête de page indique la dernière version. En cas de changement important, vous en serez informé dans l'application ou par email.</LegalP>
          </>
        )}

        {kind === "cgu" && (
          <>
            <LegalH2>1. Objet</LegalH2>
            <LegalP>Les présentes conditions régissent l'utilisation du service {site}, un outil en ligne de gestion administrative pour les artisans et entreprises du bâtiment : création de devis, factures, factures d'acompte, avoirs, bons de commande et de livraison, situations de travaux, PV de réception, rapports d'intervention, contrats, relances, plannings, bordereaux de prix et révisions de prix ; signature et paiement en ligne ; suivi des chantiers et de l'équipe. En créant un compte, vous acceptez ces conditions.</LegalP>
            <LegalH2>2. Inscription et compte</LegalH2>
            <LegalUl items={[
              "L'inscription nécessite une adresse email valide, un mot de passe et le nom de votre entreprise. Un email de confirmation vous est envoyé ; un compte non confirmé est supprimé au bout de 8 semaines.",
              "Le service est réservé à un usage professionnel. Vous garantissez l'exactitude des informations fournies, notamment celles qui figurent sur vos documents (identité, SIRET, TVA, mentions obligatoires).",
              "Vous êtes responsable de la confidentialité de votre mot de passe et de toute activité réalisée depuis votre compte. Vous pouvez inviter des membres dans votre organisation et leur attribuer un rôle ; vous restez responsable de leurs actions.",
            ]} />
            <LegalH2>3. Forfaits, paiement et résiliation</LegalH2>
            <LegalUl items={[
              "Forfait Gratuit : sans carte bancaire, limité à un nombre de documents indiqué sur la page Tarifs (3 par défaut). Au-delà, le compte passe en lecture seule jusqu'au choix d'un forfait payant.",
              "Forfaits payants (Essentiel, Pro, Entreprise) : abonnement mensuel ou annuel, aux tarifs affichés sur la page Tarifs au moment de la souscription — ces tarifs font foi. [À VÉRIFIER : tarifs hors taxes ou toutes taxes comprises, et mention de la TVA applicable]",
              "Le paiement s'effectue par carte bancaire via Stripe ou via PayPal. L'abonnement se renouvelle automatiquement à chaque échéance jusqu'à résiliation.",
              "Résiliation : possible à tout moment depuis la page Abonnement. L'accès aux fonctionnalités du forfait est conservé jusqu'à la fin de la période déjà payée, puis le compte repasse automatiquement au forfait Gratuit, sans suppression des données. Les périodes entamées ne sont pas remboursées. [À VÉRIFIER : droit de rétractation de 14 jours pour les professionnels dans certains cas, et politique de remboursement]",
              "L'éditeur peut modifier les tarifs ; les nouveaux tarifs s'appliquent au renouvellement suivant, après information préalable. [À COMPLÉTER : délai de préavis]",
            ]} />
            <LegalH2>4. Obligations de l'utilisateur</LegalH2>
            <LegalUl items={[
              "Utiliser le service conformément à la loi, notamment aux règles de facturation et de TVA applicables à votre activité. Le service propose des mentions et des calculs standards ; leur adéquation à votre situation relève de votre responsabilité et, si besoin, de celle de votre comptable.",
              "Ne pas saisir de contenu illicite, ne pas usurper l'identité d'un tiers, ne pas tenter d'accéder aux données d'autres organisations, ne pas surcharger ou contourner le service (y compris via l'API).",
              "Recueillir, lorsque c'est nécessaire, le consentement de vos clients avant de leur envoyer des emails depuis le service (relances, demande d'avis) et respecter vos propres obligations en matière de données personnelles.",
            ]} />
            <LegalH2>5. Signature et paiement en ligne</LegalH2>
            <LegalP>Le service permet à vos clients de signer un devis (nom saisi ou signature dessinée) et de payer une facture depuis un lien ou un QR code, sans compte. La signature enregistrée est une signature électronique « simple » : le service conserve le nom ou le dessin, la date et le lien utilisé. <LegalTodo>À VÉRIFIER avec un professionnel : valeur probante de cette signature et mentions à ajouter (horodatage, identification du signataire)</LegalTodo>. Le paiement est réalisé par Stripe ; le service n'encaisse pas les fonds pour votre compte.</LegalP>
            <LegalH2>6. Facturation électronique</LegalH2>
            <LegalP>Le service permet de télécharger vos factures au format Factur-X. La transmission à une plateforme agréée, prévue par la réforme de la facturation électronique, n'est pas encore assurée par le service et reste à votre charge tant qu'elle n'est pas proposée.</LegalP>
            <LegalH2>7. Disponibilité et responsabilité</LegalH2>
            <LegalUl items={[
              "L'éditeur s'efforce de maintenir le service accessible en permanence mais ne garantit pas une disponibilité ininterrompue (maintenance, panne, incident chez un prestataire). Une copie en lecture seule de vos données reste consultable sur votre appareil en cas de coupure.",
              "Le service est un outil d'aide à la gestion. Il ne constitue pas un conseil juridique, comptable ou fiscal. L'éditeur ne peut être tenu responsable des erreurs contenues dans les documents que vous produisez, des retards de paiement de vos clients ni de l'usage que vous faites des documents.",
              "Vous êtes invité à exporter régulièrement vos documents (PDF, Excel) : l'éditeur ne pourra être tenu responsable d'une perte de données au-delà de ce que prévoit la loi. [À VÉRIFIER : plafond de responsabilité, par exemple le montant payé au cours des 12 derniers mois]",
              "Les suggestions générées par intelligence artificielle sont des propositions à vérifier et à corriger avant utilisation.",
            ]} />
            <LegalH2>8. Propriété intellectuelle</LegalH2>
            <LegalP>Le service, son code, son nom et son logo appartiennent à l'éditeur. Vous disposez d'un droit d'utilisation personnel et non exclusif pendant la durée de votre compte. Les documents et données que vous créez restent votre propriété ; vous accordez à l'éditeur le droit de les héberger et de les traiter uniquement pour fournir le service.</LegalP>
            <LegalH2>9. Suspension et suppression</LegalH2>
            <LegalP>En cas de manquement grave aux présentes conditions (fraude, contenu illicite, tentative d'intrusion), l'éditeur peut suspendre ou fermer le compte après vous en avoir informé, sauf urgence. Vous pouvez demander la suppression de votre compte à tout moment à {contactEmail}.</LegalP>
            <LegalH2>10. Droit applicable et litiges</LegalH2>
            <LegalP>Les présentes conditions sont soumises au droit français. En cas de litige, les parties rechercheront d'abord une solution amiable. <LegalTodo>À COMPLÉTER : juridiction compétente et, si le service s'adresse aussi à des consommateurs, coordonnées du médiateur de la consommation</LegalTodo>.</LegalP>
            <LegalH2>11. Contact</LegalH2>
            <LegalP>Pour toute question sur ces conditions : {contactEmail}.</LegalP>
          </>
        )}

        <div className="mt-10 border-t pt-4 text-xs" style={{ borderColor: colors.line, color: colors.inkSoft }}>
          <LegalLinks onLegal={onLegal} color={colors.inkSoft} />
        </div>
      </div>
    </div>
  );
}

// Nouvelle version, plus avancée, de la page d'accueil — activable
// depuis Admin → Apparence du site, sans jamais toucher à l'ancienne
// (gardée intacte juste après, voir LandingPage) ni à aucune logique
// des services du site : uniquement de la présentation (HTML/CSS).
function LandingPageAvancee({ plans, siteSettings, onGetStarted, onLogin, onContact, onLegal }) {
  const [mobileMenu, setMobileMenu] = useState(false);
  const visiblePlans = plans.filter((p) => !p.hidden);
  return (
    <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.surface, color: adv.ink }}>
      <GlobalStyle />

      {/* Barre de navigation */}
      <nav className="flex items-center justify-between border-b px-6 py-4 sm:px-10 lg:px-16" style={{ borderColor: colors.line }}>
        <div className="flex items-center gap-2.5">
          {siteSettings?.logo ? (
            <img src={siteSettings.logo} alt={siteSettings.name} style={{ width: siteSettings.logoWidth || 34, height: siteSettings.logoHeight || 34, objectFit: "contain" }} />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg df-display text-sm font-bold" style={{ background: adv.accent, color: "white" }}>{initials(siteSettings?.name) || "C"}</div>
          )}
          <span className="df-display text-lg font-bold">{siteSettings?.name || "Chantiflow"}</span>
        </div>
        <div className="hidden items-center gap-8 text-sm font-medium lg:flex" style={{ color: adv.inkSoft }}>
          <a href="#fonctionnalites">Fonctionnalités</a>
          <a href="#tarifs">Tarifs</a>
          <a href="#faq">FAQ</a>
          <button onClick={onContact}>Contacter</button>
        </div>
        <div className="hidden items-center gap-3 lg:flex">
          <button onClick={onLogin} className="text-sm font-semibold">Connexion</button>
          <button onClick={onGetStarted} className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white" style={{ background: adv.accent }}>Essai gratuit</button>
        </div>
        <button onClick={() => setMobileMenu((v) => !v)} className="lg:hidden" title="Menu" aria-label="Ouvrir le menu"><Menu size={22} /></button>
      </nav>
      {mobileMenu && (
        <div className="flex flex-col gap-4 border-b px-6 py-5 lg:hidden" style={{ borderColor: colors.line }}>
          <a href="#fonctionnalites" onClick={() => setMobileMenu(false)} className="text-sm font-medium">Fonctionnalités</a>
          <a href="#tarifs" onClick={() => setMobileMenu(false)} className="text-sm font-medium">Tarifs</a>
          <button onClick={onContact} className="text-left text-sm font-medium">Contacter</button>
          <button onClick={onLogin} className="text-left text-sm font-semibold">Connexion</button>
          <button onClick={onGetStarted} className="rounded-lg px-4 py-2.5 text-center text-sm font-semibold text-white" style={{ background: adv.accent }}>Essai gratuit</button>
        </div>
      )}

      {/* Hero */}
      <section className="px-6 pb-16 pt-16 text-center sm:px-10 sm:pt-20 lg:px-16">
        <div className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold sm:text-sm" style={{ background: colors.paper, color: adv.inkSoft }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: colors.moss }} /> Nouveau : logiciel de bureau Mac & Windows
        </div>
        <h1 className="df-display mx-auto max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-[58px]">
          La gestion administrative, <span style={{ color: adv.accent }}>enfin simple</span> pour votre activité
        </h1>
        <p className="mx-auto mt-6 max-w-lg text-base sm:text-lg" style={{ color: adv.inkSoft }}>
          Devis, factures, bons de commande et bien plus — créés en quelques clics, pensés pour les artisans et indépendants qui n'ont pas de temps à perdre.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button onClick={onGetStarted} className="flex w-full items-center justify-center gap-2 rounded-xl px-7 py-3.5 text-base font-semibold text-white sm:w-auto" style={{ background: adv.accent }}>
            Essayer gratuitement <ArrowRight size={17} />
          </button>
          <a href="#fonctionnalites" className="w-full rounded-xl border px-7 py-3.5 text-center text-base font-semibold sm:w-auto" style={{ borderColor: colors.line }}>Voir les fonctionnalités</a>
        </div>
        <p className="mt-4 text-xs sm:text-sm" style={{ color: adv.inkSoft }}>Sans carte bancaire — configuré en 2 minutes</p>

        {/* Aperçu produit stylisé */}
        <div className="mx-auto mt-14 max-w-4xl rounded-2xl border p-2.5 sm:p-3.5" style={{ background: adv.paper, borderColor: adv.line }}>
          <div className="flex flex-col gap-4 rounded-xl p-5 sm:flex-row sm:p-7" style={{ background: colors.paper }}>
            <div className="hidden w-32 shrink-0 flex-col gap-2.5 sm:flex">
              {[70, 90, 60, 80].map((w, i) => <div key={i} className="h-3 rounded" style={{ width: `${w}%`, background: "rgba(27,42,51,0.1)" }} />)}
            </div>
            <div className="flex-1 rounded-lg p-5 text-left" style={{ background: colors.surface }}>
              <div className="mb-4 h-4 w-2/5 rounded" style={{ background: colors.paper }} />
              <div className="mb-2.5 h-3 w-4/5 rounded" style={{ background: colors.paper }} />
              <div className="mb-4 h-3 w-3/5 rounded" style={{ background: colors.paper }} />
              <div className="flex items-center justify-between rounded-lg px-4 py-3 font-bold" style={{ background: colors.paper }}>
                <span>Total TTC</span><span>3 450,00 €</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Fonctionnalités */}
      <section id="fonctionnalites" className="px-6 py-20 sm:px-10 lg:px-16" style={{ background: colors.paper }}>
        <div className="mx-auto mb-14 max-w-xl text-center">
          <div className="mb-3 text-xs font-bold uppercase tracking-widest sm:text-sm" style={{ color: adv.accent }}>Fonctionnalités</div>
          <h2 className="df-display text-3xl font-bold tracking-tight sm:text-4xl">Tout ce qu'il faut, rien de superflu</h2>
          <p className="mt-3 text-base sm:text-lg" style={{ color: adv.inkSoft }}>Chaque outil est pensé pour un vrai besoin du métier, pas pour impressionner.</p>
        </div>
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: FileText, title: "Devis & factures", desc: "Créés en quelques minutes, envoyés en un clic, toujours professionnels." },
            { icon: ClipboardCheck, title: "Bons de commande", desc: "Gérez vos commandes fournisseurs sans jongler entre plusieurs outils." },
            { icon: Users, title: "Suivi clients", desc: "Toutes vos coordonnées et l'historique de chaque client, au même endroit." },
            { icon: TrendingUp, title: "Révisions de prix", desc: "Calculs automatiques, conformes aux indices officiels du secteur." },
            { icon: Monitor, title: "Logiciel de bureau", desc: "Disponible aussi en application Mac et Windows, avec mise à jour automatique." },
            { icon: Lock, title: "Sécurisé", desc: "Vos données et celles de vos clients, protégées et jamais partagées." },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-2xl p-6" style={{ background: colors.surface }}>
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: adv.accentSoft, color: adv.accent }}><Icon size={20} /></div>
              <h3 className="mb-1.5 text-base font-bold">{title}</h3>
              <p className="text-sm" style={{ color: adv.inkSoft }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Tarifs (réutilise la logique existante, juste la présentation) */}
      <section id="tarifs" className="px-6 py-20 sm:px-10 lg:px-16">
        <div className="mx-auto mb-14 max-w-xl text-center">
          <div className="mb-3 text-xs font-bold uppercase tracking-widest sm:text-sm" style={{ color: adv.accent }}>Tarifs</div>
          <h2 className="df-display text-3xl font-bold tracking-tight sm:text-4xl">Un tarif simple, sans surprise</h2>
        </div>
        <div className="mx-auto flex max-w-5xl flex-wrap justify-center gap-5">
          {visiblePlans.map((plan) => (
            <div key={plan.id} className="w-full max-w-xs rounded-2xl p-6" style={{ border: `1px solid ${colors.line}` }}>
              <h3 className="df-display text-lg font-bold">{plan.name}</h3>
              <div className="my-3">
                {plan.monthly === null || plan.monthly === undefined ? (
                  <span className="df-display text-xl font-bold">Sur devis</span>
                ) : (
                  <><span className="df-display text-3xl font-bold">{plan.monthly}€</span><span className="text-sm" style={{ color: adv.inkSoft }}> /mois</span></>
                )}
              </div>
              <button onClick={onGetStarted} className="mt-2 w-full rounded-lg py-2.5 text-sm font-semibold" style={{ background: colors.paper, color: adv.ink }}>Choisir</button>
            </div>
          ))}
        </div>
      </section>

      {/* Appel à l'action final */}
      <section className="mx-6 mb-20 rounded-3xl px-6 py-14 text-center sm:mx-10 sm:px-10 lg:mx-16">
        <div className="rounded-3xl px-6 py-14" style={{ background: adv.accent }}>
          <h2 className="df-display text-2xl font-bold text-white sm:text-3xl">Prêt à simplifier votre gestion ?</h2>
          <p className="mt-3 text-sm sm:text-base" style={{ color: "rgba(255,255,255,0.7)" }}>Essai gratuit, sans carte bancaire, configuré en 2 minutes.</p>
          <button onClick={onGetStarted} className="mt-7 rounded-xl px-8 py-3.5 text-base font-bold" style={{ background: adv.accent, color: adv.ink }}>Créer mon compte gratuitement</button>
        </div>
      </section>

      <footer className="border-t px-6 py-8 text-center text-xs sm:px-10 lg:px-16" style={{ borderColor: colors.line, color: adv.inkSoft }}>
        © 2026 {siteSettings?.name || "Chantiflow"} — <button onClick={onContact} className="underline" style={{ color: adv.inkSoft }}>Nous contacter</button>
        {onLegal && <> · <LegalLinks onLegal={onLegal} color={adv.inkSoft} /></>}
      </footer>
    </div>
  );
}

function LandingPage({ plans, siteSettings, onGetStarted, onLogin, onContact, onLegal }) {
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
    <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
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
            <button onClick={onContact}>Contacter</button>
          </nav>
          <div className="hidden items-center gap-3 sm:flex">
            <button onClick={onLogin} className="text-sm font-medium" style={{ color: colors.inkSoft }}>Connexion</button>
            <button onClick={onGetStarted} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ background: colors.brass, color: colors.ink }}>Essai gratuit</button>
          </div>
          <button onClick={() => setMobileMenu((v) => !v)} className="sm:hidden" title="Menu" aria-label="Ouvrir le menu"><Menu size={22} /></button>
        </div>
        {mobileMenu && (
          <div className="flex flex-col gap-3 border-t px-6 py-4 sm:hidden" style={{ borderColor: colors.line }}>
            <a href="#fonctionnalites" onClick={() => setMobileMenu(false)} className="text-sm font-medium">Fonctionnalités</a>
            <a href="#tarifs" onClick={() => setMobileMenu(false)} className="text-sm font-medium">Tarifs</a>
            <button onClick={onContact} className="text-left text-sm font-medium">Contacter</button>
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
        <div className="mx-auto max-w-4xl rounded-2xl p-10 text-center" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.ink, color: "white" }}>
          <h2 className="df-display text-2xl font-semibold sm:text-3xl">Prêt à arrêter de perdre du temps sur vos devis ?</h2>
          <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>Créez votre compte en une minute, sans carte bancaire.</p>
          <button onClick={onGetStarted} className="mt-6 rounded-lg px-6 py-3 text-sm font-medium" style={{ background: colors.brass, color: colors.ink }}>Commencer gratuitement</button>
        </div>
      </section>

      <footer className="border-t px-6 py-8 text-center text-xs" style={{ borderColor: colors.line, color: colors.inkSoft }}>
        © 2026 {siteSettings.name} — <button onClick={onContact} className="underline" style={{ color: colors.inkSoft }}>Nous contacter</button>
        {onLegal && <> · <LegalLinks onLegal={onLegal} color={colors.inkSoft} /></>}
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
    <div className="df-root flex min-h-full w-full items-center justify-center px-4 py-16" style={{ backgroundColor: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          {siteSettings?.logo ? (
            <img src={siteSettings.logo} alt={siteSettings.name} style={{ width: siteSettings.logoWidth, height: siteSettings.logoHeight, objectFit: "contain" }} />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg df-mono text-base font-semibold" style={{ background: colors.brass, color: colors.ink }}>{initials(siteSettings?.name) || "DF"}</div>
          )}
          <span className="df-display text-xl font-semibold tracking-wide">{siteSettings?.name || "Chantiflow"}</span>
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

// Affiché à la place du site normal quand le forfait d'un compte,
// activé gratuitement via "Activer (0€)", a depuis reçu un vrai prix
// — la personne doit régulariser (choisir mensuel/annuel, payer
// réellement) pour continuer. Ne s'affiche jamais pour un vrai
// paiement déjà effectué.
function RegularizationScreen({ account, plans, siteSettings, onLogout, onContact }) {
  const [billing, setBilling] = useState(account.billing || "mensuel");
  const plan = plans.find((p) => p.id === account.plan);
  const price = billing === "annuel" ? plan?.annual : plan?.monthly;
  const paypalPlanId = billing === "annuel" ? plan?.paypalPlanIdAnnual : plan?.paypalPlanIdMonthly;
  const stripePriceId = billing === "annuel" ? plan?.stripePriceIdAnnual : plan?.stripePriceIdMonthly;
  const showCard = plan?.cardPaymentEnabled && !!stripePriceId;
  const showPaypal = !!paypalPlanId && plan?.paypalPaymentEnabled;

  return (
    <div className="flex min-h-full w-full items-center justify-center px-4 py-12" style={{ background: colors.paper }}>
      <GlobalStyle />
      <div className="w-full max-w-md rounded-2xl p-6" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
        <div className="mb-4 flex items-center gap-2" style={{ color: colors.brick }}>
          <AlertTriangle size={20} />
          <h1 className="df-display text-lg font-semibold">Mise à jour du tarif</h1>
        </div>
        <p className="mb-5 text-sm" style={{ color: colors.inkSoft }}>
          Le forfait <strong>{plan?.name || account.plan}</strong> que tu utilises était gratuit au moment où tu l'as activé — il a depuis un vrai tarif. Pour continuer à l'utiliser, merci de régulariser ton abonnement.
        </p>

        <div className="mb-4 flex rounded-lg p-1" style={{ background: colors.paper }}>
          <button onClick={() => setBilling("mensuel")} className="flex-1 rounded-md py-1.5 text-xs font-medium" style={{ background: billing === "mensuel" ? colors.surface : "transparent", boxShadow: billing === "mensuel" ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}>Mensuel</button>
          <button onClick={() => setBilling("annuel")} className="flex-1 rounded-md py-1.5 text-xs font-medium" style={{ background: billing === "annuel" ? colors.surface : "transparent", boxShadow: billing === "annuel" ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}>Annuel</button>
        </div>

        <div className="mb-5 text-center">
          <span className="df-display text-2xl font-bold">{price}€</span>
          <span className="text-sm" style={{ color: colors.inkSoft }}> / {billing === "annuel" ? "an" : "mois"}</span>
        </div>

        {showCard || showPaypal ? (
          <div className="flex flex-col gap-2">
            {showCard && <StripeCheckoutButton planId={plan.id} billingCycle={billing} organizationId={account.organizationId} />}
            {showPaypal && <PayPalButton planId={paypalPlanId} organizationId={account.organizationId} onApproved={() => window.location.reload()} />}
          </div>
        ) : (
          <button onClick={onContact} className="w-full rounded-lg py-2 text-center text-xs underline" style={{ background: colors.paper, color: colors.inkSoft }}>Paiement bientôt disponible — contacte-nous en attendant</button>
        )}

        <button onClick={onContact} className="mt-4 w-full text-center text-xs underline" style={{ color: colors.slate }}>Nous contacter</button>
        <button onClick={onLogout} className="mt-2 w-full text-center text-xs underline" style={{ color: colors.inkSoft }}>Se déconnecter</button>
      </div>
    </div>
  );
}

function AuthScreen({ initialMode = "signup", onBack, siteSettings, onLegal }) {
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
        setError(checkError.message || "Une erreur est survenue. Réessaie.");
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
          // Force la confirmation côté Supabase EN PREMIER, avant tout
          // le reste — pour que la connexion ne dépende JAMAIS du
          // réglage "Confirm email" du tableau de bord (fragile), même
          // si une étape suivante (création de l'organisation) échoue.
          // Sans ça, un échec plus loin empêchait cette étape de
          // s'exécuter, laissant le compte durablement bloqué.
          const { data: confirmData, error: confirmError } = await db.functions.invoke("auto-confirm-user", { body: { userId: data.user.id } });
          if (confirmError) {
            let realMessage = confirmData?.error;
            if (!realMessage && confirmError?.context) {
              try { realMessage = (await new Response(confirmError.context.body).json())?.error; } catch { /* ignore */ }
              if (!realMessage) { try { realMessage = await confirmError.context.clone().text(); } catch { /* ignore */ } }
            }
            console.error("[Confirmation forcée] ÉCHEC — détail complet :", { confirmData, confirmError, realMessage });
          } else {
            console.log("[Confirmation forcée] Succès à l'inscription :", confirmData);
          }

          // Crée l'organisation du nouvel inscrit, dont il devient
          // aussitôt propriétaire — c'est elle qui portera l'abonnement
          // et les données, éventuellement partagées avec une équipe plus tard.
          // ensure_user_has_organization garantit qu'aucun doublon
          // n'est jamais créé, même en cas de tentatives rapprochées
          // (verrou côté base de données — voir
          // migration_organisation_atomique.sql). Important : si ça
          // échoue malgré tout, on ne laisse jamais l'inscription
          // "réussir" silencieusement.
          //
          // S'assure d'abord que la session est bien pleinement établie
          // — juste après signUp(), il peut y avoir un très bref
          // instant où elle n'est pas encore attachée aux appels
          // suivants, ce qui ferait échouer cet appel avec un 401 même
          // si tout est par ailleurs correctement configuré.
          for (let attempt = 0; attempt < 5; attempt++) {
            const { data: sessionCheck } = await db.auth.getSession();
            if (sessionCheck?.session?.access_token) break;
            await new Promise((r) => setTimeout(r, 200));
          }
          const { error: orgError } = await db.rpc("ensure_user_has_organization", {
            target_user_id: data.user.id,
            fallback_name: companyName.trim() || cleanEmail,
          });
          if (orgError) {
            console.error("Erreur de création de l'organisation", orgError);
            setError("Ton compte a été créé, mais la mise en place de ton espace a rencontré un souci. Déconnecte-toi puis reconnecte-toi pour réessayer automatiquement — si ça persiste, contacte-nous.");
            setBusy(false);
            return;
          }

          // Le compte fonctionne tout de suite (confirmation par email
          // désactivée côté Supabase), mais on envoie quand même un
          // email de confirmation "maison" — 8 semaines pour cliquer,
          // sinon suppression automatique (voir Admin → Utilisateurs).
          db.functions.invoke("send-confirmation-email", { body: { userId: data.user.id } })
            .then((res) => console.log("[Confirmation email] Envoi à l'inscription — résultat :", res))
            .catch((e) => console.error("Erreur d'envoi de l'email de confirmation", e));
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
        if (signInError) {
          console.error("[Connexion] Erreur exacte de Supabase :", signInError);
          // Message précis selon la vraie cause plutôt qu'un message
          // générique qui masquerait des situations très différentes
          // (mot de passe faux, email jamais confirmé si jamais ce
          // réglage venait à être réactivé côté Supabase, etc.).
          const code = signInError.message || "";
          if (code.toLowerCase().includes("email not confirmed")) {
            setError("Ce compte n'est pas encore confirmé côté Supabase (réglage \"Confirm email\"). Vérifie que ce réglage est bien désactivé dans Authentication → Providers → Email.");
          } else if (code.toLowerCase().includes("invalid login credentials")) {
            setError("Email ou mot de passe incorrect.");
          } else {
            setError(`Impossible de se connecter : ${code || "erreur inconnue"}`);
          }
          setBusy(false);
          return;
        }
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
    <div className="df-root flex min-h-full w-full items-center justify-center px-4 py-16" style={{ backgroundColor: colors.paper, color: colors.ink }}>
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
          <span className="df-display text-xl font-semibold tracking-wide">{siteSettings?.name || "Chantiflow"}</span>
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
        {onLegal && (
          <p className="mt-2 text-center text-xs" style={{ color: colors.inkSoft }}>
            En créant un compte, tu acceptes les <button onClick={() => onLegal("cgu")} className="underline">conditions générales d'utilisation</button> et la <button onClick={() => onLegal("confidentialite")} className="underline">politique de confidentialité</button>.
          </p>
        )}
      </div>
    </div>
  );
}

function TopNav({ view, setView, onNewDevis, onNewFacture, onNewProforma, onNewRevision, onNewService, visibleServices, account, onLogout, onSwitchOrganization, onCreateOwnOrg, creatingOwnOrg, siteSettings, companyProfile, onSetCompanyType, commandPaletteOpen, setCommandPaletteOpen, paletteCommands, darkMode, setDarkMode }) {
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [servicesMenuOpen, setServicesMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);
  useEscapeToClose(orgMenuOpen, () => setOrgMenuOpen(false));
  useEscapeToClose(servicesMenuOpen, () => setServicesMenuOpen(false));
  useEscapeToClose(mobileNavOpen, () => setMobileNavOpen(false));
  useEscapeToClose(desktopMenuOpen, () => setDesktopMenuOpen(false));
  const mainTabs = [
    { id: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    { id: "chantiers", label: "Chantiers", icon: MapPinned },
    { id: "planning-equipe", label: "Planning", icon: Calendar },
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
  const isAdvanced = siteSettings?.landingPageVersion === "avancee";
  const navBg = isAdvanced ? (darkMode ? "linear-gradient(to bottom, #2A3241, #1B212C)" : adv.sidebarBg) : colors.ink;
  const navLine = darkMode ? "#3A4353" : adv.line;
  // Pastille active : fond indigo clair + texte indigo en version
  // avancée (simple, clair, un seul accent) — transparence blanche
  // sur fond sombre sinon (comportement d'origine, inchangé).
  const activeTabStyle = isAdvanced
    ? { background: darkMode ? "#38363F" : adv.accentSoft, color: darkMode ? "#C7C4FF" : adv.accent }
    : { background: "rgba(255,255,255,0.12)", color: "white" };
  const inactiveTabStyle = isAdvanced
    ? { background: "transparent", color: darkMode ? "#9AA5B5" : adv.inkSoft }
    : { background: "transparent", color: "rgba(255,255,255,0.65)" };
  function tabStyle(isActive) { return isActive ? activeTabStyle : inactiveTabStyle; }
  if (isAdvanced) {
    // Contenu de navigation partagé entre la barre latérale (grand
    // écran) et le menu déroulant mobile — évite d'avoir deux fois la
    // même liste à maintenir séparément.
    const orgSwitcher = (() => {
      const memberships = account?.memberships || [];
      const hasOwnOrg = memberships.some((m) => m.role === "owner");
      return (
        <div className="relative">
          <button
            onClick={() => setOrgMenuOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium"
            style={{ background: darkMode ? "#262D3A" : adv.paper, color: darkMode ? "#E8EAED" : adv.ink }}
            title="Changer d'organisation"
          >
            <span className="flex items-center gap-1.5 truncate"><Building2 size={12} /> Organisations</span>
            <span className="flex shrink-0 items-center gap-1">
              <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: adv.line }}>{ROLE_LABELS[account.role] || account.role}</span>
              <ChevronDown size={11} />
            </span>
          </button>
          {orgMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOrgMenuOpen(false)} />
              <div className="absolute left-0 top-full z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg py-1 shadow-lg" style={{ background: darkMode ? "#262D3A" : "white", border: `1px solid ${darkMode ? "#3A4353" : adv.line}` }}>
                {memberships.map((m) => (
                  <button key={m.organizationId} onClick={() => { onSwitchOrganization(m.organizationId); setOrgMenuOpen(false); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs" style={{ background: m.organizationId === account.organizationId ? (darkMode ? "#262D3A" : adv.paper) : "transparent", color: darkMode ? "#E8EAED" : adv.ink }}>
                    <span className="truncate">{m.name || "Organisation"}</span>
                    <span className="shrink-0 text-xs" style={{ color: adv.inkSoft }}>{ROLE_LABELS[m.role] || m.role}</span>
                  </button>
                ))}
                {!hasOwnOrg && (
                  <button onClick={() => { setOrgMenuOpen(false); onCreateOwnOrg(); }} disabled={creatingOwnOrg} className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-xs font-medium" style={{ borderColor: adv.line, color: adv.accent }}>
                    {creatingOwnOrg ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} {creatingOwnOrg ? "Création…" : "Créer mon propre espace"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      );
    })();

    const NavItem = ({ id, label, icon: Icon, locked }) => (
      <button onClick={() => setView(id)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs font-medium" style={tabStyle(view === id)}>
        <Icon size={15} /> <span className="truncate">{label}</span> {locked && <Lock size={11} className="ml-auto shrink-0" />}
      </button>
    );

    return (
      <>
        {/* ───── Barre latérale — grand écran uniquement ───── */}
        <div className="df-sidebar-nav hidden lg:flex" style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: "264px", background: navBg, borderRight: `1px solid ${navLine}`, flexDirection: "column", zIndex: 30 }}>
          <button onClick={() => setView("dashboard")} className="flex items-center gap-2.5 px-5 py-5" title="Retour à l'accueil">
            {siteSettings?.logo ? (
              <img src={siteSettings.logo} alt={siteSettings.name} style={{ width: siteSettings.logoWidth, height: siteSettings.logoHeight, objectFit: "contain" }} />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg df-mono text-xs font-semibold" style={{ background: adv.accent, color: "white" }}>{initials(siteSettings?.name) || "DF"}</div>
            )}
            <span className="df-display truncate text-sm font-semibold" style={{ color: darkMode ? "#E8EAED" : adv.ink }}>{siteSettings?.name || "Chantiflow"}</span>
          </button>

          <div className="px-4 pb-4">
            <button onClick={onNewDevis} className="flex w-full items-center justify-center gap-2 rounded-xl py-2 text-xs font-semibold" style={{ background: adv.accent, color: "white" }}>
              <Plus size={15} /> Nouveau devis
            </button>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <button onClick={onNewFacture} className="rounded-lg py-1.5 text-[10px] font-medium" style={{ border: `1px solid ${adv.line}`, color: adv.inkSoft }}>Facture</button>
              <button onClick={onNewProforma} className="rounded-lg py-1.5 text-[10px] font-medium" style={{ border: `1px solid ${adv.line}`, color: adv.inkSoft }}>Proforma</button>
              <button onClick={onNewRevision} className="rounded-lg py-1.5 text-[10px] font-medium" style={{ border: `1px solid ${adv.line}`, color: adv.inkSoft }} title="Révision des prix">Révision</button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3">
            <div className="flex flex-col gap-0.5">
              {mainTabs.map(({ id, label, icon: Icon }) =>
                id === "company" ? (
                  <div key={id} className="relative flex items-center">
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) onSetCompanyType(e.target.value); }}
                      onClick={() => setView("company")}
                      className="df-select w-full appearance-none rounded-lg py-1.5 pl-9 pr-3 text-left text-xs font-medium"
                      style={{ ...tabStyle(view === id), border: "none" }}
                      title="Mon entreprise"
                    >
                      <option value="" disabled hidden style={{ color: adv.ink }}>Mon entreprise</option>
                      <option value="entreprise" style={{ color: adv.ink }}>Entreprise</option>
                      <option value="particulier" style={{ color: adv.ink }}>Particulier</option>
                    </select>
                    <Building2 size={15} className="pointer-events-none absolute left-3" style={{ color: tabStyle(view === id).color }} />
                  </div>
                ) : id === "team" ? (
                  <Fragment key={id}>
                    <NavItem id={id} label={label} icon={Icon} />
                    {orgSwitcher}
                  </Fragment>
                ) : (
                  <NavItem key={id} id={id} label={label} icon={Icon} locked={id === "prestations" && !hasAccess(account, "pro")} />
                )
              )}
            </div>

            <div className="my-3 border-t" style={{ borderColor: adv.line }} />

            <div className="flex flex-col gap-0.5">
              {rightTabs.map(({ id, label, icon: Icon }) => <NavItem key={id} id={id} label={label} icon={Icon} />)}
            </div>
          </div>

          <div className="border-t px-3 py-3" style={{ borderColor: adv.line }}>
            <div className="flex items-center gap-1">
              <div className="relative flex-1">
                <button onClick={() => setServicesMenuOpen((v) => !v)} className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-medium" style={{ color: adv.inkSoft }} title="Tous les services">
                  <Menu size={14} /> Tous les services
                </button>
                {servicesMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setServicesMenuOpen(false)} />
                    <div className="absolute bottom-full left-0 z-20 mb-1 max-h-96 w-72 overflow-y-auto rounded-lg py-1 shadow-lg" style={{ background: darkMode ? "#262D3A" : "white", border: `1px solid ${darkMode ? "#3A4353" : adv.line}` }}>
                      <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: adv.inkSoft }}>Tous les services</div>
                      {SERVICES.filter((s) => visibleServices.includes(s.id)).map((s) => {
                        const SIcon = s.icon;
                        return (
                          <button key={s.id} onClick={() => { setServicesMenuOpen(false); onNewService(s.id); }} className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-xs hover:bg-black/5" style={{ color: darkMode ? "#E8EAED" : adv.ink }}>
                            <SIcon size={15} className="mt-0.5 shrink-0" style={{ color: adv.accent }} />
                            <span className="min-w-0">
                              <span className="block font-medium">{s.label}{!s.implemented && <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-normal" style={{ background: adv.line, color: adv.inkSoft }}>bientôt</span>}</span>
                              <span className="block truncate" style={{ color: adv.inkSoft }}>{s.description}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              {!window.chantiflowDesktop && siteSettings?.desktopAppEnabled && (siteSettings?.desktopAppUrlWindows || siteSettings?.desktopAppUrlMac) && (
                <div className="relative">
                  <button onClick={() => setDesktopMenuOpen((v) => !v)} className="flex items-center gap-1 rounded-lg p-2" style={{ color: adv.inkSoft }} title="Télécharger le logiciel de bureau">
                    <Monitor size={14} />
                  </button>
                  {desktopMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setDesktopMenuOpen(false)} />
                      <div className="absolute bottom-full right-0 z-20 mb-1 w-52 overflow-hidden rounded-lg py-1 shadow-lg" style={{ background: darkMode ? "#262D3A" : "white", border: `1px solid ${darkMode ? "#3A4353" : adv.line}` }}>
                        {siteSettings.desktopAppUrlWindows && <a href={siteSettings.desktopAppUrlWindows} download onClick={() => setDesktopMenuOpen(false)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm" style={{ color: darkMode ? "#E8EAED" : adv.ink }}><Monitor size={15} /> Version Windows</a>}
                        {siteSettings.desktopAppUrlMac && <a href={siteSettings.desktopAppUrlMac} download onClick={() => setDesktopMenuOpen(false)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm" style={{ color: darkMode ? "#E8EAED" : adv.ink }}><Monitor size={15} /> Version Mac</a>}
                      </div>
                    </>
                  )}
                </div>
              )}
              <button onClick={() => setDarkMode((v) => !v)} className="flex items-center gap-1 rounded-lg p-2" style={{ color: adv.inkSoft }} title={darkMode ? "Mode clair" : "Mode sombre"}>{darkMode ? <Sun size={14} /> : <Moon size={14} />}</button>
              <button onClick={() => setView("contact")} className="flex items-center gap-1 rounded-lg p-2" style={tabStyle(view === "contact")} title="Nous contacter"><Mail size={14} /></button>
            </div>
            <button onClick={onLogout} className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs font-medium" style={{ color: adv.inkSoft }}>
              <LogOut size={15} /> Se déconnecter
            </button>
          </div>
        </div>

        {/* ───── Barre du haut — petit écran uniquement ───── */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:hidden" style={{ background: navBg, borderBottom: `1px solid ${navLine}` }}>
          <button onClick={() => setView("dashboard")} className="flex min-w-0 flex-1 items-center gap-2.5" title="Retour à l'accueil">
            {siteSettings?.logo ? (
              <img src={siteSettings.logo} alt={siteSettings.name} style={{ width: siteSettings.logoWidth, height: siteSettings.logoHeight, objectFit: "contain" }} />
            ) : (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg df-mono text-xs font-semibold" style={{ background: adv.accent, color: "white" }}>{initials(siteSettings?.name) || "DF"}</div>
            )}
            <span className="df-display truncate text-xs font-semibold" style={{ color: darkMode ? "#E8EAED" : adv.ink }}>{siteSettings?.name || "Chantiflow"}</span>
          </button>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={onNewDevis} className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium" style={{ background: adv.accent, color: "white" }}><Plus size={13} /> Devis</button>
            <button onClick={() => setMobileNavOpen((v) => !v)} className="shrink-0 rounded-lg p-1.5" style={{ color: darkMode ? "#E8EAED" : adv.ink }}>{mobileNavOpen ? <X size={19} /> : <Menu size={19} />}</button>
          </div>
        </div>
        {mobileNavOpen && (
          <div className="lg:hidden" style={{ background: navBg, borderBottom: `1px solid ${navLine}` }}>
            <div className="max-h-[70vh] overflow-y-auto px-3 pb-3">
              <div className="grid grid-cols-3 gap-1.5 py-2">
                <button onClick={() => { setMobileNavOpen(false); onNewFacture(); }} className="rounded-lg py-2 text-[11px] font-medium" style={{ border: `1px solid ${adv.line}`, color: adv.inkSoft }}>Facture</button>
                <button onClick={() => { setMobileNavOpen(false); onNewProforma(); }} className="rounded-lg py-2 text-[11px] font-medium" style={{ border: `1px solid ${adv.line}`, color: adv.inkSoft }}>Proforma</button>
                <button onClick={() => { setMobileNavOpen(false); onNewRevision(); }} className="rounded-lg py-2 text-[11px] font-medium" style={{ border: `1px solid ${adv.line}`, color: adv.inkSoft }} title="Révision des prix">Révision</button>
              </div>
              <div className="mb-1 mt-1 px-3 text-[10px] font-semibold uppercase tracking-wide" style={{ color: adv.inkSoft }}>Tous les services</div>
              <div className="mb-2 grid grid-cols-2 gap-1">
                {SERVICES.filter((s) => visibleServices.includes(s.id)).map((s) => {
                  const SIcon = s.icon;
                  return (
                    <button key={s.id} onClick={() => { setMobileNavOpen(false); onNewService(s.id); }} className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-[11px]" style={{ background: darkMode ? "#262D3A" : adv.paper, color: darkMode ? "#E8EAED" : adv.ink }}>
                      <SIcon size={13} className="shrink-0" style={{ color: adv.accent }} /> <span className="truncate">{s.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="my-2 border-t" style={{ borderColor: adv.line }} />
              {tabs.map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => { setView(id); setMobileNavOpen(false); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs" style={tabStyle(view === id)}>
                  <Icon size={15} /> {label} {id === "prestations" && !hasAccess(account, "pro") && <Lock size={11} className="ml-auto" />}
                </button>
              ))}
              <div className="my-2 border-t" style={{ borderColor: adv.line }} />
              <button onClick={() => setView("contact")} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs" style={{ color: adv.inkSoft }}><Mail size={15} /> Nous contacter</button>
              <button onClick={onLogout} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs" style={{ color: adv.inkSoft }}><LogOut size={15} /> Se déconnecter</button>
            </div>
          </div>
        )}
        <CommandPalette isOpen={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} commands={paletteCommands} />
      </>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: navBg }}>
      <div className="flex min-w-0 grow items-center gap-6">
        <button onClick={() => setView("dashboard")} className="flex shrink-0 items-center gap-3" title="Retour à l'accueil">
          {siteSettings?.logo ? (
            <img src={siteSettings.logo} alt={siteSettings.name} style={{ width: siteSettings.logoWidth, height: siteSettings.logoHeight, objectFit: "contain" }} />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg df-mono text-sm font-semibold" style={{ background: isAdvanced ? adv.accent : colors.brass, color: isAdvanced ? "white" : colors.ink }}>{initials(siteSettings?.name) || "DF"}</div>
          )}
          <span className="df-display text-lg font-semibold tracking-wide text-white">{siteSettings?.name || "Chantiflow"}</span>
        </button>
        <div className="hidden min-w-0 grow items-center justify-between gap-3 lg:flex">
          <div className="flex items-center gap-1">
            {mainTabs.map(({ id, label, icon: Icon }) =>
              id === "company" ? (
                <div key={id} className="relative flex items-center">
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) onSetCompanyType(e.target.value); }}
                    onClick={() => setView("company")}
                    className="df-select appearance-none rounded-lg py-1.5 pl-8 pr-3 text-xs font-medium"
                    style={{ ...tabStyle(view === id), border: "none" }}
                    title="Mon entreprise"
                  >
                    <option value="" disabled hidden style={{ color: colors.ink }}>Entreprise/Particulier</option>
                    <option value="entreprise" style={{ color: colors.ink }}>Entreprise</option>
                    <option value="particulier" style={{ color: colors.ink }}>Particulier</option>
                  </select>
                  <Building2 size={15} className="pointer-events-none absolute left-2.5" style={{ color: tabStyle(view === id).color }} />
                </div>
              ) : id === "team" ? (
                <Fragment key={id}>
                  <button onClick={() => setView(id)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium" style={tabStyle(view === id)}>
                    <Icon size={15} /> {label}
                  </button>
                  {(() => {
                    const memberships = account?.memberships || [];
                    const hasOwnOrg = memberships.some((m) => m.role === "owner");
                    return (
                      <div className="relative">
                        <button
                          onClick={() => setOrgMenuOpen((v) => !v)}
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                          style={{ background: "rgba(255,255,255,0.1)", color: "white", border: "none" }}
                          title="Changer d'organisation"
                        >
                          <Building2 size={13} /> Organisations
                          <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "rgba(255,255,255,0.15)" }}>{ROLE_LABELS[account.role] || account.role}</span>
                          <ChevronDown size={12} />
                        </button>
                        {orgMenuOpen && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setOrgMenuOpen(false)} />
                            <div className="absolute left-0 top-full z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg py-1 shadow-lg" style={{ background: "white", border: `1px solid ${colors.line}` }}>
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
                </Fragment>
              ) : (
                <button key={id} onClick={() => setView(id)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium" style={tabStyle(view === id)}>
                  <Icon size={15} /> {label} {id === "prestations" && !hasAccess(account, "pro") && <Lock size={11} />}
                </button>
              )
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {rightTabs.map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setView(id)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium" style={tabStyle(view === id)}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onNewDevis} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium" style={isAdvanced ? { background: adv.accent, color: "white" } : { background: colors.brass, color: colors.ink }}>
          <Plus size={15} /> Devis
        </button>
        <button onClick={onNewFacture} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium" style={isAdvanced ? { border: "1px solid rgba(255,255,255,0.3)", color: "white" } : { background: colors.slate, color: "white" }}>
          <Plus size={15} /> Facture
        </button>
        <button onClick={onNewProforma} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium" style={isAdvanced ? { border: "1px solid rgba(255,255,255,0.3)", color: "white" } : { background: colors.moss, color: "white" }} title="Nouvelle facture proforma">
          <Plus size={15} /> Proforma
        </button>
        <button onClick={onNewRevision} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium" style={isAdvanced ? { border: "1px solid rgba(255,255,255,0.3)", color: "white" } : { background: colors.slate, color: "white" }} title="Nouvelle révision des prix">
          <TrendingUp size={15} /> Révision des prix
        </button>
        <div className="relative">
          <button onClick={() => setServicesMenuOpen((v) => !v)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium" style={{ background: "rgba(255,255,255,0.1)", color: "white" }} title="Tous les services">
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
        {!window.chantiflowDesktop && siteSettings?.desktopAppEnabled && (siteSettings?.desktopAppUrlWindows || siteSettings?.desktopAppUrlMac) && (
          <div className="relative">
            <button
              onClick={() => setDesktopMenuOpen((v) => !v)}
              className="flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium"
              style={{ color: "rgba(255,255,255,0.65)" }}
              title="Télécharger le logiciel de bureau"
            >
              <Monitor size={15} />
            </button>
            {desktopMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setDesktopMenuOpen(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-lg py-1 shadow-lg" style={{ background: "white", border: `1px solid ${colors.line}` }}>
                  {siteSettings.desktopAppUrlWindows && (
                    <a href={siteSettings.desktopAppUrlWindows} download onClick={() => setDesktopMenuOpen(false)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm" style={{ color: colors.ink }}>
                      <Monitor size={15} /> Version Windows
                    </a>
                  )}
                  {siteSettings.desktopAppUrlMac && (
                    <a href={siteSettings.desktopAppUrlMac} download onClick={() => setDesktopMenuOpen(false)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm" style={{ color: colors.ink }}>
                      <Monitor size={15} /> Version Mac
                    </a>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        <button onClick={() => setDarkMode((v) => !v)} className="flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium" style={{ color: "rgba(255,255,255,0.65)" }} title={darkMode ? "Mode clair" : "Mode sombre"}>
          {darkMode ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button onClick={() => setView("contact")} className="flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium" style={tabStyle(view === "contact")} title="Nous contacter">
          <Mail size={15} />
        </button>
        {account?.isAdmin && (
          <button onClick={() => setView("admin")} className="flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium" style={tabStyle(view === "admin")} title="Admin">
            <Shield size={15} />
          </button>
        )}
        <button onClick={onLogout} className="flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium" style={{ color: "rgba(255,255,255,0.65)" }} title="Se déconnecter">
          <LogOut size={15} />
        </button>
      </div>
      <div className="relative w-full lg:hidden">
        <button
          onClick={() => setMobileNavOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium"
          style={{ background: "rgba(255,255,255,0.1)", color: "white" }}
        >
          <span className="flex items-center gap-2">
            {(() => { const Current = tabs.find((t) => t.id === view)?.icon || LayoutDashboard; return <Current size={15} />; })()}
            {tabs.find((t) => t.id === view)?.label || "Menu"}
          </span>
          {mobileNavOpen ? <X size={16} /> : <Menu size={16} />}
        </button>
        {mobileNavOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMobileNavOpen(false)} />
            <div className="absolute left-0 top-full z-20 mt-1 w-full max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg py-1 shadow-lg" style={{ background: "white", border: `1px solid ${colors.line}` }}>
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => { setView(id); setMobileNavOpen(false); }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm"
                  style={{ background: view === id ? colors.paper : "transparent", color: colors.ink, fontWeight: view === id ? 600 : 400 }}
                >
                  <Icon size={15} style={{ color: view === id ? colors.brassDark : colors.inkSoft }} /> {label}
                  {id === "prestations" && !hasAccess(account, "pro") && <Lock size={11} className="ml-auto" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <CommandPalette isOpen={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} commands={paletteCommands} />
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
  const watermarkText = upx(siteSettings?.name || "Chantiflow");
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

function RevisionEditor({ doc, saving, clients, account, plans, siteSettings, isLocked, isViewer, onChange, onFinalize, onBack, onSaveClient, onGoToPricing }) {
  const [localDoc, setLocalDoc] = useState(doc);
  const saveTimer = useRef(null);
  // Cumul des modifications en attente d'enregistrement (voir patch).
  const pendingPatchRef = useRef(null);
  // Avertit avant de fermer/quitter si une sauvegarde est encore en
  // attente (le délai de 400ms n'a pas eu le temps de partir) — sans
  // ça, fermer l'onglet juste après avoir tapé pouvait perdre la
  // toute dernière modification silencieusement.
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (saveTimer.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);
  useEffect(() => setLocalDoc(doc), [doc.id]);

  function patch(p) {
    setLocalDoc((prev) => ({ ...prev, ...p }));
    // Toutes les modifications faites pendant le délai de 400ms sont
    // cumulées puis envoyées ensemble — avant, seule la DERNIÈRE était
    // enregistrée, et celles faites juste avant dans un autre champ
    // (ex : changer un statut puis taper une note) étaient perdues
    // silencieusement à l'enregistrement.
    pendingPatchRef.current = { ...(pendingPatchRef.current || {}), ...p };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const merged = pendingPatchRef.current;
      pendingPatchRef.current = null;
      saveTimer.current = null; // plus rien en attente : ne bloque plus la fermeture de l'onglet
      if (merged) onChange(merged);
    }, 400);
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
    try {
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
    } catch (err) {
      console.error("Erreur de génération du fichier Excel", err);
      alert("Impossible de générer le fichier Excel. Réessaie, et préviens-moi si ça persiste.");
    }
  }

  return (
    <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink, borderRadius: siteSettings?.landingPageVersion === "avancee" ? "0 0 20px 20px" : 0 }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-white"><ArrowLeft size={16} /> Tableau de bord</button>
        <div className="flex items-center gap-2">
          <button onClick={downloadPdf} disabled={pdfGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.brass, color: siteSettings?.landingPageVersion === "avancee" ? "white" : colors.ink, opacity: pdfGenerating ? 0.7 : 1 }}>
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
              {siteSettings?.landingPageVersion === "avancee" && (
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${docTypeColor("revision")}18`, color: docTypeColor("revision") }}>
                  <TrendingUp size={17} />
                </div>
              )}
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
            <button onClick={addSector} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.ink, color: "white" }}>
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
                      <button onClick={() => addTerm(sec.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.ink, color: "white" }}><Plus size={12} /> Terme</button>
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
                              <button onClick={() => removeTerm(sec.id, t.id)} title="Supprimer ce terme" style={{ color: colors.brick }}><Trash2 size={14} /></button>
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
                                <button onClick={() => removeDecompte(sec.id, d.id)} title="Supprimer ce décompte" style={{ color: colors.brick }}><Trash2 size={14} /></button>
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
                                  <button onClick={() => removeDecompte(sec.id, d.id)} title="Supprimer ce décompte" style={{ color: colors.brick }}><Trash2 size={14} /></button>
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
                                <button onClick={() => addMois(sec.id, d.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.ink, color: "white" }}><Plus size={11} /> Mois</button>
                              </div>
                              <div className="space-y-1.5">
                                {(d.mois || []).map((m, mIdx) => (
                                  <div key={m.id || mIdx} className="rounded-md p-2" style={{ background: colors.paper, border: `1px solid ${colors.line}` }}>
                                    <div className="mb-1.5 flex items-center gap-2">
                                      <input type="date" className="df-input df-mono rounded-md px-2 py-1 text-xs" style={{ border: `1px solid ${colors.line}`, width: "9.5rem" }} value={m.date} onChange={(e) => patchMois(sec.id, d.id, m.id, { date: e.target.value })} />
                                      <input type="number" className="df-input df-mono w-20 rounded-md px-2 py-1 text-xs" style={{ border: `1px solid ${colors.line}` }} value={m.jours} onChange={(e) => patchMois(sec.id, d.id, m.id, { jours: e.target.value })} placeholder="jours" />
                                      <span className="grow" />
                                      {(d.mois || []).length > 1 && (
                                        <button onClick={() => removeMois(sec.id, d.id, m.id)} title="Supprimer ce mois" style={{ color: colors.brick }}><Trash2 size={13} /></button>
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
                        <button onClick={() => addDecompte(sec.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.ink, color: "white" }}><Plus size={12} /> Décompte</button>
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

      <FinalizeButton doc={localDoc} onFinalize={onFinalize} siteSettings={siteSettings} />
      <PrintRevision ref={printRef} doc={localDoc} siteSettings={siteSettings} watermarkEnabled={watermarkEnabled} />
    </div>
  );
}

const PrintSituation = forwardRef(function PrintSituation({ doc, siteSettings, watermarkEnabled = true, photoUrls = {} }, ref) {
  const s = computeSituation(doc);
  const ink = siteSettings?.pdfHeaderColor || "#1B2A33";
  const inkSoft = "#4A5B63", line = "#DAE1DC";
  const box = siteSettings?.pdfBlockColor || "#F1F0EA";
  const pageBg = siteSettings?.pdfBackground || "#FBF7EF";
  const mono = { fontFamily: "'IBM Plex Mono', monospace" };
  const watermarkText = (siteSettings?.name || "Chantiflow").toUpperCase();
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
      {/* Photos de chantier — grille en fin de document */}
      {(doc.photos || []).some((p) => photoUrls[p.path]) && (
        <div style={{ marginTop: "20px", position: "relative", zIndex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "9.5pt", marginBottom: "6px", paddingBottom: "4px", borderBottom: `1px solid ${line}` }}>Photos de chantier</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
            {(doc.photos || []).filter((p) => photoUrls[p.path]).map((p) => (
              <div key={p.id} style={{ pageBreakInside: "avoid" }}>
                <img src={photoUrls[p.path]} alt="" crossOrigin="anonymous" style={{ width: "100%", height: "150px", objectFit: "cover", borderRadius: "4px", border: `1px solid ${line}`, display: "block" }} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

function SituationEditor({ doc, documents, saving, account, plans, siteSettings, isLocked, isViewer, onChange, onFinalize, onBack, onCreateNext, onGoToPricing }) {
  const [localDoc, setLocalDoc] = useState(doc);
  const saveTimer = useRef(null);
  // Cumul des modifications en attente d'enregistrement (voir patch).
  const pendingPatchRef = useRef(null);
  // Avertit avant de fermer/quitter si une sauvegarde est encore en
  // attente (le délai de 400ms n'a pas eu le temps de partir) — sans
  // ça, fermer l'onglet juste après avoir tapé pouvait perdre la
  // toute dernière modification silencieusement.
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (saveTimer.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);
  useEffect(() => setLocalDoc(doc), [doc.id]);

  function patch(p) {
    setLocalDoc((prev) => ({ ...prev, ...p }));
    // Toutes les modifications faites pendant le délai de 400ms sont
    // cumulées puis envoyées ensemble — avant, seule la DERNIÈRE était
    // enregistrée, et celles faites juste avant dans un autre champ
    // (ex : changer un statut puis taper une note) étaient perdues
    // silencieusement à l'enregistrement.
    pendingPatchRef.current = { ...(pendingPatchRef.current || {}), ...p };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const merged = pendingPatchRef.current;
      pendingPatchRef.current = null;
      saveTimer.current = null; // plus rien en attente : ne bloque plus la fermeture de l'onglet
      if (merged) onChange(merged);
    }, 400);
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

  // Photos de chantier (voir DocumentPhotosBlock) — fichiers dans le
  // bucket privé, liens signés régénérés à l'ouverture et avant le PDF.
  const photoState = usePhotoUrls(localDoc.photos);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photosRef = useRef([]);
  photosRef.current = localDoc.photos || [];
  async function addPhotos(files) {
    if (isLocked || isViewer || !files?.length) return;
    const room = MAX_PHOTOS_PER_DOC - photosRef.current.length;
    if (room <= 0) { alert(`Maximum ${MAX_PHOTOS_PER_DOC} photos par document.`); return; }
    const list = Array.from(files).slice(0, room);
    if (list.length < files.length) alert(`Seules ${room} photo(s) supplémentaire(s) peuvent être ajoutées (maximum ${MAX_PHOTOS_PER_DOC} par document).`);
    setPhotoUploading(true);
    const added = [];
    for (const file of list) {
      try {
        added.push(await uploadDocumentPhoto(account?.organizationId, localDoc.id, file));
      } catch (err) {
        console.error("Erreur d'ajout de photo", err);
        alert(err.message || "Impossible d'ajouter cette photo.");
      }
    }
    if (added.length) patch({ photos: [...photosRef.current, ...added] });
    setPhotoUploading(false);
  }
  async function removePhoto(photo) {
    if (isLocked || isViewer) return;
    if (!window.confirm("Retirer cette photo du document ? Le fichier sera supprimé.")) return;
    try {
      await deleteDocumentPhoto(photo.path);
    } catch (err) {
      console.error("Erreur de suppression de photo", err);
      alert("Impossible de supprimer le fichier pour l'instant.");
      return;
    }
    patch({ photos: photosRef.current.filter((p) => p.id !== photo.id) });
  }

  async function downloadPdf() {
    const el = printRef.current;
    if (!el || pdfGenerating) return;
    setPdfGenerating(true);
    // Liens signés à jour avant la capture (ils expirent au bout d'une heure).
    if ((localDoc.photos || []).length) await photoState.refresh();
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
    <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink, borderRadius: siteSettings?.landingPageVersion === "avancee" ? "0 0 20px 20px" : 0 }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-white"><ArrowLeft size={16} /> Tableau de bord</button>
        <div className="flex items-center gap-2">
          {!hasNextSituation && !isLocked && (
            <button onClick={() => onCreateNext(localDoc)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.moss }} title="Crée la situation suivante, en reprenant automatiquement le cumul de celle-ci">
              <ArrowRight size={15} /> Situation suivante
            </button>
          )}
          <button onClick={downloadPdf} disabled={pdfGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.brass, color: siteSettings?.landingPageVersion === "avancee" ? "white" : colors.ink, opacity: pdfGenerating ? 0.7 : 1 }}>
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
              {siteSettings?.landingPageVersion === "avancee" && (
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${docTypeColor("situation")}18`, color: docTypeColor("situation") }}>
                  <BarChart3 size={17} />
                </div>
              )}
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
            <button onClick={addLine} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.ink, color: "white" }}><Plus size={12} /> Poste</button>
          </div>
          <div className="mb-4 space-y-2">
            {localDoc.items.map((l) => {
              const cl = computeSituationLine(l);
              return (
                <div key={l.id} className="rounded-lg p-3" style={{ background: colors.paper, border: `1px solid ${colors.line}` }}>
                  <div className="mb-2 flex items-center gap-2">
                    <input className="df-input grow rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} placeholder="Désignation du poste" value={l.designation} onChange={(e) => patchLine(l.id, { designation: e.target.value })} />
                    {localDoc.items.length > 1 && <button onClick={() => removeLine(l.id)} title="Supprimer cette ligne" style={{ color: colors.brick }}><Trash2 size={14} /></button>}
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
          <DocumentPhotosBlock photos={localDoc.photos || []} urls={photoState.urls} canEdit={!isLocked && !isViewer} uploading={photoUploading} onAdd={addPhotos} onRemove={removePhoto} />
        </div>
      </div>

      <FinalizeButton doc={localDoc} onFinalize={onFinalize} siteSettings={siteSettings} />
      <PrintSituation ref={printRef} doc={localDoc} siteSettings={siteSettings} watermarkEnabled={watermarkEnabled} photoUrls={photoState.urls} />
    </div>
  );
}

const PV_TYPES = {
  sans_reserves: { label: "Réception sans réserves", color: "#2F6B4F" },
  avec_reserves: { label: "Réception avec réserves", color: "#B8763E" },
  refusee: { label: "Réception refusée", color: "#A33B2A" },
};

const PrintPvReception = forwardRef(function PrintPvReception({ doc, siteSettings, watermarkEnabled = true, photoUrls = {} }, ref) {
  const ink = siteSettings?.pdfHeaderColor || "#1B2A33";
  const inkSoft = "#4A5B63", line = "#DAE1DC";
  const box = siteSettings?.pdfBlockColor || "#F1F0EA";
  const pageBg = siteSettings?.pdfBackground || "#FBF7EF";
  const garanties = computePvGaranties(doc);
  const typeInfo = PV_TYPES[doc.typeReception] || PV_TYPES.sans_reserves;
  const watermarkText = (siteSettings?.name || "Chantiflow").toUpperCase();
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
      {/* Photos de chantier — grille en fin de document */}
      {(doc.photos || []).some((p) => photoUrls[p.path]) && (
        <div style={{ marginTop: "20px", position: "relative", zIndex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "9.5pt", marginBottom: "6px", paddingBottom: "4px", borderBottom: `1px solid ${line}` }}>Photos de chantier</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
            {(doc.photos || []).filter((p) => photoUrls[p.path]).map((p) => (
              <div key={p.id} style={{ pageBreakInside: "avoid" }}>
                <img src={photoUrls[p.path]} alt="" crossOrigin="anonymous" style={{ width: "100%", height: "150px", objectFit: "cover", borderRadius: "4px", border: `1px solid ${line}`, display: "block" }} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

function PvReceptionEditor({ doc, saving, account, plans, siteSettings, isLocked, isViewer, onChange, onFinalize, onBack, onGoToPricing }) {
  const [localDoc, setLocalDoc] = useState(doc);
  const saveTimer = useRef(null);
  // Cumul des modifications en attente d'enregistrement (voir patch).
  const pendingPatchRef = useRef(null);
  // Avertit avant de fermer/quitter si une sauvegarde est encore en
  // attente (le délai de 400ms n'a pas eu le temps de partir) — sans
  // ça, fermer l'onglet juste après avoir tapé pouvait perdre la
  // toute dernière modification silencieusement.
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (saveTimer.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);
  useEffect(() => setLocalDoc(doc), [doc.id]);

  function patch(p) {
    setLocalDoc((prev) => ({ ...prev, ...p }));
    // Toutes les modifications faites pendant le délai de 400ms sont
    // cumulées puis envoyées ensemble — avant, seule la DERNIÈRE était
    // enregistrée, et celles faites juste avant dans un autre champ
    // (ex : changer un statut puis taper une note) étaient perdues
    // silencieusement à l'enregistrement.
    pendingPatchRef.current = { ...(pendingPatchRef.current || {}), ...p };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const merged = pendingPatchRef.current;
      pendingPatchRef.current = null;
      saveTimer.current = null; // plus rien en attente : ne bloque plus la fermeture de l'onglet
      if (merged) onChange(merged);
    }, 400);
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

  // Photos de chantier (voir DocumentPhotosBlock) — fichiers dans le
  // bucket privé, liens signés régénérés à l'ouverture et avant le PDF.
  const photoState = usePhotoUrls(localDoc.photos);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photosRef = useRef([]);
  photosRef.current = localDoc.photos || [];
  async function addPhotos(files) {
    if (isLocked || isViewer || !files?.length) return;
    const room = MAX_PHOTOS_PER_DOC - photosRef.current.length;
    if (room <= 0) { alert(`Maximum ${MAX_PHOTOS_PER_DOC} photos par document.`); return; }
    const list = Array.from(files).slice(0, room);
    if (list.length < files.length) alert(`Seules ${room} photo(s) supplémentaire(s) peuvent être ajoutées (maximum ${MAX_PHOTOS_PER_DOC} par document).`);
    setPhotoUploading(true);
    const added = [];
    for (const file of list) {
      try {
        added.push(await uploadDocumentPhoto(account?.organizationId, localDoc.id, file));
      } catch (err) {
        console.error("Erreur d'ajout de photo", err);
        alert(err.message || "Impossible d'ajouter cette photo.");
      }
    }
    if (added.length) patch({ photos: [...photosRef.current, ...added] });
    setPhotoUploading(false);
  }
  async function removePhoto(photo) {
    if (isLocked || isViewer) return;
    if (!window.confirm("Retirer cette photo du document ? Le fichier sera supprimé.")) return;
    try {
      await deleteDocumentPhoto(photo.path);
    } catch (err) {
      console.error("Erreur de suppression de photo", err);
      alert("Impossible de supprimer le fichier pour l'instant.");
      return;
    }
    patch({ photos: photosRef.current.filter((p) => p.id !== photo.id) });
  }

  async function downloadPdf() {
    const el = printRef.current;
    if (!el || pdfGenerating) return;
    setPdfGenerating(true);
    // Liens signés à jour avant la capture (ils expirent au bout d'une heure).
    if ((localDoc.photos || []).length) await photoState.refresh();
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
    <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink, borderRadius: siteSettings?.landingPageVersion === "avancee" ? "0 0 20px 20px" : 0 }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-white"><ArrowLeft size={16} /> Tableau de bord</button>
        <div className="flex items-center gap-2">
          <button onClick={downloadPdf} disabled={pdfGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.brass, color: siteSettings?.landingPageVersion === "avancee" ? "white" : colors.ink, opacity: pdfGenerating ? 0.7 : 1 }}>
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
          {siteSettings?.landingPageVersion === "avancee" && (
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${docTypeColor("pv_reception")}18`, color: docTypeColor("pv_reception") }}>
              <ClipboardCheck size={17} />
            </div>
          )}
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
                <button onClick={addReserve} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.ink, color: "white" }}><Plus size={12} /> Réserve</button>
              </div>
              <div className="space-y-2">
                {(localDoc.reserves || []).map((r) => (
                  <div key={r.id} className="rounded-lg p-3" style={{ background: colors.paper, border: `1px solid ${colors.line}` }}>
                    <div className="mb-2 flex items-center gap-2">
                      <input className="df-input grow rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} placeholder="Description de la réserve" value={r.description} onChange={(e) => patchReserve(r.id, { description: e.target.value })} />
                      <button onClick={() => removeReserve(r.id)} title="Supprimer cette réserve" style={{ color: colors.brick }}><Trash2 size={14} /></button>
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
          <DocumentPhotosBlock photos={localDoc.photos || []} urls={photoState.urls} canEdit={!isLocked && !isViewer} uploading={photoUploading} onAdd={addPhotos} onRemove={removePhoto} />
        </div>
      </div>

      <FinalizeButton doc={localDoc} onFinalize={onFinalize} siteSettings={siteSettings} />
      <PrintPvReception ref={printRef} doc={localDoc} siteSettings={siteSettings} watermarkEnabled={watermarkEnabled} photoUrls={photoState.urls} />
    </div>
  );
}

const TYPES_INTERVENTION = { depannage: "Dépannage urgent", entretien: "Entretien programmé", sav: "Service après-vente", diagnostic: "Diagnostic" };
const STATUTS_RESOLUTION = { resolu: { label: "Problème résolu", color: "#2F6B4F" }, partiel: { label: "Partiellement résolu", color: "#B8763E" }, nouvelle_intervention: { label: "Nouvelle intervention nécessaire", color: "#A33B2A" } };

const PrintRapportIntervention = forwardRef(function PrintRapportIntervention({ doc, siteSettings, watermarkEnabled = true, photoUrls = {} }, ref) {
  const ink = siteSettings?.pdfHeaderColor || "#1B2A33";
  const inkSoft = "#4A5B63", line = "#DAE1DC";
  const box = siteSettings?.pdfBlockColor || "#F1F0EA";
  const pageBg = siteSettings?.pdfBackground || "#FBF7EF";
  const duree = computeInterventionDuree(doc);
  const statut = STATUTS_RESOLUTION[doc.statutResolution] || STATUTS_RESOLUTION.resolu;
  const watermarkText = (siteSettings?.name || "Chantiflow").toUpperCase();
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
      {/* Photos de chantier — grille en fin de document */}
      {(doc.photos || []).some((p) => photoUrls[p.path]) && (
        <div style={{ marginTop: "20px", position: "relative", zIndex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "9.5pt", marginBottom: "6px", paddingBottom: "4px", borderBottom: `1px solid ${line}` }}>Photos de chantier</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
            {(doc.photos || []).filter((p) => photoUrls[p.path]).map((p) => (
              <div key={p.id} style={{ pageBreakInside: "avoid" }}>
                <img src={photoUrls[p.path]} alt="" crossOrigin="anonymous" style={{ width: "100%", height: "150px", objectFit: "cover", borderRadius: "4px", border: `1px solid ${line}`, display: "block" }} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

function RapportInterventionEditor({ doc, saving, account, plans, siteSettings, isLocked, isViewer, onChange, onFinalize, onBack, onGoToPricing }) {
  const [localDoc, setLocalDoc] = useState(doc);
  const saveTimer = useRef(null);
  // Cumul des modifications en attente d'enregistrement (voir patch).
  const pendingPatchRef = useRef(null);
  // Avertit avant de fermer/quitter si une sauvegarde est encore en
  // attente (le délai de 400ms n'a pas eu le temps de partir) — sans
  // ça, fermer l'onglet juste après avoir tapé pouvait perdre la
  // toute dernière modification silencieusement.
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (saveTimer.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);
  useEffect(() => setLocalDoc(doc), [doc.id]);

  function patch(p) {
    setLocalDoc((prev) => ({ ...prev, ...p }));
    // Toutes les modifications faites pendant le délai de 400ms sont
    // cumulées puis envoyées ensemble — avant, seule la DERNIÈRE était
    // enregistrée, et celles faites juste avant dans un autre champ
    // (ex : changer un statut puis taper une note) étaient perdues
    // silencieusement à l'enregistrement.
    pendingPatchRef.current = { ...(pendingPatchRef.current || {}), ...p };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const merged = pendingPatchRef.current;
      pendingPatchRef.current = null;
      saveTimer.current = null; // plus rien en attente : ne bloque plus la fermeture de l'onglet
      if (merged) onChange(merged);
    }, 400);
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

  // Photos de chantier (voir DocumentPhotosBlock) — fichiers dans le
  // bucket privé, liens signés régénérés à l'ouverture et avant le PDF.
  const photoState = usePhotoUrls(localDoc.photos);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photosRef = useRef([]);
  photosRef.current = localDoc.photos || [];
  async function addPhotos(files) {
    if (isLocked || isViewer || !files?.length) return;
    const room = MAX_PHOTOS_PER_DOC - photosRef.current.length;
    if (room <= 0) { alert(`Maximum ${MAX_PHOTOS_PER_DOC} photos par document.`); return; }
    const list = Array.from(files).slice(0, room);
    if (list.length < files.length) alert(`Seules ${room} photo(s) supplémentaire(s) peuvent être ajoutées (maximum ${MAX_PHOTOS_PER_DOC} par document).`);
    setPhotoUploading(true);
    const added = [];
    for (const file of list) {
      try {
        added.push(await uploadDocumentPhoto(account?.organizationId, localDoc.id, file));
      } catch (err) {
        console.error("Erreur d'ajout de photo", err);
        alert(err.message || "Impossible d'ajouter cette photo.");
      }
    }
    if (added.length) patch({ photos: [...photosRef.current, ...added] });
    setPhotoUploading(false);
  }
  async function removePhoto(photo) {
    if (isLocked || isViewer) return;
    if (!window.confirm("Retirer cette photo du document ? Le fichier sera supprimé.")) return;
    try {
      await deleteDocumentPhoto(photo.path);
    } catch (err) {
      console.error("Erreur de suppression de photo", err);
      alert("Impossible de supprimer le fichier pour l'instant.");
      return;
    }
    patch({ photos: photosRef.current.filter((p) => p.id !== photo.id) });
  }

  async function downloadPdf() {
    const el = printRef.current;
    if (!el || pdfGenerating) return;
    setPdfGenerating(true);
    // Liens signés à jour avant la capture (ils expirent au bout d'une heure).
    if ((localDoc.photos || []).length) await photoState.refresh();
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
    <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink, borderRadius: siteSettings?.landingPageVersion === "avancee" ? "0 0 20px 20px" : 0 }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-white"><ArrowLeft size={16} /> Tableau de bord</button>
        <div className="flex items-center gap-2">
          <button onClick={downloadPdf} disabled={pdfGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.brass, color: siteSettings?.landingPageVersion === "avancee" ? "white" : colors.ink, opacity: pdfGenerating ? 0.7 : 1 }}>
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
          {siteSettings?.landingPageVersion === "avancee" && (
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${docTypeColor("rapport")}18`, color: docTypeColor("rapport") }}>
              <Wrench size={17} />
            </div>
          )}
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
              <div className="df-mono rounded-md px-3 py-2 text-sm" style={{ background: colors.paper, color: !duree && localDoc.heureArrivee && localDoc.heureDepart ? colors.brick : colors.ink }}>
                {duree ? `${duree.heures}h${String(duree.minutes).padStart(2, "0")}` : localDoc.heureArrivee && localDoc.heureDepart ? "Départ avant l'arrivée ?" : "—"}
              </div>
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
              <button onClick={addMateriel} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.ink, color: "white" }}><Plus size={12} /> Matériel</button>
            </div>
            <div className="space-y-2">
              {(localDoc.materielsUtilises || []).map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <input className="df-input grow rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} placeholder="Désignation" value={m.designation} onChange={(e) => patchMateriel(m.id, { designation: e.target.value })} />
                  <input type="number" className="df-input df-mono w-20 rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} value={m.quantite} onChange={(e) => patchMateriel(m.id, { quantite: e.target.value })} />
                  <button onClick={() => removeMateriel(m.id)} title="Supprimer ce matériel" style={{ color: colors.brick }}><Trash2 size={14} /></button>
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
          <DocumentPhotosBlock photos={localDoc.photos || []} urls={photoState.urls} canEdit={!isLocked && !isViewer} uploading={photoUploading} onAdd={addPhotos} onRemove={removePhoto} />
        </div>
      </div>

      <FinalizeButton doc={localDoc} onFinalize={onFinalize} siteSettings={siteSettings} />
      <PrintRapportIntervention ref={printRef} doc={localDoc} siteSettings={siteSettings} watermarkEnabled={watermarkEnabled} photoUrls={photoState.urls} />
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
  const watermarkText = (siteSettings?.name || "Chantiflow").toUpperCase();
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

function ContratChantierEditor({ doc, saving, account, plans, siteSettings, isLocked, isViewer, onChange, onFinalize, onBack, onGoToPricing }) {
  const [localDoc, setLocalDoc] = useState(doc);
  const saveTimer = useRef(null);
  // Cumul des modifications en attente d'enregistrement (voir patch).
  const pendingPatchRef = useRef(null);
  // Avertit avant de fermer/quitter si une sauvegarde est encore en
  // attente (le délai de 400ms n'a pas eu le temps de partir) — sans
  // ça, fermer l'onglet juste après avoir tapé pouvait perdre la
  // toute dernière modification silencieusement.
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (saveTimer.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);
  useEffect(() => setLocalDoc(doc), [doc.id]);

  function patch(p) {
    setLocalDoc((prev) => ({ ...prev, ...p }));
    // Toutes les modifications faites pendant le délai de 400ms sont
    // cumulées puis envoyées ensemble — avant, seule la DERNIÈRE était
    // enregistrée, et celles faites juste avant dans un autre champ
    // (ex : changer un statut puis taper une note) étaient perdues
    // silencieusement à l'enregistrement.
    pendingPatchRef.current = { ...(pendingPatchRef.current || {}), ...p };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const merged = pendingPatchRef.current;
      pendingPatchRef.current = null;
      saveTimer.current = null; // plus rien en attente : ne bloque plus la fermeture de l'onglet
      if (merged) onChange(merged);
    }, 400);
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
    <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink, borderRadius: siteSettings?.landingPageVersion === "avancee" ? "0 0 20px 20px" : 0 }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-white"><ArrowLeft size={16} /> Tableau de bord</button>
        <div className="flex items-center gap-2">
          <button onClick={downloadPdf} disabled={pdfGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.brass, color: siteSettings?.landingPageVersion === "avancee" ? "white" : colors.ink, opacity: pdfGenerating ? 0.7 : 1 }}>
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
          {siteSettings?.landingPageVersion === "avancee" && (
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${docTypeColor("contrat")}18`, color: docTypeColor("contrat") }}>
              <FileSignature size={17} />
            </div>
          )}
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

      <FinalizeButton doc={localDoc} onFinalize={onFinalize} siteSettings={siteSettings} />
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
  const watermarkText = (siteSettings?.name || "Chantiflow").toUpperCase();
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

function RelanceFormelleEditor({ doc, saving, account, plans, siteSettings, isLocked, isViewer, onChange, onFinalize, onBack, onGoToPricing }) {
  const [localDoc, setLocalDoc] = useState(doc);
  const saveTimer = useRef(null);
  // Cumul des modifications en attente d'enregistrement (voir patch).
  const pendingPatchRef = useRef(null);
  // Avertit avant de fermer/quitter si une sauvegarde est encore en
  // attente (le délai de 400ms n'a pas eu le temps de partir) — sans
  // ça, fermer l'onglet juste après avoir tapé pouvait perdre la
  // toute dernière modification silencieusement.
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (saveTimer.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);
  useEffect(() => setLocalDoc(doc), [doc.id]);

  function patch(p) {
    setLocalDoc((prev) => ({ ...prev, ...p }));
    // Toutes les modifications faites pendant le délai de 400ms sont
    // cumulées puis envoyées ensemble — avant, seule la DERNIÈRE était
    // enregistrée, et celles faites juste avant dans un autre champ
    // (ex : changer un statut puis taper une note) étaient perdues
    // silencieusement à l'enregistrement.
    pendingPatchRef.current = { ...(pendingPatchRef.current || {}), ...p };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const merged = pendingPatchRef.current;
      pendingPatchRef.current = null;
      saveTimer.current = null; // plus rien en attente : ne bloque plus la fermeture de l'onglet
      if (merged) onChange(merged);
    }, 400);
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
    <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink, borderRadius: siteSettings?.landingPageVersion === "avancee" ? "0 0 20px 20px" : 0 }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-white"><ArrowLeft size={16} /> Tableau de bord</button>
        <div className="flex items-center gap-2">
          <button onClick={downloadPdf} disabled={pdfGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.brass, color: siteSettings?.landingPageVersion === "avancee" ? "white" : colors.ink, opacity: pdfGenerating ? 0.7 : 1 }}>
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
          {siteSettings?.landingPageVersion === "avancee" && (
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${docTypeColor("relance")}18`, color: docTypeColor("relance") }}>
              <AlertTriangle size={17} />
            </div>
          )}
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

      <FinalizeButton doc={localDoc} onFinalize={onFinalize} siteSettings={siteSettings} />
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
  const watermarkText = (siteSettings?.name || "Chantiflow").toUpperCase();
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

function PlanningChantierEditor({ doc, saving, account, plans, siteSettings, isLocked, isViewer, onChange, onFinalize, onBack, onGoToPricing }) {
  const [localDoc, setLocalDoc] = useState(doc);
  const saveTimer = useRef(null);
  // Cumul des modifications en attente d'enregistrement (voir patch).
  const pendingPatchRef = useRef(null);
  // Avertit avant de fermer/quitter si une sauvegarde est encore en
  // attente (le délai de 400ms n'a pas eu le temps de partir) — sans
  // ça, fermer l'onglet juste après avoir tapé pouvait perdre la
  // toute dernière modification silencieusement.
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (saveTimer.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);
  useEffect(() => setLocalDoc(doc), [doc.id]);

  function patch(p) {
    setLocalDoc((prev) => ({ ...prev, ...p }));
    // Toutes les modifications faites pendant le délai de 400ms sont
    // cumulées puis envoyées ensemble — avant, seule la DERNIÈRE était
    // enregistrée, et celles faites juste avant dans un autre champ
    // (ex : changer un statut puis taper une note) étaient perdues
    // silencieusement à l'enregistrement.
    pendingPatchRef.current = { ...(pendingPatchRef.current || {}), ...p };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const merged = pendingPatchRef.current;
      pendingPatchRef.current = null;
      saveTimer.current = null; // plus rien en attente : ne bloque plus la fermeture de l'onglet
      if (merged) onChange(merged);
    }, 400);
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
    <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
      <GlobalStyle />
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink, borderRadius: siteSettings?.landingPageVersion === "avancee" ? "0 0 20px 20px" : 0 }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-white"><ArrowLeft size={16} /> Tableau de bord</button>
        <div className="flex items-center gap-2">
          <button onClick={downloadPdf} disabled={pdfGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.brass, color: siteSettings?.landingPageVersion === "avancee" ? "white" : colors.ink, opacity: pdfGenerating ? 0.7 : 1 }}>
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
          {siteSettings?.landingPageVersion === "avancee" && (
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${docTypeColor("planning")}18`, color: docTypeColor("planning") }}>
              <Calendar size={17} />
            </div>
          )}
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
            <button onClick={addTache} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.ink, color: "white" }}><Plus size={12} /> Tâche</button>
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
                    {(localDoc.taches || []).length > 1 && <button onClick={() => removeTache(t.id)} title="Supprimer cette tâche" style={{ color: colors.brick }}><Trash2 size={14} /></button>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <input className="df-input rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} placeholder="Corps de métier" value={t.corpsMetier} onChange={(e) => patchTache(t.id, { corpsMetier: e.target.value })} />
                    <input type="date" className="df-input df-mono rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${colors.line}` }} value={t.dateDebut} onChange={(e) => patchTache(t.id, { dateDebut: e.target.value })} />
                    <div>
                      <input type="date" className="df-input df-mono w-full rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${t.dateDebut && t.dateFin && t.dateFin < t.dateDebut ? colors.brick : colors.line}` }} value={t.dateFin} onChange={(e) => patchTache(t.id, { dateFin: e.target.value })} />
                      {t.dateDebut && t.dateFin && t.dateFin < t.dateDebut && <p className="mt-0.5 text-xs" style={{ color: colors.brick }}>Avant la date de début</p>}
                    </div>
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

      <FinalizeButton doc={localDoc} onFinalize={onFinalize} siteSettings={siteSettings} />
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
  useEscapeToClose(open, () => setOpen(false));
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

// Regroupe les documents par chantier (champ texte libre, rempli à la
// main sur chaque document) — permet de comparer, pour un même
// projet, le budget prévu (devis) au montant réellement facturé.
// Planning d'équipe interactif — page à part entière, indépendante du
// document statique "Planning de chantier". Les créneaux sont
// enregistrés dans le stockage de l'organisation (clé "team-planning"),
// comme les documents et les clients.
const PLANNING_COLORS = ["#B8763E", "#5B7B5A", "#4A5B63", "#A54D3A", "#6B5B95", "#2A9D8F", "#B5651D", "#457B9D"];
function toIsoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function startOfWeek(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function addDays(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function PlanningView({ documents, account, siteSettings, darkMode, isLocked, isViewer }) {
  const [slots, setSlots] = useState(null); // null tant que le chargement n'est pas terminé
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState([]);
  const [mode, setMode] = useState("month"); // month | week
  const [cursor, setCursor] = useState(() => new Date());
  const [editing, setEditing] = useState(null);
  const canEdit = !isLocked && !isViewer;
  const isAdvanced = siteSettings?.landingPageVersion === "avancee";
  const surface = isAdvanced ? (darkMode ? "#262D3A" : adv.surface) : colors.surface;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.storage.get("team-planning", false);
        const parsed = JSON.parse(res.value);
        if (!cancelled) setSlots(Array.isArray(parsed) ? parsed : []);
      } catch (err) {
        if (cancelled) return;
        if (err?.code === "KEY_NOT_FOUND") { setSlots([]); return; }
        console.error("Erreur de chargement du planning", err);
        setLoadError("Impossible de charger le planning pour l'instant.");
        setSlots([]);
      }
    })();
    return () => { cancelled = true; };
  }, [account?.organizationId]);

  useEffect(() => {
    if (!account?.organizationId) return;
    db.rpc("get_organization_members_with_profiles", { org_id: account.organizationId }).then(({ data, error }) => {
      if (error) { console.error("Erreur de chargement de l'équipe", error); return; }
      setMembers((data || []).filter((m) => m.status === "active").map((m) => ({ userId: m.user_id, label: m.email || "Membre" })));
    });
  }, [account?.organizationId]);

  const chantiers = useMemo(() => {
    const names = new Set();
    for (const d of documents) { const n = (d.chantier || "").trim(); if (n) names.add(n); }
    return [...names].sort((a, b) => a.localeCompare(b, "fr"));
  }, [documents]);

  const memberColor = useMemo(() => {
    const map = new Map();
    members.forEach((m, i) => map.set(m.userId, PLANNING_COLORS[i % PLANNING_COLORS.length]));
    return map;
  }, [members]);
  const colorOf = (slot) => (slot.memberUserId && memberColor.get(slot.memberUserId)) || colors.slate;
  const memberLabelOf = (slot) => members.find((m) => m.userId === slot.memberUserId)?.label || slot.memberLabel || "";

  async function persistSlots(next) {
    setSlots(next);
    setSaving(true);
    try {
      await window.storage.set("team-planning", JSON.stringify(next), false);
    } catch (err) {
      console.error("Erreur d'enregistrement du planning", err);
      alert("Impossible d'enregistrer le planning pour l'instant. Réessaie dans un instant.");
    } finally {
      setSaving(false);
    }
  }

  function openNewSlot(date) {
    if (!canEdit) return;
    const iso = toIsoDate(date);
    setEditing({ id: null, title: "", start: iso, end: iso, memberUserId: members[0]?.userId || "", chantier: "" });
  }
  function openSlot(slot) {
    setEditing({ ...slot });
  }
  function saveSlot() {
    if (!editing.title.trim()) { alert("Indique un titre pour ce créneau."); return; }
    if (!editing.start || !editing.end) { alert("Indique une date de début et une date de fin."); return; }
    if (editing.end < editing.start) { alert("La date de fin doit être après la date de début."); return; }
    const member = members.find((m) => m.userId === editing.memberUserId);
    const now = Date.now();
    const base = { title: editing.title.trim(), start: editing.start, end: editing.end, memberUserId: member?.userId || "", memberLabel: member?.label || "", chantier: (editing.chantier || "").trim(), updatedAt: now };
    if (editing.id) {
      persistSlots((slots || []).map((s) => (s.id === editing.id ? { ...s, ...base } : s)));
    } else {
      persistSlots([...(slots || []), { id: nextId("pl"), createdAt: now, ...base }]);
    }
    setEditing(null);
  }
  function deleteSlot() {
    if (!editing?.id) return;
    if (!window.confirm(`Supprimer le créneau « ${editing.title} » ?`)) return;
    persistSlots((slots || []).filter((s) => s.id !== editing.id));
    setEditing(null);
  }
  useEscapeToClose(!!editing, () => setEditing(null));

  const todayIso = toIsoDate(new Date());
  const slotsOn = (iso) => (slots || []).filter((s) => s.start <= iso && s.end >= iso).sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));

  // Grille du mois : commence le lundi de la semaine du 1er, 6 semaines.
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const monthDays = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weekStart = startOfWeek(cursor);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  function shift(direction) {
    setCursor((c) => (mode === "month" ? new Date(c.getFullYear(), c.getMonth() + direction, 1) : addDays(c, 7 * direction)));
  }
  const periodLabel = mode === "month"
    ? cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
    : `Semaine du ${weekStart.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} au ${addDays(weekStart, 6).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;

  const chip = (slot, dense) => (
    <button
      key={slot.id}
      onClick={(e) => { e.stopPropagation(); openSlot(slot); }}
      className="block w-full truncate rounded px-1.5 text-left"
      style={{ background: `${colorOf(slot)}22`, color: colorOf(slot), borderLeft: `3px solid ${colorOf(slot)}`, fontSize: dense ? "11px" : "12px", lineHeight: dense ? "18px" : "20px" }}
      title={`${slot.title}${memberLabelOf(slot) ? " — " + memberLabelOf(slot) : ""}${slot.chantier ? " — " + slot.chantier : ""}`}
    >
      {slot.title}{!dense && memberLabelOf(slot) ? <span style={{ opacity: 0.75 }}> · {memberLabelOf(slot)}</span> : null}
    </button>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          {isAdvanced && (
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: adv.accentSoft, color: adv.accent }}><Calendar size={18} /></div>
          )}
          <h1 className="df-display text-2xl font-semibold">Planning d'équipe</h1>
          <p className="text-sm" style={{ color: colors.inkSoft }}>Place un membre de l'équipe sur un chantier à une date donnée — clique sur un jour pour créer un créneau, sur un créneau pour le modifier.</p>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="flex items-center gap-1 text-xs" style={{ color: colors.inkSoft }}><Loader2 size={12} className="animate-spin" /> Enregistrement</span>}
          {canEdit && (
            <button onClick={() => openNewSlot(new Date())} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: isAdvanced ? adv.accent : colors.brassDark }}>
              <Plus size={15} /> Nouveau créneau
            </button>
          )}
        </div>
      </div>

      {loadError && <p className="mb-4 text-sm" style={{ color: colors.brick }}>{loadError}</p>}
      {!canEdit && slots !== null && (
        <p className="mb-4 text-xs" style={{ color: colors.inkSoft }}>Consultation seule — la modification du planning n'est pas disponible avec ton rôle ou l'état actuel du compte.</p>
      )}

      <div className="overflow-hidden rounded-2xl" style={{ background: surface, border: `1px solid ${colors.line}` }}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: colors.line }}>
          <div className="flex items-center gap-1">
            <button onClick={() => shift(-1)} className="rounded-md p-1.5 hover:bg-black/5" title="Précédent"><ArrowLeft size={16} /></button>
            <button onClick={() => setCursor(new Date())} className="rounded-md px-2 py-1 text-xs font-medium hover:bg-black/5">Aujourd'hui</button>
            <button onClick={() => shift(1)} className="rounded-md p-1.5 hover:bg-black/5" title="Suivant"><ArrowRight size={16} /></button>
            <span className="df-display ml-2 text-sm font-semibold capitalize">{periodLabel}</span>
          </div>
          <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ border: `1px solid ${colors.line}` }}>
            {[["month", "Mois"], ["week", "Semaine"]].map(([id, label]) => (
              <button key={id} onClick={() => setMode(id)} className="rounded-md px-3 py-1 text-xs font-medium" style={{ background: mode === id ? colors.ink : "transparent", color: mode === id ? "white" : colors.inkSoft }}>{label}</button>
            ))}
          </div>
        </div>

        {slots === null ? (
          <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin" style={{ color: colors.slate }} /></div>
        ) : mode === "month" ? (
          <div>
            <div className="grid grid-cols-7 border-b text-center text-xs font-medium uppercase tracking-wide" style={{ borderColor: colors.line, color: colors.inkSoft }}>
              {WEEKDAY_LABELS.map((l) => <div key={l} className="py-2">{l}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {monthDays.map((day, i) => {
                const iso = toIsoDate(day);
                const inMonth = day.getMonth() === cursor.getMonth();
                const daySlots = slotsOn(iso);
                return (
                  <div
                    key={iso}
                    onClick={() => openNewSlot(day)}
                    className="min-h-[92px] p-1.5"
                    style={{ borderRight: (i % 7) !== 6 ? `1px solid ${colors.line}` : "none", borderBottom: i < 35 ? `1px solid ${colors.line}` : "none", opacity: inMonth ? 1 : 0.45, cursor: canEdit ? "pointer" : "default", background: iso === todayIso ? `${colors.brass}12` : "transparent" }}
                  >
                    <div className="mb-1 text-right text-xs df-mono" style={{ color: iso === todayIso ? colors.brassDark : colors.inkSoft, fontWeight: iso === todayIso ? 700 : 400 }}>{day.getDate()}</div>
                    <div className="space-y-0.5">
                      {daySlots.slice(0, 3).map((s) => chip(s, true))}
                      {daySlots.length > 3 && <div className="px-1 text-[11px]" style={{ color: colors.inkSoft }}>+{daySlots.length - 3} autre(s)</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-7">
            {weekDays.map((day, i) => {
              const iso = toIsoDate(day);
              const daySlots = slotsOn(iso);
              return (
                <div
                  key={iso}
                  onClick={() => openNewSlot(day)}
                  className="min-h-[220px] p-2"
                  style={{ borderRight: i !== 6 ? `1px solid ${colors.line}` : "none", cursor: canEdit ? "pointer" : "default", background: iso === todayIso ? `${colors.brass}12` : "transparent" }}
                >
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: iso === todayIso ? colors.brassDark : colors.inkSoft }}>
                    {WEEKDAY_LABELS[i]} <span className="df-mono">{day.getDate()}</span>
                  </div>
                  <div className="space-y-1">
                    {daySlots.map((s) => (
                      <div key={s.id}>
                        {chip(s, false)}
                        {s.chantier && <div className="truncate px-1.5 text-[11px]" style={{ color: colors.inkSoft }}>{s.chantier}</div>}
                      </div>
                    ))}
                    {daySlots.length === 0 && <div className="text-[11px]" style={{ color: colors.inkSoft, opacity: 0.6 }}>—</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {members.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs" style={{ color: colors.inkSoft }}>
          {members.map((m) => (
            <span key={m.userId} className="flex items-center gap-1.5"><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: memberColor.get(m.userId) }} /> {m.label}</span>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(27,42,51,0.45)" }} onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.line}` }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="df-display text-lg font-semibold">{editing.id ? "Modifier le créneau" : "Nouveau créneau"}</h2>
              <button onClick={() => setEditing(null)} style={{ color: colors.inkSoft }}><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Titre</label>
                <input autoFocus className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Ex. Pose carrelage salle de bain" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} disabled={!canEdit} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Début</label>
                  <input type="date" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={editing.start} onChange={(e) => setEditing({ ...editing, start: e.target.value, end: editing.end < e.target.value ? e.target.value : editing.end })} disabled={!canEdit} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Fin</label>
                  <input type="date" className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={editing.end} min={editing.start} onChange={(e) => setEditing({ ...editing, end: e.target.value })} disabled={!canEdit} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Membre de l'équipe</label>
                <select className="df-select w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={editing.memberUserId || ""} onChange={(e) => setEditing({ ...editing, memberUserId: e.target.value })} disabled={!canEdit}>
                  <option value="">Non assigné</option>
                  {members.map((m) => <option key={m.userId} value={m.userId}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Chantier associé (optionnel)</label>
                <select className="df-select w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={editing.chantier || ""} onChange={(e) => setEditing({ ...editing, chantier: e.target.value })} disabled={!canEdit}>
                  <option value="">Aucun</option>
                  {chantiers.map((c) => <option key={c} value={c}>{c}</option>)}
                  {editing.chantier && !chantiers.includes(editing.chantier) && <option value={editing.chantier}>{editing.chantier}</option>}
                </select>
                <p className="mt-1 text-xs" style={{ color: colors.inkSoft }}>Les chantiers proposés sont ceux renseignés sur tes documents (page Chantiers).</p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between gap-2">
              <div>
                {canEdit && editing.id && (
                  <button onClick={deleteSlot} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: colors.brick }}><Trash2 size={14} /> Supprimer</button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-sm font-medium" style={{ border: `1px solid ${colors.line}`, color: colors.inkSoft }}>{canEdit ? "Annuler" : "Fermer"}</button>
                {canEdit && (
                  <button onClick={saveSlot} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: isAdvanced ? adv.accent : colors.brassDark }}>Enregistrer</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Version "Atelier" — coque de navigation, panneau « Créer », pages
// propres. Tout est additif : rien des versions classique et avancée
// n'est réutilisé autrement que par composition (pages et éditeurs
// partagés rendus tels quels dans la coque).
// ===========================================================================

// Les 15 services regroupés par famille, dans l'ordre du panneau « Créer ».
const ATELIER_FAMILIES = [
  { id: "vendre", label: "Vendre", hint: "Avant les travaux", services: ["devis", "contrat", "proforma", "bpu"] },
  { id: "facturer", label: "Facturer", hint: "Pendant et après", services: ["facture", "acompte", "situation", "avoir", "relance"] },
  { id: "chantier", label: "Suivre le chantier", hint: "Sur place", services: ["planning", "rapport", "pv_reception"] },
  { id: "acheter", label: "Acheter et recevoir", hint: "Fournisseurs", services: ["commande", "livraison"] },
  { id: "marches", label: "Marchés longs", hint: "Indices officiels", services: ["revision"] },
];
const ATELIER_TABS = [
  { id: "dashboard", label: "Accueil", icon: Home },
  { id: "atelier-documents", label: "Documents", icon: Files },
  { id: "chantiers", label: "Chantiers", icon: HardHat },
  { id: "clients", label: "Clients", icon: Users },
];
// Vue « active » dans la barre pour les écrans secondaires.
function atelierTabFor(view) {
  if (view === "planning-equipe" || view === "atelier-chantier") return "chantiers";
  if (view === "revision-sector") return "dashboard";
  return view;
}
function atelierServiceLabel(type) {
  return getService(type)?.label || docTypeLabel(type);
}

// Panneau « Créer » : les 15 services par famille, recherche, respect
// du réglage admin « services visibles ». Fenêtre centrée sur grand
// écran, plein écran sur téléphone.
function AtelierCreateSheet({ open, onClose, visibleServices, onCreate, darkMode, chantierName = null }) {
  const tone = atelierTone(darkMode);
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  useEscapeToClose(open, onClose);
  useEffect(() => {
    if (open) { setQuery(""); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);
  if (!open) return null;
  const q = query.trim().toLowerCase();
  const matches = (s) => !q || s.label.toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q);
  const families = ATELIER_FAMILIES.map((f) => ({
    ...f,
    items: f.services.map((id) => getService(id)).filter((s) => s && s.implemented && visibleServices.includes(s.id) && matches(s)),
  })).filter((f) => f.items.length);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6" style={{ background: "rgba(28,39,51,0.55)" }} onClick={onClose}>
      <div
        className="flex h-full w-full flex-col overflow-hidden md:h-auto md:max-h-[85vh] md:max-w-3xl md:rounded-2xl"
        style={{ background: tone.surface, color: tone.ink, border: `1px solid ${tone.line}` }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Créer un document"
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 md:px-6" style={{ borderColor: tone.line }}>
          <div>
            <h2 className="df-display text-lg font-semibold">Créer un document</h2>
            <p className="text-xs" style={{ color: tone.inkSoft }}>{chantierName ? <>Pour le chantier <strong style={{ color: tone.accent }}>{chantierName}</strong> — le nom sera déjà rempli.</> : "Choisis le document dont tu as besoin — tu pourras tout modifier ensuite."}</p>
          </div>
          <button onClick={onClose} className="df-at-tap flex h-11 w-11 shrink-0 items-center justify-center rounded-lg" style={{ color: tone.inkSoft }} title="Fermer (Échap)"><X size={20} /></button>
        </div>
        <div className="border-b px-4 py-3 md:px-6" style={{ borderColor: tone.line }}>
          <div className="flex items-center gap-2 rounded-lg px-3" style={{ background: tone.paper, border: `1px solid ${tone.line}` }}>
            <Search size={16} style={{ color: tone.inkSoft }} />
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un document (ex. facture, PV, rapport…)" className="df-at-tap w-full bg-transparent py-2 text-[15px] outline-none" style={{ color: tone.ink }} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
          {families.length === 0 && <p className="py-10 text-center text-sm" style={{ color: tone.inkSoft }}>Aucun document ne correspond à « {query} ».</p>}
          {families.map((f) => (
            <div key={f.id} className="mb-5">
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="df-display text-sm font-semibold uppercase tracking-wide" style={{ color: tone.accent }}>{f.label}</h3>
                <span className="text-xs" style={{ color: tone.inkSoft }}>{f.hint}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {f.items.map((s) => {
                  const SIcon = s.icon;
                  return (
                    <button key={s.id} onClick={() => { onClose(); onCreate(s.id); }} className="df-at-tap flex items-center gap-3 rounded-xl px-3 py-3 text-left" style={{ background: tone.paper, border: `1px solid ${tone.line}` }}>
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: tone.accentSoft, color: tone.accent }}><SIcon size={19} /></span>
                      <span className="min-w-0">
                        <span className="block text-[15px] font-semibold">{s.label}</span>
                        <span className="block truncate text-xs" style={{ color: tone.inkSoft }}>{s.description}</span>
                      </span>
                      <ChevronRight size={16} className="ml-auto shrink-0" style={{ color: tone.inkSoft }} />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Coque Atelier : barre haute (ordinateur et tablette) ou barre
// d'onglets en bas (téléphone), bouton « Créer » toujours visible,
// menu « Plus » pour le reste. Aucune barre latérale fixe.
function AtelierShell({ view, setView, account, siteSettings, darkMode, setDarkMode, onLogout, onSwitchOrganization, onCreateOwnOrg, creatingOwnOrg, onOpenCreate, commandPaletteOpen, setCommandPaletteOpen, paletteCommands, children }) {
  const tone = atelierTone(darkMode);
  const [moreOpen, setMoreOpen] = useState(false);
  useEscapeToClose(moreOpen, () => setMoreOpen(false));
  useEffect(() => { setMoreOpen(false); }, [view]);
  const activeTab = atelierTabFor(view);
  const memberships = account?.memberships || [];
  const hasOwnOrg = memberships.some((m) => m.role === "owner");
  const firstName = account?.firstName || "";
  const initials = ((account?.firstName || "")[0] || "") + ((account?.lastName || "")[0] || "") || (account?.email || "?")[0].toUpperCase();
  const moreItems = [
    { id: "company", label: "Mon entreprise", icon: Building2 },
    { id: "team", label: "Équipe", icon: UserPlus },
    { id: "prestations", label: "Bibliothèque de prestations", icon: Library, locked: !hasAccess(account, "pro") },
    { id: "planning-equipe", label: "Planning d'équipe", icon: Calendar },
    { id: "pricing", label: "Abonnement", icon: CreditCard },
    { id: "account", label: "Mon compte", icon: UserCircle },
    ...(account?.plan === "entreprise" && account?.role === "owner" ? [{ id: "api", label: "API", icon: KeyRound }] : []),
    ...(account?.isAdmin ? [{ id: "admin", label: "Admin", icon: Shield }] : []),
    { id: "contact", label: "Nous contacter", icon: Mail },
  ];
  const showDesktopApp = !window.chantiflowDesktop && siteSettings?.desktopAppEnabled && (siteSettings?.desktopAppUrlWindows || siteSettings?.desktopAppUrlMac);
  const tabStyle = (active) => (active ? { background: tone.accentSoft, color: tone.accent } : { color: tone.inkSoft });

  const logo = (
    <button onClick={() => setView("dashboard")} className="flex items-center gap-2" title="Accueil">
      {siteSettings?.logo ? (
        <img src={siteSettings.logo} alt="" style={{ width: siteSettings.logoWidth || 36, height: siteSettings.logoHeight || 36, objectFit: "contain" }} />
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-lg text-white" style={{ background: tone.accent }}><HardHat size={18} /></span>
      )}
      <span className="df-display text-base font-bold" style={{ color: tone.ink }}>{siteSettings?.name || "Chantiflow"}</span>
    </button>
  );

  const moreMenu = moreOpen && (
    <>
      <div className="fixed inset-0 z-40 md:bg-transparent" style={{ background: "rgba(28,39,51,0.35)" }} onClick={() => setMoreOpen(false)} />
      {/* Plein écran sur téléphone (hauteur = fenêtre visible, barre du
          navigateur comprise) ; sur grand écran, panneau déroulant limité
          à la hauteur de la fenêtre pour que la liste défile et que
          « Se déconnecter » reste toujours visible en bas. */}
      <div className="fixed inset-x-0 bottom-0 top-0 z-50 flex max-h-[100dvh] flex-col overflow-hidden md:absolute md:inset-auto md:right-0 md:top-full md:mt-2 md:max-h-[calc(100vh-88px)] md:w-80 md:rounded-xl md:shadow-xl" style={{ background: tone.surface, color: tone.ink, border: `1px solid ${tone.line}` }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: tone.line }}>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{account?.organizationName || siteSettings?.name || "Mon espace"}</div>
            <div className="truncate text-xs" style={{ color: tone.inkSoft }}>{account?.email} · {ROLE_LABELS[account?.role] || account?.role}</div>
          </div>
          <button onClick={() => setMoreOpen(false)} className="df-at-tap flex h-11 w-11 items-center justify-center rounded-lg md:hidden" style={{ color: tone.inkSoft }}><X size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {(memberships.length > 1 || !hasOwnOrg) && (
            <div className="border-b px-2 pb-2" style={{ borderColor: tone.line }}>
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: tone.inkSoft }}>Organisations</div>
              {memberships.map((m) => (
                <button key={m.organizationId} onClick={() => { setMoreOpen(false); onSwitchOrganization(m.organizationId); }} className="df-at-tap flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm" style={{ background: m.organizationId === account?.organizationId ? tone.accentSoft : "transparent", color: m.organizationId === account?.organizationId ? tone.accent : tone.ink }}>
                  <span className="truncate">{m.name || "Organisation"}</span>
                  <span className="shrink-0 text-xs" style={{ color: tone.inkSoft }}>{ROLE_LABELS[m.role] || m.role}</span>
                </button>
              ))}
              {!hasOwnOrg && (
                <button onClick={() => { setMoreOpen(false); onCreateOwnOrg(); }} disabled={creatingOwnOrg} className="df-at-tap flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium" style={{ color: tone.accent }}>
                  {creatingOwnOrg ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {creatingOwnOrg ? "Création…" : "Créer mon propre espace"}
                </button>
              )}
            </div>
          )}
          <div className="px-2 py-1">
            {moreItems.map(({ id, label, icon: Icon, locked }) => (
              <button key={id} onClick={() => { setMoreOpen(false); setView(id); }} className="df-at-tap flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[15px]" style={view === id ? tabStyle(true) : { color: tone.ink }}>
                <Icon size={18} style={{ color: view === id ? tone.accent : tone.inkSoft }} />
                <span className="flex-1">{label}</span>
                {locked && <Lock size={14} style={{ color: tone.inkSoft }} />}
              </button>
            ))}
          </div>
          {showDesktopApp && (
            <div className="border-t px-2 py-2" style={{ borderColor: tone.line }}>
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: tone.inkSoft }}>Logiciel de bureau</div>
              {siteSettings.desktopAppUrlWindows && <a href={siteSettings.desktopAppUrlWindows} download onClick={() => setMoreOpen(false)} className="df-at-tap flex items-center gap-3 rounded-lg px-2 py-2 text-[15px]" style={{ color: tone.ink }}><Monitor size={18} style={{ color: tone.inkSoft }} /> Télécharger pour Windows</a>}
              {siteSettings.desktopAppUrlMac && <a href={siteSettings.desktopAppUrlMac} download onClick={() => setMoreOpen(false)} className="df-at-tap flex items-center gap-3 rounded-lg px-2 py-2 text-[15px]" style={{ color: tone.ink }}><Monitor size={18} style={{ color: tone.inkSoft }} /> Télécharger pour Mac</a>}
            </div>
          )}
        </div>
        <div className="shrink-0 border-t px-2 py-2" style={{ borderColor: tone.line, paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))" }}>
          <button onClick={() => setDarkMode((v) => !v)} className="df-at-tap flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[15px]" style={{ color: tone.ink }}>
            {darkMode ? <Sun size={18} style={{ color: tone.inkSoft }} /> : <Moon size={18} style={{ color: tone.inkSoft }} />} {darkMode ? "Passer en mode clair" : "Passer en mode sombre"}
          </button>
          <button onClick={() => { setMoreOpen(false); onLogout(); }} className="df-at-tap flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[15px]" style={{ color: tone.danger }}>
            <LogOut size={18} /> Se déconnecter
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="df-root df-at-bottom-pad min-h-full w-full" style={{ backgroundColor: tone.paper, color: tone.ink }}>
      <GlobalStyle />
      {/* Barre haute — ordinateur et tablette */}
      {/* z-40 (au-dessus de la barre du bas, z-30) : le menu avatar est
          rendu à l'intérieur de cet en-tête, donc dans son contexte
          d'empilement — sans ça, la barre du bas recouvrait le pied du
          menu (« Se déconnecter ») sur téléphone. */}
      <header className="no-print sticky top-0 z-40 hidden items-center gap-3 border-b px-4 py-2 md:flex lg:px-6" style={{ background: tone.surface, borderColor: tone.line }}>
        {logo}
        <nav className="ml-2 flex items-center gap-1">
          {ATELIER_TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setView(id)} className="df-at-tap flex items-center gap-2 rounded-lg px-3 py-2 text-[15px] font-medium" style={tabStyle(activeTab === id)}>
              <Icon size={18} /> <span className="hidden lg:inline">{label}</span><span className="lg:hidden">{label}</span>
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setCommandPaletteOpen(true)} className="df-at-tap flex items-center gap-2 rounded-lg px-3 py-2 text-sm" style={{ color: tone.inkSoft, border: `1px solid ${tone.line}` }} title="Rechercher ou aller quelque part (Ctrl+K)">
            <Search size={16} /> <span className="hidden lg:inline">Rechercher</span> <kbd className="hidden rounded px-1 text-[11px] lg:inline" style={{ background: tone.paper, border: `1px solid ${tone.line}` }}>Ctrl K</kbd>
          </button>
          <button onClick={onOpenCreate} className="df-at-tap flex items-center gap-2 rounded-lg px-4 py-2 text-[15px] font-bold" style={{ background: tone.action, color: "#1C2733" }}>
            <Plus size={18} /> Créer
          </button>
          <div className="relative">
            <button onClick={() => setMoreOpen((v) => !v)} className="df-at-tap flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ color: tone.ink, border: `1px solid ${moreOpen ? tone.accent : tone.line}` }} title="Menu">
              <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: tone.accent }}>{initials}</span>
              <span className="hidden max-w-[120px] truncate text-sm lg:inline">{firstName || "Menu"}</span>
              <ChevronDown size={14} style={{ color: tone.inkSoft }} />
            </button>
            {moreMenu}
          </div>
        </div>
      </header>

      {/* Barre haute compacte — téléphone */}
      <header className="no-print sticky top-0 z-40 flex items-center justify-between border-b px-4 py-2 md:hidden" style={{ background: tone.surface, borderColor: tone.line }}>
        {logo}
        <div className="relative">
          <button onClick={() => setMoreOpen((v) => !v)} className="df-at-tap flex h-11 w-11 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: tone.accent }} title="Menu">{initials}</button>
          {moreMenu}
        </div>
      </header>

      {children}

      {/* Barre d'onglets en bas — téléphone */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t md:hidden" style={{ background: tone.surface, borderColor: tone.line, paddingBottom: "env(safe-area-inset-bottom, 0px)", visibility: moreOpen ? "hidden" : "visible" }}>
        {ATELIER_TABS.slice(0, 2).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setView(id)} className="flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium" style={{ color: activeTab === id ? tone.accent : tone.inkSoft, minHeight: 56 }}>
            <Icon size={22} /> {label}
          </button>
        ))}
        <button onClick={onOpenCreate} className="flex flex-col items-center justify-center gap-0.5 py-1 text-[11px] font-bold" style={{ color: tone.ink, minHeight: 56 }} title="Créer un document">
          <span className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: tone.action, color: "#1C2733", boxShadow: "0 2px 8px rgba(232,112,42,0.45)" }}><Plus size={24} /></span>
          Créer
        </button>
        {ATELIER_TABS.slice(2).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setView(id)} className="flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium" style={{ color: activeTab === id ? tone.accent : tone.inkSoft, minHeight: 56 }}>
            <Icon size={22} /> {label}
          </button>
        ))}
      </nav>

      <CommandPalette isOpen={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} commands={paletteCommands} />
    </div>
  );
}

// --- Règles propres à Atelier : famille, cycle de statut, montant et
// badge métier de chaque type. Corrige, uniquement ici, les incohérences
// des listes partagées (statuts de facture appliqués à tout, 0,00 € sur
// les documents sans prix) sans inventer de nouvelles valeurs en base.
function atelierFamilyOf(type) {
  return ATELIER_FAMILIES.find((f) => f.services.includes(type))?.id || "autres";
}
// Liste de statuts de vente, ou null quand le type n'a pas de cycle de
// vente (on affiche alors l'étape brouillon / terminé et le badge métier).
function atelierStatusesFor(type) {
  if (type === "devis") return DEVIS_STATUSES;
  if (type === "proforma") return PROFORMA_STATUSES;
  if (type === "facture" || type === "acompte" || type === "avoir" || type === "situation") return FACTURE_STATUSES;
  return null;
}
function atelierStatusColor(status, tone) {
  if (["signé", "payée", "acceptée"].includes(status)) return tone.success;
  if (["refusé", "expiré", "expirée", "en retard"].includes(status)) return tone.danger;
  if (["envoyé", "envoyée", "vu"].includes(status)) return tone.warning;
  return tone.inkSoft;
}
function atelierCapitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }
// Montant affiché dans la liste : { value, note } ou null (pas de montant
// pour un PV, un rapport, un planning, ou un document sans ligne).
function atelierDocAmount(d) {
  if (d.type === "pv_reception" || d.type === "rapport" || d.type === "planning") return null;
  if (d.type === "situation") { const s = computeSituation(d); return { value: s.netAPayer, note: "net" }; }
  if (d.type === "contrat") { const ht = Number(d.montantTotalHT) || 0; return ht ? { value: ht, note: "HT" } : null; }
  if (d.type === "relance") { const v = Number(d.montantDu) || 0; return v ? { value: v, note: "dû" } : null; }
  if (d.type === "revision") { const r = computeRevision(d); return r.valid ? { value: r.montantRevise, note: "révisé" } : null; }
  const hasLines = (d.items || []).some((it) => it.type === "line" && (it.designation || "").trim());
  if (!hasLines) return null;
  return { value: computeTotals(d).totalTTC, note: "TTC" };
}
// Badge métier propre au type (état déjà saisi dans l'éditeur).
function atelierDocBadge(d) {
  if (d.type === "livraison") return d.etatLivraison === "reserves" ? "Livré avec réserves" : d.etatLivraison === "incomplete" ? "Livraison incomplète" : "Conforme";
  if (d.type === "rapport") return STATUTS_RESOLUTION[d.statutResolution]?.label || null;
  if (d.type === "pv_reception") return PV_TYPES[d.typeReception]?.label || null;
  return null;
}
function atelierDocDate(d) {
  const raw = d.issueDate || d.updatedAt || d.createdAt;
  const date = new Date(raw);
  return isNaN(date.getTime()) ? "" : fr(date);
}

// Accueil Atelier : ce qu'il y a à faire, créer, reprendre, puis le
// chiffre d'affaires. Chaque carte « À faire » ouvre la page Documents
// déjà filtrée.
function AtelierHome({ account, documents, darkMode, isLocked, isViewer, freeLimit, freeLimitReached, offlineMode, visibleServices, reminders, reminderMailto, onCreate, onOpenCreate, onOpenDoc, onGoToDocuments, onGoToPricing, autoFactureNotice, onOpenAutoFacture, onDismissAutoFacture, reviewNotice, onSendReview, onDismissReview }) {
  const tone = atelierTone(darkMode);
  const firstName = account?.firstName || "";
  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const quick = ["devis", "facture", "rapport", "situation"].map((id) => getService(id)).filter((s) => s && visibleServices.includes(s.id));
  const recent = [...documents].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
  const card = { background: tone.surface, border: `1px solid ${tone.line}` };
  const hasPro = hasAccess(account, "pro");

  const todo = useMemo(() => {
    const devisAttente = documents.filter((d) => d.type === "devis" && ["envoyé", "vu"].includes(d.status));
    const facturesEnvoyees = documents.filter((d) => d.type === "facture" && d.status === "envoyée");
    const facturesRetard = documents.filter((d) => d.type === "facture" && d.status === "en retard");
    const enCours = documents.filter((d) => d.workStage !== "termine" && (d.status === "brouillon" || !d.status));
    const sum = (list) => list.reduce((s, d) => s + computeTotals(d).totalTTC, 0);
    const devisTraites = documents.filter((d) => d.type === "devis" && d.status !== "brouillon");
    const devisSignes = documents.filter((d) => d.type === "devis" && d.status === "signé");
    return {
      devisAttente: { count: devisAttente.length, amount: sum(devisAttente) },
      aEncaisser: { count: facturesEnvoyees.length, amount: sum(facturesEnvoyees) },
      enRetard: { count: facturesRetard.length, amount: sum(facturesRetard) },
      enCours: { count: enCours.length },
      tauxSignature: devisTraites.length ? Math.round((devisSignes.length / devisTraites.length) * 100) : null,
    };
  }, [documents]);

  const todoCards = [
    { id: "devis", icon: Inbox, label: "Devis en attente de réponse", count: todo.devisAttente.count, sub: eur(todo.devisAttente.amount), color: tone.warning, preset: { type: "devis", status: "attente" } },
    { id: "encaisser", label: "Factures à encaisser", icon: Wallet, count: todo.aEncaisser.count, sub: eur(todo.aEncaisser.amount), color: tone.accent, preset: { type: "facture", status: "envoyée" } },
    { id: "retard", label: "Factures en retard", icon: AlertTriangle, count: todo.enRetard.count, sub: eur(todo.enRetard.amount), color: tone.danger, preset: { type: "facture", status: "en retard" } },
    { id: "encours", label: "Documents en cours", icon: Pencil, count: todo.enCours.count, sub: "brouillons à terminer", color: tone.inkSoft, preset: { stage: "encours" } },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="df-display text-2xl font-bold sm:text-3xl">Bonjour{firstName ? ` ${firstName}` : ""}</h1>
        <p className="text-sm capitalize" style={{ color: tone.inkSoft }}>{today}</p>
      </div>

      {isViewer && (
        <div className="mb-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: tone.accentSoft, color: tone.accent }}>
          <Eye size={16} className="mt-0.5 shrink-0" /> <span>Accès en lecture seule : tu peux consulter les documents de {account?.organizationName || "cette équipe"}, pas les modifier.</span>
        </div>
      )}
      {offlineMode && (
        <div className="mb-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: `${tone.danger}14`, color: tone.danger }}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> <span>Mode hors ligne : tu vois la dernière copie enregistrée. Impossible de modifier tant que la connexion n'est pas revenue.</span>
        </div>
      )}
      {(account?.plan || "gratuit") === "gratuit" && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3" style={{ ...card, borderColor: freeLimitReached ? tone.danger : tone.line }}>
          <span className="flex items-center gap-2 text-sm" style={{ color: freeLimitReached ? tone.danger : tone.inkSoft }}>
            {freeLimitReached && <Lock size={15} />}
            Forfait Gratuit : <strong className="df-mono">{documents.length}/{freeLimit}</strong> documents utilisés{freeLimitReached && ", compte verrouillé jusqu'au passage à un forfait payant"}
          </span>
          <button onClick={onGoToPricing} className="df-at-tap rounded-lg px-3 py-2 text-sm font-semibold" style={freeLimitReached ? { background: tone.danger, color: "white" } : { color: tone.accent, border: `1px solid ${tone.line}` }}>Voir les forfaits</button>
        </div>
      )}
      {autoFactureNotice && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: `${tone.success}14`, border: `1px solid ${tone.success}55` }}>
          <span className="flex items-center gap-2 text-sm font-medium" style={{ color: tone.success }}><Check size={16} /> Devis signé : la facture {autoFactureNotice.docNumber} a été créée automatiquement.</span>
          <span className="flex items-center gap-3">
            <button onClick={onOpenAutoFacture} className="text-sm font-semibold underline" style={{ color: tone.success }}>Ouvrir</button>
            <button onClick={onDismissAutoFacture} style={{ color: tone.inkSoft }}><X size={16} /></button>
          </span>
        </div>
      )}
      <ReviewRequestNotice notice={reviewNotice} onSend={onSendReview} onDismiss={onDismissReview} />

      <section className="mb-8">
        <h2 className="df-display mb-3 text-base font-semibold">À faire</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {todoCards.map(({ id, icon: Icon, label, count, sub, color, preset }) => (
            <button key={id} onClick={() => onGoToDocuments(preset)} className="df-at-tap flex flex-col items-start gap-1 rounded-xl p-4 text-left" style={card}>
              <span className="flex items-center gap-2 text-xs font-medium" style={{ color: tone.inkSoft }}><Icon size={14} style={{ color }} /> {label}</span>
              <span className="df-display text-2xl font-bold" style={{ color: count ? color : tone.inkSoft }}>{count}</span>
              <span className="df-mono text-xs" style={{ color: tone.inkSoft }}>{sub}</span>
            </button>
          ))}
        </div>
        {todo.tauxSignature !== null && (
          <p className="mt-2 text-xs" style={{ color: tone.inkSoft }}>Taux de signature des devis envoyés : <strong className="df-mono" style={{ color: tone.ink }}>{todo.tauxSignature} %</strong></p>
        )}
      </section>

      <section className="mb-8">
        <h2 className="df-display mb-3 text-base font-semibold">Créer un document</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {quick.map((s) => {
            const SIcon = s.icon;
            return (
              <button key={s.id} onClick={() => onCreate(s.id)} disabled={isLocked} className="df-at-tap flex flex-col items-start gap-2 rounded-xl p-4 text-left" style={{ ...card, opacity: isLocked ? 0.5 : 1 }}>
                <span className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: tone.accentSoft, color: tone.accent }}><SIcon size={20} /></span>
                <span className="text-[15px] font-semibold">{s.label}</span>
              </button>
            );
          })}
          <button onClick={onOpenCreate} disabled={isLocked} className="df-at-tap flex flex-col items-start gap-2 rounded-xl p-4 text-left" style={{ background: tone.action, color: "#1C2733", opacity: isLocked ? 0.5 : 1 }}>
            <span className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: "rgba(255,255,255,0.35)" }}><Plus size={22} /></span>
            <span className="text-[15px] font-bold">Tous les services</span>
          </button>
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="df-display text-base font-semibold">Derniers documents</h2>
          <button onClick={() => onGoToDocuments(null)} className="text-sm font-semibold" style={{ color: tone.accent }}>Voir tous les documents</button>
        </div>
        {recent.length === 0 ? (
          <div className="rounded-xl p-8 text-center" style={{ ...card, borderStyle: "dashed" }}>
            <p className="text-[15px] font-semibold">Aucun document pour l'instant</p>
            <p className="mt-1 text-sm" style={{ color: tone.inkSoft }}>Commence par un devis : appuie sur « Créer », puis choisis « Devis ».</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl" style={card}>
            {recent.map((d, i) => {
              const amount = atelierDocAmount(d);
              const statuses = atelierStatusesFor(d.type);
              return (
                <button key={d.id} onClick={() => onOpenDoc(d.id)} className="df-at-tap flex w-full items-center gap-3 px-4 py-3 text-left" style={{ borderTop: i ? `1px solid ${tone.line}` : "none" }}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{atelierServiceLabel(d.type)} <span className="df-mono font-normal" style={{ color: tone.inkSoft }}>{d.docNumber}</span></span>
                    <span className="block truncate text-sm" style={{ color: tone.inkSoft }}>{d.client?.name || "Sans client"}{d.chantier ? ` · ${d.chantier}` : ""}</span>
                  </span>
                  {statuses && <span className="hidden shrink-0 rounded-full px-2 py-0.5 text-xs font-medium sm:inline" style={{ background: `${atelierStatusColor(d.status, tone)}1A`, color: atelierStatusColor(d.status, tone) }}>{atelierCapitalize(d.status || "brouillon")}</span>}
                  {amount && <span className="df-mono hidden shrink-0 text-sm sm:inline">{eur(amount.value)}</span>}
                  <ChevronRight size={16} className="shrink-0" style={{ color: tone.inkSoft }} />
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="df-display mb-3 text-base font-semibold">Relances à faire</h2>
        {!hasPro ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ ...card, borderStyle: "dashed" }}>
            <span className="flex items-center gap-2 text-sm" style={{ color: tone.inkSoft }}><Lock size={15} /> Les relances automatiques (devis qui expirent, factures en retard) sont réservées aux forfaits Pro et Entreprise.</span>
            <button onClick={onGoToPricing} className="df-at-tap rounded-lg px-3 py-2 text-sm font-semibold" style={{ color: tone.accent, border: `1px solid ${tone.line}` }}>Voir les forfaits</button>
          </div>
        ) : reminders.length === 0 ? (
          <p className="rounded-xl px-4 py-3 text-sm" style={{ ...card, color: tone.inkSoft }}>Rien à relancer pour l'instant.</p>
        ) : (
          <div className="overflow-hidden rounded-xl" style={card}>
            {reminders.slice(0, 6).map(({ doc, reason, urgent }, i) => (
              <div key={doc.id} className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderTop: i ? `1px solid ${tone.line}` : "none" }}>
                <button onClick={() => onOpenDoc(doc.id)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[15px] font-semibold">{atelierServiceLabel(doc.type)} <span className="df-mono font-normal" style={{ color: tone.inkSoft }}>{doc.docNumber}</span> · {doc.client?.name || "Sans client"}</span>
                  <span className="block text-sm" style={{ color: urgent ? tone.danger : tone.warning }}>{reason}</span>
                </button>
                <a href={reminderMailto({ doc })} className="df-at-tap flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: tone.accentSoft, color: tone.accent }}><Mail size={14} /> Relancer par email</a>
              </div>
            ))}
            {reminders.length > 6 && <p className="px-4 py-2 text-xs" style={{ color: tone.inkSoft }}>+{reminders.length - 6} autre(s)</p>}
          </div>
        )}
      </section>

      <RevenueChart documents={documents} isAdvanced={false} darkMode={darkMode} />
    </div>
  );
}

// Page Documents Atelier : les 15 types, filtre par famille puis par
// type, statuts adaptés, montants justes, sélection multiple avec les
// actions groupées existantes.
function AtelierDocumentsView({ documents, darkMode, isLocked, isViewer, preset, onPresetConsumed, onOpenDoc, onChangeStatus, onDuplicate, onDelete, selectedIds, onToggleSelect, onClearSelection, onMerge, onBatchExcel, onBatchPdf, batchExporting, onExportAccounting }) {
  const tone = atelierTone(darkMode);
  const [search, setSearch] = useState("");
  const [family, setFamily] = useState("tous");
  const [type, setType] = useState("tous");
  const [status, setStatus] = useState("tous");
  const [stage, setStage] = useState("tous");

  // Préréglage venu de l'Accueil (carte « À faire »).
  useEffect(() => {
    if (!preset) return;
    setSearch("");
    if (preset.type) { setFamily(atelierFamilyOf(preset.type)); setType(preset.type); setStatus(preset.status || "tous"); setStage("tous"); }
    else { setFamily("tous"); setType("tous"); setStatus("tous"); setStage(preset.stage || "tous"); }
    onPresetConsumed();
  }, [preset, onPresetConsumed]);

  const statuses = type !== "tous" ? atelierStatusesFor(type) : null;
  const typeOptions = family === "tous" ? ATELIER_FAMILIES : ATELIER_FAMILIES.filter((f) => f.id === family);

  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return [...documents]
      .filter((d) => family === "tous" || atelierFamilyOf(d.type) === family)
      .filter((d) => type === "tous" || d.type === type)
      .filter((d) => {
        if (status === "tous" || !statuses) return true;
        if (status === "attente") return ["envoyé", "vu", "envoyée"].includes(d.status);
        return (d.status || "brouillon") === status;
      })
      .filter((d) => stage === "tous" || (stage === "termine" ? d.workStage === "termine" : d.workStage !== "termine"))
      .filter((d) => !s || (d.docNumber || "").toLowerCase().includes(s) || (d.client?.name || "").toLowerCase().includes(s) || (d.chantier || "").toLowerCase().includes(s))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [documents, family, type, status, stage, search, statuses]);

  const selectedDocs = documents.filter((d) => selectedIds.includes(d.id));
  const sameType = selectedDocs.length > 0 && selectedDocs.every((d) => d.type === selectedDocs[0].type);
  const canMerge = selectedDocs.length >= 2 && sameType && !isLocked && (selectedDocs[0].type === "devis" || selectedDocs[0].type === "facture");
  const canBatch = selectedDocs.length >= 2 && sameType;
  const card = { background: tone.surface, border: `1px solid ${tone.line}` };
  const chip = (active) => ({ background: active ? tone.accent : tone.surface, color: active ? "white" : tone.ink, border: `1px solid ${active ? tone.accent : tone.line}` });
  const canEdit = !isLocked && !isViewer;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="df-display text-2xl font-bold">Documents</h1>
          <p className="text-sm" style={{ color: tone.inkSoft }}>{list.length} sur {documents.length} document{documents.length > 1 ? "s" : ""}</p>
        </div>
        <button onClick={onExportAccounting} className="df-at-tap flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold" style={{ color: tone.accent, border: `1px solid ${tone.line}`, background: tone.surface }} title="Toutes les pièces avec montants HT, TVA, TTC, pour ton comptable">
          <Download size={16} /> Export comptable
        </button>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-lg px-3" style={card}>
        <Search size={16} style={{ color: tone.inkSoft }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher par numéro, client ou chantier" className="df-at-tap w-full bg-transparent py-2 text-[15px] outline-none" style={{ color: tone.ink }} />
        {search && <button onClick={() => setSearch("")} style={{ color: tone.inkSoft }} title="Effacer"><X size={16} /></button>}
      </div>

      <div className="mb-2 flex gap-2 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
        {[{ id: "tous", label: "Tous" }, ...ATELIER_FAMILIES].map((f) => (
          <button key={f.id} onClick={() => { setFamily(f.id); setType("tous"); setStatus("tous"); }} className="df-at-tap shrink-0 rounded-full px-4 py-2 text-sm font-medium" style={chip(family === f.id)}>{f.label}</button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={type} onChange={(e) => { setType(e.target.value); setStatus("tous"); }} className="df-select df-at-tap rounded-lg px-3 py-2 text-sm" style={{ ...card, color: tone.ink }}>
          <option value="tous">Tous les types</option>
          {typeOptions.map((f) => (
            <optgroup key={f.id} label={f.label}>
              {f.services.map((id) => <option key={id} value={id}>{atelierServiceLabel(id)}</option>)}
            </optgroup>
          ))}
        </select>
        {statuses ? (
          <div className="flex gap-2 overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
            {[["tous", "Tous statuts"], ...statuses.map((s) => [s, atelierCapitalize(s)])].map(([id, label]) => (
              <button key={id} onClick={() => setStatus(id)} className="df-at-tap shrink-0 rounded-full px-3 py-2 text-xs font-medium" style={chip(status === id || (status === "attente" && (id === "envoyé" || id === "envoyée")))}>{label}</button>
            ))}
          </div>
        ) : (
          <div className="flex gap-2">
            {[["tous", "Tout"], ["encours", "En cours"], ["termine", "Terminés"]].map(([id, label]) => (
              <button key={id} onClick={() => setStage(id)} className="df-at-tap shrink-0 rounded-full px-3 py-2 text-xs font-medium" style={chip(stage === id)}>{label}</button>
            ))}
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ ...card, borderStyle: "dashed" }}>
          <p className="text-[15px] font-semibold">Aucun document ne correspond</p>
          <p className="mt-1 text-sm" style={{ color: tone.inkSoft }}>Change de famille ou de statut, ou vide la recherche.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl" style={card}>
          {list.map((d, i) => {
            const amount = atelierDocAmount(d);
            const docStatuses = atelierStatusesFor(d.type);
            const badge = atelierDocBadge(d);
            const selected = selectedIds.includes(d.id);
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:flex-nowrap sm:px-4" style={{ borderTop: i ? `1px solid ${tone.line}` : "none", background: selected ? tone.accentSoft : "transparent" }}>
                <input type="checkbox" checked={selected} onChange={() => onToggleSelect(d.id)} className="h-5 w-5 shrink-0 cursor-pointer" title="Sélectionner pour une action groupée" />
                {/* Sur téléphone, le texte prend toute la ligne ; montant, statut
                    et actions passent sur une seconde ligne, sans rien tronquer. */}
                <button onClick={() => onOpenDoc(d.id)} className="df-at-tap min-w-0 flex-1 basis-[calc(100%-2.5rem)] text-left sm:basis-auto">
                  <span className="block truncate text-[15px] font-semibold">{atelierServiceLabel(d.type)} <span className="df-mono font-normal" style={{ color: tone.inkSoft }}>{d.docNumber}</span></span>
                  <span className="block truncate text-sm" style={{ color: tone.inkSoft }}>
                    {d.client?.name || "Sans client"}{d.chantier ? ` · ${d.chantier}` : ""} · {atelierDocDate(d)}
                    {badge && <span> · {badge}</span>}
                  </span>
                </button>
                <span className="ml-8 flex w-full items-center gap-2 sm:ml-0 sm:w-auto sm:shrink-0">
                <span className="mr-auto shrink-0 sm:mr-0">
                  {amount ? <span className="df-mono text-sm font-medium">{eur(amount.value)} <span className="text-xs font-normal" style={{ color: tone.inkSoft }}>{amount.note}</span></span> : <span className="text-xs" style={{ color: tone.inkSoft }}>—</span>}
                </span>
                {docStatuses ? (
                  <select
                    value={docStatuses.includes(d.status) ? d.status : "brouillon"}
                    onChange={(e) => onChangeStatus(d.id, e.target.value)}
                    disabled={!canEdit}
                    className="df-select df-at-tap shrink-0 rounded-full px-2 py-1 text-xs font-medium"
                    style={{ background: `${atelierStatusColor(d.status, tone)}1A`, color: atelierStatusColor(d.status, tone), border: `1px solid ${atelierStatusColor(d.status, tone)}55`, maxWidth: 110 }}
                    title="Changer le statut"
                  >
                    {docStatuses.map((s) => <option key={s} value={s} style={{ color: tone.ink }}>{atelierCapitalize(s)}</option>)}
                  </select>
                ) : (
                  <span className="shrink-0 rounded-full px-2 py-1 text-xs font-medium" style={{ background: d.workStage === "termine" ? `${tone.success}1A` : tone.paper, color: d.workStage === "termine" ? tone.success : tone.inkSoft }}>{d.workStage === "termine" ? "Terminé" : "En cours"}</span>
                )}
                {canEdit && (
                  <span className="flex shrink-0 items-center">
                    <button onClick={() => onDuplicate(d.id)} className="df-at-tap flex h-11 w-9 items-center justify-center" style={{ color: tone.inkSoft }} title="Dupliquer" aria-label="Dupliquer"><Copy size={16} /></button>
                    <button onClick={() => onDelete(d.id)} className="df-at-tap flex h-11 w-9 items-center justify-center" style={{ color: tone.danger }} title="Supprimer" aria-label="Supprimer"><Trash2 size={16} /></button>
                  </span>
                )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="sticky bottom-[76px] z-20 mt-4 flex flex-wrap items-center gap-2 rounded-xl px-4 py-3 shadow-lg md:bottom-4" style={{ background: tone.ink, color: "white" }}>
          <span className="text-sm font-medium">{selectedIds.length} sélectionné{selectedIds.length > 1 ? "s" : ""}</span>
          {!sameType && <span className="text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>Sélectionne des documents du même type pour les actions groupées.</span>}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {canMerge && <button onClick={() => onMerge(selectedIds)} className="df-at-tap flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: tone.accent, color: "white" }}><GitMerge size={14} /> Fusionner</button>}
            <button onClick={() => canBatch && onBatchExcel(selectedDocs)} disabled={!canBatch} className="df-at-tap flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: "rgba(255,255,255,0.12)", color: "white", opacity: canBatch ? 1 : 0.5 }}><FileSpreadsheet size={14} /> Excel</button>
            <button onClick={() => canBatch && onBatchPdf(selectedDocs)} disabled={!canBatch || batchExporting} className="df-at-tap flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: "rgba(255,255,255,0.12)", color: "white", opacity: canBatch ? 1 : 0.5 }}>{batchExporting ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} PDF</button>
            <button onClick={onClearSelection} className="df-at-tap px-2 py-2 text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>Annuler</button>
          </span>
        </div>
      )}
    </div>
  );
}

// --- Chantiers Atelier : liste, fiche chantier (documents, planning,
// photos). Un chantier existe dès qu'un document porte son nom dans le
// champ « Chantier » (même règle que la page Chantiers existante). Les
// créneaux viennent du même stockage que le Planning d'équipe.

// Créneaux et membres de l'équipe, partagés avec la page Planning
// d'équipe (clé « team-planning »). Lecture à l'ouverture, enregistrement
// complet à chaque changement, comme la page existante.
function useAtelierPlanning(organizationId) {
  const [slots, setSlots] = useState(null);
  const [members, setMembers] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSlots(null);
    if (!organizationId) { setSlots([]); return; }
    (async () => {
      try {
        const res = await window.storage.get("team-planning", false);
        const parsed = JSON.parse(res.value);
        if (!cancelled) setSlots(Array.isArray(parsed) ? parsed : []);
      } catch (err) {
        if (cancelled) return;
        if (err?.code !== "KEY_NOT_FOUND") console.error("Erreur de chargement du planning", err);
        setSlots([]);
      }
    })();
    db.rpc("get_organization_members_with_profiles", { org_id: organizationId }).then(({ data, error }) => {
      if (error || cancelled) return;
      setMembers((data || []).filter((m) => m.status === "active").map((m) => ({ userId: m.user_id, label: m.email || "Membre" })));
    });
    return () => { cancelled = true; };
  }, [organizationId]);
  async function persist(next) {
    setSlots(next);
    setSaving(true);
    try {
      await window.storage.set("team-planning", JSON.stringify(next), false);
    } catch (err) {
      console.error("Erreur d'enregistrement du planning", err);
      alert("Impossible d'enregistrer le planning pour l'instant. Réessaie dans un instant.");
    } finally {
      setSaving(false);
    }
  }
  return { slots, members, saving, persist };
}

// Regroupe les documents par chantier, avec les montants, le client, les
// photos et le prochain créneau planifié.
function atelierChantierStats(documents, slots) {
  const map = new Map();
  for (const d of documents) {
    const nom = (d.chantier || "").trim();
    if (!nom) continue;
    if (!map.has(nom)) map.set(nom, { nom, docs: [], devisTotal: 0, factureTotal: 0, photos: 0, clients: new Map(), lastUpdate: 0 });
    const c = map.get(nom);
    c.docs.push(d);
    if (d.type === "devis") c.devisTotal += computeTotals(d).totalTTC;
    if (d.type === "facture") c.factureTotal += computeTotals(d).totalTTC;
    if (Array.isArray(d.photos)) c.photos += d.photos.length;
    const clientName = (d.client?.name || "").trim();
    if (clientName) c.clients.set(clientName, (c.clients.get(clientName) || 0) + 1);
    c.lastUpdate = Math.max(c.lastUpdate, d.updatedAt || d.createdAt || 0);
  }
  const todayIso = toIsoDate(new Date());
  return [...map.values()].map((c) => {
    const client = [...c.clients.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const mine = (slots || []).filter((s) => (s.chantier || "").trim() === c.nom).sort((a, b) => a.start.localeCompare(b.start));
    const next = mine.find((s) => s.end >= todayIso) || null;
    return { ...c, client, slots: mine, nextSlot: next, ecart: c.devisTotal - c.factureTotal };
  }).sort((a, b) => b.lastUpdate - a.lastUpdate);
}

// Fenêtre de création / modification d'un créneau (même contenu que sur
// la page Planning d'équipe, avec le chantier déjà rempli).
function AtelierSlotModal({ editing, setEditing, members, canEdit, onSave, onDelete, darkMode }) {
  const tone = atelierTone(darkMode);
  useEscapeToClose(!!editing, () => setEditing(null));
  if (!editing) return null;
  const field = { background: tone.surface, border: `1px solid ${tone.line}`, color: tone.ink };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" style={{ background: "rgba(28,39,51,0.55)" }} onClick={() => setEditing(null)}>
      <div className="w-full max-w-md rounded-t-2xl p-5 sm:rounded-2xl" style={{ background: tone.surface, color: tone.ink, border: `1px solid ${tone.line}` }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="df-display text-lg font-semibold">{editing.id ? "Modifier le créneau" : "Nouveau créneau"}</h2>
          <button onClick={() => setEditing(null)} className="df-at-tap flex h-11 w-11 items-center justify-center" style={{ color: tone.inkSoft }}><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: tone.inkSoft }}>Titre</label>
            <input autoFocus className="df-input df-at-tap w-full rounded-md px-3 py-2 text-[15px]" style={field} placeholder="Ex. Pose carrelage salle de bain" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} disabled={!canEdit} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: tone.inkSoft }}>Début</label>
              <input type="date" className="df-input df-mono df-at-tap w-full rounded-md px-3 py-2 text-sm" style={field} value={editing.start} onChange={(e) => setEditing({ ...editing, start: e.target.value, end: editing.end < e.target.value ? e.target.value : editing.end })} disabled={!canEdit} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: tone.inkSoft }}>Fin</label>
              <input type="date" className="df-input df-mono df-at-tap w-full rounded-md px-3 py-2 text-sm" style={field} value={editing.end} min={editing.start} onChange={(e) => setEditing({ ...editing, end: e.target.value })} disabled={!canEdit} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: tone.inkSoft }}>Membre de l'équipe</label>
            <select className="df-select df-at-tap w-full rounded-md px-3 py-2 text-[15px]" style={field} value={editing.memberUserId || ""} onChange={(e) => setEditing({ ...editing, memberUserId: e.target.value })} disabled={!canEdit}>
              <option value="">Non assigné</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: tone.inkSoft }}>Chantier</label>
            <input className="df-input df-at-tap w-full rounded-md px-3 py-2 text-[15px]" style={{ ...field, background: tone.paper }} value={editing.chantier || ""} readOnly />
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between gap-2">
          <div>{canEdit && editing.id && <button onClick={onDelete} className="df-at-tap flex items-center gap-1.5 text-sm font-medium" style={{ color: tone.danger }}><Trash2 size={15} /> Supprimer</button>}</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing(null)} className="df-at-tap rounded-lg px-3 py-2 text-sm font-medium" style={{ border: `1px solid ${tone.line}`, color: tone.inkSoft }}>{canEdit ? "Annuler" : "Fermer"}</button>
            {canEdit && <button onClick={onSave} className="df-at-tap rounded-lg px-4 py-2 text-sm font-bold" style={{ background: tone.accent, color: "white" }}>Enregistrer</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Liste des chantiers + onglet Planning d'équipe.
function AtelierChantiersView({ documents, account, siteSettings, darkMode, isLocked, isViewer, onOpenChantier, onNewChantier }) {
  const tone = atelierTone(darkMode);
  const [tab, setTab] = useState("chantiers");
  const [newName, setNewName] = useState("");
  const [asking, setAsking] = useState(false);
  const { slots } = useAtelierPlanning(account?.organizationId);
  const chantiers = useMemo(() => atelierChantierStats(documents, slots), [documents, slots]);
  const card = { background: tone.surface, border: `1px solid ${tone.line}` };
  const canEdit = !isLocked && !isViewer;
  const chip = (active) => ({ background: active ? tone.accent : tone.surface, color: active ? "white" : tone.ink, border: `1px solid ${active ? tone.accent : tone.line}` });
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="df-display text-2xl font-bold">Chantiers</h1>
          <p className="text-sm" style={{ color: tone.inkSoft }}>Tout ce qui concerne un chantier au même endroit : documents, planning, photos.</p>
        </div>
        <div className="flex gap-2 rounded-full p-1" style={{ background: tone.surface, border: `1px solid ${tone.line}` }}>
          {[["chantiers", "Chantiers"], ["planning", "Planning d'équipe"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className="df-at-tap rounded-full px-4 py-2 text-sm font-medium" style={chip(tab === id)}>{label}</button>
          ))}
        </div>
      </div>

      {tab === "planning" ? (
        <div className="-mx-4 sm:-mx-6"><PlanningView documents={documents} account={account} siteSettings={siteSettings} darkMode={darkMode} isLocked={isLocked} isViewer={isViewer} /></div>
      ) : (
        <>
          {canEdit && (
            <div className="mb-4">
              {!asking ? (
                <button onClick={() => setAsking(true)} className="df-at-tap flex items-center gap-2 rounded-lg px-4 py-2 text-[15px] font-bold" style={{ background: tone.action, color: "#1C2733" }}><Plus size={18} /> Nouveau chantier</button>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); const n = newName.trim(); if (!n) return; setAsking(false); setNewName(""); onNewChantier(n); }} className="flex flex-wrap items-end gap-2 rounded-xl p-4" style={card}>
                  <div className="min-w-[220px] flex-1">
                    <label className="mb-1 block text-xs font-medium" style={{ color: tone.inkSoft }}>Nom du chantier</label>
                    <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex. Rénovation cuisine Dupont" className="df-input df-at-tap w-full rounded-md px-3 py-2 text-[15px]" style={{ background: tone.surface, border: `1px solid ${tone.line}`, color: tone.ink }} />
                  </div>
                  <button type="submit" className="df-at-tap rounded-lg px-4 py-2 text-sm font-bold" style={{ background: tone.accent, color: "white" }}>Créer le premier document</button>
                  <button type="button" onClick={() => { setAsking(false); setNewName(""); }} className="df-at-tap rounded-lg px-3 py-2 text-sm font-medium" style={{ border: `1px solid ${tone.line}`, color: tone.inkSoft }}>Annuler</button>
                  <p className="w-full text-xs" style={{ color: tone.inkSoft }}>Un chantier apparaît ici dès qu'un document porte son nom. Choisis le premier document à créer, le nom du chantier sera déjà rempli.</p>
                </form>
              )}
            </div>
          )}
          {chantiers.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ ...card, borderStyle: "dashed" }}>
              <HardHat size={28} style={{ color: tone.inkSoft, margin: "0 auto 8px" }} />
              <p className="text-[15px] font-semibold">Aucun chantier pour l'instant</p>
              <p className="mt-1 text-sm" style={{ color: tone.inkSoft }}>Renseigne le champ « Chantier » sur un devis ou une facture, ou appuie sur « Nouveau chantier ».</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {chantiers.map((c) => (
                <button key={c.nom} onClick={() => onOpenChantier(c.nom)} className="df-at-tap flex flex-col gap-2 rounded-xl p-4 text-left" style={card}>
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold">{c.nom}</span>
                      <span className="block truncate text-sm" style={{ color: tone.inkSoft }}>{c.client || "Client non renseigné"} · {c.docs.length} document{c.docs.length > 1 ? "s" : ""}{c.photos ? ` · ${c.photos} photo${c.photos > 1 ? "s" : ""}` : ""}</span>
                    </span>
                    <ChevronRight size={18} className="shrink-0" style={{ color: tone.inkSoft }} />
                  </span>
                  <span className="grid grid-cols-3 gap-2 text-xs">
                    <span><span className="block" style={{ color: tone.inkSoft }}>Prévu</span><span className="df-mono font-medium">{eur(c.devisTotal)}</span></span>
                    <span><span className="block" style={{ color: tone.inkSoft }}>Facturé</span><span className="df-mono font-medium">{eur(c.factureTotal)}</span></span>
                    <span><span className="block" style={{ color: tone.inkSoft }}>Écart</span><span className="df-mono font-semibold" style={{ color: c.ecart >= 0 ? tone.success : tone.danger }}>{c.ecart >= 0 ? "+" : ""}{eur(c.ecart)}</span></span>
                  </span>
                  {c.nextSlot && <span className="flex items-center gap-1.5 text-xs" style={{ color: tone.accent }}><Calendar size={13} /> {fr(c.nextSlot.start)} : {c.nextSlot.title}{c.nextSlot.memberLabel ? ` (${c.nextSlot.memberLabel})` : ""}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Fiche d'un chantier : documents groupés par famille, créneaux du
// planning, photos de tous ses rapports, PV et situations.
function AtelierChantierView({ name, documents, account, darkMode, isLocked, isViewer, onBack, onOpenDoc, onCreateForChantier }) {
  const tone = atelierTone(darkMode);
  const [tab, setTab] = useState("documents");
  const [editing, setEditing] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const { slots, members, saving, persist } = useAtelierPlanning(account?.organizationId);
  const canEdit = !isLocked && !isViewer;
  const card = { background: tone.surface, border: `1px solid ${tone.line}` };
  const chip = (active) => ({ background: active ? tone.accent : tone.surface, color: active ? "white" : tone.ink, border: `1px solid ${active ? tone.accent : tone.line}` });

  const stats = useMemo(() => atelierChantierStats(documents, slots).find((c) => c.nom === name) || { nom: name, docs: [], devisTotal: 0, factureTotal: 0, ecart: 0, client: "", photos: 0, slots: [], nextSlot: null }, [documents, slots, name]);
  const families = ATELIER_FAMILIES.map((f) => ({ ...f, docs: stats.docs.filter((d) => f.services.includes(d.type)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)) })).filter((f) => f.docs.length);
  const photoDocs = stats.docs.filter((d) => Array.isArray(d.photos) && d.photos.length);
  const allPhotos = photoDocs.flatMap((d) => d.photos.map((p) => ({ ...p, doc: d })));
  const pathsKey = allPhotos.map((p) => p.path).join("|");
  useEffect(() => {
    let cancelled = false;
    if (!pathsKey || tab !== "photos") return;
    signPhotoPaths(pathsKey.split("|")).then((map) => { if (!cancelled) setPhotoUrls(map); }).catch((err) => console.error("Erreur de chargement des photos", err));
    return () => { cancelled = true; };
  }, [pathsKey, tab]);

  const todayIso = toIsoDate(new Date());
  const upcoming = stats.slots.filter((s) => s.end >= todayIso);
  const past = stats.slots.filter((s) => s.end < todayIso).reverse();
  function newSlot() {
    if (!canEdit) return;
    setEditing({ id: null, title: "", start: todayIso, end: todayIso, memberUserId: members[0]?.userId || "", chantier: name });
  }
  function saveSlot() {
    if (!editing.title.trim()) { alert("Indique un titre pour ce créneau."); return; }
    if (editing.end < editing.start) { alert("La date de fin doit être après la date de début."); return; }
    const member = members.find((m) => m.userId === editing.memberUserId);
    const now = Date.now();
    const base = { title: editing.title.trim(), start: editing.start, end: editing.end, memberUserId: member?.userId || "", memberLabel: member?.label || "", chantier: name, updatedAt: now };
    if (editing.id) persist((slots || []).map((s) => (s.id === editing.id ? { ...s, ...base } : s)));
    else persist([...(slots || []), { id: nextId("pl"), createdAt: now, ...base }]);
    setEditing(null);
  }
  function deleteSlot() {
    if (!editing?.id || !window.confirm(`Supprimer le créneau « ${editing.title} » ?`)) return;
    persist((slots || []).filter((s) => s.id !== editing.id));
    setEditing(null);
  }
  const slotRow = (s) => (
    <button key={s.id} onClick={() => setEditing({ ...s })} className="df-at-tap flex w-full items-center gap-3 px-4 py-3 text-left" style={{ borderTop: `1px solid ${tone.line}` }}>
      <span className="df-mono shrink-0 text-sm" style={{ color: tone.inkSoft }}>{fr(s.start)}{s.end !== s.start ? ` → ${fr(s.end)}` : ""}</span>
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{s.title}</span>
      {(members.find((m) => m.userId === s.memberUserId)?.label || s.memberLabel) && <span className="hidden shrink-0 rounded-full px-2 py-0.5 text-xs sm:inline" style={{ background: tone.accentSoft, color: tone.accent }}>{members.find((m) => m.userId === s.memberUserId)?.label || s.memberLabel}</span>}
      <ChevronRight size={16} className="shrink-0" style={{ color: tone.inkSoft }} />
    </button>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <button onClick={onBack} className="df-at-tap mb-3 flex items-center gap-1 text-sm font-medium" style={{ color: tone.inkSoft }}><ArrowLeft size={16} /> Tous les chantiers</button>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="df-display truncate text-2xl font-bold">{name}</h1>
          <p className="text-sm" style={{ color: tone.inkSoft }}>{stats.client || "Client non renseigné"} · {stats.docs.length} document{stats.docs.length > 1 ? "s" : ""}</p>
        </div>
        {canEdit && (
          <button onClick={() => onCreateForChantier(name)} className="df-at-tap flex items-center gap-2 rounded-lg px-4 py-2 text-[15px] font-bold" style={{ background: tone.action, color: "#1C2733" }}><Plus size={18} /> Créer pour ce chantier</button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
        {[["Prévu (devis)", eur(stats.devisTotal), tone.ink], ["Facturé", eur(stats.factureTotal), tone.ink], ["Écart", `${stats.ecart >= 0 ? "+" : ""}${eur(stats.ecart)}`, stats.ecart >= 0 ? tone.success : tone.danger]].map(([label, value, color]) => (
          <div key={label} className="rounded-xl p-3 sm:p-4" style={card}>
            <div className="text-xs" style={{ color: tone.inkSoft }}>{label}</div>
            <div className="df-mono truncate text-sm font-semibold sm:text-lg" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
        {[["documents", `Documents (${stats.docs.length})`], ["planning", `Planning (${stats.slots.length})`], ["photos", `Photos (${allPhotos.length})`]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className="df-at-tap shrink-0 rounded-full px-4 py-2 text-sm font-medium" style={chip(tab === id)}>{label}</button>
        ))}
      </div>

      {tab === "documents" && (
        families.length === 0 ? (
          <div className="rounded-xl p-8 text-center" style={{ ...card, borderStyle: "dashed" }}>
            <p className="text-[15px] font-semibold">Aucun document sur ce chantier</p>
            <p className="mt-1 text-sm" style={{ color: tone.inkSoft }}>Appuie sur « Créer pour ce chantier » : le nom sera déjà rempli.</p>
          </div>
        ) : families.map((f) => (
          <div key={f.id} className="mb-4">
            <h2 className="df-display mb-2 text-sm font-semibold uppercase tracking-wide" style={{ color: tone.accent }}>{f.label}</h2>
            <div className="overflow-hidden rounded-xl" style={card}>
              {f.docs.map((d, i) => {
                const amount = atelierDocAmount(d);
                const statuses = atelierStatusesFor(d.type);
                const badge = atelierDocBadge(d);
                return (
                  <button key={d.id} onClick={() => onOpenDoc(d.id)} className="df-at-tap flex w-full items-center gap-3 px-4 py-3 text-left" style={{ borderTop: i ? `1px solid ${tone.line}` : "none" }}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{atelierServiceLabel(d.type)} <span className="df-mono font-normal" style={{ color: tone.inkSoft }}>{d.docNumber}</span></span>
                      <span className="block truncate text-sm" style={{ color: tone.inkSoft }}>{atelierDocDate(d)}{badge ? ` · ${badge}` : ""}{Array.isArray(d.photos) && d.photos.length ? ` · ${d.photos.length} photo${d.photos.length > 1 ? "s" : ""}` : ""}</span>
                    </span>
                    {statuses ? (
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${atelierStatusColor(d.status, tone)}1A`, color: atelierStatusColor(d.status, tone) }}>{atelierCapitalize(d.status || "brouillon")}</span>
                    ) : (
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: d.workStage === "termine" ? `${tone.success}1A` : tone.paper, color: d.workStage === "termine" ? tone.success : tone.inkSoft }}>{d.workStage === "termine" ? "Terminé" : "En cours"}</span>
                    )}
                    {amount && <span className="df-mono hidden shrink-0 text-sm sm:inline">{eur(amount.value)}</span>}
                    <ChevronRight size={16} className="shrink-0" style={{ color: tone.inkSoft }} />
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}

      {tab === "planning" && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm" style={{ color: tone.inkSoft }}>{slots === null ? "Chargement…" : upcoming.length ? `${upcoming.length} créneau${upcoming.length > 1 ? "x" : ""} à venir` : "Aucun créneau à venir"}{saving ? " · enregistrement…" : ""}</p>
            {canEdit && <button onClick={newSlot} className="df-at-tap flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold" style={{ background: tone.accent, color: "white" }}><Plus size={16} /> Ajouter un créneau</button>}
          </div>
          {stats.slots.length === 0 && slots !== null ? (
            <div className="rounded-xl p-8 text-center" style={{ ...card, borderStyle: "dashed" }}>
              <p className="text-[15px] font-semibold">Rien de planifié sur ce chantier</p>
              <p className="mt-1 text-sm" style={{ color: tone.inkSoft }}>Ajoute un créneau pour placer un membre de l'équipe à une date donnée. Il apparaîtra aussi dans le Planning d'équipe.</p>
            </div>
          ) : (
            <>
              {upcoming.length > 0 && <div className="mb-3 overflow-hidden rounded-xl" style={card}><div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: tone.inkSoft }}>À venir</div>{upcoming.map(slotRow)}</div>}
              {past.length > 0 && <div className="overflow-hidden rounded-xl" style={card}><div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: tone.inkSoft }}>Passés</div>{past.map(slotRow)}</div>}
            </>
          )}
          <AtelierSlotModal editing={editing} setEditing={setEditing} members={members} canEdit={canEdit} onSave={saveSlot} onDelete={deleteSlot} darkMode={darkMode} />
        </div>
      )}

      {tab === "photos" && (
        allPhotos.length === 0 ? (
          <div className="rounded-xl p-8 text-center" style={{ ...card, borderStyle: "dashed" }}>
            <Camera size={26} style={{ color: tone.inkSoft, margin: "0 auto 8px" }} />
            <p className="text-[15px] font-semibold">Aucune photo sur ce chantier</p>
            <p className="mt-1 text-sm" style={{ color: tone.inkSoft }}>Les photos ajoutées aux rapports d'intervention, PV de réception et situations de travaux de ce chantier apparaissent ici.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {allPhotos.map((p) => (
              <button key={p.id} onClick={() => onOpenDoc(p.doc.id)} className="relative overflow-hidden rounded-xl text-left" style={{ aspectRatio: "1 / 1", ...card }} title={`${atelierServiceLabel(p.doc.type)} ${p.doc.docNumber}`}>
                {photoUrls[p.path] ? <img src={photoUrls[p.path]} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center"><Loader2 size={16} className="animate-spin" style={{ color: tone.inkSoft }} /></span>}
                <span className="absolute inset-x-0 bottom-0 truncate px-2 py-1 text-[11px] font-medium text-white" style={{ background: "linear-gradient(to top, rgba(28,39,51,0.75), transparent)" }}>{atelierServiceLabel(p.doc.type)} {p.doc.docNumber}</span>
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// Page d'accueil publique de la version Atelier (visiteurs non
// connectés). Tutoiement, comme le reste du site. Sections dans l'ordre
// qui convainc : promesse, les 15 documents, comment ça marche, ce qui
// change au quotidien, tarifs complets, questions, appel final.
const ATELIER_LANDING_FEATURES = [
  { icon: FileSignature, title: "Signature et paiement en ligne", text: "Tu envoies un lien ou un QR code : ton client signe le devis ou paie la facture depuis son téléphone, sans créer de compte." },
  { icon: Receipt, title: "Prêt pour la facture électronique", text: "Chaque facture peut être téléchargée au format Factur-X, le format de la réforme 2026-2027. La connexion à une plateforme agréée est prévue." },
  { icon: Camera, title: "Photos de chantier", text: "Prends des photos directement depuis le rapport d'intervention, le PV de réception ou la situation de travaux : elles sont dans le PDF." },
  { icon: HardHat, title: "Chaque chantier au même endroit", text: "Devis, factures, planning de l'équipe et photos regroupés par chantier, avec le prévu, le facturé et l'écart." },
  { icon: Calculator, title: "Calculs sans erreur", text: "TVA à plusieurs taux, remises, acomptes, retenue de garantie : les totaux se recalculent seuls." },
  { icon: Printer, title: "PDF et Excel en un clic", text: "Un PDF propre à envoyer tel quel, ou un fichier Excel avec tous les calculs pour ton comptable." },
];
const ATELIER_LANDING_FAQ = [
  { q: "Est-ce que je dois donner ma carte bancaire pour essayer ?", a: "Non. Le forfait Gratuit se crée sans carte bancaire et te laisse créer quelques documents pour te faire une idée. Tu passes à un forfait payant seulement si tu en as besoin." },
  { q: "Je ne suis pas à l'aise avec l'informatique, c'est fait pour moi ?", a: "Oui. Il y a quatre rubriques, un bouton « Créer » toujours visible, et chaque document t'indique quoi remplir. Ça fonctionne aussi bien sur téléphone que sur ordinateur." },
  { q: "Un devis signé devient-il une facture ?", a: "Oui. Quand ton client signe, en ligne ou sur place, la facture est créée automatiquement avec les mêmes lignes. Tu n'as plus qu'à l'envoyer." },
  { q: "Est-ce conforme à la réforme de la facturation électronique ?", a: "Tes factures comportent les mentions obligatoires et peuvent être exportées au format Factur-X dès aujourd'hui. La transmission par une plateforme agréée, obligatoire pour les TPE et PME à partir de septembre 2027, est prévue dans les prochaines versions." },
  { q: "Mes données et celles de mes clients sont-elles protégées ?", a: "Tes documents et tes photos ne sont visibles que par toi et les membres de ton équipe. Rien n'est partagé ni revendu." },
  { q: "Puis-je changer de forfait ou arrêter quand je veux ?", a: "Oui, depuis ton compte, à tout moment. L'abonnement mensuel est sans engagement." },
];

function LandingPageAtelier({ plans, siteSettings, onGetStarted, onLogin, onContact, onLegal }) {
  const tone = atelier;
  const [mobileMenu, setMobileMenu] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [annual, setAnnual] = useState(false);
  const visiblePlans = plans.filter((p) => !p.hidden);
  const freePlan = plans.find((p) => p.id === "gratuit");
  const freeLimit = Number.isFinite(freePlan?.limit) ? freePlan.limit : null;
  const visibleServices = siteSettings?.visibleServices || SERVICES.filter((s) => s.implemented).map((s) => s.id);
  const families = ATELIER_FAMILIES.map((f) => ({ ...f, items: f.services.map((id) => getService(id)).filter((s) => s && s.implemented && visibleServices.includes(s.id)) })).filter((f) => f.items.length);
  const serviceCount = families.reduce((n, f) => n + f.items.length, 0);
  const year = new Date().getFullYear();
  const card = { background: tone.surface, border: `1px solid ${tone.line}` };
  const navLinks = [["#services", "Les documents"], ["#fonctionnalites", "Ce qui change"], ["#tarifs", "Tarifs"], ["#faq", "Questions"]];
  const priceOf = (plan) => (annual ? plan.annual : plan.monthly);

  return (
    <div className="df-root min-h-full w-full" style={{ backgroundColor: tone.paper, color: tone.ink }}>
      <GlobalStyle />

      {/* Barre de navigation */}
      <nav className="sticky top-0 z-30 border-b" style={{ background: tone.surface, borderColor: tone.line }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            {siteSettings?.logo ? (
              <img src={siteSettings.logo} alt="" style={{ width: siteSettings.logoWidth || 34, height: siteSettings.logoHeight || 34, objectFit: "contain" }} />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-lg text-white" style={{ background: tone.accent }}><HardHat size={18} /></span>
            )}
            <span className="df-display text-lg font-bold">{siteSettings?.name || "Chantiflow"}</span>
          </div>
          <div className="hidden items-center gap-6 text-sm font-medium lg:flex" style={{ color: tone.inkSoft }}>
            {navLinks.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
            <button onClick={onContact}>Contact</button>
          </div>
          <div className="hidden items-center gap-3 lg:flex">
            <button onClick={onLogin} className="df-at-tap px-3 text-sm font-semibold" style={{ color: tone.ink }}>Connexion</button>
            <button onClick={onGetStarted} className="df-at-tap rounded-lg px-5 py-2.5 text-sm font-bold" style={{ background: tone.action, color: "#1C2733" }}>Essayer gratuitement</button>
          </div>
          <button onClick={() => setMobileMenu((v) => !v)} className="df-at-tap flex h-11 w-11 items-center justify-center lg:hidden" title="Menu" aria-label="Ouvrir le menu">{mobileMenu ? <X size={22} /> : <Menu size={22} />}</button>
        </div>
        {mobileMenu && (
          <div className="flex flex-col gap-1 border-t px-4 py-3 lg:hidden" style={{ borderColor: tone.line }}>
            {navLinks.map(([href, label]) => <a key={href} href={href} onClick={() => setMobileMenu(false)} className="df-at-tap flex items-center px-2 text-[15px] font-medium">{label}</a>)}
            <button onClick={onContact} className="df-at-tap flex items-center px-2 text-left text-[15px] font-medium">Contact</button>
            <button onClick={onLogin} className="df-at-tap flex items-center px-2 text-left text-[15px] font-semibold">Connexion</button>
            <button onClick={onGetStarted} className="df-at-tap mt-2 rounded-lg px-4 py-3 text-center text-[15px] font-bold" style={{ background: tone.action, color: "#1C2733" }}>Essayer gratuitement</button>
          </div>
        )}
      </nav>

      {/* Promesse */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-14 pt-12 sm:px-6 lg:grid-cols-2 lg:pt-20">
        <div>
          <span className="inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide" style={{ background: tone.accentSoft, color: tone.accent }}>Pour les artisans et entreprises du bâtiment</span>
          <h1 className="df-display mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">Tes devis, tes factures et tes chantiers, <span style={{ color: tone.accent }}>au même endroit</span></h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed" style={{ color: tone.inkSoft }}>
            {siteSettings?.name || "Chantiflow"} crée tes documents en quelques minutes, fait signer et payer tes clients en ligne, et suit chaque chantier du devis à l'encaissement. Simple, même si tu n'aimes pas l'informatique.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <button onClick={onGetStarted} className="df-at-tap rounded-xl px-6 py-3.5 text-[16px] font-bold" style={{ background: tone.action, color: "#1C2733" }}>Créer mon compte gratuit</button>
            <a href="#services" className="df-at-tap flex items-center justify-center rounded-xl px-6 py-3.5 text-[16px] font-semibold" style={{ ...card, color: tone.ink }}>Voir les {serviceCount} documents</a>
          </div>
          <p className="mt-4 text-sm" style={{ color: tone.inkSoft }}>
            Sans carte bancaire{freeLimit ? ` · ${freeLimit} documents offerts pour essayer` : ""} · Factures prêtes pour la réforme électronique
          </p>
        </div>
        {/* Aperçu : ce que l'artisan voit sur son téléphone */}
        <div className="mx-auto w-full max-w-sm">
          <div className="overflow-hidden rounded-[28px] p-3" style={{ background: tone.ink, boxShadow: "0 24px 60px rgba(28,39,51,0.25)" }}>
            <div className="overflow-hidden rounded-[20px]" style={{ background: tone.paper }}>
              <div className="px-4 pb-3 pt-4">
                <div className="df-display text-lg font-bold" style={{ color: tone.ink }}>Bonjour Thomas</div>
                <div className="text-xs" style={{ color: tone.inkSoft }}>À faire aujourd'hui</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[["Devis en attente", "2", "4 320 €", tone.warning], ["À encaisser", "3", "7 850 €", tone.accent], ["En retard", "1", "1 200 €", tone.danger], ["En cours", "4", "brouillons", tone.inkSoft]].map(([l, n, s, c]) => (
                    <div key={l} className="rounded-xl p-3" style={card}>
                      <div className="text-[10px]" style={{ color: tone.inkSoft }}>{l}</div>
                      <div className="df-display text-xl font-bold" style={{ color: c }}>{n}</div>
                      <div className="df-mono text-[10px]" style={{ color: tone.inkSoft }}>{s}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-xl p-3" style={card}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold" style={{ color: tone.ink }}>Devis DEV-2026-014</div>
                      <div className="text-[10px]" style={{ color: tone.inkSoft }}>Rénovation salle de bain · M. Dupont</div>
                    </div>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${tone.success}1A`, color: tone.success }}>Signé en ligne</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-5 border-t px-1 py-2 text-[9px]" style={{ background: tone.surface, borderColor: tone.line, color: tone.inkSoft }}>
                {[["Accueil", Home, true], ["Documents", Files, false], ["Créer", Plus, "action"], ["Chantiers", HardHat, false], ["Clients", Users, false]].map(([l, Icon, state]) => (
                  <div key={l} className="flex flex-col items-center gap-0.5" style={{ color: state === true ? tone.accent : tone.inkSoft }}>
                    {state === "action" ? <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: tone.action, color: "#1C2733" }}><Icon size={16} /></span> : <Icon size={16} />}
                    {l}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Les documents */}
      <section id="services" className="border-t py-14" style={{ background: tone.surface, borderColor: tone.line }}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto mb-8 max-w-2xl text-center">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: tone.accent }}>Les documents</span>
            <h2 className="df-display mt-2 text-2xl font-bold sm:text-3xl">{serviceCount} documents du métier, un seul outil</h2>
            <p className="mt-2 text-[15px]" style={{ color: tone.inkSoft }}>Du premier devis au PV de réception, chaque étape du chantier a son document, prêt à remplir.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {families.map((f) => (
              <div key={f.id} className="rounded-2xl p-5" style={{ background: tone.paper, border: `1px solid ${tone.line}` }}>
                <div className="mb-3 flex items-baseline gap-2">
                  <h3 className="df-display text-base font-bold" style={{ color: tone.accent }}>{f.label}</h3>
                  <span className="text-xs" style={{ color: tone.inkSoft }}>{f.hint}</span>
                </div>
                <ul className="space-y-2">
                  {f.items.map((s) => {
                    const SIcon = s.icon;
                    return (
                      <li key={s.id} className="flex items-start gap-2.5 text-sm">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: tone.accentSoft, color: tone.accent }}><SIcon size={15} /></span>
                        <span><span className="font-semibold">{s.label}</span> <span style={{ color: tone.inkSoft }}>— {s.description}</span></span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comment ça marche */}
      <section className="py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto mb-8 max-w-2xl text-center">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: tone.accent }}>Comment ça marche</span>
            <h2 className="df-display mt-2 text-2xl font-bold sm:text-3xl">Trois étapes, du devis à l'argent sur ton compte</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              ["1", "Tu crées", "Appuie sur « Créer », choisis le document, remplis les lignes. Tes clients et tes prestations sont mémorisés pour la prochaine fois."],
              ["2", "Ton client signe ou paie", "Envoie un lien ou imprime le QR code : il signe le devis ou paie la facture depuis son téléphone. Le devis signé devient une facture tout seul."],
              ["3", "Tu suis et tu relances", "Sur l'accueil, tu vois ce qui attend une réponse, ce qui est à encaisser et ce qui est en retard. Un clic pour relancer par email."],
            ].map(([n, title, text]) => (
              <div key={n} className="rounded-2xl p-6" style={card}>
                <span className="df-display flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold text-white" style={{ background: tone.accent }}>{n}</span>
                <h3 className="df-display mt-4 text-lg font-bold">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: tone.inkSoft }}>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Ce qui change au quotidien */}
      <section id="fonctionnalites" className="border-t py-14" style={{ background: tone.surface, borderColor: tone.line }}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto mb-8 max-w-2xl text-center">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: tone.accent }}>Ce qui change au quotidien</span>
            <h2 className="df-display mt-2 text-2xl font-bold sm:text-3xl">Moins de paperasse, plus de chantier</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ATELIER_LANDING_FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl p-5" style={{ background: tone.paper, border: `1px solid ${tone.line}` }}>
                <span className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: tone.accentSoft, color: tone.accent }}><Icon size={20} /></span>
                <h3 className="df-display mt-3 text-base font-bold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: tone.inkSoft }}>{text}</p>
              </div>
            ))}
          </div>
          {siteSettings?.desktopAppEnabled && (
            <p className="mt-6 text-center text-sm" style={{ color: tone.inkSoft }}><Monitor size={14} className="mr-1 inline" /> Existe aussi en logiciel de bureau pour Windows et Mac, avec les mêmes données que sur ton téléphone.</p>
          )}
        </div>
      </section>

      {/* Tarifs */}
      <section id="tarifs" className="py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto mb-6 max-w-2xl text-center">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: tone.accent }}>Tarifs</span>
            <h2 className="df-display mt-2 text-2xl font-bold sm:text-3xl">Un forfait pour chaque taille d'entreprise</h2>
            <p className="mt-2 text-[15px]" style={{ color: tone.inkSoft }}>Tu commences gratuitement, tu changes de forfait quand tu veux.</p>
          </div>
          <div className="mb-8 flex justify-center">
            <div className="flex rounded-full p-1" style={card}>
              {[[false, "Mensuel"], [true, "Annuel"]].map(([value, label]) => (
                <button key={label} onClick={() => setAnnual(value)} className="df-at-tap rounded-full px-5 py-2 text-sm font-semibold" style={{ background: annual === value ? tone.accent : "transparent", color: annual === value ? "white" : tone.ink }}>{label}{value && <span className="ml-1 text-xs font-normal" style={{ color: annual === value ? "rgba(255,255,255,0.8)" : tone.inkSoft }}>(2 mois offerts)</span>}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {visiblePlans.map((plan) => {
              const featured = plan.id === "essentiel";
              const price = priceOf(plan);
              return (
                <div key={plan.id} className="flex flex-col rounded-2xl p-5" style={{ ...card, borderColor: featured ? tone.accent : tone.line, boxShadow: featured ? `0 0 0 3px ${tone.accentSoft}` : "none" }}>
                  {featured && <span className="mb-2 inline-block self-start rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide" style={{ background: tone.accentSoft, color: tone.accent }}>Le plus choisi</span>}
                  <div className="df-display text-lg font-bold">{plan.name}</div>
                  <div className="text-sm" style={{ color: tone.inkSoft }}>{plan.tagline}</div>
                  <div className="df-mono my-4">
                    {price === null || price === undefined ? <span className="text-2xl font-semibold">Sur devis</span> : (
                      <><span className="text-3xl font-extrabold">{price} €</span><span className="text-sm" style={{ color: tone.inkSoft }}>{annual ? " / an" : " / mois"}</span>
                        {annual && price > 0 && <div className="text-xs" style={{ color: tone.inkSoft }}>soit {Math.round(price / 12)} € par mois</div>}</>
                    )}
                  </div>
                  <ul className="mb-5 grow space-y-2 text-sm">
                    {(plan.features || []).map((f) => {
                      const soon = f.includes("(bientôt disponible)");
                      const clean = f.replace(" (bientôt disponible)", "");
                      return (
                        <li key={f} className="flex items-start gap-2" style={{ color: soon ? tone.inkSoft : tone.ink }}>
                          <Check size={15} className="mt-0.5 shrink-0" style={{ color: soon ? tone.inkSoft : tone.success }} />
                          <span>{clean}{soon && <span className="text-xs"> (bientôt)</span>}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <button onClick={onGetStarted} className="df-at-tap rounded-lg py-2.5 text-sm font-bold" style={featured ? { background: tone.action, color: "#1C2733" } : { background: tone.accentSoft, color: tone.accent }}>{plan.monthly === 0 ? "Commencer gratuitement" : plan.monthly === null ? "Nous contacter" : "Choisir ce forfait"}</button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Questions */}
      <section id="faq" className="border-t py-14" style={{ background: tone.surface, borderColor: tone.line }}>
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <div className="mb-6 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: tone.accent }}>Questions fréquentes</span>
            <h2 className="df-display mt-2 text-2xl font-bold">Ce qu'on nous demande le plus</h2>
          </div>
          {ATELIER_LANDING_FAQ.map((f, idx) => (
            <div key={f.q} className="border-b" style={{ borderColor: tone.line }}>
              <button onClick={() => setOpenFaq(openFaq === idx ? null : idx)} className="df-at-tap flex w-full items-center justify-between gap-3 py-4 text-left text-[15px] font-semibold">
                {f.q} <ChevronDown size={18} className="shrink-0" style={{ color: tone.inkSoft, transform: openFaq === idx ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
              </button>
              {openFaq === idx && <p className="pb-4 text-[15px] leading-relaxed" style={{ color: tone.inkSoft }}>{f.a}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* Appel final */}
      <section className="px-4 py-14 sm:px-6">
        <div className="mx-auto max-w-4xl rounded-3xl px-6 py-12 text-center" style={{ background: tone.accent, color: "white" }}>
          <h2 className="df-display text-2xl font-bold sm:text-3xl">Prêt à passer moins de temps sur la paperasse ?</h2>
          <p className="mt-3 text-[15px]" style={{ color: "rgba(255,255,255,0.8)" }}>Ton compte est créé en une minute, sans carte bancaire.</p>
          <button onClick={onGetStarted} className="df-at-tap mt-7 rounded-xl px-8 py-3.5 text-[16px] font-bold" style={{ background: tone.action, color: "#1C2733" }}>Créer mon compte gratuit</button>
        </div>
      </section>

      <footer className="border-t px-4 py-8 text-center text-sm" style={{ borderColor: tone.line, color: tone.inkSoft }}>
        © {year} {siteSettings?.name || "Chantiflow"} · Fait pour les artisans du bâtiment · <button onClick={onContact} className="underline" style={{ color: tone.inkSoft }}>Nous contacter</button>
        {onLegal && <> · <LegalLinks onLegal={onLegal} color={tone.inkSoft} /></>}
      </footer>
    </div>
  );
}

// Choix du pays et du secteur pour une nouvelle révision de prix
// (équivalent Atelier de l'écran existant, même logique).
function AtelierRevisionSectorPicker({ revisionCountry, setRevisionCountry, onPick, onBack, darkMode }) {
  const tone = atelierTone(darkMode);
  const countryInfo = getRevisionCountryInfo(revisionCountry);
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <button onClick={onBack} className="df-at-tap mb-3 flex items-center gap-1 text-sm font-medium" style={{ color: tone.inkSoft }}><ArrowLeft size={16} /> Retour</button>
      <h1 className="df-display mb-1 text-2xl font-bold">Nouvelle révision de prix</h1>
      <p className="mb-6 text-sm" style={{ color: tone.inkSoft }}>Choisis le pays, puis le secteur concerné.</p>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-widest" style={{ color: tone.inkSoft }}>Pays</label>
      <div className="mb-2 max-w-sm">
        <CountrySelect value={revisionCountry} onChange={setRevisionCountry} options={COUNTRIES.filter((c) => c !== "Autre")} allowOther showEmpty={false} />
      </div>
      <div className="mb-6 flex items-start gap-2 rounded-lg p-3 text-sm" style={{ background: tone.surface, border: `1px solid ${tone.line}`, color: tone.inkSoft }}>
        <Info size={15} className="mt-0.5 shrink-0" />
        {countryInfo.currency ? (
          <span>Devise suggérée : <strong>{countryInfo.currency}</strong>. Indice de référence usuel : <strong>{countryInfo.indexHint}</strong>, publié par {countryInfo.authority}. À vérifier avec ton contrat.</span>
        ) : (
          <span>Pas de repère spécifique enregistré pour ce pays : renseigne toi-même le nom et les valeurs de l'indice applicable (contrat, ou {countryInfo.authority}). La formule de calcul reste la même.</span>
        )}
      </div>
      <label className="mb-2 block text-xs font-semibold uppercase tracking-widest" style={{ color: tone.inkSoft }}>Secteur</label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {REVISION_SECTORS.map((sector) => (
          <button key={sector} onClick={() => onPick(sector, revisionCountry)} className="df-at-tap flex items-center justify-between gap-2 rounded-xl px-4 py-3 text-left text-[15px] font-medium" style={{ background: tone.surface, border: `1px solid ${tone.line}` }}>
            {sector} <ChevronRight size={16} style={{ color: tone.inkSoft }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ChantiersView({ documents, siteSettings, darkMode, onOpenDoc }) {
  const [openChantier, setOpenChantier] = useState(null);
  const chantiers = useMemo(() => {
    const map = new Map();
    for (const d of documents) {
      const nom = (d.chantier || "").trim();
      if (!nom) continue;
      if (!map.has(nom)) map.set(nom, { nom, devisTotal: 0, factureTotal: 0, docs: [] });
      const entry = map.get(nom);
      entry.docs.push(d);
      if (d.type === "devis") entry.devisTotal += computeTotals(d).totalTTC;
      if (d.type === "facture") entry.factureTotal += computeTotals(d).totalTTC;
    }
    return [...map.values()].sort((a, b) => b.docs.length - a.docs.length);
  }, [documents]);

  const isAdvanced = siteSettings?.landingPageVersion === "avancee";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        {isAdvanced && (
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: adv.accentSoft, color: adv.accent }}><MapPinned size={18} /></div>
        )}
        <h1 className="df-display text-2xl font-semibold">Chantiers</h1>
        <p className="text-sm" style={{ color: colors.inkSoft }}>Compare le budget prévu (devis) au montant facturé, pour chaque projet — renseigne le champ "Chantier" sur tes documents pour les regrouper ici.</p>
      </div>

      {chantiers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center" style={{ background: colors.surface, border: `1px dashed ${colors.line}` }}>
          <MapPinned size={28} style={{ color: colors.inkSoft }} />
          <p className="df-display mt-3 text-lg font-semibold">Aucun chantier suivi pour l'instant</p>
          <p className="mt-1 max-w-sm text-sm" style={{ color: colors.inkSoft }}>Ouvre un devis ou une facture, renseigne le champ "Chantier" (sous les informations client) avec le même nom sur plusieurs documents pour les voir apparaître groupés ici.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {chantiers.map((c) => {
            const ecart = c.devisTotal - c.factureTotal;
            const isOpen = openChantier === c.nom;
            return (
              <div key={c.nom} className="overflow-hidden rounded-2xl" style={{ background: isAdvanced ? (darkMode ? "#262D3A" : adv.surface) : colors.surface, border: `1px solid ${colors.line}` }}>
                <button onClick={() => setOpenChantier(isOpen ? null : c.nom)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{c.nom}</div>
                    <div className="text-xs" style={{ color: colors.inkSoft }}>{c.docs.length} document(s)</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <div className="text-right">
                      <div className="text-xs" style={{ color: colors.inkSoft }}>Prévu</div>
                      <div className="df-mono text-sm font-medium">{eur(c.devisTotal)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs" style={{ color: colors.inkSoft }}>Facturé</div>
                      <div className="df-mono text-sm font-medium">{eur(c.factureTotal)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs" style={{ color: colors.inkSoft }}>Écart</div>
                      <div className="df-mono text-sm font-semibold" style={{ color: ecart >= 0 ? colors.moss : colors.brick }}>{ecart >= 0 ? "+" : ""}{eur(ecart)}</div>
                    </div>
                    <ChevronDown size={16} style={{ color: colors.inkSoft, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t px-4 pb-4 pt-2" style={{ borderColor: colors.line }}>
                    {c.docs.map((d) => (
                      <button key={d.id} onClick={() => onOpenDoc(d.id)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-black/5">
                        <span className="flex items-center gap-2">
                          <span className="df-mono font-medium">{d.docNumber}</span>
                          <span style={{ color: colors.inkSoft }}>{docTypeLabel(d.type)}</span>
                        </span>
                        <span className="df-mono" style={{ color: colors.inkSoft }}>{eur(computeTotals(d).totalTTC)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ClientsView({ clients, documents, saving, onSave, onDelete, isLocked, isViewer, onGoToPricing, siteSettings, darkMode }) {
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [nameError, setNameError] = useState(false);

  const filtered = clients.filter((c) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (c.name || "").toLowerCase().includes(s) || (c.email || "").toLowerCase().includes(s);
  });

  function countDocs(clientId) {
    return documents.filter((d) => d.clientId === clientId).length;
  }
  function startNew() { if (!isLocked) { setEditing(emptyClient()); setNameError(false); } }
  function startEdit(c) { if (!isLocked) { setEditing({ ...c }); setNameError(false); } }
  function save() {
    if (isLocked) return;
    if (!editing.name.trim()) { setNameError(true); return; }
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
            <div>
              <input className="df-input w-full rounded-md px-2 py-1.5 text-sm" style={{ border: `1px solid ${nameError ? colors.brick : colors.line}` }} placeholder="Nom / raison sociale" value={editing.name} onChange={(e) => { setEditing({ ...editing, name: e.target.value }); if (nameError) setNameError(false); }} />
              {nameError && <p className="mt-1 text-xs" style={{ color: colors.brick }}>Le nom est obligatoire.</p>}
            </div>
            <input className="df-input rounded-md px-2 py-1.5 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Adresse" value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
            <input className="df-input rounded-md px-2 py-1.5 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
            <input className="df-input rounded-md px-2 py-1.5 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Téléphone" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
            <input className="df-input rounded-md px-2 py-1.5 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Code postal (facturation électronique)" value={editing.postalCode || ""} onChange={(e) => setEditing({ ...editing, postalCode: e.target.value })} />
            <input className="df-input rounded-md px-2 py-1.5 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="Ville (facturation électronique)" value={editing.city || ""} onChange={(e) => setEditing({ ...editing, city: e.target.value })} />
            <input className="df-input rounded-md px-2 py-1.5 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="SIRET (14 chiffres, si professionnel)" value={editing.siret || ""} onChange={(e) => setEditing({ ...editing, siret: e.target.value })} />
            <input className="df-input rounded-md px-2 py-1.5 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="N° TVA intracommunautaire (si professionnel)" value={editing.tva || ""} onChange={(e) => setEditing({ ...editing, tva: e.target.value })} />
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
      ) : siteSettings?.landingPageVersion === "avancee" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <div key={c.id} className="flex flex-col gap-2 rounded-2xl p-4 transition-shadow hover:shadow-md" style={{ background: siteSettings?.landingPageVersion === "avancee" ? (darkMode ? "#262D3A" : adv.surface) : colors.surface, border: `1px solid ${colors.line}` }}>
              <div className="flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-full df-display text-sm font-bold" style={{ background: colors.paper, color: colors.ink }}>{initials(c.name) || "?"}</div>
                <div className="flex gap-2">
                  <button onClick={() => startEdit(c)} disabled={isLocked} style={{ color: isLocked ? colors.line : colors.slate, cursor: isLocked ? "not-allowed" : "pointer" }}><Pencil size={15} /></button>
                  <button onClick={() => onDelete(c.id)} disabled={isLocked} title="Supprimer le client" style={{ color: isLocked ? colors.line : colors.brick, cursor: isLocked ? "not-allowed" : "pointer" }}><Trash2 size={15} /></button>
                </div>
              </div>
              <div className="truncate text-sm font-semibold">{c.name}</div>
              <div className="truncate text-xs" style={{ color: colors.inkSoft }}>{c.email || "—"}</div>
              <div className="text-xs" style={{ color: colors.inkSoft }}>{c.phone || "—"}</div>
              <div className="df-mono mt-1 text-xs" style={{ color: colors.brassDark }}>{countDocs(c.id)} document(s)</div>
            </div>
          ))}
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
                <button onClick={() => onDelete(c.id)} disabled={isLocked} title="Supprimer le client" style={{ color: isLocked ? colors.line : colors.brick, cursor: isLocked ? "not-allowed" : "pointer" }}><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PrestationsView({ prestations, saving, onSave, onDelete, siteSettings, darkMode }) {
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [designationError, setDesignationError] = useState(false);

  const filtered = prestations.filter((p) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (p.designation || "").toLowerCase().includes(s) || (p.category || "").toLowerCase().includes(s);
  });

  function startNew() { setEditing(emptyPrestation()); setDesignationError(false); }
  function startEdit(p) { setEditing({ ...p }); setDesignationError(false); }
  function save() {
    if (!editing.designation.trim()) { setDesignationError(true); return; }
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
        <button onClick={startNew} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.ink }}>
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
      ) : siteSettings?.landingPageVersion === "avancee" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <div key={p.id} className="flex flex-col gap-2 rounded-2xl p-4 transition-shadow hover:shadow-md" style={{ background: siteSettings?.landingPageVersion === "avancee" ? (darkMode ? "#262D3A" : adv.surface) : colors.surface, border: `1px solid ${colors.line}` }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 truncate text-sm font-semibold">{p.designation}</div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => startEdit(p)} style={{ color: colors.slate }}><Pencil size={15} /></button>
                  <button onClick={() => { if (window.confirm(`Supprimer "${p.designation}" de la bibliothèque ?`)) onDelete(p.id); }} title="Supprimer" style={{ color: colors.brick }}><Trash2 size={15} /></button>
                </div>
              </div>
              {p.category && <span className="w-fit rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: colors.paper, color: colors.inkSoft }}>{p.category}</span>}
              <div className="flex items-baseline justify-between">
                <span className="df-display text-lg font-bold">{eur(Number(p.unitPrice) || 0)}</span>
                <span className="text-xs" style={{ color: colors.inkSoft }}>{p.unit} · TVA {p.tva}%</span>
              </div>
            </div>
          ))}
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
                <button onClick={() => { if (window.confirm(`Supprimer "${p.designation}" de la bibliothèque ?`)) onDelete(p.id); }} title="Supprimer" style={{ color: colors.brick }}><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const ROLE_LABELS = { owner: "Propriétaire", editor: "Éditeur", viewer: "Lecteur", comptable: "Expert-comptable" };
const ROLE_COLORS = { owner: colors.brassDark, editor: colors.moss, viewer: colors.slate, comptable: colors.brick };

function AccountView({ account, siteSettings }) {
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
        {siteSettings?.landingPageVersion === "avancee" && (
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: adv.accentSoft, color: adv.accent }}><UserCircle size={18} /></div>
        )}
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
        <button onClick={savePassword} disabled={savingPassword} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.ink, color: "white", opacity: savingPassword ? 0.7 : 1 }}>
          {savingPassword ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Mettre à jour le mot de passe
        </button>
      </div>
    </div>
  );
}

function ApiView({ account, siteSettings }) {
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

  const [revokingId, setRevokingId] = useState(null);
  async function revokeKey(keyId, keyName) {
    if (!window.confirm(`Révoquer la clé "${keyName}" ? Toute intégration qui l'utilise cessera immédiatement de fonctionner — action irréversible.`)) return;
    setRevokingId(keyId);
    try {
      const { data: { session } } = await db.auth.getSession();
      const { data, error: fnError } = await db.functions.invoke("manage-api-key", {
        body: { action: "revoke", organizationId: account.organizationId, keyId },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (fnError || data?.error) {
        alert(`Impossible de révoquer cette clé : ${data?.error || fnError?.message || "erreur inconnue"}`);
        return;
      }
      await loadKeys();
    } catch (err) {
      console.error("Erreur de révocation de clé API", err);
      alert("Impossible de révoquer cette clé. Réessaie, et préviens-nous si ça persiste.");
    } finally {
      setRevokingId(null);
    }
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
        {siteSettings?.landingPageVersion === "avancee" && (
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: adv.accentSoft, color: adv.accent }}><KeyRound size={18} /></div>
        )}
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
            <button onClick={copyKey} className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.ink, color: "white" }}>
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
                <button onClick={() => revokeKey(k.id, k.name)} disabled={revokingId === k.id} className="flex items-center gap-1 text-xs font-medium" style={{ color: colors.brick, opacity: revokingId === k.id ? 0.6 : 1 }}>
                  {revokingId === k.id && <Loader2 size={11} className="animate-spin" />} Révoquer
                </button>
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

function TeamView({ account, siteSettings }) {
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
        {siteSettings?.landingPageVersion === "avancee" && (
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: adv.accentSoft, color: adv.accent }}><Users size={18} /></div>
        )}
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
                <option value="comptable">Expert-comptable (lecture seule)</option>
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
                  <option value="comptable">Expert-comptable</option>
                </select>
              ) : (
                <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${ROLE_COLORS[m.role]}18`, color: ROLE_COLORS[m.role] }}>{ROLE_LABELS[m.role]}</span>
              )}
              {isOwner && m.user_id !== account?.id && (
                <button onClick={() => { if (window.confirm(`Retirer "${m.profiles?.email || "ce membre"}" de l'équipe ?`)) removeMember(m.id); }} title="Retirer de l'équipe" style={{ color: colors.brick }}><Trash2 size={15} /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyView({ profile, saving, onSave, onReset, documentCount, clientCount, account, isLocked, isViewer, onGoToPricing }) {
  const [local, setLocal] = useState(() => withGeoCountry(profile));
  const [editing, setEditing] = useState(!profile.name);
  const [confirmReset, setConfirmReset] = useState(false);
  const [nameError, setNameError] = useState(false);

  useEffect(() => setLocal(withGeoCountry(profile)), []);

  function patch(p) {
    setLocal((prev) => ({ ...prev, ...p }));
  }
  function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFile(file).then((dataUrl) => patch({ logo: dataUrl })).catch((err) => alert(err.message));
    e.target.value = "";
  }
  function handleSave() {
    if (!local.name.trim()) { setNameError(true); return; }
    onSave(local);
    setEditing(false);
  }
  function startEdit() {
    if (isLocked) return;
    setLocal(withGeoCountry(profile));
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
            {profile.googleReviewUrl && <div className="flex gap-2"><dt className="w-24 shrink-0" style={{ color: colors.inkSoft }}>Avis Google</dt><dd className="break-all">{profile.googleReviewUrl}</dd></div>}
            {(profile.postalCode || profile.city) && <div className="flex gap-2"><dt className="w-24 shrink-0" style={{ color: colors.inkSoft }}>CP / Ville</dt><dd>{[profile.postalCode, profile.city].filter(Boolean).join(" ")}</dd></div>}
            {profile.iban && <div className="flex gap-2"><dt className="w-24 shrink-0" style={{ color: colors.inkSoft }}>IBAN</dt><dd className="df-mono">{profile.iban}{profile.bic ? ` — BIC ${profile.bic}` : ""}</dd></div>}
            {profile.vatOnDebits && <div className="flex gap-2"><dt className="w-24 shrink-0" style={{ color: colors.inkSoft }}>TVA</dt><dd>Option pour le paiement d'après les débits</dd></div>}
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
            <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${nameError ? colors.brick : colors.line}` }} value={local.name} onChange={(e) => { patch({ name: e.target.value }); if (nameError) setNameError(false); }} />
            {nameError && <p className="mt-1 text-xs" style={{ color: colors.brick }}>{local.type === "particulier" ? "Le nom est obligatoire." : "La raison sociale est obligatoire."}</p>}
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Code postal</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={local.postalCode || ""} onChange={(e) => patch({ postalCode: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Ville</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={local.city || ""} onChange={(e) => patch({ city: e.target.value })} />
            </div>
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
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Lien d'avis Google (optionnel)</label>
            <input type="url" className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="https://g.page/r/.../review" value={local.googleReviewUrl || ""} onChange={(e) => patch({ googleReviewUrl: e.target.value })} />
            <p className="mt-1 text-xs" style={{ color: colors.inkSoft }}>Lien « Laisser un avis » de ta fiche Google Business. Quand une facture passe à « payée », il te sera proposé d'envoyer ce lien au client par email — jamais automatiquement.</p>
          </div>
          {local.type !== "particulier" && (
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>N° TVA intracommunautaire (optionnel)</label>
              <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={local.tva} onChange={(e) => patch({ tva: e.target.value })} />
            </div>
          )}
          <div className="rounded-lg p-3" style={{ background: colors.paper }}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Facturation électronique (Factur-X)</div>
            <p className="mb-2 text-xs" style={{ color: colors.inkSoft }}>Coordonnées de paiement et option de TVA reprises dans les factures électroniques — sans effet sur le PDF classique.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>IBAN</label>
                <input className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="FR76 ..." value={local.iban || ""} onChange={(e) => patch({ iban: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>BIC</label>
                <input className="df-input df-mono w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} value={local.bic || ""} onChange={(e) => patch({ bic: e.target.value })} />
              </div>
            </div>
            <label className="mt-3 flex items-start gap-2 text-xs" style={{ color: colors.inkSoft }}>
              <input type="checkbox" className="mt-0.5" checked={!!local.vatOnDebits} onChange={(e) => patch({ vatOnDebits: e.target.checked })} />
              <span>J'ai opté pour le paiement de la TVA d'après les débits (mention obligatoire sur les factures dans ce cas — à cocher uniquement si tu as fait cette demande à l'administration fiscale)</span>
            </label>
          </div>
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

function PricingView({ account, plans, onChooseFree, onChooseZeroPrice, onCancelSubscription, cancellingSubscription, onRefreshAccount, onContact, limitNotice, documentCount, siteSettings }) {
  const [billing, setBilling] = useState(account?.billing || "mensuel");
  const [approvedMsg, setApprovedMsg] = useState(false);
  const [activatingPlanId, setActivatingPlanId] = useState(null);
  const [stripeReturnMsg, setStripeReturnMsg] = useState(null); // "succes" | "annule" | null
  // Garde une trace des rafraîchissements différés (après paiement) pour
  // pouvoir les annuler si la personne quitte cette page avant qu'ils
  // ne se déclenchent — évite un appel réseau inutile une fois parti.
  const refreshTimers = useRef([]);
  function scheduleRefresh(delays) {
    if (!onRefreshAccount) return;
    delays.forEach((delay) => refreshTimers.current.push(setTimeout(onRefreshAccount, delay)));
  }
  useEffect(() => {
    return () => refreshTimers.current.forEach(clearTimeout);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paiement = params.get("paiement");
    if (paiement === "succes" || paiement === "annule") {
      setStripeReturnMsg(paiement);
      params.delete("paiement");
      const newUrl = window.location.pathname + (params.toString() ? `?${params.toString()}` : "");
      window.history.replaceState({}, "", newUrl);
    }
    if (paiement === "succes") {
      // Le webhook Stripe peut mettre quelques secondes à confirmer le
      // paiement côté serveur — plusieurs tentatives espacées plutôt
      // qu'une seule, pour que "Forfait actuel" apparaisse tout seul
      // dès que possible, sans jamais avoir à recharger la page.
      scheduleRefresh([2000, 5000, 9000]);
    }
  }, []);
  const visiblePlans = plans.filter((p) => !p.hidden);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 text-center">
        {siteSettings?.landingPageVersion === "avancee" && (
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: adv.accentSoft, color: adv.accent }}><CreditCard size={18} /></div>
        )}
        <h1 className="df-display text-2xl font-semibold">Choisir un forfait</h1>
        <p className="mt-1 text-sm" style={{ color: colors.inkSoft }}>Tarifs indicatifs — à affiner selon l'étude de la concurrence.</p>
      </div>

      {limitNotice && (
        <div className="mx-auto mb-6 max-w-lg rounded-xl p-3 text-center text-sm" style={{ background: `${colors.brick}15`, color: colors.brick, border: `1px solid ${colors.brick}40` }}>
          Le forfait Gratuit est limité à {plans.find((p) => p.id === "gratuit")?.limit ?? 3} devis/factures ({documentCount} déjà créés). Passe à un forfait payant pour continuer.
        </div>
      )}
      {account?.plan !== "gratuit" && account?.paymentStatus === "payé" && account?.hasStripeOrPaypal && (
        <div className="mx-auto mb-6 max-w-lg rounded-xl p-4 text-center text-sm" style={{ background: account.subscriptionCancelled ? `${colors.brick}10` : colors.surface, border: `1px solid ${account.subscriptionCancelled ? colors.brick + "40" : colors.line}` }}>
          {account.subscriptionCancelled ? (
            <>
              <p style={{ color: colors.brick }}>Abonnement résilié — ton accès reste actif jusqu'au <strong>{account.expiresAt ? fr(account.expiresAt) : "—"}</strong>, puis ton compte repassera automatiquement en gratuit.</p>
            </>
          ) : (
            <>
              <p style={{ color: colors.inkSoft }}>Abonnement actif{account.expiresAt ? ` — prochain renouvellement le ${fr(account.expiresAt)}` : ""}.</p>
              <button
                onClick={onCancelSubscription}
                disabled={cancellingSubscription}
                className="mt-2 text-xs font-medium underline"
                style={{ color: colors.brick, opacity: cancellingSubscription ? 0.6 : 1 }}
              >
                {cancellingSubscription ? "Résiliation en cours…" : "Résilier mon abonnement"}
              </button>
            </>
          )}
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
                <button onClick={onChooseFree} className="rounded-lg py-2 text-sm font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.ink, color: "white" }}>Choisir ce forfait</button>
              ) : plan.id === "entreprise" ? (
                <a href={`mailto:${siteSettings?.contactEmail || "contact@chantiflow.fr"}?subject=Forfait%20Entreprise`} className="rounded-lg py-2 text-center text-sm font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.ink, color: "white" }}>Nous contacter</a>
              ) : price === 0 ? (
                <button
                  onClick={async () => { setActivatingPlanId(plan.id); await onChooseZeroPrice(plan.id, billing); setActivatingPlanId(null); }}
                  disabled={activatingPlanId === plan.id}
                  className="flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium"
                  style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.ink, color: "white", opacity: activatingPlanId === plan.id ? 0.7 : 1 }}
                >
                  {activatingPlanId === plan.id ? <Loader2 size={14} className="animate-spin" /> : null} {activatingPlanId === plan.id ? "Activation…" : "Activer (0€)"}
                </button>
              ) : showCard || showPaypal ? (
                <div className="flex flex-col gap-2">
                  {showCard && <StripeCheckoutButton planId={plan.id} billingCycle={billing} organizationId={account?.organizationId} />}
                  {showPaypal && <PayPalButton planId={paypalPlanId} organizationId={account?.organizationId} onApproved={() => { setApprovedMsg(true); scheduleRefresh([3000, 8000, 15000, 30000, 60000]); }} />}
                  <p className="text-center text-xs" style={{ color: colors.inkSoft }}>
                    Carte bancaire ou PayPal indisponible dans ton pays ?{" "}
                    <button onClick={onContact} className="underline" style={{ color: colors.slate }}>Contacte-nous</button>, on trouvera une solution.
                  </p>
                </div>
              ) : (
                <button onClick={onContact} className="w-full rounded-lg py-2 text-center text-xs underline" style={{ background: colors.paper, color: colors.inkSoft }}>Paiement bientôt disponible — contacte-nous en attendant</button>
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
    readImageFile(file).then((dataUrl) => patch({ logo: dataUrl })).catch((err) => alert(err.message));
    e.target.value = "";
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
          <p className="mt-1 text-xs" style={{ color: colors.inkSoft }}>Utilisé pour le bouton "Nous contacter" du forfait Entreprise, le pied de page, et la page "Nous contacter" (adresse d'envoi du formulaire).</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Lien Instagram</label>
          <input type="url" className="df-input w-full max-w-xs rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${colors.line}` }} placeholder="https://instagram.com/tonsite" value={local.contactInstagramUrl || ""} onChange={(e) => patch({ contactInstagramUrl: e.target.value })} />
          <p className="mt-1 text-xs" style={{ color: colors.inkSoft }}>Affiché sous forme d'icône sur la page "Nous contacter". Laisse vide pour ne pas l'afficher.</p>
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

// Bloc pliable réutilisable pour Admin — replié par défaut, pour ne
// pas surcharger la page. Un simple clic sur l'en-tête déplie/replie.
function CollapsibleSection({ title, subtitle, icon: Icon, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex items-center gap-2">
          {Icon && <Icon size={15} style={{ color: colors.brassDark }} />}
          <span className="df-display text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>{title}</span>
          {subtitle && <span className="text-xs" style={{ color: colors.inkSoft }}>— {subtitle}</span>}
        </span>
        <ChevronDown size={16} style={{ color: colors.inkSoft, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>
      {open && <div className="border-t" style={{ borderColor: colors.line }}>{children}</div>}
    </div>
  );
}

// Champs Windows/Mac avec brouillon local — rien n'est envoyé à la
// base tant que "Enregistrer" n'est pas cliqué, contrairement au
// reste d'Admin qui sauvegarde au fil de l'eau.
function DesktopAppSettings({ siteSettings, saving, onSave }) {
  const [draftWindows, setDraftWindows] = useState(siteSettings.desktopAppUrlWindows || "");
  const [draftMac, setDraftMac] = useState(siteSettings.desktopAppUrlMac || "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraftWindows(siteSettings.desktopAppUrlWindows || "");
    setDraftMac(siteSettings.desktopAppUrlMac || "");
    setDirty(false);
  }, [siteSettings.desktopAppUrlWindows, siteSettings.desktopAppUrlMac]);

  function handleSave() {
    onSave({ desktopAppUrlWindows: draftWindows, desktopAppUrlMac: draftMac });
    setDirty(false);
  }

  return (
    <div className="space-y-3 p-4">
      <p className="text-xs" style={{ color: colors.inkSoft }}>
        Une fois les fichiers d'installation uploadés (voir le guide), colle leurs adresses ici. Le bouton de téléchargement (icône écran, à côté d'Admin) n'affiche que les versions renseignées, et seulement si "Affiché" est activé ci-dessous.
      </p>
      <div>
        <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Adresse du fichier Windows (.exe)</label>
        <input
          type="url"
          className="df-input w-full max-w-lg rounded-md px-3 py-2 text-sm"
          style={{ border: `1px solid ${colors.line}` }}
          placeholder="https://github.com/.../Chantiflow.Setup.exe"
          value={draftWindows}
          onChange={(e) => { setDraftWindows(e.target.value); setDirty(true); }}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Adresse du fichier Mac (.dmg)</label>
        <input
          type="url"
          className="df-input w-full max-w-lg rounded-md px-3 py-2 text-sm"
          style={{ border: `1px solid ${colors.line}` }}
          placeholder="https://github.com/.../Chantiflow.dmg"
          value={draftMac}
          onChange={(e) => { setDraftMac(e.target.value); setDirty(true); }}
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => onSave({ desktopAppEnabled: !siteSettings.desktopAppEnabled })}
          style={{ color: siteSettings.desktopAppEnabled ? colors.moss : colors.line }}
        >
          {siteSettings.desktopAppEnabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
        </button>
        <span className="text-sm font-medium" style={{ color: siteSettings.desktopAppEnabled ? colors.moss : colors.inkSoft }}>
          {siteSettings.desktopAppEnabled ? "Affiché aux utilisateurs" : "Masqué"}
        </span>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="ml-auto flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white"
          style={{ background: dirty ? colors.brassDark : colors.line, opacity: saving ? 0.7 : 1 }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Enregistrer
        </button>
      </div>
    </div>
  );
}

function AdminView({ account, darkMode, documents, clients, companyProfile, plans, savingPlanSettings, onTogglePlan, onToggleWatermark, onUpdatePlanPrice, onUpdatePlanLimit, onUpdatePlanPaypalId, onUpdatePlanStripeId, onToggleCardPayment, onTogglePaypalPayment, onTogglePayment, onDeleteAccount, deletingAccount, siteSettings, savingSiteSettings, onUpdateSiteSettings, allUsers = [], allUsersError = "", onResendConfirmation, resendingConfirmationId, onRefreshUsers, onSetUserPlan, onSetUserPaidAt, onSetUserExpiresAt, savingUserPlanId }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Chaque carte utilisateur est repliée par défaut (juste l'essentiel
  // visible) — évite une page immense dès qu'il y a beaucoup de
  // comptes. Un identifiant présent dans cet ensemble = carte dépliée.
  const [expandedUserIds, setExpandedUserIds] = useState(() => new Set());
  function toggleUserExpanded(id) {
    setExpandedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const [tab, setTab] = useState(() => (typeof window !== "undefined" && localStorage.getItem("devifact_lastAdminTab")) || "apercu");
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("devifact_lastAdminTab", tab);
  }, [tab]);
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
    { id: "apparence", label: "Apparence du site", icon: Palette },
    { id: "utilisateurs", label: "Utilisateurs", icon: Users },
    { id: "forfaits", label: "Forfaits & tarifs", icon: CreditCard },
    { id: "paiement", label: "Paiement (PayPal)", icon: KeyRound },
    { id: "compte", label: "Mon compte", icon: Users },
    { id: "danger", label: "Zone dangereuse", icon: AlertTriangle },
  ];

  const isAdvanced = siteSettings?.landingPageVersion === "avancee";

  return (
    <div className={isAdvanced ? "mx-auto max-w-6xl px-4 py-8 sm:px-6" : "mx-auto max-w-4xl px-4 py-8 sm:px-6"}>
      <div className="mb-6">
        <h1 className="df-display flex items-center gap-2 text-2xl font-semibold"><Shield size={22} style={{ color: isAdvanced ? adv.accent : colors.brassDark }} /> Espace Admin</h1>
        <p className="text-sm" style={{ color: colors.inkSoft }}>Vue d'ensemble, gestion des forfaits et du compte.</p>
      </div>

      <div className={isAdvanced ? "flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8" : ""}>
        {isAdvanced ? (
          <>
            {/* Petit écran : barre horizontale déroulante (même principe qu'en classique) — la barre latérale verticale prendrait presque toute la largeur d'un téléphone. */}
            <div className="flex w-full items-center gap-1 overflow-x-auto rounded-xl p-1 lg:hidden" style={{ background: colors.surface, border: `1px solid ${colors.line}`, WebkitOverflowScrolling: "touch" }}>
              {TABS.map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setTab(id)} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium" style={{ background: tab === id ? (darkMode ? "#38363F" : adv.accentSoft) : "transparent", color: tab === id ? (darkMode ? "#C7C4FF" : adv.accent) : (darkMode ? "#9AA5B5" : adv.inkSoft) }}>
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
            {/* Grand écran : vraie barre latérale verticale */}
            <div className="sticky top-6 hidden w-56 shrink-0 flex-col gap-0.5 lg:flex">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setTab(id)} className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs font-medium" style={{ background: tab === id ? (darkMode ? "#38363F" : adv.accentSoft) : "transparent", color: tab === id ? (darkMode ? "#C7C4FF" : adv.accent) : (darkMode ? "#9AA5B5" : adv.inkSoft) }}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="mb-6 flex w-full items-center gap-1 overflow-x-auto rounded-xl p-1" style={{ background: colors.surface, border: `1px solid ${colors.line}`, WebkitOverflowScrolling: "touch" }}>
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium" style={{ background: tab === id ? colors.ink : "transparent", color: tab === id ? "white" : colors.inkSoft }}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
        )}
        <div className={isAdvanced ? "min-w-0 flex-1" : "w-full"}>

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
            {siteSettings?.landingPageVersion === "avancee" ? (
              <>
                <StatCardAvancee icon={UserCircle} label="Ton compte" value={account ? 1 : 0} sub={account?.email || "—"} color={colors.slate} />
                <StatCardAvancee icon={FileText} label="Documents créés" value={documents.length} sub={eur(totalTTC) + " au total"} color={colors.moss} />
                <StatCardAvancee icon={Users} label="Clients enregistrés" value={clients.length} sub={companyProfile.name || "Entreprise non renseignée"} color={colors.brassDark} />
              </>
            ) : (
              <>
                <StatCard label="Ton compte" value={account ? 1 : 0} sub={account?.email || "—"} color={colors.slate} />
                <StatCard label="Documents créés" value={documents.length} sub={eur(totalTTC) + " au total"} color={colors.moss} />
                <StatCard label="Clients enregistrés" value={clients.length} sub={companyProfile.name || "Entreprise non renseignée"} color={colors.brassDark} />
              </>
            )}
          </div>
        </>
      )}

      {tab === "identite" && (
        <SiteIdentitySettings siteSettings={siteSettings} saving={savingSiteSettings} onSave={onUpdateSiteSettings} />
      )}

      {tab === "services" && (
        <ServicesVisibilitySettings siteSettings={siteSettings} saving={savingSiteSettings} onSave={onUpdateSiteSettings} />
      )}

      {tab === "apparence" && (
        <div className="space-y-3">
          <CollapsibleSection title="Page d'accueil" subtitle={siteSettings.landingPageVersion === "atelier" ? "Version Atelier" : siteSettings.landingPageVersion === "avancee" ? "Version avancée" : "Version classique"} icon={LayoutDashboard} defaultOpen>
            <p className="border-b px-4 py-2 text-xs" style={{ borderColor: colors.line, color: colors.inkSoft }}>
              Choisis la page vue par les visiteurs qui ne sont pas encore connectés — les deux restent disponibles, tu peux revenir en arrière à tout moment sans rien perdre.
            </p>
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
              <button
                onClick={() => onUpdateSiteSettings({ landingPageVersion: "classique" })}
                className="rounded-xl p-4 text-left"
                style={{ border: `2px solid ${siteSettings.landingPageVersion !== "avancee" && siteSettings.landingPageVersion !== "atelier" ? colors.brass : colors.line}`, background: colors.surface }}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">Classique {siteSettings.landingPageVersion !== "avancee" && siteSettings.landingPageVersion !== "atelier" && <Check size={14} style={{ color: colors.brass }} />}</div>
                <p className="mt-1 text-xs" style={{ color: colors.inkSoft }}>La page d'origine du site, simple et directe.</p>
              </button>
              <button
                onClick={() => onUpdateSiteSettings({ landingPageVersion: "avancee" })}
                className="rounded-xl p-4 text-left"
                style={{ border: `2px solid ${siteSettings.landingPageVersion === "avancee" ? colors.brass : colors.line}`, background: colors.surface }}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">Avancée {siteSettings.landingPageVersion === "avancee" && <Check size={14} style={{ color: colors.brass }} />}</div>
                <p className="mt-1 text-xs" style={{ color: colors.inkSoft }}>Mise en page plus travaillée — aperçu produit, section fonctionnalités détaillée.</p>
              </button>
              <button
                onClick={() => onUpdateSiteSettings({ landingPageVersion: "atelier" })}
                className="rounded-xl p-4 text-left"
                style={{ border: `2px solid ${siteSettings.landingPageVersion === "atelier" ? colors.brass : colors.line}`, background: colors.surface }}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">Atelier {siteSettings.landingPageVersion === "atelier" && <Check size={14} style={{ color: colors.brass }} />}</div>
                <p className="mt-1 text-xs" style={{ color: colors.inkSoft }}>Interface repensée pour tous : 4 rubriques, bouton « Créer » toujours visible, palette fixe bleu de travail. Pages chantier regroupées.</p>
              </button>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Apparence du site" subtitle={THEMES[siteSettings.theme]?.label} icon={Palette}>
            <p className="border-b px-4 py-2 text-xs" style={{ borderColor: colors.line, color: colors.inkSoft }}>
              Choisis un thème de couleurs pour tout le site — le changement s'applique immédiatement pour tous les visiteurs.
            </p>
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(THEMES).map(([id, theme]) => (
                <button
                  key={id}
                  onClick={() => onUpdateSiteSettings({ theme: id })}
                  className="overflow-hidden rounded-xl text-left transition"
                  style={{ border: `2px solid ${siteSettings.theme === id ? theme.values.brass : colors.line}`, background: theme.values.surface }}
                >
                  <div className="flex h-16" style={{ background: theme.values.paper }}>
                    <div className="flex-1" style={{ background: theme.values.ink }} />
                    <div className="flex-1" style={{ background: theme.values.brass }} />
                    <div className="flex-1" style={{ background: theme.values.moss }} />
                    <div className="flex-1" style={{ background: theme.values.brick }} />
                  </div>
                  <div className="p-3">
                    <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: theme.values.ink }}>
                      {theme.label}
                      {siteSettings.theme === id && <Check size={14} style={{ color: theme.values.brass }} />}
                    </div>
                    <p className="mt-0.5 text-xs" style={{ color: theme.values.inkSoft }}>{theme.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Logiciel de bureau" subtitle={siteSettings.desktopAppEnabled ? "Affiché" : "Masqué"} icon={Monitor}>
            <DesktopAppSettings siteSettings={siteSettings} saving={savingSiteSettings} onSave={onUpdateSiteSettings} />
          </CollapsibleSection>
        </div>
      )}

      {tab === "utilisateurs" && siteSettings?.landingPageVersion === "avancee" && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="df-display text-lg font-semibold">Tous les utilisateurs du site</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs" style={{ color: colors.inkSoft }}>{allUsers.length} compte(s)</span>
              <button onClick={onRefreshUsers} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: colors.paper, color: colors.slate }} title="Recharger la liste">
                <RotateCcw size={12} /> Rafraîchir
              </button>
            </div>
          </div>
          {allUsersError && (
            <div className="mb-4 rounded-xl px-4 py-3 text-sm" style={{ background: `${colors.brick}0D`, color: colors.brick, border: `1px solid ${colors.brick}30` }}>
              Impossible de charger la liste ({allUsersError}). La migration migration_admin_voir_utilisateurs.sql a-t-elle bien été lancée dans Supabase ?
            </div>
          )}
          {allUsers.length === 0 ? (
            <p className="text-sm" style={{ color: colors.inkSoft }}>Aucun utilisateur pour l'instant.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {allUsers.map((u) => {
                const deadline = u.created_at ? new Date(new Date(u.created_at).getTime() + 8 * 7 * 24 * 60 * 60 * 1000) : null;
                const expired = u.expiresAt && new Date(u.expiresAt) < new Date();
                const isExpanded = expandedUserIds.has(u.id);
                return (
                  <div key={u.id} className="overflow-hidden rounded-2xl" style={{ background: siteSettings?.landingPageVersion === "avancee" ? (darkMode ? "#262D3A" : adv.surface) : colors.surface, border: `1px solid ${colors.line}` }}>
                    <button onClick={() => toggleUserExpanded(u.id)} className="flex w-full items-start justify-between gap-2 p-4 text-left">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{u.email}</div>
                        <div className="text-xs" style={{ color: colors.inkSoft }}>{[u.first_name, u.last_name].filter(Boolean).join(" ") || u.company_name || "—"}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {u.is_admin && <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${colors.brassDark}18`, color: colors.brassDark }}>Admin</span>}
                        {!u.confirmed_at && <AlertTriangle size={14} style={{ color: colors.brick }} />}
                        <ChevronDown size={16} style={{ color: colors.inkSoft, transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4">
                        <div className="mb-3 flex flex-wrap items-center gap-2 border-y py-3" style={{ borderColor: colors.line }}>
                          {u.organizationId ? (
                            <>
                              <select
                                value={u.plan}
                                onChange={(e) => onSetUserPlan(u.organizationId, e.target.value)}
                                disabled={savingUserPlanId === u.organizationId}
                                className="df-select rounded-md px-2 py-1 text-xs"
                                style={{ border: `1px solid ${colors.line}` }}
                              >
                                {PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                              {savingUserPlanId === u.organizationId && <Loader2 size={12} className="animate-spin" style={{ color: colors.inkSoft }} />}
                              {u.plan !== "gratuit" && (
                                <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: u.paymentStatus === "payé" ? `${colors.moss}18` : `${colors.brick}18`, color: u.paymentStatus === "payé" ? colors.moss : colors.brick }}>
                                  {u.paymentStatus === "payé" ? "Payé" : "Impayé"}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-xs" style={{ color: colors.inkSoft }}>Aucune organisation</span>
                          )}
                        </div>

                        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <label className="text-xs" style={{ color: colors.inkSoft }}>
                            Payé le
                            <input
                              type="date"
                              className="df-input df-mono mt-0.5 block w-full rounded-md px-2 py-1 text-xs"
                              style={{ border: `1px solid ${colors.line}` }}
                              value={u.paidAt ? u.paidAt.slice(0, 10) : ""}
                              disabled={!u.organizationId}
                              onChange={(e) => onSetUserPaidAt(u.organizationId, e.target.value)}
                            />
                          </label>
                          <label className="text-xs" style={{ color: colors.inkSoft }}>
                            Expire le
                            <input
                              type="date"
                              className="df-input df-mono mt-0.5 block w-full rounded-md px-2 py-1 text-xs"
                              style={{ border: `1px solid ${expired ? colors.brick : colors.line}`, color: expired ? colors.brick : colors.ink }}
                              value={u.expiresAt ? u.expiresAt.slice(0, 10) : ""}
                              disabled={!u.organizationId}
                              onChange={(e) => onSetUserExpiresAt(u.organizationId, e.target.value)}
                            />
                            {expired && <span className="text-xs font-medium" style={{ color: colors.brick }}>Expiré</span>}
                          </label>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          {u.confirmed_at ? (
                            <span className="flex items-center gap-1 text-xs font-medium" style={{ color: colors.moss }}><Check size={13} /> Confirmé</span>
                          ) : (
                            <div>
                              <span className="flex items-center gap-1 text-xs font-medium" style={{ color: colors.brick }}><AlertTriangle size={13} /> Non confirmé</span>
                              {deadline && <span className="block text-xs" style={{ color: colors.inkSoft }}>Suppression auto le {fr(deadline)}</span>}
                            </div>
                          )}
                          {!u.confirmed_at && (
                            <button
                              onClick={() => onResendConfirmation(u.id)}
                              disabled={resendingConfirmationId === u.id}
                              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-white"
                              style={{ background: colors.slate, opacity: resendingConfirmationId === u.id ? 0.7 : 1 }}
                            >
                              {resendingConfirmationId === u.id ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />} Relancer
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "utilisateurs" && siteSettings?.landingPageVersion !== "avancee" && (
        <div className="overflow-hidden rounded-2xl" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: colors.line }}>
            <span className="df-display text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>Tous les utilisateurs du site</span>
            <div className="flex items-center gap-3">
              <span className="text-xs" style={{ color: colors.inkSoft }}>{allUsers.length} compte(s)</span>
              <button onClick={onRefreshUsers} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={{ background: colors.paper, color: colors.slate }} title="Recharger la liste">
                <RotateCcw size={12} /> Rafraîchir
              </button>
            </div>
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
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Forfait</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Payé le</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Expire le</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}>Confirmation</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: colors.slate }}></th>
                </tr>
              </thead>
              <tbody>
                {allUsers.map((u, idx) => {
                  const deadline = u.created_at ? new Date(new Date(u.created_at).getTime() + 8 * 7 * 24 * 60 * 60 * 1000) : null;
                  const expired = u.expiresAt && new Date(u.expiresAt) < new Date();
                  return (
                    <tr key={u.id} style={{ borderTop: idx ? `1px solid ${colors.line}` : "none" }}>
                      <td className="px-4 py-2.5">
                        {u.email}
                        <div className="text-xs" style={{ color: colors.inkSoft }}>{u.company_name || ""}</div>
                      </td>
                      <td className="px-4 py-2.5">{[u.first_name, u.last_name].filter(Boolean).join(" ") || <span style={{ color: colors.inkSoft }}>—</span>}</td>
                      <td className="px-4 py-2.5">
                        {u.organizationId ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={u.plan}
                              onChange={(e) => onSetUserPlan(u.organizationId, e.target.value)}
                              disabled={savingUserPlanId === u.organizationId}
                              className="df-select rounded-md px-2 py-1 text-xs"
                              style={{ border: `1px solid ${colors.line}` }}
                            >
                              {PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            {savingUserPlanId === u.organizationId && <Loader2 size={12} className="animate-spin" style={{ color: colors.inkSoft }} />}
                            {u.plan !== "gratuit" && (
                              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: u.paymentStatus === "payé" ? `${colors.moss}18` : `${colors.brick}18`, color: u.paymentStatus === "payé" ? colors.moss : colors.brick }}>
                                {u.paymentStatus === "payé" ? "Payé" : "Impayé"}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: colors.inkSoft }}>Aucune organisation</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          type="date"
                          className="df-input df-mono rounded-md px-2 py-1 text-xs"
                          style={{ border: `1px solid ${colors.line}`, width: "9.5rem" }}
                          value={u.paidAt ? u.paidAt.slice(0, 10) : ""}
                          disabled={!u.organizationId}
                          onChange={(e) => onSetUserPaidAt(u.organizationId, e.target.value)}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          type="date"
                          className="df-input df-mono rounded-md px-2 py-1 text-xs"
                          style={{ border: `1px solid ${expired ? colors.brick : colors.line}`, width: "9.5rem", color: expired ? colors.brick : colors.ink }}
                          value={u.expiresAt ? u.expiresAt.slice(0, 10) : ""}
                          disabled={!u.organizationId}
                          onChange={(e) => onSetUserExpiresAt(u.organizationId, e.target.value)}
                        />
                        {expired && <div className="text-xs font-medium" style={{ color: colors.brick }}>Expiré</div>}
                      </td>
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
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-sm" style={{ color: colors.inkSoft }}>Aucun utilisateur pour l'instant.</td></tr>
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

      {tab === "forfaits" && (siteSettings?.landingPageVersion === "avancee" ? (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="df-display text-lg font-semibold">Forfaits & tarifs</h2>
              <p className="text-xs" style={{ color: colors.inkSoft }}>Prix affiché, visibilité publique, filigrane, et nombre de documents autorisés.</p>
            </div>
            {savingPlanSettings && <Loader2 size={13} className="animate-spin" style={{ color: colors.inkSoft }} />}
          </div>
          <div className="mb-4 flex items-start gap-2 rounded-xl p-3" style={{ background: `${colors.brick}0D`, border: `1px solid ${colors.brick}30` }}>
            <AlertTriangle size={13} style={{ color: colors.brick, marginTop: "2px", flexShrink: 0 }} />
            <p className="text-xs" style={{ color: colors.brick }}>
              Si tu réduis le nombre de documents d'un forfait en dessous de ce qu'un compte a déjà créé, ce compte se verrouille automatiquement (sans perdre ses documents) jusqu'à passer à un forfait payant.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {plans.map((plan) => (
              <div key={plan.id} className="rounded-2xl p-4" style={{ background: siteSettings?.landingPageVersion === "avancee" ? (darkMode ? "#262D3A" : adv.surface) : colors.surface, border: `1px solid ${colors.line}` }}>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">{plan.name}</div>
                    <div className="text-xs" style={{ color: colors.inkSoft }}>{plan.tagline}</div>
                  </div>
                  <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: plan.hidden ? `${colors.brick}18` : `${colors.moss}18`, color: plan.hidden ? colors.brick : colors.moss }}>{plan.hidden ? "Masqué" : "Visible"}</span>
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-3 border-y py-3" style={{ borderColor: colors.line }}>
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
                </div>
                <div className="flex items-center justify-between">
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
                  <button
                    onClick={() => onTogglePlan(plan.id)}
                    title={plan.hidden ? "Rendre visible" : "Masquer ce forfait"}
                    className="flex items-center gap-1.5"
                    style={{ color: plan.hidden ? colors.inkSoft : colors.moss }}
                  >
                    {plan.hidden ? <ToggleLeft size={22} /> : <ToggleRight size={22} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
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
      ))}


      {tab === "paiement" && (
        <div className="space-y-4">
          <CollapsibleSection title="Paiement — identifiants PayPal" icon={CreditCard}>
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
          </CollapsibleSection>

          <CollapsibleSection title="Paiement — carte bancaire (Stripe)" icon={CreditCard}>
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
          </CollapsibleSection>
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
            <button onClick={onDeleteAccount} disabled={deletingAccount} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white" style={{ background: colors.brick, opacity: deletingAccount ? 0.7 : 1 }}>
              {deletingAccount && <Loader2 size={12} className="animate-spin" />} Oui, réinitialiser
            </button>
            <button onClick={() => setConfirmDelete(false)} className="rounded-lg px-3 py-1.5 text-xs font-medium" style={{ border: `1px solid ${colors.line}`, color: colors.inkSoft }}>Annuler</button>
          </div>
        )}
      </div>
      )}
        </div>
      </div>
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

// Chiffre d'affaires facturé, mois par mois, sur les 12 derniers mois,
// comparé à la même période un an plus tôt — calculé uniquement à
// partir des factures existantes (hors brouillons), montants HT, à la
// date d'émission. Dessiné en SVG, sans bibliothèque.
function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function RevenueChart({ documents, isAdvanced, darkMode }) {
  const data = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const prev = new Date(d.getFullYear() - 1, d.getMonth(), 1);
      months.push({ key: monthKey(d), prevKey: monthKey(prev), label: d.toLocaleDateString("fr-FR", { month: "short" }), year: d.getFullYear(), current: 0, previous: 0 });
    }
    const byKey = new Map(months.map((m) => [m.key, m]));
    const byPrevKey = new Map(months.map((m) => [m.prevKey, m]));
    let hasPrevious = false;
    for (const doc of documents) {
      if (doc.type !== "facture" || doc.status === "brouillon" || !doc.issueDate) continue;
      const issued = new Date(doc.issueDate);
      if (isNaN(issued.getTime())) continue;
      const key = monthKey(issued);
      const amount = computeTotals(doc).subtotalHT || 0;
      if (byKey.has(key)) byKey.get(key).current += amount;
      if (byPrevKey.has(key)) { byPrevKey.get(key).previous += amount; hasPrevious = true; }
    }
    const totalCurrent = months.reduce((s, m) => s + m.current, 0);
    const totalPrevious = months.reduce((s, m) => s + m.previous, 0);
    const max = Math.max(...months.map((m) => Math.max(m.current, hasPrevious ? m.previous : 0)), 0);
    const delta = hasPrevious && totalPrevious > 0 ? Math.round(((totalCurrent - totalPrevious) / totalPrevious) * 100) : null;
    return { months, hasPrevious, totalCurrent, totalPrevious, max, delta };
  }, [documents]);

  const surface = isAdvanced ? (darkMode ? "#262D3A" : adv.surface) : colors.surface;
  const ink = isAdvanced && darkMode ? "#E8EAED" : colors.ink;
  const soft = isAdvanced && darkMode ? "#9AA5B5" : colors.inkSoft;
  const barColor = isAdvanced ? adv.accent : colors.brass;
  const prevColor = isAdvanced && darkMode ? "#4A5568" : colors.line;
  const hasAny = data.totalCurrent > 0 || data.totalPrevious > 0;

  // Géométrie du graphique (en unités SVG, redimensionné en largeur)
  const W = 720, H = 200, padL = 8, padR = 8, padTop = 16, padBottom = 28;
  const innerW = W - padL - padR, innerH = H - padTop - padBottom;
  const slot = innerW / 12;
  const groupW = slot * 0.66;
  const barW = data.hasPrevious ? groupW / 2 : groupW;
  const scaleY = (v) => (data.max > 0 ? (v / data.max) * innerH : 0);

  return (
    <div className="mb-6 rounded-2xl p-5" style={{ background: surface, border: `1px solid ${isAdvanced && darkMode ? "#3A4353" : colors.line}` }}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide" style={{ color: soft }}>Chiffre d'affaires facturé — 12 derniers mois (HT)</div>
          <div className="df-display mt-1 text-2xl font-semibold" style={{ color: ink }}>{eur(data.totalCurrent)}</div>
        </div>
        {data.hasPrevious && (
          <div className="text-right">
            <div className="text-xs" style={{ color: soft }}>Même période un an plus tôt : <span className="df-mono">{eur(data.totalPrevious)}</span></div>
            {data.delta !== null && (
              <div className="df-mono text-sm font-semibold" style={{ color: data.delta >= 0 ? colors.moss : colors.brick }}>{data.delta >= 0 ? "+" : ""}{data.delta} %</div>
            )}
          </div>
        )}
      </div>
      {!hasAny ? (
        <p className="py-6 text-center text-xs" style={{ color: soft }}>Aucune facture émise sur les 12 derniers mois — le graphique apparaîtra dès la première facture envoyée.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Chiffre d'affaires facturé par mois">
            <line x1={padL} x2={W - padR} y1={padTop + innerH} y2={padTop + innerH} stroke={prevColor} strokeWidth="1" />
            {data.months.map((m, i) => {
              const x0 = padL + i * slot + (slot - groupW) / 2;
              const hCur = scaleY(m.current), hPrev = scaleY(m.previous);
              return (
                <g key={m.key}>
                  {data.hasPrevious && (
                    <rect x={x0} y={padTop + innerH - hPrev} width={barW - 1} height={hPrev} fill={prevColor} rx="2">
                      <title>{m.label} {m.year - 1} : {eur(m.previous)}</title>
                    </rect>
                  )}
                  <rect x={data.hasPrevious ? x0 + barW : x0} y={padTop + innerH - hCur} width={barW - 1} height={hCur} fill={barColor} rx="2">
                    <title>{m.label} {m.year} : {eur(m.current)}</title>
                  </rect>
                  <text x={padL + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize="11" fill={soft} style={{ fontFamily: "'Inter', sans-serif" }}>{m.label.replace(".", "")}</text>
                </g>
              );
            })}
          </svg>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs" style={{ color: soft }}>
            <span className="flex items-center gap-1.5"><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: barColor }} /> 12 derniers mois</span>
            {data.hasPrevious && <span className="flex items-center gap-1.5"><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: prevColor }} /> Un an plus tôt</span>}
          </div>
        </>
      )}
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

function StatCardAvancee({ label, value, sub, color, icon: Icon }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.line}` }}>
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${color}18`, color }}>
        <Icon size={18} />
      </div>
      <div className="df-display text-2xl font-bold">{value}</div>
      <div className="mt-0.5 text-sm font-medium" style={{ color: colors.inkSoft }}>{label}</div>
      <div className="df-mono mt-2 text-xs" style={{ color }}>{sub}</div>
    </div>
  );
}

// Bandeau "facture payée → proposer une demande d'avis Google". Rien
// n'est envoyé sans clic sur le bouton ; "Plus tard" ferme simplement.
function ReviewRequestNotice({ notice, onSend, onDismiss }) {
  if (!notice) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: notice.sent ? `${colors.moss}0D` : `${colors.brass}12`, border: `1px solid ${notice.sent ? colors.moss : colors.brass}40` }}>
      <div className="flex items-start gap-2">
        {notice.sent ? <Check size={16} style={{ color: colors.moss, flexShrink: 0, marginTop: "2px" }} /> : <Mail size={16} style={{ color: colors.brassDark, flexShrink: 0, marginTop: "2px" }} />}
        <div>
          {notice.sent ? (
            <p className="text-sm font-medium" style={{ color: colors.moss }}>Demande d'avis envoyée à {notice.clientEmail}.</p>
          ) : (
            <>
              <p className="text-sm font-medium" style={{ color: colors.brassDark }}>Facture {notice.docNumber} payée — demander un avis Google à {notice.clientName || "ce client"} ?</p>
              <p className="text-xs" style={{ color: colors.inkSoft }}>Un email avec ton lien d'avis Google sera envoyé à {notice.clientEmail}.</p>
              {notice.error && <p className="mt-1 text-xs" style={{ color: colors.brick }}>{notice.error}</p>}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {!notice.sent && (
          <button onClick={onSend} disabled={notice.sending} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: colors.brassDark, opacity: notice.sending ? 0.7 : 1 }}>
            {notice.sending ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} {notice.sending ? "Envoi…" : "Envoyer la demande d'avis"}
          </button>
        )}
        <button onClick={onDismiss} className="text-xs font-medium" style={{ color: colors.inkSoft }}>{notice.sent ? "Fermer" : "Plus tard"}</button>
      </div>
    </div>
  );
}

function Editor({ doc, saving, clients, prestations, account, plans, siteSettings, companyProfile, isLocked, isViewer, onChange, onFinalize, onBack, onConvert, onSaveClient, onSavePrestation, onSplit, splitNotice, onOpenSplitDoc, onDismissSplitNotice, onGoToPricing, reviewNotice = null, onSendReview, onDismissReview }) {
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
  // Dictée vocale — utilise la reconnaissance vocale déjà intégrée au
  // navigateur (gratuite, aucun service payant), pour décrire le
  // chantier à voix haute plutôt que de taper. Pas disponible sur tous
  // les navigateurs (Firefox notamment) — le bouton reste simplement
  // caché dans ce cas, sans rien casser.
  const [isListening, setIsListening] = useState(false);
  const speechRecognitionRef = useRef(null);
  const SpeechRecognitionAPI = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  function toggleVoiceInput() {
    if (!SpeechRecognitionAPI) return;
    if (isListening) {
      speechRecognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "fr-FR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setAiDescription((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript));
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    speechRecognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const saveTimer = useRef(null);
  // Cumul des modifications en attente d'enregistrement (voir patch).
  const pendingPatchRef = useRef(null);
  // Avertit avant de fermer/quitter si une sauvegarde est encore en
  // attente (le délai de 400ms n'a pas eu le temps de partir) — sans
  // ça, fermer l'onglet juste après avoir tapé pouvait perdre la
  // toute dernière modification silencieusement.
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (saveTimer.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

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
    setLocalDoc((prev) => ({ ...prev, ...p }));
    // Toutes les modifications faites pendant le délai de 400ms sont
    // cumulées puis envoyées ensemble — avant, seule la DERNIÈRE était
    // enregistrée, et celles faites juste avant dans un autre champ
    // (ex : changer un statut puis taper une note) étaient perdues
    // silencieusement à l'enregistrement.
    pendingPatchRef.current = { ...(pendingPatchRef.current || {}), ...p };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const merged = pendingPatchRef.current;
      pendingPatchRef.current = null;
      saveTimer.current = null; // plus rien en attente : ne bloque plus la fermeture de l'onglet
      if (merged) onChange(merged);
    }, 400);
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
    patch({ client: { name: c.name, address: c.address, email: c.email, phone: c.phone, siret: c.siret || "", tva: c.tva || "", postalCode: c.postalCode || "", city: c.city || "" }, clientId: c.id });
    setClientQuery("");
    setClientPickerOpen(false);
  }
  function saveCurrentClient() {
    if (!localDoc.client.name.trim()) { alert("Renseigne d'abord le nom du client avant de l'enregistrer."); return; }
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
    if (!it.designation.trim()) { alert("Renseigne d'abord une désignation pour cette ligne avant de l'enregistrer."); return; }
    onSavePrestation({ id: nextId("pr"), designation: it.designation, category: "", unit: it.unit, unitPrice: it.unitPrice, tva: it.tva });
  }
  const [publicLinkState, setPublicLinkState] = useState({ loading: false, url: null, error: null });

  // QR code imprimé sur le PDF classique : il pointe vers le lien
  // public du document (devis → signature, facture → paiement). Le lien
  // le plus récent est réutilisé s'il existe ; sinon il est créé au
  // moment du téléchargement du PDF, jamais avant.
  const hasPublicLinkType = doc.type === "devis" || doc.type === "facture";
  const [publicQr, setPublicQr] = useState(null); // { url, dataUrl }
  const publicQrLoadRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    setPublicQr(null);
    publicQrLoadRef.current = null;
    if (!hasPublicLinkType || !account?.organizationId) return;
    const load = (async () => {
      try {
        const { data, error } = await db.from("public_document_links").select("token").eq("document_id", doc.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (error || !data?.token || cancelled) return null;
        const url = publicDocumentUrl(data.token);
        const dataUrl = await QRCode.toDataURL(url, PUBLIC_QR_OPTIONS);
        const qr = { url, dataUrl };
        if (!cancelled) setPublicQr(qr);
        return qr;
      } catch (err) {
        console.warn("Lien public existant non chargé (pas de QR code)", err);
        return null;
      }
    })();
    publicQrLoadRef.current = load;
    return () => { cancelled = true; };
  }, [doc.id, hasPublicLinkType, account?.organizationId]);

  // Garantit un QR code avant la capture du PDF : réutilise le lien
  // chargé, sinon en crée un (même logique que le bouton « Lien de
  // signature/paiement »). En cas d'échec, le PDF est produit sans QR.
  async function ensurePublicQr() {
    if (!hasPublicLinkType || !account?.organizationId) return null;
    if (publicQr) return publicQr;
    if (publicQrLoadRef.current) {
      const loaded = await publicQrLoadRef.current;
      if (loaded) return loaded;
    }
    try {
      const { data, error } = await db.from("public_document_links").insert({ organization_id: account.organizationId, document_id: localDoc.id }).select("token").single();
      if (error) throw error;
      const url = publicDocumentUrl(data.token);
      const dataUrl = await QRCode.toDataURL(url, PUBLIC_QR_OPTIONS);
      const qr = { url, dataUrl };
      // Rendu synchrone : le QR doit être dans le DOM avant la capture.
      flushSync(() => setPublicQr(qr));
      return qr;
    } catch (err) {
      console.warn("QR code non ajouté au PDF (lien public indisponible)", err);
      return null;
    }
  }

  async function generatePublicLink() {
    setPublicLinkState({ loading: true, url: null, error: null });
    try {
      const { data, error } = await db.from("public_document_links").insert({ organization_id: account.organizationId, document_id: localDoc.id }).select("token").single();
      if (error) throw error;
      const url = publicDocumentUrl(data.token);
      await navigator.clipboard.writeText(url).catch(() => {});
      setPublicLinkState({ loading: false, url, error: null });
      // Le QR code du PDF suit toujours le lien le plus récent.
      QRCode.toDataURL(url, PUBLIC_QR_OPTIONS).then((dataUrl) => setPublicQr({ url, dataUrl })).catch(() => {});
    } catch (err) {
      console.error("Erreur de génération du lien public", err);
      setPublicLinkState({ loading: false, url: null, error: "Impossible de générer le lien pour l'instant." });
    }
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
      // Si la fonction a renvoyé un message précis (ex : surcharge
      // temporaire de Gemini), on l'affiche tel quel — plus juste que
      // le message générique, qui ne s'applique que si on n'a vraiment
      // aucune information sur la cause réelle.
      const specificMessage = e?.context?.body?.error || e?.message;
      const isGenericNetworkError = !specificMessage || specificMessage === "Réponse vide" || /FunctionsHttpError|FunctionsFetchError|Failed to fetch/i.test(specificMessage);
      setAiError(
        isGenericNetworkError
          ? "Impossible de générer les lignes pour le moment. Vérifie que la fonction \"suggest-lines\" est bien déployée et configurée (clé Gemini) — voir le Guide de déploiement, section IA. Sinon, réessaie dans un instant."
          : specificMessage
      );
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

  const totals = computeTotals(localDoc);
  const { computedLines, subtotalHTBrut, globalDiscountPct, globalDiscountAmount, subtotalHT, tvaGroups, totalTTC, acompteAmount, resteAPayer } = totals;
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
    readImageFile(file).then((dataUrl) => patchDeep("signature", { image: dataUrl })).catch((err) => alert(err.message));
    e.target.value = "";
  }

  const printRef = useRef(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  // Mode présentation : le document seul, plein écran, sans aucun
  // bouton d'administration — pensé pour une tablette posée devant le
  // client. Sortie par le bouton « Quitter » ou la touche Échap.
  const [presentationMode, setPresentationMode] = useState(false);
  const [presentationZoom, setPresentationZoom] = useState(1);
  function enterPresentation() {
    setPresentationMode(true);
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (request) {
      try {
        const result = request.call(root);
        if (result && typeof result.catch === "function") result.catch(() => {});
      } catch { /* plein écran refusé par le navigateur : l'affichage plein fenêtre suffit */ }
    }
  }
  function exitPresentation() {
    setPresentationMode(false);
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if ((document.fullscreenElement || document.webkitFullscreenElement) && exit) {
      try {
        const result = exit.call(document);
        if (result && typeof result.catch === "function") result.catch(() => {});
      } catch { /* rien à faire */ }
    }
  }
  useEscapeToClose(presentationMode, exitPresentation);
  useEffect(() => {
    if (!presentationMode) return;
    // Si le navigateur quitte lui-même le plein écran (geste système,
    // Échap intercepté par le navigateur), on quitte aussi le mode.
    function onFullscreenChange() {
      if (!(document.fullscreenElement || document.webkitFullscreenElement)) setPresentationMode(false);
    }
    // Le document fait 210 mm de large : sur un écran plus étroit, on
    // le réduit pour qu'il tienne en largeur.
    function onResize() {
      setPresentationZoom(Math.min(1, (window.innerWidth - 24) / 794));
    }
    onResize();
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      window.removeEventListener("resize", onResize);
    };
  }, [presentationMode]);

  async function downloadPdf() {
    const el = printRef.current;
    if (!el || pdfGenerating) return;
    setPdfGenerating(true);

    // QR code du lien public (créé maintenant s'il n'existe pas encore).
    await ensurePublicQr();

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
    if (localDoc.type === "facture" || localDoc.showValidity !== false) {
      rows.push([localDoc.type !== "facture" ? "Valable jusqu'au" : "Échéance", frLong(localDoc.type !== "facture" ? validityDate : dueDate)]);
    }
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
      rows.push(["Désignation", "Description", "Qté", "Unité", "PU HT", "TVA %", "Remise %", "Total HT"]);
      computedLines.forEach((l) => {
        rows.push([l.designation, "", l.qty, l.unit, Number(l.unitPrice) || 0, l.tva, l.discount, Number((l.totalHT || 0).toFixed(2))]);
        (l.details || []).filter((d) => d.included && (d.text || d.price)).forEach((d) => {
          rows.push(["", "  ".repeat(d.level) + (d.marker || defaultMarker(d.level)) + " " + stripMarkup(d.text), "", "", "", "", "", Number(d.price) > 0 ? Number(d.price) : ""]);
        });
      });
    }
    if (!hidePricesXls) {
      rows.push([]);
      if (globalDiscountPct > 0 && globalDiscountAmount > 0) {
        rows.push(["", "", "", "", "", "", "Total HT", Number(subtotalHTBrut.toFixed(2))]);
        rows.push(["", "", "", "", "", "", `Remise (${globalDiscountPct} %)`, -Number(globalDiscountAmount.toFixed(2))]);
        rows.push(["", "", "", "", "", "", "Total HT après remise", Number(subtotalHT.toFixed(2))]);
      } else {
        rows.push(["", "", "", "", "", "", "Total HT", Number(subtotalHT.toFixed(2))]);
      }
      Object.entries(tvaGroups).forEach(([rate, amount]) => rows.push(["", "", "", "", "", "", `TVA ${rate}%`, Number(amount.toFixed(2))]));
      rows.push(["", "", "", "", "", "", "Total TTC", Number(totalTTC.toFixed(2))]);
      if (localDoc.type !== "facture" && Number(localDoc.acompte) > 0) {
        rows.push(["", "", "", "", "", "", `Acompte (${localDoc.acompte}%)`, Number(acompteAmount.toFixed(2))]);
        rows.push(["", "", "", "", "", "", "Reste à payer", Number(resteAPayer.toFixed(2))]);
      }
      if (localDoc.type === "facture" && totals.acompteVerse > 0) {
        rows.push(["", "", "", "", "", "", "Acompte déjà versé", -Number(totals.acompteVerse.toFixed(2))]);
        rows.push(["", "", "", "", "", "", "Montant TTC à régler", Number(totals.montantARegler.toFixed(2))]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 30 }, { wch: 30 }, { wch: 6 }, { wch: 9 }, { wch: 10 }, { wch: 7 }, { wch: 9 }, { wch: 13 }];
    XLSX.utils.book_append_sheet(wb, ws, docTypeLabel(localDoc.type).slice(0, 31));
    XLSX.writeFile(wb, `${localDoc.docNumber}.xlsx`);
  }

  // Export Factur-X (facture électronique : PDF/A-3 + XML CII EN 16931),
  // produit par la fonction serveur generate-facturx à partir de la
  // facture affichée. Indépendant du bouton PDF classique, qui reste
  // inchangé. Ne transmet rien à une Plateforme Agréée.
  const [facturxGenerating, setFacturxGenerating] = useState(false);
  async function downloadFacturX() {
    if (facturxGenerating) return;
    setFacturxGenerating(true);
    try {
      const { data: { session } } = await db.auth.getSession();
      const { data, error } = await db.functions.invoke("generate-facturx", {
        body: { document: localDoc, companyProfile: companyProfile || null, siteName: siteSettings?.name || "" },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || data?.error) {
        // En cas de statut non-2xx, le vrai message (et la liste des
        // informations manquantes) est dans le corps de la réponse.
        let detail = data;
        if (!detail && error?.context) { try { detail = await error.context.json(); } catch { /* corps illisible */ } }
        const missing = Array.isArray(detail?.missing) ? detail.missing : [];
        alert(`${detail?.error || error?.message || "Impossible de générer le fichier Factur-X."}${missing.length ? "\n\nÀ compléter :\n- " + missing.join("\n- ") : ""}`);
        return;
      }
      const bytes = Uint8Array.from(atob(data.pdfBase64), (c) => c.charCodeAt(0));
      downloadBlob(new Blob([bytes], { type: "application/pdf" }), data.fileName || `Facture-${localDoc.docNumber || "document"}-facturx.pdf`);
      if (Array.isArray(data.warnings) && data.warnings.length) {
        alert(`Fichier Factur-X généré. Points d'attention :\n- ${data.warnings.join("\n- ")}`);
      }
    } catch (err) {
      console.error("Erreur de génération Factur-X", err);
      alert("Impossible de générer le fichier Factur-X. Réessaie dans un instant.");
    } finally {
      setFacturxGenerating(false);
    }
  }

  const inputStyle = { fontFamily: "'Inter', sans-serif", border: `1px solid ${colors.line}`, color: colors.ink };
  const statuses = localDoc.type === "devis" ? DEVIS_STATUSES : localDoc.type === "proforma" ? PROFORMA_STATUSES : FACTURE_STATUSES;

  return (
    <div className="df-root min-h-full w-full" style={{ backgroundColor: colors.paper, color: colors.ink }}>
      <GlobalStyle />

      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ background: colors.ink, borderRadius: siteSettings?.landingPageVersion === "avancee" ? "0 0 20px 20px" : 0 }}>
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
          <button onClick={downloadPdf} disabled={pdfGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.brass, color: siteSettings?.landingPageVersion === "avancee" ? "white" : colors.ink, opacity: pdfGenerating ? 0.7 : 1 }}>
            {pdfGenerating ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} {pdfGenerating ? "Génération…" : "PDF"}
          </button>
          {localDoc.type === "facture" && (
            <button onClick={downloadFacturX} disabled={facturxGenerating} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ border: `1px solid ${colors.line}`, color: colors.slate, opacity: facturxGenerating ? 0.7 : 1 }} title="Facture électronique : PDF/A-3 avec les données structurées (XML EN 16931) intégrées — format de la réforme 2026-2027">
              {facturxGenerating ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} {facturxGenerating ? "Génération…" : "Télécharger au format Factur-X"}
            </button>
          )}
          <button onClick={exportExcel} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: colors.moss }}>
            <FileSpreadsheet size={15} /> Excel
          </button>
          {(localDoc.type === "devis" || localDoc.type === "facture") && (
            <button onClick={generatePublicLink} disabled={publicLinkState.loading} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ border: `1px solid ${colors.line}`, color: colors.slate, opacity: publicLinkState.loading ? 0.7 : 1 }} title={localDoc.type === "devis" ? "Créer un lien pour que le client signe en ligne, sans compte" : "Créer un lien pour que le client paie en ligne, sans compte"}>
              {publicLinkState.loading ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} {publicLinkState.loading ? "Génération…" : localDoc.type === "devis" ? "Lien de signature" : "Lien de paiement"}
            </button>
          )}
          <button onClick={enterPresentation} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ border: `1px solid ${colors.line}`, color: colors.slate }} title="Afficher le document seul en plein écran, pour le présenter au client (Échap pour quitter)">
            <Maximize2 size={15} /> Présentation
          </button>
          {publicLinkState.url && (
            <span className="flex items-center gap-1 text-xs font-medium" style={{ color: colors.moss }}><Check size={13} /> Lien copié — colle-le dans ton email au client</span>
          )}
          {publicLinkState.error && (
            <span className="text-xs" style={{ color: colors.brick }}>{publicLinkState.error}</span>
          )}
        </div>
      </div>

      <div className="no-print mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <ReviewRequestNotice notice={reviewNotice} onSend={onSendReview} onDismiss={onDismissReview} />
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
              {siteSettings?.landingPageVersion === "avancee" && (() => {
                const TypeIcon = docTypeIcon(localDoc.type);
                return (
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: `${docTypeColor(localDoc.type)}18`, color: docTypeColor(localDoc.type) }}>
                    <TypeIcon size={20} />
                  </div>
                );
              })()}
              <div className="df-display text-3xl font-semibold uppercase tracking-wide">{docTypeLabel(localDoc.type)}</div>
              <input className="df-input df-mono mt-2 rounded-md px-2 py-1 text-sm" style={inputStyle} value={localDoc.docNumber} onChange={(e) => patch({ docNumber: e.target.value })} />
              <div className="mt-2 flex items-center gap-1.5">
                <label className="text-xs" style={{ color: colors.inkSoft }}>Devise</label>
                <select className="df-select df-mono rounded-md px-2 py-1 text-xs" style={inputStyle} value={localDoc.currency || "EUR"} onChange={(e) => patch({ currency: e.target.value })}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{currencyLabel(c)}</option>)}
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
                  <span></span>
                  <label className="flex items-center gap-1.5 text-xs" style={{ color: colors.inkSoft }}>
                    <input type="checkbox" checked={localDoc.showValidity !== false} onChange={(e) => patch({ showValidity: e.target.checked })} style={{ accentColor: colors.brass }} />
                    Afficher "Valable jusqu'au..." sur le document
                  </label>
                </>
              ) : (
                <>
                  <label className="self-center text-right" style={{ color: colors.inkSoft }}>Échéance (jours)</label>
                  <input type="number" className="df-input df-mono rounded-md px-2 py-1" style={inputStyle} value={localDoc.dueDays} onChange={(e) => patch({ dueDays: Number(e.target.value) || 0 })} />
                </>
              )}
              <div className="col-span-2 text-right text-xs" style={{ color: colors.inkSoft }}>
                {localDoc.type !== "facture" ? (localDoc.showValidity !== false ? `Valable jusqu'au ${frLong(validityDate)}` : null) : `Paiement attendu avant le ${frLong(dueDate)}`}
              </div>
            </div>
            {localDoc.type === "facture" && (
              <div className="mt-3 rounded-lg p-3" style={{ background: colors.paper }}>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={!!localDoc.isRecurring}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      if (checked && !localDoc.nextRecurrenceDate) {
                        const next = new Date(localDoc.issueDate || Date.now());
                        if (localDoc.recurrenceInterval === "annuel") next.setFullYear(next.getFullYear() + 1);
                        else if (localDoc.recurrenceInterval === "trimestriel") next.setMonth(next.getMonth() + 3);
                        else next.setMonth(next.getMonth() + 1);
                        patch({ isRecurring: checked, nextRecurrenceDate: next.toISOString().slice(0, 10) });
                      } else {
                        patch({ isRecurring: checked });
                      }
                    }}
                    style={{ accentColor: colors.brass }}
                  />
                  Facturation récurrente (contrat d'entretien, maintenance...)
                </label>
                {localDoc.isRecurring && (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="text-xs" style={{ color: colors.inkSoft }}>
                      Se répète
                      <select
                        className="df-select mt-1 block w-full rounded-md px-2 py-1.5 text-sm"
                        style={inputStyle}
                        value={localDoc.recurrenceInterval || "mensuel"}
                        onChange={(e) => patch({ recurrenceInterval: e.target.value })}
                      >
                        <option value="mensuel">Chaque mois</option>
                        <option value="trimestriel">Chaque trimestre</option>
                        <option value="annuel">Chaque année</option>
                      </select>
                    </label>
                    <label className="text-xs" style={{ color: colors.inkSoft }}>
                      Prochaine facture le
                      <input
                        type="date"
                        className="df-input df-mono mt-1 block w-full rounded-md px-2 py-1.5 text-sm"
                        style={inputStyle}
                        value={localDoc.nextRecurrenceDate || ""}
                        onChange={(e) => patch({ nextRecurrenceDate: e.target.value })}
                      />
                    </label>
                    <label className="text-xs" style={{ color: colors.inkSoft }}>
                      Arrêter le (optionnel)
                      <input
                        type="date"
                        className="df-input df-mono mt-1 block w-full rounded-md px-2 py-1.5 text-sm"
                        style={inputStyle}
                        value={localDoc.recurrenceEndDate || ""}
                        onChange={(e) => patch({ recurrenceEndDate: e.target.value })}
                      />
                    </label>
                  </div>
                )}
              </div>
            )}
            {localDoc.type === "facture" && (
              <label className="mt-3 flex items-center gap-2 text-sm" style={{ color: colors.inkSoft }}>
                <input
                  type="checkbox"
                  checked={localDoc.remindersEnabled !== false}
                  onChange={(e) => patch({ remindersEnabled: e.target.checked })}
                  style={{ accentColor: colors.brass }}
                />
                Envoyer une relance automatique par email si cette facture n'est pas payée à temps
              </label>
            )}
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="rounded-xl p-4" style={{ border: `1px solid ${colors.line}`, background: siteSettings?.landingPageVersion === "avancee" ? colors.paper : "transparent" }}>
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
              {(localDoc.type === "facture" || localDoc.type === "devis") && (
                <div className="mb-2 flex gap-2">
                  <input className="df-input w-1/3 rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Code postal" title="Code postal (facturation électronique)" value={localDoc.company.postalCode || ""} onChange={(e) => patchDeep("company", { postalCode: e.target.value })} />
                  <input className="df-input w-2/3 rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Ville" title="Ville (facturation électronique)" value={localDoc.company.city || ""} onChange={(e) => patchDeep("company", { city: e.target.value })} />
                </div>
              )}
              <div className="flex gap-2">
                <input className="df-input w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Email" value={localDoc.company.email} onChange={(e) => patchDeep("company", { email: e.target.value })} />
                <input className="df-input w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Téléphone" value={localDoc.company.phone} onChange={(e) => patchDeep("company", { phone: e.target.value })} />
              </div>
            </div>
            <div className="rounded-xl p-4" style={{ border: `1px solid ${colors.line}`, background: siteSettings?.landingPageVersion === "avancee" ? colors.paper : "transparent" }}>
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
              {(localDoc.type === "facture" || localDoc.type === "devis") && (
                <>
                  <div className="mb-2 flex gap-2">
                    <input className="df-input w-1/3 rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Code postal" title="Code postal (facturation électronique)" value={localDoc.client.postalCode || ""} onChange={(e) => patchDeep("client", { postalCode: e.target.value })} />
                    <input className="df-input w-2/3 rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Ville" title="Ville (facturation électronique)" value={localDoc.client.city || ""} onChange={(e) => patchDeep("client", { city: e.target.value })} />
                  </div>
                  {(localDoc.client.type || "entreprise") !== "particulier" && (
                    <div className="mb-2 flex gap-2">
                      <input className="df-input w-1/2 rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="SIRET du client (14 chiffres)" title="SIRET du client — son SIREN (9 premiers chiffres) est obligatoire sur les factures électroniques" value={localDoc.client.siret || ""} onChange={(e) => patchDeep("client", { siret: e.target.value })} />
                      <input className="df-input w-1/2 rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="N° TVA intracom. du client" title="Numéro de TVA intracommunautaire du client (ex : FR 12 345678901)" value={localDoc.client.tva || ""} onChange={(e) => patchDeep("client", { tva: e.target.value })} />
                    </div>
                  )}
                </>
              )}
              <div className="flex gap-2">
                <input className="df-input w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Email" value={localDoc.client.email} onChange={(e) => patchDeep("client", { email: e.target.value })} />
                <input className="df-input w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Téléphone" value={localDoc.client.phone} onChange={(e) => patchDeep("client", { phone: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="mb-6">
            <label className="mb-1 block text-xs font-medium" style={{ color: colors.inkSoft }}>Chantier (optionnel — regroupe les documents d'un même projet)</label>
            <input className="df-input w-full rounded-md px-3 py-2 text-sm" style={inputStyle} placeholder="Ex : Rénovation cuisine Dupont" value={localDoc.chantier || ""} onChange={(e) => patch({ chantier: e.target.value })} />
          </div>

          {(localDoc.type === "facture" || localDoc.type === "devis") && (
            <div className="no-print mb-8 rounded-xl p-4" style={{ border: `1px solid ${colors.line}` }}>
              <div className="df-display mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest" style={{ color: colors.slate }}>
                <FileText size={13} /> Facturation électronique (Factur-X)
              </div>
              <p className="mb-3 text-xs" style={{ color: colors.inkSoft }}>Nouvelles mentions obligatoires de la réforme 2026-2027 — nécessaires pour l'export au format Factur-X, sans effet sur le PDF classique.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs" style={{ color: colors.inkSoft }}>
                  Catégorie d'opération
                  <select className="df-select mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} value={localDoc.operationCategory || ""} onChange={(e) => patch({ operationCategory: e.target.value })}>
                    <option value="">— Choisir —</option>
                    <option value="services">Prestation de services</option>
                    <option value="biens">Livraison de biens</option>
                    <option value="mixte">Opération mixte (biens et services)</option>
                  </select>
                </label>
                <label className="text-xs" style={{ color: colors.inkSoft }}>
                  Motif d'exonération (pour les lignes à 0 % de TVA)
                  <select className="df-select mt-1 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} value={localDoc.vatExemptionReason || "franchise"} onChange={(e) => patch({ vatExemptionReason: e.target.value })}>
                    <option value="franchise">Franchise en base (art. 293 B du CGI)</option>
                    <option value="export">Exportation hors UE (art. 262 I du CGI)</option>
                    <option value="intracom">Livraison intracommunautaire (art. 262 ter I du CGI)</option>
                    <option value="autoliquidation">Autoliquidation — TVA due par le client (art. 283 du CGI)</option>
                  </select>
                </label>
              </div>
              <div className="mt-3">
                <div className="mb-1 text-xs font-medium" style={{ color: colors.inkSoft }}>Adresse de livraison / du chantier (seulement si différente de l'adresse du client)</div>
                <input className="df-input mb-2 w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Adresse" value={localDoc.deliveryAddress || ""} onChange={(e) => patch({ deliveryAddress: e.target.value })} />
                <div className="flex gap-2">
                  <input className="df-input w-1/3 rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Code postal" value={localDoc.deliveryPostalCode || ""} onChange={(e) => patch({ deliveryPostalCode: e.target.value })} />
                  <input className="df-input w-2/3 rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Ville" value={localDoc.deliveryCity || ""} onChange={(e) => patch({ deliveryCity: e.target.value })} />
                </div>
              </div>
            </div>
          )}

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
                    {SpeechRecognitionAPI && (
                      <button
                        onClick={toggleVoiceInput}
                        className="mt-1.5 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium"
                        style={{ background: isListening ? colors.brick : colors.paper, color: isListening ? "white" : colors.inkSoft }}
                        title={isListening ? "Arrêter la dictée" : "Décrire à voix haute"}
                      >
                        <Mic size={12} className={isListening ? "animate-pulse" : ""} /> {isListening ? "Écoute en cours... (clique pour arrêter)" : "Dicter à voix haute"}
                      </button>
                    )}
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
              <button onClick={addLine} className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-white" style={{ background: siteSettings?.landingPageVersion === "avancee" ? adv.accent : colors.ink }}>
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
                  <button onClick={() => removeItem(it.id)} title="Supprimer cette ligne" style={{ color: colors.brick }}><Trash2 size={15} /></button>
                </div>
              </div>
            ) : (
              <div key={it.id} className="rounded-lg p-2" style={{ background: selectedLineIds.includes(it.id) ? "rgba(166,72,59,0.08)" : idx % 2 ? "transparent" : "rgba(62,92,110,0.04)" }}>
                <div className="flex flex-wrap items-start gap-2">
                  <input type="checkbox" className="no-print mt-2" checked={selectedLineIds.includes(it.id)} onChange={() => toggleLineSelect(it.id)} style={{ accentColor: colors.brick }} aria-label="Sélectionner cette ligne" />
                  <div className="grow basis-56">
                    <input className="df-input w-full rounded-md px-2 py-1.5 text-sm" style={inputStyle} placeholder="Désignation" value={it.designation} onChange={(e) => updateItem(it.id, { designation: e.target.value })} />
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {!(openDetailsFor.includes(it.id) || (it.details || []).length > 0) && (
                        <button onClick={() => addDetail(it.id, 1)} className="no-print flex items-center gap-1 text-xs" style={{ color: colors.slate }}>
                          <Plus size={11} /> Ajouter une description détaillée
                        </button>
                      )}
                    </div>
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
                    <input type="number" className="df-input df-mono w-24 rounded-md px-1 py-1.5 text-right text-sm" style={inputStyle} value={it.unitPrice} onChange={(e) => updateItem(it.id, { unitPrice: e.target.value })} />
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
                      {formatMoney(lineBaseHT(it) * (1 - (Number(it.discount) || 0) / 100) * (1 - (Number(localDoc.globalDiscount) || 0) / 100), localDoc.currency)}
                    </div>
                  </div>
                  <div className="no-print flex w-24 shrink-0 justify-end gap-1 pt-1.5">
                    <button onClick={() => saveLineAsPrestation(it)} title="Enregistrer comme prestation" style={{ color: colors.brassDark }}><BookmarkPlus size={14} /></button>
                    <button onClick={() => moveItem(it.id, -1)} style={{ color: colors.inkSoft }}><ChevronUp size={14} /></button>
                    <button onClick={() => moveItem(it.id, 1)} style={{ color: colors.inkSoft }}><ChevronDown size={14} /></button>
                    <button onClick={() => removeItem(it.id)} title="Supprimer cette ligne" style={{ color: colors.brick }}><Trash2 size={14} /></button>
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
                        <button onClick={() => removeDetail(it.id, d.id)} className="no-print shrink-0" style={{ color: colors.brick }} title="Retirer cette ligne" aria-label="Retirer cette ligne"><X size={12} /></button>
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
              {localDoc.type === "facture" ? (
                <label className="text-sm">
                  <div className="mb-1" style={{ color: colors.inkSoft }}>Acompte déjà versé ({currencyLabel(localDoc.currency || "EUR")} TTC)</div>
                  <input type="number" min="0" step="0.01" className="df-input df-mono w-32 rounded-md px-2 py-1.5" style={inputStyle} placeholder="0,00" value={localDoc.acompteVerse ?? ""} onChange={(e) => patch({ acompteVerse: e.target.value })} title="Montant déjà réglé par le client (virement, chèque, espèces…), déduit du total à régler" />
                </label>
              ) : (
                <label className="text-sm">
                  <div className="mb-1" style={{ color: colors.inkSoft }}>Acompte demandé (%)</div>
                  <input type="number" className="df-input df-mono w-28 rounded-md px-2 py-1.5" style={inputStyle} value={localDoc.acompte} onChange={(e) => patch({ acompte: e.target.value })} />
                </label>
              )}
            </div>

            <div className="flex items-center gap-8">
              <div className="df-mono space-y-1 text-right text-sm">
                {globalDiscountPct > 0 && globalDiscountAmount > 0 ? (
                  <>
                    <div className="flex justify-between gap-8"><span style={{ color: colors.inkSoft }}>Total HT</span><span>{formatMoney(subtotalHTBrut, localDoc.currency)}</span></div>
                    <div className="flex justify-between gap-8"><span style={{ color: colors.inkSoft }}>Remise ({globalDiscountPct} %)</span><span>- {formatMoney(globalDiscountAmount, localDoc.currency)}</span></div>
                    <div className="flex justify-between gap-8 font-semibold"><span style={{ color: colors.inkSoft }}>Total HT après remise</span><span>{formatMoney(subtotalHT, localDoc.currency)}</span></div>
                  </>
                ) : (
                  <div className="flex justify-between gap-8"><span style={{ color: colors.inkSoft }}>Total HT</span><span>{formatMoney(subtotalHT, localDoc.currency)}</span></div>
                )}
                {Object.entries(tvaGroups).map(([rate, amount]) => (
                  <div key={rate} className="flex justify-between gap-8"><span style={{ color: colors.inkSoft }}>TVA {rate}%</span><span>{formatMoney(amount, localDoc.currency)}</span></div>
                ))}
                {localDoc.type !== "facture" && Number(localDoc.acompte) > 0 && (
                  <>
                    <div className="flex justify-between gap-8"><span style={{ color: colors.inkSoft }}>Acompte ({localDoc.acompte}%)</span><span>- {formatMoney(acompteAmount, localDoc.currency)}</span></div>
                    <div className="flex justify-between gap-8 font-semibold" style={{ color: colors.moss }}><span>Reste à payer</span><span>{formatMoney(resteAPayer, localDoc.currency)}</span></div>
                  </>
                )}
                {localDoc.type === "facture" && totals.acompteVerse > 0 && (
                  <>
                    <div className="flex justify-between gap-8"><span style={{ color: colors.inkSoft }}>Total TTC</span><span>{formatMoney(totalTTC, localDoc.currency)}</span></div>
                    <div className="flex justify-between gap-8"><span style={{ color: colors.inkSoft }}>Acompte déjà versé</span><span>- {formatMoney(totals.acompteVerse, localDoc.currency)}</span></div>
                    <div className="flex justify-between gap-8 font-semibold" style={{ color: colors.moss }}><span>Montant TTC à régler</span><span>{formatMoney(totals.montantARegler, localDoc.currency)}</span></div>
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
                    <>
                      <input className="df-input df-display w-full max-w-sm rounded-md px-3 py-2 text-lg italic" style={inputStyle} placeholder="Tapez votre nom pour signer" value={localDoc.signature.name} onChange={(e) => patchDeep("signature", { name: e.target.value })} />
                      {localDoc.signature.secondName && (
                        <p className="mt-2 text-xs" style={{ color: colors.inkSoft }}>Second signataire : <span className="df-display italic" style={{ color: colors.ink }}>{localDoc.signature.secondName}</span></p>
                      )}
                    </>
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
      <FinalizeButton doc={localDoc} onFinalize={onFinalize} siteSettings={siteSettings} />
      <PrintDocument ref={printRef} doc={localDoc} totals={totals} accountPlan={account?.plan} siteSettings={siteSettings} watermarkEnabled={watermarkEnabled} publicQr={publicQr} />

      {presentationMode && (
        <div className="df-presentation no-print" style={{ background: colors.ink }}>
          <button onClick={exitPresentation} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ position: "fixed", top: 12, right: 12, zIndex: 1, background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.35)" }} title="Quitter le mode présentation (Échap)">
            <Minimize2 size={15} /> Quitter
          </button>
          <div style={{ padding: "24px 12px 48px", zoom: presentationZoom }}>
            <PrintDocument doc={localDoc} totals={totals} accountPlan={account?.plan} siteSettings={siteSettings} watermarkEnabled={watermarkEnabled} publicQr={publicQr} />
          </div>
        </div>
      )}
    </div>
  );
}
