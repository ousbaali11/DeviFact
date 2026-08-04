// client.js — connexion à la base de données.

import { createClient } from '@supabase/supabase-js';

const dbUrl = import.meta.env.VITE_DB_URL;
const dbAnonKey = import.meta.env.VITE_DB_KEY;

if (!dbUrl || !dbAnonKey) {
  console.error("Configuration manquante : ajoute VITE_DB_URL et VITE_DB_KEY dans .env");
}

export const db = createClient(dbUrl, dbAnonKey);
