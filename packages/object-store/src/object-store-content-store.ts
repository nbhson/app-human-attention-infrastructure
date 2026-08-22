import type { Readable } from 'node:stream';

import type { ContentRef, ContentStore, PutMeta } from './content-store.js';
import { verifyOnRead } from './streams.js';

/**
 * A minimal S3/MinIO port — the verb-shaped calls the store needs. Kept as an
 * interface so the store logic is testable against a fake without a real bucket,
 * and so `AwsS3ClientPort` is the only thing that imports the SDK.
 */
export interface S3ClientPort {
  putObject(key: string, body: Buffer, contentLength: number): Promise<void>;
  getObject(key: string): Promise<Readable>;
  objectExists(key: string): Promise<boolean>;
  deleteObject(key: string): Promise<void>;
}

/**
 * The S3/MinIO {@link ContentStore} backend (day-21 §2.4). Every object is
 * stored under its SHA-256 (`prefix + hash`), so identical bytes share exactly
 * one key — dedup for free. `get` streams the object back through a hash
 * verify, rejecting with `ContentIntegrityError` on drift.
 */
export class ObjectStoreContentStore implements ContentStore {
  constructor(
    private readonly port: S3ClientPort,
    private readonly prefix = 'artifacts/',
  ) {}

  async put(content: Buffer, meta: PutMeta): Promise<ContentRef> {
    await this.port.putObject(this.keyFor(meta.contentHash), content, meta.sizeBytes);
    return { hash: meta.contentHash, backend: 'object' };
  }

  async get(ref: ContentRef): Promise<Readable> {
    const body = await this.port.getObject(this.keyFor(ref.hash));
    return verifyOnRead(body, ref.hash);
  }

  async delete(ref: ContentRef): Promise<void> {
    await this.port.deleteObject(this.keyFor(ref.hash));
  }

  async exists(ref: ContentRef): Promise<boolean> {
    return this.port.objectExists(this.keyFor(ref.hash));
  }

  private keyFor(hash: string): string {
    return `${this.prefix}${hash}`;
  }
}
