import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";
import { ShowForm } from "../show-form";

export const metadata: Metadata = { title: "New podcast show" };

export default async function NewShowPage({ searchParams }: PageProps<"/admin/podcasts/new">) {
  await requireCapability(CAPABILITIES.podcastsManage, "/admin/podcasts/new");
  const sp = await searchParams;
  const kind = sp.kind === "church" || sp.kind === "external" ? sp.kind : null;
  if (!kind) notFound();
  const supabase = await requireClient();
  const [opts, images] = await Promise.all([
    supabase.rpc("media_admin_item_options"),
    supabase.rpc("media_admin_assets", { p_kind: "image", p_status: "ready", p_q: null, p_limit: 100, p_offset: 0 }),
  ]);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/podcasts" className="hover:underline">
            Podcasts
          </Link>
        }
        title={kind === "church" ? "New church show" : "Add an external show"}
        description={
          kind === "church"
            ? "A home for the church's own recorded episodes. Episodes are written in Teaching content."
            : "Imports episode details from the show's public feed. Nothing is downloaded or re-hosted."
        }
      />
      <ShowForm
        show={{
          kind,
          title: "",
          description: "",
          author: null,
          artwork_asset_id: null,
          website_url: null,
          feed_url: null,
          provider_url: null,
          allow_stream: false,
          audience: "members",
          group_id: null,
          featured: false,
          sort_order: 100,
          public_feed: false,
          feed_language: "en-us",
          feed_category: "Religion & Spirituality > Christianity",
          feed_explicit: false,
          feed_owner_email: null,
        }}
        groups={((opts.data as { groups?: Array<{ id: string; name: string }> } | null)?.groups ?? [])}
        images={((images.data as { items?: Array<{ id: string; title: string; public_ok: boolean }> } | null)?.items ?? [])}
        feedUrl={`${getSiteUrl()}/podcast/feed.xml`}
      />
    </>
  );
}
