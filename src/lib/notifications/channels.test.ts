import { describe, expect, it } from "vitest";
import { channelAllows, readChannelForm, typeLabel } from "./channels";

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

describe("readChannelForm", () => {
  it("keeps the stored individual selections while All is on", () => {
    expect(readChannelForm(form({ channel: "push", all: "on", types: "forum,groups" }))).toEqual({ channel: "push", all: true, disabled: null });
  });

  it("disables every listed type left unchecked when All is off", () => {
    const f = form({ channel: "email", types: "forum,groups,youth", "type.groups": "on" });
    expect(readChannelForm(f)).toEqual({ channel: "email", all: false, disabled: ["forum", "youth"] });
  });

  it("ignores unknown channels and malformed type keys", () => {
    expect(readChannelForm(form({ channel: "sms" }))).toBeNull();
    expect(readChannelForm(form({ channel: "push", types: "forum,DROP TABLE,../x" }))).toEqual({ channel: "push", all: false, disabled: ["forum"] });
  });

  it("treats each channel independently", () => {
    expect(readChannelForm(form({ channel: "push", all: "on" }))?.channel).toBe("push");
    expect(readChannelForm(form({ channel: "email" }))).toEqual({ channel: "email", all: false, disabled: [] });
  });
});

describe("channelAllows", () => {
  it("allows everything under All, including types added later", () => {
    expect(channelAllows({ all: true, disabled: ["forum"] }, "forum")).toBe(true);
    expect(channelAllows({ all: true, disabled: [] }, "future_type")).toBe(true);
  });

  it("uses the individual selections otherwise, allowing unlisted types", () => {
    expect(channelAllows({ all: false, disabled: ["forum"] }, "forum")).toBe(false);
    expect(channelAllows({ all: false, disabled: ["forum"] }, "future_type")).toBe(true);
  });
});

describe("typeLabel", () => {
  it("names known types and falls back for new ones", () => {
    expect(typeLabel("forum")).toBe("Discussions");
    expect(typeLabel("future_type")).toBe("Future type");
  });
});
