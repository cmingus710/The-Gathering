import { escape, layout } from "@/lib/email/templates";
import type { ClaimedCommunityEmail } from "./jobs";

/**
 * Community notification emails. Items arrive already rechecked and worded
 * by the database: discussion titles only for church-wide threads, group
 * discussions named only by group, and direct messages only as "You have a
 * new message" (no text, no sender). Links point into the app, where access
 * is checked again.
 */
export function renderCommunityEmail(m: ClaimedCommunityEmail, opts: { siteUrl: string; churchName: string; testMode: boolean }) {
  const greeting = m.first_name ? `Hello ${m.first_name},` : "Hello,";
  const items = m.items.map((i) => ({ ...i, href: safeAppUrl(opts.siteUrl, i.url) }));
  const onlyMessages = items.every((i) => i.category === "messages");
  let subject: string;
  let lead: string;
  if (m.kind === "digest") {
    subject = `${m.weekly ? "Your weekly" : "Your daily"} community summary`;
    lead = `Here's what happened in the community${m.weekly ? " this week" : " since your last summary"}.`;
  } else if (onlyMessages) {
    subject = "You have a new message";
    lead = "Someone sent you a direct message. Open the app to read it.";
  } else {
    subject = items[0]?.title ?? "Community update";
    lead = "There's something new for you in the community.";
  }
  if (opts.testMode) subject = `[TEST] ${subject}`;
  const settings = `${opts.siteUrl}/notifications/settings`;

  const text = [
    opts.testMode ? "[TEST MESSAGE: sent from a test environment]" : "",
    greeting,
    lead,
    items.map((i) => `• ${i.title}\n  ${i.href}`).join("\n"),
    `Choose which emails you get: ${settings}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const html = layout(
    opts.churchName,
    `${opts.testMode ? `<p style="background:#FFF4D6;border:1px solid #AD8C53;border-radius:8px;padding:8px 12px;font-size:13px"><strong>Test message</strong>: sent from a test environment.</p>` : ""}
<p>${escape(greeting)}</p><p>${escape(lead)}</p>
<ul style="padding-left:20px;margin:16px 0">
${items.map((i) => `<li style="margin:0 0 8px"><a href="${escape(i.href)}" style="color:#80642F">${escape(i.title)}</a></li>`).join("\n")}
</ul>
<p style="font-size:13px;color:#716B61">You're receiving this because of your notification settings. <a href="${escape(settings)}" style="color:#80642F">Change what you receive</a>.</p>`,
  );
  return { subject, text, html };
}

/** Only same-site paths become links; anything else falls back to the app. */
export function safeAppUrl(siteUrl: string, path: string): string {
  return /^\/[A-Za-z0-9/_-]*$/.test(path) && !path.startsWith("//") ? `${siteUrl}${path}` : `${siteUrl}/notifications`;
}
