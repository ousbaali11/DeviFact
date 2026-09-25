// _shared/superpdp-rules.ts
//
// Règles d'éligibilité d'une facture à l'envoi via Super PDP, statuts et
// verrou de contenu — fonctions pures, sans Deno, MÊMES règles que
// src/pdp-rules.js côté site (test de parité src/superpdp-envoi.test.jsx).
//
// Étape 2 : factures seulement (ni acomptes, ni situations), clients
// professionnels établis en France avec SIRET ; en bac à sable, le champ
// SIRET de la fiche client porte l'identifiant de test Super PDP
// (« 0225:315143296_106842 » ou « 315143296_106842 »).

export type PdpState = { invoiceId?: number | null; status?: string | null; statusText?: string | null; sentAt?: string | null; updatedAt?: number | null; env?: string | null; error?: string | null } | null | undefined;
export type PdpContext = { connected: boolean; env?: string | null; verificationStatus?: string | null; companyCountryCode?: string | null; allowProduction?: boolean };
export type PdpEligibility = { ok: boolean; code: string | null; reason: string | null };

// Statuts après lesquels un nouvel envoi est possible (facture corrigée).
export const PDP_FINAL_FAILURES = ["api:invalid", "api:rejected", "fr:210", "fr:213", "fr:501", "error"];
// Champs encore modifiables sur une facture transmise (statut, paiements,
// relances, suivi) : tout le reste est figé, un avoir corrige.
export const PDP_EDITABLE_KEYS = ["status", "paidAt", "paidTotal", "payments", "workStage", "lastReminderSentAt", "remindersEnabled", "pdp", "conflict", "updatedAt"];
export const PDP_STATUS_LABELS: Record<string, string> = {
  "api:sending": "Envoi en cours", "api:uploaded": "Déposée chez Super PDP", "api:validated": "Validée", "api:invalid": "Fichier refusé",
  "api:sent": "Transmise", "api:rejected": "Rejetée par la plateforme du client", "api:received": "Reçue", "api:acknowledged": "Accusé de réception", "api:accepted": "Acceptée",
  "fr:200": "Déposée", "fr:201": "Émise", "fr:202": "Reçue", "fr:203": "Mise à disposition", "fr:204": "Prise en charge", "fr:205": "Approuvée", "fr:206": "Approuvée partiellement",
  "fr:207": "En litige", "fr:208": "Suspendue", "fr:209": "Complétée", "fr:210": "Refusée", "fr:211": "Paiement transmis", "fr:212": "Encaissée", "fr:213": "Rejetée", "fr:501": "Irrecevable",
  error: "Envoi en échec",
};

const countryCode = (v: unknown): string | null => { const m = /([A-Za-z]{2})\s*$/.exec(String(v || "")); return m ? m[1].toUpperCase() : null; };
export function sirenOfSiret(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 9 || digits.length === 14 ? digits.slice(0, 9) : null;
}
// Identifiant d'une entreprise de bac à sable Super PDP.
export function sandboxIdentifierOf(value: unknown): { id: string; siren: string } | null {
  const m = /^(?:0225:)?(\d{9})_(\d{1,12})$/.exec(String(value ?? "").trim());
  return m ? { id: `${m[1]}_${m[2]}`, siren: m[1] } : null;
}
export function pdpStatusLabel(pdp: PdpState): string {
  if (!pdp || !pdp.status) return "";
  return PDP_STATUS_LABELS[pdp.status] || pdp.statusText || pdp.status;
}
export function pdpCanResend(pdp: PdpState): boolean {
  if (!pdp || !pdp.status) return true;
  if (pdp.status === "api:sending") return false;
  return PDP_FINAL_FAILURES.includes(pdp.status);
}
export function pdpLocksContent(pdp: PdpState): boolean {
  return !!pdp && !!pdp.invoiceId && !PDP_FINAL_FAILURES.includes(String(pdp.status || ""));
}
export function pdpBlockedKeys(patch: Record<string, unknown> | null | undefined): string[] {
  return Object.keys(patch || {}).filter((k) => !PDP_EDITABLE_KEYS.includes(k));
}
// Événements Super PDP (identifiants strictement croissants) : dernier
// événement par facture. Renvoie les mises à jour par identifiant de facture
// Super PDP et le plus grand identifiant d'événement lu.
export type PdpEvent = { id: number; invoice_id: number; status_code: string; status_text?: string | null; created_at?: string | null };
export type PdpEventUpdate = { invoiceId: number; status: string; statusText: string; lastEventId: number; lastEventAt: string | null };
export function applyPdpEvents(events: PdpEvent[]): { updates: PdpEventUpdate[]; lastEventId: number } {
  const byInvoice = new Map<number, PdpEventUpdate>();
  let lastEventId = 0;
  for (const e of [...(events || [])].sort((a, b) => Number(a.id) - Number(b.id))) {
    const id = Number(e?.id), invoiceId = Number(e?.invoice_id);
    if (!Number.isFinite(id) || !Number.isFinite(invoiceId) || !e?.status_code) continue;
    lastEventId = Math.max(lastEventId, id);
    const status = String(e.status_code);
    byInvoice.set(invoiceId, { invoiceId, status, statusText: PDP_STATUS_LABELS[status] || String(e.status_text || status), lastEventId: id, lastEventAt: e.created_at ? String(e.created_at) : null });
  }
  return { updates: [...byInvoice.values()], lastEventId };
}
// Encaissement (fr:212) : une seule fois, pour une facture transmise (non en
// échec) passée « payée » — jamais pour un acompte ni un paiement partiel.
export function shouldSendPaidEvent(doc: any): boolean {
  if (!doc || doc.type !== "facture" || doc.status !== "payée") return false;
  const pdp = doc.pdp;
  if (!pdp || !pdp.invoiceId || pdp.paidEventAt) return false;
  return !PDP_FINAL_FAILURES.includes(String(pdp.status || ""));
}
export function pdpEligibility(doc: any, ctx: PdpContext): PdpEligibility {
  const no = (code: string, reason: string): PdpEligibility => ({ ok: false, code, reason });
  if (!doc || doc.type !== "facture") return no("type", "Seules les factures sont transmises via Super PDP pour l'instant (ni acomptes, ni situations).");
  if (!doc.status || doc.status === "brouillon") return no("brouillon", "Une facture en brouillon ne se transmet pas : passe-la d'abord en « envoyée ».");
  if ((doc.client?.type || "entreprise") === "particulier") return no("particulier", "Client particulier : la facture électronique B2B ne s'applique pas, le PDF classique suffit.");
  if (countryCode(doc.client?.country) !== "FR") return no("etranger", "Client établi hors de France : cette vente relève du e-reporting, pas de la transmission B2B.");
  if ((ctx.companyCountryCode || "").toUpperCase() !== "FR") return no("entreprise-pays", "Réservé aux entreprises dont le pays (Mon entreprise) est la France.");
  if (!ctx.connected) return no("non-connecte", "Aucun compte Super PDP connecté : connecte-le depuis Mon entreprise.");
  if (ctx.verificationStatus && ctx.verificationStatus !== "verified") return no("non-verifie", `Entreprise pas encore vérifiée chez Super PDP (${ctx.verificationStatus}).`);
  if (ctx.env === "production" && !ctx.allowProduction) return no("production", "Compte Super PDP en production : les envois réels ne sont pas encore autorisés dans Chantiflow.");
  const sandbox = ctx.env !== "production";
  if (sandbox ? !sandboxIdentifierOf(doc.client?.siret) && !sirenOfSiret(doc.client?.siret) : !sirenOfSiret(doc.client?.siret)) return no("siret", sandbox ? "Client sans identifiant : en bac à sable, renseigne dans le champ SIRET de la fiche client l'identifiant de test Super PDP (ex. 315143296_106842)." : "Client sans SIRET : renseigne le SIRET (14 chiffres) sur la fiche client.");
  if (!pdpCanResend(doc.pdp)) return no("deja-envoyee", doc.pdp?.status === "api:sending" ? "Envoi déjà en cours." : `Facture déjà transmise via Super PDP (${pdpStatusLabel(doc.pdp)}).`);
  return { ok: true, code: null, reason: null };
}
