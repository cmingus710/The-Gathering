import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { requireClient } from "@/lib/supabase/server";
import { AlbumForm } from "../album-form";

export const metadata: Metadata = { title: "New album" };

export default async function NewAlbumPage() {
  await requireAnyCapability([CAPABILITIES.galleryModerate, CAPABILITIES.eventsManage], "/admin/gallery/new");
  const supabase = await requireClient();
  const { data } = await supabase.rpc("media_admin_album_options");
  const options = (data ?? { events: [], groups: [] }) as { events: Array<{ id: string; title: string; start_date: string }>; groups: Array<{ id: string; name: string }> };
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/gallery" className="hover:underline">
            Media gallery
          </Link>
        }
        title="New album"
        description="Starts as a draft. A gallery moderator publishes it."
      />
      <Card>
        <AlbumForm
          album={{ title: "", description: "", album_on: null, event_series_id: null, audience: "members", group_id: null, uploads_open: false, sort_order: 100 }}
          groups={options.groups}
          events={options.events}
        />
      </Card>
    </>
  );
}
