"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { cn } from "@/components/ui/cn";
import { FieldFrame, fieldControlClass, fieldDescribedBy } from "@/components/ui/field";
import { applyTopicSuggestion, suggestTopics } from "@/lib/media/book-collections";

/**
 * "Topics", separated by commas, with existing topics suggested as you type
 * so names are reused rather than retyped. A plain text input underneath:
 * the form still submits the same comma-separated value.
 */
export function TopicsField({ defaultValue, topics, hint }: { defaultValue: string; topics: string[]; hint: string }) {
  const id = "field-topics";
  const listId = useId();
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const suggestions = open ? suggestTopics(value, topics) : [];
  const shown = suggestions.length > 0;

  const choose = (topic: string) => {
    setValue((v) => applyTopicSuggestion(v, topic));
    setActive(-1);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!shown) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      // Cycles through the suggestions and back to the typed text (-1).
      setActive((i) => {
        const next = i + step;
        return next >= suggestions.length ? -1 : next < -1 ? suggestions.length - 1 : next;
      });
    } else if (e.key === "Enter" && active >= 0 && active < suggestions.length) {
      // Picks the suggestion instead of submitting the form.
      e.preventDefault();
      choose(suggestions[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <FieldFrame id={id} label="Topics" hint={hint} optional>
      <div className="relative">
        <input
          id={id}
          name="topics"
          value={value}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={listId}
          aria-activedescendant={shown && active >= 0 && active < suggestions.length ? `${listId}-${active}` : undefined}
          aria-describedby={fieldDescribedBy(id, hint, null)}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={cn(fieldControlClass, "border-border-strong")}
        />
        <ul
          id={listId}
          role="listbox"
          aria-label="Existing topics"
          hidden={!shown}
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-control border border-border bg-surface-raised py-1 shadow-(--elev-lift)"
        >
          {suggestions.map((t, i) => (
            <li
              key={t}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keeps focus in the input (no blur before the click lands).
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(t)}
              className={cn("cursor-pointer px-4 py-2.5 text-text [overflow-wrap:anywhere]", i === active ? "bg-primary-soft" : "hover:bg-surface-muted")}
            >
              {t}
            </li>
          ))}
        </ul>
      </div>
    </FieldFrame>
  );
}
