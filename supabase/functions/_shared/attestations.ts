// _shared/attestations.ts
//
// Attestations et assurances de la fiche entreprise (profile.attestations)
// — même règle que src/attestations.js côté site : une attestation est
// jointe à un devis (lien public) tant qu'elle a un fichier et une date
// d'expiration non dépassée (le jour même compris).

const KIND_LABELS: Record<string, string> = {
  decennale: "Assurance décennale",
  rc_pro: "Responsabilité civile professionnelle",
  urssaf: "Attestation de vigilance URSSAF",
  fiscale: "Attestation de régularité fiscale",
  kbis: "Kbis / extrait d'immatriculation",
  qualification: "Qualification (RGE, Qualibat…)",
  autre: "Autre",
};

export type Attestation = { id?: string; kind?: string; label?: string; organism?: string; number?: string; expiresAt?: string; path?: string; fileName?: string; mime?: string };

export function attestationLabel(a: Attestation | null | undefined): string {
  if (!a) return "";
  if (a.kind === "autre" && String(a.label || "").trim()) return String(a.label).trim();
  return KIND_LABELS[String(a.kind || "")] || "Attestation";
}

export function validAttestations(profile: any, today = new Date()): Array<Attestation & { label: string }> {
  const list: Attestation[] = Array.isArray(profile?.attestations) ? profile.attestations : [];
  const todayIso = today.toISOString().slice(0, 10);
  return list
    .filter((a) => a && typeof a === "object" && !!a.path && /^\d{4}-\d{2}-\d{2}$/.test(String(a.expiresAt || "")) && String(a.expiresAt) >= todayIso)
    .map((a) => ({ ...a, label: attestationLabel(a) }))
    .sort((a, b) => String(a.expiresAt).localeCompare(String(b.expiresAt)) || a.label.localeCompare(b.label));
}
