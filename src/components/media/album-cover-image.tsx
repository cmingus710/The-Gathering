"use client";

/* eslint-disable @next/next/no-img-element -- short-lived signed URLs and access-checked stills, never through the image optimizer */
import { useEffect, useRef, useState } from "react";
import { TileIcon } from "@/components/icons/icon";
import { cn } from "@/components/ui/cn";
import { framingStyle, type Framing } from "@/lib/media/framing";

/**
 * An album's cover in its 4:3 frame: the saved cover with the editor's crop,
 * else the automatic photo or video still, else (or when the image can't be
 * loaded) the branded gallery placeholder. `alt` is empty on cards, where
 * the album title next to it already names the link.
 */
export function AlbumCoverImage({ src, alt, framing, className }: { src: string | null; alt: string; framing: Framing | null; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const img = useRef<HTMLImageElement>(null);
  // An image that failed before hydration never reports onError: check it once mounted.
  useEffect(() => {
    const el = img.current;
    if (el && src && el.complete && el.naturalWidth === 0) setFailed(src);
  }, [src]);
  const show = src && failed !== src;
  return (
    <span className={cn("relative block aspect-[4/3] overflow-hidden bg-surface-muted", className)}>
      {show ? (
        <img ref={img} src={src} alt={alt} className="block size-full" style={framingStyle(framing)} onError={() => setFailed(src)} />
      ) : (
        <span className="flex size-full items-center justify-center" role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
          <TileIcon name="gallery" className="size-16" />
        </span>
      )}
    </span>
  );
}
