// storage-shim.js
// Ce fichier remplace le "window.storage" fourni par l'environnement Claude
// par une version qui fonctionne dans un navigateur normal, en utilisant
// le localStorage de ton ordinateur. À utiliser uniquement pour tester en
// local — un vrai produit en production doit utiliser une vraie base de
// données côté serveur, pas le localStorage du navigateur.

if (typeof window !== "undefined" && !window.storage) {
  const PREFIX = "devifact:";

  function fullKey(key, shared) {
    return PREFIX + (shared ? "shared:" : "user:") + key;
  }

  window.storage = {
    async get(key, shared = false) {
      const raw = localStorage.getItem(fullKey(key, shared));
      if (raw === null) {
        throw new Error(`Clé introuvable : ${key}`);
      }
      return { key, value: raw, shared };
    },

    async set(key, value, shared = false) {
      localStorage.setItem(fullKey(key, shared), value);
      return { key, value, shared };
    },

    async delete(key, shared = false) {
      const k = fullKey(key, shared);
      const existed = localStorage.getItem(k) !== null;
      localStorage.removeItem(k);
      return { key, deleted: existed, shared };
    },

    async list(prefix = "", shared = false) {
      const scope = fullKey("", shared);
      const keys = Object.keys(localStorage)
        .filter((k) => k.startsWith(scope + prefix))
        .map((k) => k.slice(scope.length));
      return { keys, prefix, shared };
    },
  };
}
