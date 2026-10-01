import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    // Dev-only proxy so the reviewed UI can hit the API without CORS. The
    // backend listens on :3000 (see apps/api/src/index.ts).
    // NOTE (WSL): the browser runs on Windows while Vite runs in WSL —
    // `host: 0.0.0.0` is required so Windows can reach the dev server.
    // `localhost` inside the proxy below is resolved from inside WSL,
    // where the API also runs, so it stays correct.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
