import type { Metadata } from "next";
import { CollectionPage } from "@/components/memory/manage/pages";

export const metadata: Metadata = { title: "Memory verse collection" };

export default async function Page({ params }: PageProps<"/admin/memory/collections/[id]">) {
  return <CollectionPage base="/admin/memory" id={(await params).id} />;
}
