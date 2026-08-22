/**
 * OIDC provider boundary (day-01 §2.3).
 *
 * The harness never hard-codes a specific IdP (Keycloak/Auth0/Okta/…). It talks
 * to the Authorization Code + PKCE flow behind this thin interface, so the IdP
 * is a config concern, not a code concern. `getAuthorizationUrl` is
 * synchronous so the login route can redirect immediately; the token/userinfo
 * steps are async.
 */

/** The minimal, provider-agnostic token set a code exchange yields. */
export interface OidcTokenSet {
  readonly accessToken: string;
  /** Present when the provider returns it; used to fetch userinfo. */
  readonly idToken?: string;
  readonly expiresIn?: number;
  readonly refreshToken?: string;
}

/** The OIDC provider seam. */
export interface OidcProvider {
  /** Build the IdP authorization URL (Authorization Code + PKCE). Async because the real adapter discovers the issuer lazily. */
  getAuthorizationUrl(state: string, codeVerifier: string, redirectUri: string): Promise<string>;
  /** Exchange an authorization `code` for a token set, proving the code. */
  exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<OidcTokenSet>;
  /** Fetch the stable subject + display claims for an access token. */
  getUserInfo(accessToken: string): Promise<{ sub: string; email: string; name?: string }>;
}
