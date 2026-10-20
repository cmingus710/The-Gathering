import Link from "next/link";

/** The same message whether content doesn't exist or isn't shared with this viewer. */
export default function TeachingNotFound() {
  return (
    <div className="max-w-xl">
      <h1 className="font-display text-2xl font-semibold">We couldn&apos;t find that</h1>
      <p className="mt-2 text-text-secondary">It may have been archived or expired, or it may be shared only with members or a group.</p>
      <Link href="/media" className="mt-4 inline-block font-semibold text-primary underline-offset-2 hover:underline">
        Browse teaching and media
      </Link>
    </div>
  );
}
