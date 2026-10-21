import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCommunityJob } from "@/lib/community/jobs";
import { createMediaJob, signMediaJob } from "@/lib/media/jobs";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Phase 7 teaching, media, podcasts, and galleries against a real database:
 * scoped capabilities (editor vs publisher vs media manager vs podcast
 * manager vs gallery moderator), public/member/group isolation across lists,
 * details, search, related links, bookmarks, progress, storage objects and
 * covers; draft, scheduled, expired, and archived content; rights before
 * publishing; asset usage, replacement, and removal; external feed import
 * (deduplication, changed URLs, removed episodes, failures); the public feed;
 * the photo upload lifecycle and moderation; and notifications (batching,
 * deduplication, access rechecks, generic external wording). Every person,
 * item, and file here is synthetic.
 */
const SECRET = "test-events-job-secret-0123456789abcdef012345";
type Json = Record<string, unknown>;

describeDb("teaching, media, podcasts, and galleries", () => {
  let db: TestDb;
  let admin: string; // super administrator
  let editor: string; // content editor: drafts only
  let publisher: string; // content publisher
  let mediaMgr: string; // media manager
  let podMgr: string; // podcast manager
  let galleryMod: string; // gallery moderator
  let coordinator: string; // event coordinator
  let leader: string; // the group's leader
  let m1: string; // member in the group
  let m2: string; // member outside the group
  let pending: string;
  let suspended: string;
  let group: string;
  let groupThread: string;
  let churchThread: string;

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
  const status = (actor: Actor, id: string, action: string, opts: { at?: Date | null; expires?: Date | null; confirm?: string | null } = {}) =>
    rpc<Json>(actor, "media_admin_item_status", [id, action, opts.at ?? null, opts.expires ?? null, opts.confirm ?? null]);
  const visible = async (actor: Actor, id: string) => {
    try {
      await rpc(actor, "media_item", [id]);
      return true;
    } catch {
      return false;
    }
  };
  const list = async (actor: Actor, kind: string, filters: Json = {}) =>
    ((await rpc<Json>(actor, "media_items", [kind, j(filters), 50, 0])).items as Json[]).map((x) => x.id);
  const canRead = async (actor: Actor, bucket: string, name: string) =>
    (await db.query(actor, "select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name])).length === 1;
  const putObject = (actor: Actor, bucket: string, name: string, size = 1000, mimetype = "audio/mpeg") =>
    db.query(actor, "insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4)", [
      bucket,
      name,
      actor.role === "authenticated" ? actor.userId : null,
      j({ size, mimetype }),
    ]);
  const notifs = async (id: string) => ((await rpc<Json>(as(id), "community_notifications", [null, 50])).items as Json[]);
  const mediaJob = () =>
    createMediaJob(SECRET, async (a) => {
      try {
        const rows = await db.query<{ r: unknown }>(anon, "select public.media_job($1, $2, $3, $4) as r", [a.p_op, a.p_payload, a.p_ts, a.p_sig]);
        return { data: rows[0].r, error: null };
      } catch (err) {
        return { data: null, error: { message: (err as Error).message, code: (err as { code?: string }).code } };
      }
    });
  const communityJob = () =>
    createCommunityJob(SECRET, async (a) => {
      try {
        const rows = await db.query<{ r: unknown }>(anon, "select public.community_job($1, $2, $3, $4) as r", [a.p_op, a.p_payload, a.p_ts, a.p_sig]);
        return { data: rows[0].r, error: null };
      } catch (err) {
        return { data: null, error: { message: (err as Error).message, code: (err as { code?: string }).code } };
      }
    });

  /** A ready audio asset with confirmed rights, uploaded by the media manager. */
  const readyAsset = async (kind = "audio", opts: { publicOk?: boolean; rights?: boolean; mime?: string } = {}) => {
    const mime = opts.mime ?? (kind === "audio" ? "audio/mpeg" : kind === "image" ? "image/jpeg" : kind === "document" ? "application/pdf" : "video/mp4");
    const begun = await rpc<Json>(as(mediaMgr), "media_admin_asset_begin", [kind, `Synthetic ${kind}`, `synthetic.${kind}`, mime, 1000, randomUUID(), null, null]);
    const id = begun.id as string;
    await putObject(as(mediaMgr), "media", begun.upload_path as string, 1000, mime);
    await rpc(as(mediaMgr), "media_admin_asset_processing", [id]);
    let path = begun.upload_path as string;
    if (kind === "image") {
      path = `assets/${id}/processed.webp`;
      await putObject(as(mediaMgr), "media", path, 500, "image/webp");
    }
    await rpc(as(mediaMgr), "media_admin_asset_complete", [id, path, null, kind === "image" ? "image/webp" : mime, 100, 100, kind === "audio" ? 600 : null, "browser"]);
    if (opts.rights !== false) {
      await rpc(as(mediaMgr), "media_admin_asset_update", [id, j({ rights: "church_owned", confirm_rights: true, public_ok: opts.publicOk ?? false })]);
    }
    return { id, path };
  };
  const devotional = async (title: string, opts: { audience?: string; group?: string; confirm?: string; date?: string; notify?: boolean } = {}) => {
    const r = await save(as(publisher), null, {
      kind: "devotional",
      title,
      body: "Synthetic body.",
      audience: opts.audience ?? "members",
      group_id: opts.group ?? null,
      confirm_public: opts.confirm ?? null,
      devotional_on: opts.date ?? null,
      notify: opts.notify ?? false,
    });
    return r.id as string;
  };

  beforeAll(async () => {
    db = await TestDb.create();
    await db.raw("insert into events.secrets (name, value) values ('job', $1)", [SECRET]);
    const mk = async (email: string, name: string, state: "approved" | "pending" | "suspended" = "approved") => {
      const id = await db.createAuthUser(email, { fullName: name });
      if (state !== "pending") await db.setStatus(id, "approved");
      if (state === "suspended") await db.setStatus(id, "suspended");
      return id;
    };
    admin = await mk("m.admin@example.test", "Synthetic Admin");
    editor = await mk("m.editor@example.test", "Synthetic Editor");
    publisher = await mk("m.publisher@example.test", "Synthetic Publisher");
    mediaMgr = await mk("m.media@example.test", "Synthetic Media");
    podMgr = await mk("m.pod@example.test", "Synthetic Podcasts");
    galleryMod = await mk("m.gallery@example.test", "Synthetic Gallery");
    coordinator = await mk("m.coord@example.test", "Synthetic Coordinator");
    leader = await mk("m.leader@example.test", "Synthetic Leader");
    m1 = await mk("m.m1@example.test", "Alpha Member");
    m2 = await mk("m.m2@example.test", "Bravo Member");
    pending = await mk("m.pending@example.test", "Pending Person", "pending");
    suspended = await mk("m.suspended@example.test", "Suspended Person", "suspended");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(editor, "content_editor");
    await db.grantRole(publisher, "content_publisher");
    await db.grantRole(mediaMgr, "media_manager");
    await db.grantRole(podMgr, "podcast_manager");
    await db.grantRole(galleryMod, "gallery_moderator");
    await db.grantRole(coordinator, "event_coordinator");
    group = await rpc<string>(as(admin), "community_group_save", [
      j({ name: "Synthetic Study Group", summary: "s", about: "a", visibility: "discoverable", leader_id: leader }),
    ]);
    // m1 is an ordinary member; the publisher belongs too (to link group discussions).
    for (const id of [m1, publisher]) {
      await db.raw("insert into community.group_members (group_id, profile_id) values ($1, $2)", [group, id]);
    }
    // Discussions to link from content.
    await db.raw("insert into community.guideline_acks (profile_id, version) select $1, version from community.settings", [m1]).catch(() => undefined);
    const cat = (await db.raw<{ id: string }>("select id from community.categories order by sort_order limit 1"))[0].id;
    churchThread = (await db.raw<{ id: string }>(
      "insert into community.threads (category_id, author_id, title, body) values ($1, $2, 'Synthetic church thread', 'Body') returning id",
      [cat, m1],
    ))[0].id;
    groupThread = (await db.raw<{ id: string }>(
      "insert into community.threads (group_id, author_id, title, body) values ($1, $2, 'Synthetic group thread', 'Body') returning id",
      [group, m1],
    ))[0].id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(async () => {
    await db.raw("delete from community.rate_events where profile_id is not null");
  });

  describe("access and capabilities", () => {
    it("keeps the media schema closed and media functions to their roles", async () => {
      await expect(db.query(as(m1), "select * from media.items")).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select * from media.assets")).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select media.tick()")).rejects.toThrow(/permission denied/);
      await fails(anon, "media_admin_items", [null, null, null, 10, 0], /permission denied/);
      await fails(as(m1), "media_admin_items", [null, null, null, 10, 0], /permission/);
      await fails(as(pending), "media_bookmarks", [], /approved members/);
      await fails(as(suspended), "media_bookmarks", [], /approved members/);
    });

    it("scopes each new role and never grants finance, prayer, care, or messaging", async () => {
      const caps = async (id: string) =>
        (await db.query<{ c: string }>(as(id), "select c from public.my_capabilities() c")).map((r) => r.c).sort();
      expect(await caps(editor)).toEqual(["announcements.manage", "content.edit"]);
      expect(await caps(publisher)).toEqual(["content.edit", "content.publish"]);
      expect(await caps(mediaMgr)).toEqual(["media.manage"]);
      expect(await caps(podMgr)).toEqual(["podcasts.manage"]);
      expect(await caps(galleryMod)).toEqual(["gallery.moderate"]);
      for (const id of [editor, publisher, mediaMgr, podMgr, galleryMod]) {
        const c = await caps(id);
        expect(c.some((x) => /^(finance|prayer|care|members|community)\./.test(x))).toBe(false);
      }
    });
  });

  describe("publishing", () => {
    it("lets editors draft and preview but not publish or change live content", async () => {
      const id = (await save(as(editor), null, { kind: "lesson", title: "Synthetic lesson draft", delivered_on: "2026-10-18" })).id as string;
      expect((await rpc<Json>(as(editor), "media_admin_item", [id])).state).toBe("draft");
      await fails(as(editor), "media_admin_item_status", [id, "publish", null, null, null], /permission/);
      expect(await visible(as(m1), id)).toBe(false);
      await status(as(publisher), id, "publish");
      expect(await visible(as(m1), id)).toBe(true);
      await expect(save(as(editor), id, { title: "Changed by editor" })).rejects.toThrow(/Only publishers/);
      await save(as(publisher), id, { title: "Changed by publisher" });
      await fails(as(editor), "media_admin_item_save", [null, j({ kind: "lesson", title: "Featured", featured: true, delivered_on: "2026-10-18" }), null], /Only publishers can feature/);
    });

    it("requires a publisher and an explicit confirmation for public content, and only for teaching kinds", async () => {
      await expect(save(as(editor), null, { kind: "devotional", title: "Public draft", audience: "public", confirm_public: "public" })).rejects.toThrow(/Only publishers/);
      await expect(save(as(publisher), null, { kind: "devotional", title: "Public draft", audience: "public" })).rejects.toThrow(/Confirm/);
      await expect(save(as(publisher), null, { kind: "playlist", title: "Public list", audience: "public", confirm_public: "public", spotify_id: "37i9dQZF1DXcBWIGoYBM5M" })).rejects.toThrow(/members or a group/);
      const id = await devotional("Synthetic public devotional", { audience: "public", confirm: "public" });
      await expect(status(as(publisher), id, "publish")).rejects.toThrow(/Confirm/);
      await status(as(publisher), id, "publish", { confirm: "public" });
      expect(await visible(anon, id)).toBe(true);
      expect(await visible(as(pending), id)).toBe(true);
    });

    it("hides drafts, future schedules, expired, and archived content everywhere, with no job", async () => {
      const id = await devotional("Synthetic scheduled devotional");
      await status(as(publisher), id, "publish", { at: new Date(Date.now() + 3_600_000) });
      expect((await rpc<Json>(as(publisher), "media_admin_item", [id])).state).toBe("scheduled");
      expect(await visible(as(m1), id)).toBe(false);
      expect(await list(as(m1), "devotional")).not.toContain(id);
      await db.raw("update media.items set publish_at = now() - interval '1 minute' where id = $1", [id]);
      expect(await visible(as(m1), id)).toBe(true);
      await status(as(publisher), id, "expiry", { expires: new Date(Date.now() + 60_000) });
      await db.raw("update media.items set expires_at = now() - interval '1 second' where id = $1", [id]);
      expect(await visible(as(m1), id)).toBe(false);
      await status(as(publisher), id, "expiry", { expires: null });
      expect(await visible(as(m1), id)).toBe(true);
      await status(as(publisher), id, "archive");
      expect(await visible(as(m1), id)).toBe(false);
      expect((await rpc<Json[]>(as(m1), "media_search", ["Synthetic scheduled", 20])).length).toBe(0);
    });

    it("needs confirmed rights for church-hosted files before publishing", async () => {
      const asset = await readyAsset("audio", { rights: false });
      const id = (await save(as(publisher), null, { kind: "lesson", title: "Synthetic lesson with audio", delivered_on: "2026-10-11", attachments: [{ asset_id: asset.id, role: "audio" }] })).id as string;
      await expect(status(as(publisher), id, "publish")).rejects.toThrow(/Confirm the source and permission/);
      await rpc(as(mediaMgr), "media_admin_asset_update", [asset.id, j({ rights: "permission", confirm_rights: true, source: "Synthetic", attribution: "Used with permission" })]);
      await status(as(publisher), id, "publish");
      expect(await visible(as(m1), id)).toBe(true);
    });

    it("refuses public approval of a file without confirmed rights", async () => {
      const asset = await readyAsset("audio", { rights: false });
      await fails(as(mediaMgr), "media_admin_asset_update", [asset.id, j({ public_ok: true })], /Confirm the rights/);
      await fails(as(editor), "media_admin_asset_update", [asset.id, j({ title: "x" })], /permission/);
    });
  });

  describe("audiences and isolation", () => {
    let groupItem: string;
    beforeAll(async () => {
      groupItem = await devotional("Synthetic group devotional", { audience: "group", group, date: "2026-10-01" });
      await status(as(publisher), groupItem, "publish");
    });

    it("limits group content to current group members in lists, details, search, and facets", async () => {
      expect(await visible(as(m1), groupItem)).toBe(true);
      expect(await visible(as(m2), groupItem)).toBe(false);
      expect(await visible(anon, groupItem)).toBe(false);
      expect(await visible(as(admin), groupItem)).toBe(false); // super admins are not group members
      expect(await list(as(m2), "devotional")).not.toContain(groupItem);
      expect((await rpc<Json[]>(as(m2), "media_search", ["Synthetic group devotional", 20])).length).toBe(0);
      expect((await rpc<Json[]>(as(m1), "media_search", ["Synthetic group devotional", 20])).length).toBe(1);
    });

    it("never shows related links, bookmarks, or progress for content the reader can't see", async () => {
      const open = await devotional("Synthetic open devotional", { date: "2026-10-02" });
      await save(as(publisher), open, { links: [groupItem] });
      await status(as(publisher), open, "publish");
      expect(((await rpc<Json>(as(m1), "media_item", [open])).related as Json[]).map((r) => r.id)).toContain(groupItem);
      expect(((await rpc<Json>(as(m2), "media_item", [open])).related as Json[]).length).toBe(0);
      await fails(as(m2), "media_bookmark", ["item", groupItem, true], /Not found/);
      await rpc(as(m1), "media_bookmark", ["item", groupItem, true]);
      const bm = async () => ((await rpc<Json>(as(m1), "media_bookmarks")).items as Json[]).map((x) => x.id);
      expect(await bm()).toContain(groupItem);
      // Removal from the group hides it at once; restoring brings it back.
      await db.raw("update community.group_members set state = 'removed', ended_at = now() where group_id = $1 and profile_id = $2", [group, m1]);
      expect(await bm()).not.toContain(groupItem);
      expect(await visible(as(m1), groupItem)).toBe(false);
      await db.raw("update community.group_members set state = 'active', ended_at = null where group_id = $1 and profile_id = $2", [group, m1]);
      expect(await bm()).toContain(groupItem);
    });

    it("keeps a linked discussion no broader than the content", async () => {
      const id = await devotional("Synthetic discussion devotional", { audience: "group", group, date: "2026-10-03" });
      await expect(save(as(publisher), id, { discussion_thread_id: churchThread })).rejects.toThrow(/outside this content/);
      await save(as(publisher), id, { discussion_thread_id: groupThread });
      await status(as(publisher), id, "publish");
      expect(((await rpc<Json>(as(m1), "media_item", [id])).discussion as Json).thread_id).toBe(groupThread);
      // A members item may link a group discussion; only group members see the link.
      const open = await devotional("Synthetic members devotional", { date: "2026-10-04" });
      await save(as(publisher), open, { discussion_thread_id: groupThread });
      await status(as(publisher), open, "publish");
      expect((await rpc<Json>(as(m2), "media_item", [open])).discussion).toBeNull();
      expect((await rpc<Json>(as(m1), "media_item", [open])).discussion).not.toBeNull();
    });

    it("blocks suspended and pending accounts from member content", async () => {
      const id = await devotional("Synthetic members-only devotional", { date: "2026-10-05" });
      await status(as(publisher), id, "publish");
      expect(await visible(as(m1), id)).toBe(true);
      expect(await visible(as(pending), id)).toBe(false);
      expect(await visible(as(suspended), id)).toBe(false);
      expect(await visible(anon, id)).toBe(false);
    });
  });

  describe("files and storage", () => {
    it("admits uploads only to the registered path by the media manager who registered it", async () => {
      const begun = await rpc<Json>(as(mediaMgr), "media_admin_asset_begin", ["audio", "Synthetic", "a.mp3", "audio/mpeg", 1000, randomUUID(), null, null]);
      await expect(putObject(as(editor), "media", begun.upload_path as string)).rejects.toThrow(/row-level security/);
      await expect(putObject(as(mediaMgr), "media", `assets/${randomUUID()}/x.mp3`)).rejects.toThrow(/row-level security/);
      await expect(putObject(as(m1), "media-uploads", "photos/x/y/original.jpg")).rejects.toThrow(/row-level security/);
      await putObject(as(mediaMgr), "media", begun.upload_path as string);
      await fails(as(mediaMgr), "media_admin_asset_begin", ["video", "Too big", "v.mp4", "video/mp4", 60 * 1024 * 1024, randomUUID(), null, null], /too large/);
      await fails(as(mediaMgr), "media_admin_asset_begin", ["video", "Mov", "v.mov", "video/quicktime", 1000, randomUUID(), null, null], /isn't supported/);
      await fails(as(mediaMgr), "media_admin_asset_begin", ["document", "Svg", "x.svg", "image/svg+xml", 1000, randomUUID(), null, null], /isn't supported/);
    });

    it("refuses processing before the upload reaches storage, and an oversized stored file", async () => {
      const begun = await rpc<Json>(as(mediaMgr), "media_admin_asset_begin", ["audio", "Synthetic", "b.mp3", "audio/mpeg", 1000, randomUUID(), null, null]);
      await fails(as(mediaMgr), "media_admin_asset_processing", [begun.id], /hasn't reached storage/);
      await putObject(as(mediaMgr), "media", begun.upload_path as string, 80 * 1024 * 1024);
      await fails(as(mediaMgr), "media_admin_asset_processing", [begun.id], /larger than the limit/);
    });

    it("serves files only with their content: members, groups, public approval, members-only files, and revocation", async () => {
      const audio = await readyAsset("audio");
      const handout = await readyAsset("document", { publicOk: true });
      const cover = await readyAsset("image", { publicOk: true });
      const id = (await save(as(publisher), null, {
        kind: "lesson", title: "Synthetic public lesson", delivered_on: "2026-10-04", audience: "public", confirm_public: "public",
        cover_asset_id: cover.id,
        attachments: [{ asset_id: audio.id, role: "audio" }, { asset_id: handout.id, role: "handout" }],
      })).id as string;
      // Unpublished: only managers can read the files.
      expect(await canRead(as(m1), "media", audio.path)).toBe(false);
      expect(await canRead(as(editor), "media", audio.path)).toBe(true);
      await status(as(publisher), id, "publish", { confirm: "public" });
      // Audio is not approved for public use: members only.
      expect(await canRead(anon, "media", audio.path)).toBe(false);
      expect(await canRead(as(m1), "media", audio.path)).toBe(true);
      expect(await canRead(anon, "media", handout.path)).toBe(true);
      expect(await canRead(anon, "media", cover.path)).toBe(true);
      const anonView = await rpc<Json>(anon, "media_item", [id]);
      expect((anonView.attachments as Json[]).map((a) => a.asset_id)).toEqual([handout.id]);
      expect(((await rpc<Json>(as(m1), "media_item", [id])).attachments as Json[]).length).toBe(2);
      await fails(anon, "media_file", [audio.id], /Not found/);
      expect((await rpc<Json>(as(m1), "media_file", [audio.id])).path).toBe(audio.path);
      // Marking the handout members-only removes it from visitors at once.
      await save(as(publisher), id, { attachments: [{ asset_id: audio.id, role: "audio" }, { asset_id: handout.id, role: "handout", members_only: true }] });
      expect(await canRead(anon, "media", handout.path)).toBe(false);
      // Narrowing to a group revokes everything for outsiders immediately.
      await save(as(publisher), id, { audience: "group", group_id: group });
      expect(await canRead(as(m2), "media", audio.path)).toBe(false);
      expect(await canRead(as(m1), "media", audio.path)).toBe(true);
      expect(await canRead(anon, "media", cover.path)).toBe(false);
      await status(as(publisher), id, "unpublish");
      expect(await canRead(as(m1), "media", audio.path)).toBe(false);
    });

    it("refuses to remove a file in use, and replaces it everywhere at once", async () => {
      const oldA = await readyAsset("audio");
      const newA = await readyAsset("audio");
      const id = (await save(as(publisher), null, { kind: "lesson", title: "Synthetic replace lesson", delivered_on: "2026-09-27", attachments: [{ asset_id: oldA.id, role: "audio" }] })).id as string;
      const asset = await rpc<Json>(as(mediaMgr), "media_admin_asset", [oldA.id]);
      expect((asset.usage as Json[]).map((u) => u.id)).toEqual([id]);
      await fails(as(mediaMgr), "media_admin_asset_remove", [oldA.id], /still used/);
      const r = await rpc<Json>(as(mediaMgr), "media_admin_asset_replace", [oldA.id, newA.id, true]);
      expect(r.paths).toContain(oldA.path);
      const item = await rpc<Json>(as(publisher), "media_admin_item", [id]);
      expect((item.attachments as Json[]).map((a) => a.asset_id)).toEqual([newA.id]);
      const removed = await rpc<Json>(as(mediaMgr), "media_admin_asset", [oldA.id]);
      expect(removed.status).toBe("removed");
      expect(removed.replaced_by).toBe(newA.id);
    });

    it("lists cleanup candidates without deleting anything on its own", async () => {
      const begun = await rpc<Json>(as(mediaMgr), "media_admin_asset_begin", ["audio", "Abandoned", "c.mp3", "audio/mpeg", 1000, randomUUID(), null, null]);
      await db.raw("update media.assets set updated_at = now() - interval '3 days' where id = $1", [begun.id]);
      const c = await rpc<Json>(as(mediaMgr), "media_admin_cleanup_candidates");
      expect((c.abandoned as Json[]).map((x) => x.id)).toContain(begun.id);
      await fails(as(editor), "media_admin_cleanup_candidates", [], /permission/);
      expect((await db.raw("select status from media.assets where id = $1", [begun.id]))[0].status).toBe("uploading");
      await rpc(as(mediaMgr), "media_admin_objects_deleted", [[begun.id], []]);
      expect((await db.raw("select status from media.assets where id = $1", [begun.id]))[0].status).toBe("removed");
    });
  });

  describe("member features", () => {
    it("shows today's devotional in the church time zone and handles a day with none", async () => {
      const today = (await db.raw<{ d: string }>("select media.church_today()::text d"))[0].d;
      const none = await rpc<Json>(as(m2), "media_devotional_day", ["2020-01-01"]);
      expect(none).toMatchObject({ date: "2020-01-01", item: null, today });
      // A future date is never shown early.
      expect((await rpc<Json>(as(m2), "media_devotional_day", ["2999-01-01"])).date).toBe(today);
      const id = await devotional("Synthetic today devotional", { date: today });
      await db.raw("update media.items set sort_order = 0 where id = $1", [id]);
      expect(((await rpc<Json>(as(m2), "media_devotional_day", [null])).item as Json | null)?.id).not.toBe(id);
      await status(as(publisher), id, "publish");
      expect(((await rpc<Json>(as(m2), "media_devotional_day", [null])).item as Json).id).toBe(id);
      expect(((await rpc<Json>(as(m2), "media_home")).devotional as Json).id).toBe(id);
    });

    it("keeps progress private to the member and only for playable media", async () => {
      const audio = await readyAsset("audio");
      const id = (await save(as(publisher), null, { kind: "lesson", title: "Synthetic progress lesson", delivered_on: "2026-09-20", attachments: [{ asset_id: audio.id, role: "audio" }] })).id as string;
      await fails(as(m1), "media_progress_save", [`a:${audio.id}`, id, 30, 600, false], /Not found/);
      await status(as(publisher), id, "publish");
      await rpc(as(m1), "media_progress_save", [`a:${audio.id}`, id, 42, 600, false]);
      expect(((await rpc<Json>(as(m1), "media_progress", [[`a:${audio.id}`]]))[`a:${audio.id}`] as Json).position).toBe(42);
      expect(await rpc<Json>(as(m2), "media_progress", [[`a:${audio.id}`]])).toEqual({});
      expect(((await rpc<Json[]>(as(m1), "media_continue"))).map((c) => c.id)).toContain(id);
      await status(as(publisher), id, "unpublish");
      expect(await rpc<Json>(as(m1), "media_progress", [[`a:${audio.id}`]])).toEqual({});
    });

    it("tracks reading assignments and book visibility", async () => {
      const book = (await save(as(publisher), null, { kind: "book", title: "Synthetic Book", book_author: "A. Writer", audible_url: "https://www.audible.com/pd/Synthetic-Audiobook/B000000000", book_current: true })).id as string;
      await expect(save(as(publisher), null, { kind: "book", title: "Bad link", audible_url: "https://evil.example/audible" })).rejects.toThrow();
      const today = (await db.raw<{ d: string }>("select media.church_today()::text d"))[0].d;
      const assignment = (await save(as(publisher), null, { kind: "assignment", title: "Synthetic week 1", book_id: book, starts_on: today, instructions: "Chapters 1–2", questions: ["What stood out?"] })).id as string;
      await status(as(publisher), book, "publish");
      await status(as(publisher), assignment, "publish");
      const reading = await rpc<Json>(as(m2), "media_reading");
      expect((reading.current_books as Json[]).map((b) => b.id)).toContain(book);
      expect((reading.current_assignments as Json[]).map((a) => a.id)).toContain(assignment);
      await rpc(as(m2), "media_assignment_complete", [assignment, true]);
      expect((await rpc<Json>(as(m2), "media_item", [assignment])).completed).toBe(true);
      expect((await rpc<Json>(as(m1), "media_item", [assignment])).completed).toBe(false);
      await fails(anon, "media_reading", [], /permission denied/);
    });

    it("validates playlists by their Spotify identifier", async () => {
      await expect(save(as(publisher), null, { kind: "playlist", title: "Bad", spotify_id: "not-an-id" })).rejects.toThrow();
      const id = (await save(as(publisher), null, { kind: "playlist", title: "Synthetic worship", spotify_id: "37i9dQZF1DXcBWIGoYBM5M" })).id as string;
      await status(as(publisher), id, "publish");
      expect((await rpc<Json>(as(m1), "media_item", [id])).spotify_id).toBe("37i9dQZF1DXcBWIGoYBM5M");
      expect(await visible(anon, id)).toBe(false);
    });
  });

  describe("podcasts", () => {
    const episode = (guid: string, title: string, audio: string, extra: Json = {}) => ({
      guid, title, description: "Synthetic", link: "https://example.test/ep", published_at: "2026-10-01T12:00:00Z",
      duration_seconds: 1800, audio_url: audio, audio_type: "audio/mpeg", audio_length: 1234, ...extra,
    });

    it("imports external feeds with stable identities, changed URLs, removed episodes, and failures", async () => {
      await fails(as(publisher), "media_admin_show_save", [null, j({ kind: "external", title: "x", feed_url: "https://example.test/feed.xml" })], /permission/);
      const show = await rpc<string>(as(podMgr), "media_admin_show_save", [null, j({ kind: "external", title: "Synthetic Show", feed_url: "https://example.test/feed.xml" })]);
      await rpc(as(podMgr), "media_admin_show_status", [show, "publish"]);
      const claimed = await mediaJob()<Json[]>("feeds_claim", { limit: 5 });
      expect(claimed.map((c) => c.id)).toContain(show);
      // A second claim while leased returns nothing for this show.
      expect((await mediaJob()<Json[]>("feeds_claim", { limit: 5 })).map((c) => c.id)).not.toContain(show);
      const r1 = await mediaJob()<Json>("feed_result", {
        show_id: show,
        result: { ok: true, feed: { description: "Feed description", artwork_url: "https://example.test/a.jpg" }, episodes: [
          episode("g1", "Episode one", "https://cdn.example.test/1.mp3"),
          episode("g2", "Episode two", "https://cdn.example.test/2.mp3"),
          episode("g2", "Duplicate in the same feed", "https://cdn.example.test/2b.mp3"),
          episode("g3", "Insecure audio", "http://cdn.example.test/3.mp3", { link: "javascript:alert(1)" }),
        ] },
      });
      expect(r1).toMatchObject({ ok: true, added: 3, updated: 0 });
      const rows = await db.raw<Json>("select guid, audio_url, link from media.external_episodes where show_id = $1 order by guid", [show]);
      expect(rows.find((r) => r.guid === "g3")).toMatchObject({ audio_url: null, link: null });
      // Same guid, new URL: same row, updated; g1 missing → hidden.
      const before = (await db.raw<{ id: string }>("select id from media.external_episodes where show_id = $1 and guid = 'g2'", [show]))[0].id;
      await db.raw("update media.shows set lease_until = null, refresh_due_at = now() where id = $1", [show]);
      await mediaJob()("feeds_claim", { limit: 5 });
      const r2 = await mediaJob()<Json>("feed_result", { show_id: show, result: { ok: true, episodes: [episode("g2", "Episode two", "https://cdn2.example.test/2.mp3"), episode("g3", "Insecure audio", "http://x")] } });
      expect(r2).toMatchObject({ added: 0, updated: 2, missing: 1 });
      const after = await db.raw<Json>("select id, audio_url from media.external_episodes where show_id = $1 and guid = 'g2'", [show]);
      expect(after[0]).toMatchObject({ id: before, audio_url: "https://cdn2.example.test/2.mp3" });
      // Members: no audio URL until streaming is confirmed; missing episodes hidden.
      const detail = await rpc<Json>(as(m1), "media_show", [show, null, 20, 0]);
      expect((detail.episodes as Json[]).map((e) => e.title)).toEqual(["Episode two", "Insecure audio"]);
      expect((detail.episodes as Json[])[0].audio_url).toBeNull();
      await rpc(as(podMgr), "media_admin_show_save", [show, j({ allow_stream: true })]);
      expect(((await rpc<Json>(as(m1), "media_show", [show, null, 20, 0])).episodes as Json[])[0].audio_url).toBe("https://cdn2.example.test/2.mp3");
      expect(await visible(anon, show)).toBe(false);
      await fails(anon, "media_show", [show, null, 20, 0], /Not found/);
      // Failure: backoff and the error recorded; nothing imported.
      await db.raw("update media.shows set lease_until = null, refresh_due_at = now() where id = $1", [show]);
      await mediaJob()<Json>("feed_result", { show_id: show, result: { ok: false, error: "Timed out" } });
      const s = (await db.raw<Json>("select consecutive_failures, fetch_error, refresh_due_at > now() + interval '20 minutes' as later from media.shows where id = $1", [show]))[0];
      expect(s).toMatchObject({ consecutive_failures: 1, fetch_error: "Timed out", later: true });
      // An empty feed never marks everything removed.
      await mediaJob()<Json>("feed_result", { show_id: show, result: { ok: true, episodes: [] } });
      expect((await db.raw("select count(*)::int n from media.external_episodes where show_id = $1 and missing_since is null", [show]))[0].n).toBe(2);
    });

    it("refuses unsigned, stale, and cross-job signatures", async () => {
      const ts = Math.floor(Date.now() / 1000);
      const call = (op: string, payload: string, t: number, sig: string) =>
        db.query(anon, "select public.media_job($1, $2, $3, $4)", [op, payload, t, sig]);
      await expect(call("feeds_claim", "{}", ts, "00".repeat(32))).rejects.toThrow(/Invalid signature/);
      await expect(call("feeds_claim", "{}", ts - 1000, signMediaJob(SECRET, "feeds_claim", ts - 1000, "{}"))).rejects.toThrow(/expired/);
      // A community signature for the same op and payload is not a media signature.
      const { signCommunityJob } = await import("@/lib/community/jobs");
      await expect(call("feeds_claim", "{}", ts, signCommunityJob(SECRET, "feeds_claim", ts, "{}"))).rejects.toThrow(/Invalid signature/);
    });

    it("publishes only public, live, rights-confirmed, publicly approved episodes in the public feed", async () => {
      const show = await rpc<string>(as(podMgr), "media_admin_show_save", [null, j({ kind: "church", title: "Synthetic Church Podcast", audience: "public", confirm_public: "public" })]);
      await rpc(as(podMgr), "media_admin_show_status", [show, "publish"]);
      expect(await rpc(anon, "media_public_feed")).toBeNull();
      await rpc(as(podMgr), "media_admin_show_save", [show, j({ public_feed: true, feed_owner_email: "podcast@example.test" })]);
      const ok = await readyAsset("audio", { publicOk: true });
      const notOk = await readyAsset("audio");
      const mk = async (title: string, audio: string, opts: Json = {}) => {
        const id = (await save(as(publisher), null, { kind: "episode", title, show_id: show, attachments: [{ asset_id: audio, role: "audio" }], ...opts })).id as string;
        return id;
      };
      const pub = await mk("Synthetic public episode", ok.id, { audience: "public", confirm_public: "public" });
      await status(as(publisher), pub, "publish", { confirm: "public" });
      const memberEp = await mk("Synthetic member episode", ok.id);
      await status(as(publisher), memberEp, "publish");
      const restrictedAudio = await mk("Synthetic restricted-audio episode", notOk.id, { audience: "public", confirm_public: "public" });
      await status(as(publisher), restrictedAudio, "publish", { confirm: "public" });
      const draft = await mk("Synthetic draft episode", ok.id, { audience: "public", confirm_public: "public" });
      const groupEp = await mk("Synthetic group episode", ok.id, { audience: "group", group_id: group });
      await status(as(publisher), groupEp, "publish");
      const feed = await rpc<Json>(anon, "media_public_feed");
      const ids = (feed.episodes as Json[]).map((e) => e.id);
      expect(ids).toEqual([pub]);
      for (const hidden of [memberEp, restrictedAudio, draft, groupEp]) {
        await fails(anon, "media_public_episode_audio", [hidden], /Not found/);
      }
      expect((await rpc<Json>(anon, "media_public_episode_audio", [pub])).path).toBe(ok.path);
      // Turning the show to members only closes the feed.
      await expect(rpc(as(podMgr), "media_admin_show_save", [show, j({ audience: "members" })])).rejects.toThrow(/public church show/);
      await rpc(as(podMgr), "media_admin_show_status", [show, "unpublish"]);
      expect(await rpc(anon, "media_public_feed")).toBeNull();
      await fails(anon, "media_public_episode_audio", [pub], /Not found/);
    });

    it("lists playable episodes newest first on the landing page with the same access rules", async () => {
      const show = await rpc<string>(as(podMgr), "media_admin_show_save", [null, j({ kind: "church", title: "Synthetic Landing Podcast", audience: "public", confirm_public: "public" })]);
      await rpc(as(podMgr), "media_admin_show_status", [show, "publish"]);
      const ok = await readyAsset("audio", { publicOk: true });
      const membersOnly = await readyAsset("audio");
      const mk = async (title: string, audio: string, opts: Json = {}) =>
        (await save(as(publisher), null, { kind: "episode", title, show_id: show, attachments: [{ asset_id: audio, role: "audio" }], ...opts })).id as string;
      const pub = await mk("Synthetic landing public", ok.id, { audience: "public", confirm_public: "public" });
      await status(as(publisher), pub, "publish", { confirm: "public" });
      const restricted = await mk("Synthetic landing members-only file", membersOnly.id, { audience: "public", confirm_public: "public" });
      await status(as(publisher), restricted, "publish", { confirm: "public" });
      const memberEp = await mk("Synthetic landing members", ok.id);
      await status(as(publisher), memberEp, "publish");
      const groupEp = await mk("Synthetic landing group", ok.id, { audience: "group", group_id: group });
      await status(as(publisher), groupEp, "publish");
      const draft = await mk("Synthetic landing draft", ok.id);
      const later = await mk("Synthetic landing scheduled", ok.id);
      await status(as(publisher), later, "publish", { at: new Date(Date.now() + 86_400_000) });
      // Fixed dates; two share one instant, so the id decides their order.
      const at: Array<[string, string]> = [[pub, "2026-09-04T12:00:00Z"], [restricted, "2026-09-03T12:00:00Z"], [memberEp, "2026-09-02T12:00:00Z"], [groupEp, "2026-09-02T12:00:00Z"]];
      for (const [id, when] of at) await db.raw("update media.items set publish_at = $2 where id = $1", [id, when]);
      const tied = [memberEp, groupEp].sort().reverse();

      const landing = async (actor: Actor, limit = 100, offset = 0) => rpc<{ episodes: Json[]; total: number }>(actor, "media_podcast_episodes", [limit, offset]);
      const mine = (r: { episodes: Json[] }) => r.episodes.filter((e) => (e.show as Json | null)?.id === show);

      // Visitors: public episodes only; a file not approved for public use isn't offered.
      const visitor = mine(await landing(anon));
      expect(visitor.map((e) => e.id)).toEqual([pub, restricted]);
      expect((visitor[0].play as Json).asset_id).toBe(ok.id);
      expect(visitor[1].play).toBeNull();
      // Group members see the group episode; others don't; never drafts or scheduled.
      expect(mine(await landing(as(m1))).map((e) => e.id)).toEqual([pub, restricted, ...tied]);
      expect(mine(await landing(as(m2))).map((e) => e.id)).toEqual([pub, restricted, memberEp]);
      expect(((mine(await landing(as(m1)))[1].play) as Json).asset_id).toBe(membersOnly.id);
      for (const actor of [anon, as(m1), as(pending), as(suspended)]) {
        const ids = (await landing(actor)).episodes.map((e) => e.id);
        expect(ids).not.toContain(draft);
        expect(ids).not.toContain(later);
      }
      expect(mine(await landing(as(pending))).map((e) => e.id)).toEqual([pub, restricted]);

      // Pages are stable: consecutive pages add up to the full list.
      const all = await landing(as(m1));
      expect(all.total).toBe(all.episodes.length);
      const paged: unknown[] = [];
      for (let o = 0; o < all.total; o += 2) paged.push(...(await landing(as(m1), 2, o)).episodes.map((e) => e.id));
      expect(paged).toEqual(all.episodes.map((e) => e.id));

      // The member's own position comes back for resuming; nobody else's.
      await rpc(as(m1), "media_progress_save", [`a:${ok.id}`, pub, 42, 600, false]);
      expect((mine(await landing(as(m1)))[0].progress as Json).position).toBe(42);
      expect(mine(await landing(as(m2)))[0].progress).toBeNull();

      // Unpublishing the show removes its episodes everywhere.
      await rpc(as(podMgr), "media_admin_show_status", [show, "unpublish"]);
      expect(mine(await landing(as(m1)))).toEqual([]);
    });
  });

  describe("galleries", () => {
    let album: string;
    const begin = (actor: Actor, opts: { album?: string; key?: string; batch?: string | null; mime?: string; size?: number; permission?: boolean } = {}) =>
      rpc<Json>(actor, "media_photo_begin", [opts.album ?? album, opts.key ?? randomUUID(), opts.batch ?? null, "IMG_0001.HEIC", opts.mime ?? "image/heic", opts.size ?? 2_000_000, opts.permission ?? true]);
    /** Upload → processing → pending, as the member's server action would. */
    const submit = async (actor: Actor & { userId: string }, hash = randomUUID().replace(/-/g, "").padEnd(64, "0")) => {
      const b = await begin(actor);
      await putObject(actor, "media-uploads", b.path as string, 2_000_000, "image/heic");
      await rpc(actor, "media_photo_processing", [b.id]);
      const display = `photos/${actor.userId}/${b.id}/review-display.webp`;
      const thumb = `photos/${actor.userId}/${b.id}/review-thumb.webp`;
      await putObject(actor, "media-uploads", display, 300_000, "image/webp");
      await putObject(actor, "media-uploads", thumb, 30_000, "image/webp");
      await rpc(actor, "media_photo_ready", [b.id, display, thumb, 2048, 1536, 300_000, hash, "Synthetic caption", "Synthetic alt"]);
      return { id: b.id as string, display, thumb };
    };
    const approve = async (photo: string, minors = "none") => {
      const display = `gallery/${album}/${photo}/a-display.webp`;
      const thumb = `gallery/${album}/${photo}/a-thumb.webp`;
      await putObject(as(galleryMod), "media", display, 300_000, "image/webp");
      await putObject(as(galleryMod), "media", thumb, 30_000, "image/webp");
      return rpc<Json>(as(galleryMod), "media_admin_photo_review", [photo, "approve", null, minors, display, thumb]);
    };

    beforeAll(async () => {
      await expect(rpc(as(m1), "media_admin_album_save", [null, j({ title: "x" })])).rejects.toThrow(/permission/);
      await expect(rpc(as(galleryMod), "media_admin_album_save", [null, j({ title: "Public?", audience: "public" })])).rejects.toThrow(/never publicly/);
      album = await rpc<string>(as(coordinator), "media_admin_album_save", [null, j({ title: "Synthetic Group Retreat", audience: "group", group_id: group, uploads_open: true })]);
      await fails(as(coordinator), "media_admin_album_status", [album, "publish"], /permission/);
    });

    it("keeps draft albums hidden and limits group albums to the group", async () => {
      await fails(as(m1), "media_album", [album], /Not found/);
      await rpc(as(galleryMod), "media_admin_album_status", [album, "publish"]);
      expect((await rpc<Json>(as(m1), "media_album", [album])).can_upload).toBe(true);
      await fails(as(m2), "media_album", [album], /Not found/);
      await fails(anon, "media_albums", [], /permission denied/);
    });

    it("rechecks eligibility, permission, limits, and retries when accepting uploads", async () => {
      await expect(begin(as(m2))).rejects.toThrow(/Not found/);
      await expect(begin(as(m1), { permission: false })).rejects.toThrow(/permission to share/);
      await expect(begin(as(m1), { mime: "image/gif" })).rejects.toThrow(/JPEG, PNG, WebP, or HEIC/);
      await expect(begin(as(m1), { size: 200 * 1024 * 1024 })).rejects.toThrow(/MB or smaller/);
      const key = randomUUID();
      const first = await begin(as(m1), { key });
      const retry = await begin(as(m1), { key });
      expect(retry.id).toBe(first.id);
      await db.raw("update media.settings set gallery_batch_max = 2 where id");
      const batch = randomUUID();
      await begin(as(m1), { batch });
      await begin(as(m1), { batch });
      await expect(begin(as(m1), { batch })).rejects.toThrow(/up to 2 photos at a time/);
      await db.raw("update media.settings set gallery_batch_max = 20 where id");
      // Only the uploader writes the original, and only to its path.
      await expect(putObject(as(m2), "media-uploads", first.path as string)).rejects.toThrow(/row-level security/);
      await fails(as(m1), "media_photo_processing", [first.id], /hasn't finished uploading/);
    });

    it("keeps pending photos private to the uploader and moderators, and requires the minors review to approve", async () => {
      const p = await submit(as(m1) as Actor & { userId: string });
      expect(await canRead(as(m1), "media-uploads", p.display)).toBe(true);
      expect(await canRead(as(galleryMod), "media-uploads", p.display)).toBe(true);
      expect(await canRead(as(m2), "media-uploads", p.display)).toBe(false);
      expect(await canRead(as(mediaMgr), "media-uploads", p.display)).toBe(false);
      expect(await canRead(as(publisher), "media-uploads", p.display)).toBe(false);
      expect(((await rpc<Json>(as(m1), "media_album", [album])).photos as Json[]).length).toBe(0);
      await fails(as(galleryMod), "media_admin_photo_review", [p.id, "approve", null, "unreviewed", null, null], /under 18/);
      await fails(as(coordinator), "media_admin_photo_review", [p.id, "approve", null, "none", null, null], /permission/);
      const r = await approve(p.id);
      expect(r.uploads).toEqual(expect.arrayContaining([p.display, p.thumb]));
      const photos = (await rpc<Json>(as(m1), "media_album", [album])).photos as Json[];
      expect(photos.map((x) => x.id)).toEqual([p.id]);
      expect(await canRead(as(m1), "media", photos[0].display_path as string)).toBe(true);
      expect(await canRead(as(m2), "media", photos[0].display_path as string)).toBe(false);
    });

    it("stops hidden, rejected, and removed photos from being served, and lets uploaders remove their own", async () => {
      // A second member of the group views; the uploader is m1.
      await db.raw("insert into community.group_members (group_id, profile_id) values ($1, $2) on conflict do nothing", [group, galleryMod]);
      const p = await submit(as(m1) as Actor & { userId: string });
      await approve(p.id);
      const display = `gallery/${album}/${p.id}/a-display.webp`;
      expect(await canRead(as(galleryMod), "media", display)).toBe(true);
      await rpc(as(galleryMod), "media_admin_photo_review", [p.id, "hide", "Synthetic reason", null, null, null]);
      // Ordinary viewers (here a second group member without moderation rights) lose it; the uploader keeps it.
      const viewer = await db.createAuthUser("m.viewer@example.test", { fullName: "Viewer" });
      await db.setStatus(viewer, "approved");
      await db.raw("insert into community.group_members (group_id, profile_id) values ($1, $2)", [group, viewer]);
      expect(await canRead(as(viewer), "media", display)).toBe(false);
      expect(await canRead(as(m1), "media", display)).toBe(true);
      await rpc(as(galleryMod), "media_admin_photo_review", [p.id, "unhide", null, null, null, null]);
      expect(await canRead(as(viewer), "media", display)).toBe(true);
      const removed = await rpc<Json>(as(m1), "media_photo_remove", [p.id]);
      expect(removed.media).toEqual(expect.arrayContaining([display]));
      expect(await canRead(as(viewer), "media", display)).toBe(false);
      // Reject: the reason is shown to the uploader only.
      const q = await submit(as(m1) as Actor & { userId: string });
      await rpc(as(galleryMod), "media_admin_photo_review", [q.id, "reject", "Synthetic: out of focus", null, null, null]);
      const mine = (await rpc<Json>(as(m1), "media_album", [album])).my_pending as Json[];
      expect(mine.find((x) => x.id === q.id)).toMatchObject({ status: "rejected", review_reason: "Synthetic: out of focus" });
      expect(await canRead(as(m1), "media-uploads", q.display)).toBe(true); // until the moderator's action deletes it
    });

    it("refuses duplicates in an album and publishing for an uploader who left the group", async () => {
      const hash = "a".repeat(64);
      await submit(as(m1) as Actor & { userId: string }, hash);
      await expect(submit(as(m1) as Actor & { userId: string }, hash)).rejects.toThrow(/already in the album/);
      const p = await submit(as(m1) as Actor & { userId: string });
      await db.raw("update community.group_members set state = 'left', ended_at = now() where group_id = $1 and profile_id = $2", [group, m1]);
      await expect(approve(p.id)).rejects.toThrow(/can no longer access this album/);
      await db.raw("update community.group_members set state = 'active', ended_at = null where group_id = $1 and profile_id = $2", [group, m1]);
    });

    it("takes reports and removal requests from people who can see the photo", async () => {
      const p = await submit(as(m1) as Actor & { userId: string });
      await approve(p.id);
      await fails(as(m2), "media_photo_report", [p.id, "removal_request", "I'm in this photo"], /Not found/);
      await rpc(as(galleryMod), "media_photo_report", [p.id, "removal_request", "Synthetic: I'm in this photo"]);
      const reports = await rpc<Json[]>(as(galleryMod), "media_admin_photo_reports", ["open"]);
      expect(reports.map((r) => (r.photo as Json).id)).toContain(p.id);
      await fails(as(publisher), "media_admin_photo_reports", ["open"], /permission/);
    });
  });

  describe("notifications", () => {
    it("announces new content once, only to people who can see it, honouring mutes, with generic email", async () => {
      await rpc(as(m2), "media_prefs_save", [["lesson"]]);
      const members = await devotional("Synthetic notify devotional", { notify: true, date: "2026-09-01" });
      const groupOnly = await devotional("Synthetic notify group devotional", { notify: true, audience: "group", group, date: "2026-09-02" });
      const muted = (await save(as(publisher), null, { kind: "lesson", title: "Synthetic notify lesson", delivered_on: "2026-09-01", notify: true })).id as string;
      for (const id of [members, groupOnly, muted]) await status(as(publisher), id, "publish");
      await communityJob()("tick", {});
      await communityJob()("tick", {}); // a retry never duplicates
      const n1 = (await notifs(m1)).filter((n) => n.kind === "content_new");
      const n2 = (await notifs(m2)).filter((n) => n.kind === "content_new");
      expect(n1.filter((n) => String(n.title).includes("Synthetic notify devotional")).length).toBe(1);
      expect(n1.some((n) => String(n.title).includes("Synthetic notify group devotional"))).toBe(true);
      expect(n2.some((n) => String(n.title).includes("Synthetic notify group devotional"))).toBe(false);
      expect(n1.some((n) => String(n.title).includes("Synthetic notify lesson"))).toBe(true);
      expect(n2.some((n) => String(n.title).includes("Synthetic notify lesson"))).toBe(false);
      expect(n1.find((n) => String(n.title).includes("Synthetic notify devotional"))?.url).toBe(`/devotionals/${members}`);
      // Unpublishing hides the notice; outside the app the wording is generic.
      const row = (await db.raw<Json>("select n.* from community.notifications n where n.profile_id = $1 and n.media_item_id = $2", [m1, members]))[0];
      const email = (await db.raw<{ e: Json }>("select community.notification_email_item(n) e from community.notifications n where n.id = $1", [row.id]))[0].e;
      expect(email.title).toBe("A new devotional is available");
      expect(JSON.stringify(email)).not.toContain("Synthetic");
      await status(as(publisher), members, "unpublish");
      expect((await notifs(m1)).some((n) => String(n.title).includes("Synthetic notify devotional"))).toBe(false);
    });

    it("batches new gallery photos per album and tells uploaders the outcome", async () => {
      const album = await rpc<string>(as(galleryMod), "media_admin_album_save", [null, j({ title: "Synthetic Picnic", uploads_open: true })]);
      await rpc(as(galleryMod), "media_admin_album_status", [album, "publish"]);
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const b = await rpc<Json>(as(m2), "media_photo_begin", [album, randomUUID(), null, "x.jpg", "image/jpeg", 1000, true]);
        await putObject(as(m2), "media-uploads", b.path as string, 1000, "image/jpeg");
        await rpc(as(m2), "media_photo_processing", [b.id]);
        const d = `photos/${m2}/${b.id}/review-d.webp`;
        const t = `photos/${m2}/${b.id}/review-t.webp`;
        await putObject(as(m2), "media-uploads", d, 100, "image/webp");
        await putObject(as(m2), "media-uploads", t, 100, "image/webp");
        await rpc(as(m2), "media_photo_ready", [b.id, d, t, 10, 10, 100, null, "", ""]);
        const pd = `gallery/${album}/${b.id}/p-d.webp`;
        const pt = `gallery/${album}/${b.id}/p-t.webp`;
        await putObject(as(galleryMod), "media", pd, 100, "image/webp");
        await putObject(as(galleryMod), "media", pt, 100, "image/webp");
        await rpc(as(galleryMod), "media_admin_photo_review", [b.id, "approve", null, "none", pd, pt]);
        ids.push(b.id as string);
      }
      const outcome = (await notifs(m2)).filter((n) => n.kind === "gallery_outcome");
      expect(outcome.length).toBe(1);
      expect(outcome[0].count).toBe(3);
      await communityJob()("tick", {});
      expect((await notifs(m1)).some((n) => n.kind === "gallery_new")).toBe(false); // approvals still settling
      await db.raw("update media.photos set approved_at = now() - interval '20 minutes' where album_id = $1", [album]);
      await communityJob()("tick", {});
      await communityJob()("tick", {});
      expect((await notifs(m1)).filter((n) => n.kind === "gallery_new").length).toBe(1);
      const email = (await db.raw<{ e: Json }>(
        "select community.notification_email_item(n) e from community.notifications n where n.profile_id = $1 and n.kind = 'gallery_new'",
        [m1],
      ))[0].e;
      expect(JSON.stringify(email)).not.toContain("Picnic");
    });
  });

  it("logs no content in the audit log", async () => {
    const rows = await db.raw<{ details: unknown }>("select details from public.audit_log where action like 'media.%'");
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) expect(JSON.stringify(r.details)).not.toMatch(/Synthetic (body|caption)/);
  });
});
