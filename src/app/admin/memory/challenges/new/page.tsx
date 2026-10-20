import type { Metadata } from "next";
import { NewChallengePage } from "@/components/memory/manage/pages";

export const metadata: Metadata = { title: "New group challenge" };

export default function Page() {
  return <NewChallengePage base="/admin/memory" />;
}
