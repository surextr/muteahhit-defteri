import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const TEMA = '#1f3a5f';

// base './' : GitHub Pages alt klasöründe (kullanici.github.io/repo/) de çalışsın diye
export default defineConfig({
  base: './',
  // turkiyeAdres (il/ilçe/mahalle) bilinçli olarak büyük ve ayrı bir parça; ilk kullanımda yüklenir.
  build: { chunkSizeWarningLimit: 1600 },
  plugins: [
    react(),
    VitePWA({
      // Yeni sürüm kendiliğinden devreye girmez; kullanıcıya "Güncelle" sorulur.
      registerType: 'prompt',
      // Simgeler zaten globPatterns ile önbelleğe girer; ikinci kez eklenmesin.
      includeManifestIcons: false,
      manifest: {
        id: './',
        name: 'Müteahhit Hesap Defteri',
        short_name: 'Hesap Defteri',
        description: 'Projelerin maliyet, borç, tahsilat ve kârını tek yerde takip edin.',
        lang: 'tr',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: TEMA,
        background_color: '#f5f6f8',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Uygulamanın bütün dosyaları önbelleğe alınır: internetsiz tam çalışma.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        cleanupOutdatedCaches: true,
        // İl/ilçe/mahalle listesi (~1,5 MB) da internetsiz çalışsın diye önbelleğe girer.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['./src/test-kurulumu.ts'],
  },
});
