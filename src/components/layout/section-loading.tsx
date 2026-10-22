import { PageSkeleton } from "@/components/ui/page-skeleton";

/**
 * The loading.tsx for the member sections: shown inside the shell as soon as
 * a section is opened, and prefetched with the links to it, so a tap gets
 * feedback at once. Home has none on purpose: a loading boundary makes React
 * hold the streamed page back for at least 300 ms after the placeholder
 * paints, which would delay the app's first screen on every launch.
 */
export default function SectionLoading() {
  return <PageSkeleton />;
}
