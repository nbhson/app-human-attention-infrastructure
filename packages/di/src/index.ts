/**
 * `@harness/di` — the wiring layer that joins packages at startup.
 *
 * Packages rely only on interfaces; this package supplies the container that
 * resolves each token to its concrete implementation, in dependency order, from
 * one place (`apps/api/src/bootstrap.ts`).
 */

export { Container } from './container.js';
export type { Factory } from './container.js';

export { ContainerError } from './errors.js';

export { TOKENS } from './tokens.js';
export type { Token } from './tokens.js';

export { createRootLogger, withCorrelation } from './logger.js';
export type { CorrelationContext, LogFields, Logger } from './logger.js';
