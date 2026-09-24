import { defineConfig } from 'vite'
   import react from '@vitejs/plugin-react'
   import tailwindcss from '@tailwindcss/vite'
   import { VitePWA } from 'vite-plugin-pwa'

   export default defineConfig(({ mode }) => ({
     // Tests (Vitest) : les rendus complets des éditeurs dépassent parfois les
     // 5 s par défaut sur une machine chargée ; même délai que les tests qui le
     // précisaient déjà un par un.
     test: { testTimeout: 30000 },
     // Production : plus aucun console.* dans le code livré (les journaux de
     // développement peuvent contenir des données personnelles ou des jetons).
     esbuild: mode === "production" ? { drop: ["console", "debugger"] } : {},
     plugins: [
       react(),
       tailwindcss(),
       VitePWA({
         registerType: 'autoUpdate',
         // Le bundle principal dépasse la limite par défaut de 2 Mio du
         // cache hors ligne (Workbox) depuis l'onglet Comptabilité ; sans
         // cette limite relevée, le build échoue et le fichier ne serait
         // plus mis en cache.
         workbox: { maximumFileSizeToCacheInBytes: 3 * 1024 * 1024 },
         manifest: {
           name: 'DeviFact',
           short_name: 'DeviFact',
           description: 'Devis et factures pour artisans',
           theme_color: '#1B2A33',
           background_color: '#E9EEEA',
           display: 'standalone',
           icons: [
             { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
             { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
           ]
         }
       })
     ],
   }))
