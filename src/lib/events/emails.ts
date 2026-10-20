import { escape, layout } from "@/lib/email/templates";
import { formatWhen, reminderLabel } from "./format";
import { eventPlace } from "./ics";
import type { ClaimedEmail } from "./jobs";

/**
 * Event emails. Rendered at send time from current event data (claimed only
 * after the database rechecks the recipient's access). Never includes other
 * attendees or organizer contact details.
 */
export function renderEventEmail(m: ClaimedEmail, opts: { siteUrl: string; churchName: string; testMode: boolean }) {
  const o = m.occurrence;
  const url = `${opts.siteUrl}/events/${o.id}`;
  const when = formatWhen(o);
  const place = eventPlace(o);
  const byAdmin = m.detail?.by_admin === true;
  const greeting = m.first_name ? `Hello ${m.first_name},` : "Hello,";
  let subject: string;
  let lead: string;
  const extra: string[] = [];

  switch (m.kind) {
    case "rsvp_confirmed":
      subject = `You're registered: ${o.title}`;
      lead = byAdmin ? "An event organizer registered you for this event." : "You're registered for this event.";
      if (o.cancellation_instructions) extra.push(`If your plans change: ${o.cancellation_instructions}`);
      extra.push("You can cancel your registration on the event page.");
      break;
    case "waitlisted":
      subject = `You're on the waitlist: ${o.title}`;
      lead = `This event is full, so you're on the waitlist${o.my_position ? ` (number ${o.my_position})` : ""}.`;
      extra.push("If a place opens, you'll be registered automatically and we'll email you. You can leave the waitlist on the event page.");
      break;
    case "promoted":
      subject = `A place opened up: ${o.title}`;
      lead = "Good news: a place opened up and you're now registered. Your place is confirmed; there's nothing else to do.";
      extra.push("If you can no longer attend, please cancel on the event page so someone else can have the place.");
      break;
    case "rsvp_canceled":
      subject = `Registration canceled: ${o.title}`;
      lead = byAdmin ? "An event organizer canceled your registration for this event." : "Your registration for this event has been canceled.";
      break;
    case "changed": {
      const fields = Array.isArray(m.detail?.fields) ? (m.detail.fields as string[]) : [];
      subject = fields.includes("restored") ? `Back on: ${o.title}` : `Updated: ${o.title}`;
      lead = fields.includes("restored")
        ? "This date is going ahead after all. Your registration is still in place."
        : `The ${fields.includes("time") && fields.includes("place") ? "date, time, and place" : fields.includes("time") ? "date or time" : "place"} of this event changed. Please check the details below.`;
      break;
    }
    case "occurrence_canceled":
    case "event_canceled":
      subject = `Canceled: ${o.title}`;
      lead = `This event has been canceled${o.cancel_reason ? `: ${o.cancel_reason}` : "."}`;
      break;
    case "reminder":
      subject = `Reminder: ${o.title}`;
      lead = `A reminder about your event (${reminderLabel(Number(m.detail?.minutes ?? 0)).replace(" before", " away")}).`;
      extra.push("You can turn off optional reminders on the Events page under Calendar & reminders.");
      break;
    default:
      subject = o.title;
      lead = "";
  }
  if (opts.testMode) subject = `[TEST] ${subject}`;

  const detailLines = [`What: ${o.title}`, `When: ${when}`, place ? `Where: ${place}` : "", o.online_url ? `Online: ${o.online_url}` : "", o.note ? `Note: ${o.note}` : ""].filter(Boolean);
  const text = [
    opts.testMode ? "[TEST MESSAGE: sent from a test environment]" : "",
    greeting,
    lead,
    detailLines.join("\n"),
    ...extra,
    `Event details: ${url}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const html = layout(
    opts.churchName,
    `${opts.testMode ? `<p style="background:#FFF4D6;border:1px solid #AD8C53;border-radius:8px;padding:8px 12px;font-size:13px"><strong>Test message</strong>: sent from a test environment.</p>` : ""}
<p>${escape(greeting)}</p><p>${escape(lead)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:15px">
${detailLines.map((l) => { const [k, ...rest] = l.split(": "); return `<tr><td style="padding:2px 12px 2px 0;color:#716B61;vertical-align:top">${escape(k)}</td><td style="padding:2px 0">${escape(rest.join(": "))}</td></tr>`; }).join("\n")}
</table>
${extra.map((e) => `<p>${escape(e)}</p>`).join("\n")}
<p><a href="${escape(url)}" style="display:inline-block;background:#80642F;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">View event</a></p>`,
  );
  return { subject, text, html };
}
