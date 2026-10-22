import type { Metadata } from "next";
import { PreviewPage } from "@/components/memory/manage/pages";

export const metadata: Metadata = { title: "Preview memory activities" };

export default async function Page({ params, searchParams }: PageProps<"/memory/lead/collections/[id]/preview">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <PreviewPage base="/memory/lead" id={id} searchParams={sp} />;
}
