import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCommunityJob } from "@/lib/community/jobs";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Group @mentions in Community, and people and group @mentions in Prayer
 * (20261108000100): who and which groups can be suggested and saved, the
 * group notification setting, referencing vs notifying, recipient capture
 * and dedupe (overlap, overlapping groups, retries, concurrent saves, edits,
 * remove/re-add, joining later), the recheck and cancellation of queued
 * email and push, prayer audience and anonymity rules, and the wording of
 * every channel. All people, groups, posts, prayer requests, and
 * notification destinations are synthetic; email and push are only claimed.
 */
type Json = Record<string, unknown>;
const SECRET = "test-events-job-secret-0123456789abcdef012345";
const person = (name: string, id: string) => `@[${name}](mention:${id})`;
const grp = (name: string, id: string) => `@[${name}](group:${id})`;

describeDb("group and prayer mentions", () => {
  let db: TestDb;
  let rob: string; // author, leader of Worship
  let ann: string; // Worship member, Choir member
  let ben: string; // Worship member
  let cara: string; // Choir member only
  let dan: string; // not in any group
  let blocker: string; // Worship member who blocked rob
  let muter: string; // Worship member who muted the group
  let optedOut: string; // Worship member, not in the directory
  let late: string; // joins Worship later
  let team: string; // prayer team
  let prayerMod: string;
  let cadmin: string;
  let category: string;
  let worship: string; // discoverable, leader rob
  let choir: string; // discoverable, leader ann, members-only notify
  let hidden: string; // hidden, leader rob

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const fails = (actor: Actor, fn: string, args: unknown[], message: RegExp) => expect(rpc(actor, fn, args)).rejects.toThrow(message);
  const fresh = () => db.raw("delete from community.rate_events");
  const post = async (author: string, body: string, opts: { group?: string; key?: string } = {}) => {
    await fresh();
    return rpc<string>(as(author), "community_thread_create", [opts.group ? null : category, opts.group ?? null, "Synthetic group mention", body, opts.key ?? randomUUID()]);
  };
  const comment = async (author: string, thread: string, body: string, key: string = randomUUID()) => {
    await fresh();
    return rpc<string>(as(author), "community_reply", [thread, body, key]);
  };
  const editThread = async (author: string, thread: string, body: string) => {
    await fresh();
    return rpc(as(author), "community_thread_edit", [thread, "Synthetic group mention", body]);
  };
  const prayer = async (author: string, body: string, opts: { audience?: string; group?: string | null; anonymous?: boolean; key?: string } = {}) => {
    await fresh();
    const audience = opts.audience ?? "church";
    return rpc<string>(as(author), "prayer_request_save", [null, "Synthetic prayer", body, audience, opts.group ?? null, opts.anonymous ?? false, true, audience, opts.key ?? null]);
  };
  const editPrayer = async (author: string, id: string, body: string, audience = "church", group: string | null = null, anonymous = false) => {
    await fresh();
    return rpc<string>(as(author), "prayer_request_save", [id, "Synthetic prayer", body, audience, group, anonymous, true, audience, null]);
  };
  const prayerComment = async (author: string, req: string, body: string, opts: { named?: boolean; key?: string } = {}) => {
    await fresh();
    return rpc<string>(as(author), "prayer_comment_add", [req, body, opts.named ?? false, opts.key ?? null]);
  };
  const notifs = async (id: string) => (await rpc<Json>(as(id), "community_notifications", [null, 50])).items as Json[];
  const about = async (id: string, path: string) => (await notifs(id)).filter((n) => String(n.url).startsWith(path));
  const deliveries = (target: string) =>
    db.raw<Json>("select profile_id, via_group, notification_id from community.mention_deliveries where target_id = $1 order by profile_id", [target]);
  const job = () =>
    createCommunityJob(SECRET, async (a) => {
      const r = await db.query<{ r: unknown }>(anon, "select public.community_job($1, $2, $3, $4) as r", [a.p_op, a.p_payload, a.p_ts, a.p_sig]);
      return { data: r[0].r, error: null };
    });
  const join = (group: string, id: string, role = "member") =>
    db.raw(
      "insert into community.group_members (group_id, profile_id, role) values ($1, $2, $3) on conflict (group_id, profile_id) do update set state = 'active', ended_at = null, role = excluded.role",
      [group, id, role],
    );
  const leave = (group: string, id: string) => db.raw("update community.group_members set state = 'left', ended_at = now() where group_id = $1 and profile_id = $2", [group, id]);

  beforeAll(async () => {
    db = await TestDb.create();
    await db.raw("insert into events.secrets (name, value) values ('job', $1) on conflict (name) do update set value = excluded.value", [SECRET]);
    const mk = async (email: string, name: string) => {
      const id = await db.createAuthUser(email, { fullName: name });
      await db.setStatus(id, "approved");
      return id;
    };
    rob = await mk("g.rob@example.test", "Rob Webb");
    ann = await mk("g.ann@example.test", "Ann Rivers");
    ben = await mk("g.ben@example.test", "Ben Rowe");
    cara = await mk("g.cara@example.test", "Cara Lane");
    dan = await mk("g.dan@example.test", "Dan Field");
    blocker = await mk("g.blocker@example.test", "Bea Blocker");
    muter = await mk("g.muter@example.test", "Max Muter");
    optedOut = await mk("g.optout@example.test", "Ola Optout");
    late = await mk("g.late@example.test", "Lou Late");
    team = await mk("g.team@example.test", "Tess Team");
    prayerMod = await mk("g.pmod@example.test", "Pat Moderator");
    cadmin = await mk("g.cadmin@example.test", "Cal Admin");
    await db.grantRole(cadmin, "community_admin");
    await db.grantRole(team, "prayer_team");
    await db.grantRole(prayerMod, "prayer_lead");
    await db.raw("update public.member_profile_details set directory_listed = false where profile_id = $1", [optedOut]);
    for (const id of [rob, ann, ben, cara, dan, blocker, muter, optedOut, late, team, prayerMod]) {
      const g = await rpc<Json>(as(id), "community_guidelines");
      await rpc(as(id), "community_ack_guidelines", [g.version]);
    }
    await db.raw("insert into community.blocks (blocker_id, blocked_id) values ($1, $2)", [blocker, rob]);
    category = (await db.raw<{ id: string }>("select id from community.categories where name = 'General Discussion'"))[0].id;
    const mkGroup = (name: string, visibility: string, leader: string) =>
      rpc<string>(as(cadmin), "community_group_save", [JSON.stringify({ name, summary: "Synthetic", about: "", visibility, leader_id: leader })]);
    worship = await mkGroup("Worship Team", "discoverable", rob);
    choir = await mkGroup("Choir", "discoverable", ann);
    hidden = await mkGroup("Quiet Circle", "hidden", rob);
    for (const id of [ann, ben, blocker, muter, optedOut]) await join(worship, id);
    for (const id of [cara, rob]) await join(choir, id);
    await join(hidden, ann);
    await rpc(as(muter), "community_set_mute", ["group", worship, true]);
  }, 180_000);

  afterAll(async () => {
    await db?.destroy();
  });

  describe("group suggestions", () => {
    const suggest = (who: string, q: string, place: { thread?: string; category?: string; group?: string }) =>
      rpc<{ members: Json[]; groups: Json[] }>(as(who), "community_mention_suggest", [q, place.thread ?? null, place.category ?? null, place.group ?? null]);

    it("separates members and groups, and lists only groups the author may reference", async () => {
      const s = await suggest(rob, "o", { category });
      expect(s.groups.map((g) => g.name)).toEqual(expect.arrayContaining(["Worship Team", "Choir"]));
      // A hidden group never appears church-wide, even to its leader.
      expect(s.groups.map((g) => g.name)).not.toContain("Quiet Circle");
      // Inside the hidden group, its members may reference it.
      expect((await suggest(rob, "quiet", { group: hidden })).groups.map((g) => g.name)).toEqual(["Quiet Circle"]);
      // Someone outside it never learns it exists.
      expect((await suggest(dan, "quiet", { category })).groups).toEqual([]);
      expect((await suggest(dan, "quiet", { group: hidden })).groups).toEqual([]);
      expect(Object.keys(s.groups[0]).sort()).toEqual(["id", "image_path", "name", "notify", "reach"]);
    });

    it("says whether choosing a group will notify, and counts recipients only when it will", async () => {
      const [w] = (await suggest(rob, "worship", { category })).groups;
      // rob leads Worship: notifies ann, ben, optedOut (not rob, the blocker, or… the muter is still counted until delivery).
      expect(w.notify).toBe("notify");
      expect(Number(w.reach)).toBe(4);
      const [asMember] = (await suggest(ann, "worship", { category })).groups;
      expect(asMember.notify).toBe("leaders");
      expect(asMember.reach).toBeNull();
      const [asOutsider] = (await suggest(dan, "worship", { category })).groups;
      expect(asOutsider.notify).toBe("leaders");
      expect(asOutsider.reach).toBeNull();
    });
  });

  describe("group setting", () => {
    it("is changed only by the group's managers and enforced on the server", async () => {
      await fails(as(ben), "community_group_set_mention_notify", [worship, "members"], /wasn't found/);
      await fails(as(dan), "community_group_set_mention_notify", [worship, "members"], /wasn't found/);
      await fails(as(rob), "community_group_set_mention_notify", [worship, "everyone"], /Choose who can notify/);
      await fresh();
      await rpc(as(ann), "community_group_set_mention_notify", [choir, "members"]);
      expect((await rpc<Json>(as(cara), "community_group", [choir])).mention_notify).toBe("members");
      const audit = await db.raw<Json>("select details from public.audit_log where action = 'group.mention_notify_changed' and target_id = $1", [choir]);
      expect(audit.at(-1)?.details).toEqual({ from: "leaders", to: "members" });
    });

    it("references without notifying when the author may not notify, and says so in the composer", async () => {
      // ben is a member, not a leader, of Worship (leaders only).
      const t = await post(ben, `Thanks ${grp("Worship Team", worship)}!`);
      expect(await about(ann, `/community/t/${t}`)).toEqual([]);
      expect(await deliveries(t)).toEqual([]);
      const card = await rpc<Json>(as(dan), "community_feed_post", [t]);
      expect(card.mentions).toEqual([{ id: worship, kind: "group", name: "Worship Team", listed: true }]);
      // Off: even leaders can't notify.
      await fresh();
      await rpc(as(rob), "community_group_set_mention_notify", [worship, "off"]);
      const t2 = await post(rob, `Hello ${grp("Worship Team", worship)}`);
      expect(await deliveries(t2)).toEqual([]);
      await fresh();
      await rpc(as(rob), "community_group_set_mention_notify", [worship, "leaders"]);
    });

    it("lets any member notify when set to members", async () => {
      const t = await post(cara, `Rehearsal moved ${grp("Choir", choir)}`);
      const [n] = await about(rob, `/community/t/${t}`);
      expect(n.kind).toBe("group_mention");
      expect(n.title).toBe("Cara Lane mentioned your group, Choir, in Community");
      expect(n.category).toBe("group_mentions");
    });
  });

  describe("notifying a group", () => {
    it("captures eligible members once, never the author, a blocker, or someone who muted the group", async () => {
      const t = await post(rob, `Practice tonight ${grp("Worship Team", worship)}`);
      const d = await deliveries(t);
      expect(d.map((x) => x.profile_id).sort()).toEqual([ann, ben, optedOut].sort());
      for (const x of d) expect(x.via_group).toBe(worship);
      for (const who of [rob, blocker, muter, dan]) expect(await about(who, `/community/t/${t}`)).toEqual([]);
      const [n] = await about(ann, `/community/t/${t}`);
      expect(n.title).toBe("Rob Webb mentioned your group, Worship Team, in Community");
    });

    it("sends one notice to someone mentioned by name and through overlapping groups", async () => {
      await fresh();
      await rpc(as(ann), "community_group_set_mention_notify", [choir, "members"]);
      const t = await post(rob, `${person("Ann Rivers", ann)} ${grp("Worship Team", worship)} ${grp("Choir", choir)}`);
      const mine = await about(ann, `/community/t/${t}`);
      expect(mine).toHaveLength(1);
      // By name wins the wording.
      expect(mine[0].kind).toBe("mention");
      expect((await deliveries(t)).filter((x) => x.profile_id === ann)).toEqual([expect.objectContaining({ via_group: null })]);
      // cara is reached only through Choir.
      expect((await about(cara, `/community/t/${t}`)).map((n) => n.kind)).toEqual(["group_mention"]);
    });

    it("notifies newly added groups once on edit, never re-notifies, and never reaches people who joined later", async () => {
      const t = await post(rob, "Plain to start");
      expect(await deliveries(t)).toEqual([]);
      await editThread(rob, t, `Now ${grp("Worship Team", worship)}`);
      expect(await about(ben, `/community/t/${t}`)).toHaveLength(1);
      await join(worship, late);
      // Unchanged, removed, and added back: nobody new, nobody twice.
      await editThread(rob, t, `Now ${grp("Worship Team", worship)} (edited)`);
      await editThread(rob, t, "Removed");
      expect(await about(ben, `/community/t/${t}`)).toEqual([]);
      await editThread(rob, t, `Back ${grp("Worship Team", worship)}`);
      expect(await about(ben, `/community/t/${t}`)).toHaveLength(1);
      expect(await about(late, `/community/t/${t}`)).toEqual([]);
      expect((await deliveries(t)).map((x) => x.profile_id)).not.toContain(late);
      const count = await db.raw<Json>("select count(*)::int as n from community.notifications where profile_id = $1 and thread_id = $2", [ben, t]);
      expect(count[0].n).toBe(1);
      await leave(worship, late);
    });

    it("never notifies twice for a retried submit or concurrent saves", async () => {
      const key = randomUUID();
      const t = await post(rob, `Retry ${grp("Worship Team", worship)}`, { key });
      expect(await post(rob, `Retry ${grp("Worship Team", worship)}`, { key })).toBe(t);
      expect(await about(ann, `/community/t/${t}`)).toHaveLength(1);

      const t2 = await post(rob, "Concurrent");
      const [c1, c2] = [await db.connect(), await db.connect()];
      const save = async (c: typeof c1, body: string) => {
        await c.query("begin");
        await c.query("set local role authenticated");
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: rob, role: "authenticated" })]);
        await c.query("select public.community_thread_edit($1, 'Synthetic group mention', $2)", [t2, body]);
        await c.query("commit");
      };
      await fresh();
      await Promise.all([save(c1, `A ${grp("Worship Team", worship)}`), save(c2, `B ${grp("Worship Team", worship)}`)]);
      await Promise.all([c1.end(), c2.end()]);
      expect(await about(ann, `/community/t/${t2}`)).toHaveLength(1);
      expect((await deliveries(t2)).filter((x) => x.profile_id === ann)).toHaveLength(1);
    });

    it("replaces the reply notice for a group mention in a comment and links to the comment", async () => {
      const t = await post(ann, "Ann's discussion");
      const c = await comment(rob, t, `Agreed ${grp("Worship Team", worship)}`);
      const mine = await about(ann, `/community/t/${t}`);
      expect(mine.map((n) => n.kind)).toEqual(["group_mention"]);
      expect(mine[0].title).toBe("Rob Webb mentioned your group, Worship Team, in a comment in Community");
      expect(await rpc(as(ann), "community_notification_open", [mine[0].id])).toBe(`/community/t/${t}?comment=${c}`);
    });

    it("refuses forged, hidden, and too many groups with a useful message", async () => {
      await fresh();
      await fails(as(rob), "community_thread_create", [category, null, "Synthetic refused", `Hi ${grp("Made Up", randomUUID())}`, randomUUID()], /@Made Up can't be mentioned here/);
      // A hidden group's name can't be put in front of non-members.
      await fails(as(rob), "community_thread_create", [category, null, "Synthetic refused", `Hi ${grp("Quiet Circle", hidden)}`, randomUUID()], /@Quiet Circle can't be mentioned here/);
      await fails(as(rob), "community_thread_create", [null, worship, "Synthetic refused", `Hi ${grp("Quiet Circle", hidden)}`, randomUUID()], /@Quiet Circle can't be mentioned here/);
      const inside = await post(rob, `Hi ${grp("Quiet Circle", hidden)}`, { group: hidden });
      expect((await about(ann, `/community/t/${inside}`)).map((n) => n.kind)).toEqual(["group_mention"]);
      const g4 = await rpc<string>(as(cadmin), "community_group_save", [JSON.stringify({ name: "Ushers", summary: "", about: "", visibility: "discoverable", leader_id: rob })]);
      await fresh();
      await fails(
        as(rob),
        "community_thread_create",
        [category, null, "Synthetic refused", [worship, choir, g4, hidden].map((g) => grp("G", g)).join(" "), randomUUID()],
        /up to 3 groups/,
      );
      // No mass mentions: typed "@everyone" is just text.
      const plain = await post(rob, "@everyone @all hello");
      expect(await deliveries(plain)).toEqual([]);
    });

    it("shows a group's name only to readers who may see it", async () => {
      const g = await rpc<string>(as(cadmin), "community_group_save", [JSON.stringify({ name: "Later Hidden", summary: "", about: "", visibility: "discoverable", leader_id: ann })]);
      const t = await post(rob, `Shout out ${grp("Later Hidden", g)}`);
      await fresh();
      await rpc(as(cadmin), "community_group_save", [JSON.stringify({ id: g, name: "Later Hidden", summary: "", visibility: "hidden" })]);
      const asDan = await rpc<Json>(as(dan), "community_feed_post", [t]);
      expect(asDan.body).toBe(`Shout out ${grp("Group", g)}`);
      expect(asDan.mentions).toEqual([{ id: g, kind: "group", name: null, listed: false }]);
      expect(JSON.stringify(asDan)).not.toContain("Later Hidden");
      const asAnn = await rpc<Json>(as(ann), "community_feed_post", [t]);
      expect(asAnn.body).toContain("Later Hidden");
    });
  });

  describe("delivery rechecks", () => {
    it("cancels queued email and push when a member leaves, the mention is removed, or the post is hidden", async () => {
      await rpc(as(ben), "community_set_pref", ["group_mentions", true, "immediate", true]);
      await db.raw("insert into community.push_subscriptions (profile_id, endpoint, p256dh, auth) values ($1, 'https://push.example.test/synthetic-ben', $2, $3)", [ben, "p".repeat(40), "a".repeat(16)]);
      const queued = async (n: Json) => ({
        email: (await db.raw<Json>("select status from community.email_outbox where notification_id = $1", [n.id]))[0]?.status,
        push: (await db.raw<Json>("select status from community.push_outbox where notification_id = $1", [n.id]))[0]?.status,
      });

      const t1 = await post(rob, `One ${grp("Worship Team", worship)}`);
      const [n1] = await about(ben, `/community/t/${t1}`);
      expect(await queued(n1)).toEqual({ email: "pending", push: "pending" });
      await editThread(rob, t1, "Mention removed");
      expect(await queued(n1)).toEqual({ email: "skipped", push: "skipped" });

      const t2 = await post(rob, `Two ${grp("Worship Team", worship)}`);
      const [n2] = await about(ben, `/community/t/${t2}`);
      await leave(worship, ben);
      expect(await queued(n2)).toEqual({ email: "skipped", push: "skipped" });
      expect(await about(ben, `/community/t/${t2}`)).toEqual([]);
      await join(worship, ben);
      // Rejoining doesn't bring it back as a new alert, and it never re-queues.
      expect(await queued(n2)).toEqual({ email: "skipped", push: "skipped" });

      const t3 = await post(rob, `Three ${grp("Worship Team", worship)}`);
      const [n3] = await about(ben, `/community/t/${t3}`);
      await db.raw("update community.threads set status = 'hidden' where id = $1", [t3]);
      expect(await queued(n3)).toEqual({ email: "skipped", push: "skipped" });
      expect(await rpc(as(ben), "community_notification_open", [n3.id])).toBeNull();

      const mails = await job()<Json[]>("email_claim", { limit: 100 });
      for (const n of [n1, n2, n3]) expect(JSON.stringify(mails)).not.toContain(n.id as string);
      await rpc(as(ben), "community_set_pref", ["group_mentions", true, "off", false]);
      await db.raw("delete from community.push_subscriptions where profile_id = $1", [ben]);
    });

    it("uses generic push text and names only the discussion's group in group-post email", async () => {
      await rpc(as(ann), "community_set_pref", ["group_mentions", true, "immediate", true]);
      await db.raw("insert into community.push_subscriptions (profile_id, endpoint, p256dh, auth) values ($1, 'https://push.example.test/synthetic-ann-g', $2, $3)", [ann, "p".repeat(40), "a".repeat(16)]);
      const run = job();
      await run("email_claim", { limit: 100 });
      await run("push_claim", { limit: 100 });
      await post(rob, `Church-wide ${grp("Worship Team", worship)}`);
      await post(rob, `In group ${grp("Worship Team", worship)}`, { group: worship });
      const titles = (await run<Json[]>("email_claim", { limit: 100 }))
        .filter((m) => m.to === "g.ann@example.test")
        .flatMap((m) => (m.items as Json[]).map((i) => i.title));
      expect(titles).toEqual(expect.arrayContaining(["Rob Webb mentioned your group, Worship Team, in Community", "Your group was mentioned in a Worship Team group discussion"]));
      const pushes = (await run<Json[]>("push_claim", { limit: 100 })).filter((p) => JSON.stringify(p.subscriptions).includes("synthetic-ann-g"));
      expect(pushes.map((p) => p.body)).toEqual(["Your group was mentioned in Community.", "Your group was mentioned in Community."]);
      await rpc(as(ann), "community_set_pref", ["group_mentions", true, "off", false]);
      await db.raw("delete from community.push_subscriptions where profile_id = $1", [ann]);
    });

    it("adds 'My group is mentioned' to settings without touching existing choices", async () => {
      const s = await rpc<Json>(as(cara), "community_my_settings");
      const prefs = s.prefs as Record<string, Json>;
      expect(prefs.group_mentions).toEqual({ in_app: true, email: "off", push: false });
      expect(prefs.mentions).toEqual({ in_app: true, email: "off", push: false });
      await fails(as(cara), "community_set_pref", ["group_mentions", true, "weekly", false], /valid email option/);
      // Turned off everywhere: nothing is created, and turning it back on brings nothing old.
      await rpc(as(rob), "community_set_pref", ["group_mentions", false, "off", false]);
      const t = await post(cara, `Choir ${grp("Choir", choir)}`);
      expect(await about(rob, `/community/t/${t}`)).toEqual([]);
      await rpc(as(rob), "community_set_pref", ["group_mentions", true, "off", false]);
      expect(await about(rob, `/community/t/${t}`)).toEqual([]);
      // Someone mentioned by name still hears through "Someone mentions me".
      const t2 = await post(cara, `${person("Rob Webb", rob)} ${grp("Choir", choir)}`);
      expect((await about(rob, `/community/t/${t2}`)).map((n) => n.kind)).toEqual(["mention"]);
      const panel = await rpc<Json>(as(ann), "community_notification_panel", [["group_mentions"], false, null, null, 15]);
      expect((panel.items as Json[]).every((n) => n.category === "group_mentions")).toBe(true);
    });
  });

  describe("prayer", () => {
    const suggest = (who: string, q: string, place: { request?: string; audience?: string; group?: string; anonymous?: boolean }) =>
      rpc<{ members: Json[]; groups: Json[]; unavailable?: string }>(as(who), "prayer_mention_suggest", [
        q,
        place.request ?? null,
        place.audience ?? null,
        place.group ?? null,
        place.anonymous ?? false,
      ]);

    it("suggests people and groups within the audience, and nothing for confidential or draft requests", async () => {
      const church = await suggest(rob, "a", { audience: "church" });
      expect(church.members.map((m) => m.name)).toContain("Ann Rivers");
      expect(church.members.map((m) => m.name)).not.toContain("Ola Optout");
      expect((await suggest(rob, "o", { audience: "church" })).groups.map((g) => g.name)).toEqual(expect.arrayContaining(["Worship Team", "Choir"]));
      const inGroup = await suggest(rob, "a", { audience: "group", group: worship });
      expect(inGroup.members.map((m) => m.name)).toContain("Ann Rivers");
      expect(inGroup.members.map((m) => m.name)).not.toContain("Cara Lane");
      expect(await suggest(rob, "a", { audience: "team" })).toEqual({ members: [], groups: [], unavailable: "team" });
      expect(await suggest(rob, "a", { audience: "private" })).toEqual({ members: [], groups: [], unavailable: "private" });
      // Not a member of the group: nothing.
      expect(await suggest(dan, "a", { audience: "group", group: worship })).toEqual({ members: [], groups: [] });
      // Anonymous: groups are listed but never notify.
      const anon_ = await suggest(rob, "worship", { audience: "church", anonymous: true });
      expect(anon_.groups[0]).toEqual(expect.objectContaining({ notify: "anonymous", reach: null }));
    });

    it("notifies people and groups in a request with generic wording, and never the author's name", async () => {
      const r = await prayer(rob, `Please pray with ${person("Cara Lane", cara)} and ${grp("Worship Team", worship)}`);
      const [toCara] = await about(cara, `/prayer/${r}`);
      expect(toCara.kind).toBe("prayer_mention");
      expect(toCara.title).toBe("You were mentioned in a prayer request: “Synthetic prayer”");
      const [toBen] = await about(ben, `/prayer/${r}`);
      expect(toBen.kind).toBe("prayer_group_mention");
      expect(toBen.title).toBe("Your group, Worship Team, was mentioned in a prayer request: “Synthetic prayer”");
      expect(JSON.stringify([toCara, toBen])).not.toContain("Rob");
      const d = await rpc<Json>(as(cara), "prayer_request", [r, 50]);
      expect(d.mentions).toEqual([
        { id: cara, name: "Cara Lane", listed: true },
        { id: worship, kind: "group", name: "Worship Team", listed: true },
      ]);
      // A mention never shares the request: dan still can't see it if it narrows.
      expect(await about(dan, `/prayer/${r}`)).toEqual([]);
    });

    it("keeps anonymous requests anonymous: people are told generically, groups aren't notified", async () => {
      await rpc(as(cara), "community_set_pref", ["mentions", true, "immediate", true]);
      const r = await prayer(rob, `With ${person("Cara Lane", cara)} and ${grp("Worship Team", worship)}`, { anonymous: true });
      const [n] = await about(cara, `/prayer/${r}`);
      expect(n.title).toBe("You were mentioned in a prayer request: “Synthetic prayer”");
      expect(await about(ann, `/prayer/${r}`)).toEqual([]);
      expect((await db.raw<Json>("select notify from prayer.group_mentions where request_id = $1", [r]))[0].notify).toBe(false);
      const mails = (await job()<Json[]>("email_claim", { limit: 100 })).filter((m) => m.to === "g.cara@example.test");
      const items = mails.flatMap((m) => m.items as Json[]);
      expect(items.map((i) => i.title)).toContain("You were mentioned in a prayer request");
      expect(JSON.stringify(mails)).not.toMatch(/Rob|Synthetic prayer|Worship/);
      const detail = await rpc<Json>(as(cara), "prayer_request", [r, 50]);
      expect(detail.author).toBe("Anonymous");
      await rpc(as(cara), "community_set_pref", ["mentions", true, "off", false]);
    });

    it("never singles out the writer of an anonymous request in suggestions", async () => {
      // dan writes an anonymous request to Worship, then leaves the group (authors keep access).
      await join(worship, dan);
      const r = await prayer(dan, "Anonymous in a group", { audience: "group", group: worship, anonymous: true });
      await leave(worship, dan);
      const names = (await suggest(ann, "d", { request: r })).members.map((m) => m.name);
      expect(names).not.toContain("Dan Field");
      await prayerComment(ann, r, "Praying");
      await fails(as(ann), "prayer_comment_add", [r, `Hi ${person("Dan Field", dan)}`, false, null], /@Dan Field can't be mentioned here/);
    });

    it("mentions in comments open the comment and replace the comment notice", async () => {
      const r = await prayer(ann, "Ann's request");
      await rpc(as(ben), "prayer_follow", [r, true]);
      const c = await prayerComment(rob, r, `Praying, ${person("Ann Rivers", ann)} ${person("Ben Rowe", ben)}`);
      for (const who of [ann, ben]) {
        const mine = await about(who, `/prayer/${r}`);
        expect(mine.map((n) => n.kind)).toEqual(["prayer_mention"]);
        expect(mine[0].title).toBe("You were mentioned in a comment on a prayer request: “Synthetic prayer”");
        expect(mine[0].url).toBe(`/prayer/${r}?comment=${c}`);
        expect(await rpc(as(who), "community_notification_open", [mine[0].id])).toBe(`/prayer/${r}?comment=${c}`);
      }
      const d = await rpc<Json>(as(ben), "prayer_request", [r, 50]);
      const shown = (d.comments as Json[]).find((x) => x.id === c)!;
      expect((shown.mentions as Json[]).map((m) => m.id).sort()).toEqual([ann, ben].sort());
      expect(await rpc(as(ben), "prayer_comment_position", [r, c])).toBe(1);
      expect(await rpc(as(dan), "prayer_comment_position", [r, c])).toBe(1);
    });

    it("refuses an audience change that would leave a mention someone can't see, and never broadens", async () => {
      const r = await prayer(rob, `With ${person("Cara Lane", cara)}`);
      await fresh();
      await expect(editPrayer(rob, r, `With ${person("Cara Lane", cara)}`, "group", worship)).rejects.toThrow(/@Cara Lane can't be mentioned here/);
      await expect(editPrayer(rob, r, `With ${person("Cara Lane", cara)}`, "team")).rejects.toThrow(/Mentions aren't available on confidential/);
      const still = await rpc<Json>(as(rob), "prayer_request", [r, 50]);
      expect(still.audience).toBe("church");
      const check = await rpc<Json>(as(rob), "prayer_mention_check", ["group", worship, false, [cara, ann], [choir, worship]]);
      expect(check).toEqual({ unavailable: null, people: [cara], groups: [], quiet: [] });
      expect((await rpc<Json>(as(rob), "prayer_mention_check", ["church", null, true, [], [worship]])).quiet).toEqual([worship]);
      expect((await rpc<Json>(as(rob), "prayer_mention_check", ["team", null, false, [cara], []])).unavailable).toBe("team");
      // Removing the mention lets it narrow; the old notice disappears.
      await editPrayer(rob, r, "Without", "group", worship);
      expect(await about(cara, `/prayer/${r}`)).toEqual([]);
    });

    it("doesn't notify for drafts, then notifies once when shared", async () => {
      const r = await prayer(rob, `Draft with ${person("Cara Lane", cara)}`, { audience: "private" });
      expect(await about(cara, `/prayer/${r}`)).toEqual([]);
      expect(await db.raw("select 1 from prayer.mentions where request_id = $1", [r])).toEqual([]);
      await editPrayer(rob, r, `Draft with ${person("Cara Lane", cara)}`, "church");
      expect(await about(cara, `/prayer/${r}`)).toHaveLength(1);
      await editPrayer(rob, r, `Draft with ${person("Cara Lane", cara)}!`, "church");
      expect(await about(cara, `/prayer/${r}`)).toHaveLength(1);
    });

    it("removes notices and cancels queued alerts when a request or comment is hidden, archived, or deleted", async () => {
      await rpc(as(ann), "community_set_pref", ["mentions", true, "immediate", false]);
      const status = async (n: Json) => (await db.raw<Json>("select status from community.email_outbox where notification_id = $1", [n.id]))[0]?.status;

      const r = await prayer(rob, `Hidden later ${person("Ann Rivers", ann)}`);
      const [n] = await about(ann, `/prayer/${r}`);
      expect(await status(n)).toBe("pending");
      await fresh();
      await rpc(as(prayerMod), "prayer_mod_action", ["request", r, "hide", "Synthetic reason", null]);
      expect(await about(ann, `/prayer/${r}`)).toEqual([]);
      expect(await db.raw("select 1 from community.notifications where id = $1", [n.id])).toEqual([]);

      const r2 = await prayer(rob, "Comment hidden later");
      const c = await prayerComment(ben, r2, `Hey ${person("Ann Rivers", ann)}`);
      const [n2] = await about(ann, `/prayer/${r2}`);
      expect(await status(n2)).toBe("pending");
      await fresh();
      await rpc(as(prayerMod), "prayer_mod_action", ["comment", c, "hide", "Synthetic reason", null]);
      expect(await status(n2)).toBe("skipped");
      expect(await about(ann, `/prayer/${r2}`)).toEqual([]);

      const r3 = await prayer(rob, `Deleted later ${person("Ann Rivers", ann)}`);
      expect(await about(ann, `/prayer/${r3}`)).toHaveLength(1);
      await rpc(as(rob), "prayer_request_delete", [r3]);
      expect(await about(ann, `/prayer/${r3}`)).toEqual([]);
      expect(await db.raw("select 1 from community.mention_deliveries where context_id = $1", [r3])).toEqual([]);
      await rpc(as(ann), "community_set_pref", ["mentions", true, "off", false]);
    });

    it("refuses forged and team-request mentions, and keeps youth and pending accounts out", async () => {
      const kid = await db.createAuthUser("g.kid@example.test", { fullName: "Kit Young" });
      await db.setStatus(kid, "approved");
      await db.raw("select set_config('youth.context', 'on', false)");
      await db.raw("update public.profiles set account_kind = 'youth' where id = $1", [kid]);
      await db.raw("select set_config('youth.context', '', false)");
      const pend = await db.createAuthUser("g.pending@example.test", { fullName: "Kip Pending" });
      expect((await suggest(rob, "ki", { audience: "church" })).members).toEqual([]);
      for (const id of [kid, pend, randomUUID()]) {
        await expect(prayer(rob, `Hi ${person("Kit", id)}`)).rejects.toThrow(/@Kit can't be mentioned here/);
      }
      await expect(prayer(team, `Hi ${person("Ann Rivers", ann)}`, { audience: "team" })).rejects.toThrow(/confidential/);
    });
  });
});
