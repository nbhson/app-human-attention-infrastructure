/**
 * Real OIDC provider adapter (day-01 §2.3).
 *
 * A standards-compliant Authorization Code + PKCE exchange implemented with the
 * platform `fetch` — the IdP's `/.well-known/openid-configuration` is discovered
 * lazily (on first login, never at import), then the authorization page, token
 * exchange, and userinfo calls are driven from the discovered endpoints. No
 * vendor SDK is involved, so the harness supports any standards OIDC provider.
 *
 * IdP id_token verification is deliberately out of scope here: the token comes
 * from the provider's own token endpoint over TLS, and identity is asserted from
 * the provider's `userinfo` response keyed on a stable `sub`. (A hardened
 * installation may add JWKS id_token verification behind this same seam.)
 */

import type { OidcProvider, OidcTokenSet } from './provider.js';

/** Configuration for a real IdP integration. */
export interface OpenIdClientConfig {
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Extra scopes; `openid` is always included. */
  readonly scope?: string;
}

interface DiscoveryDocument {
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly userinfo_endpoint: string;
}

/** An {@link OidcProvider} driven by provider discovery + fetch. */
export class OpenIdClientProvider implements OidcProvider {
  private discovery: Promise<DiscoveryDocument> | null = null;
  private readonly scope: string;

  constructor(private readonly config: OpenIdClientConfig) {
    this.scope = config.scope ?? 'openid profile email';
  }

  private async discover(): Promise<DiscoveryDocument> {
    this.discovery ??= (async () => {
      const wellKnown = `${this.config.issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
      const res = await fetch(wellKnown);
      if (!res.ok) {
        throw new Error(`OIDC discovery failed: ${res.status} ${wellKnown}`);
      }
      return (await res.json()) as DiscoveryDocument;
    })();
    return this.discovery;
  }

  async getAuthorizationUrl(state: string, codeVerifier: string, redirectUri: string): Promise<string> {
    const doc = await this.discover();
    const url = new URL(doc.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', this.scope);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge_method', 'S256');
    // PKCE S256 challenge: base64url(SHA256(code_verifier)).
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
    url.searchParams.set('code_challenge', toBase64Url(digest));
    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<OidcTokenSet> {
    const doc = await this.discover();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    const res = await fetch(doc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw new Error(`token exchange failed: ${res.status}`);
    }
    const json = (await res.json()) as {
      access_token?: string;
      id_token?: string;
      expires_in?: number;
      refresh_token?: string;
    };
    return {
      accessToken: json.access_token as string,
      ...(json.id_token === undefined ? {} : { idToken: json.id_token }),
      ...(json.expires_in === undefined ? {} : { expiresIn: json.expires_in }),
      ...(json.refresh_token === undefined ? {} : { refreshToken: json.refresh_token }),
    };
  }

  async getUserInfo(accessToken: string): Promise<{ sub: string; email: string; name?: string }> {
    const doc = await this.discover();
    const res = await fetch(doc.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`userinfo failed: ${res.status}`);
    }
    const json = (await res.json()) as { sub?: string; email?: string; name?: string };
    if (!json.sub) {
      throw new Error('userinfo response is missing the stable sub claim');
    }
    return {
      sub: String(json.sub),
      email: String(json.email ?? ''),
      ...(json.name === undefined ? {} : { name: json.name }),
    };
  }
}

function toBase64Url(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
