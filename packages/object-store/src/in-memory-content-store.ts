import { Readable } from 'node:stream';

import type { ContentBackend, ContentRef, ContentStore, PutMeta } from './content-store.js';
import { verifyOnRead } from './streams.js';

/**
 * An in-memory {@link ContentStore} (day-21 §2.2 test double + dev fallback).
 * Content lives in a `Map` keyed by hash for the process lifetime — an ephemeral
 * stand-in for tests and for a local boot that has no object-store endpoint, not
 * a production backend (a restart drops every blob).
 */
export class InMemoryContentStore implements ContentStore {
  private readonly blobs = new Map<string, Buffer>();

  constructor(private readonly backend: ContentBackend = 'object') {}

  async put(content: Buffer, meta: PutMeta): Promise<ContentRef> {
    this.blobs.set(meta.contentHash, Buffer.from(content));
    return { hash: meta.contentHash, backend: this.backend };
  }

  async get(ref: ContentRef): Promise<Readable> {
    const blob = this.blobs.get(ref.hash);
    if (blob === undefined) {
      throw new Error(`content ${ref.hash} not found in ${this.backend} store`);
    }
    return verifyOnRead(Readable.from([blob]), ref.hash);
  }

  async delete(ref: ContentRef): Promise<void> {
    this.blobs.delete(ref.hash);
  }

  async exists(ref: ContentRef): Promise<boolean> {
    return this.blobs.has(ref.hash);
  }
}
