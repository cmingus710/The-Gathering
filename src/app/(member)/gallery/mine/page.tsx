import type { Metadata } from "next";
import { MyPhotos } from "@/components/media/my-photos";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { signPaths, UPLOAD_BUCKET } from "@/lib/media/storage";
import type { Photo } from "@/lib/media/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My photos" };

export default async function MyPhotosPage() {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("media_my_photos");
  const photos = (data ?? []) as Array<Photo & { album_title: string }>;
  const [live, review] = await Promise.all([
    signPaths(supabase, photos.map((p) => p.thumb_path)),
    signPaths(supabase, photos.map((p) => p.review_thumb_path), UPLOAD_BUCKET),
  ]);
  return (
    <>
      <BackLink route="/gallery/mine" />
      <PageHeader title="My photos" description="Photos you've added, and where each one stands. Removing a photo deletes it." />
      {error ? <Alert tone="error" title="Your photos couldn't be loaded right now." className="mb-6" /> : null}
      {!error && !photos.length ? <EmptyState glyph="gallery" title="You haven't added any photos" /> : null}
      <MyPhotos photos={photos} urls={new Map([...live, ...review])} />
    </>
  );
}
