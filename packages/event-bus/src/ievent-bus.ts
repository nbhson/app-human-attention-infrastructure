/**
 * The event bus contract (orchestrator spec §8).
 *
 * Phase 1 is a synchronous, in-process bus. `publish` is fire-and-forget from
 * the emitter's perspective; handlers run synchronously in subscription order.
 * The bus does not validate payloads (the emitter's domain factories do) and does
 * not persist events (a dedicated subscriber handles persistence on Day 04).
 */

import type { EventEnvelope, EventType } from '@harness/domain';

/** A handler for events carrying a payload of type `T`. */
export type EventHandler<T> = (event: EventEnvelope<T>) => void;

/** Undoes a subscription so the handler stops receiving events. */
export type UnsubscribeFn = () => void;

/**
 * The single interface every module emits and consumes events through.
 */
export interface IEventBus {
  /** Emit an event to every handler subscribed to its type. */
  publish<T>(event: EventEnvelope<T>): void;
  /** Register a handler and return a function that removes it. */
  subscribe<T>(eventType: EventType, handler: EventHandler<T>): UnsubscribeFn;
}
