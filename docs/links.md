# Hyperlinks in what members and editors write

One shared way to add, edit, and show links across:

| Module | Editor | Rendered by |
| --- | --- | --- |
| Announcements / news | `admin/announcements/announcement-form.tsx` (`LinkTextAreaField`) | `renderAnnouncementMarkdown` (`MarkdownBody`) |
| Devotionals, Sunday lessons (text and member notes) | `admin/content/content-form.tsx` (`LinkTextAreaField`) | `renderAnnouncementMarkdown` |
| Lesson / workbook blocks | `admin/content/[id]/builder/lesson-builder.tsx` (`LinkTextAreaField`) | `renderAnnouncementMarkdown` (workbook view) |
| Community posts, comments, replies | `MentionTextarea` | `renderCommunityText` |
| Prayer requests, updates, comments | `MentionTextarea` | `renderCommunityText` |

Each module keeps its existing stored format (Markdown) and its existing safe renderer; links are stored as `[text](address)`. Nobody types that syntax: the tools below write it.

## For editors and members

- **Insert link**: select words, then the **Insert link** button (or Ctrl/⌘+K). In the admin editors it sits just above the text box, after any other formatting buttons (see `docs/screenshots/links/lesson-toolbar.png`); under Community and Prayer boxes it is just below. A small dialog asks for *Text to show* (filled from the selection) and *Link address*. With nothing selected, leave the text empty and the address is shown. Accepted: `https://…`, `www.example.org`, `example.org/give`, a page in The Gathering (`/events`, or the site's own full address), an email address, or a phone number.
- **Paste**: paste an address over selected words to link them. A standalone web address pastes as itself and shows as a link when published. Copied web content with links becomes the same links; everything else in it (scripts, styles, images, embeds, attributes) is dropped. Only the paste itself is read: no clipboard permission is asked for.
- **Edit / Open / Remove**: put the caret (tap or arrow keys) inside a link and a bar under the box offers *Edit*, *Open* (in a new tab), and *Remove link* (the words stay). Tab from the box reaches the bar.
- Undo and redo (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z) include every link change. The browser groups consecutive edits made without moving the caret, exactly as it does for typing.
- Links never wrap or change an @mention: a selection that touches a mention is not wrapped, and mention IDs and notifications are untouched.

## What readers get

- Pages in The Gathering open with the app's own navigation (`ProseLinkNavigation`). If something on the page is unsaved (a comment being written, an edited lesson block) or the link is in an editor's preview, it opens in a new tab instead, so nothing is lost.
- Other websites open in a new tab with `rel="noopener noreferrer nofollow"` (plus `ugc` for member writing), a small arrow, and "(opens in a new tab)" for screen readers.
- Email and phone links open the device's mail or phone app.
- No previews, cards, or embeds are created from links; existing explicit embeds are unchanged.
- No card in the feeds wraps its body in a link, so links in posts, comments, and announcements are always independently usable.

## Security

`src/lib/links/policy.ts` is the single rule, used by the dialog, paste, both renderers, and every save action:

- Allowed: same-site paths (not `//host`, no backslashes or control characters), `http`/`https` without user name or password, `mailto:` with a valid address, `tel:` with 3–15 digits.
- Refused: everything else, including `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`.
- The server checks again on save (`linkProblem` / `withSafeLinks` in `src/lib/links/validate.ts`) in announcements, content, lesson blocks, Community threads and replies, and prayer requests, updates, and comments. A refused link stops the save with a message naming it; the text is kept.
- Rendering never emits raw HTML (it's escaped), event handlers, or iframes. Nothing fetches a link's destination. A link to restricted content is only an address: the page it opens checks access as always.
- Permissions are unchanged: who may write, edit, or see each item, anonymous prayer handling, teacher-only notes (no link tools there), and youth safeguards all work as before.

## Changes in behavior

- Phone links (`tel:`) are now allowed in Community and Prayer (they were already allowed in announcements and content).
- Announcement and content links to other sites now open in a new tab.
- Links with credentials (`https://user@host`) or malformed `mailto:`/`tel:` now render as text in announcements and content too. Existing content is otherwise rendered exactly as before.

## Verification

- Unit tests: `src/lib/links/links.test.ts` (policy, Markdown building and finding, pasted-HTML conversion, rendering, server check) plus updated renderer tests.
- Browser (Chromium, desktop and Pixel 7, light and dark): the shared editor in both shapes (`LinkTextAreaField`, `MentionTextarea`) with the real renderers — insert with and without a selection, formatting inside links, unsafe addresses refused, Cancel and Escape (focus and selection restored), edit, remove, undo/redo, paste over a selection, standalone paste, HTML paste, mentions kept, new-tab and app navigation, unsaved-writing protection, keyboard-only use, 44px touch targets, no horizontal overflow. Screenshots: `docs/screenshots/links/`.
- Not run here: the signed-in walkthrough against a local Supabase stack (container images couldn't be downloaded in this environment). Run `tests/e2e-local` per `docs/phase-11-release-readiness.md` before release, and check on a real iPhone and Android phone (on-screen keyboard and selection).
