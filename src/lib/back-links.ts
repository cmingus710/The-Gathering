/**
 * Section back links: every detail or nested page names its parent list or
 * overview here, so "Back to …" always goes up one level in the app's
 * hierarchy (never back in browser history, and never from the referrer).
 * A page reached from a notification, a bookmark, or a shared link gets the
 * same parent as one reached by browsing.
 *
 * Parents with a [segment] are filled from the page's own data (the plan a
 * day belongs to, the show an episode is in), which the page loaded under
 * the reader's own access, so the link never names something they can't
 * open. Top-level menu pages have no entry and no back link.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `orphan`: the parent when the page has none of its own (an episode outside any show, a post not in a group). */
type Entry = { parent: string; label: string; orphan?: { parent: string; label: string } };

export const BACK_ROUTES = {
  // Church life
  "/events/[id]": { parent: "/events", label: "Events" },
  "/events/calendar": { parent: "/events", label: "Events" },
  "/announcements/[id]": { parent: "/announcements", label: "Announcements" },
  "/give/campaigns/[id]": { parent: "/give", label: "Give" },
  "/giving/[id]": { parent: "/giving", label: "Your giving" },
  "/prayer/[id]": { parent: "/prayer", label: "Prayer" },
  "/prayer/[id]/edit": { parent: "/prayer/[id]", label: "the request" },
  "/prayer/new": { parent: "/prayer", label: "Prayer" },
  "/prayer/care": { parent: "/prayer", label: "Prayer" },
  "/prayer/care/new": { parent: "/prayer/care", label: "My care requests" },
  "/prayer/care/[id]": { parent: "/prayer/care", label: "My care requests" },
  "/prayer/serve": { parent: "/prayer", label: "Prayer" },
  "/prayer/serve/[id]": { parent: "/prayer/serve", label: "Ways to help" },
  "/prayer/team": { parent: "/prayer", label: "Prayer" },
  "/prayer/team/care/[id]": { parent: "/prayer/team", label: "the workspace" },

  // Connect
  "/community/t/[id]": { parent: "/community", label: "Community" },
  "/community/t/[id]/edit": { parent: "/community/t/[id]", label: "the post" },
  "/community/new": { parent: "/groups/[group]", label: "the group", orphan: { parent: "/community", label: "Community" } },
  "/community/guidelines": { parent: "/community", label: "Community" },
  "/groups/[id]": { parent: "/groups", label: "Groups" },
  "/groups/invitations": { parent: "/groups", label: "Groups" },
  "/groups/[id]/manage": { parent: "/groups/[id]", label: "the group" },
  "/groups/[id]/manage/reports": { parent: "/groups/[id]/manage", label: "Manage group" },
  "/groups/[id]/manage/reports/[reportId]": { parent: "/groups/[id]/manage/reports", label: "Reports" },
  "/messages/[id]": { parent: "/messages", label: "Messages" },
  "/messages/new": { parent: "/messages", label: "Messages" },
  "/messages/settings": { parent: "/messages", label: "Messages" },
  "/directory/[id]": { parent: "/directory", label: "Directory" },

  // You
  "/profile/edit": { parent: "/profile", label: "Profile" },
  "/profile/household": { parent: "/profile", label: "Profile" },
  "/profile/photo": { parent: "/profile", label: "Profile" },
  "/profile/preview": { parent: "/profile", label: "Profile" },
  "/profile/privacy": { parent: "/profile", label: "Profile" },
  "/profile/sign-in-methods": { parent: "/profile", label: "Profile" },
  "/notifications/settings": { parent: "/notifications", label: "Notifications" },
  "/journal/[id]": { parent: "/journal", label: "My Journal" },
  "/journal/new": { parent: "/journal", label: "My Journal" },

  // Teaching & media
  "/devotionals/[id]": { parent: "/devotionals", label: "Devotionals" },
  "/devotionals/archive": { parent: "/devotionals", label: "Devotionals" },
  "/lessons/[id]": { parent: "/lessons", label: "Sunday lessons" },
  "/lessons/[id]/workbook": { parent: "/lessons/[id]", label: "the lesson", orphan: { parent: "/lessons/workbooks", label: "My workbooks" } },
  "/lessons/series/[id]": { parent: "/lessons", label: "Sunday lessons" },
  "/lessons/workbooks": { parent: "/lessons", label: "Sunday lessons" },
  "/podcasts/shows/[id]": { parent: "/podcasts", label: "Podcasts" },
  "/podcasts/episodes/[id]": { parent: "/podcasts/shows/[show]", label: "the show", orphan: { parent: "/podcasts", label: "Podcasts" } },
  "/podcasts/external/[id]": { parent: "/podcasts/shows/[show]", label: "the show" },
  "/music/[id]": { parent: "/music", label: "Music & playlists" },
  "/reading/books/[id]": { parent: "/reading", label: "Books" },
  "/reading/assignments/[id]": { parent: "/reading", label: "Books" },
  "/gallery/[id]": { parent: "/gallery", label: "Media gallery" },
  "/gallery/mine": { parent: "/gallery", label: "Media gallery" },
  "/videos/[id]": { parent: "/videos", label: "Videos" },
  "/bible/plans/[id]": { parent: "/bible", label: "Bible reading" },
  "/bible/plans/[id]/catch-up": { parent: "/bible/plans/[id]", label: "the plan" },
  "/bible/day/[id]": { parent: "/bible/plans/[plan]", label: "the plan" },
  "/bible/bookmarks": { parent: "/bible", label: "Bible reading" },
  "/bible/read": { parent: "/bible", label: "Bible reading" },
  // The reader opens a chapter directly (/bible/read only redirects), so its parent is Bible reading.
  "/bible/read/[code]/[book]/[chapter]": { parent: "/bible", label: "Bible reading" },

  // Memory verses
  // The section's own tabs (My Verses, Collections, Review, Progress, Current verse, Settings) have no back link.
  "/memory/verses/[id]": { parent: "/memory/verses", label: "My Verses" },
  "/memory/verses/add": { parent: "/memory/verses", label: "My Verses" },
  "/memory/practice/[id]": { parent: "/memory/verses/[id]", label: "the verse" },
  "/memory/verses/[id]/translation": { parent: "/memory/verses/[id]", label: "the verse" },
  "/memory/collections/new": { parent: "/memory/collections", label: "Collections" },
  "/memory/collections/[id]": { parent: "/memory/collections", label: "Collections" },
  "/memory/challenges/[id]": { parent: "/memory", label: "Memory verses" },
  "/memory/lead": { parent: "/memory", label: "Memory verses" },
  "/memory/lead/challenges/new": { parent: "/memory/lead", label: "My group's memory verses" },
  "/memory/lead/challenges/[id]": { parent: "/memory/lead", label: "My group's memory verses" },
  "/memory/lead/collections/new": { parent: "/memory/lead", label: "My group's memory verses" },
  "/memory/lead/collections/[id]": { parent: "/memory/lead", label: "My group's memory verses" },
  "/memory/lead/collections/[id]/preview": { parent: "/memory/lead/collections/[id]", label: "the collection" },
  // The same pages for staff, under Administration.
  "/admin/memory/challenges/new": { parent: "/admin/memory", label: "Memory verses" },
  "/admin/memory/challenges/[id]": { parent: "/admin/memory", label: "Memory verses" },
  "/admin/memory/collections/new": { parent: "/admin/memory", label: "Memory verses" },
  "/admin/memory/collections/[id]": { parent: "/admin/memory", label: "Memory verses" },
  "/admin/memory/collections/[id]/preview": { parent: "/admin/memory/collections/[id]", label: "the collection" },

  // Youth & families
  // My account is one of the youth shell's own tabs: no back link.
  "/youth/announcements": { parent: "/youth", label: "Youth & Families" },
  "/youth/groups/[id]": { parent: "/youth", label: "Youth & Families" },
  "/youth/discussions/[id]": { parent: "/youth/groups/[group]", label: "the group" },
  "/youth/family": { parent: "/youth", label: "Youth & Families" },
  "/youth/family/request": { parent: "/youth/family", label: "Family dashboard" },
  "/youth/family/children/[id]": { parent: "/youth/family", label: "Family dashboard" },
  "/youth/family/children/[id]/practice": { parent: "/youth/family/children/[id]", label: "your child" },
  "/youth/family/children/[id]/events/[occurrence]": { parent: "/youth/family/children/[id]", label: "your child" },
  "/youth/lead": { parent: "/youth", label: "Youth & Families" },
  "/youth/lead/groups/[id]": { parent: "/youth/lead", label: "Leading youth" },
  "/youth/lead/events/[series]": { parent: "/youth/lead", label: "Leading youth" },
  "/youth/lead/events/[series]/logistics": { parent: "/youth/lead/events/[series]", label: "the event" },
  "/youth/lead/reports": { parent: "/youth/lead", label: "Leading youth" },
} as const satisfies Record<string, Entry>;

export type BackRoute = keyof typeof BACK_ROUTES;

export type BackTarget = { href: string; label: string };

/** Route segments the map fills: ids are UUIDs; Bible reader segments are short codes. */
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The parent of a page: `params` fills the [segments] of the parent path,
 * `query` adds approved list context (see RETURN_VIEWS), and `label`
 * replaces the generic one ("the plan") with a real name. Throws on an
 * unknown route or a segment that isn't a plain id, so a bad value can
 * never become a link to somewhere else.
 */
export function backTarget(
  route: BackRoute,
  opts: { params?: Record<string, string | null | undefined>; query?: Record<string, string | null | undefined>; label?: string | null } = {},
): BackTarget {
  const entry: Entry | undefined = BACK_ROUTES[route];
  if (!entry) throw new Error(`No back link for ${route}`);
  const keys = [...entry.parent.matchAll(/\[([A-Za-z]+)\]/g)].map((m) => m[1]);
  const orphan = entry.orphan && keys.some((k) => !opts.params?.[k]) ? entry.orphan : null;
  const href = (orphan ?? entry).parent.replace(/\[([A-Za-z]+)\]/g, (_, key: string) => {
    const value = opts.params?.[key];
    if (!value || !(UUID.test(value) || SEGMENT.test(value))) throw new Error(`Back link for ${route} needs a valid ${key}`);
    return encodeURIComponent(value);
  });
  const label = orphan ? orphan.label : opts.label?.trim() || entry.label;
  // Context the parent list is filtered by (a post's group), approved per list.
  const rule = RETURN_VIEWS.find((v) => v.path.test(href));
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value && rule?.params[key]?.(value)) query.set(key, value);
  }
  return { href: query.size ? `${href}?${query}` : href, label };
}

/**
 * Filters a parent list may come back with: the reader's own last view of
 * that list in this tab (see ReturnViewRecorder). Only these parameters,
 * well formed, are kept; a view of any other path is ignored.
 */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const SMALL_INT = /^\d{1,4}$/;
const oneOf = (...values: string[]) => (v: string) => values.includes(v);
const re = (pattern: RegExp) => (v: string) => pattern.test(v);

type Check = (value: string) => boolean;

export const RETURN_VIEWS: Array<{ path: RegExp; params: Record<string, Check> }> = [
  { path: /^\/events$/, params: { view: oneOf("list", "month"), category: re(UUID), month: re(MONTH) } },
  {
    path: /^\/prayer$/,
    params: {
      view: oneOf("feed", "mine", "following", "answered"),
      status: oneOf("active", "open", "answered", "closed", "archived", "all"),
      audience: oneOf("any", "church", "group", "team", "private"),
    },
  },
  { path: /^\/directory$/, params: { q: (v) => v.length <= 80, page: re(SMALL_INT) } },
  { path: /^\/community$/, params: { group: re(UUID), category: re(UUID) } },
  { path: /^\/podcasts$/, params: { show: re(SMALL_INT) } },
  { path: /^\/podcasts\/shows\/[0-9a-f-]{36}$/, params: { q: (v) => v.length <= 80, page: re(SMALL_INT) } },
  { path: /^\/music$/, params: { show: re(SMALL_INT) } },
  { path: /^\/devotionals$/, params: { date: re(DATE) } },
  { path: /^\/devotionals\/archive$/, params: { month: re(MONTH) } },
];

/** Whether the shell should remember this list view for a later back link. */
export function isReturnView(pathname: string): boolean {
  return RETURN_VIEWS.some((v) => v.path.test(pathname));
}

/**
 * The remembered view of `parentHref` when it is safe to use: the same
 * internal path (no host, no protocol-relative or backslash tricks), reduced
 * to its approved, well-formed filters. Otherwise null.
 */
export function validReturnView(parentHref: string, stored: string | null | undefined): string | null {
  if (!stored || stored.length > 300 || !stored.startsWith("/") || stored.startsWith("//") || stored.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(stored, "http://local.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "http://local.invalid" || url.hash) return null;
  const [parentPath, parentQuery] = parentHref.split("?");
  if (url.pathname !== parentPath) return null;
  const rule = RETURN_VIEWS.find((v) => v.path.test(url.pathname));
  if (!rule) return null;
  // A parent that names its own context (a post's group) keeps it: the view must agree.
  for (const [key, value] of new URLSearchParams(parentQuery)) if (url.searchParams.get(key) !== value) return null;
  // Only approved, well-formed filters come along; one-off flags (?deleted=1) and anything else are dropped.
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (!kept.has(key) && rule.params[key]?.(value)) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}
