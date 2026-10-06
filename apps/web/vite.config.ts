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
      // Object form (not the string shorthand) on purpose:
      // - `changeOrigin: true` keeps the shorthand's behaviour (Host rewritten
      //   to the API target).
      // - `xfwd: true` makes the proxy add `x-forwarded-host/proto` carrying
      //   the *browser-facing* host (e.g. `192.168.x.x:5174` for a LAN client).
      //   The API's mock-OIDC login (`GET /api/auth/login`, see
      //   `apps/api/src/routes/auth.ts`) reads those headers to build a
      //   callback URL the browser can actually reach. Without them the API
      //   only sees `Host: localhost:3000` and 302s the browser to
      //   `http://localhost:3000/...` — which from a LAN machine resolves to
      //   itself, so login never completes and `/api/reviews` stays 401.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
});
