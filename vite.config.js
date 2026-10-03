import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Served from GitHub Pages at /NUTRIHUB/, so the app, its manifest and
// its service worker all live under that path.
const BASE = '/NUTRIHUB/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A new version waits until the app says it's safe (or the user taps
      // "Update"); see src/pwa.js. The app registers the worker itself.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Home & Nutri Hub',
        short_name: 'NutriHub',
        description: 'Shared meal planning, groceries and expense tracking for Irene & Akbar.',
        lang: 'en',
        start_url: BASE,
        scope: BASE,
        // Opens like an app: full screen, no browser bar.
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#121316',
        theme_color: '#121316',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app itself (HTML, JS, CSS, icons) is kept on the phone so it
        // opens without signal. Supabase data isn't cached here; the app
        // keeps its own copy of the last loaded lists.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: `${BASE}index.html`,
        // Reloads pages from versions that can't update themselves.
        importScripts: ['sw-update.js'],
        // The Excel library is big and only used for import/export.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
})
