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

import { db } from './client.js';

let activeOrgId = null;

export function setActiveOrganization(orgId) {
  activeOrgId = orgId;
}

export function getActiveOrganization() {
  return activeOrgId;
}

// À appeler à la déconnexion pour ne pas garder l'organisation d'un
// compte en mémoire au moment où un autre compte se connecte.
export function clearStorageCache() {
  activeOrgId = null;
}

function requireOrganization() {
  if (!activeOrgId) throw new Error("Aucune organisation active — reconnecte-toi.");
  return activeOrgId;
}

if (typeof window !== "undefined") {
  window.storage = {
    async get(key, shared = false) {
      const orgId = requireOrganization();
      let query = db.from('kv_store').select('value').eq('key', key).eq('shared', shared);
      query = shared ? query : query.eq('organization_id', orgId);

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`Clé introuvable : ${key}`);
      return { key, value: JSON.stringify(data.value), shared };
    },

    async set(key, value, shared = false) {
      const orgId = requireOrganization();
      const { data: { user } } = await db.auth.getUser();

      const { error } = await db.from('kv_store').upsert({
        organization_id: orgId,
        created_by: user?.id || null,
        key,
        value: JSON.parse(value),
        shared,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,key,shared' });

      if (error) throw error;
      return { key, value, shared };
    },

    async delete(key, shared = false) {
      const orgId = requireOrganization();
      const { error } = await db.from('kv_store').delete().eq('organization_id', orgId).eq('key', key).eq('shared', shared);
      if (error) throw error;
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
