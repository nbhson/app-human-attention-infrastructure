/**
 * The canonical event envelope (orchestrator spec §8).
 *
 * Every event on the bus carries exactly this shape. Events are immutable, so
 * every field is `readonly`; the bus records nothing about the event beyond what
 * the emitter stamped at creation time.
 */

import type { CorrelationID, EventID } from '../ids.js';
import type { EventType } from './event-types.js';

/**
 * The immutable wrapper every domain event travels in.
 *
 * @typeParam TPayload - the payload type for {@link EventType}.
 */
export interface EventEnvelope<TPayload = unknown> {
  /** Unique id per emission (UUIDv7). */
  readonly event_id: EventID;
  /** The namespaced event type, e.g. `task.state_changed`. */
  readonly event_type: EventType;
  /** Schema version of the payload; starts at 1. */
  readonly event_version: number;
  /** UTC time the event occurred, set by the emitter — never by the bus. */
  readonly occurred_at: Date;
  /** Traces the event back to its originating task or agent run. */
  readonly correlation_id: CorrelationID;
  /** The typed event payload. */
  readonly payload: TPayload;
}
