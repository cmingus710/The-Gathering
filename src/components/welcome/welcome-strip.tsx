import type { CSSProperties } from "react";

/** Supplied icon artwork, served from public/brand/welcome/. */
const ITEMS = [
  { icon: "/brand/welcome/gather-with-us.svg", title: "Gather with us", text: "Come as you are." },
  { icon: "/brand/welcome/grow-in-faith.svg", title: "Grow in faith", text: "Learn, reflect, and grow together." },
  { icon: "/brand/welcome/share-life.svg", title: "Share life", text: "Find connection and community." },
] as const;

/**
 * Three informational columns under the hero (not links). The icons are
 * decorative, so screen readers hear each heading once.
 */
export function WelcomeStrip() {
  return (
    <section aria-label="Life together">
      <ul className="mx-auto grid max-w-[100rem] px-5 sm:px-8 md:grid-cols-3 md:py-7 lg:px-14">
        {ITEMS.map((item, i) => (
          <li
            key={item.title}
            className={
              "flex flex-col items-center px-4 py-9 text-center md:px-6 md:py-1 " +
              (i > 0 ? "border-t border-(--welcome-rule) md:border-t-0 md:border-l md:border-(--welcome-gold)/70" : "")
            }
          >
            <span aria-hidden="true" className="welcome-icon block size-20 lg:size-24" style={{ "--welcome-icon": `url("${item.icon}")` } as CSSProperties} />
            <h2 className="mt-4 font-display text-[1.75rem] leading-tight font-semibold tracking-[-0.01em] text-text md:text-[1.5rem] lg:mt-3 lg:text-[2.25rem]">{item.title}</h2>
            <p className="mt-1 font-display text-[1.125rem] text-text lg:text-[1.25rem]">{item.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
