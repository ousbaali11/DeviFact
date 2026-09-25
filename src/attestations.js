// Attestations et assurances de l'entreprise (priorité 5 de la feuille de
// route) : fichiers (PDF, JPG, PNG) rangés dans le bucket privé
// « company-files », décrits dans la fiche entreprise (profile.attestations).
// Gestion réservée au propriétaire (comme l'IBAN). Jointes aux devis et
// contrats (PDF téléchargé, lien public du devis) tant qu'elles sont
// valides ; alerte à 30 jours, alerte rouge tant qu'une attestation expirée
// n'est pas remplacée. Module pur (pas de React), testé.

export const ATTESTATION_KINDS = [
  ["decennale", "Assurance décennale"],
  ["rc_pro", "Responsabilité civile professionnelle"],
  ["urssaf", "Attestation de vigilance URSSAF"],
  ["fiscale", "Attestation de régularité fiscale"],
  ["kbis", "Kbis / extrait d'immatriculation"],
  ["qualification", "Qualification (RGE, Qualibat…)"],
  ["autre", "Autre"],
];
export const ATTESTATION_ALERT_DAYS = 30;
export const ATTESTATION_FILE_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];
export const ATTESTATION_FILE_MAX_BYTES = 10 * 1024 * 1024;

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function localDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function attestationKindLabel(kind) {
  return ATTESTATION_KINDS.find(([id]) => id === kind)?.[1] || "Attestation";
}
// Libellé affiché : le type, ou le libellé libre pour « Autre ».
export function attestationLabel(a) {
  if (!a) return "";
  if (a.kind === "autre" && String(a.label || "").trim()) return String(a.label).trim();
  return attestationKindLabel(a.kind);
}
// État à une date : « valide », « expire_bientot » (30 jours ou moins,
// aujourd'hui compris) ou « expiree » ; daysLeft négatif une fois expirée.
export function attestationState(a, today = new Date()) {
  const end = localDate(a?.expiresAt);
  if (!end) return { state: "expiree", daysLeft: -Infinity };
  const day0 = new Date(today); day0.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((end - day0) / 86400000);
  return { state: daysLeft < 0 ? "expiree" : daysLeft <= ATTESTATION_ALERT_DAYS ? "expire_bientot" : "valide", daysLeft };
}
export function attestationStateLabel(s) {
  if (s.state === "expiree") return s.daysLeft === -Infinity ? "Date d'expiration manquante" : s.daysLeft === -1 ? "Expirée depuis hier" : `Expirée depuis ${-s.daysLeft} j`;
  if (s.daysLeft === 0) return "Expire aujourd'hui";
  if (s.state === "expire_bientot") return `Expire dans ${s.daysLeft} j`;
  return "Valide";
}
// Liste de la fiche entreprise, avec l'état de chacune, dans l'ordre
// d'expiration (la plus urgente d'abord).
export function attestationsWithState(profile, today = new Date()) {
  const list = Array.isArray(profile?.attestations) ? profile.attestations : [];
  return list
    .filter((a) => a && typeof a === "object")
    .map((a) => ({ ...a, label: attestationLabel(a), ...attestationState(a, today) }))
    .sort((a, b) => a.daysLeft - b.daysLeft || a.label.localeCompare(b.label));
}
// Attestations jointes aux documents : valides (y compris celles qui
// expirent bientôt) et munies d'un fichier.
export function validAttestations(profile, today = new Date()) {
  return attestationsWithState(profile, today).filter((a) => a.state !== "expiree" && a.path);
}
// Alertes du tableau de bord : à 30 jours, puis rouge tant qu'elle est
// expirée (une assurance expirée reste un problème jusqu'à remplacement).
export function attestationAlerts(profile, today = new Date()) {
  return attestationsWithState(profile, today).filter((a) => a.state !== "valide").map((a) => ({ id: a.id, label: a.label, state: a.state, daysLeft: a.daysLeft, expiresAt: a.expiresAt }));
}
// Ligne imprimée sous les mentions légales d'un devis ou d'un contrat.
export function attachedAttestationsLine(profile, today = new Date()) {
  const list = validAttestations(profile, today);
  if (!list.length) return "";
  const fmt = (iso) => { const d = localDate(iso); return d ? d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : iso; };
  return `Pièces jointes : ${list.map((a) => `${a.label}${a.organism ? ` (${a.organism})` : ""}, valide jusqu'au ${fmt(a.expiresAt)}`).join(" ; ")}.`;
}
export function attestationFileProblem(file) {
  if (!file) return "Aucun fichier.";
  const ext = String(file.name || "").split(".").pop().toLowerCase();
  if (!ATTESTATION_FILE_EXTENSIONS.includes(ext)) return "Ce type de fichier n'est pas accepté (PDF, JPG ou PNG).";
  if ((Number(file.size) || 0) > ATTESTATION_FILE_MAX_BYTES) return "Fichier trop lourd : 10 Mo maximum.";
  return "";
}
export function todayIso(today = new Date()) { return isoOf(today); }

// Fusion : le PDF du document, puis chaque attestation — un PDF page à
// page, une image (JPG, PNG) sur une page A4 à sa proportion. Une pièce
// illisible est ignorée (et signalée) plutôt que de bloquer le
// téléchargement. pdf-lib n'est chargé qu'à ce moment-là.
export async function appendAttachmentsToPdf(pdfBytes, files) {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.load(pdfBytes);
  const skipped = [];
  for (const f of files || []) {
    try {
      const bytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
      const mime = String(f.mime || "").toLowerCase();
      const name = String(f.name || "").toLowerCase();
      if (mime.includes("pdf") || name.endsWith(".pdf")) {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      } else if (mime.includes("png") || name.endsWith(".png") || mime.includes("jpeg") || mime.includes("jpg") || name.endsWith(".jpg") || name.endsWith(".jpeg")) {
        const img = mime.includes("png") || name.endsWith(".png") ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        const page = out.addPage([595.28, 841.89]); // A4 en points
        const margin = 36;
        const scale = Math.min((595.28 - 2 * margin) / img.width, (841.89 - 2 * margin) / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        page.drawImage(img, { x: (595.28 - w) / 2, y: 841.89 - margin - h, width: w, height: h });
      } else {
        skipped.push(f.name || "fichier");
      }
    } catch (err) {
      console.error("Pièce jointe ignorée", f?.name, err);
      skipped.push(f?.name || "fichier");
    }
  }
  return { bytes: await out.save(), skipped };
}
