import { z } from "zod";

/** Shape returned by every form Server Action to its client form. */
export type FormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Echo of submitted values so the form can re-populate after an error. */
  values?: Record<string, string>;
  /** The saved record's id, for forms that continue on the client after saving. */
  id?: string;
};

export const initialFormState: FormState = { status: "idle" };

export function errorState(message: string, extra: Partial<FormState> = {}): FormState {
  return { status: "error", message, ...extra };
}

/**
 * Field errors keyed both by top-level field ("socialLinks") and by full path
 * ("socialLinks.website"), so nested inputs can show their own message.
 */
export function validationErrorState(error: z.ZodError, values?: Record<string, string>): FormState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const keys = new Set([String(issue.path[0] ?? "_form"), issue.path.map(String).join(".") || "_form"]);
    for (const key of keys) (fieldErrors[key] ??= []).push(issue.message);
  }
  return { status: "error", message: "Please correct the highlighted fields.", fieldErrors, values };
}

/** Plain string values from FormData (files excluded), for re-populating forms. */
export function formValues(formData: FormData, omit: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !omit.includes(key) && !key.startsWith("$ACTION")) out[key] = value;
  }
  return out;
}

/** Optional text input: trims, and turns "" into null. */
export const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);
