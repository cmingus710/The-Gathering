import Image from "next/image";
import Link from "next/link";
import { FullLogo } from "@/components/brand/logo";
import barnPhoto from "../../../assets/photos/barn-circle-of-chairs.webp";

/**
 * The barn photograph beside (desktop) or above (mobile) the sign-in panel.
 * On phones it is a compact header so the form stays close to the top.
 */
export function AuthHero({ churchName, logoUrl }: { churchName: string; logoUrl: string }) {
  return (
    <header className="relative isolate h-60 overflow-hidden bg-plum text-warm-ivory sm:h-80 lg:sticky lg:top-0 lg:h-dvh lg:self-start">
      <Image
        src={barnPhoto}
        alt=""
        fill
        sizes="(min-width: 64rem) 60vw, 100vw"
        placeholder="blur"
        loading="eager"
        fetchPriority="high"
        className="-z-10 object-cover object-[50%_66%] lg:object-[42%_60%]"
      />
      <div aria-hidden="true" className="auth-hero-scrim absolute inset-0 -z-10" />

      <div className="flex h-full flex-col px-5 pt-4 pb-9 [text-shadow:0_1px_14px_rgb(28_20_29/0.45)] sm:px-8 sm:pt-6 lg:px-14 lg:py-12 xl:px-20">
        {/* The logo keeps its original colours on a small ivory plaque; its charcoal would vanish on the photograph. */}
        <Link
          href="/"
          aria-label={`${churchName} home`}
          className="self-start rounded-lg bg-warm-ivory/95 p-2 shadow-[0_6px_24px_rgb(28_20_29/0.28)] ring-1 ring-antique-gold/60 sm:p-2.5 lg:p-3"
        >
          <FullLogo src={logoUrl} alt={churchName} className="w-14 sm:w-[4.5rem] lg:w-20 xl:w-24" priority />
        </Link>

        <div className="mt-auto lg:mt-[clamp(3rem,15vh,9rem)]">
          <p className="font-serif text-[2rem] leading-[1.1] font-medium sm:text-5xl lg:text-6xl xl:text-7xl">A place to belong.</p>
          <span aria-hidden="true" className="mt-3 block h-0.5 w-20 bg-antique-gold sm:mt-4 lg:mt-7 lg:w-52" />
          <p className="mt-3 font-serif text-meta tracking-[0.06em] text-warm-ivory/95 sm:text-lg sm:tracking-[0.16em] lg:mt-6 lg:text-xl lg:tracking-[0.2em]">
            Grow in faith. Find community. Share life.
          </p>
        </div>

        <p className="mt-auto hidden font-serif text-lg tracking-[0.2em] lg:block">
          Welcome home.
          <span aria-hidden="true" className="mt-2 block h-0.5 w-14 bg-antique-gold" />
        </p>
      </div>
    </header>
  );
}
