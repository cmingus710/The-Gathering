import { redirect } from "next/navigation";
import { requireLearner } from "@/lib/auth/viewer";

/**
 * The old "My workbooks" address. Lesson answers and notes are My Journal
 * entries now (20261122000100), so saved links and bookmarks go there, after
 * the same sign-in and approval check My Journal makes. Nothing is read here.
 */
export default async function MyWorkbooksRedirect({ searchParams }: PageProps<"/lessons/workbooks">) {
  await requireLearner("/journal");
  const sp = await searchParams;
  redirect(sp.deleted ? "/journal?notice=lesson-deleted" : "/journal");
}
