import type { ReactNode } from "react";
import type { Token } from "@/lib/memory/types";

/**
 * Practice text from server tokens, keeping the source's spacing and poetry
 * line breaks. A hidden word renders as an empty box sized to the word: its
 * text isn't in the page, so a screen reader hears "hidden word" instead.
 */
export function TokenText({
  tokens,
  isHidden,
  render,
  label,
}: {
  tokens: Token[];
  isHidden?: (t: Token) => boolean;
  /** Custom content for a token (blanks in Missing words). */
  render?: (t: Token) => ReactNode | null;
  label: string;
}) {
  return (
    <div className="memory-text text-text" role="group" aria-label={label} lang="en">
      {tokens.map((t, n) => {
        const custom = render?.(t);
        const sep = n === tokens.length - 1 || t.g ? "" : t.b ? "\n" : " ";
        if (custom) {
          return (
            <span key={t.i}>
              {custom}
              {sep}
            </span>
          );
        }
        if (isHidden?.(t)) {
          return (
            <span key={t.i}>
              <span className="memory-word-hidden" style={{ width: `${Math.max(2, (t.t ?? "").length) * 0.6}em` }} />
              <span className="sr-only">hidden word</span>
              {sep}
            </span>
          );
        }
        return (
          <span key={t.i}>
            {t.t}
            {sep}
          </span>
        );
      })}
    </div>
  );
}
