// _shared/connect.ts
//
// Paramètres de création du compte Stripe connecté d'un artisan, pré-remplis
// avec tout ce que Chantiflow connaît déjà (Mon entreprise et profil) : la
// page d'inscription Stripe ne demande plus que ce qui manque (date de
// naissance, acceptation des conditions, pièce d'identité si Stripe l'exige).
// Montage inchangé : Stripe porte les pertes, l'artisan paie ses frais par
// paiement, la plateforme ne paie rien (ni mensuel, ni par transaction).

const clean = (v: unknown) => String(v ?? "").trim();

// SIREN (9 chiffres) tiré d'un SIRET (14 chiffres) ; vide si invalide.
export function sirenOf(siret: unknown): string {
  const digits = clean(siret).replace(/\s+/g, "");
  return /^\d{14}$/.test(digits) ? digits.slice(0, 9) : /^\d{9}$/.test(digits) ? digits : "";
}
// IBAN français normalisé (sans espaces, majuscules) ; vide s'il n'a pas la
// forme attendue (FR + 25 caractères) — Stripe refuserait, et le compte
// serait alors créé sans coordonnées bancaires plutôt que pas du tout.
export function frenchIbanOf(iban: unknown): string {
  const v = clean(iban).replace(/\s+/g, "").toUpperCase();
  return /^FR\d{2}[A-Z0-9]{23}$/.test(v) ? v : "";
}
// « Prénom Nom » → { first, last } (dernier mot = nom) ; sinon tout en nom.
export function splitPersonName(fullName: unknown, firstName?: unknown, lastName?: unknown) {
  const f = clean(firstName), l = clean(lastName);
  if (f || l) return { first: f, last: l };
  const parts = clean(fullName).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: "", last: parts[0] };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

export type ConnectPrefill = {
  profile: any; // Mon entreprise (kv_store « company-profile »)
  email?: string | null;
  firstName?: string | null; // profil de l'utilisateur (propriétaire)
  lastName?: string | null;
  organizationId: string;
  organizationName?: string | null;
};

export function buildConnectAccountParams({ profile, email, firstName, lastName, organizationId, organizationName }: ConnectPrefill) {
  const p = profile || {};
  const isIndividual = p.type === "particulier";
  const name = clean(p.name) || clean(organizationName);
  const address = {
    line1: clean(p.address) || undefined,
    postal_code: clean(p.postalCode) || undefined,
    city: clean(p.city) || undefined,
    country: "FR",
  };
  const phone = clean(p.phone) || undefined;
  const mail = clean(p.email) || clean(email) || undefined;
  const params: any = {
    country: "FR",
    email: mail,
    business_type: isIndividual ? "individual" : "company",
    business_profile: {
      name: name || undefined,
      // Code d'activité Stripe : entrepreneurs du bâtiment.
      mcc: "1520",
      product_description: "Travaux et prestations du bâtiment facturés à des clients",
      support_email: mail,
      support_phone: phone,
    },
    controller: {
      fees: { payer: "account" },
      losses: { payments: "stripe" },
      stripe_dashboard: { type: "full" },
      requirement_collection: "stripe",
    },
    metadata: { organizationId },
  };
  if (isIndividual) {
    const { first, last } = splitPersonName(name, firstName, lastName);
    params.individual = { first_name: first || undefined, last_name: last || undefined, email: mail, phone, address };
  } else {
    const siren = sirenOf(p.siret);
    params.company = { name: name || undefined, tax_id: siren || undefined, registration_number: siren || undefined, phone, address };
  }
  const iban = frenchIbanOf(p.iban);
  if (iban) {
    params.external_account = {
      object: "bank_account",
      country: "FR",
      currency: "eur",
      account_number: iban,
      account_holder_name: name || undefined,
      account_holder_type: isIndividual ? "individual" : "company",
    };
  }
  return params;
}

// Même objet sans les coordonnées bancaires (repli si Stripe refuse l'IBAN).
export function withoutBankAccount(params: any) {
  const { external_account: _ignored, ...rest } = params || {};
  return rest;
}
