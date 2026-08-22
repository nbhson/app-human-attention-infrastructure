import type { ContentRef, ContentStore, PutMeta } from './content-store.js';
import { ObjectStoreUnavailableError } from './content-store.js';

/**
 * Fallback configuration for {@link RoutingContentStore} (day-26 §3.2). The
 * store stays a leaf (no `@harness/*` import), so the *observable* signals are
 * injected callbacks the consumer wires to `@harness/observability` recorders.
 */
export interface RoutingFallbackOptions {
  /**
   * Content up to this size may be re-routed to the inline `db` backend when the
   * object store is down. Defaults to `thresholdBytes` — i.e. by default an
   * oversized write fails closed rather than quietly inlining a blob the db was
   * never meant to hold. Set it above `thresholdBytes` to open a "medium band"
   * that degrades gracefully.
   */
  readonly dbFallbackMaxBytes?: number;
  /** A successful degrade happened (object → db). Wired to `recordObjectStoreFallback`. */
  readonly onFallback?: () => void;
  /** The object backend failed (degraded or fail-closed). Wired to `recordObjectStoreError`. */
  readonly onError?: () => void;
}

/**
 * Size-routing {@link ContentStore} (day-21 §2.2): `put` sends bytes over
 * `thresholdBytes` to the `object` backend and everything else to the `db`
 * backend; `get`/`exists`/`delete` follow the `ref.backend` tag back to the
 * store that produced it. The routing decision is a pure function of byte size,
 * so the same content always lands on the same backend.
 *
 * Day-26 §3.2 adds the degrade contract: when the object backend throws
 * {@link ObjectStoreUnavailableError}, content at or under `dbFallbackMaxBytes`
 * degrades to `db` (loud, via `onFallback`/`onError`); anything larger fails
 * closed with an explicit error — never a half-stored object.
 */
export class RoutingContentStore implements ContentStore {
  constructor(
    private readonly db: ContentStore,
    private readonly object: ContentStore,
    private readonly thresholdBytes: number,
    private readonly options: RoutingFallbackOptions = {},
  ) {}

  async put(content: Buffer, meta: PutMeta): Promise<ContentRef> {
    if (meta.sizeBytes <= this.thresholdBytes) {
      // Small content is db-primary: the object backend is never consulted, so
      // an object-store outage does not touch this path at all.
      return this.db.put(content, meta);
    }

    try {
      return await this.object.put(content, meta);
    } catch (error) {
      if (!(error instanceof ObjectStoreUnavailableError)) {
        // An integrity drift, or an unrelated bug, is not a degrade decision.
        throw error;
      }
      this.options.onError?.();

      const maxBytes = this.options.dbFallbackMaxBytes ?? this.thresholdBytes;
      if (meta.sizeBytes <= maxBytes) {
        this.options.onFallback?.();
        return this.db.put(content, meta);
      }
      // Too large to inline safely → fail closed, never a partial object.
      throw new ObjectStoreUnavailableError(
        `object store unavailable and ${meta.sizeBytes} bytes exceeds the inline ceiling (${maxBytes})`,
      );
    }
  }

  async get(ref: ContentRef) {
    return this.backendFor(ref).get(ref);
  }

  async delete(ref: ContentRef): Promise<void> {
    await this.backendFor(ref).delete(ref);
  }

  async exists(ref: ContentRef): Promise<boolean> {
    return this.backendFor(ref).exists(ref);
  }

  private backendFor(ref: ContentRef): ContentStore {
    return ref.backend === 'object' ? this.object : this.db;
  }
}
