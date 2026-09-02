import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { ObjectStoreUnavailableError } from '../content-store.js';
import type { ContentRef, ContentStore } from '../content-store.js';
import { InMemoryContentStore } from '../in-memory-content-store.js';
import { ObjectStoreContentStore } from '../object-store-content-store.js';
import type { S3ClientPort } from '../object-store-content-store.js';
import { RoutingContentStore } from '../routing-store.js';
import { sha256Hex } from '../streams.js';

const THRESHOLD = 1024 * 1024; // 1 MiB
const FALLBACK_MAX = 5 * 1024 * 1024; // 5 MiB — the degrade band ceiling

/** An object backend that is simply down: every write throws the typed error. */
class DownObjectStore implements ContentStore {
  async put(): Promise<ContentRef> {
    throw new ObjectStoreUnavailableError('minio down');
  }

  async get(): Promise<Readable> {
    return Readable.from([]);
  }

  async delete(): Promise<void> {}

  async exists(): Promise<boolean> {
    return false;
  }
}

/** An object backend that fails with a *plain* error (not an availability event). */
class BugObjectStore implements ContentStore {
  async put(): Promise<ContentRef> {
    throw new Error('unexpected bug');
  }

  async get(): Promise<Readable> {
    return Readable.from([]);
  }

  async delete(): Promise<void> {}

  async exists(): Promise<boolean> {
    return false;
  }
}

/** An S3 port whose every verb rejects — the network/bucket is gone. */
class FailingS3Port implements S3ClientPort {
  async putObject(): Promise<void> {
    throw new Error('connection refused');
  }

  async getObject(): Promise<Readable> {
    throw new Error('connection refused');
  }

  async objectExists(): Promise<boolean> {
    throw new Error('connection refused');
  }

  async deleteObject(): Promise<void> {
    throw new Error('connection refused');
  }
}

/** A small mutable counter the store's callbacks bump (observable signals). */
function counters(): {
  fallback: number;
  error: number;
  onFallback: () => void;
  onError: () => void;
} {
  const counts = { fallback: 0, error: 0 };
  return {
    get fallback() {
      return counts.fallback;
    },
    get error() {
      return counts.error;
    },
    onFallback: () => {
      counts.fallback += 1;
    },
    onError: () => {
      counts.error += 1;
    },
  };
}

describe('RoutingContentStore failure injection (day-26 §3.2)', () => {
  function makeStore(counter: ReturnType<typeof counters>): RoutingContentStore {
    return new RoutingContentStore(new InMemoryContentStore('db'), new DownObjectStore(), THRESHOLD, {
      dbFallbackMaxBytes: FALLBACK_MAX,
      onFallback: counter.onFallback,
      onError: counter.onError,
    });
  }

  it('small content is db-primary and never consults the (down) object store', async () => {
    const counter = counters();
    const store = makeStore(counter);

    const small = Buffer.alloc(50 * 1024, 0x64);
    const ref = await store.put(small, { contentHash: sha256Hex(small), sizeBytes: small.length });

    expect(ref.backend).toBe('db');
    expect(counter.fallback).toBe(0);
    expect(counter.error).toBe(0);
  });

  it('content in the degrade band (threshold < size <= dbFallbackMax) falls back to db', async () => {
    const counter = counters();
    const store = makeStore(counter);

    const medium = Buffer.alloc(2 * 1024 * 1024, 0x63); // 2 MiB — over threshold, under band
    const ref = await store.put(medium, {
      contentHash: sha256Hex(medium),
      sizeBytes: medium.length,
    });

    expect(ref.backend).toBe('db'); // a *successful* degrade, not a half object
    expect(counter.fallback).toBe(1);
    expect(counter.error).toBe(1); // the object backend still failed
  });

  it('oversized content fails closed with ObjectStoreUnavailableError (never partial)', async () => {
    const counter = counters();
    const store = makeStore(counter);

    const large = Buffer.alloc(10 * 1024 * 1024, 0x65); // 10 MiB — over the band
    await expect(store.put(large, { contentHash: sha256Hex(large), sizeBytes: large.length })).rejects.toBeInstanceOf(
      ObjectStoreUnavailableError,
    );

    expect(counter.error).toBe(1);
    expect(counter.fallback).toBe(0); // no degrade — it must fail closed
  });

  it('does not mask a non-availability error (a plain bug propagates, no degrade)', async () => {
    const counter = counters();
    const store = new RoutingContentStore(new InMemoryContentStore('db'), new BugObjectStore(), THRESHOLD, {
      dbFallbackMaxBytes: FALLBACK_MAX,
      onFallback: counter.onFallback,
      onError: counter.onError,
    });

    const content = Buffer.alloc(2 * 1024 * 1024, 0x62);
    await expect(store.put(content, { contentHash: sha256Hex(content), sizeBytes: content.length })).rejects.toThrow(
      /unexpected bug/,
    );

    expect(counter.fallback).toBe(0);
    expect(counter.error).toBe(0);
  });
});

describe('ObjectStoreContentStore availability surfacing (day-26 §3.2)', () => {
  it('put wraps a port failure as ObjectStoreUnavailableError', async () => {
    const store = new ObjectStoreContentStore(new FailingS3Port());
    const content = Buffer.from('x');

    await expect(
      store.put(content, { contentHash: sha256Hex(content), sizeBytes: content.length }),
    ).rejects.toBeInstanceOf(ObjectStoreUnavailableError);
  });

  it('get wraps a port failure as ObjectStoreUnavailableError (not ContentIntegrityError)', async () => {
    const store = new ObjectStoreContentStore(new FailingS3Port());

    await expect(store.get({ hash: 'a'.repeat(64), backend: 'object' })).rejects.toBeInstanceOf(
      ObjectStoreUnavailableError,
    );
  });
});
