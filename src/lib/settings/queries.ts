import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import type { GatheringTime, SocialNetwork } from "./schema";

export const DEFAULT_LOGO = { src: "/brand/the-gathering-logo.webp", width: 1200, height: 1116 } as const;
export const DEFAULT_ICON = { src: "/brand/gathering-icon.webp", width: 444, height: 512 } as const;

export type ChurchSettings = {
  churchName: string;
  description: string | null;
  logoPath: string | null;
  iconPath: string | null;
  logoUrl: string;
  iconUrl: string;
  contactEmail: string | null;
  contactPhone: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string | null;
  };
  timezone: string;
  gatheringTimes: GatheringTime[];
  socialLinks: Partial<Record<SocialNetwork, string>>;
  updatedAt: string | null;
};

type Row = {
  church_name: string;
  description: string | null;
  logo_path: string | null;
  icon_path: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  timezone: string;
  gathering_times: GatheringTime[] | null;
  social_links: Partial<Record<SocialNetwork, string>> | null;
  updated_at: string | null;
};

/** Used only when the database cannot be reached; shows empty states, never invented details. */
export const FALLBACK_SETTINGS: ChurchSettings = {
  churchName: "The Gathering",
  description: null,
  logoPath: null,
  iconPath: null,
  logoUrl: DEFAULT_LOGO.src,
  iconUrl: DEFAULT_ICON.src,
  contactEmail: null,
  contactPhone: null,
  address: { line1: null, line2: null, city: null, region: null, postalCode: null, country: null },
  timezone: DEFAULT_TIMEZONE,
  gatheringTimes: [],
  socialLinks: {},
  updatedAt: null,
};

export function brandingPublicUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/branding/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export type SettingsResult = { settings: ChurchSettings; available: boolean };

export const getChurchSettings = cache(async (): Promise<SettingsResult> => {
  const supabase = await createClient();
  if (!supabase) return { settings: FALLBACK_SETTINGS, available: false };
  const { data, error } = await supabase.from("church_settings").select("*").maybeSingle<Row>();
  if (error || !data) return { settings: FALLBACK_SETTINGS, available: false };
  return {
    available: true,
    settings: {
      churchName: data.church_name,
      description: data.description,
      logoPath: data.logo_path,
      iconPath: data.icon_path,
      logoUrl: data.logo_path ? brandingPublicUrl(data.logo_path) : DEFAULT_LOGO.src,
      iconUrl: data.icon_path ? brandingPublicUrl(data.icon_path) : DEFAULT_ICON.src,
      contactEmail: data.contact_email,
      contactPhone: data.contact_phone,
      address: {
        line1: data.address_line1,
        line2: data.address_line2,
        city: data.city,
        region: data.region,
        postalCode: data.postal_code,
        country: data.country,
      },
      timezone: data.timezone || DEFAULT_TIMEZONE,
      gatheringTimes: Array.isArray(data.gathering_times) ? data.gathering_times : [],
      socialLinks: data.social_links ?? {},
      updatedAt: data.updated_at,
    },
  };
});

export function hasAddress(s: ChurchSettings): boolean {
  return Boolean(s.address.line1 || s.address.city);
}

/** Settings an administrator should fill in, for the dashboard checklist. */
export function missingSettings(s: ChurchSettings): string[] {
  const missing: string[] = [];
  if (!s.description) missing.push("Church description");
  if (!s.contactEmail) missing.push("Contact email");
  if (!s.contactPhone) missing.push("Contact phone");
  if (!hasAddress(s)) missing.push("Address");
  if (s.gatheringTimes.length === 0) missing.push("Gathering times");
  return missing;
}
