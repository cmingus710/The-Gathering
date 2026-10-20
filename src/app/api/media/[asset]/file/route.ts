import { IMAGE_URL_TTL, signPath } from "@/lib/media/storage";
import { allowPublic, callerClient, notFound, redirectTo, tooMany, validId } from "@/lib/media/routes";

export const dynamic = "force-dynamic";

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

/** Handouts and slides: access rechecked, then a 5-minute signed download link. */
export async function GET(request: Request, ctx: RouteContext<"/api/media/[asset]/file">) {
  const { asset } = await ctx.params;
  if (!validId(asset)) return notFound();
  const caller = await callerClient();
  if (!caller) return notFound();
  if (!caller.signedIn && !(await allowPublic(request, "file", 120, 600))) return tooMany();
  const { data, error } = await caller.supabase.rpc("media_file", { p_asset: asset });
  const file = data as { path: string; kind: string; mime: string; title: string } | null;
  if (error || !file || file.kind !== "document") return notFound();
  const name = `${file.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 80) || "document"}.${EXT[file.mime] ?? "pdf"}`;
  const download = new URL(request.url).searchParams.has("download");
  const url = await signPath(caller.supabase, file.path, "media", IMAGE_URL_TTL, download ? name : undefined);
  return url ? redirectTo(url) : notFound();
}
