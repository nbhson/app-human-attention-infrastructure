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
