import { describe, expect, it } from "vitest";
import {
  applyTextEdit,
  findMentionQuery,
  insertMention,
  mentionedGroups,
  mentionedPeople,
  mentionLabel,
  mentionsAsText,
  parseMentions,
  removeMention,
  serializeMentions,
} from "./mentions";

const ann = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ben = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const markup = `Hi @[Ann Rivers](mention:${ann}) and @[Ben Rowe](mention:${ben})!`;

describe("mention markup", () => {
  it("round-trips between markup and the edited text", () => {
    const { text, mentions } = parseMentions(markup);
    expect(text).toBe("Hi @Ann Rivers and @Ben Rowe!");
    expect(mentions.map((m) => text.slice(m.start, m.end))).toEqual(["@Ann Rivers", "@Ben Rowe"]);
    expect(serializeMentions(text, mentions)).toBe(markup);
  });

  it("keeps labels safe for the markup", () => {
    expect(mentionLabel("Ann [admin]\nRivers")).toBe("Ann admin Rivers");
    expect(mentionLabel("   ")).toBe("Member");
    expect(mentionLabel("x".repeat(200))).toHaveLength(80);
  });

  it("counts people, not mentions", () => {
    const { mentions } = parseMentions(`${markup} @[Ann Rivers](mention:${ann})`);
    expect(mentions).toHaveLength(3);
    expect(mentionedPeople(mentions)).toBe(2);
  });

  it("round-trips group mentions and counts them apart from people", () => {
    const choir = "3b241101-e2bb-4255-8caf-4136c566a962";
    const both = `${markup} with @[Choir](group:${choir})`;
    const { text, mentions } = parseMentions(both);
    expect(text).toBe("Hi @Ann Rivers and @Ben Rowe! with @Choir");
    expect(mentions.map((m) => m.kind ?? "member")).toEqual(["member", "member", "group"]);
    expect(serializeMentions(text, mentions)).toBe(both);
    expect(mentionedPeople(mentions)).toBe(2);
    expect(mentionedGroups(mentions)).toBe(1);
    expect(mentionsAsText(both)).toBe("Hi @Ann Rivers and @Ben Rowe! with @Choir");
    const r = insertMention("Hey @ch", [], { start: 4, end: 7 }, { id: choir, name: "Choir", kind: "group" });
    expect(serializeMentions(r.text, r.mentions)).toBe(`Hey @[Choir](group:${choir}) `);
  });

  it("shows plain @names for previews", () => {
    expect(mentionsAsText(markup)).toBe("Hi @Ann Rivers and @Ben Rowe!");
  });
});

describe("finding a mention being typed", () => {
  it("starts at an @ after a space or at the start", () => {
    expect(findMentionQuery("@an", 3)).toEqual({ start: 0, query: "an" });
    expect(findMentionQuery("Thanks @Ann R", 13)).toEqual({ start: 7, query: "Ann R" });
    expect(findMentionQuery("(@be", 4)).toEqual({ start: 1, query: "be" });
  });

  it("ignores email addresses, a bare @, and finished mentions", () => {
    expect(findMentionQuery("rob@example", 11)).toBeNull();
    expect(findMentionQuery("Hi @", 4)).toBeNull();
    expect(findMentionQuery("a @b\nc", 6)).toBeNull();
    const { text, mentions } = parseMentions(`@[Ann](mention:${ann})`);
    expect(findMentionQuery(text, text.length, mentions)).toBeNull();
  });
});

describe("editing text with mentions", () => {
  const start = () => parseMentions(markup);

  it("shifts mentions when typing before them and keeps them when typing after", () => {
    const { text, mentions } = start();
    const r = applyTextEdit(text, `Oh, ${text}`, mentions);
    expect(serializeMentions(r.text, r.mentions)).toBe(`Oh, ${markup}`);
    const r2 = applyTextEdit(text, `${text} Bye`, mentions);
    expect(serializeMentions(r2.text, r2.mentions)).toBe(`${markup} Bye`);
  });

  it("typing next to a mention doesn't break it", () => {
    const { text, mentions } = start();
    const at = text.indexOf("@Ann");
    const before = applyTextEdit(text, text.slice(0, at) + "x" + text.slice(at), mentions);
    expect(before.mentions).toHaveLength(2);
    const end = text.indexOf(" and");
    const after = applyTextEdit(text, text.slice(0, end) + "," + text.slice(end), mentions);
    expect(serializeMentions(after.text, after.mentions)).toBe(`Hi @[Ann Rivers](mention:${ann}), and @[Ben Rowe](mention:${ben})!`);
  });

  it("removes a whole mention with one Backspace", () => {
    const { text, mentions } = start();
    const end = text.indexOf(" and");
    const r = applyTextEdit(text, text.slice(0, end - 1) + text.slice(end), mentions);
    expect(r.text).toBe("Hi  and @Ben Rowe!");
    expect(serializeMentions(r.text, r.mentions)).toBe(`Hi  and @[Ben Rowe](mention:${ben})!`);
  });

  it("drops the link when typing inside a name, leaving the text", () => {
    const { text, mentions } = start();
    const inside = text.indexOf("Rivers");
    const r = applyTextEdit(text, text.slice(0, inside) + "X" + text.slice(inside), mentions);
    expect(r.text).toBe("Hi @Ann XRivers and @Ben Rowe!");
    expect(serializeMentions(r.text, r.mentions)).toBe(`Hi @Ann XRivers and @[Ben Rowe](mention:${ben})!`);
  });

  it("inserts a chosen member in place of the typed query, with a space after", () => {
    const r = insertMention("Thanks @an!", [], { start: 7, end: 10 }, { id: ann.toUpperCase(), name: "Ann Rivers" });
    expect(r.text).toBe("Thanks @Ann Rivers !");
    expect(r.caret).toBe(19);
    expect(serializeMentions(r.text, r.mentions)).toBe(`Thanks @[Ann Rivers](mention:${ann}) !`);
    const two = insertMention(r.text + " @Ann", r.mentions, { start: 21, end: 25 }, { id: ben, name: "Ann Rivers" });
    expect(two.mentions.map((m) => m.id)).toEqual([ann, ben]);
  });

  it("removes a mention and its text from the chip", () => {
    const { text, mentions } = start();
    const r = removeMention(text, mentions, mentions[1]);
    expect(serializeMentions(r.text, r.mentions)).toBe(`Hi @[Ann Rivers](mention:${ann}) and !`);
  });
});
