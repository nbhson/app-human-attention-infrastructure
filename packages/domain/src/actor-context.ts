/**
 * Request-scoped actor context (day-02 §2.3, extended by day-03 for correlation).
 *
 * A tiny `AsyncLocalStorage` carrying *who* currently holds the request. The
 * Day-01 `onRequest` hook seeds it with the authenticated principal's `UserID`
 * for the remainder of the request; `EventLogWriter` reads it back so every
 * event emitted inside an authenticated request gets `event_log.actor_id`
 * stamped — as envelope metadata, never part of the event payload.
 *
 * Events emitted outside any request (the dispatch/runtime loops, subscribers,
 * tests) run with no store and stamp `NULL`, which is the honest truth: there
 * is no human principal behind them.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { UserID } from './ids.js';

interface ActorStore {
  readonly actorId: UserID;
}

const storage = new AsyncLocalStorage<ActorStore | undefined>();

/**
 * Run `fn` with `actorId` as the request-scoped actor. Pass `undefined` to clear
 * it (nothing follows the request into non-request code).
 */
export function runWithActor(actorId: UserID | undefined, fn: () => void): void {
  storage.run(actorId === undefined ? undefined : { actorId }, fn);
}

/** The currently-acting user's id, or `undefined` outside an authenticated request. */
export function currentActorId(): UserID | undefined {
  return storage.getStore()?.actorId;
}
