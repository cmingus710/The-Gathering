import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { localFixtureFetcher } from "./local-fixture";

const file = path.join(mkdtempSync(path.join(tmpdir(), "fixture-")), "f.json");
writeFileSync(file, JSON.stringify({ "abc/JHN.3.16": { content: "[16] Synthetic.", copyright: "Synthetic ©", fumsToken: "t-1" } }));

describe("local API.Bible fixture", () => {
  it("is off unless the app talks to a loopback Supabase", () => {
    expect(localFixtureFetcher({ API_BIBLE_FIXTURE_FILE: file, NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co" })).toBeNull();
    expect(localFixtureFetcher({ API_BIBLE_FIXTURE_FILE: file })).toBeNull();
    expect(localFixtureFetcher({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toBeNull();
  });

  it("answers like API.Bible for known passages and 404 otherwise", async () => {
    const f = localFixtureFetcher({ API_BIBLE_FIXTURE_FILE: file, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })!;
    const ok = await f("https://rest.api.bible/v1/bibles/abc/passages/JHN.3.16?content-type=text");
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body.toString())).toEqual({ data: { content: "[16] Synthetic.", copyright: "Synthetic ©" }, meta: { fumsToken: "t-1" } });
    expect((await f("https://rest.api.bible/v1/bibles/abc/passages/JHN.3.17")).status).toBe(404);
  });
});
