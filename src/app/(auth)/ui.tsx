import type { ReactNode } from "react";

/** Links on the ivory panel are always underlined, so they never rely on colour alone. */
export const authLinkClass =
  "font-semibold text-primary underline decoration-1 underline-offset-4 transition-colors hover:text-primary-hover hover:decoration-2";

/** Serif page heading and supporting line for the sign-in panel. */
export function AuthHeading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="text-center">
      <h1 className="font-display text-[2rem] leading-[1.12] font-medium text-primary sm:text-[2.5rem] lg:text-[2.75rem]">
        {title}
      </h1>
      {children ? <p className="mt-3 text-text-secondary">{children}</p> : null}
    </div>
  );
}
