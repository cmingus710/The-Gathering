import { SOCIAL_LABEL, SOCIAL_NETWORKS } from "@/lib/settings/schema";
import type { ChurchSettings } from "@/lib/settings/queries";

const footerLink = "inline-flex min-h-11 items-center font-semibold text-text-secondary underline-offset-4 hover:text-text hover:underline";

/** Understated ivory footer with the church's configured public contact links. */
export function WelcomeFooter({ settings }: { settings: ChurchSettings }) {
  const social = SOCIAL_NETWORKS.filter((n) => settings.socialLinks[n]);
  return (
    <footer className="mx-auto w-full max-w-[100rem] px-5 pb-8 sm:px-8 lg:px-14">
      <div aria-hidden="true" className="h-px bg-(--welcome-gold)/70" />
      <div className="flex flex-col gap-3 pt-6 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
        <p className="font-display text-[1.25rem] text-text">{settings.churchName}</p>
        <p className="font-display text-meta tracking-[0.14em] text-text">Faith. Community. Connection.</p>
      </div>
      <ul className="mt-2 flex flex-wrap justify-center gap-x-5 text-meta sm:justify-start" aria-label="Contact and links">
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
