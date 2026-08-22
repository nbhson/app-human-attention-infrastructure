/**
 * `@harness/auth` — identity (day-01) + authorization (day-02).
 *
 * Boundary rule: imports only `@harness/domain`, `@harness/db`, `@harness/di`.
 * Authentication is not a pipeline step — this package neither publishes nor
 * consumes harness events (an exception, by design, to the event-driven rule:
 * the AuthZ *denial* event is emitted by the guard in `apps/api`, not here).
 */

export * from './errors.js';
export * from './auth-service.js';
export * from './session-service.js';
export * from './oidc/provider.js';
export * from './oidc/mock-provider.js';
export * from './oidc/openid-provider.js';
