import { BookOpen, ExternalLink, Headphones } from "lucide-react";

/**
 * "Read in Kindle" / "Listen in Audible" (Phase 13). Plain HTTPS links that
 * open Amazon or Audible in a new tab; on phones with the Kindle or Audible
 * app installed, the operating system may offer to open the app instead.
 * Nothing is embedded, no sign-in happens inside this app, and no book text
 * or audio passes through it. See docs/phase-13/reading-kindle-audible.md.
 */
export function BookAccess({ kindleUrl, audibleUrl }: { kindleUrl: string | null; audibleUrl: string | null }) {
  if (!kindleUrl && !audibleUrl) return null;
  const button = "inline-flex min-h-12 items-center gap-2 rounded-full px-5 font-semibold";
  return (
    <section aria-labelledby="book-access-heading" className="rounded-card border border-border bg-surface p-5">
      <h2 id="book-access-heading" className="font-semibold">
        Read or listen
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {kindleUrl ? (
          <a href={kindleUrl} target="_blank" rel="noopener noreferrer" className={`${button} bg-cta text-on-cta hover:bg-cta-hover`}>
            <BookOpen className="size-5" aria-hidden="true" />
            Read in Kindle <ExternalLink className="size-4" aria-hidden="true" />
            <span className="sr-only">(opens Amazon in a new tab)</span>
          </a>
        ) : null}
        {audibleUrl ? (
          <a
            href={audibleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${button} ${kindleUrl ? "border border-border-strong/60 bg-surface text-text hover:bg-surface-muted" : "bg-cta text-on-cta hover:bg-cta-hover"}`}
          >
            <Headphones className="size-5" aria-hidden="true" />
            Listen in Audible <ExternalLink className="size-4" aria-hidden="true" />
            <span className="sr-only">(opens Audible in a new tab)</span>
          </a>
        ) : null}
      </div>
      <p className="mt-3 text-meta text-text-secondary">
        These open {kindleUrl && audibleUrl ? "Amazon and Audible" : kindleUrl ? "Amazon" : "Audible"}, where you sign in with your own account. You need your own
        access to the book (a purchase, a credit, a subscription such as Kindle Unlimited, or a loan); the church&apos;s copy doesn&apos;t give you access.
        The book can&apos;t be read or played inside The Gathering, and your reading or listening isn&apos;t shared with this app.
      </p>
    </section>
  );
}
