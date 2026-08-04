// storage-adapter.js — pont entre le stockage clé/valeur utilisé par
// l'application et la table kv_store en base.
//
// Depuis le passage au multi-utilisateurs, les données appartiennent
// à l'ORGANISATION du compte connecté (partagées entre tous ses
// membres), plus à l'utilisateur individuel — d'où la résolution de
// l'organisation avant chaque opération.

import { db } from './client.js';

let cachedOrgId = null;
let cachedOrgUserId = null;

async function getOrganizationId() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Non connecté");

  if (cachedOrgId && cachedOrgUserId === user.id) return cachedOrgId;

  const { data, error } = await db
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Aucune organisation trouvée pour ce compte");

  cachedOrgId = data.organization_id;
  cachedOrgUserId = user.id;
  return cachedOrgId;
}

// À appeler à la déconnexion pour ne pas garder l'organisation d'un
// compte en mémoire au moment où un autre compte se connecte.
export function clearStorageCache() {
  cachedOrgId = null;
  cachedOrgUserId = null;
}

if (typeof window !== "undefined") {
  window.storage = {
    async get(key, shared = false) {
      const orgId = await getOrganizationId();
      let query = db.from('kv_store').select('value').eq('key', key).eq('shared', shared);
      query = shared ? query : query.eq('organization_id', orgId);

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`Clé introuvable : ${key}`);
      return { key, value: JSON.stringify(data.value), shared };
    },

    async set(key, value, shared = false) {
      const orgId = await getOrganizationId();
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
      const orgId = await getOrganizationId();
      const { error } = await db.from('kv_store').delete().eq('organization_id', orgId).eq('key', key).eq('shared', shared);
      if (error) throw error;
      return { key, deleted: true, shared };
    },

    async list(prefix = "", shared = false) {
      const orgId = await getOrganizationId();
      let query = db.from('kv_store').select('key').eq('shared', shared).like('key', `${prefix}%`);
      query = shared ? query : query.eq('organization_id', orgId);

      const { data, error } = await query;
      if (error) throw error;
      return { keys: (data || []).map((row) => row.key), prefix, shared };
    },
  };
}
