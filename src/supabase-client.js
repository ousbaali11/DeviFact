// supabase-client.js
// Connexion à ta base de données Supabase réelle.
// Les deux valeurs ci-dessous viennent de ton projet Supabase :
// Dashboard Supabase → Project Settings → API
//
// Elles doivent être placées dans un fichier .env à la racine de ton
// projet (jamais directement écrites ici, pour ne pas les publier par erreur) :
//
//   VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
//
// La "clé anonyme" (anon key) n'est PAS secrète — elle est prévue pour
// être utilisée côté navigateur, la sécurité réelle vient des règles
// RLS définies dans schema.sql, pas de cette clé.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "Configuration Supabase manquante. Crée un fichier .env à la racine du projet avec VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (voir le Guide de déploiement)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
