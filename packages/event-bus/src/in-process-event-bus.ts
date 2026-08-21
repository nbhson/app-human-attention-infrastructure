/**
 * Phase 1 in-process event bus: a synchronous Node `EventEmitter` hidden behind
 * {@link IEventBus}, so a future Kafka/NATS broker can replace it without
 * touching any consumer.
 */

import { EventEmitter } from 'node:events';

import type { EventEnvelope, EventType } from '@harness/domain';

import type { EventHandler, IEventBus, UnsubscribeFn } from './ievent-bus.js';

/** Invoked (instead of crashing) when a subscriber throws while handling. */
export type HandlerErrorCallback = (eventType: EventType, error: unknown) => void;

/** The parameter type Node's `EventEmitter` expects for a listener. */
type NodeListener = (...args: unknown[]) => void;

/**
 * A synchronous, in-memory event bus.
 *
 * - `publish` is fire-and-forget and dispatches to every handler subscribed to
 *   the event's type, in subscription order.
 * - A throwing handler is caught, reported via {@link onHandlerError}, and does
 *   not prevent the remaining handlers from running.
 * - Events are not persisted here — persistence belongs to a subscribing
 *   `EventLogWriter` (Day 04).
 */
export class InProcessEventBus implements IEventBus {
  private readonly emitter = new EventEmitter();
  private readonly onHandlerError: HandlerErrorCallback;

  constructor(onHandlerError: HandlerErrorCallback = defaultOnHandlerError) {
    this.onHandlerError = onHandlerError;
  }

  publish<T>(event: EventEnvelope<T>): void {
    const listeners = this.emitter.listeners(event.event_type) as unknown as Array<EventHandler<T>>;
    for (const handler of listeners) {
      try {
        handler(event);
      } catch (error) {
        this.onHandlerError(event.event_type, error);
      }
    }
  }

  subscribe<T>(eventType: EventType, handler: EventHandler<T>): UnsubscribeFn {
    this.emitter.on(eventType, handler as unknown as NodeListener);
    return () => {
      this.emitter.off(eventType, handler as unknown as NodeListener);
    };
  }

  /** The number of handlers currently subscribed to `eventType` (for tests). */
  subscriberCount(eventType: EventType): number {
    return this.emitter.listenerCount(eventType);
  }
}

function defaultOnHandlerError(eventType: EventType, error: unknown): void {
  // Low-level fallback (day-27 §2.1): the composition root injects a real
  // structured handler via `onHandlerError`; before that, write a single line to
  // stderr so an unhandled handler error is never silent. `event-bus` may not
  // import `@harness/di` (boundary R4), so this stays on the process stream.
  process.stderr.write(`[event-bus] unhandled error in "${eventType}" handler: ${String(error)}\n`);
}
