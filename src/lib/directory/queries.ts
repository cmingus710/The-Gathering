import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signPhotoUrls } from "@/lib/profile/photos";
import { DIRECTORY_PAGE_SIZE } from "./format";

/**
 * The directory is read only through the directory_* database functions.
 * They return just the fields each member shares, so nothing hidden ever
 * reaches this server code, let alone the browser.
 */
export type DirectoryCard = {
  id: string;
  displayName: string;
  fullName: string | null;
  photoUrl: string | null;
  city: string | null;
  stateRegion: string | null;
};

export type DirectoryProfile = DirectoryCard & {
  contactEmail: string | null;
  phone: string | null;
  streetAddress: string | null;
  postalCode: string | null;
  birthdayMonth: number | null;
  birthdayDay: number | null;
  bio: string | null;
  ministryInterests: string[] | null;
  householdName: string | null;
  householdMembers: Array<{ id: string; display_name: string }> | null;
};

type SearchRow = {
  id: string;
  display_name: string;
  full_name: string | null;
  photo_path: string | null;
  city: string | null;
  state_region: string | null;
  total_count: number | string;
};

export class DirectoryError extends Error {}

export async function searchDirectory(
  supabase: SupabaseClient,
  { query, page, pageSize = DIRECTORY_PAGE_SIZE }: { query: string; page: number; pageSize?: number },
): Promise<{ members: DirectoryCard[]; total: number }> {
  const { data, error } = await supabase.rpc("directory_search", {
    p_query: query || null,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) throw new DirectoryError("The directory couldn't be loaded.");
  const rows = (data ?? []) as SearchRow[];
  const urls = await signPhotoUrls(supabase, rows.map((r) => r.photo_path));
  return {
    total: rows.length ? Number(rows[0].total_count) : 0,
    members: rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      fullName: r.full_name,
      photoUrl: r.photo_path ? (urls.get(r.photo_path) ?? null) : null,
      city: r.city,
      stateRegion: r.state_region,
    })),
  };
}

export async function getDirectoryMember(supabase: SupabaseClient, id: string): Promise<DirectoryProfile | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await supabase.rpc("directory_member", { p_id: id });
  if (error) throw new DirectoryError("This profile couldn't be loaded.");
  const row = ((data ?? []) as Array<Record<string, unknown>>)[0];
  if (!row) return null;
  const photoPath = (row.photo_path as string | null) ?? null;
  const urls = await signPhotoUrls(supabase, [photoPath]);
  return {
    id: row.id as string,
    displayName: row.display_name as string,
    fullName: (row.full_name as string | null) ?? null,
    photoUrl: photoPath ? (urls.get(photoPath) ?? null) : null,
    city: (row.city as string | null) ?? null,
    stateRegion: (row.state_region as string | null) ?? null,
    contactEmail: (row.contact_email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    streetAddress: (row.street_address as string | null) ?? null,
    postalCode: (row.postal_code as string | null) ?? null,
    birthdayMonth: (row.birthday_month as number | null) ?? null,
    birthdayDay: (row.birthday_day as number | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    ministryInterests: (row.ministry_interests as string[] | null) ?? null,
    householdName: (row.household_name as string | null) ?? null,
    householdMembers: (row.household_members as DirectoryProfile["householdMembers"]) ?? null,
  };
}
