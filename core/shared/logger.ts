/**
 * Minimal structured logger core can depend on. Callers must never pass
 * CSV contents, attachment buffers, PAN, or payment credentials (AD-4).
 */
export interface Logger {
  error(event: string, fields?: Record<string, unknown>): void;
}

/** Structured JSON to stderr -- the default wired at the app layer. */
export const consoleJsonLogger: Logger = {
  error(event, fields = {}) {
    console.error(JSON.stringify({ level: 'error', event, ...fields }));
  },
};
