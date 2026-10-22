import type { Metadata } from "next";
import { CollectionPage } from "@/components/memory/manage/pages";

export const metadata: Metadata = { title: "Memory verse collection" };

export default async function Page({ params }: PageProps<"/memory/lead/collections/[id]">) {
  return <CollectionPage base="/memory/lead" id={(await params).id} />;
}
