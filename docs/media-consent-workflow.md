# Photo and video consent workflow

Phase 10 extends Phase 7 gallery moderation ([gallery-guide.md](gallery-guide.md)). Galleries are never public; nothing here publishes anything publicly.

## Consent records

- Decided by a verified guardian with the *photo consent* permission, per child: **member galleries** (inside the app, members or one group) and, separately, **public use** (websites, social media, banners). Public use can be recorded only when the approved policy allows it and is never implied by member-gallery consent.
- Optional event-specific decisions override a guardian's general decision for that event's albums.
- Each decision records the guardian, time, and policy version. Withdrawal is recorded; nothing is deleted.
- A child's state counts only guardians who are **currently** verified with the permission. If a guardian is suspended, revoked, or deleted, their decisions stop counting and affected photos are re-checked.

## Associating photos with children

There is no facial recognition and no automated detection. A **photo consent reviewer** (Administration → Youth & families → Photo consent) opens a photo, searches a child by preferred name, and links them. To see the image, the reviewer also needs the Gallery moderator role.

Links between photos and children are never shown in the member gallery, file names, or URLs. Captions and alt text are free text written by people: moderators should not name children there (the app doesn't check captions automatically).

## Publication rules (database-enforced)

- A gallery moderator can't approve a photo, or unhide one, while any linked child's member-gallery consent for that album's event is not *Allowed* (unknown, declined, withdrawn, or guardians disagree).
- Choosing "Shows someone under 18 … linked to their photo consent" when approving requires at least one linked child.
- Albums linked to youth events list their pending photos in the consent queue.

## When consent changes

1. A guardian declines or withdraws (or a guardianship changes, or a child is restricted).
2. Every approved photo linked to that child for which consent no longer holds is **hidden immediately** (storage reads stop with it; links already on screen expire within 5 minutes) and a **consent review** is opened with the reason.
3. The reviewer chooses **Keep hidden**, **Restore** (only possible once consent holds for everyone linked), or **Remove photo**, or unlinks a child who was linked by mistake.
4. **Known copies and public reuse:** record any copy or public use you know of (newsletter PDF, website, printed banner) on the photo so a withdrawal can be followed up by hand. The app can't remove copies outside it.
5. Guardians are told plainly that withdrawal can't recover screenshots or copies people already saved.

## Policy setting

`public_media_consent` (off by default): whether public-use consent may be recorded. The hide-on-change behavior is always on.
