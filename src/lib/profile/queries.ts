import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRIVACY_KEYS, type PrivacySettings } from "./schemas";

export type ProfileDetails = {
  contact_email: string | null;
  street_address: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  bio: string | null;
  birthday_month: number | null;
  birthday_day: number | null;
  photo_path: string | null;
} & PrivacySettings;

export type MinistryInterest = { id: string; label: string; active: boolean; sort_order: number };

export type OwnProfile = {
  firstName: string;
  lastName: string;
  preferredName: string;
  phone: string;
  details: ProfileDetails;
  interests: MinistryInterest[];
  chosenInterestIds: string[];
};

const DETAIL_COLUMNS = [
  "contact_email",
  "street_address",
  "city",
  "state_region",
  "postal_code",
  "bio",
  "birthday_month",
  "birthday_day",
  "photo_path",
  ...PRIVACY_KEYS,
].join(", ");

/** Splits a legacy single "full name" into first and the rest, as a starting suggestion only. */
export function splitFullName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

export async function getProfileDetails(supabase: SupabaseClient, userId: string): Promise<ProfileDetails | null> {
  const { data, error } = await supabase.from("member_profile_details").select(DETAIL_COLUMNS).eq("profile_id", userId).maybeSingle();
  if (error) throw new Error("Profile details could not be loaded.");
  return (data as unknown as ProfileDetails | null) ?? null;
}

/** Everything the member's own profile editor needs, read as the member (RLS applies). */
export async function getOwnProfile(supabase: SupabaseClient, userId: string): Promise<OwnProfile | null> {
  const [profileRes, details, interestsRes, chosenRes] = await Promise.all([
    supabase.from("profiles").select("full_name, first_name, last_name, preferred_name, phone").eq("id", userId).maybeSingle(),
    getProfileDetails(supabase, userId),
    supabase.from("ministry_interests").select("id, label, active, sort_order").eq("active", true).order("sort_order").order("label"),
    supabase.from("member_ministry_interests").select("interest_id").eq("profile_id", userId),
  ]);
  if (profileRes.error || interestsRes.error || chosenRes.error) throw new Error("Your profile could not be loaded.");
  const p = profileRes.data;
  if (!p || !details) return null;
  const split = splitFullName(p.full_name ?? "");
  return {
    firstName: p.first_name ?? split.first,
    lastName: p.last_name ?? (p.first_name ? "" : split.last),
    preferredName: p.preferred_name ?? "",
    phone: p.phone ?? "",
    details,
    interests: (interestsRes.data ?? []) as MinistryInterest[],
    chosenInterestIds: (chosenRes.data ?? []).map((r) => r.interest_id as string),
  };
}

export type HouseholdSummary = {
  id: string;
  display_name: string | null;
  members: Array<{ id: string; display_name: string; is_me: boolean; listed: boolean }>;
  invitations: Array<{ id: string; invitee_id: string; invitee_name: string; expires_at: string }>;
};

export type ReceivedInvitation = { id: string; household_name: string | null; invited_by_name: string; expires_at: string };

export async function getMyHousehold(supabase: SupabaseClient): Promise<HouseholdSummary | null> {
  const { data, error } = await supabase.rpc("my_household");
  if (error) throw new Error("Your household could not be loaded.");
  return (data as HouseholdSummary | null) ?? null;
}

export async function getMyHouseholdInvitations(supabase: SupabaseClient): Promise<ReceivedInvitation[]> {
  const { data, error } = await supabase.rpc("my_household_invitations");
  if (error) throw new Error("Your invitations could not be loaded.");
  return (data ?? []) as ReceivedInvitation[];
}
