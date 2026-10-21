# Podcasts and feeds: configuration guide (Phase 7)

Podcast shows are managed under **Admin → Podcasts** (`/admin/podcasts`, needs `podcasts.manage`). Episodes of church shows are teaching items, published like any other ([media-guide.md](media-guide.md)), which needs `content.publish`.

## Church shows

A church show groups the church's own episodes. Each episode is an item of kind "Podcast episode" with an audio attachment, and plays in the app's shared player.

### Optional public RSS feed

Turn on **Public RSS feed** for **one** church show (only one show can have it) to publish `https://<site>/podcast/feed.xml` for podcast apps. The show's audience must be **Public** (checked when saving), and the feed is served only while the show is **Published**. Podcast directories also expect a description, an author, and square artwork of 1400–3000 px; artwork appears in the feed only when it's allowed for public use.

The feed contains **only** episodes that are live, public, and whose audio file has confirmed rights and is allowed for public use. Members-only and group episodes never appear, and neither do drafts, scheduled, expired, or archived ones. Enclosure URLs are stable app addresses (`/api/podcast/episodes/<id>/audio`) that redirect to a short-lived signed link, so expiring storage URLs never end up in podcast apps. The feed and enclosures are rate-limited per visitor.

Turning the feed off, or narrowing the show or an episode, removes it from the feed on the next request. Podcast apps that already downloaded an episode keep their copy; that can't be recalled.

## External shows

External shows recommend someone else's podcast. Add either or both:

- **RSS feed address** (http or https): the app imports episode titles, dates, descriptions, durations, and links.
- **Spotify or Apple Podcasts show link**: shown as an official embed that loads only when the member taps it.

**In-app playback** of an external feed's audio is off by default. Turn on **Allow in-app playback** only after confirming the publisher permits it. Even then, the audio streams from the publisher's own address; the app never downloads, proxies, or rehosts external episodes, and never rehosts Spotify or Apple audio.

### Refresh

- **Scheduled:** due feeds are refreshed automatically (default every 6 hours, `/admin/media/settings`, 1 hour to 7 days) by the existing scheduler → `/api/jobs/events` (signed with `EVENTS_JOB_SECRET`).
- **Manual:** **Refresh now** on the show (limited to once a minute per show and 30 per 10 minutes).
- **Dedupe:** episodes are matched by their feed GUID (or link). Changed titles and audio links are updated; episodes that vanish from the feed are hidden, not deleted. An empty feed changes nothing.
- **Errors:** the last error and time are shown on the show; repeated failures back off (up to a day). **Imports never notify members** (no back-catalog notices).

### Safety

Feed fetching runs on the server with: https/http only, no credentials in URLs, DNS checked at connect time with every private, loopback, link-local, carrier-NAT, multicast, and reserved range refused (IPv4 and IPv6), redirects followed manually (each one rechecked, at most 3), a 15-second timeout, an 8 MB size cap, and XML parsed without DOCTYPE or entities (no XXE or entity expansion). Descriptions are reduced to plain text.

## What members see

`/podcasts` lists every visible episode (church and external), newest first, 10 at a time with "Show more episodes" (up to 100; older ones are on each show page), and each card has its player built in: press Play without opening the episode. Church audio and allowed external audio use the app's one persistent player (one episode at a time, speed and resume kept, lock-screen controls where the browser supports them); nothing loads until Play is pressed. Church video episodes show their video player; external episodes without in-app playback link to the publisher. The shows are listed below the episodes. Episode pages (`/podcasts/episodes/<id>`, `/podcasts/external/<id>`) are unchanged and keep the full notes, transcripts, and files. Show pages are searchable. External episode pages offer the in-app player (if allowed), the publisher's link, and the official app link. Signed-out visitors see only public shows and episodes.
