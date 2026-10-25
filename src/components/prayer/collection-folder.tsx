import { HandHeart, Library } from "lucide-react";
import { FolderCard } from "@/components/media/reading/collections";
import { prayerCount, type CollectionShelf } from "@/lib/prayer/library";

/**
 * A Prayer Library collection as a folder, in the same shape as the Books
 * collections: its cover (or a quiet icon), name, short description, and how
 * many published prayers it holds. `src` is the cover's signed URL, present
 * only when the viewer may load it.
 */
export function PrayerCollectionFolder({
  href,
  collection,
  src,
  all = false,
}: {
  href: string;
  collection: Pick<CollectionShelf, "name" | "description" | "count">;
  src?: string | null;
  /** All prayers: the library icon and the primary-colored tab. */
  all?: boolean;
}) {
  return (
    <FolderCard
      href={href}
      name={collection.name}
      description={collection.description}
      countLabel={prayerCount(collection.count)}
      accent={all}
      art={
        src ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage
          <img src={src} alt="" className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : all ? (
          <Library className="mb-4 size-12 text-primary" strokeWidth={1.5} />
        ) : (
          <HandHeart className="mb-4 size-12 text-primary/80" strokeWidth={1.4} />
        )
      }
    />
  );
}

export { collectionGridClass } from "@/components/media/reading/collections";
