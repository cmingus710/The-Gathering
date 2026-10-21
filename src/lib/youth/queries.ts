import "server-only";
import { notFound } from "next/navigation";
import { requireClient } from "@/lib/supabase/server";

/**
 * Reads through a youth_* database function as the signed-in person.
 * "Not found" (P0002) is the database's answer for anything the person may
 * not see, including records that don't exist: pages turn it into the same
 * 404, so nothing reveals whether a child or record exists.
 */
export async function youthRead<T>(fn: string, args?: Record<string, unknown>): Promise<{ data: T | null; failed: boolean }> {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error?.code === "P0002") notFound();
  return { data: (data as T) ?? null, failed: Boolean(error) };
}
