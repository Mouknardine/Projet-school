import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/web', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' },
  },
});
