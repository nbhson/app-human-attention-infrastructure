/**
 * Shared typed HTTP client for every `api/*.ts` client module.
 *
 * One implementation of the cross-cutting concerns that used to be
 * copy-pasted six times:
 *
 * - `credentials: 'include'` on EVERY request — the JWT/sid session cookie is
 *   same-site; LAN/direct-call origins (the scenario the login flow already
 *   handles) silently drop cookies without this.
 * - Non-JSON bodies (gateway 502 HTML, aborted responses) are normalized to an
 *   `HttpApiError` instead of a raw `SyntaxError` from `response.json()`.
 * - API error payloads `{ error }` surface their message; otherwise the status
 *   code travels so the UI can branch on it (409 claim conflict, 400 gate, …).
 *
 * Modules that need a domain error class (e.g. `ReviewsApiError`) pass an
 * `toError` factory to keep their own class; `instanceof` checks in pages keep
 * working unchanged.
 */

/** An API failure carrying a status code so the UI can branch on it. */
export class HttpApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpApiError';
  }
}

function toHttpApiError(status: number, message: string): HttpApiError {
  return new HttpApiError(status, message);
}

export async function parseResponse<T>(
  responseOrPromise: Response | Promise<Response>,
  toError: (status: number, message: string) => Error,
): Promise<T> {
  const response = await responseOrPromise;
  let body: { error?: string };
  try {
    body = (await response.json()) as { error?: string };
  } catch {
    throw toError(response.status || 0, `request failed (${response.status || 'network'}) — non-JSON response`);
  }
  if (!response.ok) {
    throw toError(response.status, body.error ?? `request failed (${response.status})`);
  }
  return body as T;
}

/** `fetch` + parse with `credentials: 'include'` and non-JSON hardening. */
export function requestJson<T>(
  url: string,
  init: RequestInit = {},
  toError?: (status: number, message: string) => Error,
): Promise<T> {
  return parseResponse<T>(fetch(url, { credentials: 'include', ...init }), toError ?? toHttpApiError);
}

/** Convenience GET over `requestJson` (query building stays at the call site). */
export function getJson<T>(url: string, toError?: (status: number, message: string) => Error): Promise<T> {
  return requestJson<T>(url, {}, toError);
}

/** JSON-body POST over `requestJson` (content-type + encode handled here). */
export function postJson<T>(
  url: string,
  body: unknown,
  toError?: (status: number, message: string) => Error,
): Promise<T> {
  return requestJson<T>(
    url,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    toError,
  );
}

/** JSON-body PUT over `requestJson`. */
export function putJson<T>(
  url: string,
  body: unknown,
  toError?: (status: number, message: string) => Error,
): Promise<T> {
  return requestJson<T>(
    url,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    toError,
  );
}
