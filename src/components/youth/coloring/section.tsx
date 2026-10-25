import { BookOpenText } from "lucide-react";
import type { ReactNode } from "react";
import { Card, SectionHeading } from "@/components/ui/card";
import type { ColoringTemplate } from "@/lib/youth/coloring";
import { ART_SOURCES } from "@/lib/youth/activities";

/**
 * The story in words (the text alternative to the picture), shown before
 * the studio for everyone, and the artwork's attribution after it.
 */
export function ColoringStory({ t, scriptureRefs, bibleStory }: { t: ColoringTemplate; scriptureRefs: string[]; bibleStory: string }) {
  if (!t.story && !scriptureRefs.length) return null;
  return (
    <Card className="space-y-2">
      <h3 className="flex items-center gap-2 text-[1.125rem] font-semibold">
        <BookOpenText className="size-5 text-primary" aria-hidden="true" />
        {bibleStory ? `The story: ${bibleStory}` : "The story"}
      </h3>
      {t.story ? <p className="whitespace-pre-line">{t.story}</p> : null}
      {scriptureRefs.length ? (
        <p className="text-meta text-text-secondary">
          <span className="font-semibold text-text">Read it in the Bible: </span>
          {scriptureRefs.join("; ")}
        </p>
      ) : null}
    </Card>
  );
}

export function ColoringAttribution({ t }: { t: ColoringTemplate }) {
  const a = t.attribution;
  const kind = ART_SOURCES.find(([k]) => k === a.source_kind)?.[1] ?? "";
  const parts = [a.credit || (a.source_kind === "original" ? "Original artwork for The Gathering" : ""), a.license].filter(Boolean);
  return (
    <p className="text-meta text-text-secondary">
      <span className="font-semibold">Artwork: </span>
      {parts.join(" · ") || kind}
      {a.source_url ? (
        <>
          {" · "}
          <a href={a.source_url} rel="noopener noreferrer nofollow" target="_blank" className="font-semibold text-primary underline">
            Source
          </a>
        </>
      ) : null}
    </p>
  );
}

export function ColoringSection({ children, t, scriptureRefs, bibleStory }: { children: ReactNode; t: ColoringTemplate; scriptureRefs: string[]; bibleStory: string }) {
  return (
    <section aria-labelledby="coloring" className="space-y-4">
      <SectionHeading id="coloring" description={t.mode === "regions" ? "Tap-to-fill and freehand coloring." : "Freehand coloring (this picture has no tap-to-fill parts)."}>
        Color the picture
      </SectionHeading>
      <ColoringStory t={t} scriptureRefs={scriptureRefs} bibleStory={bibleStory} />
      {children}
      <ColoringAttribution t={t} />
    </section>
  );
}
