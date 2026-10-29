import type { Result } from './result';

/**
 * Private object storage (AD-4). Objects are never exposed through a public
 * bucket or any URL -- CAP-8 snapshots leave storage only as an email
 * attachment. Story 4 (lease documents) extends this port as needed.
 */
export interface ObjectStorage {
  put(input: { key: string; body: Uint8Array; contentType: string }): Promise<Result<void>>;
  get(key: string): Promise<Result<Uint8Array>>;
}
