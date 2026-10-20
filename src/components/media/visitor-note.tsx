import Link from "next/link";

/** For signed-out visitors on public-capable pages: members see more. */
export function VisitorNote({ next }: { next: string }) {
  return (
    <p className="rounded-tile bg-surface-muted px-4 py-3 text-meta text-text-secondary">
      You&apos;re seeing what the church shares publicly.{" "}
      <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="font-semibold text-primary hover:underline">
        Sign in
      </Link>{" "}
      to see everything available to members.
    </p>
  );
}
