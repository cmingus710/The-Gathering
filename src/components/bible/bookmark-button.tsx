"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { toggleBookmarkAction, type BookmarkInput } from "@/app/(member)/bible/actions";
import { Button } from "@/components/ui/button";

export function BookmarkButton({ input, bookmarked: initial, label = "Bookmark" }: { input: BookmarkInput; bookmarked: boolean; label?: string }) {
  const [on, setOn] = useState(initial);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        aria-pressed={on}
        disabled={pending}
        icon={on ? <BookmarkCheck className="size-4 text-primary" aria-hidden="true" /> : <Bookmark className="size-4" aria-hidden="true" />}
        onClick={() =>
          start(async () => {
            const r = await toggleBookmarkAction(input);
            if (r.ok) {
              setOn(r.bookmarked);
              setMessage(r.bookmarked ? "Bookmarked." : "Bookmark removed.");
            } else setMessage(r.message);
          })
        }
      >
        {on ? "Bookmarked" : label}
      </Button>
      <span role="status" className="sr-only">
        {message}
      </span>
    </>
  );
}
