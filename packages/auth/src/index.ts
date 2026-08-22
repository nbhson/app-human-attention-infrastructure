/**
 * `@harness/auth` — identity (day-01) + authorization (day-02).
 *
 * Boundary rule: imports only the SHARED packages (`@harness/domain`,
 * `@harness/db`, `@harness/event-bus`, `@harness/di`). Authentication is not a
 * pipeline step — this package neither publishes nor consumes harness events
 * (an exception, by design, to the event-driven rule: `requireRole`, exported
 * here, emits the `authz.decision_denied` event from `apps/api`).
 */

export * from './errors.js';
export * from './require-role.js';
export * from './auth-service.js';
export * from './session-service.js';
export * from './oidc/provider.js';
export * from './oidc/mock-provider.js';
export * from './oidc/openid-provider.js';
