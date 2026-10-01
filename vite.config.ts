import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' : GitHub Pages alt klasöründe (kullanici.github.io/repo/) de çalışsın diye
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['./src/test-kurulumu.ts'],
  },
});
