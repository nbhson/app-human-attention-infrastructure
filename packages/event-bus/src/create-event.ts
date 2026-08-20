/**
 * Envelope factory.
 *
 * The bus never stamps an event — the emitter does, through this helper, so that
 * `event_id`, `occurred_at`, and `event_version` are set consistently at the
 * point of emission.
 */

import { newEventID } from '@harness/domain';
import type { CorrelationID, EventEnvelope, EventType } from '@harness/domain';

/**
 * Build an immutable {@link EventEnvelope} with a fresh UUIDv7 `event_id`, the
 * current `occurred_at`, and `event_version: 1` (unless overridden).
 *
 * @typeParam T - the payload type.
 * @param event_type - the namespaced event type constant.
 * @param correlation_id - traces back to the originating task or agent run.
 * @param payload - the typed payload.
 * @param event_version - payload schema version, defaults to 1.
 */
export function createEvent<T>(
  event_type: EventType,
  correlation_id: CorrelationID,
  payload: T,
  event_version = 1,
): EventEnvelope<T> {
  return {
    event_id: newEventID(),
    event_type,
    event_version,
    occurred_at: new Date(),
    correlation_id,
    payload,
  };
}
