import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { ContentIntegrityError } from '../content-store.js';
import { InMemoryContentStore } from '../in-memory-content-store.js';
import { ObjectStoreContentStore } from '../object-store-content-store.js';
import type { S3ClientPort } from '../object-store-content-store.js';
import { RoutingContentStore } from '../routing-store.js';
import { sha256Hex, streamToBuffer, streamToString } from '../streams.js';

/**
 * An in-memory {@link S3ClientPort} stand-in: stores objects under `key`, can
 * count them (for the dedup assertion) and can corrupt one (for the integrity
 * assertion), with no network and no AWS SDK.
 */
class FakeS3Port implements S3ClientPort {
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

  tamper(key: string, replacement: Buffer): void {
    this.objects.set(key, replacement);
  }
}

describe('ObjectStoreContentStore (day-21 §2.4)', () => {
  it('put → get round-trips bytes, byte-identical and hash-verified', async () => {
    const store = new ObjectStoreContentStore(new FakeS3Port());
    const content = Buffer.from('hello object store');
    const hash = sha256Hex(content);

    const ref = await store.put(content, { contentHash: hash, sizeBytes: content.length });

    expect(ref).toEqual({ hash, backend: 'object' });
    expect((await streamToBuffer(await store.get(ref))).toString('utf8')).toBe(
      'hello object store',
    );
    expect(await store.exists(ref)).toBe(true);
  });

  it('rejects a tampered object with ContentIntegrityError on read', async () => {
    const port = new FakeS3Port();
    const store = new ObjectStoreContentStore(port);
    const content = Buffer.from('original bytes');
    const hash = sha256Hex(content);
    const ref = await store.put(content, { contentHash: hash, sizeBytes: content.length });

    port.tamper(`artifacts/${hash}`, Buffer.from('corrupted!!'));

    await expect(streamToBuffer(await store.get(ref))).rejects.toBeInstanceOf(
      ContentIntegrityError,
    );
  });

  it('stores two identical objects under a single key (dedup for free)', async () => {
    const port = new FakeS3Port();
    const store = new ObjectStoreContentStore(port);
    const content = Buffer.alloc(2 * 1024 * 1024, 0x78); // 2 MB, per the routing criterion
    const hash = sha256Hex(content);

    const first = await store.put(content, { contentHash: hash, sizeBytes: content.length });
    const second = await store.put(content, { contentHash: hash, sizeBytes: content.length });

    expect(first).toEqual(second);
    expect(port.objectCount()).toBe(1);
  });

  it('get returns a stream (never a materialized buffer)', async () => {
    const store = new ObjectStoreContentStore(new FakeS3Port());
    const content = Buffer.alloc(8 * 1024 * 1024, 0x61); // large enough to matter
    const hash = sha256Hex(content);
    const ref = await store.put(content, { contentHash: hash, sizeBytes: content.length });

    const result = await store.get(ref);
    expect(Buffer.isBuffer(result)).toBe(false);
    expect(typeof (result as { pipe?: unknown }).pipe).toBe('function');

    const drained = await streamToBuffer(result);
    expect(drained.length).toBe(content.length);
  });

  it('delete removes the object (GC-only, unreferenced)', async () => {
    const store = new ObjectStoreContentStore(new FakeS3Port());
    const content = Buffer.from('to be collected');
    const hash = sha256Hex(content);
    const ref = await store.put(content, { contentHash: hash, sizeBytes: content.length });

    await store.delete(ref);
    expect(await store.exists(ref)).toBe(false);
  });
});

describe('RoutingContentStore (day-21 §2.2)', () => {
  const THRESHOLD = 1024 * 1024; // 1 MB

  function routed(): RoutingContentStore {
    return new RoutingContentStore(
      new InMemoryContentStore('db'),
      new InMemoryContentStore('object'),
      THRESHOLD,
    );
  }

  it('routes a 2 MB artifact to backend=object', async () => {
    const store = routed();
    const big = Buffer.alloc(2 * 1024 * 1024, 0x63);
    const ref = await store.put(big, { contentHash: sha256Hex(big), sizeBytes: big.length });

    expect(ref.backend).toBe('object');
    expect((await streamToString(await store.get(ref))).length).toBe(big.length);
  });

  it('routes a 50 KB artifact to backend=db', async () => {
    const store = routed();
    const small = Buffer.alloc(50 * 1024, 0x64);
    const ref = await store.put(small, {
      contentHash: sha256Hex(small),
      sizeBytes: small.length,
    });

    expect(ref.backend).toBe('db');
    expect((await streamToString(await store.get(ref))).length).toBe(small.length);
  });

  it('get/exists/delete follow the ref.backend tag back to the right store', async () => {
    const store = routed();
    const big = Buffer.alloc(2 * 1024 * 1024, 0x65);
    const ref = await store.put(big, { contentHash: sha256Hex(big), sizeBytes: big.length });

    expect(ref.backend).toBe('object');
    expect(await store.exists(ref)).toBe(true);
    await store.delete(ref);
    expect(await store.exists(ref)).toBe(false);
  });
});

describe('InMemoryContentStore (day-21 §2.2)', () => {
  it('round-trips and verifies, keyed by hash', async () => {
    const store = new InMemoryContentStore('object');
    const content = Buffer.from('small inline memory');
    const hash = sha256Hex(content);
    const ref = await store.put(content, { contentHash: hash, sizeBytes: content.length });

    expect(ref.backend).toBe('object');
    expect(await streamToString(await store.get(ref))).toBe('small inline memory');
  });
});
