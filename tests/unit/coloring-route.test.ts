import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The coloring autosave endpoint: refuses signed-out, malformed, and
 * oversized requests before the database, passes only checked artwork on,
 * and maps the database's answers to the autosave contract.
 */
const rpc = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, rpc }),
}));

const ACT = "00000000-0000-4000-8000-0000000000a1";
const VER = "00000000-0000-4000-8000-0000000000b1";

async function put(body: unknown, activity = ACT) {
  const { PUT } = await import("@/app/api/youth/coloring/[activity]/route");
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return PUT(new Request(`https://app.example.test/api/youth/coloring/${activity}`, { method: "PUT", body: text }), {
    params: Promise.resolve({ activity }),
  } as never);
}

const ok = { child: null, version: VER, base_version: 0, doc: { fills: { r1: "red" }, strokes: [] } };

describe("coloring autosave route", () => {
  beforeEach(() => {
    rpc.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("refuses bad ids, bad JSON, malformed artwork, and oversized bodies without calling the database", async () => {
    expect((await put(ok, "not-a-uuid")).status).toBe(404);
    expect((await put("{")).status).toBe(400);
    expect((await put({ ...ok, version: "x" })).status).toBe(400);
    expect((await put({ ...ok, doc: { fills: { r1: "<script>" }, strokes: [] } })).status).toBe(400);
    expect((await put({ ...ok, doc: { fills: {}, strokes: [{ t: "paint", c: "red", s: "m", p: "javascript:x" }] } })).status).toBe(400);
    expect((await put({ ...ok, doc: { fills: {}, strokes: [], x: "y".repeat(500_000) } })).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("says when the session has ended", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await put(ok)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("saves through the database with the named child, version, and base revision", async () => {
    rpc.mockResolvedValue({ data: { status: "saved", revision: 1, updated_at: "2026-10-24T00:00:00Z" }, error: null });
    const res = await put({ ...ok, child: "00000000-0000-4000-8000-0000000000c1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 1, updated_at: "2026-10-24T00:00:00Z" });
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(rpc).toHaveBeenCalledWith("youth_coloring_save", {
      p_activity: ACT,
      p_child: "00000000-0000-4000-8000-0000000000c1",
      p_version: VER,
      p_base_revision: 0,
      p_doc: { fills: { r1: "red" }, strokes: [] },
    });
  });

  it("returns the newer saved picture on a conflict, and 410 when a new version was published", async () => {
    rpc.mockResolvedValue({ data: { status: "conflict", current: { revision: 3, doc: { strokes: [], fills: { r1: "blue" } }, updated_at: "t" } }, error: null });
    const c = await put(ok);
    expect(c.status).toBe(409);
    expect(await c.json()).toEqual({ current: { body: '{"fills":{"r1":"blue"},"strokes":[]}', version: 3, updated_at: "t" } });
    rpc.mockResolvedValue({ data: { status: "version" }, error: null });
    expect((await put(ok)).status).toBe(410);
  });

  it("maps database refusals", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "Not found." } });
    expect((await put(ok)).status).toBe(404);
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "You're doing that too often." } });
    expect((await put(ok)).status).toBe(429);
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "That picture couldn't be saved: it uses a color that isn't in the palette." } });
    const bad = await put(ok);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/palette/);
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    expect((await put(ok)).status).toBe(503);
  });
});
