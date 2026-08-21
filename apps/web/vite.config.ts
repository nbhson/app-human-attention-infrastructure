import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev-only proxy so the reviewed UI can hit the API without CORS. The
    // backend listens on :3000 (see apps/api/src/index.ts).
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
