import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compactConfig } from "@/lib/youth/games/config";
import { DEMO_ACTIVITIES } from "@/lib/youth/games/demos";
import { TEST_DATABASE_URL, TestDb, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Learn & Play games (20261124000100) against a real database: game
 * configuration checked on save (shape, identifiers, type, pictures from this
 * activity only, no markup) and on publish (complete content for the
 * difficulty), the demonstration drafts, game pictures readable only by
 * members the published version is open to, pictures in use kept, game
 * progress saved and resumed per child and version, completion kept through
 * replay, stale and cross-version saves refused, and no access for other
 * families, leaders, editors, or strangers.
 *
 * Every person here is synthetic.
 */
type Json = Record<string, unknown>;
const ALL = {
  manage_profile: true,
  register: true,
  sign_forms: true,
  media_consent: true,
  view_progress: true,
  practice: true,
  manage_account: true,
  receive_updates: true,
};

describeDb("Learn & Play games", () => {
  let db: TestDb;
  let editor: string;
  let famAdmin: string;
  let leader: string;
  let parentA: string; // kidA and kidB
  let parentD: string; // kidD
  let stranger: string;
  let kidA: string;
  let kidB: string;
  let kidD: string;

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const fails = async (actor: Actor, fn: string, args: unknown[], message: RegExp) => expect(rpc(actor, fn, args)).rejects.toThrow(message);
  const j = (v: unknown) => JSON.stringify(v);
  const mk = async (email: string, name: string) => {
    const id = await db.createAuthUser(email, { fullName: name });
    await db.setStatus(id, "approved");
    return id;
  };
  const scene = (id: string, art: string, caption = `Scene ${id}`) => ({ id, image: { art }, caption });
  const story = (scenes: unknown[], over: Json = {}) => ({
    title: "Synthetic Story Order",
    kind: "puzzle",
    difficulty: "beginner",
    scripture_refs: ["Genesis 6:9-22"],
    config: { player: "story_order", scenes },
    ...over,
  });
  const pair = (id: string, a: string, b: string, note = `${id} belongs with ${b}`) => ({ id, a: { image: { art: "person" }, label: a }, b: { image: { art: b } }, note });
  const match = (pairs: unknown[], over: Json = {}, cfg: Json = {}) => ({
    title: "Synthetic Match",
    kind: "matching",
    difficulty: "growing",
    scripture_refs: ["Jonah 1:17"],
    config: { player: "bible_match", mode: "related", sizes: [3], show_moves: true, pairs, ...cfg },
    ...over,
  });
  const create = async (p: Json) => (await rpc<Json>(as(editor), "youth_admin_activity_save", [null, j(p)])).id as string;
  const saveDraft = (id: string, p: Json) => rpc<Json>(as(editor), "youth_admin_activity_save", [id, j(p)]);
  const publish = (id: string) => rpc<Json>(as(editor), "youth_admin_activity_status", [id, "publish", "publish"]);
  const draftIssues = async (id: string) => ((await rpc<Json>(as(editor), "youth_admin_activity", [id])).draft as Json).issues as string[];
  const progress = (who: string, activity: string, child: string | null, version: string, p: Json) =>
    rpc<Json>(as(who), "youth_activity_progress_save", [activity, child, version, j(p)]);
  const upload = async (activity: string, alt: string) => {
    const begun = await rpc<Json>(as(editor), "youth_admin_activity_asset_begin", [activity, j({ source_kind: "original", alt, rights_confirmed: true })]);
    await db.query(as(editor), "insert into storage.objects (bucket_id, name) values ('youth', $1)", [begun.path]);
    await rpc(as(editor), "youth_admin_activity_asset_finish", [begun.id, j({ width: 800, height: 800, bytes: 40000 })]);
    return { id: begun.id as string, path: begun.path as string };
  };
  const canRead = async (who: string, name: string) => (await db.query<{ ok: boolean }>(as(who), "select public.youth_can_read_object($1) ok", [name]))[0].ok;

  beforeAll(async () => {
    db = await TestDb.create();
    editor = await mk("lg.editor@example.test", "Synthetic Game Editor");
    famAdmin = await mk("lg.family@example.test", "Synthetic Family Admin");
    const policyA = await mk("lg.policya@example.test", "Synthetic Policy A");
    const policyB = await mk("lg.policyb@example.test", "Synthetic Policy B");
    leader = await mk("lg.leader@example.test", "Synthetic Leader");
    parentA = await mk("lg.parenta@example.test", "Synthetic Parent A");
    parentD = await mk("lg.parentd@example.test", "Synthetic Parent D");
    stranger = await mk("lg.stranger@example.test", "Synthetic Stranger");
    for (const [who, role] of [
      [editor, "youth_activity_editor"], [famAdmin, "family_admin"], [policyA, "youth_policy_admin"], [policyB, "youth_policy_admin"], [leader, "youth_leader"],
    ]) await db.grantRole(who, role);
    const p = await rpc<Json>(as(policyA), "youth_admin_policy_save", [null, j({
      title: "Synthetic policy", body: "Synthetic.",
      settings: { multiple_guardians: true, birth_date_required: true, independent_accounts: true, eligibility_rule: "Synthetic rule.",
                  guardian_authorization_required: true, progress_sharing: "youth_choice" },
    })]);
    await rpc(as(policyB), "youth_admin_policy_approve", [p.id, `approve version ${p.version}`, "Synthetic minutes"]);
    const verify = async (guardian: string, name: string) => {
      const r = await rpc<Json>(as(guardian), "youth_guardian_request", [j({ kind: "new_child", child_name: name, relationship: "parent" })]);
      return (await rpc<Json>(as(famAdmin), "youth_admin_request_decide", [r.id, j({ decision: "approve", verification_method: "in_person", permissions: ALL })])).child_id as string;
    };
    kidA = await verify(parentA, "Synthetic Kid A");
    kidB = await verify(parentA, "Synthetic Kid B");
    kidD = await verify(parentD, "Synthetic Kid D");
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  describe("configuration checks on save", () => {
    it("refuses malformed games, duplicate identifiers, the wrong type, and markup", async () => {
      await fails(as(editor), "youth_admin_activity_save", [null, j(story([scene("a", "ark")], { kind: "matching" }))], /Puzzle type/);
      await fails(as(editor), "youth_admin_activity_save", [null, j(match([pair("n", "Noah", "ark")], { kind: "puzzle" }))], /Matching type/);
      await fails(as(editor), "youth_admin_activity_save", [null, j(story([scene("a", "ark"), scene("a", "dove")]))], /same identifier/);
      await fails(as(editor), "youth_admin_activity_save", [null, j(story([{ caption: "No id" }]))], /missing its identifier/);
      await fails(as(editor), "youth_admin_activity_save", [null, j(story([scene("a", "spaceship")]))], /built-in picture that doesn't exist/);
      await fails(as(editor), "youth_admin_activity_save", [null, j(story([{ id: "a", image: { art: "ark", asset: "x" } }]))], /isn't valid/);
      await fails(as(editor), "youth_admin_activity_save", [null, j(story(Array.from({ length: 9 }, (_, i) => scene(`s${i}`, "ark"))))], /up to 8 scenes/);
      await fails(as(editor), "youth_admin_activity_save", [null, j(story([scene("a", "ark", "x".repeat(81))]))], /80 characters/);
      await fails(as(editor), "youth_admin_activity_save", [null, j(story([scene("a", "ark", "<img src=x onerror=alert(1)>")]))], /markup or scripts/);
      await fails(as(editor), "youth_admin_activity_save", [null, j(story([], { config: { player: "pong" } }))], /supported game/);
      await fails(as(editor), "youth_admin_activity_save", [null, j(match([], {}, { mode: "memory" }))], /identical picture pairs or related/);
      await fails(as(editor), "youth_admin_activity_save", [null, j(match([], {}, { sizes: [5] }))], /3, 4, 6, 8, 10, or 12/);
      await fails(as(editor), "youth_admin_activity_save", [null, j(match([], {}, { sizes: [3, 3] }))], /once/);
      await fails(as(editor), "youth_admin_activity_save", [null, j(match(Array.from({ length: 13 }, (_, i) => pair(`p${i}`, "x", "ark"))))], /up to 12 pairs/);
      await fails(as(editor), "youth_admin_activity_save", [null, j(match([{ id: "p", a: { label: "y".repeat(41) } }]))], /40 characters/);
      // Not an editor: refused before anything is looked at.
      for (const who of [leader, parentA, stranger]) await fails(as(who), "youth_admin_activity_save", [null, j(story([scene("a", "ark")]))], /permission/);
    });

    it("accepts only pictures uploaded for this activity", async () => {
      const one = await create(story([]));
      const other = await create(story([], { title: "Synthetic Other" }));
      const art = await upload(other, "Synthetic picture");
      await fails(as(editor), "youth_admin_activity_save", [one, j(story([{ id: "a", image: { asset: art.id }, caption: "x" }]))], /uploaded for this activity/);
      await saveDraft(other, story([{ id: "a", image: { asset: art.id }, caption: "x" }]));
    });

    it("saves an incomplete draft and lists what keeps it from being published", async () => {
      const id = await create(story([scene("a", "ark"), { id: "b", caption: "" }]));
      expect(await draftIssues(id)).toEqual([
        "A Beginner story needs 3 to 4 scenes (it has 2). Change the scenes or the difficulty.",
        "Scene 2 needs a picture.",
        "Scene 2 needs a caption.",
      ]);
      await fails(as(editor), "youth_admin_activity_status", [id, "publish", "publish"], /Not ready to publish yet: A Beginner story needs 3 to 4/);
      // Difficulty changes the scene count the story needs.
      const five = ["ark", "animals", "rain", "dove", "rainbow"].map((a, i) => scene(`s${i}`, a));
      await saveDraft(id, story(five));
      expect(await draftIssues(id)).toEqual(["A Beginner story needs 3 to 4 scenes (it has 5). Change the scenes or the difficulty."]);
      await saveDraft(id, story(five, { difficulty: "growing" }));
      expect(await draftIssues(id)).toEqual([]);
      expect((await publish(id)).status).toBe("published");
    });

    it("checks pairs: explanations, look-alike cards, and board sizes", async () => {
      const id = await create(match([pair("noah", "Noah", "ark"), { ...pair("david", "David", "sling"), note: "" }, pair("jonah", "Noah", "ark")], {}, { sizes: [3, 4] }));
      expect(await draftIssues(id)).toEqual([
        "Pair 2 needs a short explanation, shown when it's matched.",
        "Pairs 1 and 3 have cards that look the same. Change one of them.",
        "A board of 4 pairs needs at least 4 pairs (there are 3).",
      ]);
      await fails(as(editor), "youth_admin_activity_status", [id, "publish", "publish"], /Not ready/);
      // Identical mode: the second card is ignored, every pair needs its own picture.
      await saveDraft(id, match([{ id: "a", a: { image: { art: "dove" } } }, { id: "b", a: { label: "No picture" } }, { id: "c", a: { image: { art: "dove" } } }], {}, { mode: "identical" }));
      expect(await draftIssues(id)).toEqual(["Pair 2 needs a picture.", "Pairs 1 and 3 have cards that look the same. Change one of them."]);
      await saveDraft(id, match([pair("noah", "Noah", "ark"), pair("david", "David", "sling"), pair("jonah", "Jonah", "big_fish")]));
      expect(await draftIssues(id)).toEqual([]);
    });

    it("leaves activities without a game alone", async () => {
      const id = await create({ title: "Synthetic Plain Puzzle", kind: "puzzle", difficulty: "beginner" });
      expect(await draftIssues(id)).toEqual([]);
      expect((await publish(id)).status).toBe("published");
    });

    it("creates the demonstration activities as complete drafts with Scripture references", async () => {
      for (const d of DEMO_ACTIVITIES) {
        const content = Object.fromEntries(Object.entries(d).filter(([k]) => k !== "key" && k !== "config"));
        const id = await create({ ...content, config: compactConfig(d.config) });
        const a = await rpc<Json>(as(editor), "youth_admin_activity", [id]);
        expect(a.status).toBe("draft");
        expect((a.draft as Json).issues).toEqual([]);
        expect(((a.draft as Json).scripture_refs as string[]).length).toBeGreaterThan(0);
        expect((a.draft as Json).change_note).toMatch(/check every scene or pair against the Scripture/);
      }
      // Drafts: no member sees them.
      const home = await rpc<Json>(as(parentA), "youth_activities_home");
      expect((home.activities as Json[]).map((x) => x.title)).not.toContain(DEMO_ACTIVITIES[0].title);
    });
  });

  describe("pictures", () => {
    let id: string;
    let used: { id: string; path: string };
    let spare: { id: string; path: string };

    it("serves a published game's uploaded pictures only to members it is open to", async () => {
      id = await create(story([]));
      used = await upload(id, "Synthetic ark picture");
      spare = await upload(id, "Synthetic spare picture");
      await saveDraft(id, story([{ id: "a", image: { asset: used.id }, caption: "Build" }, scene("b", "animals"), scene("c", "rainbow")]));
      // In the draft only: editors read it, members don't.
      expect(await canRead(editor, used.path)).toBe(true);
      expect(await canRead(parentA, used.path)).toBe(false);
      // Used by the draft's game: can't be removed yet.
      await fails(as(editor), "youth_admin_activity_asset_remove", [used.id], /used in the draft's scenes or pairs/);
      expect(((await rpc<Json>(as(editor), "youth_admin_activity", [id])).assets as Json[]).find((x) => x.id === used.id)).toMatchObject({ in_draft: true, locked: false });
      await publish(id);
      expect(await canRead(parentA, used.path)).toBe(true);
      expect(await canRead(parentD, used.path)).toBe(true);
      expect(await canRead(stranger, used.path)).toBe(false);
      expect(await canRead(leader, used.path)).toBe(false);
      expect(await canRead(parentA, spare.path)).toBe(false); // uploaded but not in the game
      const a = await rpc<Json>(as(parentA), "youth_activity", [id, kidA]);
      expect(a.media).toEqual({ [used.id]: { path: used.path, alt: "Synthetic ark picture" } });
      expect(((a.config as Json).scenes as Json[])[0]).toEqual({ id: "a", image: { asset: used.id }, caption: "Build" });
    });

    it("keeps pictures a published version uses", async () => {
      await fails(as(editor), "youth_admin_activity_asset_remove", [used.id], /part of a published version/);
      expect(((await rpc<Json>(as(editor), "youth_admin_activity", [id])).assets as Json[]).find((x) => x.id === used.id)).toMatchObject({ locked: true });
      // A new draft that drops the picture still can't remove it: version 1 uses it.
      await saveDraft(id, story([scene("a", "ark"), scene("b", "animals"), scene("c", "rainbow")]));
      await fails(as(editor), "youth_admin_activity_asset_remove", [used.id], /part of a published version/);
      expect(await rpc<Json>(as(editor), "youth_admin_activity_asset_remove", [spare.id])).toEqual({ path: spare.path });
    });
  });

  describe("progress", () => {
    let id: string;
    let v1: string;

    it("saves and resumes a game's board for the chosen child only", async () => {
      id = await create(match([pair("noah", "Noah", "ark"), pair("david", "David", "sling"), pair("jonah", "Jonah", "big_fish")], { title: "Synthetic Progress Match" }));
      v1 = (await publish(id)).published_version_id as string;
      const board = { game: "bible_match", size: 3, seed: 12345, matched: ["noah"], moves: 2, solved: false, completions: 0 };
      expect(await progress(parentA, id, kidA, v1, { data: board, revision: 0 })).toMatchObject({ status: "started", revision: 1, child_id: kidA });
      expect(((await rpc<Json>(as(parentA), "youth_activity", [id, kidA])).progress as Json).data).toEqual(board);
      // The sibling on the same device starts fresh; another family can't see or save.
      expect((await rpc<Json>(as(parentA), "youth_activity", [id, kidB])).progress).toBeNull();
      await fails(as(parentD), "youth_activity", [id, kidA], /Not found/);
      for (const who of [parentD, stranger, leader, editor]) await fails(as(who), "youth_activity_progress_save", [id, kidA, v1, j({ data: board, revision: 1 })], /Not found/);
      const blob = JSON.stringify(await rpc(as(editor), "youth_admin_activity", [id]));
      expect(blob).not.toContain("12345");
      expect(blob).not.toContain(kidA);
    });

    it("refuses a stale save from another tab and markup in saved answers", async () => {
      await progress(parentA, id, kidA, v1, { data: { game: "bible_match", size: 3, seed: 12345, matched: ["noah", "david"], moves: 3 }, revision: 1 });
      expect(await progress(parentA, id, kidA, v1, { data: { game: "bible_match", matched: [] }, revision: 1 })).toEqual({ conflict: "revision" });
      await fails(as(parentA), "youth_activity_progress_save", [id, kidA, v1, j({ data: { matched: ["<script>x()</script>"] }, revision: 2 })], /markup or scripts/);
      expect((((await rpc<Json>(as(parentA), "youth_activity", [id, kidA])).progress as Json).data as Json).matched).toEqual(["noah", "david"]);
    });

    it("keeps a completion when the child plays again, unless it's marked not finished", async () => {
      const done = await progress(parentA, id, kidA, v1, { data: { game: "bible_match", size: 3, seed: 12345, matched: ["noah", "david", "jonah"], solved: true, completions: 1 }, completed: true, revision: 2 });
      expect(done.status).toBe("completed");
      const at = done.completed_at;
      // Replay: a new board saved without "completed" (as an older page might send) stays completed.
      const replay = await progress(parentA, id, kidA, v1, { data: { game: "bible_match", size: 3, seed: 999, matched: [], completions: 1 }, completed: false, revision: 3 });
      expect(replay).toMatchObject({ status: "completed", completed_at: at, revision: 4 });
      const reset = await progress(parentA, id, kidA, v1, { data: {}, completed: false, reset: true, revision: 4 });
      expect(reset).toMatchObject({ status: "started", completed_at: null });
    });

    it("ties answers to the version: a new version starts fresh and old progress stays put", async () => {
      await progress(parentA, id, kidA, v1, { data: { game: "bible_match", size: 3, seed: 5, matched: ["noah"] }, completed: true, revision: 5 });
      await saveDraft(id, match([pair("noah", "Noah", "ark"), pair("moses", "Moses", "tablets"), pair("jonah", "Jonah", "big_fish")], { title: "Synthetic Progress Match" }));
      const v2 = (await publish(id)).published_version_id as string;
      const before = await db.raw("select data, status, revision from youth.activity_progress where version_id = $1", [v1]);
      expect(await progress(parentA, id, kidA, v1, { data: { matched: [] }, revision: 6 })).toEqual({ conflict: "version" });
      const a = await rpc<Json>(as(parentA), "youth_activity", [id, kidA]);
      expect(a).toMatchObject({ version_id: v2, progress: null });
      expect((a.earlier as Json[]).map((e) => e.status)).toEqual(["completed"]);
      expect(((a.config as Json).pairs as Json[]).map((p) => p.id)).toEqual(["noah", "moses", "jonah"]);
      expect(await db.raw("select data, status, revision from youth.activity_progress where version_id = $1", [v1])).toEqual(before);
    });

    it("loses access at once when the guardian's practice permission is removed", async () => {
      const g = (await db.raw<{ id: string }>("select id from youth.guardianships where guardian_id = $1 and child_id = $2", [parentA, kidB]))[0].id;
      await rpc(as(famAdmin), "youth_admin_guardian_update", [g, j({ permissions: { ...ALL, practice: false } })]);
      const v = ((await rpc<Json>(as(editor), "youth_admin_activity", [id])).published as Json).version_id as string;
      await fails(as(parentA), "youth_activity_progress_save", [id, kidB, v, j({ data: {}, revision: 0 })], /Not found/);
      expect((await rpc<Json>(as(parentA), "youth_activity", [id, kidA])).child).toMatchObject({ id: kidA });
      expect(kidD).toBeTruthy();
    });
  });
});
