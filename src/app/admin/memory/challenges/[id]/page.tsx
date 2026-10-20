import type { Metadata } from "next";
import { ChallengePage } from "@/components/memory/manage/pages";

export const metadata: Metadata = { title: "Group challenge" };

export default async function Page({ params }: PageProps<"/admin/memory/challenges/[id]">) {
  return <ChallengePage base="/admin/memory" id={(await params).id} />;
}
