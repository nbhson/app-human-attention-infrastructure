import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { ObjectStoreContentStore } from '../object-store-content-store.js';
import type { S3ClientPort } from '../object-store-content-store.js';
import { sha256Hex, streamToBuffer } from '../streams.js';

/** An in-memory port that counts how many objects were written. */
class CountingS3Port implements S3ClientPort {
  private readonly objects = new Map<string, Buffer>();

  async putObject(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(body));
  }

  async getObject(key: string): Promise<Readable> {
    const body = this.objects.get(key);
    if (body === undefined) {
      throw new Error(`no object at ${key}`);
    }
    return Readable.from([body]);
  }

  async objectExists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  objectCount(): number {
    return this.objects.size;
  }
}

describe('ObjectStoreContentStore concurrency (day-26 §2.3)', () => {
  it('N parallel puts of the same hash store exactly one object', async () => {
    const port = new CountingS3Port();
    const store = new ObjectStoreContentStore(port);

    const content = Buffer.alloc(2 * 1024 * 1024, 0x78); // 2 MiB — object-backed
    const hash = sha256Hex(content);

    const refs = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.put(content, { contentHash: hash, sizeBytes: content.length }),
      ),
    );

    for (const ref of refs) {
      expect(ref).toEqual({ hash, backend: 'object' });
    }
    expect(port.objectCount()).toBe(1);

    // And the single stored object round-trips intact.
    const drained = await streamToBuffer(await store.get(refs[0]!));
    expect(drained.equals(content)).toBe(true);
  });
});
