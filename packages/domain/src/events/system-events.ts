/**
 * Runtime lifecycle payloads (day-34 §4.5).
 *
 * The audit timeline treats the process itself as observable work, not just the
 * tasks it runs. `system.started` records what is present once the object graph
 * is booted; `system.stopped` records a graceful stop. Both are ordinary bus
 * events, so `EventLogWriter` persists them to `event_log` like any other —
 * "application started" and "application stopped" become timeline entries.
 */

import type { EventType } from './event-types.js';

/** Payload for {@link import('./event-types.js').EventType.SystemStarted}. */
export interface SystemStartedPayload {
  /** The service name (the API entrypoint), e.g. `harness-api`. */
  readonly service: string;
  /** The event-transport in effect (day-34 §2.1), surfaced for the operator. */
  readonly transport: string;
  /** Component tokens eagerly resolved at boot, in dependency order. */
  readonly components: readonly string[];
}

/** Payload for {@link import('./event-types.js').EventType.SystemStopped}. */
export interface SystemStoppedPayload {
  /** The service name, matching the `system.started` payload. */
  readonly service: string;
  /** How the process stopped — a signal name or an explicit `"error"`. */
  readonly reason: string;
}

// Doc-only reference so the payload interfaces do not import EventType for a value.
export type _SystemEventTypes = typeof EventType.SystemStarted | typeof EventType.SystemStopped;
