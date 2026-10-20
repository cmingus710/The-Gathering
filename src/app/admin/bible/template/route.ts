import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getViewer } from "@/lib/auth/viewer";
import { planTemplate } from "@/lib/bible/plan-import";

export const dynamic = "force-dynamic";

/** The CSV template for reading plan imports (plan managers only). */
export async function GET(request: Request) {
  const result = await getViewer();
  const v = result.state === "signed-in" ? result.viewer : null;
  if (!v || v.status !== "approved" || !(v.capabilities.has(CAPABILITIES.readingEdit) || v.capabilities.has(CAPABILITIES.readingPublish))) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }
  const mode = new URL(request.url).searchParams.get("mode") === "personal" ? "personal" : "calendar";
  return new Response(planTemplate(mode), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reading-plan-${mode === "calendar" ? "dated" : "numbered"}-template.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
