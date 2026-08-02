// storage-adapter-supabase.js
// Remplace le stockage temporaire (localStorage) par une vraie base de
// données Supabase. Reproduit exactement la même interface window.storage
// que l'application utilise déjà — aucune modification du code de
// createur/tableau de bord/clients/prestations n'est nécessaire.
//
// IMPORTANT : ce fichier doit être importé APRÈS que l'utilisateur soit
// connecté (un utilisateur non connecté n'a accès à aucune donnée,
// c'est voulu — voir les règles de sécurité dans schema.sql).

import { supabase } from './supabase-client.js';

if (typeof window !== "undefined") {
  window.storage = {
    async get(key, shared = false) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non connecté");

      let query = supabase.from('kv_store').select('value').eq('key', key).eq('shared', shared);
      query = shared ? query : query.eq('user_id', user.id);

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`Clé introuvable : ${key}`);
      return { key, value: JSON.stringify(data.value), shared };
    },

    async set(key, value, shared = false) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non connecté");

      const { error } = await supabase.from('kv_store').upsert({
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non connecté");

      const { error } = await supabase.from('kv_store').delete().eq('user_id', user.id).eq('key', key).eq('shared', shared);
      if (error) throw error;
      return { key, deleted: true, shared };
    },

    async list(prefix = "", shared = false) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non connecté");

      let query = supabase.from('kv_store').select('key').eq('shared', shared).like('key', `${prefix}%`);
      query = shared ? query : query.eq('user_id', user.id);

      const { data, error } = await query;
      if (error) throw error;
      return { keys: (data || []).map((row) => row.key), prefix, shared };
    },
  };
}
