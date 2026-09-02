/**
 * The durable-transport seam (day-34 §2.1).
 *
 * A durable `IEventBus` (`RedisEventsBus`) talks to its broker through this
 * minimal structural contract — a *seam*, not a DI token (the host injects a
 * concrete implementation, exactly like `CollectSeam`/`FitSeam`). Redis Streams
 * (`XADD`/`XREADGROUP`/`XACK`) and an SQS queue both fit behind it, so
 * `RedisEventsBus` never imports a broker SDK and `@harness/event-bus` stays a
 * single-dependency package (`@harness/domain` only).
 *
 * Delivery is **at-least-once**: an entry acknowledged too late (a consumer that
 * crashed between read and ack) is handed out again, so consumers must already be
 * idempotent (Days 08/19 guarantee exactly that — day-34 §2.2).
 */

/** A single entry read back from the durable stream. */
export interface StreamEntry {
  /** Stream entry id (Redis `XADD`-style `<seq>-<n>`), monotonic within the stream. */
  readonly id: string;
  /** The serialized envelope — opaque to the transport. */
  readonly payload: string;
}

/**
 * The durable-broker contract. `add` is the producer side; `readGroup`/`ack` are
 * the consumer-group side (single logical group, at-least-once pending set).
 */
export interface StreamTransport {
  /** Append a serialized envelope; resolves to its entry id (`XADD`). */
  add(payload: string): Promise<string>;
  /**
   * Deliver up to `count` entries for consumer-group `consumer`: everything the
   * group has been handed but not yet acked (pending, `>` redelivery) first, then
   * new entries. Resolves to an empty array when the stream has nothing left.
   */
  readGroup(consumer: string, count: number): Promise<StreamEntry[]>;
  /** Acknowledge an entry as handled (`XACK`) — removes it from the pending set. */
  ack(entryId: string): Promise<void>;
}

/**
 * A deterministic, in-process {@link StreamTransport} — Redis Streams order and
 * pending/redelivery semantics without a broker.
 *
 * This is the deploy-light stand-in used by the demo and the transport tests (and
 * what keeps the repo Redis-free, mirroring the "real Anthropic path is
 * compile-tested only" hygiene). A production `RedisStreamTransport` is a thin
 * adapter of the same three methods over a Redis client.
 */
export class InMemoryStreamTransport implements StreamTransport {
  private readonly entries: StreamEntry[] = [];
  /** Entries delivered but not yet acked — the at-least-once pending set (insertion-ordered). */
  private readonly pending = new Map<string, StreamEntry>();
  /** How many entries have ever been handed to a consumer (the new-entry boundary). */
  private deliveredCount = 0;
  /** Monotonic entry-id sequence. */
  private nextSeq = 1;

  async add(payload: string): Promise<string> {
    const id = `${this.nextSeq++}-0`;
    this.entries.push({ id, payload });
    return id;
  }

  async readGroup(consumer: string, count: number): Promise<StreamEntry[]> {
    void consumer; // single-logical-group transport: the name is advisory only
    if (count <= 0) {
      return [];
    }
    const out: StreamEntry[] = [];

    // 1. Redeliver the pending set first (at-least-once: an unacked entry comes back).
    for (const entry of this.pending.values()) {
      if (out.length >= count) {
        return out;
      }
      out.push(entry);
    }

    // 2. Then offer new entries, moving the delivered boundary forward as we go.
    const fresh = this.entries.slice(this.deliveredCount, this.deliveredCount + (count - out.length));
    for (const entry of fresh) {
      this.pending.set(entry.id, entry);
      this.deliveredCount += 1;
      out.push(entry);
    }
    return out;
  }

  async ack(entryId: string): Promise<void> {
    this.pending.delete(entryId);
  }

  /** The number of entries currently pending (delivered but unacked) — for tests. */
  get pendingCount(): number {
    return this.pending.size;
  }
}
