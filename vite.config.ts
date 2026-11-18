import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.OC_URL ?? 'http://127.0.0.1:4096';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/oc': {
        target,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/oc/, ''),
      },
    },
  },
  build: { outDir: 'dist' },
});
