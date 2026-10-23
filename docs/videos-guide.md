# Videos: publishing, discovery, attachments, and the Media gallery

This guide covers how videos reach members: standalone videos in **Videos** and **Teaching & media** search, videos attached to lessons, devotionals, church books, and reading assignments, and videos in **Media gallery** albums. Migrations `20261109000100_media_video_kind` and `20261109000200_media_videos` (additive); operator script `supabase/manual/2026-11-09-apply-media-videos.sql`.

## Why the linked YouTube videos weren't visible

A YouTube or Vimeo link added under **Admin → Media library** is a **library asset**: a reference the church can reuse. By design members never see library assets on their own; they reach a file only through something published (a lesson, devotional, podcast episode, book, assignment, show, series, or lesson workbook block). Nothing let a library video be published by itself, and the editors could attach only one video per item, never to books or assignments. So the videos added to the library ("Not used" in the list, "Not used anywhere yet" on each file) had no path to members, and Teaching & media search, which only searches published content, couldn't find them.

The fix keeps that rule and adds the missing paths. Nothing existing was published, hidden, or re-entered; the existing videos are reused as they are.

## Three different things

| | What it is | Who sees it | Listed in Videos and search? |
| --- | --- | --- | --- |
| **Library asset** | A file or YouTube/Vimeo link in the media library | Administrators only | No |
| **Published video** | A *video page* (content kind "Video") that reuses one library video, with its own title, description, thumbnail, topics, tags, audience, and dates | Its audience (approved members, or one group), once published | Yes, once |
| **Attached video** | A library video shown inside a lesson, devotional, church book, or reading assignment, in an order you set, with an optional caption | Whoever can see that page | No: it plays inside that page only |

The same library video can be all three at once without a second record or copy. A video attached to a restricted or draft page never becomes discoverable on its own.

## Publishing an existing library video (step by step)

Needs **Content editor** (to create the draft) and **Content publisher** (to publish).

1. **Admin → Media library.** A yellow notice counts videos that aren't visible to members yet; **Show them** lists ready videos used nowhere (Status: *Videos not used anywhere yet*). Each row's badge says where a video stands: *Library only: not visible to members*, *Video page: draft*, *Published video*, *Inside N published pages or albums*, or *Can't play here*.
2. Open a video. **Members' access** explains, in plain language, whether members can find it and why (library only, draft, scheduled, restricted to a group, expired, attached only to unpublished content, provider problem).
3. Press **Publish for members…**. This creates a **draft** video page that reuses the library video (nothing copied) and opens it in the editor. If a video page already exists, it opens that one instead.
4. In the editor set (none of this is filled in for you except the starting title, which is the library title you entered):
   - **Title**, **Summary** (the short description on cards and in search), and **Description** (longer, optional);
   - **Cover image**: an optional custom thumbnail; without one, the YouTube/Vimeo thumbnail is used;
   - **Topics** and **Tags** (both searchable);
   - **Who can see it**: approved members (default) or one group. Video pages are never public; for visitors, attach the video to a public lesson or devotional instead;
   - **Notify members** when it goes live (optional).
5. **Who can see it now** (right column) summarizes the page's state. **Preview as members will see it** shows the member page.
6. A publisher presses **Publish now**, or schedules a date and time, with optional expiry, in **Publishing**.

Members then find it in **Teaching & media → Videos**, under the **Videos** filter in search, and by its title, description, topics, and tags.

## Attaching videos to content

In the editor of a Sunday lesson, devotional, church book, or reading assignment, the **Videos** section:

- **Choose from the media library** searches ready videos (YouTube, Vimeo, and uploaded MP4) and adds them;
- **Add a YouTube or Vimeo link** (media managers) adds the link to the library, or reuses the existing record for the same video, and chooses it, without leaving the page or losing anything typed;
- each chosen video has an optional **Caption** (shown under it), **Earlier/Later** to set the order, and **Remove**;
- nothing changes until you press **Save**.

Members see the videos directly in the page (lessons and devotionals above the text; church reading inside each assignment and in a book's **Videos** section), each with its thumbnail and a Play button. Lesson workbook media blocks use the same player and keep their teacher-only rules: a block marked teacher-only is never sent to members.

## Media gallery (formerly Photo galleries)

The **Gallery** is now called **Media gallery** everywhere; its addresses (`/gallery`, `/admin/gallery`) and every album, photo, bookmark, report, and permission are unchanged.

- **Adding videos to an album** (gallery moderators only): open the album in **Admin → Media gallery**, then **Add a video**: choose a library video (if you can browse the library) or paste a YouTube/Vimeo link, with an optional caption. It waits under **Waiting for review** like a member photo; approve it with the same *people under 18* review. The youth photo-consent guard applies unchanged: a video linked to a child without member-gallery consent can't be approved, and is hidden if consent changes.
- **Members** see an album's videos with a Play button, and **All / Photos / Videos** filters when an album has both. Under each video: **Report or ask to remove**, handled in the same reports list as photos. Hide, show again, remove, and reorder work as for photos. Removing a video from an album keeps it in the library. A video can't be an album cover.
- **Member uploads are unchanged**: members can add photos to albums open for uploads (same limits). Members can't add videos or links; that was a deliberate choice so no one gains new publishing rights.

## Playback (one shared player)

Everywhere (search, Videos, lessons, devotionals, church reading, workbooks, podcasts, the Media gallery, and the library preview) a video shows its thumbnail and a Play button. **Pressing Play once replaces the thumbnail with the provider's player in the same place and asks it to start** (`autoplay=1`, from that press). Nothing plays on page load, and only thumbnails load until someone presses Play: no player or video file is loaded for a list.

- **Thumbnails** come through this app (`/api/media/<id>/thumb`), after the same access check as the video, so a member's browser contacts YouTube or Vimeo only when they press Play (the privacy rule the app already had). Missing thumbnails show a plain placeholder.
- **Unavailable videos**: when YouTube or Vimeo reports an error (embedding turned off, private, removed), the player is replaced by **Open in YouTube/Vimeo**. That link is always shown under the player too. Library checks (oEmbed) run when a link is added and on **Check again**; a video marked unavailable shows the link instead of a player.
- **Uploaded MP4** uses the browser's own player with `preload="none"` (one press of Play starts it; nothing downloads before that), with captions and saved position as before.
- **Keyboard and touch**: Play is a real button (Tab, Enter/Space); focus moves into the player when it loads.

### Limits to know

- **iPhone and iPad (Safari, and every iOS browser)**: Apple doesn't let a YouTube player start with sound from a press on the surrounding page, so after Play the YouTube player usually shows its own play button and needs **a second tap**. Desktop Chrome, Edge, Firefox, and Safari, and Android Chrome, normally start on the first press. This has **not been checked on physical devices** yet (see the PR's verification notes).
- **Unlisted is not private**: restricting a page or album here doesn't protect the video on YouTube. Anyone with an unlisted video's link can watch it there. Use YouTube's private setting (which also stops it playing in the app) for anything that must stay inside the church.
- YouTube is played in privacy-enhanced mode (`youtube-nocookie.com`); once it plays, YouTube's terms and cookies apply.
- Video files are never downloaded or re-hosted from YouTube or Vimeo; only thumbnails pass through the app.

## Permissions

| Action | Needs |
| --- | --- |
| Browse library videos in the editor picker | Any media library role (media manager, content editor or publisher, podcast manager) |
| Add a YouTube/Vimeo link (library or editor) | Media manager |
| Create a video page / attach videos | Content editor |
| Publish, schedule, expire | Content publisher |
| Add videos to albums, review, hide, remove | Media gallery moderator |
| Upload photos to an open album | Approved members (unchanged) |

## Release

1. Apply the migrations: run `supabase/manual/2026-11-09-apply-media-videos.sql` in the SQL editor (two transactions; needs `20261108000100` recorded first). The app deployed before the migration keeps working (search without a type filter, the old pages), but the Videos page, video publishing, and album videos need the migration.
2. Deploy the app.
3. For each existing library video, make a publishing decision (the library's notice lists them).

## Verification record (2026-10-23)

- Lint, typecheck, production build, and the full test suite (unit + database: 95 files, 1,162 tests, including `tests/db/videos.test.ts` and `src/lib/media/videos.test.ts`) pass.
- Browser walkthrough on a local stack (PostgreSQL 16 with every migration, PostgREST, Supabase Auth, synthetic `example.test` data), Chromium desktop 1280×900 and Pixel 7 emulation, light, dark, and System themes: 28 checks passed (search Videos filter, one-press in-place playback with `autoplay=1`, keyboard Enter, no duplicate results, Videos browsing, missing thumbnail placeholder, embed-error fallback, group-only and library-only videos refused, ordered captions on a lesson, devotional and church-reading videos, mixed album with All/Photos/Videos, no horizontal scroll and bottom-navigation clearance on the phone, admin notices and reasons). Screenshots: [docs/videos/](videos/).
- **Stand-ins:** YouTube can't be reached from the build sandbox, so the provider's thumbnail and player in the screenshots are clearly labelled stand-ins served by request interception (the app's own thumbnail access check still ran first). Photos are generated placeholder images. Storage was a local stand-in that checks `storage.objects` under the caller's role and RLS.
- **Not yet verified:** real YouTube/Vimeo playback, and one-press playback on physical iPhone, iPad, and Android devices (emulation can't show autoplay policy). Check these on the preview deployment with a test video before announcing.
