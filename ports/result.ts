/**
 * Shared Result<T, PortError> contract (AD-1).
 *
 * Every port method returns this shape instead of throwing, so two adapters
 * implementing the same port are interchangeable from core's point of view,
 * including on failure. Adapters must catch their own underlying exceptions
 * (network errors, driver errors, third-party SDK throws, ...) and translate
 * them into a `PortError` here -- nothing crosses a port boundary as a raw
 * throw.
 */

export interface PortError {
  /** Stable machine-readable code, e.g. "NOT_FOUND", "VALIDATION", "UPSTREAM_UNAVAILABLE". */
  code: string;
  /** Human-readable detail; never includes secrets or PAN-like data (AD-4). */
  message: string;
  /** Optional original cause, kept out of PortError.message so logs stay structured. */
  cause?: unknown;
}

export type Result<T, E = PortError> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
