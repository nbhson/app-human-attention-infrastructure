import type { Readable } from 'node:stream';

import type { ContentRef, ContentStore, PutMeta } from './content-store.js';
import { ObjectStoreUnavailableError } from './content-store.js';
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The S3/MinIO {@link ContentStore} backend (day-21 §2.4). Every object is
 * stored under its SHA-256 (`prefix + hash`), so identical bytes share exactly
 * one key — dedup for free. `get` streams the object back through a hash
 * verify, rejecting with `ContentIntegrityError` on drift.
 *
 * Day-26 §3.2: a port-level failure (network, missing bucket, daemon down) is
 * surfaced as {@link ObjectStoreUnavailableError} so the routing store and
 * `SnapshotStore` can degrade or fail closed — distinct from the
 * {@link ContentIntegrityError} a *tampered* object raises on read.
 */
export class ObjectStoreContentStore implements ContentStore {
  constructor(
    private readonly port: S3ClientPort,
    private readonly prefix = 'artifacts/',
  ) {}

  async put(content: Buffer, meta: PutMeta): Promise<ContentRef> {
    try {
      await this.port.putObject(this.keyFor(meta.contentHash), content, meta.sizeBytes);
    } catch (error) {
      throw new ObjectStoreUnavailableError(`object store put failed: ${messageOf(error)}`);
    }
    return { hash: meta.contentHash, backend: 'object' };
  }

  async get(ref: ContentRef): Promise<Readable> {
    let body: Readable;
    try {
      body = await this.port.getObject(this.keyFor(ref.hash));
    } catch (error) {
      throw new ObjectStoreUnavailableError(`object store get failed: ${messageOf(error)}`);
    }
    // Integrity drift surfaces later, on drain, as ContentIntegrityError — a
    // data event, not an availability event, so it is deliberately not wrapped.
    return verifyOnRead(body, ref.hash);
  }

  async delete(ref: ContentRef): Promise<void> {
    try {
      await this.port.deleteObject(this.keyFor(ref.hash));
    } catch (error) {
      throw new ObjectStoreUnavailableError(`object store delete failed: ${messageOf(error)}`);
    }
  }

  async exists(ref: ContentRef): Promise<boolean> {
    try {
      return await this.port.objectExists(this.keyFor(ref.hash));
    } catch (error) {
      throw new ObjectStoreUnavailableError(`object store exists failed: ${messageOf(error)}`);
    }
  }

  private keyFor(hash: string): string {
    return `${this.prefix}${hash}`;
  }
}
