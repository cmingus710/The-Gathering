import type { Metadata } from "next";
import { CollectionPage } from "@/components/memory/manage/pages";

export const metadata: Metadata = { title: "Memory verse collection" };

export default async function Page({ params, searchParams }: PageProps<"/admin/memory/collections/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // ?preview=<verse id>: fetch and show that licensed verse's text.
  return <CollectionPage base="/admin/memory" id={id} preview={typeof sp.preview === "string" ? sp.preview : null} />;
}
