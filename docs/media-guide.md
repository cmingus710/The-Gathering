# Teaching, media, and publishing: administration guide (Phase 7)

This guide covers the media library and the teaching sections: Devotionals, Sunday lessons, Videos, church podcast episodes, Books, and Music & playlists. Podcast shows and feeds are covered in [podcast-guide.md](podcast-guide.md), the Media gallery in [gallery-guide.md](gallery-guide.md), publishing and attaching videos in [videos-guide.md](videos-guide.md), and what members see and what outside services can and can't do in [media-limitations.md](media-limitations.md).

## Where things are

| Task | Location | Needs |
| --- | --- | --- |
| Write and edit drafts | **Admin → Teaching content** (`/admin/content`, `/admin/content/new`) | `content.edit` |
| Publish, schedule, unpublish, archive, set expiry | The **Publishing** panel on each item (`/admin/content/<id>`) | `content.publish` |
| Preview as members will see it | **Preview as members will see it** on the item (`/admin/content/<id>/preview`) | `content.edit` or `content.publish` |
| Calendar of scheduled and published items | `/admin/content/calendar` | `content.edit` or `content.publish` |
| Series, people (speakers, authors, hosts), topics | `/admin/content/library` | `content.edit` |
| Upload files, rights, captions, transcripts, replace, remove | **Admin → Media library** (`/admin/media`, `/admin/media/<id>`) | `media.manage` |
| Storage usage and cleanup | `/admin/media/cleanup` | `media.manage` |
| Upload limits, quota, feed refresh interval, gallery limits | `/admin/media/settings` | `media.manage` (gallery limits: `gallery.moderate`; feed interval: `podcasts.manage`) |

## Roles and permissions

Super administrators hold all five Phase 7 capabilities. Everyone else gets them through these roles (assigned under **Admin → Members → Roles**; every grant is audited):

| Role | Capabilities | Can | Can't |
| --- | --- | --- | --- |
| Content editor (Phase 1 role, extended) | `announcements.manage`, `content.edit` | Draft and edit teaching content; preview; manage series, people, topics | Publish, schedule, or make anything public; change a published item |
| Content publisher | `content.edit`, `content.publish` | Everything above plus publish, schedule, unpublish, archive, expiry, featured; choose **Public** (with confirmation) | Upload files (needs media manager), manage podcasts or galleries |
| Media manager | `media.manage` | Upload, describe, set rights, add captions and transcripts, replace, remove unused files, review storage and cleanup | Publish content |
| Podcast manager | `podcasts.manage` | Shows, external feeds, the public RSS feed | Publish episodes (needs `content.publish`) |
| Media gallery moderator | `gallery.moderate` | Albums, photo review, album videos, reports | Anything outside the Media gallery |
| Event coordinator (Phase 4) | `events.manage` | Create albums linked to events | Approve photos |

None of these capabilities opens private messages, prayer, care, journals, giving, or member records. Listening history and bookmarks are private to each member; there is no admin view of who watched or listened to what.

## Publishing workflow

1. **Draft.** An editor creates the item and fills in title, summary, body (Markdown), cover image and alt text, people, topics, series, tags, and scripture references (normalized, e.g. "John 3:16–18"). Kind-specific fields: devotional date, lesson date, episode and season numbers, book author and Audible link, assignment start and end dates and instructions, Spotify playlist link.
   **Cover image** (content editor and series editor): **Upload image** sends a file from this device (desktop file picker, or the phone's photo/file picker) through the normal library pipeline (same limits, checks, and re-encoding; media manager role only) and selects it when it's ready; **Choose from media library** opens a searchable picker of ready images. The current cover stays until a replacement finishes uploading, a failed upload can be retried without losing anything typed on the page, and **Remove** only detaches the image (the library file is kept). Nothing changes, and nothing is published, until the form is saved. A cover not approved for public use isn't shown to visitors on public content.
2. **Attach files** from the library. Each attachment has a role (audio, video, handout, slides, resource). Attachments are **members-only by default**; only files with confirmed rights and **Allowed for public use** reach visitors on a public item. **Videos** (several per item, ordered, each with an optional caption) are chosen in the editor's **Videos** section from the library or by pasting a YouTube/Vimeo link, also for church books and reading assignments; see [videos-guide.md](videos-guide.md).
3. **Preview.** The preview renders exactly the member page (without bookmarks or progress).
4. **Publish or schedule** (publisher). With a future publish time the item becomes **Scheduled** and goes live at that time without anyone opening the app: the database scheduler (`events-worker`, every 5 minutes) runs `media.tick()`, and every page applies the publish and expiry times on each read. Optional **expiry** hides the item afterwards.
5. **Audience.** **Approved members** is the default. **One group** limits it to that group's active members. **Public** is for devotionals, lessons, and church episodes only, needs a publisher, and requires typing the confirmation. Books, assignments, and playlists can't be public; galleries are never public.
6. **Notify.** "Notify people when it goes live" sends one notice, once, at publish time, to people who can see it and haven't muted that kind. Items that went live more than 3 days earlier (back-catalog) never notify.
7. **Unpublish / archive / restore.** Unpublishing returns the item to draft. Archiving hides it everywhere (lists, search, bookmarks, history, related links, notifications, files, RSS).

Access is rechecked on every read: if an item's audience narrows, or a member leaves a group or loses approval, the item and its files, captions, transcripts, covers, playback links, bookmarks, history entries, related links, and unread notifications stop being visible to them at once.

## Media library

- **Uploads go straight from the browser to private Supabase Storage** with a one-time signed token, never through the app server. Files over 6 MB use resumable (TUS) uploads; each file shows progress and can be cancelled or retried without creating duplicates.
- **Server-side checks after upload:** the stored bytes are sniffed (the declared type and extension aren't trusted), sizes are checked against the limits, images are re-encoded (removing location and camera data), and audio/video duration and dimensions are recorded. Status moves uploading → processing → ready, or failed with a reason.
- **Accepted:** audio MP3/M4A (AAC); video MP4 (H.264/AAC); images JPEG/PNG/WebP/HEIC; documents PDF and PPTX (no macros); captions WebVTT (sanitized). YouTube and Vimeo videos are added as **external references** (no file is stored). Adding a link that is already in the library reuses the existing record. A library file is never shown to members on its own: publish a video with **Publish for members…** on its page, attach it to content, or add it to a Media gallery album ([videos-guide.md](videos-guide.md)).
- **Transcripts** are added on the file's page (paste or generate from a caption file).
- **Usage before removal:** each file lists every item, show, or series using it. A file in use can't be removed; **Replace** swaps it everywhere at once and keeps the old file until you remove it.
- **Rights:** source, attribution, rights type (church owned, licensed, used with permission, public domain), and notes. Rights must be confirmed before a file can be marked for public use, and before an item using church-hosted media can be published.

## Storage, delivery, and costs

- **Buckets:** `media` (private; published files) and `media-uploads` (private quarantine for gallery originals). Neither is public. **No member media is stored in GitHub.**
- **Delivery:** the app checks access, then redirects to a short-lived signed URL: images 5 minutes, audio/video/documents 30 minutes. Signed URLs work for anyone holding them until they expire, so a member could share a link for up to that long; responses are `private, no-store` and the URLs are never logged by the app.
- **Video:** progressive MP4 served from Supabase Storage. There is **no transcoding and no adaptive streaming**, and no paid video provider was added. On the **Free plan** the per-file limit is **50 MB** (roughly 10–15 minutes of 720p), total storage **1 GB**, and egress **5 GB/month**. Long sermon video belongs on **YouTube or Vimeo** (added as external references), with church-hosted audio for listening.
- **Costs if the church upgrades:** Supabase Pro ($25/month) includes 100 GB storage and 250 GB egress, then about **$0.021 per GB-month** of storage and **$0.09 per GB** of egress. Example: 50 one-hour audio sermons at 64 kbps mono ≈ 1.4 GB stored; 500 full listens ≈ 14 GB egress. A dedicated video service (Mux, Cloudflare Stream, Bunny Stream) would add transcoding and adaptive streaming at extra cost; it is **not configured**.
- **Usage report:** `/admin/media/cleanup` shows total bytes by kind against the soft quota in settings.

## Cleanup and retention

Cleanup is **manual and reviewed**: `/admin/media/cleanup` lists candidates (failed uploads, uploads abandoned longer than the setting, removed or replaced files no longer in use), and a media manager deletes them with their own session after review. Nothing is deleted automatically, and no destructive cleanup has been run on existing data. Before automating any retention, the church should adopt a written retention policy.

## Book collections

A book's **Topics** (Organize section) also group it into collections on the member Books page; a book with several topics appears in each. Topic names ignore capitalization and extra spaces, and Tags stay search-only. Details: [book-collections.md](book-collections.md).

## Lesson builder and member workbooks (Phase 13)

A Sunday lesson can also be built as ordered **blocks** that members open as a private **workbook**. Details, the teacher and member guides, and the version rules are in [phase-13/lessons-workbook.md](phase-13/lessons-workbook.md).

- **Where:** the **Lesson builder** card on a lesson's editor page (`/admin/content/<id>/builder`), with **Preview the member workbook** (`/admin/content/<id>/builder/preview`). Same rules as other content: editors (`content.edit`) change draft lessons; changing a scheduled or published lesson's blocks needs `content.publish`; publishing still happens in the **Publishing** panel.
- **Teacher-only content:** each block has a **Teacher note**, and a whole block can be marked **Hide this whole block from members**. Both are marked "Teacher only — never shown to members" and are never part of anything a member (or visitor) receives, including the preview. The lesson's existing **Notes shown to members** field (formerly "Notes") is unchanged: members, and visitors for a public lesson, see it on the lesson page.
- **Files in blocks:** image and media blocks use ready files from the media library (YouTube and Vimeo only as external video references; no embedded HTML). A file used by a block counts as **in use** in the library (it can't be removed), **Replace** moves blocks to the new file too, and a block's file is shown only to approved members who can open the workbook (even on a public lesson).
- **Answers are private:** no role, including super administrators, can read members' workbook answers or notes, or counts of them.
