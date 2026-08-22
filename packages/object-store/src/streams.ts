import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';

import { ContentIntegrityError } from './content-store.js';

/** SHA-256 of `bytes`, hex-encoded (the content-addressed key). */
export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Drain a {@link Readable} into a single Buffer (available memory permitting). */
export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/** Drain a {@link Readable} and decode it as UTF-8 text. */
export async function streamToString(stream: Readable): Promise<string> {
  return (await streamToBuffer(stream)).toString('utf8');
}

/**
 * Wrap `source` in a pass-through that hashes the bytes as they stream and
 * rejects with {@link ContentIntegrityError} if the final digest differs from
 * `expectedHash`. Streaming: the hash is updated per-chunk, so a large object
 * is never buffered in full to verify it.
 */
export function verifyOnRead(source: Readable, expectedHash: string): Readable {
  const hash = createHash('sha256');
  let actual = '';

  const verifier = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      actual = hash.digest('hex');
      if (actual !== expectedHash) {
        callback(new ContentIntegrityError(expectedHash, actual));
      } else {
        callback();
      }
    },
  });

  // A fetch/stream failure becomes a stream error, not a hung pipe.
  source.on('error', (error) => verifier.destroy(error));
  return source.pipe(verifier);
}
