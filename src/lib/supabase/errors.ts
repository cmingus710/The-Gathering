type DbError = { code?: string; message?: string } | null | undefined;

/**
 * Our own database functions raise clear, member-safe messages with these
 * codes. Anything else (constraint names, internal errors) is replaced with a
 * generic message so internals never leak to the browser.
 */
const SAFE_CODES = new Set(["42501", "P0001", "P0002", "22023"]);

export function dbErrorMessage(error: DbError, fallback = "That change couldn't be saved. Please try again."): string {
  if (error?.code && SAFE_CODES.has(error.code) && error.message) return error.message;
  return fallback;
}
