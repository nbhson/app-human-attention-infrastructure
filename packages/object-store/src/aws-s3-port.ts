import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

import type { S3ClientPort } from './object-store-content-store.js';

/** The subset of S3/MinIO connection settings the port needs. */
export interface S3ClientPortConfig {
  readonly bucket: string;
  readonly endpoint?: string;
  readonly region?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly forcePathStyle?: boolean;
}

/**
 * The real S3/MinIO adapter — the only place this package imports the SDK, so
 * every layer above it is testable against a fake {@link S3ClientPort}.
 */
export class AwsS3ClientPort implements S3ClientPort {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: S3ClientPortConfig) {
    this.bucket = config.bucket;

    // Build the client config incrementally so `exactOptionalPropertyTypes`
    // never sees an explicit `undefined` for an optional property.
    const clientConfig: {
      region: string;
      endpoint?: string;
      forcePathStyle: boolean;
      credentials?: { accessKeyId: string; secretAccessKey: string };
    } = {
      region: config.region ?? 'us-east-1',
      forcePathStyle: config.forcePathStyle ?? true,
    };
    if (config.endpoint !== undefined) {
      clientConfig.endpoint = config.endpoint;
    }
    if (config.accessKeyId !== undefined) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey ?? '',
      };
    }

    this.s3 = new S3Client(clientConfig);
  }

  async putObject(key: string, body: Buffer, contentLength: number): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentLength: contentLength,
      }),
    );
  }

  async getObject(key: string): Promise<Readable> {
    const output = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!output.Body) {
      throw new Error(`object ${key} in ${this.bucket} returned no body`);
    }
    return output.Body as Readable;
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
