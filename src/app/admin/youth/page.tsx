import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { CAPABILITIES, type Capability } from "@/lib/auth/capabilities";
import { YOUTH_ADMIN_CAPS } from "@/lib/youth/admin";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Youth & families" };


const SECTIONS: Array<{ href: string; label: string; description: string; caps: Capability[] }> = [
  { href: "/admin/youth/policy", label: "Policy", description: "Versioned church policy: what's allowed for youth accounts, discussions, sharing, and consent.", caps: [CAPABILITIES.youthPolicy] },
  { href: "/admin/youth/families", label: "Families and guardians", description: "Guardian requests, verification, child profiles, restrictions, youth accounts, adult transition.", caps: [CAPABILITIES.familyVerify] },
  { href: "/admin/youth/groups", label: "Youth groups", description: "Groups, leader assignments, enrollment.", caps: [CAPABILITIES.youthManage, CAPABILITIES.youthEnroll, CAPABILITIES.youthPublish] },
  { href: "/admin/youth/forms", label: "Permission forms", description: "Versioned forms and what changed.", caps: [CAPABILITIES.youthForms] },
  { href: "/admin/youth/events", label: "Youth events", description: "Make events youth-only, require forms, collect logistics, designate personnel, attendee lists.", caps: [CAPABILITIES.youthForms, CAPABILITIES.youthManage] },
  { href: "/admin/youth/media", label: "Photo consent", description: "Associate photos with children, consent reviews, known copies.", caps: [CAPABILITIES.youthMediaConsent] },
  { href: "/admin/youth/reports", label: "Safeguarding reports", description: "Reports about youth discussions, including reports about leaders.", caps: [CAPABILITIES.youthSafeguarding] },
];

export default async function YouthAdminPage() {
  const viewer = await requireAnyCapability(YOUTH_ADMIN_CAPS, "/admin/youth");
  const { data: policy } = await youthRead<{ approved: boolean; version?: number; settings: Record<string, unknown> }>("youth_policy");
  const mine = SECTIONS.filter((s) => s.caps.some((c) => viewer.capabilities.has(c)));
  return (
    <>
      <PageHeader title="Youth & families" description="Each area needs its own role. Leaders work from Youth → Leading and see only their groups." />
      {policy && !policy.approved ? (
        <Alert tone="warning" title="No youth policy is approved yet." className="mb-6">
          Independent youth accounts, youth self-registration for events, supervised discussions, group prayer, progress sharing, public photo consent,
          and adult transition stay off until the church approves a policy that allows them.
        </Alert>
      ) : policy ? (
        <p className="mb-6 flex items-center gap-2 text-text-secondary">
          <Badge tone="success">Policy version {policy.version} approved</Badge>
        </p>
      ) : null}
      <SectionHeading>Your areas</SectionHeading>
      <div className={rowListClass}>
        {mine.map((s) => (
          <ListRow key={s.href} plain href={s.href} label={s.label} description={s.description} />
        ))}
      </div>
    </>
  );
}
