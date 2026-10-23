import { Lexer, type Token, type Tokens } from "marked";
import type { z } from "zod";
import { classifyHref, LINK_HELP } from "./policy";

// @mentions are stored as `@[Name](mention:<id>)` and `@[Name](group:<id>)`;
// the mention pipeline checks them, and the renderers never make them links.
const MENTION_HREF = /^(mention|group):[0-9a-f-]{36}$/i;

function walk(tokens: Token[] | undefined, out: string[]) {
  for (const t of tokens ?? []) {
    if (t.type === "link") {
      const href = (t as Tokens.Link).href ?? "";
      const before = (t as Tokens.Link).raw;
      if (!MENTION_HREF.test(href) && !classifyHref(href) && !out.includes(href)) out.push(href || before);
    }
    const g = t as Tokens.Generic;
    walk(g.tokens, out);
    if (Array.isArray(g.items)) for (const item of g.items) walk((item as Tokens.ListItem).tokens, out);
    if (t.type === "table") {
      const table = t as Tokens.Table;
      for (const cell of table.header) walk(cell.tokens, out);
      for (const row of table.rows) for (const cell of row) walk(cell.tokens, out);
    }
  }
}

/** Link destinations in Markdown that the link policy refuses, in order, each once. */
export function unsafeLinks(markdown: string): string[] {
  const out: string[] = [];
  walk(Lexer.lex(markdown ?? "", { gfm: true, breaks: true }), out);
  return out;
}

/**
 * The server's check of what someone saves: null when every link is
 * allowed, otherwise a message naming the first link that isn't. Saving is
 * refused rather than quietly changing what was written.
 */
export function linkProblem(markdown: string): string | null {
  const [first] = unsafeLinks(markdown);
  if (first === undefined) return null;
  const shown = first.length > 60 ? `${first.slice(0, 57)}…` : first;
  return `This link can't be used: “${shown}”. ${LINK_HELP} Edit or remove the link, then try again.`;
}

/** Adds the link check to a text field's schema (Community, Prayer, announcements). */
export function withSafeLinks<T extends z.ZodType<string>>(schema: T): T {
  return schema.superRefine((value, ctx) => {
    const message = linkProblem(value);
    if (message) ctx.addIssue({ code: "custom", message });
  }) as T;
}
