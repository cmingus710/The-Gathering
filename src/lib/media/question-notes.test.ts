import { describe, expect, it } from "vitest";
import { notesJournalBody } from "./question-notes";

describe("notesJournalBody", () => {
  it("quotes each question in order with the member's note under it", () => {
    const body = notesJournalBody([
      { question: "Take a moment.\n\nWhat do you feel?", note: "Tired, mostly.\r\nAnd hopeful." },
      { question: "Where do you need rest?", note: "  " },
    ]);
    expect(body).toBe("> **1.** Take a moment.\n>\n> What do you feel?\n\nTired, mostly.\nAnd hopeful.\n\n> **2.** Where do you need rest?\n\n_No notes._");
  });
});
