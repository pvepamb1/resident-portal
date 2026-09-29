import { describe, expect, it } from 'vitest';
import { createR2ObjectStorage, createR2ObjectStorageFromEnv } from './r2-object-storage';

describe('createR2ObjectStorage', () => {
  it('constructs without config (next build must not fail) and returns a typed error on use', async () => {
    const storage = createR2ObjectStorageFromEnv({} as NodeJS.ProcessEnv);

    const put = await storage.put({ key: 'k', body: new Uint8Array([1]), contentType: 'text/csv' });
    const get = await storage.get('k');

    expect(put.ok).toBe(false);
    if (!put.ok) expect(put.error.code).toBe('OBJECT_STORAGE_NOT_CONFIGURED');
    expect(get.ok).toBe(false);
    if (!get.ok) expect(get.error.code).toBe('OBJECT_STORAGE_NOT_CONFIGURED');
  });

  it('names only which settings are missing, never their values', async () => {
    const storage = createR2ObjectStorage({ accountId: 'acct', accessKeyId: '', secretAccessKey: 'sekrit', bucket: 'b' });
    const result = await storage.get('k');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('accessKeyId');
      expect(result.error.message).not.toContain('sekrit');
    }
  });
});
