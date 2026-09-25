// storage-adapter.js — pont entre le stockage clé/valeur utilisé par
// l'application et la table kv_store en base.
//
// Les données appartiennent à l'ORGANISATION actuellement active,
// partagées entre tous ses membres. Cette organisation est définie
// explicitement par l'application (setActiveOrganization) après avoir
// déterminé, parmi toutes les organisations dont fait partie la
// personne connectée, laquelle est actuellement affichée — jamais
// devinée automatiquement ici, pour éviter tout mélange entre
// plusieurs organisations d'une même personne.
//
// Écritures concurrentes (deux membres, ou deux onglets, qui enregistrent
// le même jeu de documents) : chaque enregistrement n'écrase la ligne que
// si elle n'a pas changé depuis la dernière lecture (updated_at). Sinon,
// les deux versions sont FUSIONNÉES élément par élément puis CHAMP PAR
// CHAMP (voir mergeValues, mergeRecord) et le résultat est renvoyé à
// l'application, qui l'affiche. Un même champ modifié des deux côtés est
// tranché par la date de modification la plus récente, et le document porte
// une note de conflit (champ « conflict ») affichée dans l'éditeur.
// Les écritures d'une même clé sont mises en FILE D'ATTENTE (une à la fois,
// les demandes accumulées pendant une écriture sont fondues en une seule) :
// un onglet ne peut plus entrer en conflit avec lui-même.

import { db } from './client.js';

let activeOrgId = null;
// Dernière version connue de chaque clé : { value, updatedAt } — sert de
// base à la fusion et de condition d'écriture.
const baselines = new Map();

export function setActiveOrganization(orgId) {
  activeOrgId = orgId;
  baselines.clear();
}

export function getActiveOrganization() {
  return activeOrgId;
}

// À appeler à la déconnexion pour ne pas garder l'organisation d'un
// compte en mémoire au moment où un autre compte se connecte.
export function clearStorageCache() {
  activeOrgId = null;
  baselines.clear();
}

function requireOrganization() {
  if (!activeOrgId) throw new Error("Aucune organisation active — reconnecte-toi.");
  return activeOrgId;
}

const baselineKey = (key, shared) => `${shared ? "shared" : "org"}:${key}`;
const isIdList = (v) => Array.isArray(v) && v.every((x) => x && typeof x === "object" && x.id !== undefined);
const stamp = (x) => Number(x?.updatedAt) || 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Fusion à trois versions d'une liste d'objets à identifiant (documents,
// clients) : base = dernière version lue, local = ce que l'on veut
// enregistrer, remote = ce qui est en base maintenant (modifié par
// quelqu'un d'autre). Règles :
//   * ajouté d'un côté → gardé ;
//   * supprimé d'un côté et inchangé de l'autre → supprimé ;
//   * supprimé d'un côté mais modifié de l'autre → la modification gagne ;
//   * modifié des deux côtés → la version dont updatedAt est le plus récent.
// Sans base connue (première écriture de la session) : union, les
// versions locales gagnent sur les versions distantes du même élément.
// Valeur qui n'est pas une liste à identifiants : la version locale gagne.
// Paiements reçus d'un document modifié des deux côtés (par exemple un
// paiement en ligne enregistré par le serveur pendant qu'un membre modifiait
// la facture) : un paiement ajouté d'un côté depuis la base n'est jamais
// perdu, quelle que soit la version qui gagne ; le statut « payée » posé par
// l'autre version est conservé si tous ses paiements sont bien repris.
function mergePayments(winner, l, r, b) {
  const lp = Array.isArray(l?.payments) ? l.payments : null;
  const rp = Array.isArray(r?.payments) ? r.payments : null;
  if (!lp && !rp) return winner;
  const baseIds = new Set((Array.isArray(b?.payments) ? b.payments : []).map((p) => p?.id));
  const out = Array.isArray(winner.payments) ? [...winner.payments] : [];
  const have = new Set(out.map((p) => p?.id));
  for (const p of [...(lp || []), ...(rp || [])]) {
    if (p && p.id !== undefined && !have.has(p.id) && !baseIds.has(p.id)) { out.push(p); have.add(p.id); }
  }
  let merged = out.length === (Array.isArray(winner.payments) ? winner.payments.length : 0) ? winner : { ...winner, payments: out };
  const other = winner === l ? r : winner === r ? l : (stamp(l) >= stamp(r) ? r : l);
  if (other?.status === "payée" && merged.status !== "payée" && (other.payments || []).every((p) => have.has(p?.id))) {
    merged = { ...merged, status: "payée", paidAt: other.paidAt || merged.paidAt || null };
  }
  // Inversement, un statut « payée » posé d'un seul côté n'est gardé que si
  // tous les paiements de ce côté sont bien dans la liste fusionnée (sinon
  // la facture n'est pas réellement réglée) : retour au statut de l'autre côté.
  const payeeSide = l?.status === "payée" && r?.status !== "payée" ? { self: l, opp: r } : r?.status === "payée" && l?.status !== "payée" ? { self: r, opp: l } : null;
  if (payeeSide && merged.status === "payée" && !(payeeSide.self.payments || []).every((p) => have.has(p?.id))) {
    merged = { ...merged, status: payeeSide.opp?.status || "envoyée", paidAt: payeeSide.opp?.paidAt ?? null, paidTotal: payeeSide.opp?.paidTotal ?? null };
  }
  return merged;
}

// Document modifié des deux côtés dont l'autre version vient d'être signée
// par le client (lien public, pendant que l'artisan retouchait le devis) :
// la signature, le statut « signé » et les options retenues ne se perdent
// jamais, quelle que soit la version qui gagne. Le suivi des relances
// (écrit par le serveur) garde la date la plus récente.
function mergeSignature(winner, l, r) {
  const other = winner === l ? r : winner === r ? l : (stamp(l) >= stamp(r) ? r : l);
  let merged = winner;
  if (other?.status === "signé" && other.signature && typeof other.signature === "object" && merged.status !== "signé") {
    const accepted = new Map((Array.isArray(other.items) ? other.items : []).filter((it) => it && it.type === "line" && it.optional === true).map((it) => [it.id, it.optionAccepted]));
    const items = Array.isArray(merged.items) ? merged.items.map((it) => (it && it.type === "line" && it.optional === true && accepted.has(it.id) ? { ...it, optionAccepted: accepted.get(it.id) } : it)) : merged.items;
    merged = { ...merged, status: "signé", signature: other.signature, ...(items !== undefined ? { items } : {}) };
  }
  const lr = Number(l?.lastReminderSentAt) || 0, rr = Number(r?.lastReminderSentAt) || 0;
  if (Math.max(lr, rr) > (Number(merged.lastReminderSentAt) || 0)) merged = { ...merged, lastReminderSentAt: Math.max(lr, rr) };
  return merged;
}
const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
// Valeur objet (fiche entreprise…) modifiée des deux côtés : fusion champ
// par champ — un champ inchangé localement depuis la base prend la version
// distante (l'IBAN saisi par le propriétaire pendant qu'un éditeur changeait
// le téléphone n'est plus écrasé) ; un champ modifié ici garde sa valeur ;
// une liste à identifiants (attestations) est fusionnée comme les documents.
function mergeObjects(base, local, remote) {
  const out = { ...remote };
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const lv = local[key], rv = remote[key], bv = base ? base[key] : undefined;
    if (!(key in local)) { if (key in base) delete out[key]; continue; } // retiré localement (présent en base) ; ajouté à distance sinon
    if (same(lv, bv)) continue; // inchangé ici : version distante
    out[key] = isIdList(lv) && isIdList(rv) ? mergeValues(bv, lv, rv) : lv;
  }
  return out;
}

// Élément (document, client, créneau, tâche) modifié des deux côtés depuis
// la base : fusion champ par champ. Un champ modifié d'un seul côté est
// gardé ; les lignes (items) sont fusionnées par identifiant ; un même champ
// ou une même ligne modifiés des deux côtés sont tranchés par la date de
// modification la plus récente, et le conflit est noté sur l'élément
// (champ « conflict » : quand, quels champs, qui a gagné, qui d'autre a
// écrit) quand c'est un document.
const isItemList = (v) => Array.isArray(v) && v.every((x) => x && typeof x === "object" && x.id !== undefined);
function mergeItems(b, l, r, localWins, conflicts) {
  const bList = isItemList(b) ? b : [], L = new Map(l.map((x) => [x.id, x])), R = new Map(r.map((x) => [x.id, x])), B = new Map(bList.map((x) => [x.id, x]));
  const order = [];
  const seen = new Set();
  for (const x of [...(localWins ? l : r), ...(localWins ? r : l)]) if (!seen.has(x.id)) { seen.add(x.id); order.push(x.id); }
  const out = [];
  for (const id of order) {
    const lv = L.get(id), rv = R.get(id), bv = B.get(id);
    if (lv && rv) {
      if (same(lv, rv) || !bv) { out.push(localWins ? lv : rv); if (bv === undefined && !same(lv, rv)) conflicts.push(`ligne ${lv.designation || rv.designation || id}`); continue; }
      const lChanged = !same(lv, bv), rChanged = !same(rv, bv);
      if (lChanged && rChanged) { out.push(localWins ? lv : rv); conflicts.push(`ligne ${(localWins ? lv : rv).designation || id}`); }
      else out.push(lChanged ? lv : rv);
    } else if (lv && !rv) { if (!bv || !same(lv, bv)) out.push(lv); } // supprimée à distance, sauf si modifiée ici
    else if (!lv && rv) { if (!bv || !same(rv, bv)) out.push(rv); }
  }
  return out;
}
export function mergeRecord(b, l, r, remoteWriter = null) {
  if (!isPlainObject(b) || !isPlainObject(l) || !isPlainObject(r)) return stamp(r) > stamp(l) ? r : l;
  const localWins = stamp(l) >= stamp(r);
  const conflicts = [];
  const out = {};
  for (const key of new Set([...Object.keys(l), ...Object.keys(r)])) {
    if (key === "conflict" || key === "updatedAt") continue;
    const lv = l[key], rv = r[key], bv = b[key];
    const inL = key in l, inR = key in r;
    if (inL && inR && same(lv, rv)) { out[key] = lv; continue; }
    const lChanged = !inL ? key in b : !same(lv, bv);
    const rChanged = !inR ? key in b : !same(rv, bv);
    if (lChanged && !rChanged) { if (inL) out[key] = lv; continue; }
    if (rChanged && !lChanged) { if (inR) out[key] = rv; continue; }
    if (!lChanged && !rChanged) { if (inL) out[key] = lv; else if (inR) out[key] = rv; continue; }
    // Modifié des deux côtés, différemment.
    if (key === "items" && isItemList(lv) && isItemList(rv)) { out[key] = mergeItems(bv, lv, rv, localWins, conflicts); continue; }
    if (key === "payments" || key === "signature" || key === "lastReminderSentAt") { out[key] = localWins ? lv : rv; continue; } // repris ensuite par mergePayments / mergeSignature
    const winner = localWins ? l : r;
    if (key in winner) out[key] = winner[key]; else delete out[key];
    conflicts.push(key);
  }
  out.updatedAt = Math.max(stamp(l), stamp(r)) || l.updatedAt || r.updatedAt;
  const previousConflict = (localWins ? l : r).conflict;
  if (conflicts.length && (typeof l.type === "string" || typeof r.type === "string")) {
    out.conflict = { at: Date.now(), fields: [...new Set(conflicts)], kept: localWins ? "local" : "remote", otherUpdatedAt: localWins ? stamp(r) : stamp(l), otherWriter: localWins ? remoteWriter || null : null };
  } else if (previousConflict) out.conflict = previousConflict;
  return out;
}

export function mergeValues(base, local, remote, remoteWriter = null) {
  if (isPlainObject(local) && isPlainObject(remote) && isPlainObject(base)) return mergeObjects(base, local, remote);
  if (!isIdList(local) || !isIdList(remote)) return local;
  const byId = (list) => new Map(list.map((x) => [x.id, x]));
  const B = isIdList(base) ? byId(base) : null;
  const L = byId(local), R = byId(remote);
  const order = [];
  const seen = new Set();
  for (const x of [...local, ...remote]) if (!seen.has(x.id)) { seen.add(x.id); order.push(x.id); }
  const out = [];
  for (const id of order) {
    const l = L.get(id), r = R.get(id), b = B ? B.get(id) : undefined;
    if (!B) { out.push(l || r); continue; }
    if (l && r) {
      const lChanged = !b || !same(l, b), rChanged = !b || !same(r, b);
      if (lChanged && rChanged && !same(l, r)) out.push(mergeSignature(mergePayments(mergeRecord(b, l, r, remoteWriter), l, r, b), l, r));
      else out.push(lChanged ? l : r);
    } else if (l && !r) {
      // absent en base : supprimé à distance, sauf si modifié localement depuis la base
      if (!b || !same(l, b)) out.push(l);
    } else if (!l && r) {
      // absent localement : supprimé ici, sauf si modifié à distance depuis la base
      if (!b || !same(r, b)) out.push(r);
    }
  }
  return out;
}

// Écritures en attente par clé (voir set) ; les écritures d'une clé sont
// exécutées l'une après l'autre, jamais en parallèle.
const queues = new Map();
let storageApi = null;
async function drainQueue(q, key, shared) {
  while (q.pending) {
    const job = q.pending;
    q.pending = null;
    try {
      const res = await storageApi.setNow(key, job.value, shared); // l'objet de CE module (pas la variable globale, qu'un autre onglet de test peut remplacer)
      for (const w of job.waiters) w.resolve(res);
    } catch (err) {
      for (const w of job.waiters) w.reject(err);
    }
  }
  q.running = false;
}
export function pendingWrites() { return [...queues.values()].filter((q) => q.running || q.pending).length; }

async function readRow(orgId, key, shared) {
  let query = db.from('kv_store').select('value, updated_at, created_by').eq('key', key).eq('shared', shared);
  query = shared ? query : query.eq('organization_id', orgId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

if (typeof window !== "undefined") {
  window.storage = {
    async get(key, shared = false) {
      const orgId = requireOrganization();
      const row = await readRow(orgId, key, shared);
      if (!row) {
        // Code explicite pour distinguer "clé jamais enregistrée" d'une
        // vraie erreur réseau (voir loadUserData côté application).
        const notFound = new Error(`Clé introuvable : ${key}`);
        notFound.code = "KEY_NOT_FOUND";
        throw notFound;
      }
      baselines.set(baselineKey(key, shared), { value: row.value, updatedAt: row.updated_at || null });
      return { key, value: JSON.stringify(row.value), shared };
    },

    // Renvoie { key, value, shared, merged } : merged = true quand la valeur
    // enregistrée n'est pas celle demandée (fusion avec des changements
    // faits ailleurs) — l'application doit alors reprendre `value`.
    // File d'attente par clé : une écriture à la fois ; les demandes reçues
    // pendant une écriture sont fondues en une seule (la dernière valeur,
    // qui contient déjà les précédentes), et tous les appelants reçoivent
    // le même résultat.
    set(key, value, shared = false) {
      const bk = baselineKey(key, shared);
      let q = queues.get(bk);
      if (!q) { q = { running: false, pending: null }; queues.set(bk, q); }
      return new Promise((resolve, reject) => {
        if (q.pending) { q.pending.value = value; q.pending.waiters.push({ resolve, reject }); }
        else q.pending = { value, waiters: [{ resolve, reject }] };
        if (!q.running) { q.running = true; drainQueue(q, key, shared); }
      });
    },

    async setNow(key, value, shared = false) {
      const orgId = requireOrganization();
      const { data: { user } } = await db.auth.getUser();
      const bk = baselineKey(key, shared);
      let toWrite = JSON.parse(value);
      let merged = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        const base = baselines.get(bk);
        if (base && base.updatedAt) {
          // Écriture conditionnelle : seulement si personne n'a écrit entre-temps.
          const now = new Date().toISOString();
          let query = db.from('kv_store').update({ value: toWrite, created_by: user?.id || null, updated_at: now })
            .eq('key', key).eq('shared', shared).eq('updated_at', base.updatedAt);
          query = shared ? query : query.eq('organization_id', orgId);
          const { data, error } = await query.select('updated_at');
          if (error) throw error;
          if (data && data.length === 1) {
            baselines.set(bk, { value: toWrite, updatedAt: data[0].updated_at || now });
            return { key, value: JSON.stringify(toWrite), shared, merged };
          }
          // Quelqu'un a écrit entre-temps : relire, fusionner, réessayer.
          const current = await readRow(orgId, key, shared);
          if (current) {
            toWrite = mergeValues(base.value, toWrite, current.value, current.created_by || null);
            merged = true;
            baselines.set(bk, { value: current.value, updatedAt: current.updated_at || null });
            continue;
          }
          baselines.delete(bk); // ligne disparue : recréée ci-dessous
        }
        // Première écriture de la session (ou ligne absente) : on regarde
        // d'abord ce qui existe pour ne rien écraser à l'aveugle.
        const existing = base && base.updatedAt ? null : await readRow(orgId, key, shared);
        if (existing) {
          const union = mergeValues(null, toWrite, existing.value, existing.created_by || null);
          if (!same(union, toWrite)) { toWrite = union; merged = true; }
          baselines.set(bk, { value: existing.value, updatedAt: existing.updated_at || null });
          continue; // repasse par l'écriture conditionnelle
        }
        const { data, error } = await db.from('kv_store').upsert({
          organization_id: orgId,
          created_by: user?.id || null,
          key,
          value: toWrite,
          shared,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'organization_id,key,shared' }).select('updated_at');
        if (error) throw error;
        baselines.set(bk, { value: toWrite, updatedAt: data?.[0]?.updated_at || null });
        return { key, value: JSON.stringify(toWrite), shared, merged };
      }
      throw new Error(`Enregistrement de « ${key} » impossible : trop de modifications simultanées, réessaie.`);
    },

    async delete(key, shared = false) {
      const orgId = requireOrganization();
      const { error } = await db.from('kv_store').delete().eq('organization_id', orgId).eq('key', key).eq('shared', shared);
      if (error) throw error;
      baselines.delete(baselineKey(key, shared));
      return { key, deleted: true, shared };
    },

    async list(prefix = "", shared = false) {
      const orgId = requireOrganization();
      let query = db.from('kv_store').select('key').eq('shared', shared).like('key', `${prefix}%`);
      query = shared ? query : query.eq('organization_id', orgId);

      const { data, error } = await query;
      if (error) throw error;
      return { keys: (data || []).map((row) => row.key), prefix, shared };
    },
  };
  storageApi = window.storage;
}
