import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Video discovery (20261109000100 / 20261109000200) against a real
 * database: a library YouTube link stays invisible until it is published;
 * publishing reuses the asset; search and the Videos list find it once
 * (with a type filter); the same video attached to a lesson, devotional,
 * and reading assignment is one asset, never a second record or a second
 * search result; ordered, captioned attachments; drafts, scheduled,
 * expired, group-restricted, and attachment-only uses stay undiscoverable
 * (lists, search, counts, thumbnails); album videos go through moderation,
 * the minors review, and the youth consent guard. Every person, item, and
 * video here is synthetic (the YouTube IDs are made up).
 */
type Json = Record<string, unknown>;

describeDb("videos: publishing, discovery, attachments, and the Media gallery", () => {
  let db: TestDb;
  let admin: string;
  let editor: string;
  let publisher: string;
  let mediaMgr: string;
  let galleryMod: string;
  let m1: string; // in the group
  let m2: string; // not in the group
  let group: string;

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const fails = async (actor: Actor, fn: string, args: unknown[], message?: RegExp) => {
    const p = rpc(actor, fn, args);
    if (message) await expect(p).rejects.toThrow(message);
    else await expect(p).rejects.toThrow();
  };
  const j = (v: unknown) => JSON.stringify(v);
  const save = (actor: Actor, id: string | null, payload: Json) => rpc<Json>(actor, "media_admin_item_save", [id, j(payload), null]);
  const publish = (id: string, at: Date | null = null, expires: Date | null = null) => rpc<Json>(as(publisher), "media_admin_item_status", [id, "publish", at, expires, null]);
  const link = (ref: string, title: string) =>
    rpc<string>(as(mediaMgr), "media_admin_external_video_save", [null, "youtube", ref, null, `https://www.youtube.com/watch?v=${ref}`, title]);
  const list = async (actor: Actor, kind: string, filters: Json = {}) => ((await rpc<Json>(actor, "media_items", [kind, j(filters), 50, 0])).items as Json[]);
  const search = async (actor: Actor, q: string, kind: string | null = null) => rpc<Json[]>(actor, "media_search", [q, 40, kind]);
  const thumbOk = async (actor: Actor, asset: string) => {
    try {
      await rpc(actor, "media_video_thumb", [asset]);
      return true;
    } catch {
      return false;
    }
  };
  const assetCount = async () => Number((await db.raw<{ n: string }>("select count(*) n from media.assets"))[0].n);

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string) => {
      const id = await db.createAuthUser(email, { fullName: name });
      await db.setStatus(id, "approved");
      return id;
    };
    admin = await mk("v.admin@example.test", "Synthetic Admin");
    editor = await mk("v.editor@example.test", "Synthetic Editor");
    publisher = await mk("v.publisher@example.test", "Synthetic Publisher");
    mediaMgr = await mk("v.media@example.test", "Synthetic Media");
    galleryMod = await mk("v.gallery@example.test", "Synthetic Gallery");
    m1 = await mk("v.m1@example.test", "Alpha Member");
    m2 = await mk("v.m2@example.test", "Bravo Member");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(editor, "content_editor");
    await db.grantRole(publisher, "content_publisher");
    await db.grantRole(mediaMgr, "media_manager");
    await db.grantRole(galleryMod, "gallery_moderator");
    group = await rpc<string>(as(admin), "community_group_save", [
      j({ name: "Synthetic Video Group", summary: "s", about: "a", visibility: "discoverable", leader_id: m1 }),
    ]);
    await db.raw("insert into community.group_members (group_id, profile_id) values ($1, $2) on conflict do nothing", [group, m1]);
  }, 120_000);

  afterAll(async () => db?.destroy());

  it("keeps a library link invisible, reuses it when added again, and lists it as needing a decision", async () => {
    const id = await link("AAAAAAAAAA1", "Synthetic Sabbath Rhythms");
    expect(await link("AAAAAAAAAA1", "Another title")).toBe(id);
    const added = await rpc<Json>(as(mediaMgr), "media_admin_video_link_add", ["youtube", "AAAAAAAAAA1", null, "https://youtu.be/AAAAAAAAAA1", null]);
    expect(added.id).toBe(id);
    expect(added.created).toBe(false);
    // Editors can't add new links (media managers can).
    await fails(as(editor), "media_admin_video_link_add", ["youtube", "AAAAAAAAAA2", null, "https://youtu.be/AAAAAAAAAA2", null], /permission/);

    expect(await search(as(m1), "Sabbath")).toEqual([]);
    expect(await thumbOk(as(m1), id)).toBe(false);
    expect(await thumbOk(anon, id)).toBe(false);
    // Managers preview it.
    expect(await thumbOk(as(mediaMgr), id)).toBe(true);
    const undecided = await rpc<Json>(as(editor), "media_admin_assets", [null, "needs_decision", null, 50, 0]);
    expect((undecided.items as Json[]).map((x) => x.id)).toContain(id);
    const detail = await rpc<Json>(as(editor), "media_admin_asset", [id]);
    expect(detail.publishing).toEqual({ standalone: [], attached: [], albums: [], blocks: 0 });
    expect(detail.can_publish_video).toBe(true);
  });

  it("publishes a library video for members without copying it, and finds it in Videos and search", async () => {
    const asset = await link("BBBBBBBBBB1", "Synthetic Grief and Loss");
    const before = await assetCount();
    // Media managers alone can't create content.
    await fails(as(mediaMgr), "media_admin_video_publish", [asset], /permission/);
    const made = await rpc<Json>(as(editor), "media_admin_video_publish", [asset]);
    expect(made.created).toBe(true);
    const again = await rpc<Json>(as(editor), "media_admin_video_publish", [asset]);
    expect(again).toEqual({ id: made.id, created: false });
    expect(await assetCount()).toBe(before);
    const id = made.id as string;

    // A draft: invisible everywhere.
    expect(await list(as(m1), "video")).toEqual([]);
    expect(await search(as(m1), "Grief", "video")).toEqual([]);
    expect(await thumbOk(as(m1), asset)).toBe(false);
    // Editors can't publish.
    await fails(as(editor), "media_admin_item_status", [id, "publish", null, null, null], /permission/);

    await save(as(publisher), id, { title: "Synthetic Grief and Loss", summary: "Part five of the series.", tags: ["emotional health"], topics: [] });
    await publish(id);
    const cards = await list(as(m1), "video");
    expect(cards.map((c) => c.id)).toEqual([id]);
    expect((cards[0].video as Json).asset_id).toBe(asset);
    expect((cards[0].video as Json).provider_ref).toBe("BBBBBBBBBB1");
    expect(await thumbOk(as(m1), asset)).toBe(true);
    // Description and tags are searched too, with and without the type filter.
    expect((await search(as(m1), "Part five", "video")).map((h) => h.id)).toEqual([id]);
    expect((await search(as(m1), "emotional health")).map((h) => h.id)).toEqual([id]);
    expect(await search(as(m1), "Grief", "lesson")).toEqual([]);
    // The two-argument call (older app versions) still works.
    expect((await rpc<Json[]>(as(m1), "media_search", ["Grief", 40])).map((h) => h.id)).toEqual([id]);
    await fails(as(m1), "media_search", ["Grief", 40, "bogus"], /Unknown content type/);
    // Never public: visitors see nothing, and the audience can't be widened.
    expect(await list(anon, "video")).toEqual([]);
    expect(await search(anon, "Grief")).toEqual([]);
    expect(await thumbOk(anon, asset)).toBe(false);
    await fails(as(publisher), "media_admin_item_save", [id, j({ audience: "public", confirm_public: "public" }), null], /members or a group/);

    const detail = await rpc<Json>(as(editor), "media_admin_asset", [asset]);
    expect(((detail.publishing as Json).standalone as Json[])[0]).toMatchObject({ id, state: "live", audience: "members" });
  });

  it("keeps exactly one video on a standalone video page and requires it before publishing", async () => {
    const a = await link("CCCCCCCCCC1", "Synthetic One");
    const b = await link("CCCCCCCCCC2", "Synthetic Two");
    const made = await save(as(editor), null, { kind: "video", title: "Synthetic empty video page" });
    await fails(as(publisher), "media_admin_item_status", [made.id, "publish", null, null, null], /Choose the video/);
    await fails(
      as(editor),
      "media_admin_item_save",
      [made.id, j({ attachments: [{ asset_id: a, role: "video" }, { asset_id: b, role: "video" }] }), null],
      /exactly one video/,
    );
    await save(as(editor), made.id as string, { attachments: [{ asset_id: a, role: "video" }] });
    expect((await publish(made.id as string)).state).toBe("live");
  });

  it("attaches one video to a lesson, a devotional, and a reading assignment without duplicating it", async () => {
    const asset = await link("DDDDDDDDDD1", "Synthetic Daily Office");
    const other = await link("DDDDDDDDDD2", "Synthetic Silence");
    const before = await assetCount();
    const page = (await rpc<Json>(as(editor), "media_admin_video_publish", [asset])).id as string;
    await save(as(publisher), page, { summary: "Silence and the daily office." });
    await publish(page);

    const lesson = (await save(as(publisher), null, {
      kind: "lesson",
      title: "Synthetic lesson with videos",
      attachments: [
        { asset_id: other, role: "video", label: "Watch first", sort_order: 0 },
        { asset_id: asset, role: "video", label: "Then this one", sort_order: 1 },
      ],
    })).id as string;
    const devotional = (await save(as(publisher), null, { kind: "devotional", title: "Synthetic devotional with video", attachments: [{ asset_id: asset, role: "video" }] })).id as string;
    const book = (await save(as(publisher), null, { kind: "book", title: "Synthetic church book" })).id as string;
    const assignment = (await save(as(publisher), null, { kind: "assignment", title: "Synthetic chapter", book_id: book, attachments: [{ asset_id: asset, role: "video", label: "Chapter video" }] })).id as string;
    for (const id of [lesson, devotional, book, assignment]) await publish(id);
    expect(await assetCount()).toBe(before);

    // Order and captions as the administrator set them.
    const detail = await rpc<Json>(as(m1), "media_item", [lesson]);
    const vids = (detail.attachments as Json[]).filter((x) => x.role === "video");
    expect(vids.map((v) => [v.asset_id, v.caption])).toEqual([
      [other, "Watch first"],
      [asset, "Then this one"],
    ]);
    // The unified reading page gets the assignment's video.
    const plan = await rpc<Json>(as(m1), "media_reading_plan", [book]);
    const planAssignment = (plan.assignments as Json[]).find((x) => x.id === assignment)!;
    expect((planAssignment.attachments as Json[]).map((x) => [x.asset_id, x.caption])).toEqual([[asset, "Chapter video"]]);

    // One search result for the video (its pages are separate kinds), with where else it appears.
    const hits = (await search(as(m1), "Silence", "video")).filter((h) => h.kind === "video");
    expect(hits.map((h) => h.id)).toEqual([page]);
    const usedIn = (hits[0].used_in as Json[]).map((u) => u.id).sort();
    expect(usedIn).toEqual([lesson, devotional, assignment].sort());
    expect((hits[0].used_in as Json[]).find((u) => u.id === assignment)?.book).toEqual({ id: book });
    // A page the viewer can't see isn't mentioned.
    await rpc(as(publisher), "media_admin_item_status", [devotional, "unpublish", null, null, null]);
    const after = (await search(as(m1), "Silence", "video"))[0];
    expect((after.used_in as Json[]).map((u) => u.id)).not.toContain(devotional);
  });

  it("never lets an attachment make a video discoverable on its own, and follows drafts, schedules, expiry, and groups", async () => {
    const asset = await link("EEEEEEEEEE1", "Synthetic Hidden Teaching");
    const draftLesson = (await save(as(publisher), null, { kind: "lesson", title: "Synthetic draft lesson", attachments: [{ asset_id: asset, role: "video" }] })).id as string;
    expect(await thumbOk(as(m1), asset)).toBe(false);
    await publish(draftLesson);
    // Visible inside the lesson now, but still not listed as a video.
    expect(await thumbOk(as(m1), asset)).toBe(true);
    expect(await search(as(m1), "Hidden Teaching", "video")).toEqual([]);
    expect(await list(as(m1), "video", { q: "Hidden Teaching" })).toEqual([]);

    const groupAsset = await link("EEEEEEEEEE2", "Synthetic Group Only");
    const page = (await rpc<Json>(as(editor), "media_admin_video_publish", [groupAsset])).id as string;
    await save(as(publisher), page, { audience: "group", group_id: group });
    await publish(page);
    expect((await search(as(m1), "Group Only", "video")).map((h) => h.id)).toEqual([page]);
    expect(await search(as(m2), "Group Only", "video")).toEqual([]);
    expect((await list(as(m2), "video", { q: "Group Only" })).length).toBe(0);
    expect(((await rpc<Json>(as(m2), "media_items", ["video", j({ q: "Group Only" }), 50, 0])).total)).toBe(0);
    expect(await thumbOk(as(m1), groupAsset)).toBe(true);
    expect(await thumbOk(as(m2), groupAsset)).toBe(false);

    const later = await link("EEEEEEEEEE3", "Synthetic Scheduled Video");
    const scheduled = (await rpc<Json>(as(editor), "media_admin_video_publish", [later])).id as string;
    expect((await publish(scheduled, new Date(Date.now() + 86_400_000))).state).toBe("scheduled");
    expect(await search(as(m1), "Scheduled Video")).toEqual([]);
    expect(await thumbOk(as(m1), later)).toBe(false);

    const gone = await link("EEEEEEEEEE4", "Synthetic Expired Video");
    const expired = (await rpc<Json>(as(editor), "media_admin_video_publish", [gone])).id as string;
    await publish(expired, new Date(Date.now() - 2 * 86_400_000), new Date(Date.now() - 86_400_000));
    expect(await search(as(m1), "Expired Video")).toEqual([]);
  });

  it("adds videos to albums only through moderators and review, keeping photo counts and youth consent", async () => {
    const album = await rpc<string>(as(galleryMod), "media_admin_album_save", [null, j({ title: "Synthetic mixed album", audience: "members", uploads_open: true })]);
    await rpc(as(galleryMod), "media_admin_album_status", [album, "publish"]);
    // Members can't add videos (their upload rights are photos only).
    await fails(as(m1), "media_admin_album_video_add", [album, null, "youtube", "FFFFFFFFFF1", null, "https://youtu.be/FFFFFFFFFF1", "x", ""], /permission/);
    const before = await assetCount();
    const entry = await rpc<string>(as(galleryMod), "media_admin_album_video_add", [album, null, "youtube", "FFFFFFFFFF1", null, "https://youtu.be/FFFFFFFFFF1", "Synthetic choir clip", "Choir night"]);
    expect(await assetCount()).toBe(before + 1);
    const asset = (await db.raw<{ asset_id: string }>("select asset_id from media.photos where id = $1", [entry]))[0].asset_id;
    await fails(as(galleryMod), "media_admin_album_video_add", [album, asset, null, null, null, null, null, ""], /already in the album/);

    // Waiting for review: members see nothing.
    let page = await rpc<Json>(as(m1), "media_album", [album]);
    expect(page.photos).toEqual([]);
    expect(await thumbOk(as(m1), asset)).toBe(false);
    // The minors review is required, and the youth consent guard applies to videos too.
    await fails(as(galleryMod), "media_admin_photo_review", [entry, "approve", null, "unreviewed", null, null], /under 18/);
    const child = (await db.raw<{ id: string }>("insert into youth.children (display_name) values ('Synthetic Child') returning id"))[0].id;
    await db.raw("insert into youth.photo_subjects (photo_id, child_id) values ($1, $2)", [entry, child]);
    await fails(as(galleryMod), "media_admin_photo_review", [entry, "approve", null, "permission_confirmed", null, null], /consent/);
    await db.raw("delete from youth.photo_subjects where photo_id = $1", [entry]);

    const r = await rpc<Json>(as(galleryMod), "media_admin_photo_review", [entry, "approve", null, "none", null, null]);
    expect(r).toMatchObject({ status: "approved", uploads: [], media: [] });
    page = await rpc<Json>(as(m1), "media_album", [album]);
    const shown = page.photos as Json[];
    expect(shown.map((p) => [p.kind, p.caption])).toEqual([["video", "Choir night"]]);
    expect((shown[0].video as Json).provider_ref).toBe("FFFFFFFFFF1");
    expect(page.photo_count).toBe(0);
    expect(page.video_count).toBe(1);
    expect(page.cover).toBeNull();
    expect(page.my_pending).toEqual([]);
    expect(await thumbOk(as(m1), asset)).toBe(true);
    // A video can't be the album cover.
    await fails(as(galleryMod), "media_admin_album_cover", [album, entry], /published photo/);
    // Reports work the same as for photos; the moderator who added it gets no "your photo" notice.
    await rpc(as(m2), "media_photo_report", [entry, "removal_request", "I'm in this video"]);
    const reports = await rpc<Json[]>(as(galleryMod), "media_admin_photo_reports", ["open"]);
    expect(reports.some((x) => (x.photo as Json).id === entry)).toBe(true);
    expect((await db.raw("select 1 from community.notifications where profile_id = $1 and kind = 'gallery_outcome'", [galleryMod])).length).toBe(0);
    // In use: the library file can't be removed.
    await fails(as(mediaMgr), "media_admin_asset_remove", [asset], /in use|used/i);

    // Hidden: gone for members at once, thumbnail included.
    await rpc(as(galleryMod), "media_admin_photo_review", [entry, "hide", "Checking a request", null, null, null]);
    expect((await rpc<Json>(as(m1), "media_album", [album])).photos).toEqual([]);
    expect(await thumbOk(as(m1), asset)).toBe(false);
    await rpc(as(galleryMod), "media_admin_photo_review", [entry, "unhide", null, null, null, null]);
    expect(((await rpc<Json>(as(m1), "media_album", [album])).photos as Json[]).length).toBe(1);
    // Removal stops showing it and keeps the library video.
    await rpc(as(galleryMod), "media_admin_photo_review", [entry, "remove", null, null, null, null]);
    expect((await rpc<Json>(as(m1), "media_album", [album])).photos).toEqual([]);
    expect((await db.raw<{ status: string }>("select status from media.assets where id = $1", [asset]))[0].status).toBe("ready");
  });
});
