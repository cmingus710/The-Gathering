/* eslint-disable @next/next/no-img-element -- short-lived signed URLs, never through the image optimizer */
import { cn } from "@/components/ui/cn";
import { framingStyle, type Framing } from "@/lib/media/framing";

/**
 * An image in a fixed frame (the frame's size and shape come from
 * `className`), positioned and zoomed by a saved framing. Without a framing
 * the image is centred, as `object-cover` always did. `fit="contain"`
 * shows the whole image instead (book covers by default).
 */
export function FramedImage({
  src,
  alt,
  framing,
  fit = "cover",
  className,
  imgClassName,
}: {
  src: string;
  alt: string;
  framing?: Framing | null;
  fit?: "cover" | "contain";
  className?: string;
  imgClassName?: string;
}) {
  return (
    <span className={cn("block overflow-hidden", className)}>
      <img src={src} alt={alt} className={cn("block size-full", imgClassName)} style={fit === "contain" ? { objectFit: "contain" } : framingStyle(framing)} />
    </span>
  );
}
