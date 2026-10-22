import type { Metadata } from "next";
import { ManageHomePage } from "@/components/memory/manage/pages";

export const metadata: Metadata = { title: "Memory verses" };

export default function Page() {
  return <ManageHomePage base="/memory/lead" />;
}
