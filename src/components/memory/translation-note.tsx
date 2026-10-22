import type { Item } from "@/lib/memory/types";

/**
 * Which Bible version an assigned verse is practiced in: the church's
 * required version, or the member's own choice when the collection allows
 * it. Shown beside the reference so the requirement is never hidden.
 */
export function ItemTranslationNote({ item, className }: { item: Item; className?: string }) {
  const assigned = item.passage.translation;
  const mine = item.card?.translation;
  const text =
    mine && mine.id !== assigned.id
      ? `Assigned in ${assigned.code}. You practice it in ${mine.code}.`
      : item.translation_choice
        ? `Assigned in ${assigned.code}. You may practice it in another version.`
        : `Practiced in ${assigned.code}, as assigned.`;
  return <p className={className ?? "mt-1 text-meta text-text-secondary"}>{text}</p>;
}
