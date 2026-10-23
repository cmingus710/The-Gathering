# Media gallery (formerly Photo galleries): moderation and privacy guide (Phase 7)

Albums and photo review are under **Admin → Media gallery** (`/admin/gallery`; the addresses didn't change with the rename). Media gallery moderators (`gallery.moderate`) manage albums, review photos, and add videos; event coordinators (`events.manage`) can create albums for events but can't approve photos.

## Albums

- **Audience:** approved members, or one group's active members. **Albums are never public.**
- **Status:** draft (moderators only), published, archived.
- **Uploads open:** whether members who can see the album may add photos.
- **Event link** (optional): shown only to people who can see that event.
- **Cover:** any approved photo; otherwise the first approved photo.

## Videos in albums

Gallery moderators add videos under **Add a video** on the album's admin page: a ready library video (YouTube, Vimeo, or uploaded MP4) or a pasted YouTube/Vimeo link (the existing library record is reused). Each video waits under **Waiting for review** and is approved with the same people-under-18 review and youth photo-consent guard as photos. Members see videos with a Play button and **All / Photos / Videos** filters, and can **Report or ask to remove** under each one. Members can't add videos; their photo uploads are unchanged. See [videos-guide.md](videos-guide.md).

## Member uploads

1. The member chooses photos (JPEG, PNG, WebP, or iPhone HEIC; default limits: 20 MB each, 20 per batch, 60 per day, 100 waiting), adds an optional caption and description, and **confirms they have permission** to share them.
2. Each original goes straight from the device to the private **quarantine** bucket (`media-uploads`), with progress, cancel, and retry (retrying never duplicates).
3. The server decodes it (HEIC included), applies orientation, converts to sRGB, **removes all metadata including GPS location**, re-encodes review copies, and **deletes the original**. Identical photos in the same album are refused.
4. The photo waits as **pending**. Only the uploader and moderators can see it.

## Review

The moderation queue (`/admin/gallery/<album>`) shows pending photos with caption, uploader, and description. For each:

- **Children:** set **Minors in photo** to *none* or *permission confirmed*. A photo marked *unsure* can't be approved. The app does no facial recognition or automatic detection; this is the moderator's judgment.
- **Approve:** the photo is re-encoded again into the private `media` bucket and appears in the album. The uploader gets a notice; album viewers get one grouped notice (at most every 6 hours, after a 10-minute settle).
- **Reject** or **hide** (with an optional note for the uploader), **unhide**, or **remove** (deletes its files).
- Reorder photos and choose the album cover.

## Reports and removal requests

Any viewer can open a photo and choose **Report or ask to remove** (I'm in this photo and want it removed; private information; a child without permission; inappropriate; something else). Reports go to `/admin/gallery/reports`. Moderators can hide the photo while they look, then resolve the report. Honor removal requests from people in a photo promptly.

## Privacy notes to share with members

- Photos are visible only to signed-in approved members (or the album's group), through links that expire after 5 minutes.
- **Anyone who can see a photo can still screenshot or photograph it.** The app can't prevent that.
- Photos are never reused automatically in banners, the home page, or public pages.
- Uploaders can remove their own photos at any time; the files are deleted at once.

## Retention

Rejected, failed, and removed photos' files are deleted when the action happens. No other automatic deletion runs; adopt a written retention policy before adding any.
