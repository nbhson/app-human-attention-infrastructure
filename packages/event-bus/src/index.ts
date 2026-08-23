/**
 * `@harness/event-bus` — the nervous system of the Harness.
 *
 * Every subsystem publishes and consumes through {@link IEventBus}; no package
 * may import another engine directly.
 */

export { InProcessEventBus } from './in-process-event-bus.js';
export type { HandlerErrorCallback } from './in-process-event-bus.js';

export { createEvent } from './create-event.js';

export type { EventHandler, IEventBus, UnsubscribeFn } from './ievent-bus.js';

// Day-34: the optional durable transport swap behind the same IEventBus contract.
export { RedisEventsBus } from './redis-events-bus.js';
export type { FlushStatus, RedisEventsBusOptions } from './redis-events-bus.js';
export { InMemoryStreamTransport } from './stream-transport.js';
export type { StreamEntry, StreamTransport } from './stream-transport.js';
export {
  DEFAULT_EVENT_TRANSPORT,
  buildEventBus,
  resolveEventTransport,
} from './transport-resolver.js';
export type { BuildEventBusOptions, EventTransport } from './transport-resolver.js';
