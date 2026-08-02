import { defineConfig } from 'vite'
   import react from '@vitejs/plugin-react'
   import tailwindcss from '@tailwindcss/vite'
   import { VitePWA } from 'vite-plugin-pwa'

   export default defineConfig({
     plugins: [
       react(),
       tailwindcss(),
       VitePWA({
         registerType: 'autoUpdate',
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
   })