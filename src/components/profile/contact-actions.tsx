import { Mail, MapPinned, MessageSquareText, Navigation, Phone } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { mailtoHref, mapLinks, smsHref, telHref } from "@/lib/directory/format";

const action =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border-strong/50 bg-surface px-3.5 text-meta font-semibold text-text transition-colors hover:bg-surface-muted";

function Action({ href, icon, children, label, external }: { href: string; icon: ReactNode; children: ReactNode; label: string; external?: boolean }) {
  return (
    <a href={href} className={action} aria-label={label} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {icon}
      <span aria-hidden="true">{children}</span>
    </a>
  );
}

/**
 * Contact actions for values the viewer is already allowed to see. Callers
 * pass only fields that came back from the privacy-filtered query (hidden
 * fields arrive as null), so nothing hidden can reach an href or a label.
 * Values that can't be turned into a safe link render no action.
 */
export function PhoneActions({ phone, name, className }: { phone: string; name: string; className?: string }) {
  const tel = telHref(phone);
  const sms = smsHref(phone);
  if (!tel && !sms) return null;
  return (
    <div className={cn("mt-1 flex flex-wrap gap-2", className)}>
      {tel ? <Action href={tel} icon={<Phone className="size-4" aria-hidden="true" />} label={`Call ${name}`}>Call</Action> : null}
      {sms ? <Action href={sms} icon={<MessageSquareText className="size-4" aria-hidden="true" />} label={`Text ${name}`}>Text</Action> : null}
    </div>
  );
}

export function EmailAction({ email, name, className }: { email: string; name: string; className?: string }) {
  const mailto = mailtoHref(email);
  if (!mailto) return null;
  return (
    <div className={cn("mt-1 flex flex-wrap gap-2", className)}>
      <Action href={mailto} icon={<Mail className="size-4" aria-hidden="true" />} label={`Email ${name}`}>Email</Action>
    </div>
  );
}

export function AddressActions({ query, name, className }: { query: string | null; name: string; className?: string }) {
  const links = mapLinks(query);
  if (!links) return null;
  return (
    <div className={cn("mt-1 flex flex-wrap gap-2", className)}>
      <Action href={links.map} external icon={<MapPinned className="size-4" aria-hidden="true" />} label={`Show ${name}'s address on a map (opens Google Maps)`}>
        Map
      </Action>
      <Action href={links.directions} external icon={<Navigation className="size-4" aria-hidden="true" />} label={`Directions to ${name}'s address (opens Google Maps)`}>
        Directions
      </Action>
      <Action href={links.apple} external icon={<Navigation className="size-4" aria-hidden="true" />} label={`Directions to ${name}'s address in Apple Maps`}>
        Apple Maps
      </Action>
    </div>
  );
}
