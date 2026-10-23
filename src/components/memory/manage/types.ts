import type { MemoryOption } from "@/lib/memory/eligibility";
import type { Collection, Item } from "@/lib/memory/types";

export type ManageBase = "/admin/memory" | "/memory/lead";

export type AdminHome = {
  can_manage: boolean;
  can_publish: boolean;
  led_groups: Array<{ id: string; name: string }>;
  collections: Collection[];
  /** Every published version with its memory eligibility (public.memory_translation_options). */
  translations: MemoryOption[];
  default_translation_id: string | null;
  groups: Array<{ id: string; name: string; visibility: string; authorized: boolean }>;
  church_timezone: string;
};

export type AdminItem = Item & {
  suitability: string[];
  current: boolean;
  in_use: boolean;
  versions: Array<{ reason: string; changed_at: string; from_version: number; to_version: number }>;
};

export type AdminCollection = Collection & {
  can_publish: boolean;
  items: AdminItem[];
  challenges: Array<{ id: string; title: string; status: string; starts_on: string; ends_on: string }>;
  history: Array<{ action: string; at: string; details: Record<string, unknown> }>;
};
