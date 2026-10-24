"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireYouthArea } from "@/lib/auth/viewer";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

export type ProgressResult =
  | { ok: true; status: "started" | "completed"; revision: number }
  | { ok: false; conflict: "version" | "revision"; message: string }
  | { ok: false; conflict?: undefined; message: string };

const input = z.object({
  activity: z.uuid(),
  // The explicitly chosen child (guardians); null for a youth playing as themselves.
  child: z.uuid().nullable(),
  version: z.uuid(),
  revision: z.number().int().min(0).max(1_000_000),
  completed: z.boolean(),
  data: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Saves Learn & Play progress for one child on one activity version. The
 * database checks, on every call, that the signed-in person may play for
 * that child, that the activity is open to the child, and that the version
 * and revision are still current; a stale page gets a conflict and nothing
 * is written. Progress values are never logged.
 */
export async function saveActivityProgress(raw: unknown): Promise<ProgressResult> {
  await requireYouthArea("/youth/play");
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That couldn't be saved." };
  const { activity, child, version, revision, completed, data } = parsed.data;
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: "Learn & Play is unavailable right now. Nothing was changed." };
  const { data: saved, error } = await supabase.rpc("youth_activity_progress_save", {
    p_activity: activity,
    p_child: child,
    p_version: version,
    p: { data, completed, revision },
  });
  if (error) return { ok: false, message: dbErrorMessage(error, "That couldn't be saved right now. Nothing was changed.") };
  const r = saved as { conflict?: "version" | "revision"; status?: "started" | "completed"; revision?: number };
  if (r?.conflict === "version") {
    return { ok: false, conflict: "version", message: "This activity was updated. Earlier progress is kept; reload to start the new version." };
  }
  if (r?.conflict === "revision") {
    return { ok: false, conflict: "revision", message: "This was saved meanwhile on another device or tab. Reload to see the latest." };
  }
  revalidatePath("/youth", "layout");
  return { ok: true, status: r.status ?? "started", revision: r.revision ?? revision + 1 };
}
