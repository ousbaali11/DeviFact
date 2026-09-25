// kpis.js — indicateurs de ventes du tableau de bord (fonctions pures,
// testées unitairement, sans aucune dépendance à React ni à la base).
//
// Définitions retenues (voir les tests et le résumé de livraison) :
//   * une « vente » = une facture au statut « payée » (les factures
//     seulement envoyées ou en retard ne comptent pas) ;
//   * le montant est le total HT (cohérent avec le graphique de chiffre
//     d'affaires existant) — fourni par l'appelant via `amountOf` ;
//   * la date d'une vente est la date de paiement (`paidAt`, posée quand
//     la facture passe à « payée ») et, à défaut, la date d'émission ;
//   * les bornes sont calculées en heure locale de l'appareil : « aujourd'hui »
//     va de 00:00:00.000 à 23:59:59.999 locales ;
//   * « 7 derniers jours » = fenêtre glissante, aujourd'hui inclus (J-6 → J) ;
//   * « mois en cours » = du 1er du mois à aujourd'hui ;
//   * « exercice en cours » = du 1er du mois de début d'exercice (année
//     civile par défaut : janvier) à aujourd'hui.

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

// Début de l'exercice en cours pour une date donnée et un mois de début
// (1 = janvier … 12 = décembre). Si le mois de début n'est pas encore
// atteint cette année, l'exercice a commencé l'année précédente.
export function fiscalYearStart(date, fiscalStartMonth = 1) {
  const m = Number(fiscalStartMonth);
  const month = Number.isInteger(m) && m >= 1 && m <= 12 ? m : 1;
  const d = new Date(date);
  const year = d.getMonth() + 1 >= month ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(year, month - 1, 1, 0, 0, 0, 0);
}

// Les quatre périodes, sous forme { start, end } (bornes incluses).
export function kpiPeriods(now = new Date(), fiscalStartMonth = 1) {
  const today = startOfDay(now);
  const end = endOfDay(now);
  const last7Start = new Date(today);
  last7Start.setDate(last7Start.getDate() - 6);
  return {
    today: { start: today, end },
    last7: { start: last7Start, end },
    month: { start: new Date(today.getFullYear(), today.getMonth(), 1), end },
    fiscalYear: { start: fiscalYearStart(now, fiscalStartMonth), end },
  };
}

// Vente encaissée : facture payée, ou situation de travaux « vaut facture » payée.
export function isSale(doc) {
  if (!doc) return false;
  // Avoir émis : vente négative (amountOf renvoie un montant négatif).
  if (doc.type === "avoir") return doc.status === "envoyée" || doc.status === "payée" || doc.status === "en retard";
  return (doc.type === "facture" || (doc.type === "situation" && doc.vautFacture === true)) && doc.status === "payée";
}

// Date de la vente : paiement si connu, sinon émission. Renvoie null si
// aucune date exploitable.
export function saleDateOf(doc) {
  if (!doc) return null;
  const raw = doc.paidAt || doc.issueDate;
  if (!raw) return null;
  // Une date « AAAA-MM-JJ » seule est interprétée en heure locale (et
  // non en UTC) pour ne pas décaler d'un jour selon le fuseau horaire.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(raw)) ? new Date(`${raw}T00:00:00`) : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inPeriod(date, period) {
  return date >= period.start && date <= period.end;
}

// Calcule les quatre indicateurs : { today, last7, month, fiscalYear },
// chacun { amount, count }. `amountOf(doc)` renvoie le montant HT d'une
// facture (fourni par l'application, qui connaît les règles de calcul).
export function computeSalesKpis(documents, { now = new Date(), fiscalStartMonth = 1, amountOf } = {}) {
  const periods = kpiPeriods(now, fiscalStartMonth);
  const result = { today: { amount: 0, count: 0 }, last7: { amount: 0, count: 0 }, month: { amount: 0, count: 0 }, fiscalYear: { amount: 0, count: 0 } };
  const amount = typeof amountOf === "function" ? amountOf : () => 0;
  for (const doc of documents || []) {
    if (!isSale(doc)) continue;
    const date = saleDateOf(doc);
    if (!date) continue;
    const value = Number(amount(doc)) || 0;
    for (const key of Object.keys(periods)) {
      if (inPeriod(date, periods[key])) {
        result[key].amount += value;
        result[key].count += 1;
      }
    }
  }
  return result;
}

export const FISCAL_MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
