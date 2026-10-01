import { defineConfig } from '@vite-pwa/assets-generator/config';

// Simgeler bir kez üretilip public/ altına kaydedilir:
//   npx pwa-assets-generator
// Maskable ve iPhone simgelerinde kenar boşluğu logo zemin rengiyle doldurulur.
const ZEMIN = '#1f3a5f';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    transparent: { sizes: [64, 192, 512], favicons: [[48, 'favicon.ico']] },
    maskable: { sizes: [512], padding: 0.3, resizeOptions: { background: ZEMIN } },
    apple: { sizes: [180], padding: 0.3, resizeOptions: { background: ZEMIN } },
  },
  images: ['public/logo.svg'],
});
