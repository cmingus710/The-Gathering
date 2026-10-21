import type { User } from "@supabase/supabase-js";

const LABELS: Record<string, string> = {
  email: "Email and password",
  google: "Google",
  apple: "Apple",
  azure: "Microsoft",
};

/**
 * Human labels for the sign-in methods linked to this account, read from the
 * verified Supabase user (never from form input). Unknown providers show their
 * own name rather than being hidden.
 */
export function signInMethods(user: Pick<User, "identities" | "app_metadata"> | null): string[] {
  const providers = new Set<string>();
  for (const identity of user?.identities ?? []) if (identity.provider) providers.add(identity.provider);
  for (const p of (user?.app_metadata?.providers as string[] | undefined) ?? []) providers.add(p);
  if (!providers.size) providers.add("email");
  return [...providers].map((p) => LABELS[p] ?? p.charAt(0).toUpperCase() + p.slice(1));
}
