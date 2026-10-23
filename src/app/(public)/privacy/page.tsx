import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getChurchSettings, hasAddress, type ChurchSettings } from "@/lib/settings/queries";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How The Gathering app collects, uses, shares, and protects your information.",
};

/**
 * Public privacy policy. Every statement here describes what the app actually
 * does (see docs/privacy-policy.md for the evidence behind each section);
 * update both together when a feature changes how personal data is handled.
 */
const LAST_UPDATED = "October 21, 2026";

const link = "font-semibold text-primary underline decoration-1 underline-offset-4 hover:decoration-2";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="font-display text-2xl font-semibold">
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-6">{children}</ul>;
}

function Contact({ settings }: { settings: ChurchSettings }) {
  const a = settings.address;
  const lines = hasAddress(settings)
    ? [a.line1, a.line2, [a.city, a.region].filter(Boolean).join(", ") + (a.postalCode ? ` ${a.postalCode}` : ""), a.country].filter(
        (l): l is string => Boolean(l?.trim()),
      )
    : [];
  if (!settings.contactEmail && !settings.contactPhone && !lines.length) {
    return (
      <p>
        Speak with a pastor or church administrator, or, if you have an account, use <strong>Report a problem</strong> in the
        app&apos;s menu and say it&apos;s a privacy request.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {settings.contactEmail ? (
        <li>
          Email:{" "}
          <a className={link} href={`mailto:${settings.contactEmail}`}>
            {settings.contactEmail}
          </a>
        </li>
      ) : null}
      {settings.contactPhone ? (
        <li>
          Phone:{" "}
          <a className={link} href={`tel:${settings.contactPhone.replace(/[^0-9+]/g, "")}`}>
            {settings.contactPhone}
          </a>
        </li>
      ) : null}
      {lines.length ? (
        <li>
          Mail: <span className="whitespace-pre-line">{lines.join("\n")}</span>
        </li>
      ) : null}
    </ul>
  );
}

export default async function PrivacyPage() {
  const { settings } = await getChurchSettings();
  const church = settings.churchName;

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="font-display text-4xl font-semibold">Privacy policy</h1>
      <p className="mt-2 text-text-secondary">Last updated {LAST_UPDATED}</p>
      <p className="mt-6">
        This policy explains how {church} (&ldquo;we&rdquo;, &ldquo;the church&rdquo;) collects, uses, shares, and protects
        information in The Gathering app and website. We collect only what the app needs to serve our church community. We
        don&apos;t sell your information, show advertising, or use analytics or tracking tools.
      </p>

      <Section id="collect" title="What we collect">
        <p>We collect information you give us and a small amount of technical information needed to run the app.</p>
        <List>
          <li>
            <strong>Your account:</strong> your name, email address, and password (stored by our sign-in provider in hashed
            form; we never see it), or the name and email address shared by Google or Apple if you sign in with them.
          </li>
          <li>
            <strong>Your profile and directory listing:</strong> optional details you choose to add, such as a preferred name,
            phone number, a contact email, street address, birthday (month and day only), a short bio, ministry interests,
            household connections, and a profile photo.
          </li>
          <li>
            <strong>What you post and share:</strong> community discussions, replies, reactions, group activity, direct
            messages, prayer and care requests, event registrations, and photos or videos you upload.
          </li>
          <li>
            <strong>Your personal tools:</strong> journal entries, Bible reading progress, bookmarks and highlights,
            scripture-memory practice, and lesson workbook answers.
          </li>
          <li>
            <strong>Giving:</strong> the amount, fund, frequency, date, and your name and email for each gift. Card and bank
            details are entered on Stripe&apos;s secure checkout page and never reach our app.
          </li>
          <li>
            <strong>Notifications:</strong> your notification preferences and, if you turn on push notifications, the
            device&apos;s push address and a label such as &ldquo;iPhone · Safari&rdquo;.
          </li>
          <li>
            <strong>Problem reports:</strong> what you write, the category, and the page you were on (the page path only).
          </li>
          <li>
            <strong>Records that keep the app safe and accountable:</strong> a log of administrative actions (what changed and
            by whom, not the content of your messages, prayers, or notes), and short-lived rate-limit records. Where we use
            your network address to prevent abuse, we store only a one-way scrambled form of it, never the address itself.
          </li>
        </List>
      </Section>

      <Section id="google-apple" title="Signing in with Google or Apple">
        <p>
          If you choose &ldquo;Continue with Google&rdquo; or &ldquo;Continue with Apple&rdquo;, we receive only your name
          (Google only; Apple doesn&apos;t share it on the web, so we ask you for it), your email address, and an account
          identifier. We use these only to create your account, sign you in, and let the church recognize you when reviewing
          your membership. We don&apos;t receive your password, contacts, files, or any other data from those accounts, and
          we don&apos;t use Google or Apple data for advertising or share it with anyone else.
        </p>
        <p>
          If you use Apple&apos;s <strong>Hide My Email</strong>, we store the private relay address Apple gives us, and
          Apple forwards our emails to you. Signing in with a provider never approves your membership: every new account is
          reviewed by a church administrator.
        </p>
        <p>
          You can stop the app&apos;s access at any time: for Google, at{" "}
          <a className={link} href="https://myaccount.google.com/connections" rel="noopener noreferrer">
            myaccount.google.com/connections
          </a>
          ; for Apple, in your Apple Account settings under Sign in with Apple (on iPhone, in the Settings app). Signed-in members can also disconnect a sign-in method
          under Profile → Sign-in methods.
        </p>
      </Section>

      <Section id="use" title="How we use your information">
        <List>
          <li>To create and secure your account and to let administrators review and approve membership.</li>
          <li>To run the features you use: the directory, community, groups, messages, prayer and care, events, giving, media, and your personal tools.</li>
          <li>To send the notifications and emails you&apos;ve chosen, plus essential account emails (such as verifying your email or resetting your password).</li>
          <li>To give you giving records and year-end statements.</li>
          <li>To keep the community safe: moderating reported content, preventing abuse, and fixing problems you report.</li>
        </List>
        <p>Notification emails and phone notifications are worded generally and never include the content of messages, prayers, or youth information.</p>
      </Section>

      <Section id="see" title="Who can see your information">
        <List>
          <li>
            <strong>The member directory</strong> is visible only to signed-in, approved members. Your phone, contact email,
            street address, and birthday stay hidden unless you choose to share them, and you can hide your whole listing.
            Your sign-in email is never shown there.
          </li>
          <li>
            <strong>Journals, reading progress, memory practice, and workbook answers</strong> are visible only to you. Church
            staff and administrators can&apos;t see them in the app.
          </li>
          <li>
            <strong>Direct messages</strong> are visible only to the two people in the conversation. Moderators see a message
            only if someone reports it.
          </li>
          <li>
            <strong>Prayer requests</strong> are shared with the audience you choose (the church, a group, or the prayer and
            care team). If you hide your name, other members see &ldquo;Anonymous&rdquo;; a prayer lead can look up who
            posted only when needed for care or safety, and that lookup is recorded. Care requests are seen only by you and
            the care team.
          </li>
          <li>
            <strong>Giving</strong> is visible to you and to the few people the church gives a finance role.
          </li>
          <li>
            <strong>Administrators</strong> see the account details they need for their role (for example, membership
            administrators see names and emails to review new accounts). Roles are limited: being an administrator
            doesn&apos;t automatically give access to finances, private content, or youth information.
          </li>
        </List>
      </Section>

      <Section id="share" title="Service providers we use">
        <p>We don&apos;t sell or rent your information. We share it only with the service providers that run the app for us, only as needed to provide their service:</p>
        <List>
          <li><strong>Supabase:</strong> database, sign-in, and file storage.</li>
          <li><strong>Vercel:</strong> hosting the app, including standard request logs.</li>
          <li><strong>Resend:</strong> sending email (open and click tracking is turned off).</li>
          <li><strong>Stripe:</strong> processing gifts. Stripe receives your email and gift details, and handles your card or bank details under its own privacy policy.</li>
          <li><strong>Google and Apple:</strong> only if you choose to sign in with them.</li>
          <li><strong>Your browser&apos;s push service</strong> (for example Apple, Google, Mozilla, or Microsoft): only if you turn on phone or browser notifications. It receives a brief, general notice.</li>
          <li>
            <strong>Embedded media:</strong> some sermons, music, and podcasts play through YouTube (privacy-enhanced mode),
            Vimeo, Spotify, or Apple Podcasts. Those services receive information from your browser, under their own
            policies, when their player loads.
          </li>
          <li>
            <strong>API.Bible:</strong> if a Bible translation licensed through API.Bible is shown, its required usage script
            loads on that page. The church&apos;s default translation doesn&apos;t use it.
          </li>
        </List>
        <p>We may also disclose information if required by law or to protect someone&apos;s safety.</p>
      </Section>

      <Section id="cookies" title="Cookies and storage on your device">
        <List>
          <li><strong>Sign-in cookies</strong> keep you signed in and protect sign-in with Google or Apple. Signing out removes them and clears the app&apos;s cached pages from your browser.</li>
          <li><strong>A theme cookie</strong> remembers whether you prefer light or dark mode.</li>
          <li><strong>Small settings on your device</strong> remember your audio playback speed and keep an unsaved workbook answer until it&apos;s saved.</li>
          <li>The installed app stores only the app&apos;s design files for faster loading. It never stores member pages for offline use.</li>
        </List>
        <p>We don&apos;t use advertising or analytics cookies.</p>
      </Section>

      <Section id="keep" title="How long we keep information">
        <p>We keep your account and the information in it while you&apos;re part of the app, and you can delete much of it yourself at any time. Some information is removed automatically:</p>
        <List>
          <li>Direct messages after two years, or as soon as both people delete the conversation.</li>
          <li>Read notifications after 180 days, and email and notification delivery records after 60 days or less.</li>
          <li>Rate-limit records within a few days.</li>
          <li>Prayer and care requests according to the church&apos;s retention settings. You can delete your own requests at any time.</li>
        </List>
        <p>
          Gift records are kept for the church&apos;s financial and tax records, even if an account is deleted. Records of
          administrative actions are kept so changes can be checked later; they don&apos;t contain your posts or messages.
          Copies may remain in backups for a limited time.
        </p>
      </Section>

      <Section id="choices" title="Your choices">
        <List>
          <li>Update your profile and choose what the directory shows under Profile.</li>
          <li>Delete your own posts, prayer requests, journal entries, and other content, and export your journal.</li>
          <li>Choose which notifications you receive, and turn push notifications off on any device.</li>
          <li>Connect or disconnect Google or Apple sign-in under Profile → Sign-in methods.</li>
          <li>
            Ask us for a copy of your information, to correct it, or to delete your account, using the contact details below.
            When an account is deleted, its profile and personal content are removed. Gift records are kept without your
            account attached.
          </li>
        </List>
      </Section>

      <Section id="children" title="Children and youth">
        <p>
          The app is meant for adults. Youth features are available only when the church turns them on under its youth
          policy, and they require a parent or guardian&apos;s authorization, verified by the church. Youth accounts
          can&apos;t use the member directory, direct messages, community, groups, prayer, giving, or the Media gallery. Photos of
          children are shown only with a guardian&apos;s recorded consent. If you believe a child has created an account
          without permission, please contact us and we&apos;ll remove it.
        </p>
      </Section>

      <Section id="security" title="Security">
        <p>
          Access is checked by the database itself, so each person can reach only what their role and your privacy choices
          allow. Files are stored privately and shared through short-lived links, connections are encrypted, and photos have
          location data removed when they&apos;re processed. Messages and journals are protected by these access rules, but
          they aren&apos;t end-to-end encrypted. No system is perfectly secure, so please use a strong password and sign out
          on shared devices.
        </p>
      </Section>

      <Section id="changes" title="Changes to this policy">
        <p>
          If we change how we handle your information, we&apos;ll update this page and the date at the top. We&apos;ll let
          members know in the app before any change that affects how their information is shared.
        </p>
      </Section>

      <Section id="contact" title="Contact us">
        <p>For privacy questions or requests, contact {church}:</p>
        <Contact settings={settings} />
      </Section>
    </article>
  );
}
