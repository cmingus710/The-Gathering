import { SOCIAL_LABEL, SOCIAL_NETWORKS } from "@/lib/settings/schema";
import type { ChurchSettings } from "@/lib/settings/queries";

const footerLink = "inline-flex min-h-11 items-center font-semibold text-text-secondary underline-offset-4 hover:text-text hover:underline";

/** Understated ivory footer with the church's configured public contact links. */
export function WelcomeFooter({ settings }: { settings: ChurchSettings }) {
  const social = SOCIAL_NETWORKS.filter((n) => settings.socialLinks[n]);
  return (
    <footer className="mx-auto w-full max-w-6xl px-5 pb-8 sm:px-8">
      <div aria-hidden="true" className="h-px bg-(--welcome-rule)" />
      <div className="flex flex-col gap-3 pt-6 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
        <p className="font-display text-[1.125rem] font-medium text-text">
          {settings.churchName}
          <span className="ml-2 font-sans text-meta font-normal text-text-secondary">© {new Date().getFullYear()}</span>
        </p>
        <p className="font-display text-[1.0625rem] tracking-[0.06em] text-text-secondary italic">Faith. Community. Connection.</p>
      </div>
      <ul className="mt-3 flex flex-wrap justify-center gap-x-5 text-meta sm:justify-start" aria-label="Contact and links">
        {settings.contactEmail ? (
          <li>
            <a href={`mailto:${settings.contactEmail}`} className={footerLink}>
              Email us
            </a>
          </li>
        ) : null}
        {social.map((n) => (
          <li key={n}>
            <a href={settings.socialLinks[n]} rel="noopener noreferrer" className={footerLink}>
              {SOCIAL_LABEL[n]}
            </a>
          </li>
        ))}
        <li>
          <a href="/install" className={footerLink}>
            Add the app to your Home Screen
          </a>
        </li>
      </ul>
    </footer>
  );
}
