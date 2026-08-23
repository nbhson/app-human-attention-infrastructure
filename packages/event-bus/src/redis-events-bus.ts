/**
 * A durable `IEventBus` behind the same interface (day-34 §2.1, §3.1) — at-least-once
 * over a {@link StreamTransport} seam (Redis Streams / SQS behind it).
 *
 * The contract is frozen: `publish`/`subscribe` are byte-for-byte the same signature
 * as {@link InProcessEventBus}, so engines that consume events never know which
 * transport they are on. Delivery is **at-least-once**: an entry handed to a consumer
 * but acknowledged too late (a crash between read and ack) is redelivered, so consumers
 * must already be idempotent (Days 08/19 — day-34 §2.2). A handler that throws leaves
 * its entry pending (no ack); after `maxDeliveryAttempts` failed deliveries it is
 * dead-lettered instead (day-34 §2.4) so a poison event cannot wedge the loop.
 *
 * `publish` stays fire-and-forget (`void`) exactly like the in-process bus — the
 * emitter gets no delivery confirmation on *either* transport. Durability comes from
 * the broker, not from the emitter's return value.
 *
 * This class never imports a broker SDK: the host injects a concrete
 * {@link StreamTransport}. The in-repo stand-in is `InMemoryStreamTransport`
 * (`stream-transport.ts`), used by tests and the demo so the repo stays Redis-free
 * (mirroring the "real Anthropic path is compile-tested only" hygiene).
 */

import type { EventEnvelope, EventType } from '@harness/domain';

import type { EventHandler, IEventBus, UnsubscribeFn } from './ievent-bus.js';
import type { HandlerErrorCallback } from './in-process-event-bus.js';
import type { StreamEntry, StreamTransport } from './stream-transport.js';

/** Outcome of one `flush` sweep (a single `readGroup`+dispatch round). */
export type FlushStatus = 'delivered' | 'empty' | 'error';

/** Configuration for {@link RedisEventsBus}. */
export interface RedisEventsBusOptions {
  /** The consumer-group consumer name (`XREADGROUP` `consumer`). Advisory in-memory. */
  readonly consumerName?: string;
  /** Poll cadence for the auto loop; `<= 0` disables auto-polling (drive via `flush`/`drain`). */
  readonly pollIntervalMs?: number;
  /** Entries per `readGroup` fetch. */
  readonly batchSize?: number;
  /** A consumer handler threw (mirrors {@link InProcessEventBus} semantics). */
  readonly onHandlerError?: HandlerErrorCallback;
  /** A transport read/write failed (reported, then retried with backoff). */
  readonly onTransportError?: (error: unknown) => void;
  /** An entry was dead-lettered after `maxDeliveryAttempts` failures (or a poison payload). */
  readonly onDeadLetter?: (entry: StreamEntry, reason: string) => void;
  /** Starting reconnect backoff delay. */
  readonly baseBackoffMs?: number;
  /** Reconnect backoff ceiling. */
  readonly maxBackoffMs?: number;
  /** Delivery attempts before dead-lettering. */
  readonly maxDeliveryAttempts?: number;
  /** Backoff sleep seam (injectable for deterministic tests). */
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULTS = {
  consumerName: 'harness-consumer',
  pollIntervalMs: 50,
  batchSize: 32,
  baseBackoffMs: 50,
  maxBackoffMs: 5000,
  maxDeliveryAttempts: 10,
};

/** Serialize the immutable envelope (`occurred_at` → ISO on the wire). */
function serializeEnvelope<T>(event: EventEnvelope<T>): string {
  return JSON.stringify(event);
}

/** Parse a serialized envelope, reviving `occurred_at` back to a `Date`. */
function deserializeEnvelope(raw: string): EventEnvelope<unknown> {
  const parsed = JSON.parse(raw) as {
    event_type: string;
    occurred_at: string;
    event_id: string;
    event_version: number;
    correlation_id: string;
    payload: unknown;
  };
  return {
    event_id: parsed.event_id,
    event_type: parsed.event_type as EventType,
    event_version: parsed.event_version,
    occurred_at: new Date(parsed.occurred_at),
    correlation_id: parsed.correlation_id,
    payload: parsed.payload,
  } as EventEnvelope<unknown>;
}

/**
 * A durable, at-least-once `IEventBus` over a {@link StreamTransport}.
 *
 * Use `pollIntervalMs: 0` + {@link flush}/{@link drain} to drive delivery
 * deterministically in tests and demos (no timers); the default `pollIntervalMs`
 * runs a self-rescheduling loop that backs off on transport failure.
 */
export class RedisEventsBus implements IEventBus {
  private readonly handlers = new Map<EventType, Array<EventHandler<unknown>>>();
  /** `entryId → delivery attempts`, cleared on ack/dead-letter. */
  private readonly attempts = new Map<string, number>();

  private readonly consumerName: string;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly onHandlerError: HandlerErrorCallback | undefined;
  private readonly onTransportError: ((error: unknown) => void) | undefined;
  private readonly onDeadLetter: ((entry: StreamEntry, reason: string) => void) | undefined;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxDeliveryAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;

  private backoffMs: number;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly transport: StreamTransport,
    options: RedisEventsBusOptions = {},
  ) {
    this.consumerName = options.consumerName ?? DEFAULTS.consumerName;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULTS.pollIntervalMs;
    this.batchSize = options.batchSize ?? DEFAULTS.batchSize;
    this.onHandlerError = options.onHandlerError;
    this.onTransportError = options.onTransportError;
    this.onDeadLetter = options.onDeadLetter;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULTS.baseBackoffMs;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULTS.maxBackoffMs;
    this.maxDeliveryAttempts = options.maxDeliveryAttempts ?? DEFAULTS.maxDeliveryAttempts;
    this.sleep = options.sleep ?? defaultSleep;
    this.backoffMs = this.baseBackoffMs;
  }

  /** Fire-and-forget publish — the same `void` contract as the in-process bus. */
  publish<T>(event: EventEnvelope<T>): void {
    void this.transport.add(serializeEnvelope(event)).then(
      () => undefined,
      (error) => this.onTransportError?.(error),
    );
  }

  subscribe<T>(eventType: EventType, handler: EventHandler<T>): UnsubscribeFn {
    const list = this.handlers.get(eventType) ?? [];
    const typed = handler as EventHandler<unknown>;
    list.push(typed);
    this.handlers.set(eventType, list);
    this.ensureLoop();
    return () => {
      const current = this.handlers.get(eventType);
      if (!current) {
        return;
      }
      const next = current.filter((h) => h !== typed);
      if (next.length === 0) {
        this.handlers.delete(eventType);
      } else {
        this.handlers.set(eventType, next);
      }
    };
  }

  /** One `readGroup`+dispatch round. Returns its outcome (transport failure is reported, not thrown). */
  async flush(): Promise<FlushStatus> {
    let entries: StreamEntry[];
    try {
      entries = await this.transport.readGroup(this.consumerName, this.batchSize);
    } catch (error) {
      this.onTransportError?.(error);
      return 'error';
    }
    if (entries.length === 0) {
      return 'empty';
    }
    for (const entry of entries) {
      await this.deliver(entry);
    }
    return 'delivered';
  }

  /**
   * Sweep repeatedly until the stream is empty, retrying transport errors with
   * (doubling) backoff — the deterministic driving path for tests/demos with
   * `pollIntervalMs: 0`.
   */
  async drain(maxAttempts = 1000): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const status = await this.flush();
      if (status === 'empty') {
        this.backoffMs = this.baseBackoffMs;
        return;
      }
      if (status === 'delivered') {
        this.backoffMs = this.baseBackoffMs;
        continue;
      }
      // 'error': report already happened in flush; back off, then retry.
      await this.sleep(this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    }
  }

  /** Stop the auto-poll loop (a fresh `flush`/`drain` still works). */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Deliver one entry to its handlers, ack on success, dead-letter after the attempt cap. */
  private async deliver(entry: StreamEntry): Promise<void> {
    let envelope: EventEnvelope<unknown>;
    try {
      envelope = deserializeEnvelope(entry.payload);
    } catch (error) {
      // A poison payload must not crash the loop (day-34 §2.4) — dead-letter it.
      await this.deadLetter(entry, `unparseable payload: ${String(error)}`);
      return;
    }

    const subscribed = this.handlers.get(envelope.event_type);
    let failed = false;
    if (subscribed) {
      for (const handler of subscribed) {
        try {
          handler(envelope);
        } catch (error) {
          failed = true;
          this.onHandlerError?.(envelope.event_type, error);
        }
      }
    }

    if (failed) {
      const attempts = this.recordFailure(entry.id);
      if (attempts >= this.maxDeliveryAttempts) {
        await this.deadLetter(entry, `failed ${attempts} delivery attempts`);
      }
      // else: no ack → the entry stays pending and is redelivered (at-least-once).
      return;
    }

    this.attempts.delete(entry.id);
    await this.transport.ack(entry.id).catch((error) => this.onTransportError?.(error));
  }

  private recordFailure(entryId: string): number {
    const next = (this.attempts.get(entryId) ?? 0) + 1;
    this.attempts.set(entryId, next);
    return next;
  }

  private async deadLetter(entry: StreamEntry, reason: string): Promise<void> {
    this.attempts.delete(entry.id);
    await this.transport.ack(entry.id).catch((error) => this.onTransportError?.(error));
    this.onDeadLetter?.(entry, reason);
  }

  /** Start the self-rescheduling poll loop (no-op when `pollIntervalMs <= 0`). */
  private ensureLoop(): void {
    if (this.pollIntervalMs <= 0 || this.timer !== null) {
      return;
    }
    const tick = (): void => {
      if (this.stopped) {
        return;
      }
      void this.flush().then((status) => {
        if (this.stopped) {
          return;
        }
        if (status === 'error') {
          const delay = this.backoffMs;
          this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
          this.timer = setTimeout(tick, delay);
        } else {
          this.backoffMs = this.baseBackoffMs;
          this.timer = setTimeout(tick, this.pollIntervalMs);
        }
      });
    };
    this.timer = setTimeout(tick, 0);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
