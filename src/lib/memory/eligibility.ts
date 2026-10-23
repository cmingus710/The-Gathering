import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiBibleBase } from "@/lib/bible/api-bible";
import type { Translation } from "@/lib/bible/types";
import type { Activity } from "./types";

/**
 * Which Bible versions can be used for memory verses: one rule for the
 * administrator's collection selector, members' own-version choices, and
 * every other memory selector (migration 20261111000100).
 *
 *   - published versions with their text stored here: always;
 *   - published licensed (API.Bible) versions: only when a Bible source
 *     manager recorded that the version's terms allow memory use (the
 *     database decides, memory.translation_eligibility) AND this server has
 *     the version's API key setting, so its text can actually be fetched;
 *   - drafts and retired versions: never listed.
 *
 * Ineligible published versions are shown disabled with the reason, never
 * silently left out.
 */
export type IneligibleReason = "not_published" | "not_confirmed" | "not_configured";

/** One row of public.memory_translation_options. */
export type MemoryOption = Translation & {
  memory_modes: Activity[];
  memory_eligible: boolean;
  memory_reason: IneligibleReason | null;
  credential_env: string | null;
};

export type Eligibility = { eligible: true; reason: null } | { eligible: false; reason: IneligibleReason };

/** A version as a memory selector shows it. */
export type VersionChoice = {
  id: string;
  code: string;
  name: string;
  licensed: boolean;
  modes: Activity[];
  eligible: boolean;
  reason: IneligibleReason | null;
  /** Why it can't be chosen (null when it can). */
  note: string | null;
};

type Env = Record<string, string | undefined>;

/** The provider key's server setting is present and the API address is an API.Bible host. */
export function providerAccessConfigured(credentialEnv: string | null | undefined, env: Env = process.env): boolean {
  if (!credentialEnv || !/^[A-Z][A-Z0-9_]{2,63}$/.test(credentialEnv)) return false;
  return Boolean(env[credentialEnv]) && apiBibleBase(env.API_BIBLE_BASE_URL) !== null;
}

export function memoryEligibility(t: Pick<MemoryOption, "source_kind" | "memory_eligible" | "memory_reason" | "credential_env">, env: Env = process.env): Eligibility {
  if (!t.memory_eligible) return { eligible: false, reason: t.memory_reason ?? "not_confirmed" };
  if (t.source_kind === "api" && !providerAccessConfigured(t.credential_env, env)) return { eligible: false, reason: "not_configured" };
  return { eligible: true, reason: null };
}

export function ineligibleNote(code: string, reason: IneligibleReason): string {
  switch (reason) {
    case "not_confirmed":
      return `${code} isn't confirmed for memory verses. A Bible source manager records that its terms allow it first.`;
    case "not_configured":
      return `${code} isn't connected to API.Bible on this server, so its text can't be fetched.`;
    default:
      return `${code} isn't published.`;
  }
}

export function versionChoices(options: MemoryOption[], env: Env = process.env): VersionChoice[] {
  return options.map((t) => {
    const e = memoryEligibility(t, env);
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      licensed: t.source_kind === "api",
      modes: t.memory_modes,
      eligible: e.eligible,
      reason: e.reason,
      note: e.eligible ? null : ineligibleNote(t.code, e.reason),
    };
  });
}

export async function loadMemoryOptions(supabase: SupabaseClient): Promise<MemoryOption[]> {
  const { data } = await supabase.rpc("memory_translation_options");
  return (data as MemoryOption[] | null) ?? [];
}

/** Whether memory practice in this version is available now; null when it is, else why not. */
export function unavailableNote(options: MemoryOption[], translationId: string, code: string, env: Env = process.env): string | null {
  const t = options.find((o) => o.id === translationId);
  if (!t) return `${code} isn't published, so it can't be practiced.`;
  const e = memoryEligibility(t, env);
  return e.eligible ? null : ineligibleNote(code, e.reason);
}
