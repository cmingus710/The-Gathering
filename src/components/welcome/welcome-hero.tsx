import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import barnPhoto from "../../../assets/photos/barn-welcome-wide.webp";

const button =
  "inline-flex min-h-13 items-center justify-center gap-2 rounded-md px-6 py-3 text-[1.0625rem] leading-tight font-semibold " +
  "transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98] motion-reduce:active:scale-100";

/**
 * Full-width barn image with the welcome message. The photograph is an
 * illustrative, generated image (decorative, empty alt); the readability
 * gradient is CSS, so the source image is never darkened.
 *
 * `description` is the church's own welcome text from Church settings; the
 * built-in lines are shown only when it is blank.
 */
export function WelcomeHero({ churchName, description, signedIn }: { churchName: string; description: string | null; signedIn: boolean }) {
  return (
    <section aria-labelledby="welcome-heading" className="welcome-hero relative isolate overflow-hidden bg-[#1a1611] text-[#f7f4ec]">
      {/* On phones the image box runs past the bottom edge so the circle of chairs sits below the text. */}
      <div className="absolute inset-x-0 top-0 -z-10 h-[124%] md:h-full">
        <Image
          src={barnPhoto}
          alt=""
          fill
          sizes="100vw"
          placeholder="blur"
          loading="eager"
          fetchPriority="high"
          className="object-cover object-[84%_50%] md:object-[88%_55%] lg:object-[70%_60%]"
        />
      </div>
      <div aria-hidden="true" className="welcome-hero-scrim absolute inset-0 -z-10" />

      <div className="mx-auto flex max-w-6xl flex-col justify-center px-5 pt-12 pb-60 [text-shadow:0_1px_12px_rgb(26_22_17/0.45)] sm:px-8 md:min-h-[clamp(36rem,74svh,42.5rem)] md:py-20">
        <div className="max-w-[34rem]">
          <p className="text-eyebrow font-semibold tracking-[0.2em] text-(--welcome-gold) uppercase sm:text-meta">Welcome to {churchName}</p>
          <span aria-hidden="true" className="mt-4 block h-px w-14 bg-(--welcome-gold)" />
          <h1 id="welcome-heading" className="mt-5 font-display text-[2.5rem] leading-[1.08] font-medium sm:text-[3.25rem] lg:text-[4rem]">
            A place to gather.
            <br /> A place to belong.
          </h1>
          {description ? (
            <p className="mt-6 max-w-[30rem] text-[1.125rem] leading-relaxed whitespace-pre-line text-[#f7f4ec]/95 sm:text-[1.25rem]">
              {description}
            </p>
          ) : (
            <p className="mt-6 text-[1.125rem] leading-relaxed text-[#f7f4ec]/95 sm:text-[1.25rem]">
              Growing in faith. Sharing life.
              <br /> Following Jesus together.
            </p>
          )}

          <div className="mt-9 flex flex-col gap-3 [text-shadow:none] sm:flex-row sm:flex-wrap">
            {signedIn ? (
              <Link href="/home" className={`${button} welcome-gold-button`}>
                Open the app
                <ArrowRight className="size-4.5" aria-hidden="true" />
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className={`${button} welcome-gold-button`}>
                  Sign in
                  <ArrowRight className="size-4.5" aria-hidden="true" />
                </Link>
                <Link href="/sign-up" className={`${button} welcome-ghost-button`}>
                  Create an account
                </Link>
              </>
            )}
          </div>

          <p className="mt-8 flex items-center gap-3 font-display text-[1.0625rem] text-[#f7f4ec]/90 italic">
            <span aria-hidden="true" className="h-px w-8 bg-(--welcome-gold)" />
            We&rsquo;re glad you&rsquo;re here.
          </p>
        </div>
      </div>
    </section>
  );
}
