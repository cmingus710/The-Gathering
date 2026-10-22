const PATH = /^\/[A-Za-z0-9/_-]*$/;
const COMMENT_QUERY = /^\?comment=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The redirect target for a notification click-through, or null if the RPC
 * returned anything but a same-origin path. Only one query string is allowed:
 * `?comment=<uuid>`, which reply notifications use to land on the post.
 */
export function safeNotificationUrl(data: unknown): string | null {
  if (typeof data !== "string") return null;
  const q = data.indexOf("?");
  const path = q === -1 ? data : data.slice(0, q);
  const query = q === -1 ? "" : data.slice(q);
  if (!PATH.test(path) || path.startsWith("//")) return null;
  if (query && !COMMENT_QUERY.test(query)) return null;
  return data;
}
