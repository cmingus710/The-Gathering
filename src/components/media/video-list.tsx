import type { Attachment } from "@/lib/media/types";
import { attachmentVideo, videoAttachments, videoCaption } from "@/lib/media/videos";
import { VideoPlayer } from "./video-player";

/**
 * An item's videos, in the order an administrator set, each playable in
 * place with its contextual caption. Renders nothing when there are none.
 */
export function VideoList({
  attachments,
  title,
  itemId,
  poster,
  progress,
  saveProgress = false,
  className,
}: {
  attachments: Attachment[];
  /** The content's title (each player's accessible name adds the video's own). */
  title: string;
  itemId: string;
  poster?: string | null;
  progress?: Record<string, { position: number }>;
  saveProgress?: boolean;
  className?: string;
}) {
  const videos = videoAttachments(attachments);
  if (!videos.length) return null;
  return (
    <div className={className ?? "space-y-6"}>
      {videos.map((a, i) => (
        <VideoPlayer
          key={a.asset_id}
          video={attachmentVideo(a)}
          title={videos.length > 1 ? `${title}: ${a.caption?.trim() || a.title}` : title}
          itemId={itemId}
          caption={videoCaption(a)}
          poster={i === 0 ? poster : null}
          resumeAt={progress?.[`a:${a.asset_id}`]?.position}
          saveProgress={saveProgress}
        />
      ))}
    </div>
  );
}
