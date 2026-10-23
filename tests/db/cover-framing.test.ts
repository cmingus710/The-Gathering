import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
type Json = Record<string, unknown>;

/**
 * Cover framing per use (20261109000100): one library image used as the
 * cover of two lessons and a series keeps a separate position in each, the
 * image itself is untouched, a different cover starts centred again, and
 * only the people who may save the item may position its cover. Every
 * person and file here is synthetic.
 */
describeDb("cover framing per use", () => {
  let db: TestDb;
  let editor: string;
  let publisher: string;
  let mediaMgr: string;
  let member: string;

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const j = (v: unknown) => JSON.stringify(v);
  const putObject = (actor: Actor, name: string, size: number, mimetype: string) =>
    db.query(actor, "insert into storage.objects (bucket_id, name, owner, metadata) values ('media', $1, $2, $3)", [
      name,
      actor.role === "authenticated" ? actor.userId : null,
      j({ size, mimetype }),
    ]);
  const image = async () => {
    const begun = await rpc<Json>(as(mediaMgr), "media_admin_asset_begin", ["image", "Synthetic image", "synthetic.jpg", "image/jpeg", 1000, randomUUID(), null, null]);
    const id = begun.id as string;
    await putObject(as(mediaMgr), begun.upload_path as string, 1000, "image/jpeg");
    await rpc(as(mediaMgr), "media_admin_asset_processing", [id]);
    const path = `assets/${id}/processed.webp`;
    await putObject(as(mediaMgr), path, 500, "image/webp");
    await rpc(as(mediaMgr), "media_admin_asset_complete", [id, path, null, "image/webp", 1600, 900, null, "browser"]);
    await rpc(as(mediaMgr), "media_admin_asset_update", [id, j({ rights: "church_owned", confirm_rights: true, public_ok: false })]);
    return id;
  };
  const lesson = async (actor: Actor, cover: string) =>
    (await rpc<Json>(actor, "media_admin_item_save", [null, j({ kind: "lesson", title: "Synthetic lesson", body: "b", audience: "members", cover_asset_id: cover }), null])).id as string;
  const frame = (actor: Actor, item: string | null, series: string | null, cover: string | null, framing: unknown) =>
    rpc<boolean>(actor, "media_admin_cover_framing_save", [item, series, cover, framing === null ? null : j(framing)]);
  const itemCover = async (actor: Actor, id: string) => ((await rpc<Json>(actor, "media_admin_item", [id])).cover as Json | null)?.framing ?? null;

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string) => {
      const id = await db.createAuthUser(email, { fullName: name });
      await db.setStatus(id, "approved");
      return id;
    };
    editor = await mk("f.editor@example.test", "Synthetic Editor");
    publisher = await mk("f.publisher@example.test", "Synthetic Publisher");
    mediaMgr = await mk("f.media@example.test", "Synthetic Media");
    member = await mk("f.member@example.test", "Synthetic Member");
    await db.grantRole(editor, "content_editor");
    await db.grantRole(publisher, "content_publisher");
    await db.grantRole(mediaMgr, "media_manager");
  });
  afterAll(async () => db?.destroy());

  it("keeps a separate position for each item and series using the same image", async () => {
    const img = await image();
    const a = await lesson(as(editor), img);
    const b = await lesson(as(editor), img);
    const series = await rpc<string>(as(editor), "media_admin_series_save", [null, "lesson", "Synthetic series", "", img, false]);

    expect(await frame(as(editor), a, null, img, { x: 20, y: 70, zoom: 1.5 })).toBe(true);
    expect(await frame(as(editor), b, null, img, { x: 90, y: 10, zoom: 2 })).toBe(true);
    expect(await frame(as(editor), null, series, img, { x: 33.33, y: 50, zoom: 1 })).toBe(true);

    expect(await itemCover(as(editor), a)).toEqual({ x: 20, y: 70, zoom: 1.5 });
    expect(await itemCover(as(editor), b)).toEqual({ x: 90, y: 10, zoom: 2 });
    const taxonomy = await rpc<{ series: Json[] }>(as(editor), "media_admin_taxonomy");
    expect(taxonomy.series.find((s) => s.id === series)?.cover_framing).toEqual({ x: 33.3, y: 50, zoom: 1 });

    // The shared library image is not changed by either.
    const [asset] = await db.raw<{ width: number; height: number; path: string }>("select width, height, path from media.assets where id = $1", [img]);
    expect(asset).toMatchObject({ width: 1600, height: 900, path: `assets/${img}/processed.webp` });
  });

  it("shows the framing to members through the published item and series", async () => {
    const img = await image();
    const id = await lesson(as(publisher), img);
    await frame(as(publisher), id, null, img, { x: 10, y: 40, zoom: 1.25 });
    await rpc(as(publisher), "media_admin_item_status", [id, "publish", null, null, null]);
    const item = await rpc<Json>(as(member), "media_item", [id]);
    expect((item.cover as Json).framing).toEqual({ x: 10, y: 40, zoom: 1.25 });

    const series = await rpc<string>(as(publisher), "media_admin_series_save", [null, "lesson", "Synthetic shown series", "", img, false]);
    await db.raw("update media.items set series_id = $1 where id = $2", [series, id]);
    await frame(as(publisher), null, series, img, { x: 75, y: 25, zoom: 1 });
    const shown = await rpc<Json>(as(member), "media_series", [series]);
    expect((shown.cover as Json).framing).toEqual({ x: 75, y: 25, zoom: 1 });
  });

  it("starts centred again when the cover changes, and ignores a position for a different image", async () => {
    const first = await image();
    const second = await image();
    const id = await lesson(as(editor), first);
    await frame(as(editor), id, null, first, { x: 0, y: 100, zoom: 3 });
    await rpc(as(editor), "media_admin_item_save", [id, j({ cover_asset_id: second }), null]);
    expect(await itemCover(as(editor), id)).toBeNull();
    // A stale editor positioning the old image stores nothing.
    expect(await frame(as(editor), id, null, first, { x: 5, y: 5, zoom: 1 })).toBe(false);
    expect(await itemCover(as(editor), id)).toBeNull();
    // Null clears it (centred).
    await frame(as(editor), id, null, second, { x: 60, y: 60, zoom: 1 });
    await frame(as(editor), id, null, second, null);
    expect(await itemCover(as(editor), id)).toBeNull();
  });

  it("refuses invalid positions and people who may not save the item", async () => {
    const img = await image();
    const id = await lesson(as(editor), img);
    for (const bad of [{ x: 101, y: 0, zoom: 1 }, { x: 10, y: -1, zoom: 1 }, { x: 10, y: 10, zoom: 5 }, { x: "10", y: 10 }, [1, 2]]) {
      await expect(frame(as(editor), id, null, img, bad)).rejects.toThrow(/position isn't valid/);
    }
    await expect(frame(as(editor), id, id, img, { x: 1, y: 1, zoom: 1 })).rejects.toThrow(/one item or one series/);
    await expect(frame(as(member), id, null, img, { x: 1, y: 1, zoom: 1 })).rejects.toThrow(/permission/);
    await expect(frame(anon, id, null, img, { x: 1, y: 1, zoom: 1 })).rejects.toThrow();
    // Published content: editors may not change it, publishers may.
    await rpc(as(publisher), "media_admin_item_status", [id, "publish", null, null, null]);
    await expect(frame(as(editor), id, null, img, { x: 1, y: 1, zoom: 1 })).rejects.toThrow(/Only publishers/);
    expect(await frame(as(publisher), id, null, img, { x: 1, y: 1, zoom: 1 })).toBe(true);
    // Direct writes are checked too.
    await expect(db.raw("update media.items set cover_framing = $2 where id = $1", [id, j({ x: 1, y: 1 })])).rejects.toThrow(/cover_framing_check/);
  });
});
