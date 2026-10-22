import { BookOpen, ExternalLink, Headphones } from "lucide-react";

/**
 * "Listen in Audible" / "Read in Kindle" (Phase 13). Plain HTTPS links that
 * open Audible or Amazon in a new tab; on phones with the Kindle or Audible
 * app installed, the operating system may offer to open the app instead.
 * Nothing is embedded, no sign-in happens inside this app, and no book text
 * or audio passes through it. See docs/phase-13/reading-kindle-audible.md.
 * Only configured links are shown (both are validated when saved).
 */
export function BookAccess({ kindleUrl, audibleUrl }: { kindleUrl: string | null; audibleUrl: string | null }) {
  if (!kindleUrl && !audibleUrl) return null;
  const button = "inline-flex min-h-12 items-center gap-2 rounded-full px-5 font-semibold";
  const providers = kindleUrl && audibleUrl ? "Audible and Amazon" : kindleUrl ? "Amazon" : "Audible";
  return (
    <section aria-labelledby="book-access-heading" className="rounded-card border border-border bg-surface p-4 sm:p-5">
      <h2 id="book-access-heading" className="font-semibold">
        Read or listen
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {audibleUrl ? (
          <a href={audibleUrl} target="_blank" rel="noopener noreferrer" className={`${button} bg-cta text-on-cta hover:bg-cta-hover`}>
            <Headphones className="size-5" aria-hidden="true" />
            Listen in Audible <ExternalLink className="size-4" aria-hidden="true" />
            <span className="sr-only">(opens Audible in a new tab)</span>
          </a>
        ) : null}
        {kindleUrl ? (
          <a
            href={kindleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${button} ${audibleUrl ? "border border-border-strong/60 bg-surface text-text hover:bg-surface-muted" : "bg-cta text-on-cta hover:bg-cta-hover"}`}
          >
            <BookOpen className="size-5" aria-hidden="true" />
            Read in Kindle <ExternalLink className="size-4" aria-hidden="true" />
            <span className="sr-only">(opens Amazon in a new tab)</span>
          </a>
        ) : null}
      </div>
      <p className="mt-2 text-meta text-text-secondary">Opens {providers} with your own account.</p>
      <details className="mt-1 text-meta text-text-secondary">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-primary">How these links work</summary>
        <p className="mt-1 max-w-[65ch]">
          You sign in to {providers} yourself and need your own access to the book (a purchase, a credit, a subscription such as Kindle Unlimited, or a loan); the
          church&apos;s copy doesn&apos;t give you access. The book isn&apos;t read or played inside The Gathering, and your place in {kindleUrl && audibleUrl ? "Kindle or Audible" : kindleUrl ? "Kindle" : "Audible"}{" "}
          isn&apos;t shared with this app. Record your place below if you&apos;d like to.
        </p>
      </details>
    </section>
  );
}
