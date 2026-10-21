import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { YouthForm } from "@/components/youth/youth-form";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Link a child" };

export default async function RequestPage() {
  await requireApprovedMember("/youth/family/request");
  const { data: policy } = await youthRead<{ settings: { birth_date_required: boolean } }>("youth_policy");
  const askBirthDate = policy?.settings.birth_date_required === true;
  return (
    <>
      <PageHeader
        eyebrow="Youth & Families"
        title="Link a child"
        description="Ask the church office to verify that you're a parent, legal guardian, or caregiver. Nothing is shared with you until a family administrator verifies the relationship with you directly."
      />
      <Card>
        <YouthForm op="request" submit="Send request" pendingText="Sending…">
          <SelectField label="This is for" name="kind" defaultValue="new_child">
            <option value="new_child">A child who isn&apos;t set up here yet</option>
            <option value="existing_child">A child the church may already have on record</option>
          </SelectField>
          <TextField label="Child's preferred name" name="child_name" required maxLength={60} autoComplete="off" hint="The name they go by. No email or phone number is needed for a child." />
          <SelectField label="Your relationship" name="relationship" defaultValue="parent">
            <option value="parent">Parent</option>
            <option value="legal_guardian">Legal guardian</option>
            <option value="caregiver">Caregiver</option>
          </SelectField>
          {askBirthDate ? (
            <TextField label="Child's date of birth" name="birth_date" type="date" optional hint="The church's policy uses this only to confirm eligibility. It's never shown in rosters, searches, or notifications." />
          ) : null}
          <TextAreaField
            label="Anything that helps the office recognize the request"
            name="details"
            optional
            maxLength={500}
            rows={3}
            hint="For example, which group or event your child joins. Please don't include documents, custody details, or medical information."
          />
          <p className="text-meta text-text-secondary">
            You&apos;ll see this request as &quot;Waiting for review&quot; until the office finishes. You won&apos;t be told whether the church already has a record for a child.
          </p>
        </YouthForm>
      </Card>
    </>
  );
}
