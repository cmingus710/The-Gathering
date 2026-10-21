import "server-only";
import type { SupabaseClient, UserIdentity } from "@supabase/supabase-js";
import type { IdentitySummary } from "@/lib/auth/oauth";

/** The signed-in member's sign-in identities, as Supabase Auth reports them. */
export async function loadIdentities(supabase: SupabaseClient): Promise<{ raw: UserIdentity[]; summary: IdentitySummary[] } | null> {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error || !data) return null;
  const raw = data.identities ?? [];
  return {
    raw,
    summary: raw.map((i) => ({
      provider: i.provider,
      identityId: i.identity_id,
      email: typeof i.identity_data?.email === "string" ? i.identity_data.email : null,
    })),
  };
}
