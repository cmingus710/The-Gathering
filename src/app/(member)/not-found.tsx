import Link from "next/link";

export default function MemberNotFound() {
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold">We couldn&apos;t find that page</h1>
      <p className="mt-2 text-text-secondary">It may have been archived, expired, or moved.</p>
      <Link href="/home" className="mt-4 inline-block font-semibold text-primary underline-offset-2 hover:underline">
        Go to Home
      </Link>
    </div>
  );
}
