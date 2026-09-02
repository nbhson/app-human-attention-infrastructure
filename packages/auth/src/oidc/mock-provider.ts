/**
 * Mock OIDC provider (day-01 §3.5, day-05 demo).
 *
 * A deterministic stand-in used by unit tests and the local Week-1 demo. It
 * implements the real Authorization-Code exchange shape — `getAuthorizationUrl`
 * returns a URL that, when "followed", lands on the app's own callback with a
 * redeemable `code` — so the demo exercises the full redirect → code → userinfo
 * → upsert → session path, and never a fake cookie that skips the exchange.
 *
 * Not a security boundary: this provider trusts any code. It is only live when
 * `OIDC_MOCK=true` (or in a test), never for a real installation.
 */

import type { OidcProvider, OidcTokenSet } from './provider.js';

/** Canned claims the mock returns; env-overridable so a demo can vary identity. */
export interface MockOidcConfig {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
}

/** Best-effort defaults; low-priority, the demo sets these explicitly. */
export function mockOidcConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MockOidcConfig {
  return {
    sub: env.MOCK_OIDC_SUB ?? 'mock|local-user',
    email: env.MOCK_OIDC_EMAIL ?? 'local@example.com',
    name: env.MOCK_OIDC_NAME ?? 'Local Reviewer',
  };
}

/** A mock {@link OidcProvider} issuing one redeemable code per login. */
export class MockOidcProvider implements OidcProvider {
  private counter = 0;

  constructor(private readonly config: MockOidcConfig = mockOidcConfigFromEnv()) {}

  /** The session-cookie/JWT identity a redeemed mock login yields. */
  get userInfo(): { sub: string; email: string; name: string } {
    return this.config;
  }

  async getAuthorizationUrl(state: string, codeVerifier: string, redirectUri: string): Promise<string> {
    void codeVerifier;
    this.counter += 1;
    // A self-callback: following the redirect "completes" the mock login.
    const url = new URL(redirectUri);
    url.searchParams.set('code', `mock-code-${this.counter}`);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<OidcTokenSet> {
    void codeVerifier;
    void redirectUri;
    // Any mock code from this provider's login URL is redeemable.
    if (!code.startsWith('mock-code')) {
      throw new Error(`unknown mock authorization code: ${code}`);
    }
    return { accessToken: `mock-access-${Date.now()}`, idToken: `mock-id-${Date.now()}` };
  }

  async getUserInfo(accessToken: string): Promise<{ sub: string; email: string; name: string }> {
    void accessToken;
    return this.config;
  }
}
