import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
type Json = Record<string, unknown>;

/**
 * Media gallery album covers (20261118000100): an uploaded cover is album
 * metadata (never a photo, so counts don't move), follows the album's
 * audience in storage, can be replaced, repositioned, and removed without
 * touching any photo, and only the album's editors may change it. Choosing
 * a photo needs gallery moderation and a published photo. Every person and
 * file here is synthetic.
 */
describeDb("media gallery album covers", () => {
  let db: TestDb;
  let admin: string;
  let galleryMod: string;
  let coordinator: string;
  let otherCoordinator: string;
  let mediaMgr: string;
  let inGroup: string;
  let outsider: string;
  let group: string;

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const fails = async (actor: Actor, fn: string, args: unknown[], message: RegExp) => expect(rpc(actor, fn, args)).rejects.toThrow(message);
  const j = (v: unknown) => JSON.stringify(v);
  const putObject = (actor: Actor, bucket: string, name: string, size = 1000, mimetype = "image/webp") =>
    db.query(actor, "insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4)", [
      bucket,
      name,
      actor.role === "authenticated" ? actor.userId : null,
      j({ size, mimetype }),
    ]);
  const canRead = async (actor: Actor, bucket: string, name: string) =>
    (await db.query(actor, "select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name])).length === 1;
  const remove = async (actor: Actor, bucket: string, name: string) =>
    (await db.query(actor, "delete from storage.objects where bucket_id = $1 and name = $2 returning 1", [bucket, name])).length === 1;
  const exists = async (bucket: string, name: string) =>
    (await db.raw("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name])).length === 1;

  /** Begin → upload → processing → processed copies → ready, as the server action does. */
  const uploadCover = async (actor: Actor, album: string, opts: { framing?: unknown; alt?: string; noMinors?: boolean } = {}) => {
    const b = await rpc<Json>(actor, "media_admin_album_cover_begin", [album, "image/jpeg", 500_000]);
    await putObject(actor, "media-uploads", b.path as string, 500_000, "image/jpeg");
    await rpc(actor, "media_admin_album_cover_processing", [b.id]);
    const stem = `album-covers/${album}/${b.id}/${randomUUID().slice(0, 8)}`;
    await putObject(actor, "media", `${stem}-display.webp`, 200_000);
    await putObject(actor, "media", `${stem}-thumb.webp`, 40_000);
    const r = await rpc<Json>(actor, "media_admin_album_cover_ready", [
      b.id, `${stem}-display.webp`, `${stem}-thumb.webp`, 2048, 1365, opts.alt ?? "Synthetic cover", opts.framing === undefined ? null : j(opts.framing), opts.noMinors ?? true,
    ]);
    return { id: b.id as string, original: b.path as string, display: `${stem}-display.webp`, thumb: `${stem}-thumb.webp`, result: r };
  };

  /** A member photo, approved by the moderator. */
  const approvedPhoto = async (album: string, uploader: string) => {
    const b = await rpc<Json>(as(uploader), "media_photo_begin", [album, randomUUID(), null, "x.jpg", "image/jpeg", 1000, true]);
    await putObject(as(uploader), "media-uploads", b.path as string, 1000, "image/jpeg");
    await rpc(as(uploader), "media_photo_processing", [b.id]);
    const d = `photos/${uploader}/${b.id}/review-d.webp`;
    const t = `photos/${uploader}/${b.id}/review-t.webp`;
    await putObject(as(uploader), "media-uploads", d, 100);
    await putObject(as(uploader), "media-uploads", t, 100);
    await rpc(as(uploader), "media_photo_ready", [b.id, d, t, 10, 10, 100, null, "", "Synthetic photo description"]);
    const pd = `gallery/${album}/${b.id}/p-d.webp`;
    const pt = `gallery/${album}/${b.id}/p-t.webp`;
    await putObject(as(galleryMod), "media", pd, 100);
    await putObject(as(galleryMod), "media", pt, 100);
    await rpc(as(galleryMod), "media_admin_photo_review", [b.id, "approve", null, "none", pd, pt]);
    return { id: b.id as string, display: pd, thumb: pt };
  };

  const newAlbum = async (actor: Actor, payload: Json = {}) => {
    const id = await rpc<string>(actor, "media_admin_album_save", [null, j({ title: "Synthetic Video Series", audience: "members", ...payload })]);
    return id;
  };
  const publish = (album: string) => rpc(as(galleryMod), "media_admin_album_status", [album, "publish"]);
  const memberCard = async (actor: Actor, album: string) => ((await rpc<Json[]>(actor, "media_albums")).find((a) => a.id === album) ?? null) as Json | null;

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string) => {
      const id = await db.createAuthUser(email, { fullName: name });
      await db.setStatus(id, "approved");
      return id;
    };
    admin = await mk("c.admin@example.test", "Synthetic Admin");
    galleryMod = await mk("c.gallery@example.test", "Synthetic Gallery");
    coordinator = await mk("c.coord@example.test", "Synthetic Coordinator");
    otherCoordinator = await mk("c.coord2@example.test", "Synthetic Coordinator Two");
    mediaMgr = await mk("c.media@example.test", "Synthetic Media");
    inGroup = await mk("c.ingroup@example.test", "Synthetic Group Member");
    outsider = await mk("c.outsider@example.test", "Synthetic Outsider");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(galleryMod, "gallery_moderator");
    await db.grantRole(coordinator, "event_coordinator");
    await db.grantRole(otherCoordinator, "event_coordinator");
    await db.grantRole(mediaMgr, "media_manager");
    group = await rpc<string>(as(admin), "community_group_save", [
      j({ name: "Synthetic Cover Group", summary: "s", about: "a", visibility: "discoverable", leader_id: admin }),
    ]);
    await db.raw("insert into community.group_members (group_id, profile_id) values ($1, $2) on conflict do nothing", [group, inGroup]);
  });
  afterAll(async () => db?.destroy());
  beforeEach(async () => {
    await db.raw("delete from community.rate_events where profile_id is not null");
  });

  it("uploads a cover that is album metadata, not a photo, with its framing and description", async () => {
    const album = await newAlbum(as(coordinator));
    const c = await uploadCover(as(coordinator), album, { framing: { x: 30, y: 60, zoom: 1.5 }, alt: "Title card for the series" });
    expect(c.result).toEqual({ remove: [], uploads: [c.original] });
    await publish(album);
    const card = await memberCard(as(outsider), album);
    expect(card?.cover).toMatchObject({
      source: "upload", thumb_path: c.thumb, display_path: c.display, alt: "Title card for the series", framing: { x: 30, y: 60, zoom: 1.5 }, width: 2048,
    });
    expect(card?.photo_count).toBe(0);
    expect(card?.video_count).toBe(0);
    expect((await rpc<Json>(as(outsider), "media_album", [album])).photos).toEqual([]);
    expect((await db.raw("select count(*)::int n from media.photos where album_id = $1", [album]))[0].n).toBe(0);
    // Members read the served copies, never the quarantined original.
    expect(await canRead(as(outsider), "media", c.thumb)).toBe(true);
    expect(await canRead(as(outsider), "media-uploads", c.original)).toBe(false);
    expect(await canRead(anon, "media", c.thumb)).toBe(false);
  });

  it("follows the album's audience: drafts, groups, and audience changes", async () => {
    const album = await newAlbum(as(galleryMod), { audience: "group", group_id: group });
    const c = await uploadCover(as(galleryMod), album);
    // Draft: only editors.
    expect(await canRead(as(inGroup), "media", c.thumb)).toBe(false);
    expect(await canRead(as(galleryMod), "media", c.thumb)).toBe(true);
    await publish(album);
    expect(await canRead(as(inGroup), "media", c.thumb)).toBe(true);
    expect(await canRead(as(outsider), "media", c.display)).toBe(false);
    // Media managers don't get group covers through the library rule.
    expect(await canRead(as(mediaMgr), "media", c.thumb)).toBe(false);
    expect(await memberCard(as(outsider), album)).toBeNull();
    // Widening to members widens the cover with it; narrowing again revokes it.
    await rpc(as(galleryMod), "media_admin_album_save", [album, j({ audience: "members" })]);
    expect(await canRead(as(outsider), "media", c.thumb)).toBe(true);
    await rpc(as(galleryMod), "media_admin_album_save", [album, j({ audience: "group", group_id: group })]);
    expect(await canRead(as(outsider), "media", c.thumb)).toBe(false);
    // Leaving the group ends access at once.
    await db.raw("update community.group_members set state = 'removed', ended_at = now() where group_id = $1 and profile_id = $2", [group, inGroup]);
    expect(await canRead(as(inGroup), "media", c.thumb)).toBe(false);
    await db.raw("update community.group_members set state = 'active', ended_at = null where group_id = $1 and profile_id = $2", [group, inGroup]);
  });

  it("only lets the album's editors change its cover, in the database and in storage", async () => {
    const album = await newAlbum(as(coordinator));
    await fails(as(otherCoordinator), "media_admin_album_cover_begin", [album, "image/jpeg", 1000], /not found/);
    await fails(as(outsider), "media_admin_album_cover_begin", [album, "image/jpeg", 1000], /permission/);
    await expect(db.query(anon, "select public.media_admin_album_cover_begin($1, 'image/jpeg', 1000)", [album])).rejects.toThrow(/permission denied/);
    await fails(as(coordinator), "media_admin_album_cover_begin", [album, "image/gif", 1000], /JPEG, PNG, WebP, or HEIC/);
    await fails(as(coordinator), "media_admin_album_cover_begin", [album, "image/jpeg", 60 * 1024 * 1024], /MB or smaller/);

    const b = await rpc<Json>(as(coordinator), "media_admin_album_cover_begin", [album, "image/png", 1000]);
    // Only the registering editor may upload to the registered path.
    await expect(putObject(as(otherCoordinator), "media-uploads", b.path as string, 1000, "image/png")).rejects.toThrow(/row-level security/);
    await expect(putObject(as(coordinator), "media-uploads", `album-covers/${album}/${b.id}/other.png`, 1000, "image/png")).rejects.toThrow(/row-level security/);
    await putObject(as(coordinator), "media-uploads", b.path as string, 1000, "image/png");
    // Processed copies only once processing, only .webp in that upload's folder.
    await expect(putObject(as(coordinator), "media", `album-covers/${album}/${b.id}/early.webp`)).rejects.toThrow(/row-level security/);
    await fails(as(otherCoordinator), "media_admin_album_cover_processing", [b.id], /wasn't found/);
    await rpc(as(coordinator), "media_admin_album_cover_processing", [b.id]);
    await expect(putObject(as(coordinator), "media", `album-covers/${album}/${b.id}/x.png`)).rejects.toThrow(/row-level security/);
    await expect(putObject(as(coordinator), "media", `album-covers/${album}/${randomUUID()}/x.webp`)).rejects.toThrow(/row-level security/);
    const d = `album-covers/${album}/${b.id}/d.webp`;
    const t = `album-covers/${album}/${b.id}/t.webp`;
    await putObject(as(coordinator), "media", d);
    await putObject(as(coordinator), "media", t);
    // An uploaded cover can't show anyone under 18.
    await fails(as(coordinator), "media_admin_album_cover_ready", [b.id, d, t, 100, 100, "", null, false], /under 18/);
    await fails(as(coordinator), "media_admin_album_cover_ready", [b.id, `gallery/${album}/x/d.webp`, t, 100, 100, "", null, true], /wasn't found/);
    await fails(as(coordinator), "media_admin_album_cover_ready", [b.id, d, t, 100, 100, "", j({ x: 500, y: 1 }), true], /position/);
    await rpc(as(coordinator), "media_admin_album_cover_ready", [b.id, d, t, 100, 100, "", null, true]);
    // Others can't reposition or remove it.
    await fails(as(otherCoordinator), "media_admin_album_cover_framing", [album, d, j({ x: 1, y: 1, zoom: 1 }), null], /not found/);
    await fails(as(otherCoordinator), "media_admin_album_cover_remove", [album], /not found/);
    // Nobody deletes the current cover files from storage directly.
    expect(await remove(as(coordinator), "media", d)).toBe(false);
    expect(await remove(as(otherCoordinator), "media", t)).toBe(false);
    expect(await exists("media", d)).toBe(true);
  });

  it("replaces and removes a cover without touching photos, and cancels without changing it", async () => {
    const album = await newAlbum(as(galleryMod), { uploads_open: true });
    await publish(album);
    const photo = await approvedPhoto(album, outsider);
    const first = await uploadCover(as(galleryMod), album, { framing: { x: 10, y: 10, zoom: 2 } });

    // A cancelled upload leaves the saved cover as it was.
    const b = await rpc<Json>(as(galleryMod), "media_admin_album_cover_begin", [album, "image/jpeg", 1000]);
    expect(await rpc<Json>(as(galleryMod), "media_admin_album_cover_fail", [b.id, "Cancelled"])).toEqual({ uploads: [b.path] });
    await fails(as(galleryMod), "media_admin_album_cover_processing", [b.id], /already finished/);
    expect((await memberCard(as(outsider), album))?.cover).toMatchObject({ source: "upload", display_path: first.display });

    // Replacing returns only the previous cover's own files.
    const second = await uploadCover(as(galleryMod), album);
    expect(second.result.remove).toEqual([first.display, first.thumb]);
    let card = await memberCard(as(outsider), album);
    expect(card?.cover).toMatchObject({ source: "upload", display_path: second.display, framing: null });
    expect(card?.photo_count).toBe(1);
    // The replaced files are now deletable by the editor (and unreadable to members).
    expect(await canRead(as(outsider), "media", first.thumb)).toBe(false);
    expect(await remove(as(galleryMod), "media", first.display)).toBe(true);
    expect(await remove(as(galleryMod), "media", first.thumb)).toBe(true);

    // Repositioning: only the cover the editor saw.
    expect(await rpc<boolean>(as(galleryMod), "media_admin_album_cover_framing", [album, first.display, j({ x: 1, y: 1, zoom: 1 }), null])).toBe(false);
    expect(await rpc<boolean>(as(galleryMod), "media_admin_album_cover_framing", [album, second.display, j({ x: 70, y: 20, zoom: 1.25 }), "New words"])).toBe(true);
    card = await memberCard(as(outsider), album);
    expect(card?.cover).toMatchObject({ framing: { x: 70, y: 20, zoom: 1.25 }, alt: "New words" });

    // Removing falls back to the first published photo; the photo is untouched.
    expect(await rpc<Json>(as(galleryMod), "media_admin_album_cover_remove", [album])).toEqual({ remove: [second.display, second.thumb] });
    card = await memberCard(as(outsider), album);
    expect(card?.cover).toMatchObject({ source: "first_photo", photo_id: photo.id, framing: null });
    expect(card?.photo_count).toBe(1);
    const [p] = await db.raw<{ status: string; display_path: string }>("select status, display_path from media.photos where id = $1", [photo.id]);
    expect(p).toEqual({ status: "approved", display_path: photo.display });
  });

  it("chooses a published photo as the cover (moderators only) and drops it when the photo is hidden", async () => {
    const album = await newAlbum(as(coordinator), { uploads_open: true });
    await publish(album);
    const photo = await approvedPhoto(album, outsider);
    const other = await approvedPhoto(album, outsider);
    const up = await uploadCover(as(coordinator), album);
    await fails(as(coordinator), "media_admin_album_cover_choose", [album, photo.id, null], /permission/);
    // A pending photo isn't eligible.
    const pending = await rpc<Json>(as(outsider), "media_photo_begin", [album, randomUUID(), null, "x.jpg", "image/jpeg", 1000, true]);
    await fails(as(galleryMod), "media_admin_album_cover_choose", [album, pending.id, null], /published photo/);

    const r = await rpc<Json>(as(galleryMod), "media_admin_album_cover_choose", [album, other.id, j({ x: 40, y: 45, zoom: 1.1 })]);
    expect(r.remove).toEqual([up.display, up.thumb]);
    let card = await memberCard(as(inGroup), album);
    expect(card?.cover).toMatchObject({ source: "photo", photo_id: other.id, thumb_path: other.thumb, framing: { x: 40, y: 45, zoom: 1.1 } });
    // Only moderators reposition a chosen photo.
    await fails(as(coordinator), "media_admin_album_cover_framing", [album, other.id, j({ x: 1, y: 1, zoom: 1 }), null], /gallery moderators/);
    // The old "Make cover" function still works and clears any framing for a new photo.
    await rpc(as(galleryMod), "media_admin_album_cover", [album, photo.id]);
    card = await memberCard(as(inGroup), album);
    expect(card?.cover).toMatchObject({ source: "photo", photo_id: photo.id, framing: null });
    // Hiding the photo stops it being the cover at once (moderation applies).
    await rpc(as(galleryMod), "media_admin_photo_review", [photo.id, "hide", "Checking", null, null, null]);
    card = await memberCard(as(inGroup), album);
    expect(card?.cover).toMatchObject({ source: "first_photo", photo_id: other.id });
    expect(card?.photo_count).toBe(1);
  });

  it("falls back to a video still for video-only albums and to nothing without media", async () => {
    const album = await newAlbum(as(galleryMod));
    await publish(album);
    expect((await memberCard(as(outsider), album))?.cover).toBeNull();
    const entry = await rpc<string>(as(galleryMod), "media_admin_album_video_add", [album, null, "youtube", "CCCCCCCCCC1", null, "https://youtu.be/CCCCCCCCCC1", "Synthetic session 1", ""]);
    await rpc(as(galleryMod), "media_admin_photo_review", [entry, "approve", null, "none", null, null]);
    const card = await memberCard(as(outsider), album);
    const asset = (await db.raw<{ asset_id: string }>("select asset_id from media.photos where id = $1", [entry]))[0].asset_id;
    expect(card?.cover).toMatchObject({ source: "video", video_asset_id: asset });
    expect(card?.video_count).toBe(1);
    expect(card?.photo_count).toBe(0);
    // An uploaded cover wins over the video still and doesn't change the counts.
    const c = await uploadCover(as(galleryMod), album);
    const after = await memberCard(as(outsider), album);
    expect(after?.cover).toMatchObject({ source: "upload", display_path: c.display });
    expect([after?.photo_count, after?.video_count]).toEqual([0, 1]);
  });

  it("keeps covers in use out of media cleanup, and lets moderators clear a deleted album's files", async () => {
    const album = await newAlbum(as(galleryMod));
    const c = await uploadCover(as(galleryMod), album);
    await db.raw("update storage.objects set created_at = now() - interval '2 days' where name like $1", [`album-covers/${album}/%`]);
    const orphans = async () => ((await rpc<Json>(as(mediaMgr), "media_admin_cleanup_candidates")).orphans as Json[]).map((o) => o.path);
    let listed = await orphans();
    expect(listed).not.toContain(c.display);
    expect(listed).not.toContain(c.thumb);
    // The processed original is no longer referenced once the cover is ready.
    expect(listed).toContain(c.original);
    expect(await canRead(as(mediaMgr), "media-uploads", c.original)).toBe(true);
    expect(await canRead(as(mediaMgr), "media", c.display)).toBe(false);

    const editorView = await rpc<Json>(as(galleryMod), "media_admin_album", [album, null]);
    expect(editorView.cover_editor).toMatchObject({ can_edit: true, file_mb: 20 });
    await rpc(as(galleryMod), "media_admin_album_status", [album, "delete"]);
    listed = await orphans();
    expect(listed).toContain(c.display);
    expect(await remove(as(coordinator), "media", c.display)).toBe(false);
    expect(await remove(as(galleryMod), "media", c.display)).toBe(true);
    expect(await remove(as(galleryMod), "media", c.thumb)).toBe(true);
  });
});
