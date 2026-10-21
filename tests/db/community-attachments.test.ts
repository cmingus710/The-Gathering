import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Phase 13 forum attachments against a real database: draft ownership,
 * storage policies, attaching on create, group isolation, guessed ids,
 * moderation (hidden content), deletion, limits, and abandoned-upload
 * cleanup. Storage is the local shim (storage.objects rows only), so these
 * check the policies and functions, not hosted Storage itself. Every person
 * and post here is synthetic.
 */
type Json = Record<string, unknown>;

describeDb("community attachments", () => {
  let db: TestDb;
  let moderator: string; // community moderator, also in group A
  let mediaMgr: string; // media manager (no community capability)
  let leaderA: string;
  let m1: string; // member of group A
  let m2: string; // member of group B only
  let m3: string; // in no group
  let groupA: string;
  let groupB: string;
  let category: string;

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
  const ack = async (id: string) => {
    const g = await rpc<Json>(as(id), "community_guidelines");
    await rpc(as(id), "community_ack_guidelines", [g.version]);
  };
  const canRead = async (actor: Actor, bucket: string, name: string) =>
    (await db.query(actor, "select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name])).length === 1;
  const putObject = (actor: Actor, bucket: string, name: string, size = 1000, mimetype = "image/jpeg") =>
    db.query(actor, "insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4)", [
      bucket,
      name,
      actor.role === "authenticated" ? actor.userId : null,
      JSON.stringify({ size, mimetype }),
    ]);
  const deleteObjects = (actor: Actor, bucket: string, names: string[]) =>
    db.query(actor, "delete from storage.objects where bucket_id = $1 and name = any ($2) returning name", [bucket, names]);
  const row = async (id: string) => (await db.raw<Json>("select * from community.attachments where id = $1", [id]))[0];

  type Begun = { id: string; bucket: string; path: string; status: string };
  const begin = (owner: string, batch: string, kind: "image" | "video" = "image", opts: { mime?: string; size?: number; key?: string } = {}) =>
    rpc<Begun>(as(owner), "community_attachment_begin", [
      batch,
      opts.key ?? randomUUID(),
      kind,
      opts.mime ?? (kind === "image" ? "image/jpeg" : "video/mp4"),
      opts.size ?? 2_000_000,
      null,
      null,
      kind === "video" ? 12.5 : null,
    ]);

  /** Runs the whole upload flow the app runs (browser upload + server processing) for one file. */
  const ready = async (owner: string, batch: string, kind: "image" | "video" = "image") => {
    const b = await begin(owner, batch, kind);
    await putObject(as(owner), b.bucket, b.path, 2_000_000, kind === "image" ? "image/jpeg" : "video/mp4");
    await rpc(as(owner), "community_attachment_processing", [b.id]);
    if (kind === "image") {
      const stem = `community/${owner}/${b.id}/v-${randomUUID().slice(0, 8)}`;
      await putObject(as(owner), "media", `${stem}-display.webp`, 300_000, "image/webp");
      await putObject(as(owner), "media", `${stem}-thumb.webp`, 30_000, "image/webp");
      const r = await rpc<Json>(as(owner), "community_attachment_ready", [b.id, `${stem}-display.webp`, `${stem}-thumb.webp`, 2048, 1536, 300_000, "a".repeat(64)]);
      expect(r.original).toBe(b.path);
      await deleteObjects(as(owner), "media-uploads", [b.path]);
    } else {
      await rpc(as(owner), "community_attachment_ready", [b.id, null, null, 1280, 720, null, null]);
    }
    return b.id;
  };
  const paths = async (id: string) => {
    const r = await row(id);
    return { display: r.display_path as string | null, thumb: r.thumb_path as string | null, video: r.video_path as string | null };
  };
  const threadWithMedia = (owner: string, ids: string[], opts: { group?: string; alts?: string[]; key?: string } = {}) =>
    rpc<string>(as(owner), "community_thread_create_with_media", [
      opts.group ? null : category,
      opts.group ?? null,
      "A synthetic photo discussion",
      "Synthetic body text.",
      opts.key ?? randomUUID(),
      ids,
      opts.alts ?? ids.map(() => "A synthetic description"),
    ]);
  const replyWithMedia = (owner: string, thread: string, ids: string[]) =>
    rpc<string>(as(owner), "community_reply_with_media", [thread, "Synthetic reply.", randomUUID(), ids, ids.map(() => "")]);
  const file = (actor: Actor, id: string, variant: string) => rpc<Json | null>(actor, "community_attachment_file", [id, variant]);
  const listed = async (actor: Actor, thread: string) => rpc<{ thread: Json[]; posts: Record<string, Json[]> } | null>(actor, "community_thread_attachments", [thread]);

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string) => {
      const id = await db.createAuthUser(email, { fullName: name });
      await db.setStatus(id, "approved");
      return id;
    };
    const communityAdmin = await mk("a.cadmin@example.test", "Synthetic Community Admin");
    moderator = await mk("a.moderator@example.test", "Synthetic Moderator");
    mediaMgr = await mk("a.media@example.test", "Synthetic Media Manager");
    leaderA = await mk("a.leader@example.test", "Synthetic Leader");
    m1 = await mk("a.m1@example.test", "Alpha Member");
    m2 = await mk("a.m2@example.test", "Bravo Member");
    m3 = await mk("a.m3@example.test", "Charlie Member");
    await db.grantRole(communityAdmin, "community_admin");
    await db.grantRole(moderator, "community_moderator");
    await db.grantRole(mediaMgr, "media_manager");
    for (const id of [moderator, mediaMgr, leaderA, m1, m2, m3]) await ack(id);
    category = (await db.raw<{ id: string }>("select id from community.categories where name = 'General Discussion'"))[0].id;
    groupA = await rpc<string>(as(communityAdmin), "community_group_save", [
      JSON.stringify({ name: "Synthetic Group A", summary: "A", about: "A", visibility: "hidden", leader_id: leaderA }),
    ]);
    groupB = await rpc<string>(as(communityAdmin), "community_group_save", [
      JSON.stringify({ name: "Synthetic Group B", summary: "B", about: "B", visibility: "hidden", leader_id: leaderA }),
    ]);
    for (const [g, p] of [[groupA, m1], [groupA, moderator], [groupB, m2]]) {
      await db.raw("insert into community.group_members (group_id, profile_id) values ($1, $2)", [g, p]);
    }
  });

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(async () => {
    await db.raw("delete from community.rate_events where profile_id is not null");
  });

  it("keeps the table and functions closed to visitors and direct reads", async () => {
    await expect(db.query(as(m1), "select * from community.attachments")).rejects.toThrow(/permission denied/);
    await expect(db.query(anon, "select public.community_attachment_file($1, 'thumb')", [randomUUID()])).rejects.toThrow(/permission denied/);
    await expect(db.query(anon, "select public.community_thread_attachments($1)", [randomUUID()])).rejects.toThrow(/permission denied/);
    await expect(db.query(as(m1), "select community.attachment_limits()")).rejects.toThrow(/permission denied/);
  });

  it("lets only the owner upload to the registered path, and only the owner read the original", async () => {
    const batch = randomUUID();
    const b = await begin(m1, batch);
    expect(b.bucket).toBe("media-uploads");
    expect(b.path).toMatch(new RegExp(`^community/${m1}/${b.id}/original\\.jpg$`));
    // A retried begin is the same attachment.
    const key = randomUUID();
    const first = await begin(m1, batch, "image", { key });
    expect((await begin(m1, batch, "image", { key })).id).toBe(first.id);
    // Nobody else can write there, and the owner can't write elsewhere.
    await expect(putObject(as(m2), "media-uploads", b.path)).rejects.toThrow(/row-level security/);
    await expect(putObject(as(m1), "media-uploads", `community/${m1}/${randomUUID()}/original.jpg`)).rejects.toThrow(/row-level security/);
    await expect(putObject(as(m1), "media", `community/${m1}/${b.id}/v-x-display.webp`)).rejects.toThrow(/row-level security/);
    await putObject(as(m1), "media-uploads", b.path);
    expect(await canRead(as(m1), "media-uploads", b.path)).toBe(true);
    expect(await canRead(as(m2), "media-uploads", b.path)).toBe(false);
    expect(await canRead(as(moderator), "media-uploads", b.path)).toBe(false);
    // Processing opens the variant paths to the owner only, until ready.
    await rpc(as(m1), "community_attachment_processing", [b.id]);
    await expect(putObject(as(m2), "media", `community/${m1}/${b.id}/v-x-display.webp`)).rejects.toThrow(/row-level security/);
    await fails(as(m1), "community_attachment_ready", [b.id, `community/${m1}/${b.id}/v-x-display.webp`, `community/${m1}/${b.id}/v-x-thumb.webp`, 10, 10, 1, null], /wasn't found/);
    // Drafts are served to their owner only.
    const id = await ready(m1, batch);
    expect(await file(as(m1), id, "thumb")).toMatchObject({ bucket: "media" });
    expect(await file(as(m2), id, "thumb")).toBeNull();
    const p = await paths(id);
    expect(await canRead(as(m2), "media", p.thumb!)).toBe(false);
    await rpc(as(m1), "community_attachment_discard", [first.id]);
    await rpc(as(m1), "community_attachment_discard", [b.id]);
    await rpc(as(m1), "community_attachment_discard", [id]);
  });

  it("attaches ready uploads on create and shows them to group members only", async () => {
    const batch = randomUUID();
    const img = await ready(m1, batch);
    const vid = await ready(m1, batch, "video");
    const t = await threadWithMedia(m1, [img, vid], { group: groupA, alts: ["Two synthetic people at a picnic", "ignored for video"] });
    const mine = await listed(as(m1), t);
    expect(mine!.thread.map((a) => a.id)).toEqual([img, vid]);
    expect(mine!.thread[0]).toMatchObject({ kind: "image", alt_text: "Two synthetic people at a picnic", mime: "image/webp" });
    expect(mine!.thread[1]).toMatchObject({ kind: "video", alt_text: "" });
    expect(JSON.stringify(mine)).not.toMatch(/community\//); // no storage paths in what members see
    const p = await paths(img);
    const v = await paths(vid);
    expect(await canRead(as(moderator), "media", p.display!)).toBe(true); // a group member
    expect(await file(as(moderator), vid, "video")).toMatchObject({ path: v.video });
    // Not in the group: nothing, by listing, by id, or through storage.
    for (const outsider of [m2, m3, mediaMgr]) {
      expect(await listed(as(outsider), t)).toBeNull();
      expect(await file(as(outsider), img, "display")).toBeNull();
      expect(await canRead(as(outsider), "media", p.display!)).toBe(false);
      expect(await canRead(as(outsider), "media", v.video!)).toBe(false);
    }
    // Wrong variant for the kind: nothing.
    expect(await file(as(m1), img, "video")).toBeNull();
    expect(await file(as(m1), vid, "thumb")).toBeNull();
    // Leaving the group removes access at once.
    await db.raw("update community.group_members set state = 'left', ended_at = now() where group_id = $1 and profile_id = $2", [groupA, moderator]);
    expect(await file(as(moderator), img, "display")).toBeNull();
    expect(await canRead(as(moderator), "media", p.display!)).toBe(false);
    await db.raw("update community.group_members set state = 'active', ended_at = null where group_id = $1 and profile_id = $2", [groupA, moderator]);
  });

  it("denies an id guessed from another group", async () => {
    const inB = await ready(m2, randomUUID());
    const tB = await threadWithMedia(m2, [inB], { group: groupB });
    const inA = await ready(m1, randomUUID());
    await threadWithMedia(m1, [inA], { group: groupA });
    // m1 (group A) asks for group B's attachment by id: refused everywhere.
    expect(await file(as(m1), inB, "display")).toBeNull();
    expect(await file(as(m1), inB, "thumb")).toBeNull();
    expect(await listed(as(m1), tB)).toBeNull();
    expect(await canRead(as(m1), "media", (await paths(inB)).display!)).toBe(false);
    // And the reverse.
    expect(await file(as(m2), inA, "display")).toBeNull();
    // A random id is just as unknown.
    expect(await file(as(m1), randomUUID(), "display")).toBeNull();
  });

  it("keeps media managers out of community files (media library rule carve-out)", async () => {
    const id = await ready(m1, randomUUID());
    await threadWithMedia(m1, [id]); // church-wide
    const p = await paths(id);
    // mediaMgr is an approved member, so they see it as a member would…
    expect(await canRead(as(mediaMgr), "media", p.display!)).toBe(true);
    // …but only through discussion access: the library rule no longer applies.
    const [{ ok }] = await db.query<{ ok: boolean }>(as(mediaMgr), "select public.media_can_read_object('media', $1) ok", [p.display]);
    expect(ok).toBe(false);
  });

  it("hides attachments of hidden replies and threads from members but not moderators", async () => {
    const t = await threadWithMedia(m1, [await ready(m1, randomUUID())], { group: groupA });
    const replyImg = await ready(m1, randomUUID());
    const post = await replyWithMedia(m1, t, [replyImg]);
    const p = await paths(replyImg);
    expect((await listed(as(m1), t))!.posts[post].map((a) => a.id)).toEqual([replyImg]);

    await rpc(as(moderator), "community_mod_post", [post, "hide", "Synthetic reason", null]);
    expect((await listed(as(m1), t))!.posts[post]).toBeUndefined();
    expect(await file(as(m1), replyImg, "display")).toBeNull();
    expect(await canRead(as(m1), "media", p.display!)).toBe(false); // the author too, like the text
    expect(await canRead(as(leaderA), "media", p.display!)).toBe(true); // the group's leader moderates it
    expect((await listed(as(moderator), t))!.posts[post].map((a) => a.id)).toEqual([replyImg]);
    expect(await file(as(moderator), replyImg, "display")).not.toBeNull();
    expect(await canRead(as(moderator), "media", p.display!)).toBe(true);

    await rpc(as(moderator), "community_mod_post", [post, "restore", "Synthetic reason", null]);
    expect(await file(as(m1), replyImg, "display")).not.toBeNull();

    // A hidden thread hides everything in it from members.
    await rpc(as(moderator), "community_mod_thread", [t, "hide", "Synthetic reason", null]);
    expect(await listed(as(m1), t)).toMatchObject({ thread: [], posts: {} });
    expect(await file(as(m1), replyImg, "display")).toBeNull();
    expect((await listed(as(moderator), t))!.thread).toHaveLength(1);
    await rpc(as(moderator), "community_mod_thread", [t, "restore", "Synthetic reason", null]);
    expect((await listed(as(m1), t))!.thread).toHaveLength(1);
  });

  it("removes access when a reply is deleted and returns its files for deletion", async () => {
    const t = await threadWithMedia(m1, [await ready(m1, randomUUID())]);
    const img = await ready(m2, randomUUID());
    const post = await replyWithMedia(m2, t, [img]);
    const p = await paths(img);
    // Only the author can delete; nothing changes otherwise.
    await fails(as(m1), "community_reply_delete_with_media", [post], /wasn't found/);
    const r = await rpc<{ files: Array<{ id: string; uploads: string[]; media: string[] }> }>(as(m2), "community_reply_delete_with_media", [post]);
    expect(r.files).toHaveLength(1);
    expect(r.files[0].id).toBe(img);
    expect(r.files[0].media.sort()).toEqual([p.display, p.thumb].sort());
    expect((await row(img)).status).toBe("removed");
    expect(await file(as(m2), img, "display")).toBeNull();
    expect(await canRead(as(m1), "media", p.display!)).toBe(false);
    expect((await listed(as(m1), t))!.posts[post]).toBeUndefined();
    // Recording deletion is checked against storage: not while files remain.
    expect(await rpc<number>(as(m2), "community_attachments_objects_deleted", [[img]])).toBe(0);
    expect(await deleteObjects(as(m2), "media", r.files[0].media)).toHaveLength(2);
    expect(await rpc<number>(as(m2), "community_attachments_objects_deleted", [[img]])).toBe(1);
    expect(await row(img)).toMatchObject({ status: "removed", display_path: null });
    expect((await row(img)).objects_deleted_at).not.toBeNull();
  });

  it("removes a deleted thread's own attachments, hard-deleted or placeholder", async () => {
    // No replies: the thread row is removed.
    const a = await ready(m1, randomUUID());
    const t1 = await threadWithMedia(m1, [a]);
    const r1 = await rpc<{ result: string; files: Json[] }>(as(m1), "community_thread_delete_with_media", [t1]);
    expect(r1.result).toBe("removed");
    expect(r1.files).toHaveLength(1);
    expect(await row(a)).toMatchObject({ status: "removed", thread_id: null });
    expect(await file(as(m1), a, "display")).toBeNull();
    // With replies: a placeholder stays; the thread's media go, replies' media stay.
    const b = await ready(m1, randomUUID());
    const t2 = await threadWithMedia(m1, [b]);
    const c = await ready(m2, randomUUID());
    const post = await replyWithMedia(m2, t2, [c]);
    const r2 = await rpc<{ result: string; files: Json[] }>(as(m1), "community_thread_delete_with_media", [t2]);
    expect(r2.result).toBe("placeholder");
    expect(r2.files.map((f) => f.id)).toEqual([b]);
    expect(await file(as(m3), b, "display")).toBeNull();
    expect((await listed(as(m3), t2))!.posts[post].map((x) => x.id)).toEqual([c]);
  });

  it("never attaches someone else's upload", async () => {
    const theirs = await ready(m1, randomUUID());
    const before = await db.raw<{ n: number }>("select count(*)::int n from community.threads where author_id = $1", [m2]);
    await fails(as(m2), "community_thread_create_with_media", [category, null, "Synthetic title", "Body", randomUUID(), [theirs], [""]], /wasn't found/);
    // The whole post was rolled back, and the upload is untouched.
    expect(await db.raw<{ n: number }>("select count(*)::int n from community.threads where author_id = $1", [m2])).toEqual(before);
    expect((await row(theirs)).status).toBe("ready");
    const t = await threadWithMedia(m2, []);
    await fails(as(m2), "community_reply_with_media", [t, "Reply", randomUUID(), [theirs], [""]], /wasn't found/);
    // Or one already attached elsewhere.
    const used = await ready(m1, randomUUID());
    await threadWithMedia(m1, [used]);
    await fails(as(m1), "community_reply_with_media", [t, "Reply", randomUUID(), [used], [""]], /couldn't be added/);
    await rpc(as(m1), "community_attachment_discard", [theirs]);
  });

  it("refuses attaching to a thread the author can't post in", async () => {
    const tA = await threadWithMedia(m1, [], { group: groupA });
    const mine = await ready(m3, randomUUID());
    await fails(as(m3), "community_reply_with_media", [tA, "Reply", randomUUID(), [mine], [""]], /wasn't found/);
    await fails(as(m3), "community_thread_create_with_media", [null, groupA, "Synthetic title", "Body", randomUUID(), [mine], [""]], /Only members/);
    await rpc(as(moderator), "community_mod_thread", [tA, "lock", null, null]);
    await fails(as(m1), "community_reply_with_media", [tA, "Reply", randomUUID(), [await ready(m1, randomUUID())], [""]], /locked/);
    expect((await row(mine)).status).toBe("ready");
    // A posting restriction stops uploads too.
    await db.raw("insert into community.restrictions (profile_id, scope, reason, created_by) values ($1, 'posting', 'Synthetic', $2)", [m3, moderator]);
    await fails(as(m3), "community_attachment_begin", [randomUUID(), randomUUID(), "image", "image/jpeg", 1000, null, null, null], /paused/);
    await db.raw("delete from community.restrictions where profile_id = $1", [m3]);
    await rpc(as(m3), "community_attachment_discard", [mine]);
  });

  it("enforces type, size, and count limits", async () => {
    const batch = randomUUID();
    await fails(as(m1), "community_attachment_begin", [batch, randomUUID(), "image", "image/gif", 1000, null, null, null], /JPEG, PNG, WebP/);
    await fails(as(m1), "community_attachment_begin", [batch, randomUUID(), "video", "video/quicktime", 1000, null, null, null], /export as MP4 \(H\.264\)/);
    await fails(as(m1), "community_attachment_begin", [batch, randomUUID(), "image", "image/jpeg", 20 * 1024 * 1024 + 1, null, null, null], /20 MB/);
    await fails(as(m1), "community_attachment_begin", [batch, randomUUID(), "video", "video/mp4", 50 * 1024 * 1024 + 1, null, null, null], /50 MB/);
    await fails(as(m1), "community_attachment_begin", [batch, randomUUID(), "file", "application/pdf", 1000, null, null, null], /photo or a video/);
    // Six per post, at most two of them video.
    const ids: string[] = [];
    ids.push(await ready(m1, batch, "video"), await ready(m1, batch, "video"));
    await fails(as(m1), "community_attachment_begin", [batch, randomUUID(), "video", "video/mp4", 1000, null, null, null], /2 videos/);
    for (let i = 0; i < 4; i++) ids.push(await ready(m1, batch));
    await fails(as(m1), "community_attachment_begin", [batch, randomUUID(), "image", "image/jpeg", 1000, null, null, null], /up to 6/);
    // Attaching more than six at once (from two drafts) is refused too.
    const extra = await ready(m1, randomUUID());
    await fails(as(m1), "community_thread_create_with_media", [category, null, "Synthetic title", "Body", randomUUID(), [...ids, extra], []], /up to 6/);
    // Alt text is limited to 300 characters.
    await fails(as(m1), "community_thread_create_with_media", [category, null, "Synthetic title", "Body", randomUUID(), [extra], ["x".repeat(301)]], /300 characters/);
    // Still uploading can't be posted.
    const pending = await begin(m1, randomUUID());
    await fails(as(m1), "community_thread_create_with_media", [category, null, "Synthetic title", "Body", randomUUID(), [pending.id], [""]], /still uploading/);
    // A retried post (same key) doesn't duplicate or fail.
    const key = randomUUID();
    const t = await threadWithMedia(m1, ids, { key });
    expect(await threadWithMedia(m1, ids, { key })).toBe(t);
    expect((await listed(as(m2), t))!.thread).toHaveLength(6);
    // Open, never-posted drafts are capped.
    await db.raw(
      `insert into community.attachments (owner_id, batch_key, client_key, kind, status, upload_bucket, upload_path, mime, size_bytes)
       select $1::uuid, gen_random_uuid(), gen_random_uuid(), 'image', 'uploading', 'media-uploads', 'community/' || $1::text || '/x' || g || '/original.jpg', 'image/jpeg', 1
         from generate_series(1, 18) g`,
      [m2],
    );
    await fails(as(m2), "community_attachment_begin", [randomUUID(), randomUUID(), "image", "image/jpeg", 1000, null, null, null], /never posted/);
    await db.raw("delete from community.attachments where owner_id = $1 and upload_path like '%/x%'", [m2]);
    await rpc(as(m1), "community_attachment_discard", [pending.id]);
    await rpc(as(m1), "community_attachment_discard", [extra]);
  });

  it("rate limits uploads", async () => {
    for (let i = 0; i < 40; i++) await db.raw("insert into community.rate_events (profile_id, action) values ($1, 'attachment')", [m3]);
    await fails(as(m3), "community_attachment_begin", [randomUUID(), randomUUID(), "image", "image/jpeg", 1000, null, null, null], /too often/);
  });

  it("cancels or removes drafts, deleting the row once the files are gone", async () => {
    const b = await begin(m1, randomUUID());
    await putObject(as(m1), b.bucket, b.path);
    await fails(as(m2), "community_attachment_processing", [b.id], /wasn't found/);
    const r = await rpc<{ uploads: string[]; media: string[] }>(as(m1), "community_attachment_discard", [b.id]);
    expect(r.uploads).toEqual([b.path]);
    // Another member's discard does nothing.
    expect(await rpc<Json>(as(m2), "community_attachment_discard", [b.id])).toMatchObject({ uploads: [], media: [] });
    await expect(deleteObjects(as(m2), "media-uploads", [b.path])).resolves.toHaveLength(0);
    expect(await deleteObjects(as(m1), "media-uploads", [b.path])).toHaveLength(1);
    expect(await rpc<number>(as(m1), "community_attachments_objects_deleted", [[b.id]])).toBe(1);
    expect(await row(b.id)).toBeUndefined();
    // Attached media can only go with the post.
    const used = await ready(m1, randomUUID());
    await threadWithMedia(m1, [used]);
    await fails(as(m1), "community_attachment_discard", [used], /Delete the post/);
  });

  it("lists abandoned uploads, removed files, and orphans for cleanup by moderators only", async () => {
    const stale = await ready(m2, randomUUID());
    const fresh = await ready(m2, randomUUID());
    await db.raw("update community.attachments set updated_at = now() - interval '25 hours' where id = $1", [stale]);
    const orphan = `community/${m2}/${randomUUID()}/v-lost-display.webp`;
    await db.raw("insert into storage.objects (bucket_id, name, metadata, created_at) values ('media', $1, '{}', now() - interval '2 days')", [orphan]);
    await fails(as(m1), "community_mod_attachment_cleanup", [], /permission/);
    await fails(as(m1), "community_mod_attachment_discard", [[stale]], /permission/);
    const c = await rpc<{ hours: number; abandoned: Json[]; removed: Json[]; orphans: Json[] }>(as(moderator), "community_mod_attachment_cleanup");
    expect(c.hours).toBe(24);
    const abandonedIds = c.abandoned.map((a) => a.id);
    expect(abandonedIds).toContain(stale);
    expect(abandonedIds).not.toContain(fresh);
    expect(c.orphans.map((o) => o.path)).toContain(orphan);
    expect(JSON.stringify(c)).not.toMatch(/Synthetic|Bravo/); // no names or text
    // Media managers can run it too.
    expect((await rpc<{ abandoned: Json[] }>(as(mediaMgr), "community_mod_attachment_cleanup")).abandoned.map((a) => a.id)).toContain(stale);
    // Discarding only touches what's actually abandoned.
    const files = await rpc<Array<{ id: string; uploads: string[]; media: string[] }>>(as(moderator), "community_mod_attachment_discard", [[stale, fresh]]);
    expect(files.map((f) => f.id)).toEqual([stale]);
    expect((await row(fresh)).status).toBe("ready");
    expect(await deleteObjects(as(moderator), "media", files[0].media)).toHaveLength(2);
    expect(await deleteObjects(as(moderator), "media", [orphan])).toHaveLength(1);
    expect(await rpc<number>(as(moderator), "community_attachments_objects_deleted", [[stale]])).toBe(1);
    const after = await rpc<{ abandoned: Json[]; removed: Json[]; orphans: Json[] }>(as(moderator), "community_mod_attachment_cleanup");
    expect([...after.abandoned, ...after.removed].map((a) => a.id)).not.toContain(stale);
    expect(after.orphans.map((o) => o.path)).not.toContain(orphan);
  });

  it("keeps reports working on posts with media", async () => {
    const t = await threadWithMedia(m1, [await ready(m1, randomUUID())]);
    const report = await rpc<string>(as(m2), "community_report", ["thread", [t], "spam", null]);
    const detail = await rpc<Json>(as(moderator), "community_mod_report", [report]);
    expect(detail.thread_id).toBe(t);
  });
});
