import type { Metadata } from "next";
import { NewCollectionPage } from "@/components/memory/manage/pages";

export const metadata: Metadata = { title: "New memory verse collection" };

export default function Page() {
  return <NewCollectionPage base="/memory/lead" />;
}
