import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ObjectStorage } from '@/ports/object-storage';
import { err, ok, type Result } from '@/ports/result';

export interface R2ObjectStorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * ObjectStorage backed by a private Cloudflare R2 bucket via the S3 API
 * (AD-4). The API token must be scoped to this one bucket with Object Read
 * & Write only. No presigner, no public access: objects leave storage only
 * as email attachments (CAP-8).
 *
 * The S3 client is built lazily on first use, and config is validated then
 * too -- this adapter is instantiated at module load (including during
 * `next build`, where R2 env vars may be empty), which must never fail.
 * Object bodies are never logged.
 */
export function createR2ObjectStorage(config: R2ObjectStorageConfig): ObjectStorage {
  let client: S3Client | null = null;

  function getClient(): Result<S3Client> {
    if (client) return ok(client);
    const missing = (['accountId', 'accessKeyId', 'secretAccessKey', 'bucket'] as const).filter(
      (key) => !config[key],
    );
    if (missing.length > 0) {
      return err({
        code: 'OBJECT_STORAGE_NOT_CONFIGURED',
        message: `Object storage is not configured (missing: ${missing.join(', ')}).`,
      });
    }
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    return ok(client);
  }

  return {
    async put({ key, body, contentType }): Promise<Result<void>> {
      const clientResult = getClient();
      if (!clientResult.ok) return clientResult;
      try {
        await clientResult.value.send(
          new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType }),
        );
        return ok(undefined);
      } catch (cause) {
        return err({
          code: 'OBJECT_STORAGE_PUT_FAILED',
          message: cause instanceof Error ? cause.message : 'Failed to store object.',
          cause,
        });
      }
    },

    async get(key): Promise<Result<Uint8Array>> {
      const clientResult = getClient();
      if (!clientResult.ok) return clientResult;
      try {
        const response = await clientResult.value.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        if (!response.Body) {
          return err({ code: 'OBJECT_STORAGE_GET_FAILED', message: 'Stored object has no body.' });
        }
        return ok(await response.Body.transformToByteArray());
      } catch (cause) {
        if (cause instanceof Error && cause.name === 'NoSuchKey') {
          return err({ code: 'NOT_FOUND', message: 'Stored object not found.', cause });
        }
        return err({
          code: 'OBJECT_STORAGE_GET_FAILED',
          message: cause instanceof Error ? cause.message : 'Failed to read object.',
          cause,
        });
      }
    },
  };
}

export function createR2ObjectStorageFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  return createR2ObjectStorage({
    accountId: env.R2_ACCOUNT_ID ?? '',
    accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
    bucket: env.R2_BUCKET ?? '',
  });
}
