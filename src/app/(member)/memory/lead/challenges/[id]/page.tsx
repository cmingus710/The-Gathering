import type { Metadata } from "next";
import { ChallengePage } from "@/components/memory/manage/pages";

export const metadata: Metadata = { title: "Group challenge" };

export default async function Page({ params }: PageProps<"/memory/lead/challenges/[id]">) {
  return <ChallengePage base="/memory/lead" id={(await params).id} />;
}
