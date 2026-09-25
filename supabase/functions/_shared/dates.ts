// _shared/dates.ts
//
// Jour « d'aujourd'hui » en heure de Paris. Les fonctions serveur tournent en
// UTC : entre minuit et 2 h du matin à Paris, la date UTC est encore celle de
// la veille (facture datée de la veille, période comptable d'avant, borne de
// validité des attestations décalée). Même repère que le site, qui travaille
// en heure locale de l'artisan.
const PARIS = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

export function parisDateParts(d: Date = new Date()): { year: number; month: number; day: number; iso: string } {
  const parts: Record<string, number> = {};
  for (const p of PARIS.formatToParts(d)) if (p.type !== "literal") parts[p.type] = Number(p.value);
  const iso = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  return { year: parts.year, month: parts.month, day: parts.day, iso };
}
export function parisTodayIso(d: Date = new Date()): string {
  return parisDateParts(d).iso;
}
