"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { canUnlink, classifyOAuthError, identityLinkingEnabled, isOAuthProvider, oauthCallbackUrl, resolveAuthOrigin } from "@/lib/auth/oauth";
import { getOfferedProviders } from "@/lib/auth/oauth-config";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { requireClient } from "@/lib/supabase/server";
import { loadIdentities } from "./identities";

const PAGE = "/profile/sign-in-methods";

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params)}`);
}

/**
 * Connects Google or Apple to the signed-in member with Supabase's manual
 * identity linking (OAuth, PKCE). The provider identity joins this account;
 * no profile is created or merged. If that provider account already belongs
 * to another member, Supabase refuses and the callback explains.
 */
export async function linkProviderAction(formData: FormData) {
  await requireApprovedMember(PAGE);
  const provider = formData.get("provider");
  if (!isOAuthProvider(provider)) back({ oauth_error: "failed" });
  if (!identityLinkingEnabled() || !(await getOfferedProviders()).includes(provider)) {
    back({ oauth_error: "linking_disabled", provider });
  }
  const supabase = await requireClient();
  const origin = resolveAuthOrigin((await headers()).get("origin"));
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo: oauthCallbackUrl(origin, "link", "/home", provider), skipBrowserRedirect: true },
  });
  if (error || !data.url) back({ oauth_error: classifyOAuthError({ code: error?.code, description: error?.message }), provider });
  redirect(data.url);
}

/**
 * Disconnects Google or Apple, but only when the member keeps a sign-in
 * method they can use (their password, or another provider still offered).
 * Re-checked here on the server; Supabase also refuses to remove the last one.
 */
export async function unlinkProviderAction(formData: FormData) {
  await requireApprovedMember(PAGE);
  const provider = formData.get("provider");
  if (!isOAuthProvider(provider) || !identityLinkingEnabled()) back({ oauth_error: "linking_disabled" });
  const supabase = await requireClient();
  const [identities, offered] = await Promise.all([loadIdentities(supabase), getOfferedProviders()]);
  if (!identities) back({ oauth_error: "failed", provider });
  const identity = identities.raw.find((i) => i.provider === provider);
  if (!identity || !canUnlink(identities.summary, provider, offered)) back({ unlink_blocked: provider });
  const { error } = await supabase.auth.unlinkIdentity(identity);
  if (error) back({ unlink_blocked: provider });
  // Pick up the change in the session's provider list.
  await supabase.auth.refreshSession();
  back({ unlinked: provider });
}
