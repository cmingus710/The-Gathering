import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getViewer } from "@/lib/auth/viewer";
import { planTemplate, planTemplateXlsx } from "@/lib/bible/plan-import";

export const dynamic = "force-dynamic";

/** The CSV or Excel template for reading plan imports (plan managers only). */
export async function GET(request: Request) {
  const result = await getViewer();
  const v = result.state === "signed-in" ? result.viewer : null;
  if (!v || v.status !== "approved" || !(v.capabilities.has(CAPABILITIES.readingEdit) || v.capabilities.has(CAPABILITIES.readingPublish))) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }
  const params = new URL(request.url).searchParams;
  const mode = params.get("mode") === "personal" ? "personal" : "calendar";
  const name = `reading-plan-${mode === "calendar" ? "dated" : "numbered"}-template`;
  if (params.get("format") === "xlsx") {
    return new Response(Buffer.from(planTemplateXlsx(mode)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  return new Response(planTemplate(mode), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
