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
// les deux versions sont FUSIONNÉES élément par élément (voir
// mergeValues) et le résultat est renvoyé à l'application, qui l'affiche.
// Avant, le dernier à enregistrer écrasait silencieusement le travail de
// l'autre.

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
  if (out.length === (Array.isArray(winner.payments) ? winner.payments.length : 0)) return winner;
  const merged = { ...winner, payments: out };
  const other = winner === l ? r : l;
  if (other?.status === "payée" && merged.status !== "payée" && (other.payments || []).every((p) => have.has(p?.id))) {
    merged.status = "payée";
    merged.paidAt = other.paidAt || merged.paidAt || null;
  }
  return merged;
}

export function mergeValues(base, local, remote) {
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
      if (lChanged && rChanged && !same(l, r)) out.push(mergePayments(stamp(r) > stamp(l) ? r : l, l, r, b));
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

async function readRow(orgId, key, shared) {
  let query = db.from('kv_store').select('value, updated_at').eq('key', key).eq('shared', shared);
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
    async set(key, value, shared = false) {
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
            toWrite = mergeValues(base.value, toWrite, current.value);
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
          const union = mergeValues(null, toWrite, existing.value);
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
}
