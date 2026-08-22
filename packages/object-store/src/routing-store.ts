import type { ContentRef, ContentStore, PutMeta } from './content-store.js';

/**
 * Size-routing {@link ContentStore} (day-21 §2.2): `put` sends bytes over
 * `thresholdBytes` to the `object` backend and everything else to the `db`
 * backend; `get`/`exists`/`delete` follow the `ref.backend` tag back to the
 * store that produced it. The routing decision is a pure function of byte size,
 * so the same content always lands on the same backend.
 */
export class RoutingContentStore implements ContentStore {
  constructor(
    private readonly db: ContentStore,
    private readonly object: ContentStore,
    private readonly thresholdBytes: number,
  ) {}

  async put(content: Buffer, meta: PutMeta): Promise<ContentRef> {
    const target = meta.sizeBytes > this.thresholdBytes ? this.object : this.db;
    return target.put(content, meta);
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
