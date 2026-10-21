import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import barnPhoto from "../../../assets/photos/barn-welcome-wide.webp";

const button =
  "inline-flex min-h-14 items-center justify-center gap-2.5 rounded-md px-9 py-3 font-display text-[1.1875rem] leading-tight font-medium " +
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
          className="object-cover object-[84%_50%] md:object-[88%_55%] lg:object-[66%_62%]"
        />
      </div>
      <div aria-hidden="true" className="welcome-hero-scrim absolute inset-0 -z-10" />

      <div className="mx-auto flex max-w-[100rem] flex-col justify-center px-5 pt-12 pb-60 [text-shadow:0_1px_12px_rgb(26_22_17/0.45)] sm:px-8 md:min-h-[clamp(36rem,70svh,40rem)] md:py-18 lg:px-20">
        <div className="max-w-[40rem]">
          <p className="text-eyebrow font-semibold tracking-[0.24em] text-(--welcome-gold) uppercase sm:text-meta">Welcome to {churchName}</p>
          <h1 id="welcome-heading" className="mt-5 font-display text-[2.25rem] leading-[1.05] min-[400px]:text-[2.5rem] font-semibold tracking-[-0.02em] sm:mt-7 sm:text-[3.75rem] lg:text-[4.75rem]">
            A place to gather.
            <br /> A place to belong.
          </h1>
          {description ? (
            <p className="mt-5 max-w-[32rem] font-display text-[1.25rem] leading-snug whitespace-pre-line text-[#f7f4ec] sm:mt-7 sm:text-[1.5rem] lg:text-[1.75rem]">
              {description}
            </p>
          ) : (
            <p className="mt-5 font-display text-[1.25rem] leading-snug text-[#f7f4ec] sm:mt-7 sm:text-[1.5rem] lg:text-[1.75rem]">
              Growing in faith. Sharing life.
              <br /> Following Jesus together.
            </p>
          )}

          <div className="mt-8 flex flex-col gap-3 [text-shadow:none] sm:mt-9 sm:flex-row sm:flex-wrap sm:gap-5">
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

          <p className="mt-7 font-display text-[1.1875rem] text-[#f7f4ec] sm:mt-9 sm:text-[1.375rem]">
            We&rsquo;re glad you&rsquo;re here.
          </p>
        </div>
      </div>
    </section>
  );
}
