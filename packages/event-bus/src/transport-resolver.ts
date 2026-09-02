/**
 * Transport selection (day-34 §2.3, §3.2).
 *
 * The event bus behind `IEventBus` is an *optional* transport swap. The default
 * remains the zero-config in-process bus; `EVENT_TRANSPORT=redis|sqs` opts into a
 * durable {@link RedisEventsBus} only where the operator has wired a
 * {@link StreamTransport} adapter. Nothing in the hot path changes while `inproc`
 * is selected.
 */

import { InProcessEventBus } from './in-process-event-bus.js';
import { RedisEventsBus } from './redis-events-bus.js';
import type { HandlerErrorCallback } from './in-process-event-bus.js';
import type { IEventBus } from './ievent-bus.js';
import type { StreamTransport } from './stream-transport.js';

/** The transports a deployment may select. */
export type EventTransport = 'inproc' | 'redis' | 'sqs';

/** The zero-config fallback (day-34 §2.3). */
export const DEFAULT_EVENT_TRANSPORT: EventTransport = 'inproc';

const KNOWN_TRANSPORTS: readonly EventTransport[] = ['inproc', 'redis', 'sqs'];

/**
 * Resolve the raw `EVENT_TRANSPORT` value to a transport type. Unknown values
 * throw (fail fast — a typo should never silently fall back to in-process and
 * drop durability). Missing/empty/`inproc` → {@link DEFAULT_EVENT_TRANSPORT}.
 */
export function resolveEventTransport(raw: string | null | undefined): EventTransport {
  const value = raw ?? DEFAULT_EVENT_TRANSPORT;
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return DEFAULT_EVENT_TRANSPORT;
  }
  if ((KNOWN_TRANSPORTS as readonly string[]).includes(trimmed)) {
    return trimmed as EventTransport;
  }
  throw new Error(`unknown EVENT_TRANSPORT "${trimmed}" — expected one of ${KNOWN_TRANSPORTS.join('|')}`);
}

/** Options accepted by {@link buildEventBus}. */
export interface BuildEventBusOptions {
  /** Structured handler-error sink (in-process only). */
  readonly onHandlerError?: HandlerErrorCallback;
  /** Required for `redis`/`sqs` — the durable broker adapter. */
  readonly transport?: StreamTransport;
  /** Extra durable-bus options (poll interval, batch size, DLQ, …). */
  readonly durable?: ConstructorParameters<typeof RedisEventsBus>[1];
}

/**
 * Build the bus a destination selected. `inproc` needs no further input;
 * `redis`/`sqs` need a {@link StreamTransport} (else this throws — the repo
 * ships no broker SDK, so a durable deployment supplies its own adapter).
 */
export function buildEventBus(transport: EventTransport, options: BuildEventBusOptions = {}): IEventBus {
  if (transport === 'inproc') {
    return new InProcessEventBus(options.onHandlerError);
  }
  if (!options.transport) {
    throw new Error(
      `EVENT_TRANSPORT=${transport} requires a StreamTransport adapter — ` +
        'the repo ships none (live brokers are opt-in; see docs/architecture/wiring-map.md)',
    );
  }
  return new RedisEventsBus(options.transport, options.durable);
}
