// storage-adapter.js — pont entre le stockage clé/valeur utilisé par
// l'application et la table kv_store en base.

import { db } from './client.js';

if (typeof window !== "undefined") {
  window.storage = {
    async get(key, shared = false) {
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Non connecté");

      let query = db.from('kv_store').select('value').eq('key', key).eq('shared', shared);
      query = shared ? query : query.eq('user_id', user.id);

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`Clé introuvable : ${key}`);
      return { key, value: JSON.stringify(data.value), shared };
    },

    async set(key, value, shared = false) {
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Non connecté");

      const { error } = await db.from('kv_store').upsert({
        user_id: user.id,
        key,
        value: JSON.parse(value),
        shared,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,key,shared' });

      if (error) throw error;
      return { key, value, shared };
    },

    async delete(key, shared = false) {
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Non connecté");

      const { error } = await db.from('kv_store').delete().eq('user_id', user.id).eq('key', key).eq('shared', shared);
      if (error) throw error;
      return { key, deleted: true, shared };
    },

    async list(prefix = "", shared = false) {
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Non connecté");

      let query = db.from('kv_store').select('key').eq('shared', shared).like('key', `${prefix}%`);
      query = shared ? query : query.eq('user_id', user.id);

      const { data, error } = await query;
      if (error) throw error;
      return { keys: (data || []).map((row) => row.key), prefix, shared };
    },
  };
}
