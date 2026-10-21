import { CheckboxField } from "@/components/ui/field";
import { PERMISSIONS, type Permissions } from "@/lib/youth/format";

/**
 * Per-child, per-capability guardian permissions. Every box starts unchecked
 * for a new guardian: the family administrator chooses each one.
 */
export function PermissionFields({ current, idPrefix }: { current?: Permissions; idPrefix: string }) {
  return (
    <fieldset className="space-y-3">
      <legend className="font-semibold">What this guardian may do for this child</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {PERMISSIONS.map((p) => (
          <CheckboxField key={p.key} id={`${idPrefix}-${p.key}`} name={`perm_${p.key}`} label={p.label} hint={p.hint} defaultChecked={current?.[p.key] ?? false} />
        ))}
      </div>
    </fieldset>
  );
}
