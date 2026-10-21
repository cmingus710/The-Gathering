import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { canAccessAdmin, isCapability, type AccountKind, type Capability, type MembershipStatus } from "./capabilities";

export type Viewer = {
  id: string;
  email: string;
  fullName: string;
  preferredName: string | null;
  phone: string | null;
  status: MembershipStatus;
  /** "youth" for an independent youth account (Phase 10); everything else is "adult". */
  accountKind: AccountKind;
  capabilities: ReadonlySet<Capability>;
  isAdmin: boolean;
};

export type ViewerResult =
  | { state: "unconfigured" }
  | { state: "signed-out" }
  | { state: "error"; message: string }
  | { state: "signed-in"; viewer: Viewer };

/**
 * Loads the signed-in user, their profile, and their capabilities once per
 * request. The user is verified with the Auth server (getUser), and profile
 * and capabilities are read through RLS, so the database decides.
 */
export const getViewer = cache(async (): Promise<ViewerResult> => {
  const supabase = await createClient();
  if (!supabase) return { state: "unconfigured" };

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    const status = (userError as { status?: number } | null)?.status ?? 401;
    if (userError && status >= 500) return { state: "error", message: "We couldn't reach the sign-in service." };
    return { state: "signed-out" };
  }

  const [{ data: profile, error: profileError }, { data: caps, error: capsError }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, preferred_name, phone, membership_status, account_kind")
      .eq("id", userData.user.id)
      .maybeSingle(),
    supabase.rpc("my_capabilities"),
  ]);

  if (profileError || capsError) {
    return { state: "error", message: "We couldn't load your account right now." };
  }
  if (!profile) {
    return { state: "error", message: "Your member profile is missing. Please contact the church office." };
  }

  const capabilities = new Set<Capability>(
    ((caps as string[] | null) ?? []).filter((c): c is Capability => isCapability(c)),
  );
  return {
    state: "signed-in",
    viewer: {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      preferredName: profile.preferred_name,
      phone: profile.phone,
      status: profile.membership_status as MembershipStatus,
      accountKind: profile.account_kind === "youth" ? "youth" : "adult",
      capabilities,
      // The database grants youth accounts no capabilities; this keeps the UI consistent.
      isAdmin: profile.membership_status === "approved" && profile.account_kind !== "youth" && canAccessAdmin(capabilities),
    },
  };
});

/** Any signed-in account (pending/suspended included). */
export async function requireSignedIn(next = "/home"): Promise<Viewer> {
  const result = await getViewer();
  if (result.state === "signed-in") return result.viewer;
  if (result.state === "signed-out") redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  redirect(`/service-unavailable`);
}

/**
 * Approved adult members only. Pending and suspended accounts go to the
 * status page; youth accounts go to the Youth area (every adult-only check in
 * the database refuses them too).
 */
export async function requireApprovedMember(next = "/home"): Promise<Viewer> {
  const viewer = await requireSignedIn(next);
  if (viewer.status !== "approved") redirect("/account-status");
  if (viewer.accountKind === "youth") redirect("/youth");
  return viewer;
}

/**
 * Approved adults and approved youth accounts: the shared learning tools
 * (Bible reading, journals, memory verses), whose data is owner-only. The
 * database decides whether a youth account is currently active.
 */
export async function requireLearner(next = "/home"): Promise<Viewer> {
  const viewer = await requireSignedIn(next);
  if (viewer.status !== "approved") redirect("/account-status");
  return viewer;
}

/** The Youth area: approved adults and approved youth accounts. */
export const requireYouthArea = requireLearner;

/** Approved members holding a specific capability; everyone else is turned away. */
export async function requireCapability(capability: Capability, next = "/admin"): Promise<Viewer> {
  const viewer = await requireApprovedMember(next);
  if (!viewer.capabilities.has(capability)) redirect("/admin/not-authorized");
  return viewer;
}

/** Approved members holding at least one of these capabilities. */
export async function requireAnyCapability(capabilities: Capability[], next = "/admin"): Promise<Viewer> {
  const viewer = await requireApprovedMember(next);
  if (!capabilities.some((c) => viewer.capabilities.has(c))) redirect("/admin/not-authorized");
  return viewer;
}

export async function requireAdminArea(next = "/admin"): Promise<Viewer> {
  const viewer = await requireApprovedMember(next);
  if (!viewer.isAdmin) redirect("/home?notice=not-authorized");
  return viewer;
}

export function displayName(viewer: Pick<Viewer, "preferredName" | "fullName" | "email">): string {
  return viewer.preferredName?.trim() || viewer.fullName.trim() || viewer.email;
}
