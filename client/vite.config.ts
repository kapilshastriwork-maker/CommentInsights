import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const BACKEND_PORT = process.env.PORT || 4000;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
