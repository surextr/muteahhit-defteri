import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const TEMA = '#1f3a5f';

// Yayın: https://muteahhit.surex.tr (cPanel). base './' : alt klasöre konsa da çalışsın diye.
// API aynı adreste /api/ (sunucu/api, PHP). Bilgisayarda denerken /api/ istekleri canlı sunucuya gider;
// yerel PHP sunucusuyla denemek için: API_HEDEF=http://127.0.0.1:8090 npm run dev
const API_HEDEF = process.env.API_HEDEF ?? 'https://muteahhit.surex.tr';
const API_SUNUCUSU = { '/api': { target: API_HEDEF, changeOrigin: true, secure: API_HEDEF.startsWith('https') } };

export default defineConfig({
  base: './',
  server: { proxy: API_SUNUCUSU },
  preview: { proxy: API_SUNUCUSU },
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
        // Telefonda "Paylaş" menüsünde görünür (WhatsApp, galeri…); dosyalar onay havuzuna düşer (public/paylas-sw.js).
        share_target: {
          action: './paylas',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { files: [{ name: 'dosyalar', accept: ['image/*', 'application/pdf', 'application/xml', 'text/xml', '.pdf', '.xml'] }] },
        },
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Uygulamanın bütün dosyaları önbelleğe alınır: internetsiz tam çalışma.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,webmanifest}'],
        // Paylaş menüsünden gelen dosyaları karşılar (önce o çalışır; diğer istekler Workbox'a kalır).
        importScripts: ['paylas-sw.js', 'bildirim-sw.js'],
        cleanupOutdatedCaches: true,
        // E-postadaki onay bağlantısı (/api/?islem=onay) sayfa olarak açılır; service worker onu uygulamaya çevirmesin.
        navigateFallbackDenylist: [/\/api\//, /\/gizlilik\.html$/, /\/depolama-testi\.html$/],
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
