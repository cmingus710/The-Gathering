# Forum photo and video attachments (Phase 13)

Members can add photos and MP4 video to new community discussions and replies, in church-wide categories and in private groups. Attachments follow exactly the same access rules as the post text, are served only through an access-checked route, and reuse the Phase 7 media pipeline (buckets, upload client, image processing, signed URLs). Member and moderator guidance: [community-moderation-guide.md](../community-moderation-guide.md#photos-and-videos-in-discussions-phase-13).

Migration: `supabase/migrations/20261031000200_community_attachments.sql`. Hosted apply script: `supabase/manual/2026-10-31-apply-community-attachments.sql` (needs 20261030000100 recorded; independent of other Phase 13 steps; records `created_by = 'phase-13'`).

## Limits

| | Limit | Where enforced |
| --- | --- | --- |
| Per post (discussion or reply) | 6 attachments, at most 2 videos | composer, `community_attachment_begin` (per draft batch), `community.attach_media` (per post) |
| Photo | JPEG, PNG, WebP, HEIC/HEIF; ≤ 20 MB input | composer, begin, processing (stored size), `processImage` (≤ 50 megapixels, no animation) |
| Video | MP4 with H.264 only; ≤ 50 MB (the `media` bucket's limit) | composer (bytes checked before upload), begin (MIME), server check of the stored bytes |
| Photo description (alt text) | ≤ 300 characters | composer, `community.attach_media` |
| Open drafts (uploaded, not posted) | 18 per member | begin |
| Rate | 40 uploads per hour per member (`community.rate_limit`, action `attachment`) | begin |
| Who can upload | Approved adult members who have accepted the guidelines and aren't restricted from posting (`community.require_poster`) | every lifecycle step |

HEIC photos are decoded on the server (sharp, or libheif for iPhone HEVC-compressed HEIC), oriented, converted to sRGB, stripped of all metadata (EXIF, GPS, XMP, IPTC, ICC), and stored as WebP: a display copy (≤ 2048 px) and a thumbnail (≤ 480 px). The original is deleted as soon as the copies are stored.

Video is not transcoded. `.mov` (QuickTime), HEVC/H.265 ("High Efficiency" on iPhone), Dolby Vision, AV1, VP8/VP9, and MPEG-4 Part 2 are refused with: "This video format can't be played on every device; export as MP4 (H.264) and try again." The check (`checkForumVideo` in `src/lib/community/attachments.ts`) reads the `ftyp` brand and the sample-entry codec of every `stsd` box in the first and last 1 MB; a file whose codec can't be confirmed as H.264 there is refused too. No poster frame is generated; players show the first frame (`preload="metadata"`, never autoplay).

## Design

### Table `community.attachments`

One row per uploaded file. Owner, draft `batch_key` (one composer draft) and `client_key` (idempotent retries), `kind` (`image` | `video`), `status` (`uploading` → `processing` → `ready` → `attached`; or `failed`; `removed`), target (`target_type` `thread` | `post`, `thread_id`, `post_id`; null until attached), `upload_bucket`/`upload_path` (the original while it exists), `display_path`/`thumb_path` (photos) or `video_path`, `mime`, `size_bytes`, `width`/`height`, `duration_seconds` (from the browser, advisory), `alt_text`, `sort_order`, `content_hash` (SHA-256 of the photo original), timestamps, `removed_at`, `objects_deleted_at`. No API grants; RLS on; reached only through functions.

Storage layout (existing buckets, no new bucket):

| File | Bucket | Path |
| --- | --- | --- |
| Photo original (quarantine) | `media-uploads` | `community/<owner>/<id>/original.<ext>` |
| Photo display / thumbnail | `media` | `community/<owner>/<id>/v-<random>-display.webp`, `…-thumb.webp` |
| Video | `media` | `community/<owner>/<id>/video.mp4` |

### Functions (all `security definer`, `search_path = ''`, executable by `authenticated` only)

| Function | Purpose |
| --- | --- |
| `community_attachment_begin(batch, client_key, kind, mime, size, width?, height?, duration?)` | Register a draft and its upload path (limits, rate limit, posting rules). A retried key returns the same row. |
| `community_attachment_processing(id)` | Owner only; verifies the stored object and its size; status → processing. |
| `community_attachment_ready(id, display?, thumb?, width?, height?, size?, hash?)` | Photos: verifies both WebP copies exist under the attachment's own prefix. Video: the upload becomes the served file. Returns the original's path for the app to delete. |
| `community_attachment_fail(id, error)` | Marks an upload failed (kept for Retry when the cause was storage, not the file). |
| `community_attachment_discard(id)` | Cancel or remove before posting; returns the stored paths. Refused for posted attachments. |
| `community_attachments_objects_deleted(ids[])` | Records that files are gone, checked against `storage.objects` itself. Never-posted drafts leave no row; posted ones keep a tombstone. |
| `community_thread_create_with_media(category, group, title, body, client_key, ids[], alts[])` | Calls the unchanged `community_thread_create`, then attaches, in one transaction. |
| `community_reply_with_media(thread, body, client_key, ids[], alts[])` | Same for `community_reply`. |
| `community_thread_delete_with_media(id)` / `community_reply_delete_with_media(id)` | Call the unchanged delete functions; return the removed attachments' paths. |
| `community_thread_attachments(thread)` | `{thread: [...], posts: {post_id: [...]}}` of what the caller may see now; never storage paths. Null if the thread isn't readable. |
| `community_attachment_file(id, variant)` | The path behind one variant if the caller may see it now (used by the serving route). |
| `community_mod_attachment_cleanup()` / `community_mod_attachment_discard(ids[])` | Cleanup listing and discard (community moderators and media managers). |
| `community_attachment_can_read_object` / `_write_object` / `_delete_object` | Storage policy checks for `community/` paths. |

Attaching (`community.attach_media`): only the caller's own `ready`, unattached drafts, to the discussion or reply they just created (so the existing posting rules decide whether they may post there: group membership, active group, lock, guidelines, restrictions, rate limits). Someone else's id, an attached id, or one still uploading fails the whole post; nothing is created. Retrying the same post (same client key) finds the attachments already attached.

Existing signatures are untouched. One existing function body changes: `public.media_can_read_object` returns false for files under `community/` in the `media` bucket, so media managers' library rule doesn't extend to discussion files.

### Who sees an attachment (`community.attachment_visible`)

- Draft (uploading, processing, ready, failed): its owner only.
- Attached: the caller is an approved adult member who can read the thread (`community.can_read_thread`: church-wide, or an active member of the group), **and**
  - the thread isn't hidden, or the caller moderates it (`community.can_moderate_thread`: community moderators, the group's leaders);
  - for a reply: it isn't deleted, and isn't hidden unless the caller moderates the thread;
  - for the discussion's own media: the discussion isn't deleted.
- Removed: nobody (except the owner and cleanup roles reading the file only so Storage lets them delete it).

This mirrors `community.post_json` / `community_thread`: hidden text goes only to moderators in scope (not even the author), deleted text to nobody. Losing group membership removes access at once.

### Serving

`GET /api/community/attachments/<id>?variant=thumb|display|video` (`src/app/api/community/attachments/[id]/route.ts`): signed-in only; calls `community_attachment_file` as the member; then creates a signed URL **with the member's own session** (Storage RLS checks the same rule again; no service role anywhere) and answers `302` with `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`. Photos: 5-minute links; video: 30 minutes (`IMAGE_URL_TTL`, `PLAYBACK_URL_TTL`). Anything not allowed is a plain 404, the same as an id that doesn't exist, so guessing ids reveals nothing. A link already handed out keeps working until it expires; deleting the files stops it at once.

Storage policies (`storage.objects`, `to authenticated`, `community/%` in `media`/`media-uploads` only):
- read: `community_attachment_can_read_object` (the visibility rule above; the owner's own upload while processing; removed files for owner/cleanup roles so deletes work);
- insert: only the exact registered upload path by its owner while `uploading`, and the owner's `v-*` WebP copies while `processing`;
- delete: the owner's own `community/<owner>/` folder; community moderators and media managers.

### Lifecycle

1. Composer: the member chooses files; each is checked locally (type, size, video codec), then `beginAttachment` → upload straight to Storage (`startUpload`: signed PUT ≤ 6 MB, resumable TUS above) with progress → `processAttachment`.
2. `processAttachment` (server action, member session): photos are downloaded, processed (`processImage`, `GALLERY_VARIANTS`), copies uploaded, `community_attachment_ready`, original deleted. Video: the first and last 1 MB are read (`readRange`) and checked, then ready. A bad file is removed at once with its message; a storage hiccup keeps the upload for Retry.
3. Posting sends the ready ids in order with each photo's description; the database attaches them in the post's transaction.
4. Cancel during upload / Remove before posting → `community_attachment_discard` → files deleted → recorded.
5. Author deletion → triggers mark the post's attachments `removed` in the same statement (also for hard-deleted threads and cascades such as a deleted group); the `*_delete_with_media` functions return the paths, which the action deletes with the member's session and records.
6. Moderator hide/restore changes nothing in the table; visibility follows the post's status.

### Abandoned uploads and cleanup

Nothing is deleted automatically. **Administration → Moderation → Attachment cleanup** (`/admin/moderation/attachments`; community moderators and media managers) lists:
- **Abandoned uploads:** drafts never posted and untouched for `media.settings.abandoned_upload_hours` (default 24; set in Administration → Media → Settings).
- **Removed files:** attachments removed (post deleted, or removed before posting) whose stored files are still present, for example when a delete call failed.
- **Unreferenced files:** objects under `community/` more than a day old that no attachment refers to (for example a WebP copy whose `ready` step failed).

Select, confirm, and delete; the database re-lists the candidates and only discards drafts that are actually abandoned. Files under `community/` are excluded from the media library's own "Unreferenced files" list (Administration → Media → Storage and cleanup), which links here instead.

## Tests

- `tests/db/community-attachments.test.ts` (15): closed to visitors and direct reads; owner-only upload paths and originals; attach on create and group-only visibility (listing, by id, and Storage), access lost on leaving the group; an id guessed from another group denied; media managers' library rule doesn't apply; hidden replies/threads hidden from members (and the author) but visible to moderators and the group leader, back on restore; reply deletion removes access and returns paths, deletion recorded only once Storage is empty; thread deletion (hard and placeholder); someone else's or an already-attached upload can't be attached and the post rolls back; no attaching where the author can't post (non-member, locked, restricted); type/size/count/video/alt/draft limits and idempotent retry; rate limit; cancel and remove; cleanup listing, permissions, discard, orphans; reports still work.
- `src/lib/community/attachments.test.ts` (7): file classification, HEVC/QuickTime/AV1 rejection, H.264 at either end of the file, stsd parsing, URL and duration helpers.

## Not covered / limitations

- Real Supabase Storage behaviour (signed upload tokens, TUS resume, signed-URL redirects for `<video>` range requests, that `remove()` honours the select + delete policies) was not exercised: the local database uses a `storage.objects` shim, so the tests check the policies and functions only. Verify on the preview project before release: upload a photo and a video in a group thread, open them as another group member and as a non-member (404), hide/restore, delete.
- Video is not transcoded or thumbnailed; duration and dimensions come from the member's browser.
- Media can't be added to or removed from a post after posting (delete and re-post). Text stays required; a photo-only post needs at least one character.
- Thread list cards don't show an attachment indicator.
- Report evidence snapshots don't include media.
- Egress: each view of a photo or video is a download from Storage (5 GB/month on the Free plan). Watch usage in Administration → Media → Storage and cleanup.
